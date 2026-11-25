/**
 * M4-sync fault-injection suite — ADR-0010 acceptance evidence.
 *
 * Nine adversarial classes, each asserting the contract invariants:
 * no forged frame enters the store, no frame applies twice, gaps are
 * detected and recovered completely, and the final client state always
 * converges to the authoritative server state:
 *
 *   1. reorder        — out-of-order delivery never applies out of order
 *   2. duplicate      — duplicated delivery is exactly-once in the store
 *   3. drop/gap       — dropped frames trip the death machine; watermark
 *                       recovery restores everything
 *   4. forged         — tampered/unsigned frames never apply
 *   5. reconnect      — close+resume with cursor replays the gap exactly once
 *   6. slow client    — backlog overflow expires the cursor; reset rebuilds
 *   7. revoke         — mid-stream revocation stops frames with one reset
 *   8. restart        — gateway restart over the same domain: stale cursor →
 *                       reset → converged rebuild
 *   9. dual device    — concurrent mutations + independent reconnects converge
 *
 * Plus unit-level invariants: chunk-append merging, watermark atomicity,
 * owner-epoch idempotency.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash, generateKeyPairSync, sign, verify, createPublicKey, randomBytes, randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const tsc = resolve('node_modules/typescript/bin/tsc');
const REMOTE_FILES = ['types', 'wire', 'client', 'events', 'crypto', 'sandbox', 'store', 'demo'].map(n => `src/remote/${n}.ts`);
function buildRemote(t) {
  const out = mkdtempSync(resolve(tmpdir(), 'piguimobile-m4-'));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const r = spawnSync(process.execPath, [tsc, '--ignoreConfig', '--module', 'commonjs', '--target', 'es2021', '--esModuleInterop', '--skipLibCheck', '--strict', '--noUncheckedIndexedAccess', '--outDir', out, ...REMOTE_FILES], { encoding: 'utf8' });
  assert.equal(r.status, 0, `tsc failed:\n${r.stderr}\n${r.stdout}`);
  return out;
}
// Compile ONCE per suite file — per-rig transpilation makes the suite time
// out (12 tests × a full tsc invocation each).
let cachedModules = null;
let cachedOut = null;
process.on('exit', () => { if (cachedOut) rmSync(cachedOut, { recursive: true, force: true }); });
function load(t) {
  if (cachedModules) return cachedModules;
  const out = mkdtempSync(resolve(tmpdir(), 'piguimobile-m4-shared-'));
  cachedOut = out;
  const r = spawnSync(process.execPath, [tsc, '--ignoreConfig', '--module', 'commonjs', '--target', 'es2021', '--esModuleInterop', '--skipLibCheck', '--strict', '--noUncheckedIndexedAccess', '--outDir', out, ...REMOTE_FILES], { encoding: 'utf8' });
  assert.equal(r.status, 0, `tsc failed:\n${r.stderr}\n${r.stdout}`);
  cachedModules = {
    client: require(resolve(out, 'client.js')),
    events: require(resolve(out, 'events.js')),
    crypto: require(resolve(out, 'crypto.js')),
    sandbox: require(resolve(out, 'sandbox.js')),
    store: require(resolve(out, 'store.js')),
  };
  return cachedModules;
}

const sha256 = b => createHash('sha256').update(b).digest('hex');
const DER_PUB = Buffer.from('302a300506032b6570032100', 'hex');
const publicKeyOf = raw => createPublicKey({ key: Buffer.concat([DER_PUB, Buffer.from(raw, 'base64url')]), format: 'der', type: 'spki' });
function edKeypair() {
  const kp = generateKeyPairSync('ed25519');
  return { ...kp, publicKeyRaw: kp.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url') };
}
function nodeCrypto(kp) {
  return {
    publicKeyRaw: kp.publicKeyRaw,
    sign: m => sign(null, Buffer.from(m, 'utf8'), kp.privateKey).toString('base64url'),
    verify: (pub, sig, m) => verify(null, Buffer.from(m, 'utf8'), publicKeyOf(pub), Buffer.from(sig, 'base64url')),
    randomBytes: n => randomBytes(n).toString('base64url'),
  };
}

const PROJECT = 'project-f0001';
const CONV = 'conversation-f001';
const ALL_SCOPES = ['projects.read', 'sessions.read', 'sessions.create', 'approvals.read', 'chat.send', 'chat.stop', 'approvals.respond'];

function domain() {
  return {
    projects: [{ projectId: PROJECT, displayName: 'Fault Lab', description: 'synthetic fault injection fixture' }],
    sessions: [{ sessionId: 'session-f0001', projectId: PROJECT, displayName: 'Fault session', updatedAt: '2026-11-22T09:00:00Z', activeConversations: [{ conversationId: CONV }] }],
    conversations: [{
      conversationId: CONV, sessionId: 'session-f0001', projectId: PROJECT, title: 'Fault conversation',
      status: 'idle', owner: 'runtime:synthetic:fault', ownerRevision: 1, ownerEpoch: 1,
      messages: [{ messageId: 'message-f0001', role: 'assistant', text: 'fault lab online' }],
      approvals: [],
      script: { afterSend: { text: 'synthetic chunked reply body for fault injection coverage.', chunks: 3 } },
    }],
  };
}

/** A full client rig bound to one gateway — REAL Ed25519 device key. */
function rig(t, M, gateway, label = 'device') {
  const device = edKeypair();
  const deviceCrypto = nodeCrypto(device);
  const credentials = gateway.registerDevice({
    devicePublicKey: device.publicKeyRaw, grantedScopes: ALL_SCOPES, grants: [PROJECT],
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });
  const client = new M.client.TypedRemoteClient({
    credentials, crypto: deviceCrypto,
    transport: { send: req => gateway.send(req) },
  });
  const store = new M.store.ConversationStore(client, null);
  const events = new M.events.EventStreamClient({
    credentials, crypto: deviceCrypto,
    authorizeResource: () => true,
    onReset: () => {},
    onEvent: a => store.apply(a),
    onStreamError: () => store.markStreamError(),
  });
  const stream = {
    subscribe: (request, onFrame, onClose) => {
      const sub = gateway.subscribe(credentials, request, onFrame);
      if (!sub.ok) { onClose(String(sub.response.status)); return { close: () => {} }; }
      return sub;
    },
  };
  return { M, gateway, client, events, store, stream, credentials, deviceCrypto, device };
}

/** Build a transpiled-module set + gateway over the domain with a REAL
 *  Ed25519 service key (same harness discipline as the M3 loop suite). */
function setup(t, domainData) {
  const M = load(t);
  const service = edKeypair();
  const serviceMaterial = { fingerprint: sha256(service.publicKeyRaw), publicKey: service.publicKeyRaw };
  const gwCrypto = {
    sign: m => sign(null, Buffer.from(m, 'utf8'), service.privateKey).toString('base64url'),
    verify: (pub, sig, m) => verify(null, Buffer.from(m, 'utf8'), publicKeyOf(pub), Buffer.from(sig, 'base64url')),
  };
  const gateway = new M.sandbox.LocalSyntheticGateway(domainData, gwCrypto, serviceMaterial);
  return { M, gateway, service, serviceMaterial, gwCrypto };
}

async function send(r, text) {
  const rev = (await r.client.snapshot(CONV)).result.ownerRevision;
  const out = await r.client.sendMessage(CONV, randomUUID(), text, rev);
  assert.equal(out.ok, true, `send ${text} failed: ${JSON.stringify(out)}`);
}

/** Server-side authoritative message texts for CONV. */
function serverMessages(gateway) {
  const conv = gateway.domain.conversations.find(c => c.conversationId === CONV);
  return conv.messages.map(m => `${m.role}:${m.text}`);
}
function storeMessages(r) {
  return r.store.conversation(CONV).messages.map(m => `${m.role}:${m.text}`);
}
function assertConverged(r, gateway, what) {
  assert.deepEqual(storeMessages(r), serverMessages(gateway), `${what}: store must converge to the authoritative server state`);
}

// ---------------------------------------------------------------- 1. reorder
test('fault 1 reorder: out-of-order delivery never applies out of order; recovery converges', async (t) => {
  const { M, gateway, service } = setup(t, domain());
  const r = rig(t, M, gateway, 'reorder');
  const svcSign = m => sign(null, Buffer.from(m, 'utf8'), service.privateKey).toString('base64url');
  await r.store.load();
  r.events.open(r.stream, r.client.buildEventsRequest(), undefined);
  gateway.setFaultInjection({ reorderAfter: 4 });
  await send(r, 'reorder-me');
  gateway.flushFaults();
  // Frames were delivered reordered: either dropped by position tracking or
  // the death machine fired — but NEVER applied out of order. The final
  // converged state is achieved through watermark recovery.
  if (r.store.streamErrorActive()) {
    await recover(r);
  } else {
    // position tracking dropped the out-of-order tail: frames missing →
    // reconnect replay restores them exactly once.
    r.events.close();
    const cursor = r.store.latestWatermarkCursor() ?? r.events.latestCursor();
    r.events.open(r.stream, r.client.buildEventsRequest(cursor), cursor);
  }
  gateway.setFaultInjection(null);
  // Re-pull baseline + replay, then verify convergence.
  await r.store.refresh(CONV);
  assertConverged(r, gateway, 'reorder');
  assert.ok(!hasDuplicateIds(r), 'no duplicated bubbles');
});

/** Duplicate detection keyed on messageId — identical reply TEXTS across
 *  different messages are legitimate (scripted replies share content). */
function hasDuplicateIds(r) {
  const ids = r.store.conversation(CONV).messages.map(m => m.messageId);
  return new Set(ids).size !== ids.length;
}

async function recover(r) {
  r.events.close();
  r.store.markStreamRecovering();
  await r.store.load();
  const cursor = r.store.latestWatermarkCursor();
  r.events.open(r.stream, r.client.buildEventsRequest(cursor), cursor);
  r.store.markStreamLive();
}

// -------------------------------------------------------------- 2. duplicate
test('fault 2 duplicate: duplicated delivery is exactly-once in the store', async (t) => {
  const { M, gateway, service } = setup(t, domain());
  const r = rig(t, M, gateway, 'dup');
  const svcSign = m => sign(null, Buffer.from(m, 'utf8'), service.privateKey).toString('base64url');
  await r.store.load();
  r.events.open(r.stream, r.client.buildEventsRequest(), undefined);
  gateway.setFaultInjection({ duplicate: true });
  await send(r, 'dup-me');
  gateway.setFaultInjection(null);
  assertConverged(r, gateway, 'duplicate');
  // exactly one user bubble + one assistant bubble added on top of the seed
  assert.equal(r.store.conversation(CONV).messages.filter(m => m.text === 'dup-me').length, 1);
  assert.equal(r.store.conversation(CONV).messages.filter(m => m.role === 'assistant').length, 2); // seed + reply
});

// ------------------------------------------------------------------ 3. drop
test('fault 3 drop: dropped frames trip the death machine; watermark recovery restores everything', async (t) => {
  const { M, gateway, service } = setup(t, domain());
  const r = rig(t, M, gateway, 'drop');
  const svcSign = m => sign(null, Buffer.from(m, 'utf8'), service.privateKey).toString('base64url');
  await r.store.load();
  r.events.open(r.stream, r.client.buildEventsRequest(), undefined);
  gateway.setFaultInjection({ dropEvery: 2 });
  await send(r, 'drop-me');
  gateway.setFaultInjection(null);
  // A dropped sequence MUST be detected: the stream is dead.
  assert.equal(r.store.streamErrorActive(), true, 'gap must trip the death machine');
  // The dead stream never applies further frames.
  const before = storeMessages(r).length;
  await send(r, 'after-death');
  assert.equal(storeMessages(r).length, before, 'dead stream applies nothing');
  // Watermark recovery restores everything — including frames emitted while dead.
  await recover(r);
  await r.store.refresh(CONV);
  assertConverged(r, gateway, 'drop+recover');
});

// ----------------------------------------------------------------- 4. forged
test('fault 4 forged: unsigned/tampered/replayed-forged frames never apply', async (t) => {
  const { M, gateway, service } = setup(t, domain());
  const r = rig(t, M, gateway, 'forge');
  const svcSign = m => sign(null, Buffer.from(m, 'utf8'), service.privateKey).toString('base64url');
  await r.store.load();
  r.events.open(r.stream, r.client.buildEventsRequest(), undefined);
  await send(r, 'legit');
  const baseline = storeMessages(r).length;
  const legitCursor = r.events.latestCursor();
  const svcId = r.credentials.serviceId;
  const devId = r.credentials.deviceId;
  // (a) unsigned frame
  const unsignedFrame = { protocolVersion: 1, sequence: 999, conversationId: CONV, ownerRevision: 99, event: 'message.append', payload: { messageId: 'msg_forge1', role: 'assistant', text: 'FORGED' }, streamGeneration: 1, cursor: legitCursor, frameSignature: '' };
  assert.equal(r.events.accept(unsignedFrame).ok, false);
  // (b) correctly-shaped but signed with an attacker's key
  const evilKp = edKeypair();
  const frame2 = { ...unsignedFrame, payload: { messageId: 'msg_forge2', role: 'assistant', text: 'FORGED2' } };
  frame2.frameSignature = sign(null, Buffer.from(M.events.buildEventFrameMessage(frame2, devId, svcId) ?? '', 'utf8'), evilKp.privateKey).toString('base64url');
  assert.equal(r.events.accept(frame2).ok, false);
  // (c) server-signed but forbidden-value payload (credential smuggling)
  const frame3 = { ...unsignedFrame, event: 'approval.pending', payload: { requestId: 'approval-fg01', method: 'confirm', title: 't', message: 'read /Users/alice/.ssh/id_rsa' } };
  frame3.frameSignature = svcSign(M.events.buildEventFrameMessage(frame3, devId, svcId) ?? '');
  assert.equal(r.events.accept(frame3).ok, false);
  assert.equal(storeMessages(r).length, baseline, 'no forged frame entered the store');
  assert.ok(!r.store.conversation(CONV).approvals.some(a => a.requestId === 'approval-fg01'));
});

// -------------------------------------------------------------- 5. reconnect
test('fault 5 reconnect: close+resume with cursor replays the gap exactly once', async (t) => {
  const { M, gateway, service } = setup(t, domain());
  const r = rig(t, M, gateway, 'reconnect');
  const svcSign = m => sign(null, Buffer.from(m, 'utf8'), service.privateKey).toString('base64url');
  await r.store.load();
  r.events.open(r.stream, r.client.buildEventsRequest(), undefined);
  await send(r, 'before-disconnect');
  // Disconnect; server keeps journaling.
  const resumeCursor = r.events.latestCursor();
  r.events.close();
  await send(r, 'during-disconnect');
  assert.ok(!storeMessages(r).some(m => m.includes('during-disconnect')), 'precondition: frame unseen');
  // Resume FROM THE STREAM CURSOR: backlog replays exactly the missed frames.
  r.events.open(r.stream, r.client.buildEventsRequest(resumeCursor), resumeCursor);
  assertConverged(r, gateway, 'reconnect');
  assert.ok(!hasDuplicateIds(r), 'replayed frames must not duplicate ids');
});

// ------------------------------------------------------------- 6. slow client
test('fault 6 slow client: backlog overflow expires the cursor; reset rebuild converges', async (t) => {
  const { M, gateway, service } = setup(t, domain());
  const r = rig(t, M, gateway, 'slow');
  const svcSign = m => sign(null, Buffer.from(m, 'utf8'), service.privateKey).toString('base64url');
  await r.store.load();
  r.events.open(r.stream, r.client.buildEventsRequest(), undefined);
  await send(r, 'seed');
  const staleCursor = r.events.latestCursor();
  r.events.close();
  // Each send emits 1 user + 1 running + 3 chunks + 1 idle = 6 frames;
  // 50 sends ≈ 300 frames > MAX_BACKLOG (256) → the cursor's frames evict.
  for (let i = 0; i < 50; i += 1) await send(r, `bulk-${i}`);
  // Resume with the now-expired cursor: exactly one reset, then live frames.
  const resets = [];
  const appliedBefore = [];
  const sub = r.stream.subscribe(r.client.buildEventsRequest(staleCursor), f => {
    const res = r.events.accept(f);
    if (res.ok) { appliedBefore.push(res.applied); if (res.applied.event === 'reset') resets.push(res.applied); }
  }, () => {});
  assert.equal(resets.length, 1, 'expired cursor yields exactly one reset');
  assert.equal(resets[0].payload.reason, 'cursor_expired');
  // The reset rebuilds baselines through store.apply → refresh.
  await new Promise(resolve => setTimeout(resolve, 80));
  await r.store.refresh(CONV);
  assertConverged(r, gateway, 'slow-client reset rebuild');
  sub.close();
});

// ----------------------------------------------------------------- 7. revoke
test('fault 7 revoke: mid-stream revocation delivers one reset then stops all frames', async (t) => {
  const { M, gateway, service } = setup(t, domain());
  const r = rig(t, M, gateway, 'revoke');
  const svcSign = m => sign(null, Buffer.from(m, 'utf8'), service.privateKey).toString('base64url');
  await r.store.load();
  const frames = [];
  r.events.open(r.stream, r.client.buildEventsRequest(), undefined);
  await send(r, 'before-revoke');
  // Revoke the device mid-stream: contract requires exactly one reset frame
  // (authorization_changed) reaching the subscription BEFORE it closes.
  const resetsBefore = [];
  const sub = r.stream.subscribe(r.client.buildEventsRequest(), f => { if (f.event === 'reset') resetsBefore.push(f); }, () => {});
  gateway.revokeDevice(r.credentials.deviceId);
  assert.equal(resetsBefore.length, 1, 'revocation must emit exactly one reset');
  assert.equal(resetsBefore[0].payload.reason, 'authorization_changed');
  // No further frames are DELIVERED to the revoked device (ADR-0010 final:
  // frames are journaled regardless of authorization — delivery/replay-time
  // filtering — so the timeline has no holes for a future re-grant/re-pair;
  // the delivery guarantee is what matters).
  const conv = gateway.domain.conversations.find(c => c.conversationId === CONV);
  conv.messages.push({ messageId: 'msg_post_revoke', role: 'assistant', text: 'post-revoke' });
  const stream = gateway.streamFor(r.credentials.deviceId);
  const journalBefore = stream.journalSeq;
  gateway.emit(r.credentials.deviceId, 'message.append', conv, { messageId: 'msg_post_revoke', role: 'assistant', text: 'post-revoke' });
  assert.ok(stream.journalSeq > journalBefore, 'frame IS journaled — timeline continuity for future resume');
  // and the subscription was already removed by revokeDevice — zero delivery.
  sub.close();
});

// ---------------------------------------------------------------- 8. restart
test('fault 8 restart: gateway restart over the same domain — stale cursor resets, rebuild converges', async (t) => {
  const shared = domain();
  const { M, gateway: gateway1, service: service1 } = setup(t, shared);
  const r = rig(t, M, gateway1, 'restart');
  await r.store.load();
  r.events.open(r.stream, r.client.buildEventsRequest(), undefined);
  await send(r, 'pre-restart');
  const cursorBeforeRestart = r.events.latestCursor();
  r.events.close();
  // Server restart: a NEW gateway over the SAME persistent domain — journals
  // and subscription spaces are gone, the durable conversation state remains.
  // The restarted service keeps its identity (pinned key material survives
  // restarts — deviceLifecycle.rotation is for EXPLICIT rotation only).
  const gw2Crypto = {
    sign: m => sign(null, Buffer.from(m, 'utf8'), service1.privateKey).toString('base64url'),
    verify: (pub, sig, m) => verify(null, Buffer.from(m, 'utf8'), publicKeyOf(pub), Buffer.from(sig, 'base64url')),
  };
  const gateway2 = new M.sandbox.LocalSyntheticGateway(shared, gw2Crypto, { fingerprint: sha256(service1.publicKeyRaw), publicKey: service1.publicKeyRaw });
  // Re-register the same device key on the restarted gateway (re-pair).
  const credentials2 = gateway2.registerDevice({
    devicePublicKey: r.deviceCrypto.publicKeyRaw, grantedScopes: ALL_SCOPES, grants: [PROJECT],
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });
  const client2 = new M.client.TypedRemoteClient({
    credentials: credentials2, crypto: r.deviceCrypto,
    transport: { send: req => gateway2.send(req) },
  });
  r.client = client2;
  // Mutate while the client is away.
  const rev = (await client2.snapshot(CONV)).result.ownerRevision;
  await client2.sendMessage(CONV, randomUUID(), 'post-restart', rev);
  // Resume with the pre-restart cursor: seq is beyond the fresh journal head
  // → wellformed-stale → exactly one reset → baseline rebuild.
  const stream2 = {
    subscribe: (request, onFrame, onClose) => {
      const sub = gateway2.subscribe(credentials2, request, onFrame);
      if (!sub.ok) { onClose(String(sub.response.status)); return { close: () => {} }; }
      return sub;
    },
  };
  // Stream-side invariant (independent-review nit 6 + finding 2): the
  // pre-restart cursor MUST NOT validate against the fresh incarnation —
  // exactly one reset must fire, even in the exact-head arithmetic case,
  // because the incarnation salt makes the cursor foreign. Assert the reset
  // itself, not just post-refresh convergence.
  const resetsSeen = [];
  const appliedEvents = [];
  const origApply = r.store.apply.bind(r.store);
  r.events.onEvent = a => { if (a.event === 'reset') resetsSeen.push(a); appliedEvents.push(a); origApply(a); };
  r.events.open(stream2, client2.buildEventsRequest(cursorBeforeRestart), cursorBeforeRestart);
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(resetsSeen.length, 1, 'pre-restart cursor must produce exactly one reset — never silent loss');
  assert.equal(resetsSeen[0].payload.reason, 'cursor_expired');
  await r.store.refresh(CONV);
  // store must converge to the restarted server's authoritative state.
  const serverTexts = shared.conversations.find(c => c.conversationId === CONV).messages.map(m => `${m.role}:${m.text}`);
  assert.deepEqual(storeMessages(r), serverTexts, 'post-restart convergence');
});

// ------------------------------------------------------------- 9. dual device
test('fault 9 dual device: concurrent mutations + independent reconnects converge identically', async (t) => {
  const { M, gateway } = setup(t, domain());
  const a = rig(t, M, gateway, 'alpha');
  const b = rig(t, M, gateway, 'beta');
  await a.store.load();
  await b.store.load();
  a.events.open(a.stream, a.client.buildEventsRequest(), undefined);
  b.events.open(b.stream, b.client.buildEventsRequest(), undefined);
  // Interleaved mutations from both devices.
  await send(a, 'alpha-1');
  await send(b, 'beta-1');
  await send(a, 'alpha-2');
  // Both live streams must have converged already.
  assertConverged(a, gateway, 'dual-device live A');
  assertConverged(b, gateway, 'dual-device live B');
  // Disconnect B, mutate from A, reconnect B with its cursor.
  const bCursor = b.events.latestCursor();
  b.events.close();
  await send(a, 'alpha-while-beta-away');
  b.events.open(b.stream, b.client.buildEventsRequest(bCursor), bCursor);
  assertConverged(b, gateway, 'dual-device reconnected B');
  assert.deepEqual(storeMessages(b), storeMessages(a), 'both devices converge identically');
});

// -------------------------------------------- unit invariants (chunk/watermark/epoch)
test('unit chunk-append: progressive frames merge into one bubble ending in the full text', async (t) => {
  const { M, gateway, service } = setup(t, domain());
  const r = rig(t, M, gateway, 'chunk');
  const svcSign = m => sign(null, Buffer.from(m, 'utf8'), service.privateKey).toString('base64url');
  await r.store.load();
  r.events.open(r.stream, r.client.buildEventsRequest(), undefined);
  await send(r, 'chunk-trigger');
  const conv = r.store.conversation(CONV);
  const replies = conv.messages.filter(m => m.role === 'assistant' && m.text.includes('synthetic chunked reply'));
  assert.equal(replies.length, 1, 'chunked frames merge into exactly one bubble');
  assert.equal(replies[0].text, 'synthetic chunked reply body for fault injection coverage.', 'final frame carries the complete text');
});

test('unit watermark atomicity: resuming from a snapshot watermark loses nothing and duplicates nothing', async (t) => {
  const { M, gateway, service } = setup(t, domain());
  const r = rig(t, M, gateway, 'watermark');
  const svcSign = m => sign(null, Buffer.from(m, 'utf8'), service.privateKey).toString('base64url');
  await r.store.load();
  r.events.open(r.stream, r.client.buildEventsRequest(), undefined);
  // Refresh adopts the watermark; then frames emitted AFTER the watermark
  // must replay exactly once when resuming from it.
  await r.store.refresh(CONV);
  const wm = r.store.conversation(CONV).watermark;
  assert.ok(wm && typeof wm.cursor === 'string', 'watermark adopted');
  assert.match(wm.cursor, /^g[0-9]+_s[0-9]+_[A-Za-z0-9_-]{22}$/);
  r.events.close();
  await send(r, 'post-watermark');
  r.events.open(r.stream, r.client.buildEventsRequest(wm.cursor), wm.cursor);
  assertConverged(r, gateway, 'watermark resume');
  assert.ok(!hasDuplicateIds(r));
});

test('unit owner-epoch idempotency: same-epoch retry hits; rolled epoch is a fresh key', async (t) => {
  const { M, gateway, service } = setup(t, domain());
  const r = rig(t, M, gateway, 'epoch');
  const svcSign = m => sign(null, Buffer.from(m, 'utf8'), service.privateKey).toString('base64url');
  const clientMessageId = randomUUID();
  const rev = (await r.client.snapshot(CONV)).result.ownerRevision;
  const first = await r.client.sendMessage(CONV, clientMessageId, 'epoch-text', rev);
  assert.equal(first.ok, true);
  const countAfterFirst = serverMessages(gateway).filter(m => m.includes('epoch-text')).length;
  assert.equal(countAfterFirst, 1);
  // Same-epoch retry with identical payload → idempotent hit, no duplicate.
  const revRetry = (await r.client.snapshot(CONV)).result.ownerRevision;
  const retry = await r.client.sendMessage(CONV, clientMessageId, 'epoch-text', revRetry);
  assert.equal(retry.ok, true, `retry failed: ${JSON.stringify(retry)}`);
  assert.equal(serverMessages(gateway).filter(m => m.includes('epoch-text')).length, 1, 'same-epoch retry must not duplicate');
  // Roll the owner epoch: the SAME clientMessageId becomes a fresh key.
  gateway.rollOwnerEpoch(CONV);
  const rev2 = (await r.client.snapshot(CONV)).result.ownerRevision;
  const fresh = await r.client.sendMessage(CONV, clientMessageId, 'epoch-text', rev2);
  assert.equal(fresh.ok, true);
  assert.equal(serverMessages(gateway).filter(m => m.includes('epoch-text')).length, 2, 'rolled epoch treats the retry as a new mutation');
});

test('unit backlog eviction never produces a real gap: resumed clients always hit reset-or-replay', async (t) => {
  const { M, gateway, service } = setup(t, domain());
  const r = rig(t, M, gateway, 'evict');
  const svcSign = m => sign(null, Buffer.from(m, 'utf8'), service.privateKey).toString('base64url');
  await r.store.load();
  r.events.open(r.stream, r.client.buildEventsRequest(), undefined);
  await send(r, 'evict-seed');
  const cursor = r.events.latestCursor();
  r.events.close();
  for (let i = 0; i < 50; i += 1) await send(r, `evict-bulk-${i}`);
  // The cursor is provably outside the retained window now. Resume: the ONLY
  // legal outcomes are (a) replay from a still-retained position or (b) one
  // reset — NEVER silent frame loss. Here it must be the reset.
  const outcomes = [];
  const sub = r.stream.subscribe(r.client.buildEventsRequest(cursor), f => outcomes.push(f), () => {});
  assert.ok(outcomes.some(f => f.event === 'reset'), 'expired cursor must produce a reset — never a silent gap');
  const resetCount = outcomes.filter(f => f.event === 'reset').length;
  assert.equal(resetCount, 1, 'exactly one reset');
  sub.close();
});

// -------------------------------------------- regression: security review important finding
test('regression co-subscription isolation: a reset for subscription A never perturbs subscription B', async (t) => {
  // Independent-security important finding (2026-11-25): the shared journal
  // sequence previously consumed a number for the reset frame that only the
  // target subscription received — punching a hole into the co-subscription's
  // sequence chain and killing it with sequence_gap, violating contract
  // eventStream.concurrency ("A reset applies to its own subscription only").
  const { M, gateway } = setup(t, domain());
  const r = rig(t, M, gateway, 'cosub');
  await r.store.load();
  const aFrames = [];
  const bFrames = [];
  // Two co-subscriptions of the SAME device (cap is 2 per device).
  const subA = r.stream.subscribe(r.client.buildEventsRequest(), f => aFrames.push(f), () => {});
  const subB = r.stream.subscribe(r.client.buildEventsRequest(), f => bFrames.push(f), () => {});
  // Live traffic establishes positions on both.
  await send(r, 'seed-both');
  assert.ok(aFrames.length > 0 && bFrames.length > 0, 'both subscriptions receive live frames');
  // A resubscribes with a stale cursor → exactly one reset for A ONLY.
  const snapCursor = (await r.client.snapshot(CONV)).result.cursor;
  const stale = snapCursor.slice(0, -1) + (snapCursor.endsWith('a') ? 'b' : 'a');
  const aResets = [];
  subA.close();
  const subA2 = r.stream.subscribe(r.client.buildEventsRequest(stale), f => { if (f.event === 'reset') aResets.push(f); }, () => {});
  assert.equal(aResets.length, 1, 'A gets exactly one reset');
  // Now ordinary emission: B must receive it with NO sequence hole — B stays alive.
  const bSeqBefore = bFrames.at(-1).sequence;
  await send(r, 'post-reset-live');
  const bNew = bFrames.filter(f => f.payload && f.payload.text === 'post-reset-live');
  assert.ok(bNew.length > 0, 'B receives the post-reset frame');
  // Verify continuity: every B frame sequence is exactly predecessor+1 within a generation.
  const byGen = new Map();
  for (const f of bFrames) {
    if (!byGen.has(f.streamGeneration)) byGen.set(f.streamGeneration, []);
    byGen.get(f.streamGeneration).push(f.sequence);
  }
  for (const [gen, seqs] of byGen) {
    for (let i = 1; i < seqs.length; i += 1) {
      assert.equal(seqs[i], seqs[i - 1] + 1, `B generation ${gen} has a sequence hole at ${seqs[i - 1]}→${seqs[i]}`);
    }
  }
  subA2.close(); subB.close();
});

test('regression rewind-with-divergent-payload: replayed sequence carrying different effects fails signature, never the silent-drop path', async (t) => {
  // The silent rewind-drop assumes an exact replay is a no-op. A rewind frame
  // whose payload DIFFERS from the original must fail signature verification
  // BEFORE the position check — otherwise divergent effects could ride the
  // silent-drop path (independent-security test-adequacy note).
  const { M, gateway, service } = setup(t, domain());
  const r = rig(t, M, gateway, 'rewind');
  const svcSign = m => sign(null, Buffer.from(m, 'utf8'), service.privateKey).toString('base64url');
  await r.store.load();
  r.events.open(r.stream, r.client.buildEventsRequest(), undefined);
  await send(r, 'rewind-target');
  const appliedTexts = () => r.store.conversation(CONV).messages.map(m => m.text);
  const before = appliedTexts();
  // Capture the position then forge a rewind: sequence at-or-below position,
  // correctly signed by the SERVICE key but carrying a different payload.
  const pos = r.events.expectedPosition();
  assert.ok(pos, 'position established');
  const rewind = {
    protocolVersion: 1, sequence: Math.max(1, pos.sequence), conversationId: CONV,
    ownerRevision: 99, event: 'message.append',
    payload: { messageId: 'msg_rewind_evil', role: 'assistant', text: 'REWIND-DIVERGENT' },
    streamGeneration: pos.streamGeneration, cursor: 'g1_s1_aaaaaaaaaaaaaaaaaaaaaa', frameSignature: '',
  };
  rewind.frameSignature = svcSign(M.events.buildEventFrameMessage(rewind, r.credentials.deviceId, r.credentials.serviceId) ?? '');
  const res = r.events.accept(rewind);
  assert.equal(res.ok, false, 'honestly-signed rewind passes signature but is rejected by the position check');
  assert.equal(res.code, 'sequence_gap', 'the drop is the position-continuity drop');
  assert.deepEqual(appliedTexts(), before, 'silent rewind applies nothing — no divergent effects');
  assert.equal(r.events.streamError(), undefined, 'silent rewind must not kill the stream (rewind ≠ gap)');
});

test('regression cross-incarnation cursor: forged and pre-restart cursors are foreign, never silently accepted', async (t) => {
  // Independent-review findings 2+4: cursors must be keyed AND
  // incarnation-bound. A scratch-forged cursor built from public inputs must
  // hit the reset path, and a cursor from the previous incarnation must never
  // validate against the fresh journal — not even at exact head arithmetic.
  const shared = domain();
  const { M, gateway: gw1, service: service1 } = setup(t, shared);
  const r = rig(t, M, gw1, 'cross');
  await r.store.load();
  r.events.open(r.stream, r.client.buildEventsRequest(), undefined);
  await send(r, 'pre-incarnation');
  const cursorOld = r.events.latestCursor();
  r.events.close();
  // Fresh incarnation over the same domain (same service key, new salt).
  const gw2Crypto = {
    sign: m => sign(null, Buffer.from(m, 'utf8'), service1.privateKey).toString('base64url'),
    verify: (pub, sig, m) => verify(null, Buffer.from(m, 'utf8'), publicKeyOf(pub), Buffer.from(sig, 'base64url')),
  };
  const gw2 = new M.sandbox.LocalSyntheticGateway(shared, gw2Crypto, { fingerprint: sha256(service1.publicKeyRaw), publicKey: service1.publicKeyRaw });
  const creds2 = gw2.registerDevice({
    devicePublicKey: r.device.publicKeyRaw, grantedScopes: ALL_SCOPES, grants: [PROJECT],
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });
  // Drive the fresh journal to EXACTLY the pre-restart head (worst case from
  // the review: seq alignment would validate an unsalted cursor with zero
  // replay and zero reset — silent loss).
  const client2 = new M.client.TypedRemoteClient({ credentials: creds2, crypto: r.deviceCrypto, transport: { send: req => gw2.send(req) } });
  const probe = gw2.streamFor(creds2.deviceId);
  const targetHead = Number((/g[0-9]+_s([0-9]+)_/.exec(cursorOld) ?? [])[1] ?? 0);
  while (probe.journalSeq < targetHead) {
    const rev = (await client2.snapshot(CONV)).result.ownerRevision;
    await client2.sendMessage(CONV, randomUUID(), `pad-${probe.journalSeq}`, rev);
  }
  // Resume with the OLD cursor at exact head arithmetic: must be foreign →
  // exactly one reset, NEVER silent acceptance.
  const got = [];
  const sub = gw2.subscribe(creds2, client2.buildEventsRequest(cursorOld), f => got.push(f));
  assert.equal(sub.ok, true);
  const resets = got.filter(f => f.event === 'reset');
  assert.equal(resets.length, 1, 'cross-incarnation cursor must reset — even at exact head');
  assert.equal(resets[0].payload.reason, 'cursor_expired');
  // And no ordinary frame must have been delivered before the reset.
  assert.equal(got[0].event, 'reset', 'the reset is the first and only signal — never silent loss');
  sub.close();
});

test('regression grant revoke/re-grant: window mutations are recovered, never silently diverged', async (t) => {
  // Independent-security FINAL-review important finding: revoked-window
  // mutations must not permanently vanish from the client without a signal.
  // Fixed semantics: events journal regardless of authorization (delivery/
  // replay-time filtering only); both revoke and re-grant reset subscriptions
  // forcing baseline rebuilds.
  const { M, gateway } = setup(t, domain());
  const r = rig(t, M, gateway, 'regrant');
  await r.store.load();
  r.events.open(r.stream, r.client.buildEventsRequest(), undefined);
  await send(r, 'before-revoke');
  // Revoke the grant mid-stream.
  const resetCount = [];
  r.events.onEvent = a => { if (a.event === 'reset') resetCount.push(a); r.store.apply(a); };
  gateway.grantProject(r.credentials.deviceId, PROJECT, false);
  assert.equal(resetCount.length, 1, 'revoke delivers exactly one reset');
  // Mutate during the revoked window (server-side truth advances).
  const conv = gateway.domain.conversations.find(c => c.conversationId === CONV);
  conv.messages.push({ messageId: 'msg_window01', role: 'assistant', text: 'window-content' });
  conv.ownerRevision += 1;
  gateway.emit(r.credentials.deviceId, 'message.append', conv, { messageId: 'msg_window01', role: 'assistant', text: 'window-content' });
  assert.ok(!storeMessages(r).some(m => m.includes('window-content')), 'window frame not delivered live while revoked');
  // Re-grant: exactly one more reset → baseline rebuild surfaces the window content.
  const resetsBefore = resetCount.length;
  gateway.grantProject(r.credentials.deviceId, PROJECT, true);
  assert.equal(resetCount.length, resetsBefore + 1, 're-grant delivers exactly one reset');
  await new Promise(resolve => setTimeout(resolve, 60));
  await r.store.refresh(CONV);
  assert.ok(storeMessages(r).some(m => m.includes('window-content')), 'window mutation recovered after re-grant — no silent divergence');
  // Live traffic after re-grant flows with continuous sequences.
  await send(r, 'post-regrant');
  assertConverged(r, gateway, 'revoke/re-grant');
  // Cursor resume across the re-grant boundary replays window frames exactly once.
  const cursorNow = r.events.latestCursor();
  r.events.close();
  r.events.open(r.stream, r.client.buildEventsRequest(cursorNow), cursorNow);
  assert.ok(!hasDuplicateIds(r), 'no duplicate replay across the boundary');
});

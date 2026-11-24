import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash, generateKeyPairSync, sign, verify, createPublicKey, randomBytes } from 'node:crypto';

/**
 * M3-core: desktop/mobile synthetic closed loop.
 *
 * The typed remote client (transpiled src/remote/*) drives the in-repo
 * LocalSyntheticGateway — the SAME code path the bundled app exercises — with
 * REAL Ed25519 device/service keys. Assertions cover: signed requests, closed
 * envelopes, scope+grant admission, owner revision, idempotency, event frames
 * (signature/sequence/scope/reset), approval authority and bounded lists.
 */

const require = createRequire(import.meta.url);
const tsc = resolve('node_modules/typescript/bin/tsc');
const REMOTE_FILES = ['types', 'wire', 'client', 'events', 'crypto', 'sandbox', 'store', 'demo'].map(n => `src/remote/${n}.ts`);
function buildRemote(t) {
  const out = mkdtempSync(resolve(tmpdir(), 'piguimobile-remote-'));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const r = spawnSync(process.execPath, [tsc, '--ignoreConfig', '--module', 'commonjs', '--target', 'es2021', '--esModuleInterop', '--skipLibCheck', '--strict', '--noUncheckedIndexedAccess', '--outDir', out, ...REMOTE_FILES], { encoding: 'utf8' });
  assert.equal(r.status, 0, `tsc failed:\n${r.stderr}\n${r.stdout}`);
  return out;
}
function load(t) {
  const out = buildRemote(t);
  return {
    client: require(resolve(out, 'client.js')),
    events: require(resolve(out, 'events.js')),
    crypto: require(resolve(out, 'crypto.js')),
    sandbox: require(resolve(out, 'sandbox.js')),
    store: require(resolve(out, 'store.js')),
    wire: require(resolve(out, 'wire.js')),
    types: require(resolve(out, 'types.js')),
    demo: require(resolve(out, 'demo.js')),
  };
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
    sign: m => sign(null, Buffer.from(m, 'utf8'), kp.privateKey).toString('base64url'),
    verify: (pub, sig, m) => verify(null, Buffer.from(m, 'utf8'), publicKeyOf(pub), Buffer.from(sig, 'base64url')),
    randomBytes: n => randomBytes(n).toString('base64url'),
  };
}

const ALL_SCOPES = ['projects.read', 'sessions.read', 'sessions.create', 'approvals.read', 'chat.send', 'chat.stop', 'approvals.respond'];
const PROJECT = 'project-a0001';
const CONV = 'conversation-c001';

function domain(M, overrides = {}) {
  return {
    projects: [
      { projectId: PROJECT, displayName: 'Pi GUI Mobile', description: 'shell' },
      { projectId: 'project-b0002', displayName: 'Other', description: 'ungranted' },
    ],
    sessions: [{ sessionId: 'session-s0001', projectId: PROJECT, displayName: 'App shell', updatedAt: '2026-11-22T09:00:00Z', activeConversations: [{ conversationId: CONV }] }],
    conversations: [{
      conversationId: CONV, sessionId: 'session-s0001', projectId: PROJECT, title: 'App shell',
      status: 'idle', owner: 'runtime:syn:c1', ownerRevision: 2, ownerEpoch: 1,
      messages: overrides.messages ?? [{ messageId: 'message-m0001', role: 'assistant', text: 'hello' }],
      approvals: overrides.approvals ?? [{
        requestId: 'approval-a001', conversationId: CONV, method: 'select', title: 'Pick', message: 'choose',
        options: [{ optionId: 'option-a', label: 'A' }, { optionId: 'option-b', label: 'B' }],
        pending: true, expiresAtMs: Date.now() + 60_000, owner: 'runtime:syn:c1', revision: 2,
      }],
      script: { afterSend: { text: 'synthetic reply' } },
    }],
  };
}

function rig(t, { scopes = ALL_SCOPES, grants = [PROJECT], overrides = {} } = {}) {
  const M = load(t);
  const service = edKeypair();
  const serviceFp = sha256(service.publicKeyRaw);
  const serviceMaterial = { fingerprint: serviceFp, publicKey: service.publicKeyRaw };
  const gwCrypto = {
    sign: m => sign(null, Buffer.from(m, 'utf8'), service.privateKey).toString('base64url'),
    verify: (pub, sig, m) => verify(null, Buffer.from(m, 'utf8'), publicKeyOf(pub), Buffer.from(sig, 'base64url')),
  };
  const gateway = new M.sandbox.LocalSyntheticGateway(domain(M, overrides), gwCrypto, serviceMaterial);
  const device = edKeypair();
  const deviceCrypto = nodeCrypto(device);
  const credentials = gateway.registerDevice({
    devicePublicKey: device.publicKeyRaw,
    grantedScopes: scopes,
    grants,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });
  const client = new M.client.TypedRemoteClient({
    credentials, crypto: deviceCrypto,
    transport: { send: req => gateway.send(req) },
  });
  const storeEvents = [];
  const resets = [];
  const events = new M.events.EventStreamClient({
    credentials, crypto: deviceCrypto,
    authorizeResource: () => true,
    onReset: () => {},
    onEvent: a => storeEvents.push(a),
    onDrop: c => drops.push(c),
  });
  const drops = [];
  const stream = {
    subscribe: (request, onFrame, onClose) => {
      const sub = gateway.subscribe(credentials, request, onFrame);
      if (!sub.ok) { onClose(String(sub.response.status)); return { close: () => {} }; }
      return sub;
    },
  };
  const serviceCrypto = nodeCrypto(service);
  const store = new M.store.ConversationStore(client, events);
  events.onEvent = a => store.apply(a);
  return { M, gateway, client, events, store, stream, credentials, deviceCrypto, serviceCrypto, serviceFp, storeEvents, resets, drops };
}

function signedOp(rigCtx, opPath, params, { method = 'GET', body = null, mutate } = {}) {
  const M = rigCtx.M;
  let path = opPath;
  for (const [k, v] of Object.entries(params)) path = path.replace(`{${k}}`, v);
  const rawBody = body === null ? '' : M.wire.canonicalJson(body);
  const requestId = crypto.randomUUID ? crypto.randomUUID() : 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
  const timestamp = String(Date.now());
  const nonce = randomBytes(32).toString('base64url');
  const bodySha256 = sha256(rawBody);
  const creds = rigCtx.credentials;
  const message = ['1', creds.deviceId, creds.serviceId, String(creds.replayEpoch), requestId, method, path, timestamp, nonce, bodySha256].join('\n');
  const req = {
    method, path,
    headers: {
      'x-pi-remote-device': creds.deviceId, 'x-pi-remote-epoch': String(creds.replayEpoch),
      'x-pi-remote-request-id': requestId, 'x-pi-remote-timestamp': timestamp, 'x-pi-remote-nonce': nonce,
      'x-pi-remote-body-sha256': bodySha256, 'x-pi-remote-signature': rigCtx.deviceCrypto.sign(message),
      accept: 'application/json', ...(method === 'POST' ? { 'content-type': 'application/json; charset=utf-8' } : {}),
    },
    rawBody, ...(body === null ? {} : { body }),
  };
  if (mutate) mutate(req);
  return req;
}

const OPEN = { method: 'GET', path: '/remote/v1/conversations/conversation-c001/snapshot' };
const PATHS = {
  projects: '/remote/v1/projects',
  sessions: `/remote/v1/projects/${PROJECT}/sessions`,
  snapshot: `/remote/v1/conversations/${CONV}/snapshot`,
  send: `/remote/v1/conversations/${CONV}/messages`,
  stop: `/remote/v1/conversations/${CONV}/stop`,
  approvals: `/remote/v1/conversations/${CONV}/approvals`,
  respond: `/remote/v1/conversations/${CONV}/approvals/approval-a001/respond`,
};

async function errorOf(res) { const body = JSON.parse(res.body); return body.error; }

test('pair.exchange: closed negatives, atomic grant + minted epoch', async (t) => {
  const r = rig(t);
  const { gateway, M } = r;
  const device2 = edKeypair();
  const base = {
    pairingSessionId: gateway.pairingSessionId(), pairCode: gateway.pairingCode(), deviceName: 'T',
    devicePublicKey: device2.publicKeyRaw, clientNonce: randomBytes(32).toString('base64url'),
    serviceFingerprint: r.serviceFp, requestedScopes: ALL_SCOPES,
  };
  base.proofSignature = sign(null, Buffer.from(['remote-v1-pair', base.pairingSessionId, base.pairCode, base.deviceName, base.devicePublicKey, base.clientNonce, base.serviceFingerprint, r.M.wire.canonicalJson(base.requestedScopes)].join('\n'), 'utf8'), device2.privateKey).toString('base64url');
  // wrong fingerprint
  assert.equal(JSON.parse(gateway.pairExchange({ ...base, serviceFingerprint: 'a'.repeat(64) }).body).error.code, 'unauthorized');
  // wrong code
  assert.equal(JSON.parse(gateway.pairExchange({ ...base, pairCode: '999999' }).body).error.code, 'pairing_rejected');
  // extra field
  assert.equal(JSON.parse(gateway.pairExchange({ ...base, token: 'x' }).body).error.code, 'payload_invalid');
  // bad scope
  assert.equal(JSON.parse(gateway.pairExchange({ ...base, requestedScopes: ['shell.exec'] }).body).error.code, 'payload_invalid');
  // bad proof
  assert.equal(JSON.parse(gateway.pairExchange({ ...base, proofSignature: 'x'.repeat(86) }).body).error.code, 'unauthorized');
  // happy: real proof → registered with replayEpoch 1
  const ok = gateway.pairExchange(base);
  assert.equal(ok.status, 200);
  const res = JSON.parse(ok.body);
  assert.equal(res.replayEpoch, 1);
  assert.deepEqual(res.grantedScopes, ALL_SCOPES);
  assert.match(res.deviceId, /^device_[0-9a-f]{12}$/);
  // service-signed response verifies over remote-v1-pair-response binding
  const unsigned = { deviceId: res.deviceId, serverNonce: res.serverNonce, grantedScopes: res.grantedScopes, expiresAt: res.expiresAt, replayEpoch: res.replayEpoch };
  const msg = ['remote-v1-pair-response', base.clientNonce, M.wire.canonicalJson(unsigned)].join('\n');
  assert.equal(r.deviceCrypto.verify(r.credentials.servicePublicKey, res.serverSignature, msg), true);
  // single use
  assert.equal(JSON.parse(gateway.pairExchange({ ...base, clientNonce: randomBytes(32).toString('base64url') }).body).error.code, 'pairing_rejected');
});

test('signed operations: full happy loop with real Ed25519', async (t) => {
  const r = rig(t);
  const { client } = r;
  const projects = await client.listProjects();
  assert.equal(projects.ok, true);
  assert.deepEqual(projects.result.projects.map(p => p.projectId), [PROJECT]); // ungranted filtered
  const sessions = await client.listSessions(PROJECT);
  assert.deepEqual(sessions.result.sessions.map(s => s.sessionId), ['session-s0001']);
  const snap = await client.snapshot(CONV);
  assert.equal(snap.result.status, 'idle');
  assert.equal(snap.result.messages.length, 1);
  assert.match(snap.result.cursor, /^[A-Za-z0-9_-]{1,128}$/);
  const send = await client.sendMessage(CONV, randomUUID(), 'run the loop', snap.result.ownerRevision);
  assert.equal(send.ok, true);
  assert.equal(send.result.accepted, true);
  const approvals = await client.listApprovals(CONV);
  assert.equal(approvals.result.approvals.length, 1);
  // ownerRevision advanced again via the scripted reply; use the current one.
  const revNow = (await client.snapshot(CONV)).result.ownerRevision;
  const respond = await client.respondToApproval(CONV, 'approval-a001', 'select', 'answer', 'option-a', revNow);
  assert.equal(respond.ok, true);
  const after = await client.listApprovals(CONV);
  assert.equal(after.result.approvals.length, 0);
});

test('signed operations: tampered/epoch/replay/scope negatives stay closed', async (t) => {
  const r = rig(t);
  const { gateway } = r;
  let res;
  // tampered signature → unauthorized (pre-auth, wire closed)
  res = await gateway.send(signedOp(r, OPEN.path ? OPEN.path : '', {}, { mutate: req => { req.headers['x-pi-remote-signature'] = 'x'.repeat(86); } }));
  assert.equal((await errorOf(res)).code, 'unauthorized');
  // wrong epoch → unauthorized
  res = await gateway.send(signedOp(r, '/remote/v1/projects', {}, { mutate: req => { req.headers['x-pi-remote-epoch'] = '99'; } }));
  assert.equal((await errorOf(res)).code, 'unauthorized');
  // body digest mismatch → unauthorized
  res = await gateway.send(signedOp(r, '/remote/v1/projects', {}, { mutate: req => { req.headers['x-pi-remote-body-sha256'] = '0'.repeat(64); } }));
  assert.equal((await errorOf(res)).code, 'unauthorized');
  // unknown route → unauthorized, ZERO uuid correlation
  res = await gateway.send(signedOp(r, '/remote/v1/projects/../secret', {}));
  assert.equal(res.status, 401);
  assert.equal(JSON.parse(res.body).requestId, '00000000-0000-0000-0000-000000000000');
  // nonce replay → replay_rejected (same signed request twice)
  const once = signedOp(r, '/remote/v1/projects', {});
  assert.equal((await gateway.send(once)).status, 200);
  res = await gateway.send(once);
  assert.equal((await errorOf(res)).code, 'replay_rejected');
  // future timestamp outside skew → unauthorized
  res = await gateway.send(signedOp(r, '/remote/v1/projects', {}, { mutate: req => { req.headers['x-pi-remote-timestamp'] = String(Date.now() + 120_000); req.headers['x-pi-remote-signature'] = 'x'.repeat(86); } }));
  assert.equal((await errorOf(res)).code, 'unauthorized');
  // scope denied: register a chat-less device and try to send
  const r2 = rig(t, { scopes: ['projects.read', 'sessions.read'] });
  const out = await r2.client.sendMessage(CONV, randomUUID(), 'nope', 2);
  assert.equal(out.ok, false);
  assert.equal(out.code, 'scope_denied');
});

test('owner/grant boundaries: ungranted resource and stale revision reject', async (t) => {
  const r = rig(t);
  // grant removed → unknown_resource
  r.gateway.grantProject(r.credentials.deviceId, PROJECT, false);
  const denied = await r.client.snapshot(CONV);
  assert.equal(denied.ok, false);
  assert.equal(denied.code, 'unknown_resource');
  const projects = await r.client.listProjects();
  assert.equal(projects.result.projects.length, 0);
  r.gateway.grantProject(r.credentials.deviceId, PROJECT, true);
  // stale ownerRevision → stale_revision
  const stale = await r.client.sendMessage(CONV, randomUUID(), 'x', 999);
  assert.equal(stale.code, 'stale_revision');
});

test('idempotency: same clientMessageId replays outcome; different payload rejects', async (t) => {
  const r = rig(t);
  const clientMessageId = randomUUID();
  const rev = (await r.client.snapshot(CONV)).result.ownerRevision;
  const first = await r.client.sendMessage(CONV, clientMessageId, 'hello loop', rev);
  assert.equal(first.ok, true);
  // Retry under the CURRENT revision replays the recorded outcome.
  const revAfter = (await r.client.snapshot(CONV)).result.ownerRevision;
  const second = await r.client.sendMessage(CONV, clientMessageId, 'hello loop', revAfter);
  assert.equal(second.ok, true);
  assert.deepEqual(second.result, first.result);
  const snap = await r.client.snapshot(CONV);
  assert.equal(snap.result.messages.filter(m => m.text === 'hello loop').length, 1);
  const revNow = (await r.client.snapshot(CONV)).result.ownerRevision;
  const conflict = await r.client.sendMessage(CONV, clientMessageId, 'different text', revNow);
  assert.equal(conflict.ok, false);
  assert.equal(conflict.code, 'payload_invalid');
});

test('approvals: live dialog authority — select option check, single consume, expiry', async (t) => {
  const r = rig(t);
  const conv = CONV;
  // wrong option → payload_invalid
  const bad = await r.client.respondToApproval(conv, 'approval-a001', 'select', 'answer', 'option-zzz', 2);
  assert.equal(bad.code, 'payload_invalid');
  // method mismatch (dialog is select, request says confirm) → stale_owner
  const mis = await r.client.respondToApproval(conv, 'approval-a001', 'confirm', 'allow', undefined, 2);
  assert.equal(mis.code, 'stale_owner');
  // expired dialog → stale_owner
  r.gateway.expireApproval(conv, 'approval-a001');
  const expired = await r.client.respondToApproval(conv, 'approval-a001', 'select', 'answer', 'option-a', 2);
  assert.equal(expired.code, 'stale_owner');
  // raise a fresh approval and settle it properly
  r.gateway.raiseApproval(conv, { requestId: 'approval-b001', method: 'confirm', title: 'Allow?', message: 'go?', expiresAtMs: Date.now() + 60_000 });
  const revNow = (await r.client.snapshot(conv)).result.ownerRevision;
  const ok = await r.client.respondToApproval(conv, 'approval-b001', 'confirm', 'deny', undefined, revNow);
  assert.equal(ok.result.accepted, true);
  // already settled → stale_owner (single consume)
  const dup = await r.client.respondToApproval(conv, 'approval-b001', 'confirm', 'allow', undefined, revNow + 1);
  assert.equal(dup.code, 'stale_owner');
});

test('bounded lists: snapshot caps at 500 with truncation flag; oversized text rejected', async (t) => {
  const many = Array.from({ length: 620 }, (_, i) => ({ messageId: `message-${String(i).padStart(5, '0')}`, role: i % 2 ? 'user' : 'assistant', text: `m${i}` }));
  const r = rig(t, { overrides: { messages: many } });
  const snap = await r.client.snapshot(CONV);
  assert.equal(snap.result.messages.length, 500);
  assert.equal(snap.result.snapshotTruncated, true);
  assert.equal(snap.result.messages.at(-1).messageId, 'message-00619');
  const tooBig = await r.client.sendMessage(CONV, randomUUID(), 'x'.repeat(9000), snap.result.ownerRevision);
  assert.equal(tooBig.code, 'payload_invalid');
  // client-side bounded: store applies at most 500 messages
  await r.store.refresh(CONV);
  assert.equal(r.store.conversation(CONV).messages.length, 500);
  assert.equal(r.store.conversation(CONV).snapshotTruncated, true);
});

test('event stream: signed frames, order, scope drop, tamper drop, cursor resume + reset', async (t) => {
  const r = rig(t);
  const { events, client, store, gateway, stream } = r;
  const frames = [];
  const subEvents = [];
  const ev = new r.M.events.EventStreamClient({
    credentials: r.credentials, crypto: r.deviceCrypto,
    authorizeResource: () => true,
    onReset: () => {}, onEvent: a => { frames.push(a); store.apply(a); }, onDrop: c => subEvents.push(c),
  });
  ev.open(stream, client.buildEventsRequest(), undefined);
  const rev = (await client.snapshot(CONV)).result.ownerRevision;
  const sent = await client.sendMessage(CONV, randomUUID(), 'hi', rev);
  assert.equal(sent.ok, true);
  // user append + running + assistant reply + idle = 4 frames
  assert.deepEqual(frames.map(f => f.event), ['message.append', 'conversation.status', 'message.append', 'conversation.status'], `drops: ${JSON.stringify(subEvents)}`);
  assert.equal(store.conversation(CONV).messages.length, 2, `frames: ${JSON.stringify(frames.map(f => f.event))}`);
  assert.deepEqual(store.conversation(CONV).messages.map(m => m.role), ['user', 'assistant']);
  assert.equal(store.conversation(CONV).status, 'idle');
  // forged frame signature → dropped, no apply
  const legit = frames.at(-1);
  const forged = { protocolVersion: 1, sequence: legit.sequence + 1, conversationId: CONV, ownerRevision: legit.ownerRevision, event: 'conversation.status', payload: { status: 'error' }, streamGeneration: legit.streamGeneration, cursor: 'cur2forge', frameSignature: 'x'.repeat(86) };
  const res = ev.accept(forged);
  assert.equal(res.ok, false);
  assert.equal(res.code, 'frame_signature_invalid');
  assert.equal(store.conversation(CONV).status, 'idle');
  // sequence gap → dropped (valid signature, wrong sequence)
  const skipped = { protocolVersion: 1, sequence: legit.sequence + 7, conversationId: CONV, ownerRevision: legit.ownerRevision, event: 'conversation.status', payload: { status: 'running' }, streamGeneration: legit.streamGeneration, cursor: 'cur7gap', frameSignature: 'x'.repeat(86) };
  skipped.frameSignature = r.serviceCrypto.sign(r.M.events.buildEventFrameMessage(skipped, r.credentials.deviceId, r.credentials.serviceId));
  const gapRes = ev.accept(skipped);
  assert.equal(gapRes.code, 'sequence_gap');
  // approval frame needs approvals.read: device lacking the scope drops it
  const r2 = rig(t, { scopes: ALL_SCOPES.filter(s => s !== 'approvals.read') });
  const ev2 = new r.M.events.EventStreamClient({
    credentials: r2.credentials, crypto: r2.deviceCrypto,
    authorizeResource: () => true, onReset: () => {}, onEvent: () => {}, onDrop: () => {},
  });
  const fakeApproval = { protocolVersion: 1, sequence: 1, conversationId: CONV, ownerRevision: 2, event: 'approval.pending', payload: { requestId: 'approval-x001', method: 'confirm', title: 't', message: 'm' }, streamGeneration: 1, cursor: 'cur_a', frameSignature: '' };
  const m2 = r.M.events.buildEventFrameMessage(fakeApproval, r2.credentials.deviceId, r2.credentials.serviceId);
  fakeApproval.frameSignature = r2.serviceCrypto.sign(m2);
  assert.equal(ev2.accept(fakeApproval).code, 'scope_denied'); // signature ok, approvals.read missing
  // malformed cursor → invalid_request; stale cursor → reset frame
  const staleCursor = Buffer.from('cur:' + r.credentials.deviceId + ':999:0').toString('base64url');
  const reqStale = client.buildEventsRequest(staleCursor);
  let gotReset = null;
  const sub = gateway.subscribe(r.credentials, reqStale, f => { if (f.event === 'reset') gotReset = f; });
  assert.equal(sub.ok, true);
  assert.equal(gotReset.payload.reason, 'cursor_expired');
  sub.close();
  const bad = client.buildEventsRequest('!!!bad cursor!!!');
  const subBad = gateway.subscribe(r.credentials, bad, () => {});
  assert.equal(subBad.ok, false);
});

test('store: load maps projects/sessions/conversations; approvals flow; reset rebuilds', async (t) => {
  const r = rig(t);
  const { store } = r;
  await store.load();
  assert.equal(store.snapshot().projects.length, 1);
  assert.equal(store.snapshot().sessions.length, 1);
  assert.equal(store.conversation(CONV).loaded, true);
  assert.equal(store.conversation(CONV).approvals.length, 1);
  // apply approval.settled removes pending and marks decided
  store.apply({ event: 'approval.settled', conversationId: CONV, ownerRevision: 3, payload: { requestId: 'approval-a001', status: 'allowed' }, cursor: 'c', streamGeneration: 1, sequence: 9 });
  assert.equal(store.conversation(CONV).approvals.length, 0);
  assert.equal(store.snapshot().decided['approval-a001'], 'allowed');
  // reset → refresh baselines (conversation re-pulled)
  store.apply({ event: 'reset', conversationId: 'stream-reset', ownerRevision: 0, payload: { reason: 'cursor_expired' }, cursor: 'c2', streamGeneration: 2, sequence: 1 });
  await new Promise(r => setImmediate(r));
  assert.equal(store.conversation(CONV).loaded, true);
});

test('demo runtime: bundled synthetic pair+loop path populates the store', async (t) => {
  const M = load(t);
  const rt = M.demo.demoRuntime();
  assert.ok(rt.credentials.deviceId.startsWith('device_'));
  assert.equal(rt.credentials.replayEpoch, 1);
  await rt.store.load();
  assert.equal(rt.store.snapshot().projects.length, 2);
  assert.equal(rt.store.conversation('conversation-c001').approvals.length, 2);
  const send = await rt.store.sendMessage('conversation-c001', 'demo ping', randomUUID());
  assert.equal(send.ok, true);
  assert.ok(rt.store.conversation('conversation-c001').messages.some(m => m.text.includes('Synthetic assistant reply')));
});

function randomUUID() { const h = randomBytes(16).toString('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20)}`; }

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, createPublicKey, sign, verify, randomBytes, randomUUID } from 'node:crypto';

// Keep the build in this worktree, where the React binding can resolve React.
const require = createRequire(import.meta.url);
const out = mkdtempSync(resolve('node_modules/.piguimobile-runtime-'));
after(() => rmSync(out, { recursive: true, force: true }));
const build = spawnSync(process.execPath, [resolve('node_modules/typescript/bin/tsc'),
  '--ignoreConfig', '--module', 'commonjs', '--target', 'es2022', '--strict',
  '--noUncheckedIndexedAccess', '--esModuleInterop', '--skipLibCheck', '--outDir', out,
  'src/remote/useRemote.ts',
], { encoding: 'utf8' });
assert.equal(build.status, 0, build.stdout + build.stderr);
const { createRemoteRuntime } = require(resolve(out, 'runtime.js'));
const { TypedRemoteClient } = require(resolve(out, 'client.js'));
const { LocalSyntheticGateway } = require(resolve(out, 'sandbox.js'));
const { sha256hex } = require(resolve(out, 'wire.js'));

const PROJECT = 'project-runtime';
const CONVERSATION = 'conversation-runtime';
function keypair() {
  const keys = generateKeyPairSync('ed25519');
  const publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url');
  return {
    publicKey,
    sign: message => sign(null, Buffer.from(message), keys.privateKey).toString('base64url'),
    verify: (key, signature, message) => verify(null, Buffer.from(message), createPublicKey({
      key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(key, 'base64url')]),
      format: 'der', type: 'spki',
    }), Buffer.from(signature, 'base64url')),
    randomBytes: n => randomBytes(n).toString('base64url'),
  };
}

function rig(t, authorizeResource = () => true) {
  const service = keypair(), device = keypair();
  const conversation = {
    conversationId: CONVERSATION, sessionId: 'session-runtime', projectId: PROJECT,
    title: 'Assembly fixture', status: 'idle', owner: 'runtime:fixture', ownerRevision: 1, ownerEpoch: 1,
    messages: [], approvals: [], script: {},
  };
  const gateway = new LocalSyntheticGateway({
    projects: [{ projectId: PROJECT, displayName: 'Assembly fixture', description: 'Synthetic test data' }],
    sessions: [{ sessionId: 'session-runtime', projectId: PROJECT, displayName: 'Assembly fixture',
      updatedAt: '2026-11-22T09:00:00Z', activeConversations: [{ conversationId: CONVERSATION }] }],
    conversations: [conversation],
  }, service, { publicKey: service.publicKey, fingerprint: sha256hex(service.publicKey) });
  const credentials = gateway.registerDevice({
    devicePublicKey: device.publicKey,
    grantedScopes: ['projects.read', 'sessions.read', 'chat.send'], grants: [PROJECT],
  });
  const requests = [], subscriptions = [], signed = [];
  const controls = { failRequests: false, autoOpen: true, dropFirstReplay: false };
  const crypto = { ...device, sign: message => { signed.push(message); return device.sign(message); } };
  const client = new TypedRemoteClient({ credentials, crypto, transport: {
    send: request => {
      requests.push(request);
      if (controls.failRequests) throw new Error('synthetic unavailable');
      return gateway.send(request);
    },
  } });
  const stream = {
    subscribe(request, onFrame, onClose, onOpen) {
      const entry = { request, onFrame, onClose, onOpen, closes: 0 };
      subscriptions.push(entry);
      let delivered = 0;
      const sub = gateway.subscribe(credentials, request, frame => {
        delivered += 1;
        if (!controls.dropFirstReplay || delivered !== 1) onFrame(frame);
      });
      if (!sub.ok) {
        onClose(`status-${sub.response.status}`);
        return { close() { entry.closes += 1; } };
      }
      if (controls.autoOpen) onOpen?.();
      return { close() { entry.closes += 1; sub.close(); } };
    },
  };
  const runtime = createRemoteRuntime({ client, crypto, stream, authorizeResource });
  t.after(() => runtime.closeStream());
  const publish = text => {
    const message = { messageId: 'message-' + randomUUID(), role: 'assistant', text };
    conversation.messages.push(message);
    conversation.ownerRevision += 1;
    gateway.emit(credentials.deviceId, 'message.append', conversation, message);
  };
  return { runtime, client, credentials, requests, subscriptions, signed, controls, publish, gateway };
}

function dependencies(entry, seen = new Set()) {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  for (const child of require.cache[entry]?.children ?? []) dependencies(child.id, seen);
  return seen;
}

test('runtime assembly is cold, fixture-free and uses the supplied client identity', async t => {
  const r = rig(t);
  assert.deepEqual([r.requests.length, r.subscriptions.length, r.signed.length], [0, 0, 0]);
  const modules = [...dependencies(resolve(out, 'runtime.js'))].map(name => basename(name));
  for (const excluded of ['demo.js', 'sandbox.js', 'crypto.js', 'native.js', 'native-port.js']) {
    assert.equal(modules.includes(excluded), false, excluded);
  }
  assert.equal(r.runtime.credentials, r.credentials);
  assert.equal(r.runtime.client, r.client);
  await r.runtime.store.load();
  assert.deepEqual(r.runtime.store.snapshot().projects, [{ projectId: PROJECT, displayName: 'Assembly fixture' }]);
  assert.equal(r.runtime.store.conversation(CONVERSATION).loaded, true);
  assert.equal(r.subscriptions.length, 0, 'loading baselines does not implicitly subscribe');
});

test('app composition retains one explicitly synthetic runtime without loading a native port', async t => {
  const app = require(resolve(out, 'useRemote.js'));
  const demo = require(resolve(out, 'demo.js'));
  const runtime = app.remoteRuntime();
  t.after(() => runtime.closeStream());
  assert.equal(runtime.mode, 'synthetic');
  assert.equal(runtime, app.remoteRuntime());
  assert.equal(runtime, demo.demoRuntime());
  await runtime.store.load();
  assert.equal(runtime.store.snapshot().projects.length, 2);
  assert.equal(runtime.store.snapshot().sessions.length, 3);
  assert.equal(runtime.store.conversation('conversation-c001').approvals.length, 2);
  assert.match(runtime.store.conversation('conversation-c001').messages[0].text, /Synthetic loop/);
  const modules = [...dependencies(resolve(out, 'useRemote.js'))].map(name => basename(name));
  assert.equal(modules.includes('native.js'), false);
  assert.equal(modules.includes('native-port.js'), false);
});

test('injected request failure leaves recovery dead without substituting demo data or opening a stream', async t => {
  const r = rig(t);
  r.controls.failRequests = true;
  await r.runtime.recoverStream();
  assert.equal(r.runtime.store.snapshot().lastError, 'unavailable');
  assert.equal(r.runtime.store.snapshot().stream.state, 'dead');
  assert.deepEqual(r.runtime.store.snapshot().projects, []);
  assert.equal(r.subscriptions.length, 0);
});

test('assembly applies signed events to its store and enforces the supplied resource policy', async t => {
  let allowed = true;
  const contexts = [];
  const r = rig(t, context => { contexts.push(context); return allowed; });
  await r.runtime.store.load();
  r.runtime.openStream();
  r.publish('permitted fixture event');
  assert.equal(r.runtime.store.conversation(CONVERSATION).messages[0].text, 'permitted fixture event');
  assert.equal(contexts[0].deviceId, r.credentials.deviceId);
  assert.equal(contexts[0].serviceId, r.credentials.serviceId);
  assert.equal(contexts[0].conversationId, CONVERSATION);
  allowed = false;
  r.publish('denied fixture event');
  assert.equal(r.runtime.events.streamError(), 'unknown_resource');
  assert.equal(r.runtime.store.snapshot().stream.state, 'dead');
  assert.equal(r.runtime.store.conversation(CONVERSATION).messages.length, 1);
});

test('recovery replays the snapshot window and waits for admission; reopen carries its cursor', async t => {
  const r = rig(t);
  await r.runtime.store.load();
  r.runtime.openStream();
  const first = r.subscriptions[0];
  first.onClose('synthetic disconnect');
  assert.equal(r.runtime.store.snapshot().stream.state, 'dead');
  const snapshot = r.client.snapshot.bind(r.client);
  r.client.snapshot = async id => {
    const result = await snapshot(id);
    r.publish('arrived after the atomic snapshot');
    return result;
  };
  r.controls.autoOpen = false;
  await r.runtime.recoverStream();
  const recovered = r.subscriptions[1];
  assert.equal(first.closes, 1);
  assert.equal(recovered.request.query.cursor, r.runtime.store.latestWatermark().cursor);
  assert.equal(r.runtime.store.conversation(CONVERSATION).messages[0].text, 'arrived after the atomic snapshot');
  assert.equal(r.runtime.events.expectedPosition().sequence, r.runtime.store.latestWatermark().sequence);
  assert.equal(r.runtime.store.snapshot().stream.state, 'recovering', 'task creation is not admission');
  recovered.onOpen();
  first.onClose('stale callback');
  assert.equal(r.runtime.store.snapshot().stream.state, 'live');
  const cursor = r.runtime.events.latestCursor();
  r.runtime.reopenStream();
  assert.equal(recovered.closes, 1);
  assert.equal(r.subscriptions[2].request.query.cursor, cursor);
  assert.notEqual(r.subscriptions[2].request.headers['x-pi-remote-nonce'], recovered.request.headers['x-pi-remote-nonce']);
  r.runtime.closeStream();
  r.runtime.closeStream();
  assert.equal(r.subscriptions[2].closes, 1);
});

test('assembly forwards the atomic position so losing the first replayed frame is terminal', async t => {
  const r = rig(t);
  const snapshot = r.client.snapshot.bind(r.client);
  r.client.snapshot = async id => {
    const result = await snapshot(id);
    r.publish('dropped first replay');
    r.publish('second replay must reveal the gap');
    return result;
  };
  r.controls.dropFirstReplay = true;
  await r.runtime.recoverStream();
  assert.equal(r.runtime.events.streamError(), 'sequence_gap');
  assert.equal(r.runtime.store.snapshot().stream.state, 'dead');
  assert.deepEqual(r.runtime.store.conversation(CONVERSATION).messages, []);
});

test('reset callbacks still rebuild the store baseline through the assembled event path', async t => {
  const r = rig(t);
  await r.runtime.store.load();
  r.runtime.openStream();
  r.publish('before disconnect');
  r.runtime.closeStream();
  r.publish('missed before authorization transition');
  r.gateway.rollOwnerEpoch(CONVERSATION);
  r.runtime.reopenStream();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(r.runtime.events.streamError(), undefined);
  assert.deepEqual(r.runtime.store.conversation(CONVERSATION).messages.map(message => message.text), [
    'before disconnect', 'missed before authorization transition',
  ]);
});

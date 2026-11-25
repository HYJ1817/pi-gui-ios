import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, createPublicKey, sign, verify, randomBytes } from 'node:crypto';

const require = createRequire(import.meta.url);
const out = mkdtempSync(resolve(tmpdir(), 'piguimobile-m5-ts-'));
process.on('exit', () => rmSync(out, { recursive: true, force: true }));
const build = spawnSync(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '--ignoreConfig', '--module', 'commonjs', '--target', 'es2022', '--strict', '--noUncheckedIndexedAccess', '--esModuleInterop', '--skipLibCheck', '--outDir', out,
  ...['types', 'wire', 'client', 'events', 'transport-policy', 'native-port'].map(f => `src/remote/${f}.ts`)], { encoding: 'utf8' });
assert.equal(build.status, 0, build.stdout + build.stderr);
const P = require(resolve(out, 'transport-policy.js'));
const N = require(resolve(out, 'native-port.js'));
const { EventStreamClient } = require(resolve(out, 'events.js'));
const { canonicalJson, sha256hex } = require(resolve(out, 'wire.js'));
const HANDLE = 'a0fa0fa0-1111-4111-8111-111111111111';
const kp = generateKeyPairSync('ed25519');
const pub = kp.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url');
const credentials = () => ({ deviceId: 'device-native-test', devicePublicKey: pub, grantedScopes: [...P.SCOPES], replayEpoch: 1,
  expiresAt: new Date(Date.now() + 3600000).toISOString(), serviceFingerprint: 'a'.repeat(64), serviceId: 'svc-' + 'a'.repeat(16), servicePublicKey: pub });
function port() {
  const listeners = new Map(); const calls = [];
  const p = {
    calls,
    preparePairing: (...args) => { calls.push(['prepare', ...args]); return JSON.stringify({ handle: HANDLE, devicePublicKey: pub, expiresAt: new Date(Date.now() + 60000).toISOString() }); },
    exchangePairing: async () => JSON.stringify({ ok: true, credentials: credentials() }),
    activate: () => { calls.push(['activate']); return JSON.stringify(credentials()); },
    deactivate: () => calls.push(['deactivate']), forget: () => calls.push(['forget']),
    sign: (_handle, message) => sign(null, Buffer.from(message), kp.privateKey).toString('base64url'),
    verify: (key, signature, message) => verify(null, Buffer.from(message), createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(key, 'base64url')]), format: 'der', type: 'spki' }), Buffer.from(signature, 'base64url')),
    randomBytes: n => randomBytes(n).toString('base64url'),
    send: async (_handle, req) => { calls.push(['send', JSON.parse(req)]); const r = JSON.parse(req); return JSON.stringify({ status: 200, body: JSON.stringify({ protocolVersion: 1, requestId: r.headers['x-pi-remote-request-id'], operation: 'projects.list', serverRevision: 1, result: { projects: [], registryRevision: 1 } }) }); },
    subscribe: (_handle, id, req) => calls.push(['subscribe', id, JSON.parse(req)]),
    closeStream: id => calls.push(['close', id]), acknowledgeFrame: id => calls.push(['ack', id]),
    addListener: (name, fn) => { let set = listeners.get(name); if (!set) listeners.set(name, set = new Set()); set.add(fn); return { remove: () => set.delete(fn) }; },
    emit: (name, value) => { for (const f of [...(listeners.get(name) ?? [])]) f(value); },
    listenerCount: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
  }; return p;
}
const bootstrap = () => ({ protocolVersion: 1, endpoint: 'https://desktop.tail-example.ts.net:7789', serviceFingerprint: 'a'.repeat(64), servicePublicKey: pub,
  pairingSessionId: randomBytes(16).toString('base64url'), pairCode: '123456', expiresAt: new Date(Date.now() + 60000).toISOString() });

test('M5 accepts only tailnet origins and rejects URL canonicalization escapes', () => {
  for (const s of ['https://100.64.0.1:7789', 'https://100.127.255.255', 'https://[fd7a:115c:a1e0::1]', 'https://desktop.tail-example.ts.net']) assert.ok(P.validateEndpoint(s));
  for (const s of ['http://100.64.0.1', 'https://127.0.0.1', 'https://192.168.1.2', 'https://example.com', 'https://foo.ts.net', 'https://100.63.0.1', 'https://100.128.0.1', 'https://100.064.0.1', 'https://100.64.0.1/api', 'https://a.tail.ts.net?x', 'https://a.tail.ts.net#', 'https://u:p@a.tail.ts.net', 'https://a.tail.ts.net:0', 'https://[fd7a:115c:a1e0:::1]']) assert.throws(() => P.validateEndpoint(s), { code: 'invalid_request' });
});
test('M5 trusted bootstrap is closed, short-lived and strictly calendar-valid', () => {
  assert.equal(P.validateBootstrap(bootstrap()).endpoint, bootstrap().endpoint);
  for (const patch of [{ protocolVersion: 2 }, { extra: true }, { pairCode: '12345' }, { servicePublicKey: 'A'.repeat(42) + 'B' }, { expiresAt: '2099-02-30T00:00:00Z' }, { expiresAt: new Date(Date.now() + 121000).toISOString() }]) assert.throws(() => P.validateBootstrap({ ...bootstrap(), ...patch }));
  const now = Date.parse('2026-01-01T00:00:00Z');
  assert.equal(P.strictFutureInstant('2099-01-01T00:00:00.12Z', now), true);
  assert.equal(P.strictFutureInstant('2099-02-30T00:00:00Z', now), false);
});
test('M5 is offline by default; activation never returns key material', () => {
  const p = port(); assert.throws(() => N.createNativeRemote(p, HANDLE), { code: 'disabled' }); assert.deepEqual(p.calls, []);
  const r = N.createNativeRemote(p, HANDLE, true); assert.equal(r.credentials.devicePublicKey, pub);
  assert.equal(JSON.stringify(r.credentials).includes('PRIVATE'), false); r.close(); r.close(); assert.equal(p.calls.filter(c => c[0] === 'deactivate').length, 1);
});
test('M5 refuses malformed or expired native metadata and deactivates atomically', () => {
  for (const patch of [{ serviceId: 'svc-wrong' }, { replayEpoch: true }, { expiresAt: '2020-01-01T00:00:00Z' }, { extra: 'forbidden' }]) {
    const p = port(); p.activate = () => JSON.stringify({ ...credentials(), ...patch });
    assert.throws(() => N.createNativeRemote(p, HANDLE, true), { code: 'pairing_required' }); assert.deepEqual(p.calls, [['deactivate']]);
  }
});
test('M5 signs real Ed25519 closed requests and does not rewrite canonical body bytes', async () => {
  const p = port(); const r = N.createNativeRemote(p, HANDLE, true);
  const got = await r.client.listProjects(); assert.equal(got.ok, true);
  const request = p.calls.find(c => c[0] === 'send')[1]; P.validateTransportRequest(request, false);
  assert.equal(request.headers['x-pi-remote-body-sha256'], sha256hex(''));
  const h = request.headers;
  const message = ['1', h['x-pi-remote-device'], r.credentials.serviceId, h['x-pi-remote-epoch'], h['x-pi-remote-request-id'], request.method, request.path, h['x-pi-remote-timestamp'], h['x-pi-remote-nonce'], h['x-pi-remote-body-sha256']].join('\n');
  assert.equal(p.verify(pub, h['x-pi-remote-signature'], message), true);
  for (const patch of [{ path: '/api/projects' }, { path: '//evil.invalid' }, { query: { x: 'anything' } }, { rawBody: 'bad' }, { headers: { ...h, authorization: 'forbidden' } }]) assert.throws(() => P.validateTransportRequest({ ...request, ...patch }, false));
  r.close();
});
test('M5 pairing entry validates local QR data without touching raw secrets', async () => {
  const p = port(); const draft = N.prepareNativePairing(p, bootstrap(), 'Synthetic phone');
  assert.equal(draft.handle, HANDLE); assert.equal((await N.exchangeNativePairing(p, HANDLE)).ok, true);
  assert.throws(() => N.prepareNativePairing(p, bootstrap(), 'bad\nname'));
  p.exchangePairing = async () => { throw new Error('SYNTHETIC_PRIVATE_NATIVE_ERROR'); };
  assert.deepEqual(await N.exchangeNativePairing(p, HANDLE), { ok: false, code: 'transport_unavailable', retryable: false });
});
test('M5 stream waits for admission, isolates subscription IDs and bounds delivery acknowledgements', () => {
  const p = port(); const r = N.createNativeRemote(p, HANDLE, true); const frames = []; const closes = []; let opened = 0;
  const sub = r.stream.subscribe(r.client.buildEventsRequest(), f => frames.push(f), c => closes.push(c), () => opened++);
  const id = p.calls.find(c => c[0] === 'subscribe')[1]; assert.equal(opened, 0);
  p.emit('remoteOpened', { subscriptionId: 'foreign' }); assert.equal(opened, 0);
  p.emit('remoteOpened', { subscriptionId: id }); assert.equal(opened, 1);
  p.emit('remoteFrame', { subscriptionId: id, frame: '{"event":"reset"}' }); assert.equal(frames.length, 1); assert.equal(p.calls.filter(c => c[0] === 'ack').length, 1);
  sub.close(); p.emit('remoteFrame', { subscriptionId: id, frame: '{}' }); assert.equal(frames.length, 1); assert.equal(p.listenerCount(), 0); assert.deepEqual(closes, []); r.close();
});
test('M5 stream malformed/oversize data closes once and never reaches application state', () => {
  for (const frame of ['invalid JSON', 'x'.repeat(65537)]) {
    const p = port(); const r = N.createNativeRemote(p, HANDLE, true); let applied = 0, closed = 0;
    r.stream.subscribe(r.client.buildEventsRequest(), () => applied++, () => closed++);
    const id = p.calls.find(c => c[0] === 'subscribe')[1];
    p.emit('remoteFrame', { subscriptionId: id, frame }); p.emit('remoteClosed', { subscriptionId: id, code: 'SYNTHETIC_PRIVATE_NATIVE_ERROR' });
    assert.equal(applied, 0); assert.equal(closed, 1); assert.equal(p.listenerCount(), 0); r.close();
  }
});
test('M5 closes active subscriptions on disable, caps stream count and ignores stale callbacks', () => {
  const p = port(); const r = N.createNativeRemote(p, HANDLE, true);
  r.stream.subscribe(r.client.buildEventsRequest(), () => {}, () => {}); r.stream.subscribe(r.client.buildEventsRequest(), () => {}, () => {});
  assert.throws(() => r.stream.subscribe(r.client.buildEventsRequest(), () => {}, () => {}), { code: 'capacity_exceeded' });
  r.close(); assert.equal(p.listenerCount(), 0); assert.throws(() => r.crypto.randomBytes(16), { code: 'disabled' });
});
test('M5 atomic snapshot position detects a missing FIRST replay frame; rejected admission never reports connected', () => {
  const p = port(); const r = N.createNativeRemote(p, HANDLE, true); let deaths = 0, connected = 0, applied = 0;
  const events = new EventStreamClient({ credentials: r.credentials, crypto: r.crypto, authorizeResource: () => true, onReset: () => {}, onEvent: () => applied++, onStreamError: () => deaths++, onConnected: () => connected++ });
  let emit;
  const transport = { subscribe: (_req, onFrame) => { emit = onFrame; return { close() {} }; } };
  events.open(transport, r.client.buildEventsRequest('opaque'), 'opaque', { generation: 3, sequence: 4 });
  const frame = { protocolVersion: 1, sequence: 5, conversationId: 'conversation-native', ownerRevision: 1, event: 'conversation.status', payload: { status: 'running' }, streamGeneration: 3, cursor: 'opaque5', frameSignature: '' };
  const digest = sha256hex(canonicalJson(frame.payload));
  const message = ['1', r.credentials.deviceId, r.credentials.serviceId, '3', '5', frame.conversationId, '1', frame.cursor, frame.event, digest].join('\n');
  frame.frameSignature = p.sign(HANDLE, message); emit(frame);
  assert.equal(deaths, 1); assert.equal(applied, 0); assert.equal(events.streamError(), 'sequence_gap');
  events.open({ subscribe: (_r, _f, onClose) => { onClose('private error'); return { close() {} }; } }, r.client.buildEventsRequest());
  assert.equal(connected, 0); assert.equal(events.streamError(), 'stream_closed');
  const stale = emit; events.close(); stale(frame); assert.equal(applied, 0); r.close();
});

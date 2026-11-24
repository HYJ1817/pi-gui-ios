/**
 * Bundled synthetic remote loop — the app's offline data source.
 *
 * The UI drives the REAL typed client, store and event stream end to end;
 * only the transport is in-process (LocalSyntheticGateway) and the signature
 * material is deterministic SyntheticCryptoProvider material. Pairing still
 * goes through the contract-shaped pair.exchange, so what the UI shows is the
 * same surface a production session will show — clearly labeled "Synthetic".
 * No real desktop, no secrets, no network.
 */
import { SyntheticCryptoProvider, syntheticGatewayCrypto, syntheticIdentity } from './crypto';
import { LocalSyntheticGateway, syntheticServiceMaterial, type SandboxDomain } from './sandbox';
import { TypedRemoteClient } from './client';
import { EventStreamClient, type StreamTransport } from './events';
import { ConversationStore } from './store';
import { canonicalJson } from './wire';
import type { DeviceCredentials, EventEnvelope, SignedRequest } from './types';

export interface DemoRuntime {
  gateway: LocalSyntheticGateway;
  client: TypedRemoteClient;
  events: EventStreamClient;
  store: ConversationStore;
  credentials: DeviceCredentials;
  /** open the device-level event stream (with optional resume cursor) */
  openStream: () => void;
  /** close + reopen (resubscribe path) */
  reopenStream: () => void;
  closeStream: () => void;
}

const LONG_MESSAGE =
  'This is a deliberately long synthetic assistant message (bounded transcript, max 8192 serialized bytes) exercising M3 rendering of long content: '.repeat(40) +
  'END-OF-LONG-MESSAGE';

function demoDomain(): SandboxDomain {
  const projectA = 'project-a0001';
  const projectB = 'project-b0002';
  const conv1 = 'conversation-c001';
  const conv2 = 'conversation-c002';
  const conv3 = 'conversation-c003';
  return {
    projects: [
      { projectId: projectA, displayName: 'Pi GUI Mobile', description: 'Native iOS client shell' },
      { projectId: projectB, displayName: 'Reference Desktop', description: 'T3 / pi-gui reference codebase' },
    ],
    sessions: [
      { sessionId: 'session-s0001', projectId: projectA, displayName: 'App shell layout', updatedAt: '2026-11-22T09:00:00Z', activeConversations: [{ conversationId: conv1 }] },
      { sessionId: 'session-s0002', projectId: projectA, displayName: 'Theme tokens', updatedAt: '2026-11-22T08:30:00Z', activeConversations: [{ conversationId: conv2 }] },
      { sessionId: 'session-s0003', projectId: projectB, displayName: 'Protocol study', updatedAt: '2026-11-21T16:00:00Z', activeConversations: [{ conversationId: conv3 }] },
    ],
    conversations: [
      {
        conversationId: conv1, sessionId: 'session-s0001', projectId: projectA, title: 'App shell layout',
        status: 'idle', owner: 'runtime:synthetic:conv1', ownerRevision: 3, ownerEpoch: 1,
        messages: [
          { messageId: 'message-m0001', role: 'assistant', text: 'Synthetic loop online — every screen is driven through the typed remote client and signed synthetic gateway.' },
          { messageId: 'message-m0002', role: 'user', text: 'Show the M3 core loop: sessions, messages, approvals.' },
          { messageId: 'message-m0003', role: 'assistant', text: 'Projects, sessions, snapshots, approvals and event frames all flow over remote/v1 semantics.' },
          { messageId: 'message-m0004', role: 'assistant', text: LONG_MESSAGE },
        ],
        approvals: [
          {
            requestId: 'approval-a001', conversationId: conv1, method: 'confirm',
            title: 'Run a tool', message: 'A synthetic tool wants permission to run. Desktop approval authority is preserved.',
            pending: true, expiresAtMs: Date.now() + 600_000, owner: 'runtime:synthetic:conv1', revision: 3,
          },
          {
            requestId: 'approval-a002', conversationId: conv1, method: 'select',
            title: 'Choose an option', message: 'Pick one of the offered options (synthetic).',
            options: [{ optionId: 'option-a0001', label: 'Option A' }, { optionId: 'option-b0002', label: 'Option B' }],
            pending: true, expiresAtMs: Date.now() + 600_000, owner: 'runtime:synthetic:conv1', revision: 3,
          },
        ],
        script: { afterSend: { text: 'Synthetic assistant reply — sent through the same event frames a real run emits.' } },
      },
      {
        conversationId: conv2, sessionId: 'session-s0002', projectId: projectA, title: 'Theme tokens',
        status: 'idle', owner: 'runtime:synthetic:conv2', ownerRevision: 1, ownerEpoch: 1,
        messages: [
          { messageId: 'message-m0005', role: 'user', text: 'Theme tokens for light and dark?' },
          { messageId: 'message-m0006', role: 'assistant', text: 'Both palettes live in src/design/tokens.ts with WCAG-checked contrast.' },
        ],
        approvals: [
          {
            requestId: 'approval-a003', conversationId: conv2, method: 'input',
            title: 'Provide a value', message: 'A synthetic dialog asks for text input.',
            pending: true, expiresAtMs: Date.now() + 600_000, owner: 'runtime:synthetic:conv2', revision: 1,
          },
        ],
        script: { afterSend: { text: 'Noted (synthetic).' } },
      },
      {
        conversationId: conv3, sessionId: 'session-s0003', projectId: projectB, title: 'Protocol study',
        status: 'idle', owner: 'runtime:synthetic:conv3', ownerRevision: 1, ownerEpoch: 1,
        messages: [{ messageId: 'message-m0007', role: 'assistant', text: 'Frozen remote/v1 contract: 8 operations + device event stream.' }],
        approvals: [],
        script: {},
      },
    ],
  };
}

let runtime: DemoRuntime | null = null;

export function demoRuntime(): DemoRuntime {
  if (runtime) return runtime;
  const seed = 'pi-gui-mobile-demo-v1';
  const service = syntheticServiceMaterial(seed);
  const gatewayCrypto = syntheticGatewayCrypto(service.publicKey);
  const gateway = new LocalSyntheticGateway(demoDomain(), gatewayCrypto, service);

  const deviceCrypto = new SyntheticCryptoProvider(syntheticIdentity('demo-device'));
  const clientNonce = b64urlLike(deviceCrypto.randomBytes(32));
  // Contract-shaped pair.exchange through the same request builder.
  const unsigned = new TypedRemoteClient({
    credentials: {
      deviceId: 'device_pending', devicePublicKey: deviceCrypto.identity.publicKey, grantedScopes: [],
      replayEpoch: 1, expiresAt: '', serviceFingerprint: service.fingerprint, serviceId: 'svc-' + service.fingerprint.slice(0, 16), servicePublicKey: service.publicKey,
    },
    crypto: deviceCrypto,
    transport: { send: async () => ({ status: 500, body: '{}' }) },
  }).buildPairRequest({
    pairingSessionId: gateway.pairingSessionId(),
    pairCode: gateway.pairingCode(),
    deviceName: 'Synthetic iPhone',
    devicePublicKey: deviceCrypto.identity.publicKey,
    clientNonce,
    serviceFingerprint: service.fingerprint,
    proofSignature: deviceCrypto.sign([
      'remote-v1-pair', gateway.pairingSessionId(), gateway.pairingCode(), 'Synthetic iPhone',
      deviceCrypto.identity.publicKey, clientNonce, service.fingerprint,
      canonicalJson(['projects.read', 'sessions.read', 'sessions.create', 'approvals.read', 'chat.send', 'chat.stop', 'approvals.respond']),
    ].join('\n')),
    requestedScopes: ['projects.read', 'sessions.read', 'sessions.create', 'approvals.read', 'chat.send', 'chat.stop', 'approvals.respond'],
  });
  const pairResponse = gateway.pairExchange(JSON.parse(unsigned.rawBody));
  if (pairResponse.status !== 200) throw new Error('synthetic pair exchange failed');
  const granted = JSON.parse(pairResponse.body) as Record<string, unknown>;
  const requested = ['projects.read', 'sessions.read', 'sessions.create', 'approvals.read', 'chat.send', 'chat.stop', 'approvals.respond'];
  // Contract-shaped client verification of the service-signed pair response:
  // schema keys, pinned service signature, non-expired grant and EXACT scope
  // parity with the signed requestedScopes.
  const pairValid = (() => {
    if (Object.keys(granted).sort().join(',') !== 'deviceId,expiresAt,grantedScopes,replayEpoch,serverNonce,serverSignature') return false;
    if (typeof granted.deviceId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(granted.deviceId)) return false;
    if (typeof granted.serverNonce !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(granted.serverNonce)) return false;
    if (typeof granted.serverSignature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(granted.serverSignature)) return false;
    if (!Number.isSafeInteger(granted.replayEpoch) || (granted.replayEpoch as number) < 1) return false;
    if (typeof granted.expiresAt !== 'string' || !Number.isFinite(Date.parse(granted.expiresAt)) || Date.parse(granted.expiresAt) <= Date.now()) return false;
    const scopes = granted.grantedScopes;
    if (!Array.isArray(scopes) || scopes.length !== requested.length || new Set(scopes).size !== scopes.length
      || !requested.every(s => scopes.includes(s))) return false;
    const unsignedResponse = { deviceId: granted.deviceId, serverNonce: granted.serverNonce, grantedScopes: scopes, expiresAt: granted.expiresAt, replayEpoch: granted.replayEpoch };
    const verifyMessage = ['remote-v1-pair-response', clientNonce, canonicalJson(unsignedResponse)].join('\n');
    return deviceCrypto.verify(service.publicKey, String(granted.serverSignature), verifyMessage);
  })();
  if (!pairValid) throw new Error('synthetic pair response invalid');
  const credentials: DeviceCredentials = {
    deviceId: String(granted.deviceId), devicePublicKey: deviceCrypto.identity.publicKey,
    grantedScopes: granted.grantedScopes as DeviceCredentials['grantedScopes'],
    replayEpoch: Number(granted.replayEpoch), expiresAt: String(granted.expiresAt),
    serviceFingerprint: service.fingerprint, serviceId: 'svc-' + service.fingerprint.slice(0, 16), servicePublicKey: service.publicKey,
  };

  const client = new TypedRemoteClient({
    credentials,
    crypto: deviceCrypto,
    transport: { send: req => gateway.send(req) },
  });

  let storeRef: ConversationStore | null = null;
  const events = new EventStreamClient({
    credentials,
    crypto: deviceCrypto,
    authorizeResource: ctx => {
      // Resource authorization mirror: the sandbox grants everything it owns;
      // a revoked/ungranted projection would answer false here.
      return ctx.conversationId.startsWith('conversation-') || ctx.conversationId.startsWith('conv_');
    },
    onReset: () => { /* reset applied event already rebuilt baselines via store.apply */ },
    onEvent: applied => { storeRef?.apply(applied); },
  });

  const store = new ConversationStore(client, events);
  storeRef = store;

  const streamTransport: StreamTransport = {
    subscribe: (request: SignedRequest, onFrame: (frame: unknown) => void, onClose: (reason: string) => void) => {
      const sub = gateway.subscribe(credentials, request, onFrame as (f: EventEnvelope) => void);
      if (!sub.ok) { onClose(`status-${sub.response.status}`); return { close: () => {} }; }
      return sub;
    },
  };

  runtime = {
    gateway, client, events, store, credentials,
    openStream: () => {
      events.open(streamTransport, client.buildEventsRequest(events.latestCursor()), events.latestCursor());
    },
    /** close + reopen, exercising the resubscribe path. */
    reopenStream: () => {
      events.close();
      events.open(streamTransport, client.buildEventsRequest(events.latestCursor()), events.latestCursor());
    },
    closeStream: () => events.close(),
  };

  runtime.openStream();
  return runtime;
}

function b64urlLike(text: string): string { return text.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

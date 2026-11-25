/**
 * Local synthetic remote/v1 gateway — an in-app sandbox mirroring the frozen
 * contract's semantics so the typed client exercises the REAL code path
 * (signed request → transport → closed envelope → validated result) without
 * any network. It is not the desktop: it is a deterministic fixture whose
 * admission/order rules follow the same contract, and it exists ONLY as the
 * app's offline data source and as the Node test double.
 *
 * Signed requests are still verified (headers, canonical body digest, path
 * params, scope, replay, owner) before dispatch — a malformed or unauthorized
 * request gets the closed wire error, never a dispatch.
 */
import type {
  ApprovalDecision, ApprovalMethod, ConversationStatus, DeviceCredentials,
  EventEnvelope, RemoteApproval, RemoteMessage, RemoteProject, RemoteSession, Scope, SignedRequest,
} from './types';
import { OPERATIONS } from './client';
import { b64urlEncode, canonicalJson, hasForbiddenKey, hasForbiddenValue, isUuid, serializedJsonBytes, sha256hex, utf8Bytes } from './wire';
import { buildEventFrameMessage } from './events';

export interface SandboxProject extends RemoteProject { description: string }
export interface SandboxApproval extends RemoteApproval {
  conversationId: string;
  pending: boolean;
  /** ms epoch; expired pendings reject respond with stale_owner (desktop keeps approval authority) */
  expiresAtMs: number;
  owner: string;
  revision: number;
}
export interface SandboxConversation {
  conversationId: string;
  sessionId: string;
  projectId: string;
  title: string;
  status: ConversationStatus;
  owner: string;
  ownerRevision: number;
  ownerEpoch: number;
  messages: RemoteMessage[];
  approvals: SandboxApproval[];
  script: { afterSend?: { text: string; chunks?: number } };
}
export interface SandboxDomain {
  projects: SandboxProject[];
  sessions: RemoteSession[];
  conversations: SandboxConversation[];
}

interface MutationRecord { payloadSha256: string; outcome: Record<string, unknown>; ownerEpoch: number }
const MAX_MUTATIONS = 4096;
interface DeviceRecord {
  deviceId: string; devicePublicKey: string; grantedScopes: Scope[]; grants: Record<string, true>;
  active: boolean; revoked: boolean; replayEpoch: number; expiresAt: string;
}
// ADR-0010: aligned with the reference event-stream semantics — a shared
// per-device backlog of unsigned templates; every subscription owns an
// ISOLATED (generation, cursor) space; backlog overflow advances the
// device epoch so a resumed client hits the reset path instead of a gap.
interface StreamState { epoch: number; journalSeq: number; journal: JournalEntry[]; bytes: number }
interface JournalEntry { seq: number; event: EventEnvelope['event']; conversationId: string; ownerRevision: number; payload: Record<string, unknown>; size: number; at: number }
interface Subscription {
  deviceId: string; generation: number; lastSeq: number;
  onFrame: (frame: EventEnvelope) => void;
}
// Fault injection (ADR-0010 D5): test-only hooking of the delivery path.
export interface FaultInjection {
  /** Drop every nth frame per device (1-based count). */
  dropEvery?: number;
  /** Deliver each frame twice. */
  duplicate?: boolean;
  /** Buffer frames and flush them in reverse order after N accumulated. */
  reorderAfter?: number;
}
const MAX_BACKLOG_BYTES = 1048576;
const MAX_BACKLOG_AGE_MS = 300_000;
const CURSOR_RE = /^g([0-9]+)_s([0-9]+)_([A-Za-z0-9_-]{22})$/;

/** Gateway crypto: verify checks device-signed request signatures;
 * sign produces service-signed frames/pair responses with the service key. */
export interface GatewayCrypto {
  verify(publicKeyRaw: string, signature: string, message: string): boolean;
  sign(message: string): string;
}

const ZERO_ID = '00000000-0000-0000-0000-000000000000';
const REQUIRED_HEADERS = ['x-pi-remote-device', 'x-pi-remote-epoch', 'x-pi-remote-request-id', 'x-pi-remote-timestamp', 'x-pi-remote-nonce', 'x-pi-remote-body-sha256', 'x-pi-remote-signature'];
const ALLOWED_HEADERS = new Set([...REQUIRED_HEADERS, 'content-type', 'accept']);
const MAX_BACKLOG = 256;
const MAX_SNAPSHOT = 500;
const MAX_SESSIONS = 200;
const MAX_APPROVALS = 100;
const MAX_REQUEST_BYTES = 262144;
const MAX_FRAME_BYTES = 65536;
const MAX_NONCES = 4096;
const NONCE_RETENTION_MS = 180_000;
const MAX_STREAMS_PER_DEVICE = 2;
const MAX_STREAMS_TOTAL = 8;
const TIMESTAMP_MS = /^[0-9]{13}$/;
const NONCE_B64URL = /^[A-Za-z0-9_-]{43}$/;
const BODY_SHA256 = /^[0-9a-f]{64}$/;
const DEVICE_ID = /^[A-Za-z0-9_-]{8,128}$/;
const EVENTS_OPERATION = { id: 'events.subscribe', method: 'GET' as const, path: '/remote/v1/events', scope: 'sessions.read' as Scope };
const EVENT_SCOPES: Partial<Record<EventEnvelope['event'], Scope>> = { 'approval.pending': 'approvals.read', 'approval.settled': 'approvals.read' };

export class LocalSyntheticGateway {
  readonly serviceFingerprint: string;
  readonly serviceId: string;
  readonly servicePublicKey: string;
  private readonly crypto: GatewayCrypto;
  /** Test-visible authoritative server state (synthetic loop only). */
  readonly domain: SandboxDomain;
  private devices = new Map<string, DeviceRecord>();
  private streams = new Map<string, StreamState>();
  private nonces = new Map<string, Map<string, number>>();
  private acceptedFloor = new Map<string, number>();
  private mutations = new Map<string, MutationRecord>();
  private subscriptions: Subscription[] = [];
  private generationCounter = 0;
  private cursorKey = '';
  private incarnationSalt = '';
  private pairConsumed = false;
  private pairAttempts = 0;
  private readonly pairExpiresAtMs = Date.now() + 10 * 60_000;

  constructor(domain: SandboxDomain, crypto: GatewayCrypto, serviceMaterial: { fingerprint: string; publicKey: string }) {
    this.domain = domain;
    this.crypto = crypto;
    // Keyed cursor MAC (independent-review finding 4): the tag incorporates
    // the service key material — an unkeyed digest over public inputs let any
    // party mint valid cursors from scratch. The synthetic threat model uses
    // the public key as key stand-in; the real desktop server must use a
    // secret MAC key (documented in ADR-0010 D2).
    this.cursorKey = serviceMaterial.publicKey;
    // Per-incarnation salt (independent-review finding 2): generations and
    // journal sequences restart at the same values in a fresh incarnation, so
    // an unsalted tag would validate a pre-restart cursor against the new
    // journal — resuming with silent loss and no reset. Binding the salt into
    // the tag makes pre-restart cursors foreign → exactly-one-reset rebuild.
    this.incarnationSalt = sha256hex(`incarnation:${serviceMaterial.fingerprint}:${Date.now()}:${Math.random()}`);
    this.serviceFingerprint = serviceMaterial.fingerprint;
    this.servicePublicKey = serviceMaterial.publicKey;
    this.serviceId = 'svc-' + serviceMaterial.fingerprint.slice(0, 16);
  }

  // ---- pairing ------------------------------------------------------------------

  pairingCode(): string { return '042817'; }
  pairingSessionId(): string { return 'pairing-demo0000000000'; }

  private recordMutation(key: string, record: MutationRecord): void {
    // Contract idempotency.evictionRule: outcomes are NEVER evicted while the
    // owner epoch is live; capacity overflow refuses NEW mutations (checked
    // at the mutation sites) instead of evicting — replay integrity holds.
    this.mutations.set(key, record);
  }

  /**
   * Synthetic pair.exchange — mirrors the contract: shape check, short-lived
   * single-use code, service fingerprint match, atomic registration with a
   * minted replayEpoch, and a service-signed response over
   * 'remote-v1-pair-response' + clientNonce + canonical unsigned response.
   * The desktop confirmation step is substituted by the sandbox fixture.
   */
  pairExchange(body: Record<string, unknown>): { status: number; body: string } {
    const fail = (code: string) => ({ status: code === 'unauthorized' ? 401 : 400, body: canonicalJson({ protocolVersion: 1, requestId: ZERO_ID, error: { code, retryable: false } })! });
    if (!body || typeof body !== 'object' || Array.isArray(body) || hasForbiddenKey(body)) return fail('payload_invalid');
    const required = ['pairingSessionId', 'pairCode', 'deviceName', 'devicePublicKey', 'clientNonce', 'serviceFingerprint', 'proofSignature', 'requestedScopes'];
    if (!required.every(k => k in body) || Object.keys(body).some(k => !required.includes(k))) return fail('payload_invalid');
    if (typeof body.pairingSessionId !== 'string' || body.pairingSessionId !== this.pairingSessionId() || Date.now() > this.pairExpiresAtMs) return fail('pairing_expired');
    // Per-session attempt budget: exhausted attempts reject even a correct
    // code (guessing consumes the session budget).
    this.pairAttempts += 1;
    if (this.pairAttempts > 8) return fail('pairing_rejected');
    if (typeof body.pairCode !== 'string' || !/^[0-9]{6}$/.test(body.pairCode)) return fail('payload_invalid');
    if (typeof body.deviceName !== 'string' || !body.deviceName.length || body.deviceName.length > 48) return fail('payload_invalid');
    if (typeof body.devicePublicKey !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.devicePublicKey)) return fail('payload_invalid');
    if (typeof body.clientNonce !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.clientNonce)) return fail('payload_invalid');
    if (body.serviceFingerprint !== this.serviceFingerprint) return fail('unauthorized');
    if (typeof body.proofSignature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(body.proofSignature)) return fail('unauthorized');
    const scopes = body.requestedScopes;
    if (!Array.isArray(scopes) || scopes.length < 2 || scopes.length > 7 || new Set(scopes).size !== scopes.length
      || scopes.some(s => !['projects.read', 'sessions.read', 'sessions.create', 'approvals.read', 'chat.send', 'chat.stop', 'approvals.respond'].includes(String(s)))) return fail('payload_invalid');
    // Device-key PROOF is verified BEFORE the pair code (contract order): an
    // attacker without the private key cannot use the correct/wrong-code
    // distinction as a guessing oracle.
    const proofFields: Record<string, unknown> = {
      pairingSessionId: body.pairingSessionId, pairCode: body.pairCode, deviceName: body.deviceName,
      devicePublicKey: body.devicePublicKey, clientNonce: body.clientNonce, serviceFingerprint: body.serviceFingerprint,
      requestedScopes: body.requestedScopes,
    };
    const proofMessage = ['remote-v1-pair', proofFields.pairingSessionId, proofFields.pairCode, proofFields.deviceName, proofFields.devicePublicKey, proofFields.clientNonce, proofFields.serviceFingerprint, canonicalJson(proofFields.requestedScopes)].join('\n');
    if (!this.crypto.verify(String(body.devicePublicKey), String(body.proofSignature), proofMessage)) return fail('unauthorized');
    if (this.pairConsumed || body.pairCode !== this.pairingCode()) return fail('pairing_rejected');
    this.pairConsumed = true;
    const device = this.registerDevice({
      devicePublicKey: String(body.devicePublicKey),
      grantedScopes: scopes as Scope[],
      grants: this.domain.projects.map(p => p.projectId),
    });
    const unsigned = {
      deviceId: device.deviceId, serverNonce: 'srv' + '0'.repeat(40), grantedScopes: device.grantedScopes,
      expiresAt: device.expiresAt, replayEpoch: device.replayEpoch,
    };
    const responseMessage = ['remote-v1-pair-response', String(body.clientNonce), canonicalJson(unsigned)].join('\n');
    const response = { ...unsigned, serverSignature: this.crypto.sign(responseMessage) };
    return { status: 200, body: canonicalJson(response)! };
  }

  registerDevice(input: { devicePublicKey: string; grantedScopes: Scope[]; grants: string[]; replayEpoch?: number; expiresAt?: string }): DeviceCredentials {
    const deviceId = 'device_' + sha256hex(input.devicePublicKey).slice(0, 12);
    const existing = this.devices.get(deviceId);
    if (existing) {
      // Atomic re-pair for the same key material: never overwrite a live
      // record — bump the replay epoch so stale requests die, keep the grant
      // state, and refresh expiry/credentials from THIS registration.
      if (existing.devicePublicKey !== input.devicePublicKey) throw new Error('device key collision');
      existing.replayEpoch += 1;
      existing.active = true;
      existing.revoked = false;
      existing.grantedScopes = [...input.grantedScopes];
      existing.expiresAt = input.expiresAt ?? new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      this.nonces.delete(deviceId);
      this.acceptedFloor.delete(deviceId);
      return this.toCredentials(existing);
    }
    const device: DeviceRecord = {
      deviceId,
      devicePublicKey: input.devicePublicKey,
      grantedScopes: [...input.grantedScopes],
      grants: Object.fromEntries(input.grants.map(g => [g, true as const])),
      active: true, revoked: false,
      replayEpoch: input.replayEpoch ?? 1,
      expiresAt: input.expiresAt ?? new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    };
    this.devices.set(device.deviceId, device);
    this.streams.set(device.deviceId, { epoch: ++this.generationCounter, journalSeq: 0, journal: [], bytes: 0 });
    return this.toCredentials(device);
  }

  private toCredentials(device: DeviceRecord): DeviceCredentials {
    return {
      deviceId: device.deviceId, devicePublicKey: device.devicePublicKey, grantedScopes: device.grantedScopes,
      replayEpoch: device.replayEpoch, expiresAt: device.expiresAt,
      serviceFingerprint: this.serviceFingerprint, serviceId: this.serviceId, servicePublicKey: this.servicePublicKey,
    };
  }

  revokeDevice(deviceId: string): void {
    const device = this.devices.get(deviceId);
    if (device) { device.active = false; device.revoked = true; }
    // Contract deviceLifecycle.revocation: EVERY subscription of the device
    // receives exactly one reset (reason authorization_changed) before close.
    for (const sub of this.subscriptions.filter(s => s.deviceId === deviceId)) {
      this.resetOne(sub, 'authorization_changed');
    }
    this.subscriptions = this.subscriptions.filter(s => s.deviceId !== deviceId);
  }

  /** Test hook (ADR-0010 D4): roll the owner epoch of a conversation — retries
   * under the old epoch become fresh keys again (contract idempotency).
   * Contract concurrency: owner revocation resets every subscription for that
   * resource — subscriptions of devices granted the owning project reset. */
  rollOwnerEpoch(conversationId: string): void {
    const conv = this.domain.conversations.find(c => c.conversationId === conversationId);
    if (!conv) return;
    conv.ownerEpoch += 1;
    for (const sub of this.subscriptions) {
      const device = this.devices.get(sub.deviceId);
      if (device && device.grants[conv.projectId] === true) this.resetOne(sub, 'authorization_changed');
    }
  }

  /** Test hook (ADR-0010 D5): install/remove fault injection on delivery. */
  setFaultInjection(fi: FaultInjection | null): void { this.faults = fi; this.faultCount.clear(); }
  private faults: FaultInjection | null = null;
  private faultCount = new Map<string, number>();
  private reorderBuffers = new Map<string, EventEnvelope[]>();

  grantProject(deviceId: string, projectId: string, granted: boolean): void {
    const device = this.devices.get(deviceId);
    if (device) { if (granted) device.grants[projectId] = true; else delete device.grants[projectId]; }
    // Contract concurrency: "device/grant/owner revocation resets every
    // subscription for that resource or device". A revoked grant means NO
    // further frame will ever be emitted for this device (stream-level
    // authorization), so without an explicit reset the subscription would
    // starve silently (independent-review finding 3). Subscriptions are
    // device-level; the reset is the contract's isolation mechanism.
    if (!granted) {
      for (const sub of this.subscriptions.filter(s => s.deviceId === deviceId)) {
        this.resetOne(sub, 'authorization_changed');
      }
    }
  }

  // ---- signed request admission ---------------------------------------------------

  private route(request: SignedRequest): { op: { id: string; scope: Scope; ownerRevisionRequired?: boolean }; params: Record<string, string> } | null {
    const all = [...Object.values(OPERATIONS), EVENTS_OPERATION];
    for (const op of all) {
      const names: string[] = [];
      const pattern = '^' + op.path.replace(/\{([A-Za-z]+)\}/g, (_m, name: string) => { names.push(name); return '([A-Za-z0-9_-]{8,128})'; }) + '$';
      const match = request.path.match(new RegExp(pattern));
      if (match && request.method === op.method) {
        const params: Record<string, string> = {};
        names.forEach((name, i) => { params[name] = match[i + 1]!; });
        return { op, params };
      }
    }
    return null;
  }

  private error(code: string, requestId: string | null): { status: number; body: string } {
    const status = code === 'unauthorized' ? 401
      : code === 'invalid_request' || code === 'payload_invalid' || code === 'operation_rejected' ? 400
      : code === 'scope_denied' ? 403
      : code === 'unknown_resource' ? 404
      : code === 'stale_owner' || code === 'stale_revision' || code === 'replay_rejected' ? 409
      : code === 'rate_limited' ? 429
      : code === 'unavailable' || code === 'server_busy' ? 503 : 500;
    return { status, body: canonicalJson({ protocolVersion: 1, requestId: requestId ?? ZERO_ID, error: { code, retryable: status === 503 || code === 'rate_limited' } })! };
  }

  private pruneNonces(deviceId: string, floor: number, nowMs: number): Map<string, number> {
    let nonces = this.nonces.get(deviceId);
    if (nonces === undefined) {
      nonces = new Map<string, number>();
      this.nonces.set(deviceId, nonces);
    }
    // Retention rule: evict only when timestamp < floor AND outside retention.
    for (const [nonce, ts] of [...nonces]) {
      if (ts < floor && ts < nowMs - NONCE_RETENTION_MS) nonces.delete(nonce);
    }
    return nonces;
  }

  private admit(request: SignedRequest): { ok: true; op: string; params: Record<string, string>; device: DeviceRecord; owner: SandboxConversation | null; requestId: string; claimedOwnerRevision?: number; payload: Record<string, unknown> } | { ok: false; response: { status: number; body: string } } {
    // Contract admissionRules order: strict transport -> route -> signature
    // verify -> scope -> replay (nonce + floor, in one transaction) -> payload
    // validation -> device-grant + owner/revision recheck -> dispatch.
    // Every failure before signature verification maps uniformly to
    // 'unauthorized' (preAuthentication); internal codes never reach the wire.
    const unauthorized = () => ({ ok: false as const, response: this.error('unauthorized', null) });
    const route = this.route(request);
    if (!route) return unauthorized();
    const headers = Object.fromEntries(Object.entries(request.headers).map(([k, v]) => [k.toLowerCase(), v]));
    for (const h of Object.keys(headers)) if (!ALLOWED_HEADERS.has(h)) return unauthorized();
    for (const h of REQUIRED_HEADERS) if (typeof headers[h] !== 'string' || !headers[h]) return unauthorized();
    if (request.method === 'GET' && request.rawBody !== '') return unauthorized();
    if (request.method === 'GET' && headers['content-type'] !== undefined) return unauthorized();
    if (utf8Bytes(request.rawBody) > MAX_REQUEST_BYTES) return unauthorized();
    if (request.method === 'POST' && headers['content-type'] !== 'application/json; charset=utf-8') return unauthorized();
    // Reference parity: non-stream operations accept exactly application/json
    // when the header is present (the client always sends it).
    if (route.op.id !== 'events.subscribe' && headers.accept !== undefined && headers.accept !== 'application/json') return unauthorized();
    const requestIdHeader = headers['x-pi-remote-request-id']!;
    if (!isUuid(requestIdHeader) || requestIdHeader === ZERO_ID) return unauthorized();
    if (!DEVICE_ID.test(headers['x-pi-remote-device']!)) return unauthorized();
    if (!TIMESTAMP_MS.test(headers['x-pi-remote-timestamp']!)) return unauthorized();
    if (!NONCE_B64URL.test(headers['x-pi-remote-nonce']!)) return unauthorized();
    if (!BODY_SHA256.test(headers['x-pi-remote-body-sha256']!)) return unauthorized();
    if (!/^[A-Za-z0-9_-]{86}$/.test(headers['x-pi-remote-signature']!)) return unauthorized();
    if (headers['x-pi-remote-body-sha256'] !== sha256hex(request.rawBody)) return unauthorized();
    // Query admission: only the event stream accepts a single cursor query.
    const query = request.query ?? {};
    if (hasForbiddenKey(query)) return unauthorized();
    if (route.op.id === 'events.subscribe') {
      if (headers.accept !== 'text/event-stream') return unauthorized();
      if (Object.keys(query).some(k => k !== 'cursor')) return unauthorized();
      if (query.cursor !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(query.cursor)) return unauthorized();
    } else if (Object.keys(query).length) return unauthorized();
    const device = this.devices.get(headers['x-pi-remote-device']!);
    if (!device || device.active !== true || device.revoked === true || Date.parse(device.expiresAt) <= Date.now()) return unauthorized();
    if (Number(headers['x-pi-remote-epoch']) !== device.replayEpoch) return unauthorized();
    const timestamp = Number(headers['x-pi-remote-timestamp']);
    const nowMs = Date.now();
    if (!Number.isSafeInteger(timestamp) || Math.abs(nowMs - timestamp) > 60_000) return unauthorized();
    const canonicalQuery = Object.keys(query).sort().map(k => `${encodeURIComponent(k)}=${encodeURIComponent(query[k]!)}`).join('&');
    const target = canonicalQuery ? `${request.path}?${canonicalQuery}` : request.path;
    const message = ['1', device.deviceId, this.serviceId, String(device.replayEpoch), requestIdHeader, request.method, target, headers['x-pi-remote-timestamp'], headers['x-pi-remote-nonce'], headers['x-pi-remote-body-sha256']].join('\n');
    if (!this.crypto.verify(device.devicePublicKey, headers['x-pi-remote-signature']!, message)) return unauthorized();
    // --- post-authentication: codes reach the wire ---
    const requestId = requestIdHeader;
    if (!device.grantedScopes.includes(route.op.scope)) return { ok: false, response: this.error('scope_denied', requestId) };
    // Replay transaction: strict floor check then atomic nonce consume.
    const floor = this.acceptedFloor.get(device.deviceId) ?? -Infinity;
    if (timestamp < floor) return { ok: false, response: this.error('replay_rejected', requestId) };
    const nonces = this.pruneNonces(device.deviceId, floor, nowMs);
    if (nonces.has(headers['x-pi-remote-nonce']!)) return { ok: false, response: this.error('replay_rejected', requestId) };
    if (nonces.size >= MAX_NONCES) return { ok: false, response: this.error('replay_rejected', requestId) }; // atCapacity: fail_closed
    nonces.set(headers['x-pi-remote-nonce']!, timestamp);
    this.acceptedFloor.set(device.deviceId, Math.max(floor, timestamp));
    // Request envelope + per-operation payload schema.
    let payload: Record<string, unknown> = {};
    let claimedOwnerRevision: number | undefined;
    if (request.method === 'POST') {
      // Canonical-body enforcement: the signed bytes must already BE canonical.
      let envelope: unknown;
      try { envelope = JSON.parse(request.rawBody); } catch { return { ok: false, response: this.error('payload_invalid', requestId) }; }
      if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) return { ok: false, response: this.error('payload_invalid', requestId) };
      const env = envelope as Record<string, unknown>;
      if (env.protocolVersion !== 1 || env.operation !== route.op.id || env.payload === null || typeof env.payload !== 'object' || Array.isArray(env.payload)
        || Object.keys(env).some(k => !['protocolVersion', 'operation', 'ownerRevision', 'payload'].includes(k)))
        return { ok: false, response: this.error('payload_invalid', requestId) };
      if (canonicalJson(env) !== request.rawBody) return { ok: false, response: this.error('payload_invalid', requestId) };
      if (hasForbiddenKey(env)) return { ok: false, response: this.error('payload_invalid', requestId) };
      const spec = OPERATIONS[route.op.id];
      if (spec?.ownerRevisionRequired && !(Number.isSafeInteger(env.ownerRevision) && (env.ownerRevision as number) >= 0)) return { ok: false, response: this.error('stale_revision', requestId) };
      if (env.ownerRevision !== undefined && !(Number.isSafeInteger(env.ownerRevision) && (env.ownerRevision as number) >= 0)) return { ok: false, response: this.error('stale_revision', requestId) };
      claimedOwnerRevision = env.ownerRevision as number | undefined;
      payload = env.payload as Record<string, unknown>;
      if (!this.payloadValid(route.op.id, payload)) return { ok: false, response: this.error('payload_invalid', requestId) };
    }
    const params = route.params;
    let owner: SandboxConversation | null = null;
    if (params.conversationId) {
      owner = this.domain.conversations.find(c => c.conversationId === params.conversationId) ?? null;
      if (!owner || device.grants[owner.projectId] !== true) return { ok: false, response: this.error('unknown_resource', requestId) };
      if (claimedOwnerRevision !== undefined && claimedOwnerRevision !== owner.ownerRevision) return { ok: false, response: this.error('stale_revision', requestId) };
    } else if (params.projectId) {
      if (device.grants[params.projectId] !== true) return { ok: false, response: this.error('unknown_resource', requestId) };
      if (claimedOwnerRevision !== undefined && claimedOwnerRevision !== this.registryRevision()) return { ok: false, response: this.error('stale_revision', requestId) };
    }
    return { ok: true, op: route.op.id, params, device, owner, requestId, claimedOwnerRevision, payload };
  }

  /** Per-operation payload schema (frozen contract operations[].payload). */
  private payloadValid(op: string, payload: Record<string, unknown>): boolean {
    const keys = Object.keys(payload);
    const uuid = (v: unknown): v is string => isUuid(v);
    const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(v);
    switch (op) {
      case 'runtime.create':
        return keys.length === 1 && keys[0] === 'clientConversationId' && uuid(payload.clientConversationId) && !hasForbiddenKey(payload);
      case 'chat.send':
        return keys.length === 2 && uuid(payload.clientMessageId)
          && typeof payload.text === 'string' && payload.text.length >= 1
          && serializedJsonBytes(payload.text) <= 8192 && !hasForbiddenKey(payload);
      case 'chat.stop':
        return keys.length === 0;
      case 'approvals.respond': {
        if (!keys.every(k => ['method', 'decision', 'value'].includes(k)) || !keys.includes('method') || !keys.includes('decision')) return false;
        if (hasForbiddenKey(payload)) return false;
        const matrix: Record<string, { decisions: string[]; valueOn: Record<string, string> }> = {
          select: { decisions: ['answer'], valueOn: { answer: 'required' } },
          confirm: { decisions: ['allow', 'deny'], valueOn: { allow: 'forbidden', deny: 'forbidden' } },
          input: { decisions: ['answer', 'cancel'], valueOn: { answer: 'required', cancel: 'forbidden' } },
          editor: { decisions: ['answer', 'cancel'], valueOn: { answer: 'required', cancel: 'forbidden' } },
        };
        const rule = matrix[payload.method as string];
        if (!rule || !rule.decisions.includes(payload.decision as string)) return false;
        const need = rule.valueOn[payload.decision as string];
        if (need === 'required' && typeof payload.value !== 'string') return false;
        if (need === 'forbidden' && payload.value !== undefined) return false;
        if (payload.method === 'select' && payload.decision === 'answer' && !/^[A-Za-z0-9_-]{1,128}$/.test(String(payload.value ?? ''))) return false;
        if (payload.value !== undefined && utf8Bytes(String(payload.value)) > 2000) return false;
        // requestId path param is routed separately; nothing else to check.
        return true;
      }
      default:
        return keys.length === 0 || id(op); // GET ops carry no payload
    }
  }

  private registryRevision(): number { return this.domain.projects.length * 1000 + this.domain.sessions.length; }

  // ---- operations -----------------------------------------------------------------

  async send(request: SignedRequest): Promise<{ status: number; body: string }> {
    const admission = this.admit(request);
    if (!admission.ok) return admission.response;
    const { op, params, device, owner, requestId, payload } = admission;
    const respond = (result: unknown): { status: number; body: string } => ({
      status: 200,
      body: canonicalJson({ protocolVersion: 1, requestId, operation: op, serverRevision: this.registryRevision(), result })!,
    });

    switch (op) {
      case 'projects.list': {
        const projects = this.domain.projects.filter(p => device.grants[p.projectId] === true).slice(0, 500)
          .map(p => ({ projectId: p.projectId, displayName: p.displayName }));
        return respond({ projects, registryRevision: this.registryRevision() });
      }
      case 'sessions.list': {
        const sessions = this.domain.sessions.filter(s => s.projectId === params.projectId).slice(0, MAX_SESSIONS)
          .map(s => ({ sessionId: s.sessionId, displayName: s.displayName, updatedAt: s.updatedAt, projectId: s.projectId, activeConversations: s.activeConversations.slice(0, 64) }));
        return respond({ sessions });
      }
      case 'runtime.create': {
        const key = `runtime.create:${device.deviceId}:${params.projectId}:${String(payload.clientConversationId)}`;
        const prior = this.mutations.get(key);
        const digest = sha256hex(canonicalJson(payload)!);
        // runtime.create precedes the owner epoch it would be namespaced by
        // (sandbox does not model project epochs) — replays always hit.
        if (prior) {
          if (prior.payloadSha256 !== digest) return this.error('payload_invalid', requestId);
          return respond(prior.outcome);
        }
        // Capacity is refused BEFORE applying — never reject after mutating.
        if (this.mutations.size >= MAX_MUTATIONS) return this.error('operation_rejected', requestId);
        const conversationId = 'conv_' + sha256hex(`${device.deviceId}:${params.projectId}:${String(payload.clientConversationId)}`).slice(0, 16);
        const sessionId = 'sess_' + sha256hex(conversationId).slice(0, 12);
        const conversation: SandboxConversation = {
          conversationId, sessionId, projectId: params.projectId!, title: 'Synthetic conversation',
          status: 'idle', owner: `runtime:${device.deviceId}:${conversationId}`, ownerRevision: 1, ownerEpoch: 1,
          messages: [], approvals: [], script: {},
        };
        this.domain.conversations.push(conversation);
        this.domain.sessions.push({ sessionId, displayName: 'Synthetic conversation', updatedAt: new Date().toISOString(), projectId: params.projectId!, activeConversations: [{ conversationId }] });
        const outcome = { conversationId, ownerRevision: 1 };
        this.recordMutation(key, { payloadSha256: digest, outcome, ownerEpoch: 1 });
        return respond(outcome);
      }
      case 'runtime.snapshot': {
        const conv = owner!;
        const messages = conv.messages.slice(-MAX_SNAPSHOT);
        const truncated = conv.messages.length > MAX_SNAPSHOT;
        // Contract runtime.snapshot.watermark: cursor+generation+sequence is
        // an atomic resume point — the client can always continue the stream
        // from exactly here (ADR-0010 D1).
        const wm = this.watermark(device.deviceId);
        return respond({
          ownerRevision: conv.ownerRevision, status: conv.status, messages,
          cursor: wm.cursor,
          streamGeneration: wm.generation, sequence: wm.sequence,
          ...(truncated ? { snapshotTruncated: true } : {}),
        });
      }
      case 'chat.send': {
        const conv = owner!;
        const key = `chat.send:${device.deviceId}:${conv.conversationId}:${String(payload.clientMessageId)}`;
        const digest = sha256hex(canonicalJson(payload)!);
        const prior = this.mutations.get(key);
        // Contract idempotency: recognized ONLY within the current owner
        // epoch — after rollOwnerEpoch the same clientMessageId is fresh.
        if (prior && prior.ownerEpoch === conv.ownerEpoch) {
          if (prior.payloadSha256 !== digest) return this.error('payload_invalid', requestId);
          return respond(prior.outcome);
        }
        // Capacity is refused BEFORE applying — never reject after mutating.
        if (this.mutations.size >= MAX_MUTATIONS) return this.error('operation_rejected', requestId);
        const text = String(payload.text);
        const message: RemoteMessage = { messageId: 'msg_' + sha256hex(`${conv.conversationId}:${String(payload.clientMessageId)}`).slice(0, 14), role: 'user', text };
        conv.messages.push(message);
        this.trimMessages(conv);
        conv.status = 'running';
        conv.ownerRevision += 1;
        this.emit(device.deviceId, 'message.append', conv, { messageId: message.messageId, role: 'user', text });
        this.emit(device.deviceId, 'conversation.status', conv, { status: 'running' });
        const outcome = { clientMessageId: String(payload.clientMessageId), accepted: true, ownerRevision: conv.ownerRevision };
        this.recordMutation(key, { payloadSha256: digest, outcome, ownerEpoch: conv.ownerEpoch });
        const script = conv.script.afterSend;
        if (script) {
          const reply: RemoteMessage = { messageId: 'msg_' + sha256hex(`reply:${message.messageId}`).slice(0, 14), role: 'assistant', text: script.text };
          conv.messages.push(reply);
          this.trimMessages(conv);
          conv.ownerRevision += 1;
          // ADR-0010 D3 chunk-append: the assistant reply MAY stream as
          // progressive message.append frames under ONE messageId — each
          // carries the complete text so far; the final frame is the full
          // message. Contract event/payload schema unchanged.
          const chunks = Math.max(1, Math.min(16, script.chunks ?? 1));
          if (chunks <= 1) {
            this.emit(device.deviceId, 'message.append', conv, { messageId: reply.messageId, role: 'assistant', text: reply.text });
          } else {
            for (let i = 1; i <= chunks; i += 1) {
              const cut = Math.ceil((reply.text.length * i) / chunks);
              this.emit(device.deviceId, 'message.append', conv, { messageId: reply.messageId, role: 'assistant', text: reply.text.slice(0, cut) });
            }
          }
          conv.status = 'idle';
          this.emit(device.deviceId, 'conversation.status', conv, { status: 'idle' });
        }
        return respond(outcome);
      }
      case 'chat.stop': {
        const conv = owner!;
        const wasRunning = conv.status === 'running';
        conv.status = 'stopping';
        this.emit(device.deviceId, 'conversation.status', conv, { status: 'stopping' });
        conv.status = 'idle';
        conv.ownerRevision += 1;
        this.emit(device.deviceId, 'conversation.status', conv, { status: 'idle' });
        return respond({ stopped: wasRunning, ownerRevision: conv.ownerRevision });
      }
      case 'approvals.list': {
        const approvals = owner!.approvals.filter(a => a.pending).slice(0, MAX_APPROVALS)
          .map(a => ({ requestId: a.requestId, method: a.method, title: a.title, message: a.message, ...(a.options ? { options: a.options } : {}) }));
        return respond({ approvals });
      }
      case 'approvals.respond': {
        const conv = owner!;
        const dialog = conv.approvals.find(a => a.requestId === params.requestId);
        const method = payload.method as ApprovalMethod;
        const decision = payload.decision as ApprovalDecision;
        const value = payload.value as string | undefined;
        if (!dialog || dialog.pending !== true || dialog.owner !== conv.owner || dialog.method !== method || dialog.expiresAtMs <= Date.now())
          return this.error('stale_owner', requestId);
        if (method === 'select' && !(dialog.options ?? []).some(o => o.optionId === value)) return this.error('payload_invalid', requestId);
        dialog.pending = false;
        conv.ownerRevision += 1;
        const statusMap: Record<ApprovalDecision, string> = { allow: 'allowed', deny: 'denied', cancel: 'cancelled', answer: 'answered' };
        this.emit(device.deviceId, 'approval.settled', conv, { requestId: dialog.requestId, status: statusMap[decision] });
        return respond({ accepted: true, ownerRevision: conv.ownerRevision });
      }
      default:
        return this.error('operation_rejected', requestId);
    }
  }

  // ---- event stream ---------------------------------------------------------------

  streamFor(deviceId: string): StreamState {
    let stream = this.streams.get(deviceId);
    if (!stream) {
      stream = { epoch: ++this.generationCounter, journalSeq: 0, journal: [], bytes: 0 };
      this.streams.set(deviceId, stream);
    }
    return stream;
  }

  /** HMAC-equivalent opaque cursor: g<generation>_s<sequence>_<22-char tag>
   * bound to (deviceId, generation, sequence). Foreign/tampered is
   * indistinguishable from wellformed-stale (contract cursorTransitionTable).
   * Synthetic crypto: keyed digest stands in for HMAC. */
  private cursorTag(deviceId: string, generation: number, seq: number): string {
    return sha256hex(`remote-cursor:${this.cursorKey}:${this.incarnationSalt}:${deviceId}:${generation}.${seq}`).slice(0, 22).replace(/[+/=]/g, c => c === '+' ? '-' : c === '/' ? '_' : '');
  }
  private cursorFor(deviceId: string, generation: number, seq: number): string {
    return `g${generation}_s${seq}_${this.cursorTag(deviceId, generation, seq)}`;
  }
  private decodeCursor(deviceId: string, cursor: string): { generation: number; seq: number } | 'foreign' | 'malformed' {
    if (!CURSOR_RE.test(cursor)) return 'malformed';
    const m = CURSOR_RE.exec(cursor)!;
    const generation = Number(m[1]), seq = Number(m[2]);
    if (!Number.isSafeInteger(generation) || !Number.isSafeInteger(seq)) return 'malformed';
    // Constant-time tag comparison (reference crypto.timingSafeEqual
    // parity): CURSOR_RE already guarantees both sides are exactly 22 chars,
    // so a fixed-count XOR fold leaks neither position nor length.
    const expected = this.cursorTag(deviceId, generation, seq);
    const got = m[3]!;
    let diff = 0;
    for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ got.charCodeAt(i);
    if (diff !== 0) return 'foreign';
    return { generation, seq };
  }

  /** Trim the device backlog to the contract budgets; overflow evicts the
   * oldest frames — a cursor naming them becomes stale and hits the reset
   * path instead of producing a real gap (reference overflow semantics). */
  private trimBacklog(stream: StreamState): void {
    while (stream.journal.length > MAX_BACKLOG
      || stream.bytes > MAX_BACKLOG_BYTES
      || (stream.journal.length > 0 && Date.now() - stream.journal[0]!.at > MAX_BACKLOG_AGE_MS)) {
      stream.bytes -= stream.journal[0]!.size;
      stream.journal.shift();
    }
  }

  private materialize(sub: Subscription, entry: JournalEntry): EventEnvelope | null {
    const env: EventEnvelope = {
      protocolVersion: 1,
      sequence: entry.seq,
      conversationId: entry.conversationId,
      ownerRevision: entry.ownerRevision,
      event: entry.event,
      payload: entry.payload,
      streamGeneration: sub.generation,
      cursor: this.cursorFor(sub.deviceId, sub.generation, entry.seq),
      frameSignature: 'x'.repeat(86),
    };
    // maxEventFrameBytes before signing/queueing.
    const canonical = canonicalJson(env);
    if (canonical === null || utf8Bytes(canonical) > MAX_FRAME_BYTES) return null;
    const message = buildEventFrameMessage(env, sub.deviceId, this.serviceId);
    env.frameSignature = this.crypto.sign(message ?? '');
    return env;
  }

  private deliver(sub: Subscription, entry: JournalEntry): void {
    const frame = this.materialize(sub, entry);
    if (frame === null) return;
    this.deliverFrame(sub, frame);
    sub.lastSeq = entry.seq;
  }

  /** Delivery path — test-only fault injection applies here (ADR-0010 D5):
   * drop/duplicate/reorder corrupt the SUBSCRIPTION delivery exactly like a
   * misbehaving network would; journal/authorization are never affected. */
  private deliverFrame(sub: Subscription, frame: EventEnvelope): void {
    const faults = this.faults;
    if (!faults) { sub.onFrame(frame); return; }
    const key = `${sub.deviceId}:${sub.generation}`;
    if (faults.dropEvery) {
      const count = (this.faultCount.get(key) ?? 0) + 1;
      this.faultCount.set(key, count);
      if (count % faults.dropEvery === 0) return;
    }
    if (faults.reorderAfter) {
      const buf = this.reorderBuffers.get(key) ?? [];
      buf.push(frame);
      if (buf.length < faults.reorderAfter) { this.reorderBuffers.set(key, buf); return; }
      const out = [buf[0]!, ...buf.slice(1).reverse()];
      this.reorderBuffers.delete(key);
      for (const f of out) { sub.onFrame(f); if (faults.duplicate) sub.onFrame(f); }
      return;
    }
    sub.onFrame(frame);
    if (faults.duplicate) sub.onFrame(frame);
  }

  /** Flush any reorder-buffered frames (test hook: end-of-scenario drain).
   *  Drained frames bypass the reorder buffer DIRECTLY — re-entering it would
   *  ping-pong forever (buffer → flush → re-buffer). Drops/duplicates still
   *  apply: they model the wire, not the ordering scramble itself. */
  flushFaults(): void {
    for (const [key, buf] of this.reorderBuffers) {
      const [deviceId] = key.split(':');
      for (const sub of this.subscriptions) {
        if (sub.deviceId !== deviceId) continue;
        for (const f of buf) { sub.onFrame(f); if (this.faults?.duplicate) sub.onFrame(f); }
      }
    }
    this.reorderBuffers.clear();
  }

  /** Per-event authorization recheck: grant on the owning project AND the
   * event's required scope (contract perEventScopes) — applied to BOTH live
   * emission and backlog replay (mustRevalidateAuthorizationBeforeReplay). */
  private eventAuthorized(device: DeviceRecord, conversation: SandboxConversation, event: EventEnvelope['event']): boolean {
    if (device.active !== true || device.revoked === true || device.grants[conversation.projectId] !== true) return false;
    const scope = EVENT_SCOPES[event];
    return scope === undefined || device.grantedScopes.includes(scope);
  }

  emit(deviceId: string, event: EventEnvelope['event'], conversation: SandboxConversation, payload: Record<string, unknown>): void {
    // Shared per-device backlog of unsigned templates (reference semantics):
    // the frame is journaled once per authorized device; each subscription
    // materializes it under its OWN generation/cursor binding.
    for (const [otherDeviceId, stream] of this.streams) {
      const device = this.devices.get(otherDeviceId);
      if (!device || !this.eventAuthorized(device, conversation, event)) continue;
      stream.journalSeq += 1;
      const probe = canonicalJson({ event, conversationId: conversation.conversationId, ownerRevision: conversation.ownerRevision, payload });
      const entry: JournalEntry = {
        seq: stream.journalSeq, event, conversationId: conversation.conversationId,
        ownerRevision: conversation.ownerRevision, payload,
        size: probe === null ? 0 : utf8Bytes(probe), at: Date.now(),
      };
      stream.bytes += entry.size;
      stream.journal.push(entry);
      this.trimBacklog(stream);
      for (const sub of this.subscriptions) {
        if (sub.deviceId !== otherDeviceId) continue;
        // Per-event revalidation immediately before delivering ANY frame
        // (reference _mayDeliver): revocation mid-stream stops the leak and
        // isolates the subscription with exactly one reset.
        const deviceNow = this.devices.get(otherDeviceId);
        if (!deviceNow || !this.eventAuthorized(deviceNow, conversation, event)) { this.resetOne(sub, 'authorization_changed'); continue; }
        this.deliver(sub, entry);
      }
    }
  }

  /** Exactly-one reset isolated to ONE subscription (reference _resetOne):
   * mints a fresh generation for this subscription only and emits the reset
   * through the shared journal — co-subscriptions are never perturbed. */
  private resetOne(sub: Subscription, reason: string): void {
    // Contract eventStream.concurrency: a reset is isolated to ITS OWN
    // subscription — it is an ephemeral per-subscription delivery, never a
    // shared journal entry. Journaling it at the device-wide journalSeq would
    // consume a sequence number the co-subscriptions never see, punching a
    // hole into their sequence chains and killing them with sequence_gap
    // (independent-security important finding, 2026-11-25). The reset's
    // sequence is the CURRENT journal head: the next ordinary frame flows
    // continuously at head+1 for every subscriber.
    sub.generation = ++this.generationCounter;
    const stream = this.streamFor(sub.deviceId);
    const entry: JournalEntry = {
      seq: stream.journalSeq, event: 'reset', conversationId: 'stream-reset', ownerRevision: 0,
      payload: { reason }, size: 64, at: Date.now(),
    };
    this.deliver(sub, entry);
  }

  /** runtime.snapshot watermark (contract watermark): the CURRENT device
   * epoch and head sequence plus a resumable cursor — the client can always
   * resume from exactly this point and expect the same generation to
   * continue (ADR-0010 D1). */
  watermark(deviceId: string): { cursor: string; generation: number; sequence: number } {
    const stream = this.streamFor(deviceId);
    return {
      cursor: this.cursorFor(deviceId, stream.epoch, stream.journalSeq),
      generation: stream.epoch,
      sequence: stream.journalSeq + 1,
    };
  }

  /** Device-level event subscription; mirrors events.subscribe admission.
   * The stream binds to the AUTHENTICATED device (admission.device), not the
   * caller-provided credentials object. */
  subscribe(_credentials: DeviceCredentials, request: SignedRequest, onFrame: (frame: EventEnvelope) => void): { ok: true; close(): void } | { ok: false; response: { status: number; body: string } } {
    const admission = this.admit(request);
    if (!admission.ok) return { ok: false, response: admission.response };
    if (admission.op !== 'events.subscribe') return { ok: false, response: this.error('operation_rejected', admission.requestId) };
    const device = admission.device;
    const stream = this.streamFor(device.deviceId);
    if (this.subscriptions.filter(s => s.deviceId === device.deviceId).length >= MAX_STREAMS_PER_DEVICE
      || this.subscriptions.length >= MAX_STREAMS_TOTAL) return { ok: false, response: this.error('rate_limited', admission.requestId) };
    const cursor = request.query?.cursor;
    if (cursor !== undefined) {
      const decoded = this.decodeCursor(device.deviceId, cursor);
      // Malformed cursor is a PRE-authentication failure → unauthorized.
      if (decoded === 'malformed') return { ok: false, response: this.error('unauthorized', admission.requestId) };
      if (decoded === 'foreign') {
        // foreign/tampered is indistinguishable from wellformed-stale
        // (contract cursorTransitionTable) — never leak device existence.
        return this.resetSubscribe(device, stream, 'cursor_expired', onFrame, admission.requestId);
      }
      // Valid tag: continue the SAME generation when the cursor position is
      // continuous with the retained journal (contract runtime.snapshot.watermark:
      // the client can ALWAYS resume from the watermark). The correct test is
      // whether the first needed frame (cursor.seq+1) is still retained — a
      // floor-based comparison would falsely expire watermark cursors taken
      // before any frame existed (s0 with floor 1) even though nothing was
      // ever lost. Eviction still expires correctly: the needed frame is gone.
      const firstNeeded = decoded.seq + 1;
      const retained = firstNeeded > stream.journalSeq
        ? true // nothing new since the cursor — nothing to replay at all
        : stream.journal.length > 0 && stream.journal[0]!.seq <= firstNeeded;
      const validResume = decoded.generation >= stream.epoch
        && decoded.seq <= stream.journalSeq
        && retained;
      if (!validResume) {
        return this.resetSubscribe(device, stream, 'cursor_expired', onFrame, admission.requestId);
      }
      const sub: Subscription = { deviceId: device.deviceId, generation: decoded.generation, lastSeq: decoded.seq, onFrame };
      this.subscriptions.push(sub);
      // Replay backlog newer than the cursor — with a per-event scope + grant
      // recheck (mustRevalidateAuthorizationBeforeReplay). Frames materialize
      // under the SUBSCRIBER's continuing generation (reference templates).
      for (const entry of stream.journal) {
        if (entry.seq <= decoded.seq) continue;
        const conv = this.domain.conversations.find(c => c.conversationId === entry.conversationId);
        if (conv && !this.eventAuthorized(device, conv, entry.event)) continue;
        this.deliver(sub, entry);
      }
      return { ok: true, close: () => { this.subscriptions = this.subscriptions.filter(s => s !== sub); } };
    }
    // No cursor: join at the current head, no reset — a fresh generation
    // minted for this subscription only.
    const sub: Subscription = { deviceId: device.deviceId, generation: ++this.generationCounter, lastSeq: stream.journalSeq, onFrame };
    this.subscriptions.push(sub);
    return { ok: true, close: () => { this.subscriptions = this.subscriptions.filter(s => s !== sub); } };
  }

  /** Isolated stale-cursor subscribe: new generation + exactly one reset for
   * this subscriber only — co-subscriptions are never perturbed (ADR-0010 D2).
   * Note the M3 co-subscription-rebind behavior is intentionally REMOVED:
   * the reference isolates every subscription's generation space. */
  private resetSubscribe(device: DeviceRecord, stream: StreamState, reason: string, onFrame: (frame: EventEnvelope) => void, requestId: string): { ok: true; close(): void } {
    // Ephemeral isolated reset — see resetOne: never journaled, sequenced at
    // the current journal head so the generation continues without holes.
    const sub: Subscription = { deviceId: device.deviceId, generation: ++this.generationCounter, lastSeq: 0, onFrame };
    const entry: JournalEntry = {
      seq: stream.journalSeq, event: 'reset', conversationId: 'stream-reset', ownerRevision: 0,
      payload: { reason }, size: 64, at: Date.now(),
    };
    this.subscriptions.push(sub);
    this.deliver(sub, entry);
    return { ok: true, close: () => { this.subscriptions = this.subscriptions.filter(s => s !== sub); } };
  }

  /** Fixture hooks for tests/demo — raise + expire live approvals. */
  raiseApproval(conversationId: string, approval: { requestId: string; method: ApprovalMethod; title: string; message: string; options?: { optionId: string; label: string }[]; expiresAtMs?: number }): void {
    const conv = this.domain.conversations.find(c => c.conversationId === conversationId);
    if (!conv) return;
    const record: SandboxApproval = {
      requestId: approval.requestId, method: approval.method, title: approval.title, message: approval.message,
      ...(approval.options ? { options: approval.options } : {}),
      conversationId, pending: true, owner: conv.owner, revision: conv.ownerRevision,
      expiresAtMs: approval.expiresAtMs ?? Date.now() + 120_000,
    };
    conv.approvals.push(record);
    // emit() already fans out to every granted+scoped device's stream exactly
    // once — do NOT loop per device here or entries duplicate into journals.
    this.emit(conv.owner, 'approval.pending', conv, { requestId: record.requestId, method: record.method, title: record.title, message: record.message, ...(record.options ? { options: record.options } : {}) });
  }

  expireApproval(conversationId: string, requestId: string): void {
    const conv = this.domain.conversations.find(c => c.conversationId === conversationId);
    const dialog = conv?.approvals.find(a => a.requestId === requestId);
    if (dialog) dialog.expiresAtMs = Date.now() - 1;
  }

  private trimMessages(conv: SandboxConversation): void {
    if (conv.messages.length > 600) conv.messages.splice(0, conv.messages.length - 600);
  }
}

/** Deterministic synthetic service material for the bundled demo. */
export function syntheticServiceMaterial(seed: string): { fingerprint: string; publicKey: string } {
  const publicKey = b64urlEncode([...new TextEncoder().encode(sha256hex(`svc:${seed}`).slice(0, 32))]);
  const fingerprint = sha256hex(`fp:${publicKey}`);
  return { fingerprint, publicKey };
}

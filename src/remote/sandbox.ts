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
import { b64urlDecode, b64urlEncode, canonicalJson, hasForbiddenKey, hasForbiddenValue, isUuid, serializedJsonBytes, sha256hex, utf8Bytes } from './wire';
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
  script: { afterSend?: { text: string } };
}
export interface SandboxDomain {
  projects: SandboxProject[];
  sessions: RemoteSession[];
  conversations: SandboxConversation[];
}

interface MutationRecord { payloadSha256: string; outcome: Record<string, unknown>; ownerEpoch: number }
interface DeviceRecord {
  deviceId: string; devicePublicKey: string; grantedScopes: Scope[]; grants: Record<string, true>;
  active: boolean; revoked: boolean; replayEpoch: number; expiresAt: string;
}
interface StreamState { generation: number; journalSeq: number; journal: JournalEntry[] }
interface JournalEntry { seq: number; event: EventEnvelope['event']; conversationId: string; ownerRevision: number; payload: Record<string, unknown> }
interface Subscription {
  deviceId: string; generation: number; lastSeq: number;
  onFrame: (frame: EventEnvelope) => void;
}

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
const TIMESTAMP_MS = /^[0-9]{10,14}$/;
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
  private readonly domain: SandboxDomain;
  private devices = new Map<string, DeviceRecord>();
  private streams = new Map<string, StreamState>();
  private nonces = new Map<string, Map<string, number>>();
  private acceptedFloor = new Map<string, number>();
  private mutations = new Map<string, MutationRecord>();
  private subscriptions: Subscription[] = [];
  private generationCounter = 0;
  private pairConsumed = false;

  constructor(domain: SandboxDomain, crypto: GatewayCrypto, serviceMaterial: { fingerprint: string; publicKey: string }) {
    this.domain = domain;
    this.crypto = crypto;
    this.serviceFingerprint = serviceMaterial.fingerprint;
    this.servicePublicKey = serviceMaterial.publicKey;
    this.serviceId = 'svc-' + serviceMaterial.fingerprint.slice(0, 16);
  }

  // ---- pairing ------------------------------------------------------------------

  pairingCode(): string { return '042817'; }
  pairingSessionId(): string { return 'pairing-demo0000000000'; }

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
    if (typeof body.pairingSessionId !== 'string' || body.pairingSessionId !== this.pairingSessionId()) return fail('pairing_expired');
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
    this.streams.set(device.deviceId, { generation: ++this.generationCounter, journalSeq: 0, journal: [] });
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
    this.subscriptions = this.subscriptions.filter(s => s.deviceId !== deviceId);
  }

  grantProject(deviceId: string, projectId: string, granted: boolean): void {
    const device = this.devices.get(deviceId);
    if (device) { if (granted) device.grants[projectId] = true; else delete device.grants[projectId]; }
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
    if (utf8Bytes(request.rawBody) > MAX_REQUEST_BYTES) return unauthorized();
    if (request.method === 'POST' && headers['content-type'] !== 'application/json; charset=utf-8') return unauthorized();
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
        if (prior) {
          if (prior.payloadSha256 !== digest) return this.error('payload_invalid', requestId);
          return respond(prior.outcome);
        }
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
        this.mutations.set(key, { payloadSha256: digest, outcome, ownerEpoch: 1 });
        return respond(outcome);
      }
      case 'runtime.snapshot': {
        const conv = owner!;
        const messages = conv.messages.slice(-MAX_SNAPSHOT);
        const truncated = conv.messages.length > MAX_SNAPSHOT;
        const stream = this.streamFor(device.deviceId);
        return respond({
          ownerRevision: conv.ownerRevision, status: conv.status, messages,
          cursor: this.cursorFor(device.deviceId, stream.generation, stream.journalSeq),
          streamGeneration: stream.generation, sequence: stream.journalSeq,
          ...(truncated ? { snapshotTruncated: true } : {}),
        });
      }
      case 'chat.send': {
        const conv = owner!;
        const key = `chat.send:${device.deviceId}:${conv.conversationId}:${String(payload.clientMessageId)}`;
        const digest = sha256hex(canonicalJson(payload)!);
        const prior = this.mutations.get(key);
        if (prior) {
          if (prior.payloadSha256 !== digest) return this.error('payload_invalid', requestId);
          return respond(prior.outcome);
        }
        const text = String(payload.text);
        const message: RemoteMessage = { messageId: 'msg_' + sha256hex(`${conv.conversationId}:${String(payload.clientMessageId)}`).slice(0, 14), role: 'user', text };
        conv.messages.push(message);
        this.trimMessages(conv);
        conv.status = 'running';
        conv.ownerRevision += 1;
        this.emit(device.deviceId, 'message.append', conv, { messageId: message.messageId, role: 'user', text });
        this.emit(device.deviceId, 'conversation.status', conv, { status: 'running' });
        const outcome = { clientMessageId: String(payload.clientMessageId), accepted: true, ownerRevision: conv.ownerRevision };
        this.mutations.set(key, { payloadSha256: digest, outcome, ownerEpoch: conv.ownerEpoch });
        const script = conv.script.afterSend;
        if (script) {
          const reply: RemoteMessage = { messageId: 'msg_' + sha256hex(`reply:${message.messageId}`).slice(0, 14), role: 'assistant', text: script.text };
          conv.messages.push(reply);
          this.trimMessages(conv);
          conv.status = 'idle';
          conv.ownerRevision += 1;
          this.emit(device.deviceId, 'message.append', conv, { messageId: reply.messageId, role: 'assistant', text: reply.text });
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

  private streamFor(deviceId: string): StreamState {
    let stream = this.streams.get(deviceId);
    if (!stream) {
      stream = { generation: ++this.generationCounter, journalSeq: 0, journal: [] };
      this.streams.set(deviceId, stream);
    }
    return stream;
  }

  private cursorFor(deviceId: string, generation: number, seq: number): string {
    return b64urlEncode([...new TextEncoder().encode(`cur:${deviceId}:${generation}:${seq}`)]);
  }

  private decodeCursor(deviceId: string, cursor: string): { generation: number; seq: number } | 'foreign' | 'stale' | 'malformed' {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(cursor)) return 'malformed';
    const bytes = b64urlDecode(cursor);
    if (bytes === null) return 'malformed';
    const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    const match = /^cur:([A-Za-z0-9_-]+):([0-9]+):([0-9]+)$/.exec(decoded);
    if (!match) return 'stale';
    if (match[1] !== deviceId) return 'foreign';
    const stream = this.streamFor(deviceId);
    const generation = Number(match[2]), seq = Number(match[3]);
    if (generation !== stream.generation || seq > stream.journalSeq) return 'stale';
    // Backlog window: a cursor older than the earliest retained frame expired.
    const oldest = stream.journal.length ? stream.journal[0]!.seq : 0;
    if (seq < oldest && stream.journal.length) return 'stale';
    return { generation, seq };
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
    sub.onFrame(frame);
    sub.lastSeq = entry.seq;
  }

  /** Per-event authorization recheck: grant on the owning project AND the
   * event's required scope (contract perEventScopes) — applied to BOTH live
   * emission and backlog replay (mustRevalidateAuthorizationBeforeReplay). */
  private eventAuthorized(device: DeviceRecord, conversation: SandboxConversation, event: EventEnvelope['event']): boolean {
    if (device.active !== true || device.revoked === true || device.grants[conversation.projectId] !== true) return false;
    const scope = EVENT_SCOPES[event];
    return scope === undefined || device.grantedScopes.includes(scope);
  }

  private emit(deviceId: string, event: EventEnvelope['event'], conversation: SandboxConversation, payload: Record<string, unknown>): void {
    // Every authorized device's stream journals the event once; each live
    // subscription materializes it under its own generation/cursor binding.
    for (const [otherDeviceId, stream] of this.streams) {
      const device = this.devices.get(otherDeviceId);
      if (!device || !this.eventAuthorized(device, conversation, event)) continue;
      stream.journalSeq += 1;
      const entry: JournalEntry = { seq: stream.journalSeq, event, conversationId: conversation.conversationId, ownerRevision: conversation.ownerRevision, payload };
      stream.journal.push(entry);
      if (stream.journal.length > MAX_BACKLOG) stream.journal.shift();
      for (const sub of this.subscriptions) {
        if (sub.deviceId !== otherDeviceId || sub.generation !== stream.generation) continue;
        this.deliver(sub, entry);
      }
    }
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
    let generation = stream.generation;
    if (cursor !== undefined) {
      const decoded = this.decodeCursor(device.deviceId, cursor);
      // Malformed cursor is a PRE-authentication failure → unauthorized.
      if (decoded === 'malformed') return { ok: false, response: this.error('unauthorized', admission.requestId) };
      if (decoded === 'foreign' || decoded === 'stale') {
        generation = ++this.generationCounter;
        stream.generation = generation;
        stream.journal = [];
        const sub: Subscription = { deviceId: device.deviceId, generation, lastSeq: 0, onFrame };
        stream.journalSeq += 1;
        const resetEntry: JournalEntry = {
          seq: stream.journalSeq, event: 'reset', conversationId: 'stream-reset', ownerRevision: 0,
          payload: { reason: decoded === 'foreign' ? 'owner_changed' : 'cursor_expired' },
        };
        stream.journal.push(resetEntry);
        this.subscriptions.push(sub);
        this.deliver(sub, resetEntry);
        return { ok: true, close: () => { this.subscriptions = this.subscriptions.filter(s => s !== sub); } };
      }
      // Valid cursor: same generation, replay backlog newer than it — with a
      // per-event scope + grant recheck (mustRevalidateAuthorizationBeforeReplay).
      const sub: Subscription = { deviceId: device.deviceId, generation, lastSeq: decoded.seq, onFrame };
      this.subscriptions.push(sub);
      for (const entry of stream.journal) {
        if (entry.seq <= decoded.seq) continue;
        const conv = this.domain.conversations.find(c => c.conversationId === entry.conversationId);
        if (conv && !this.eventAuthorized(device, conv, entry.event)) continue;
        this.deliver(sub, entry);
      }
      return { ok: true, close: () => { this.subscriptions = this.subscriptions.filter(s => s !== sub); } };
    }
    const sub: Subscription = { deviceId: device.deviceId, generation, lastSeq: stream.journalSeq, onFrame };
    this.subscriptions.push(sub);
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
    for (const device of this.devices.values()) {
      if (device.grants[conv.projectId] === true) this.emit(device.deviceId, 'approval.pending', conv, { requestId: record.requestId, method: record.method, title: record.title, message: record.message, ...(record.options ? { options: record.options } : {}) });
    }
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

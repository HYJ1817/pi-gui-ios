/**
 * Typed remote/v1 client (mobile side). Surface: the 8 frozen operations only;
 * no generic HTTP, no free queries, no path construction beyond filling opaque
 * pathParameters into the frozen templates. Every request is Ed25519-signed by
 * the injected CryptoProvider; every response is re-validated against the
 * closed envelope + result schema before it reaches the store/UI.
 *
 * Fail-closed posture: any transport error, schema violation, forbidden field
 * or unexpected identity collapses to the closed error vocabulary — never a
 * partial application of unverified data.
 */
import {
  MAX_REQUEST_BYTES,
  ZERO_REQUEST_ID,
  type ApprovalDecision,
  type ApprovalMethod,
  type ConversationStatus,
  type CryptoProvider,
  type DeviceCredentials,
  type RemoteApproval,
  type RemoteClient,
  type RemoteErrorCode,
  type RemoteMessage,
  type RemoteOutcome,
  type RemoteProject,
  type RemoteSession,
  type Scope,
  type SignedRequest,
  type SignedResponse,
  type Transport,
} from './types';
import { b64urlDecode, b64urlEncode, canonicalJson, hasForbiddenKey, hasForbiddenValue, isOpaqueId, isUuid, serializedJsonBytes, sha256hex, utf8Bytes, uuidFromBytes } from './wire';

export const EVENTS_PATH = '/remote/v1/events';

const ERROR_CODES: RemoteErrorCode[] = [
  'unauthorized', 'pairing_required', 'pairing_expired', 'pairing_rejected',
  'rate_limited', 'scope_denied', 'stale_owner', 'stale_revision',
  'unknown_resource', 'operation_rejected', 'replay_rejected',
  'sequence_gap', 'server_busy', 'unavailable', 'invalid_request',
  'payload_invalid', 'internal_error',
];
const METHODS: ApprovalMethod[] = ['select', 'confirm', 'input', 'editor'];
const STATUSES: ConversationStatus[] = ['idle', 'running', 'stopping', 'error', 'unknown'];

interface OperationSpec {
  id: string;
  method: 'GET' | 'POST';
  path: string;
  scope: Scope;
  ownerRevisionRequired?: boolean;
}

/** The frozen operation table (docs/contracts/remote-v1.json). */
export const OPERATIONS: Record<string, OperationSpec> = {
  'projects.list': { id: 'projects.list', method: 'GET', path: '/remote/v1/projects', scope: 'projects.read' },
  'sessions.list': { id: 'sessions.list', method: 'GET', path: '/remote/v1/projects/{projectId}/sessions', scope: 'sessions.read' },
  'runtime.create': { id: 'runtime.create', method: 'POST', path: '/remote/v1/projects/{projectId}/conversations', scope: 'sessions.create', ownerRevisionRequired: true },
  'runtime.snapshot': { id: 'runtime.snapshot', method: 'GET', path: '/remote/v1/conversations/{conversationId}/snapshot', scope: 'sessions.read' },
  'chat.send': { id: 'chat.send', method: 'POST', path: '/remote/v1/conversations/{conversationId}/messages', scope: 'chat.send', ownerRevisionRequired: true },
  'chat.stop': { id: 'chat.stop', method: 'POST', path: '/remote/v1/conversations/{conversationId}/stop', scope: 'chat.stop', ownerRevisionRequired: true },
  'approvals.list': { id: 'approvals.list', method: 'GET', path: '/remote/v1/conversations/{conversationId}/approvals', scope: 'approvals.read' },
  'approvals.respond': { id: 'approvals.respond', method: 'POST', path: '/remote/v1/conversations/{conversationId}/approvals/{requestId}/respond', scope: 'approvals.respond', ownerRevisionRequired: true },
};

export { hasForbiddenKey, hasForbiddenValue };

function fillPath(template: string, params: Record<string, string>): string | null {
  let out = template;
  for (const [name, value] of Object.entries(params)) {
    if (!isOpaqueId(value) || value === 'stream-reset') return null;
    out = out.replace(`{${name}}`, value);
  }
  return out.includes('{') || out.includes('}') ? null : out;
}

export interface ClientOptions {
  credentials: DeviceCredentials;
  crypto: CryptoProvider;
  transport: Transport;
  /** injectable clock for tests */
  nowMs?: () => number;
}

interface ParsedResponse { status: number; value: unknown }

export class TypedRemoteClient implements RemoteClient {
  private readonly credentialsValue: DeviceCredentials;
  private readonly crypto: CryptoProvider;
  private readonly transport: Transport;
  private readonly now: () => number;

  constructor(options: ClientOptions) {
    this.credentialsValue = options.credentials;
    this.crypto = options.crypto;
    this.transport = options.transport;
    this.now = options.nowMs ?? (() => Date.now());
  }

  credentials(): DeviceCredentials { return this.credentialsValue; }

  private requestId(): string | null {
    const raw = this.crypto.randomBytes(16);
    // randomBytes returns base64url (may contain '-'/'_'); decode it properly.
    const bytes = b64urlDecode(raw, 16);
    return bytes ? uuidFromBytes(bytes) : null;
  }

  private nonce(): string { return this.crypto.randomBytes(32); }

  /** Signed GET /remote/v1/events request (only query allowed: cursor).
   * The ZERO_UUID sentinel is reserved for pre-auth failures — a subscribe
   * request always carries a real requestId (crypto failure throws closed). */
  buildEventsRequest(cursor?: string): SignedRequest {
    const requestId = this.requestId();
    if (requestId === null) throw new Error('crypto failure');
    const timestamp = String(this.now());
    const bodySha256 = sha256hex('');
    const nonce = this.nonce();
    const query = cursor === undefined ? undefined : { cursor };
    const target = query ? `${EVENTS_PATH}?cursor=${encodeURIComponent(query.cursor)}` : EVENTS_PATH;
    const message = ['1', this.credentialsValue.deviceId, this.credentialsValue.serviceId, String(this.credentialsValue.replayEpoch), requestId, 'GET', target, timestamp, nonce, bodySha256].join('\n');
    return {
      method: 'GET', path: EVENTS_PATH, ...(query ? { query } : {}),
      headers: {
        'x-pi-remote-device': this.credentialsValue.deviceId,
        'x-pi-remote-epoch': String(this.credentialsValue.replayEpoch),
        'x-pi-remote-request-id': requestId,
        'x-pi-remote-timestamp': timestamp,
        'x-pi-remote-nonce': nonce,
        'x-pi-remote-body-sha256': bodySha256,
        'x-pi-remote-signature': this.crypto.sign(message),
        accept: 'text/event-stream',
      },
      rawBody: '',
    };
  }

  private async call<T>(operation: OperationSpec, params: Record<string, string>, payload: Record<string, unknown> | null, ownerRevision: number | undefined, validate: (result: unknown) => T | null | undefined): Promise<RemoteOutcome<T>> {
    const path = fillPath(operation.path, params);
    const requestId = this.requestId();
    if (!path || !requestId) return fail('invalid_request');
    const envelope: Record<string, unknown> | null = operation.method === 'POST'
      ? { protocolVersion: 1, operation: operation.id, ...(ownerRevision === undefined ? {} : { ownerRevision }), payload: payload ?? {} }
      : null;
    if (operation.ownerRevisionRequired && envelope !== null && !Number.isSafeInteger(envelope.ownerRevision)) {
      return fail('stale_revision');
    }
    const rawBody = envelope === null ? '' : canonicalJson(envelope) ?? '';
    if (utf8Bytes(rawBody) > MAX_REQUEST_BYTES) return fail('invalid_request');
    const timestamp = String(this.now());
    const bodySha256 = sha256hex(rawBody);
    const nonce = this.nonce();
    const signedMessage = ['1', this.credentialsValue.deviceId, this.credentialsValue.serviceId, String(this.credentialsValue.replayEpoch), requestId, operation.method, path, timestamp, nonce, bodySha256].join('\n');
    const signature = this.crypto.sign(signedMessage);
    const request: SignedRequest = {
      method: operation.method,
      path,
      headers: {
        'x-pi-remote-device': this.credentialsValue.deviceId,
        'x-pi-remote-epoch': String(this.credentialsValue.replayEpoch),
        'x-pi-remote-request-id': requestId,
        'x-pi-remote-timestamp': timestamp,
        'x-pi-remote-nonce': nonce,
        'x-pi-remote-body-sha256': bodySha256,
        'x-pi-remote-signature': signature,
        accept: 'application/json',
        ...(operation.method === 'POST' ? { 'content-type': 'application/json; charset=utf-8' } : {}),
      },
      rawBody,
    };
    let response: ParsedResponse;
    try {
      const wire = await this.transport.send(request);
      response = this.parse(wire);
    } catch {
      return fail('unavailable');
    }
    if (response.status < 200 || response.status >= 300) {
      const error = parseError(response.value, requestId);
      return fail(error.code, error.retryable);
    }
    const value = response.value;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail('internal_error');
    const record = value as Record<string, unknown>;
    // Exact success envelope: {protocolVersion, requestId, operation,
    // serverRevision, result} — no extra fields, then the whole envelope is
    // projection-scanned (forbidden keys/values) before result validation.
    const expectedKeys = ['operation', 'protocolVersion', 'requestId', 'result', 'serverRevision'];
    if (Object.keys(record).sort().join(',') !== expectedKeys.join(',')) return fail('internal_error');
    if (hasForbiddenKey(record) || hasForbiddenValue(record)) return fail('internal_error');
    if (record.protocolVersion !== 1 || record.requestId !== requestId || record.operation !== operation.id
      || !Number.isSafeInteger(record.serverRevision) || (record.serverRevision as number) < 0) return fail('internal_error');
    const result = validate(record.result);
    if (result === null || result === undefined) return fail('internal_error');
    return { ok: true, result, serverRevision: record.serverRevision as number };
  }

  private parse(wire: SignedResponse): ParsedResponse {
    if (utf8Bytes(wire.body) > MAX_REQUEST_BYTES * 4) return { status: wire.status, value: null };
    try { return { status: wire.status, value: JSON.parse(wire.body) }; }
    catch { return { status: wire.status, value: null }; }
  }

  /** Unsigned pair.exchange request (the only unauthenticated route). */
  buildPairRequest(body: Record<string, unknown>): { method: 'POST'; path: string; headers: Record<string, string>; rawBody: string } {
    const rawBody = canonicalJson(body) ?? '';
    return {
      method: 'POST', path: '/remote/v1/pair/exchange',
      headers: { 'content-type': 'application/json; charset=utf-8', accept: 'application/json' },
      rawBody,
    };
  }

  listProjects(): Promise<RemoteOutcome<{ projects: RemoteProject[]; registryRevision: number }>> {
    return this.call(OPERATIONS['projects.list']!, {}, null, undefined, (v): { projects: RemoteProject[]; registryRevision: number } | null => {
      const r = v as Record<string, unknown>;
      if (!Array.isArray(r?.projects) || !Number.isSafeInteger(r.registryRevision) || Object.keys(r).some(k => !['projects', 'registryRevision'].includes(k))) return null;
      const projects: RemoteProject[] = [];
      for (const p of r.projects as unknown[]) {
        const o = p as Record<string, unknown>;
        if (!isOpaqueId(o?.projectId) || typeof o.displayName !== 'string' || !o.displayName.length || o.displayName.length > 120 || Object.keys(o).some(k => !['projectId', 'displayName'].includes(k))) return null;
        projects.push({ projectId: o.projectId, displayName: o.displayName });
      }
      return { projects, registryRevision: r.registryRevision as number };
    });
  }

  listSessions(projectId: string): Promise<RemoteOutcome<{ sessions: RemoteSession[] }>> {
    return this.call(OPERATIONS['sessions.list']!, { projectId }, null, undefined, (v): { sessions: RemoteSession[] } | null => {
      const r = v as Record<string, unknown>;
      if (!Array.isArray(r?.sessions) || Object.keys(r).some(k => k !== 'sessions')) return null;
      const sessions: RemoteSession[] = [];
      for (const s of r.sessions as unknown[]) {
        const o = s as Record<string, unknown>;
        const conversations = Array.isArray(o?.activeConversations) ? (o.activeConversations as unknown[]).map(c => {
          const co = c as Record<string, unknown>;
          return isOpaqueId(co?.conversationId) && Object.keys(co).every(k => k === 'conversationId') ? { conversationId: co.conversationId } : null;
        }) : null;
        if (!isOpaqueId(o?.sessionId) || typeof o.displayName !== 'string' || o.displayName.length > 120
          || typeof o.updatedAt !== 'string' || o.updatedAt.length > 40 || !isOpaqueId(o.projectId)
          || conversations === null || conversations.some(c => c === null)
          || Object.keys(o).some(k => !['sessionId', 'displayName', 'updatedAt', 'projectId', 'activeConversations'].includes(k))) return null;
        sessions.push({ sessionId: o.sessionId, displayName: o.displayName, updatedAt: o.updatedAt, projectId: o.projectId, activeConversations: conversations as { conversationId: string }[] });
      }
      return { sessions };
    });
  }

  createConversation(projectId: string, clientConversationId: string, ownerRevision?: number): Promise<RemoteOutcome<{ conversationId: string; ownerRevision: number }>> {
    if (!isUuid(clientConversationId)) return Promise.resolve(fail('invalid_request'));
    return this.call(OPERATIONS['runtime.create']!, { projectId }, { clientConversationId }, ownerRevision, (v): { conversationId: string; ownerRevision: number } | null => {
      const r = v as Record<string, unknown>;
      return isOpaqueId(r?.conversationId) && Number.isSafeInteger(r.ownerRevision) && Object.keys(r).every(k => ['conversationId', 'ownerRevision'].includes(k))
        ? { conversationId: r.conversationId as string, ownerRevision: r.ownerRevision as number } : null;
    });
  }

  snapshot(conversationId: string): Promise<RemoteOutcome<{
    ownerRevision: number; status: ConversationStatus; messages: RemoteMessage[];
    cursor: string; streamGeneration: number; sequence: number; snapshotTruncated?: boolean;
  }>> {
    return this.call(OPERATIONS['runtime.snapshot']!, { conversationId }, null, undefined, (v): {
      ownerRevision: number; status: ConversationStatus; messages: RemoteMessage[];
      cursor: string; streamGeneration: number; sequence: number; snapshotTruncated?: boolean;
    } | null => {
      const r = v as Record<string, unknown>;
      if (!Number.isSafeInteger(r?.ownerRevision) || !STATUSES.includes(r.status as ConversationStatus) || !Array.isArray(r.messages)
        || typeof r.cursor !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(r.cursor)
        // Contract runtime.snapshot watermark minimums: generation/sequence >= 1.
        || !Number.isSafeInteger(r.streamGeneration) || (r.streamGeneration as number) < 1
        || !Number.isSafeInteger(r.sequence) || (r.sequence as number) < 1
        || Object.keys(r).some(k => !['ownerRevision', 'status', 'messages', 'cursor', 'streamGeneration', 'sequence', 'snapshotTruncated'].includes(k))) return null;
      const messages: RemoteMessage[] = [];
      for (const m of r.messages as unknown[]) {
        const o = m as Record<string, unknown>;
        if (!isOpaqueId(o?.messageId) || !['user', 'assistant'].includes(o.role as string) || typeof o.text !== 'string' || serializedJsonBytes(o.text) > 8192
          || Object.keys(o).some(k => !['messageId', 'role', 'text'].includes(k))) return null;
        messages.push({ messageId: o.messageId, role: o.role as 'user' | 'assistant', text: o.text });
      }
      return {
        ownerRevision: r.ownerRevision as number, status: r.status as ConversationStatus, messages,
        cursor: r.cursor as string, streamGeneration: r.streamGeneration as number, sequence: r.sequence as number,
        ...(typeof r.snapshotTruncated === 'boolean' ? { snapshotTruncated: r.snapshotTruncated } : {}),
      };
    });
  }

  sendMessage(conversationId: string, clientMessageId: string, text: string, ownerRevision?: number): Promise<RemoteOutcome<{ clientMessageId: string; accepted: boolean; ownerRevision: number }>> {
    if (!isUuid(clientMessageId) || typeof text !== 'string' || !text.length || serializedJsonBytes(text) > 8192) return Promise.resolve(fail('payload_invalid'));
    return this.call(OPERATIONS['chat.send']!, { conversationId }, { clientMessageId, text }, ownerRevision, (v): { clientMessageId: string; accepted: boolean; ownerRevision: number } | null => {
      const r = v as Record<string, unknown>;
      return r?.clientMessageId === clientMessageId && typeof r.accepted === 'boolean' && Number.isSafeInteger(r.ownerRevision) && Object.keys(r).every(k => ['clientMessageId', 'accepted', 'ownerRevision'].includes(k))
        ? { clientMessageId, accepted: r.accepted as boolean, ownerRevision: r.ownerRevision as number } : null;
    });
  }

  stopConversation(conversationId: string, ownerRevision?: number): Promise<RemoteOutcome<{ stopped: boolean; ownerRevision: number }>> {
    return this.call(OPERATIONS['chat.stop']!, { conversationId }, {}, ownerRevision, (v): { stopped: boolean; ownerRevision: number } | null => {
      const r = v as Record<string, unknown>;
      return typeof r?.stopped === 'boolean' && Number.isSafeInteger(r.ownerRevision) && Object.keys(r).every(k => ['stopped', 'ownerRevision'].includes(k))
        ? { stopped: r.stopped as boolean, ownerRevision: r.ownerRevision as number } : null;
    });
  }

  listApprovals(conversationId: string): Promise<RemoteOutcome<{ approvals: RemoteApproval[] }>> {
    return this.call(OPERATIONS['approvals.list']!, { conversationId }, null, undefined, (v): { approvals: RemoteApproval[] } | null => parseApprovals(v));
  }

  respondToApproval(conversationId: string, requestId: string, method: ApprovalMethod, decision: ApprovalDecision, value?: string, ownerRevision?: number): Promise<RemoteOutcome<{ accepted: boolean; ownerRevision: number }>> {
    if (!METHODS.includes(method) || !['allow', 'deny', 'cancel', 'answer'].includes(decision)) return Promise.resolve(fail('payload_invalid'));
    // Decision matrix (contract): select→answer+value; confirm→allow/deny no value;
    // input/editor→answer+value or cancel no value.
    const matrix: Record<ApprovalMethod, { decisions: ApprovalDecision[]; valueOn: Record<string, 'required' | 'forbidden'> }> = {
      select: { decisions: ['answer'], valueOn: { answer: 'required' } },
      confirm: { decisions: ['allow', 'deny'], valueOn: { allow: 'forbidden', deny: 'forbidden' } },
      input: { decisions: ['answer', 'cancel'], valueOn: { answer: 'required', cancel: 'forbidden' } },
      editor: { decisions: ['answer', 'cancel'], valueOn: { answer: 'required', cancel: 'forbidden' } },
    };
    const rule = matrix[method];
    if (!rule.decisions.includes(decision)) return Promise.resolve(fail('payload_invalid'));
    const need = rule.valueOn[decision];
    if (need === 'required' && typeof value !== 'string') return Promise.resolve(fail('payload_invalid'));
    if (need === 'forbidden' && value !== undefined) return Promise.resolve(fail('payload_invalid'));
    if (method === 'select' && decision === 'answer' && !/^[A-Za-z0-9_-]{1,128}$/.test(value ?? '')) return Promise.resolve(fail('payload_invalid'));
    if (value !== undefined && utf8Bytes(value) > 2000) return Promise.resolve(fail('payload_invalid'));
    const payload: Record<string, unknown> = { method, decision, ...(value === undefined ? {} : { value }) };
    return this.call(OPERATIONS['approvals.respond']!, { conversationId, requestId }, payload, ownerRevision, (v): { accepted: boolean; ownerRevision: number } | null => {
      const r = v as Record<string, unknown>;
      return typeof r?.accepted === 'boolean' && Number.isSafeInteger(r.ownerRevision) && Object.keys(r).every(k => ['accepted', 'ownerRevision'].includes(k))
        ? { accepted: r.accepted as boolean, ownerRevision: r.ownerRevision as number } : null;
    });
  }
}

function parseApprovals(v: unknown): { approvals: RemoteApproval[] } | null {
  const r = v as Record<string, unknown>;
  if (!Array.isArray(r?.approvals) || Object.keys(r).some(k => k !== 'approvals')) return null;
  const approvals: RemoteApproval[] = [];
  for (const a of r.approvals as unknown[]) {
    const o = a as Record<string, unknown>;
    if (!isOpaqueId(o?.requestId) || !METHODS.includes(o.method as ApprovalMethod)
      || typeof o.title !== 'string' || o.title.length > 200 || typeof o.message !== 'string' || o.message.length > 600
      || Object.keys(o).some(k => !['requestId', 'method', 'title', 'message', 'options'].includes(k))) return null;
    let options: { optionId: string; label: string }[] | undefined;
    if (o.options !== undefined) {
      if (!Array.isArray(o.options) || o.options.length > 20) return null;
      options = [];
      const seen = new Set<string>();
      for (const opt of o.options as unknown[]) {
        const oo = opt as Record<string, unknown>;
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(String(oo?.optionId ?? '')) || typeof oo.label !== 'string' || oo.label.length > 200
          || seen.has(oo.optionId as string) || Object.keys(oo).some(k => !['optionId', 'label'].includes(k))) return null;
        seen.add(oo.optionId as string);
        options.push({ optionId: oo.optionId as string, label: oo.label });
      }
    }
    approvals.push({ requestId: o.requestId, method: o.method as ApprovalMethod, title: o.title, message: o.message, ...(options ? { options } : {}) });
  }
  return { approvals };
}

function parseError(value: unknown, requestId: string): { code: RemoteErrorCode; retryable: boolean } {
  const r = value as Record<string, unknown>;
  const err = r?.error as Record<string, unknown> | undefined;
  if (!r || r.protocolVersion !== 1 || typeof err?.code !== 'string' || !ERROR_CODES.includes(err.code as RemoteErrorCode)
    || typeof err.retryable !== 'boolean' || Object.keys(err).sort().join(',') !== 'code,retryable'
    || Object.keys(r).sort().join(',') !== 'error,protocolVersion,requestId') return { code: 'internal_error', retryable: false };
  const rid = r.requestId;
  // The ZERO_UUID sentinel is ONLY a closed uncorrelated 'unauthorized' error.
  if (rid === ZERO_REQUEST_ID && err.code !== 'unauthorized') return { code: 'internal_error', retryable: false };
  if (rid !== requestId && rid !== ZERO_REQUEST_ID) return { code: 'internal_error', retryable: false };
  return { code: err.code as RemoteErrorCode, retryable: err.retryable === true };
}

function fail<T>(code: RemoteErrorCode, retryable = false): RemoteOutcome<T> { return { ok: false, code, retryable }; }

export { b64urlEncode, canonicalJson };

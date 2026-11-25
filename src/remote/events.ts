/**
 * Event stream client (remote/v1). Device-level subscription per frozen
 * contract: frames arrive over an injected stream transport; each frame is
 * validated (envelope + pinned service key + scope + position) before the UI
 * store sees it. Position tracking follows the contract: ordinary frames need
 * (expectedGeneration, expectedSequence); a 'reset' frame advances the
 * generation and occupies its own sequence — the next ordinary frame must
 * carry reset.sequence+1.
 *
 * Cursor is opaque: stored, echoed on resubscribe, never parsed or minted by
 * the client. Malformed cursors are rejected by the gateway; stale/foreign
 * cursors produce a new-generation reset which rebuilds the local baseline.
 */
import type { ConversationStatus, CryptoProvider, DeviceCredentials, EventEnvelope, RemoteApproval, RemoteMessage, Scope, SignedRequest } from './types';
import { canonicalJson, hasForbiddenKey, hasForbiddenValue, isOpaqueId, serializedJsonBytes, sha256hex, utf8Bytes } from './wire';

const EVENTS = ['snapshot', 'message.append', 'conversation.status', 'approval.pending', 'approval.settled', 'reset'] as const;
type EventName = (typeof EVENTS)[number];
const EVENT_SCOPE: Record<EventName, Scope> = {
  snapshot: 'sessions.read',
  'message.append': 'sessions.read',
  'conversation.status': 'sessions.read',
  reset: 'sessions.read',
  'approval.pending': 'approvals.read',
  'approval.settled': 'approvals.read',
};
const MAX_FRAME_BYTES = 65536;

export interface StreamTransport {
  /** Open the device-level stream; the transport calls onFrame in emission order. */
  subscribe(request: SignedRequest, onFrame: (frame: unknown) => void, onClose: (reason: string) => void, onOpen?: () => void): { close(): void };
}

export interface Position { streamGeneration: number; sequence: number }

export interface AppliedEvent {
  event: EventName;
  conversationId: string;
  ownerRevision: number;
  payload: Record<string, unknown>;
  cursor: string;
  streamGeneration: number;
  sequence: number;
}

type FrameError = 'frame_invalid' | 'frame_context_required' | 'frame_signature_invalid' | 'scope_denied' | 'sequence_gap' | 'unknown_resource';
type FrameResult =
  | { ok: true; applied: AppliedEvent; position: Position; isReset: boolean }
  | { ok: false; code: FrameError };

export interface EventClientOptions {
  credentials: DeviceCredentials;
  crypto: CryptoProvider;
  /** Re-validates that the frame's resource is still authorized for this device — mirrors frameAuthentication.resourceAuthorization.
   *  Contract resourceAuthorization: the callback is MANDATORY for every ordinary frame and receives
   *  {deviceId, serviceId, conversationId, ownerRevision, event} (round-6 S25). */
  authorizeResource: (context: { deviceId: string; serviceId: string; conversationId: string; ownerRevision: number; event: EventName }) => boolean;
  onReset: (reason: string) => void;
  onEvent: (applied: AppliedEvent) => void;
  onDrop?: (code: string) => void;
  /** Called once when the stream dies irrecoverably (sequence gap). The UI
   *  surfaces this and the only recovery is a close+reopen that resubscribes
   *  — a stale/foreign cursor then forces a reset-rebuild of the baseline. */
  onStreamError?: (code: string) => void;
  /** Transport reports a successful pinned HTTP/SSE admission, never task creation. */
  onConnected?: () => void;
}

const ENVELOPE_KEYS = new Set(['protocolVersion', 'sequence', 'conversationId', 'ownerRevision', 'event', 'payload', 'streamGeneration', 'cursor', 'frameSignature']);
export function validateEventEnvelope(event: unknown): event is EventEnvelope {
  if (event === null || typeof event !== 'object' || Array.isArray(event)) return false;
  const e = event as Record<string, unknown>;
  // Contract eventStream.eventEnvelope.additionalProperties: false — the
  // shape is CLOSED. Unknown top-level keys are unsigned covert channel.
  if (Object.keys(e).some(k => !ENVELOPE_KEYS.has(k))) return false;
  if (e.protocolVersion !== 1 || !Number.isSafeInteger(e.sequence) || (e.sequence as number) < 1) return false;
  if (!isOpaqueId(e.conversationId) || !Number.isSafeInteger(e.ownerRevision) || !EVENTS.includes(e.event as EventName)) return false;
  if (!Number.isSafeInteger(e.streamGeneration) || (e.streamGeneration as number) < 1) return false;
  if (typeof e.cursor !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(e.cursor)) return false;
  if (typeof e.frameSignature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(e.frameSignature)) return false;
  if (e.event === 'reset' && e.conversationId !== 'stream-reset') return false;
  if (e.event !== 'reset' && e.conversationId === 'stream-reset') return false;
  // Contract parity (contract.mjs validateEventEnvelope): reject forbidden
  // keys anywhere on the envelope, and forbidden keys/values inside the
  // payload — free-text fields would otherwise carry unscreened paths or
  // credentials into the UI store over the signed frame channel.
  if (hasForbiddenKey(e)) return false;
  const canonical = canonicalJson(e);
  if (canonical === null || utf8Bytes(canonical) > MAX_FRAME_BYTES) return false;
  return validatePayload(e.event as EventName, e.payload)
    && !hasForbiddenKey(e.payload)
    && !hasForbiddenValue(e.payload, 0, ['payload']);
}

function validatePayload(event: EventName, payload: unknown): boolean {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const p = payload as Record<string, unknown>;
  const keys = Object.keys(p);
  const has = (allowed: string[]) => keys.every(k => allowed.includes(k));
  switch (event) {
    case 'snapshot': {
      if (!has(['status', 'messages', 'snapshotTruncated']) || !['idle', 'running', 'stopping', 'error', 'unknown'].includes(p.status as string)) return false;
      if (!Array.isArray(p.messages) || (p.messages as unknown[]).length > 500) return false;
      return (p.messages as unknown[]).every(m => isMessage(m));
    }
    case 'message.append': return has(['messageId', 'role', 'text']) && isMessage(p);
    case 'conversation.status': return has(['status']) && ['idle', 'running', 'stopping', 'error', 'unknown'].includes(p.status as string);
    case 'approval.pending': {
      if (!has(['requestId', 'method', 'title', 'message', 'options']) || !isOpaqueId(p.requestId) || !['select', 'confirm', 'input', 'editor'].includes(p.method as string)) return false;
      if (typeof p.title !== 'string' || (p.title as string).length > 200 || typeof p.message !== 'string' || (p.message as string).length > 600) return false;
      if (p.options === undefined) return true;
      if (!Array.isArray(p.options) || (p.options as unknown[]).length > 20) return false;
      const seen = new Set<string>();
      return (p.options as unknown[]).every(o => {
        const oo = o as Record<string, unknown>;
        const id = oo?.optionId;
        return typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id) && typeof oo.label === 'string' && (oo.label as string).length <= 200
          && !seen.has(id) && seen.add(id) && Object.keys(oo).every(k => ['optionId', 'label'].includes(k));
      });
    }
    case 'approval.settled': return has(['requestId', 'status']) && isOpaqueId(p.requestId) && ['allowed', 'denied', 'cancelled', 'answered', 'expired'].includes(p.status as string);
    case 'reset': return has(['reason']) && ['cursor_expired', 'sequence_gap', 'authorization_changed', 'owner_changed'].includes(p.reason as string);
  }
}

const isMessage = (m: unknown): m is RemoteMessage => {
  const o = m as Record<string, unknown>;
  return o !== null && typeof o === 'object' && isOpaqueId(o.messageId) && ['user', 'assistant'].includes(o.role as string)
    && typeof o.text === 'string' && serializedJsonBytes(o.text) <= 8192 && Object.keys(o).every(k => ['messageId', 'role', 'text'].includes(k));
};

export function buildEventFrameMessage(event: EventEnvelope, deviceId: string, serviceId: string): string | null {
  const payloadCanonical = canonicalJson(event.payload);
  if (payloadCanonical === null) return null;
  return [String(event.protocolVersion), deviceId, serviceId, String(event.streamGeneration), String(event.sequence), event.conversationId, String(event.ownerRevision), event.cursor, event.event, sha256hex(payloadCanonical)].join('\n');
}

export class EventStreamClient {
  private readonly credentials: DeviceCredentials;
  private readonly crypto: CryptoProvider;
  private readonly authorize: EventClientOptions['authorizeResource'];
  private readonly onReset: EventClientOptions['onReset'];
  private readonly onEvent: EventClientOptions['onEvent'];
  private readonly onDrop: EventClientOptions['onDrop'];
  private readonly onStreamError: EventClientOptions['onStreamError'];
  private readonly onConnected: EventClientOptions['onConnected'];
  private subscriptionSerial = 0;
  private position: Position | undefined;
  private cursor: string | undefined;
  private handle: { close(): void } | null = null;

  constructor(options: EventClientOptions) {
    this.credentials = options.credentials;
    this.crypto = options.crypto;
    this.authorize = options.authorizeResource;
    this.onReset = options.onReset;
    this.onEvent = options.onEvent;
    this.onDrop = options.onDrop ?? (() => {});
    this.onStreamError = options.onStreamError ?? (() => {});
    this.onConnected = options.onConnected ?? (() => {});
  }

  latestCursor(): string | undefined { return this.cursor; }
  expectedPosition(): Position | undefined { return this.position; }

  /** A snapshot's sequence is the NEXT expected frame. Passing its atomic
   *  watermark detects loss of the first replayed frame as well as later gaps.
   *  Callers without a trusted watermark retain the frozen fresh-subscribe
   *  behavior; opaque cursors are never parsed to invent a position. */
  open(stream: StreamTransport, request: SignedRequest, cursor?: string, watermark?: { generation: number; sequence: number }): void {
    this.close();
    const serial = this.subscriptionSerial;
    if (watermark && (!cursor || !Number.isSafeInteger(watermark.generation) || watermark.generation < 1
      || !Number.isSafeInteger(watermark.sequence) || watermark.sequence < 1)) throw new Error('invalid_watermark');
    this.cursor = cursor;
    this.position = watermark ? { streamGeneration: watermark.generation, sequence: watermark.sequence - 1 } : undefined;
    this.dead = null;
    this.handle = stream.subscribe(request,
      frame => { if (serial === this.subscriptionSerial) this.accept(frame); },
      () => {
        if (serial !== this.subscriptionSerial || this.dead) return;
        this.dead = 'stream_closed';
        this.onStreamError?.('stream_closed');
        this.onDrop?.('closed:stream_closed');
      },
      () => { if (serial === this.subscriptionSerial && !this.dead) this.onConnected?.(); });
  }

  /** Irrecoverable stream death (sequence gap). UI-facing, drives the reload affordance. */
  streamError(): string | undefined { return this.dead ?? undefined; }

  close(): void {
    this.subscriptionSerial += 1;
    this.handle?.close();
    this.handle = null;
  }

  /** Frame acceptance — structural validity + signature + scope + position. */
  accept(frame: unknown): FrameResult {
    if (this.dead) return this.drop('sequence_gap');
    if (!validateEventEnvelope(frame)) return this.drop('frame_invalid');
    const message = buildEventFrameMessage(frame, this.credentials.deviceId, this.credentials.serviceId);
    if (message === null || !this.crypto.verify(this.credentials.servicePublicKey, frame.frameSignature, message)) return this.drop('frame_signature_invalid');
    const requiredScope = EVENT_SCOPE[frame.event];
    if (!this.credentials.grantedScopes.includes(requiredScope)) return this.drop('scope_denied');
    if (frame.event === 'reset') {
      if (this.position !== undefined && !(frame.streamGeneration > this.position.streamGeneration)) return this.drop('sequence_gap');
      const position: Position = { streamGeneration: frame.streamGeneration, sequence: frame.sequence };
      this.position = position;
      this.cursor = frame.cursor;
      this.onReset(String((frame.payload as Record<string, unknown>).reason));
      // The reset is an APPLIED event: it must reach the store through the
      // same onEvent path as ordinary frames or the baseline rebuild never
      // happens in production wiring (onReset is informational only).
      const applied = this.toApplied(frame);
      this.onEvent(applied);
      return { ok: true, applied, position, isReset: true };
    }
    // Position continuity (ADR-0010 / M4 fault-injection semantics):
    //   - REWIND (older generation, or sequence at-or-below the position):
    //     the frame's effects are already in the store — exactly-once replay
    //     out of a backlog, duplicated network delivery, and reordered stale
    //     arrivals all land here. Drop SILENTLY: reordering/duplication must
    //     not corrupt state, and no new information is lost by ignoring a
    //     frame whose effects we already hold.
    //   - GAP (same generation, sequence ahead of position+1): intermediate
    //     frames are missing and their effects can never be reconstructed
    //     locally — terminal death, recovery via snapshot watermark resume.
    if (this.position !== undefined) {
      if (frame.streamGeneration < this.position.streamGeneration) return this.drop('sequence_gap');
      if (frame.streamGeneration > this.position.streamGeneration) {
        // A non-reset frame of a NEWER generation means the reset that opens
        // that generation's isolated space was missed — jumping in would skip
        // the mandatory baseline rebuild. Terminal death; watermark recovery.
        return this.fatal('sequence_gap');
      }
      if (frame.sequence <= this.position.sequence) return this.drop('sequence_gap');
      if (frame.sequence !== this.position.sequence + 1) return this.fatal('sequence_gap');
    }
    let granted = false;
    try {
      granted = this.authorize({ deviceId: this.credentials.deviceId, serviceId: this.credentials.serviceId, conversationId: frame.conversationId, ownerRevision: frame.ownerRevision, event: frame.event }) === true;
    } catch { granted = false; }
    // Contract acceptance (round-6 S22): a frame whose authorization fails is
    // dropped AND the stream is reset — never a silent drop. Client-side the
    // reset is a terminal death: recovery resubscribes through the snapshot
    // watermark path. A silent drop would let the same frame apply later if
    // authorization flipped back, corrupting ordering.
    if (!granted) return this.fatal('unknown_resource');
    this.position = { streamGeneration: frame.streamGeneration, sequence: frame.sequence };
    this.cursor = frame.cursor;
    const applied = this.toApplied(frame);
    this.onEvent(applied);
    return { ok: true, applied, position: this.position, isReset: false };
  }

  private toApplied(frame: EventEnvelope): AppliedEvent {
    return { event: frame.event, conversationId: frame.conversationId, ownerRevision: frame.ownerRevision, payload: frame.payload, cursor: frame.cursor, streamGeneration: frame.streamGeneration, sequence: frame.sequence };
  }

  private drop(code: FrameError): { ok: false; code: FrameError } {
    this.onDrop?.(code);
    return { ok: false, code };
  }

  /** A continuity break cannot self-heal: every later frame in this generation
   *  keeps gapping, so the stream is declared dead once, onStreamError fires,
   *  and further frames are rejected until open() resubscribes. */
  private fatal(code: FrameError): { ok: false; code: FrameError } {
    if (!this.dead) {
      this.dead = code;
      this.onStreamError?.(code);
    }
    return this.drop(code);
  }

  private dead: string | null = null;
}



export type { AppliedEvent as AppliedRemoteEvent };
export type ApprovalPayload = RemoteApproval;
export type StatusPayload = { status: ConversationStatus };

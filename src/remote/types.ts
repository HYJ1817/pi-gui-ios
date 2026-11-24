/**
 * Remote v1 mobile client — shared types. The wire shapes mirror the frozen
 * contract docs/contracts/remote-v1.json (status frozen-v1); anything the UI
 * sees arrived through the typed client, never from raw transport.
 *
 * Remote access stays synthetic/offline in this phase: the demo surface pairs
 * against an in-app sandbox gateway with a deterministic synthetic signer.
 * Real TLS transport + real Ed25519 keys arrive with the production adapter;
 * no path here carries secrets, absolute paths, tokens or raw errors.
 */

export const REMOTE_PROTOCOL_VERSION = 1 as const;

/** Contract scope vocabulary (closed set, order irrelevant). */
export type Scope =
  | 'projects.read'
  | 'sessions.read'
  | 'sessions.create'
  | 'approvals.read'
  | 'chat.send'
  | 'chat.stop'
  | 'approvals.respond';

/** Closed wire error vocabulary (responseEnvelope.errorCodes). */
export type RemoteErrorCode =
  | 'unauthorized' | 'pairing_required' | 'pairing_expired' | 'pairing_rejected'
  | 'rate_limited' | 'scope_denied' | 'stale_owner' | 'stale_revision'
  | 'unknown_resource' | 'operation_rejected' | 'replay_rejected'
  | 'sequence_gap' | 'server_busy' | 'unavailable' | 'invalid_request'
  | 'payload_invalid' | 'internal_error';

/** The 8 business operations + the event stream + the unauthenticated pair op. */
export type OperationId =
  | 'projects.list' | 'sessions.list' | 'runtime.create' | 'runtime.snapshot'
  | 'chat.send' | 'chat.stop' | 'approvals.list' | 'approvals.respond'
  | 'events.subscribe' | 'pair.exchange';

export interface RemoteProject { projectId: string; displayName: string; }
export interface RemoteSession {
  sessionId: string;
  displayName: string;
  updatedAt: string;
  projectId: string;
  activeConversations: { conversationId: string }[];
}
export interface RemoteMessage {
  messageId: string;
  role: 'user' | 'assistant';
  text: string;
}
export type ConversationStatus = 'idle' | 'running' | 'stopping' | 'error' | 'unknown';
export interface ApprovalOption { optionId: string; label: string; }
export type ApprovalMethod = 'select' | 'confirm' | 'input' | 'editor';
export interface RemoteApproval {
  requestId: string;
  method: ApprovalMethod;
  title: string;
  message: string;
  options?: ApprovalOption[];
}
export type ApprovalDecision = 'allow' | 'deny' | 'cancel' | 'answer';

export interface EventEnvelope {
  protocolVersion: number;
  sequence: number;
  conversationId: string;
  ownerRevision: number;
  event: 'snapshot' | 'message.append' | 'conversation.status' | 'approval.pending' | 'approval.settled' | 'reset';
  payload: Record<string, unknown>;
  streamGeneration: number;
  cursor: string;
  frameSignature: string;
}

/** Device-side result of pair.exchange, exactly the granted surface. */
export interface DeviceCredentials {
  deviceId: string;
  /** base64url-no-pad 32-byte device public key */
  devicePublicKey: string;
  grantedScopes: Scope[];
  /** replay epoch minted by the registration transaction (NOT always 1) */
  replayEpoch: number;
  expiresAt: string;
  /** lowercase hex SHA-256 of the pinned TLS/service identity */
  serviceFingerprint: string;
  /** 'svc-' + serviceFingerprint[0:16] */
  serviceId: string;
  /** base64url-no-pad 32-byte pinned desktop service public key (frame verification) */
  servicePublicKey: string;
}

/**
 * Signing transport. The client only ever emits the closed operation surface;
 * the adapter decides HOW the signed request physically travels (HTTPS in
 * production, in-process for the synthetic sandbox). Request/response are the
 * validated contract forms — the adapter never sees raw secrets either.
 */
export interface SignedRequest {
  method: 'GET' | 'POST';
  /** path template filled with opaque pathParameters; never client-composed */
  path: string;
  query?: Record<string, string>;
  headers: Record<string, string>;
  rawBody: string;
}
export interface SignedResponse {
  status: number;
  /** exact UTF-8 response bytes */
  body: string;
}
export interface Transport {
  send(request: SignedRequest): Promise<SignedResponse>;
}

/**
 * Crypto providers. `sign` produces base64url-no-pad 64-byte Ed25519
 * signatures over the canonical signed message; `serviceVerify` checks frames
 * and pair responses against the PINNED service key. `randomBytes` yields
 * base64url-no-pad strings of the requested byte length.
 */
export interface CryptoProvider {
  sign(message: string): string;
  verify(publicKeyRaw: string, signature: string, message: string): boolean;
  randomBytes(length: number): string;
}

export interface RemoteSuccess<T> { ok: true; result: T; serverRevision: number; }
export interface RemoteFailure { ok: false; code: RemoteErrorCode; retryable: boolean; }
export type RemoteOutcome<T> = RemoteSuccess<T> | RemoteFailure;

/** Public client API surface — the ONLY operations the UI/store can call. */
export interface RemoteClient {
  credentials(): DeviceCredentials;
  listProjects(): Promise<RemoteOutcome<{ projects: RemoteProject[]; registryRevision: number }>>;
  listSessions(projectId: string): Promise<RemoteOutcome<{ sessions: RemoteSession[] }>>;
  createConversation(projectId: string, clientConversationId: string, ownerRevision?: number): Promise<RemoteOutcome<{ conversationId: string; ownerRevision: number }>>;
  snapshot(conversationId: string): Promise<RemoteOutcome<{
    ownerRevision: number; status: ConversationStatus; messages: RemoteMessage[];
    cursor: string; streamGeneration: number; sequence: number; snapshotTruncated?: boolean;
  }>>;
  sendMessage(conversationId: string, clientMessageId: string, text: string, ownerRevision?: number): Promise<RemoteOutcome<{ clientMessageId: string; accepted: boolean; ownerRevision: number }>>;
  stopConversation(conversationId: string, ownerRevision?: number): Promise<RemoteOutcome<{ stopped: boolean; ownerRevision: number }>>;
  listApprovals(conversationId: string): Promise<RemoteOutcome<{ approvals: RemoteApproval[] }>>;
  respondToApproval(conversationId: string, requestId: string, method: ApprovalMethod, decision: ApprovalDecision, value?: string, ownerRevision?: number): Promise<RemoteOutcome<{ accepted: boolean; ownerRevision: number }>>;
}

export const MAX_REQUEST_BYTES = 262144;
export const MAX_RESPONSE_BYTES = 1048576;
export const MAX_TRANSCRIPT_BYTES = 8192;
export const MAX_SNAPSHOT_MESSAGES = 500;
export const MAX_SESSIONS = 200;
export const MAX_APPROVALS = 100;
export const ZERO_REQUEST_ID = '00000000-0000-0000-0000-000000000000';

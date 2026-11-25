/**
 * Conversation store — the ONLY state the UI consumes. It drives the typed
 * client + event stream, applies the closed payload set, keeps bounded lists,
 * and never surfaces transport internals, paths, tokens or raw errors.
 *
 * Reconnect semantics (M4 will deepen this): the subscription carries an
 * opaque cursor; on reset the store rebuilds the baseline from the latest
 * frames and re-pulls snapshots for open conversations.
 */
import type {
  ConversationStatus, RemoteApproval, RemoteClient, RemoteMessage, RemoteProject, RemoteSession,
} from './types';
import type { AppliedRemoteEvent, EventStreamClient } from './events';
import { MAX_APPROVALS, MAX_SESSIONS, MAX_SNAPSHOT_MESSAGES } from './types';

export interface ConversationState {
  status: ConversationStatus;
  messages: RemoteMessage[];
  ownerRevision: number;
  approvals: RemoteApproval[];
  snapshotTruncated: boolean;
  loaded: boolean;
  /** ADR-0010 D1: atomic resume point returned by the latest snapshot —
   *  cursor+generation+sequence are consistent with exactly this baseline.
   *  The stream can always be resumed from here without a gap window. */
  watermark: { cursor: string; generation: number; sequence: number } | null;
}

export interface StoreState {
  projects: RemoteProject[];
  sessions: RemoteSession[];
  registryRevision: number;
  conversations: Record<string, ConversationState>;
  /** per-requestId resolution flag so a settled approval greys out instantly */
  decided: Record<string, 'allowed' | 'denied' | 'cancelled' | 'answered' | 'expired'>;
  lastError: string | null;
  /** ADR-0010 D6: dedicated stream-state channel — never multiplexed through
   *  lastError so operation failures cannot mask a dead stream (M3 note F3). */
  stream: { state: 'live' | 'dead' | 'recovering' };
}

const EMPTY: ConversationState = { status: 'unknown', messages: [], ownerRevision: 0, approvals: [], snapshotTruncated: false, loaded: false, watermark: null };

export class ConversationStore {
  private readonly client: RemoteClient;
  private readonly events: EventStreamClient;
  private state: StoreState = { projects: [], sessions: [], registryRevision: 0, conversations: {}, decided: {}, lastError: null, stream: { state: 'live' } };
  private listeners = new Set<() => void>();
  private version = 0;

  constructor(client: RemoteClient, events: EventStreamClient) {
    this.client = client;
    this.events = events;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  snapshot(): StoreState { return this.state; }
  getVersion(): number { return this.version; }

  private setState(patch: Partial<StoreState>): void {
    this.state = { ...this.state, ...patch };
    this.version += 1;
    for (const l of this.listeners) l();
  }

  private bumpRevision(conversationId: string, revision: number): void {
    // The outcome revision is minted before post-mutation effects (e.g. the
    // scripted assistant reply) bump the owner again and emit frames with a
    // HIGHER revision — never regress the stream-tracked value.
    if (revision > this.conversation(conversationId).ownerRevision) {
      this.setConversation(conversationId, { ownerRevision: revision });
    }
  }

  private setConversation(conversationId: string, patch: Partial<ConversationState>): void {
    const current = this.state.conversations[conversationId] ?? EMPTY;
    this.setState({ conversations: { ...this.state.conversations, [conversationId]: { ...current, ...patch } } });
  }

  conversation(id: string): ConversationState { return this.state.conversations[id] ?? EMPTY; }

  /** Irrecoverable stream death (ADR-0010 D6): the dedicated stream channel
   *  flips to 'dead' — immune to later lastError writes; the UI's recovery
   *  affordance keys off this, never off operation errors. */
  markStreamError(): void {
    if (this.state.stream.state !== 'dead') this.setState({ stream: { state: 'dead' } });
  }
  /** Recovery bookkeeping: 'recovering' while baselines re-pull, back to
   *  'live' once the stream is re-established at the watermark. */
  markStreamRecovering(): void {
    if (this.state.stream.state !== 'recovering') this.setState({ stream: { state: 'recovering' } });
  }
  markStreamLive(): void {
    if (this.state.stream.state !== 'live') this.setState({ stream: { state: 'live' } });
  }
  streamErrorActive(): boolean { return this.state.stream.state !== 'live'; }

  /** All snapshots must be covered by the resume point. Starting from the
   *  oldest baseline replays mutations that happened while later snapshots
   *  were being fetched. Per-conversation watermarks below suppress effects
   *  already included in a newer baseline. */
  latestWatermarkCursor(): string | undefined { return this.latestWatermark()?.cursor; }
  latestWatermark(): { cursor: string; sequence: number; generation: number } | undefined {
    let oldest: { cursor: string; sequence: number; generation: number } | null = null;
    for (const conv of Object.values(this.state.conversations)) {
      const watermark = conv.watermark;
      if (watermark && (oldest === null || watermark.generation < oldest.generation
        || (watermark.generation === oldest.generation && watermark.sequence < oldest.sequence))) oldest = watermark;
    }
    return oldest ? { ...oldest } : undefined;
  }

  /** Bootstrap: projects + sessions + all known snapshots. */
  async load(): Promise<void> {
    const projects = await this.client.listProjects();
    if (!projects.ok) { this.setState({ lastError: projects.code }); return; }
    let sessions: RemoteSession[] = [];
    for (const project of projects.result.projects) {
      const out = await this.client.listSessions(project.projectId);
      if (!out.ok) { this.setState({ lastError: out.code }); return; }
      sessions = sessions.concat(out.result.sessions);
    }
    sessions = sessions.slice(0, MAX_SESSIONS);
    const activeIds = new Set(sessions.flatMap(session => session.activeConversations.map(active => active.conversationId)));
    const conversations = Object.fromEntries(Object.entries(this.state.conversations).filter(([id]) => activeIds.has(id)));
    this.setState({ projects: projects.result.projects, sessions, conversations, registryRevision: projects.result.registryRevision, lastError: null });
    // Authorization can rotate while the individual baselines are fetched.
    // Never resume a set of snapshots from incompatible cursor spaces.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      for (const id of activeIds) if (!await this.refresh(id)) return;
      const generations = new Set([...activeIds].map(id => this.conversation(id).watermark?.generation));
      if (generations.size <= 1) return;
    }
    this.setState({ lastError: 'sequence_gap', stream: { state: 'dead' } });
  }

  async refresh(conversationId: string): Promise<boolean> {
    const snap = await this.client.snapshot(conversationId);
    if (!snap.ok) { this.setState({ lastError: snap.code }); return false; }
    // Live frames may have advanced the tracked revision past the snapshot
    // (e.g. a reset-triggered refresh racing an in-flight mutation). Never
    // downgrade messages/status with a stale baseline — approvals still
    // re-pull below regardless.
    // ADR-0010 D1: the watermark is adopted even when the body is skipped as
    // stale — it is the SERVER's atomic resume point, always safe to keep.
    const watermark = {
      cursor: snap.result.cursor,
      generation: snap.result.streamGeneration,
      sequence: snap.result.sequence,
    };
    const current = this.conversation(conversationId);
    if (current.watermark && watermark.generation < current.watermark.generation) {
      this.setState({ lastError: 'sequence_gap' }); return false;
    }
    if (snap.result.ownerRevision < current.ownerRevision && (!current.watermark || watermark.generation === current.watermark.generation)) {
      this.setConversation(conversationId, { loaded: true, watermark });
    } else {
      this.setConversation(conversationId, {
        status: snap.result.status,
        messages: snap.result.messages.slice(-MAX_SNAPSHOT_MESSAGES),
        ownerRevision: snap.result.ownerRevision,
        snapshotTruncated: snap.result.snapshotTruncated === true,
        loaded: true,
        watermark,
      });
    }
    if (this.client.credentials().grantedScopes.includes('approvals.read')) {
      const approvals = await this.client.listApprovals(conversationId);
      if (!approvals.ok) { this.setState({ lastError: approvals.code }); return false; }
      this.setConversation(conversationId, { approvals: approvals.result.approvals.slice(0, MAX_APPROVALS) });
    } else {
      this.setConversation(conversationId, { approvals: [] });
    }
    return true;
  }

  /** Apply one validated stream event — the ONLY mutation path for live data. */
  apply(applied: AppliedRemoteEvent): void {
    const { event, conversationId, payload } = applied;
    if (event === 'reset') {
      // New generation: rebuild every open conversation's baseline.
      const ids = Object.keys(this.state.conversations);
      void Promise.all(ids.map(id => this.refresh(id)));
      return;
    }
    // EventStreamClient still consumes every position. The store ignores
    // effects strictly before this conversation's atomic snapshot watermark,
    // so replaying from another conversation's older baseline cannot restore
    // stale chunks, statuses or already-settled approvals.
    const baseline = this.conversation(conversationId).watermark;
    if (baseline && (applied.streamGeneration < baseline.generation
      || (applied.streamGeneration === baseline.generation && applied.sequence < baseline.sequence))) return;
    if (event === 'snapshot') {
      this.setConversation(conversationId, {
        status: (payload.status as ConversationStatus) ?? 'unknown',
        messages: ((payload.messages as RemoteMessage[]) ?? []).slice(-MAX_SNAPSHOT_MESSAGES),
        ownerRevision: applied.ownerRevision,
        snapshotTruncated: payload.snapshotTruncated === true,
        loaded: true,
      });
      return;
    }
    // Every conversation-scoped frame carries the authoritative ownerRevision;
    // keep the highest seen so mutations always claim the current revision.
    if (applied.ownerRevision > this.conversation(conversationId).ownerRevision) {
      this.setConversation(conversationId, { ownerRevision: applied.ownerRevision });
    }
    if (event === 'message.append') {
      const current = this.conversation(conversationId);
      const message = payload as unknown as RemoteMessage;
      // ADR-0010 D3 chunk-append: repeated frames for the SAME messageId are
      // progressive chunks — each carries the complete text SO FAR, so the
      // later frame replaces the earlier one (upsert), never a new bubble.
      // Exactly-once replay of the identical text is a no-op by construction.
      const existing = current.messages.findIndex(m => m.messageId === message.messageId);
      if (existing >= 0) {
        if (current.messages[existing]!.text === message.text) return;
        const merged = [...current.messages];
        merged[existing] = message;
        this.setConversation(conversationId, { messages: merged.slice(-MAX_SNAPSHOT_MESSAGES) });
        return;
      }
      this.setConversation(conversationId, { messages: [...current.messages, message].slice(-MAX_SNAPSHOT_MESSAGES) });
      return;
    }
    if (event === 'conversation.status') {
      this.setConversation(conversationId, { status: payload.status as ConversationStatus });
      return;
    }
    if (event === 'approval.pending') {
      const current = this.conversation(conversationId);
      const approval = payload as unknown as RemoteApproval;
      if (current.approvals.some(a => a.requestId === approval.requestId)) return;
      this.setConversation(conversationId, { approvals: [...current.approvals, approval].slice(0, MAX_APPROVALS) });
      return;
    }
    if (event === 'approval.settled') {
      const requestId = String(payload.requestId);
      const status = payload.status as StoreState['decided'][string];
      const current = this.conversation(conversationId);
      this.setConversation(conversationId, { approvals: current.approvals.filter(a => a.requestId !== requestId) });
      const decided = { ...this.state.decided, [requestId]: status };
      // Bounded decided map: keep the most recent 500 settled requestIds.
      const keys = Object.keys(decided);
      if (keys.length > 500) for (const k of keys.slice(0, keys.length - 500)) delete decided[k];
      this.setState({ decided });
      return;
    }
  }

  async sendMessage(conversationId: string, text: string, clientMessageId: string): Promise<{ ok: boolean; code?: string }> {
    const outcome = await this.client.sendMessage(conversationId, clientMessageId, text, this.conversation(conversationId).ownerRevision);
    if (!outcome.ok) {
      this.setState({ lastError: outcome.code });
      if (outcome.code === 'stale_revision' || outcome.code === 'stale_owner') await this.refresh(conversationId);
      return { ok: false, code: outcome.code };
    }
    this.bumpRevision(conversationId, outcome.result.ownerRevision);
    return { ok: true };
  }

  async stop(conversationId: string): Promise<{ ok: boolean; code?: string }> {
    const outcome = await this.client.stopConversation(conversationId, this.conversation(conversationId).ownerRevision);
    if (!outcome.ok) {
      this.setState({ lastError: outcome.code });
      if (outcome.code === 'stale_revision' || outcome.code === 'stale_owner') await this.refresh(conversationId);
      return { ok: false, code: outcome.code };
    }
    this.bumpRevision(conversationId, outcome.result.ownerRevision);
    return { ok: true };
  }

  async respond(conversationId: string, requestId: string, method: 'select' | 'confirm' | 'input' | 'editor', decision: 'allow' | 'deny' | 'cancel' | 'answer', value?: string): Promise<{ ok: boolean; code?: string }> {
    const outcome = await this.client.respondToApproval(conversationId, requestId, method, decision, value, this.conversation(conversationId).ownerRevision);
    if (!outcome.ok) {
      this.setState({ lastError: outcome.code });
      // Stale/expired/other-owner decisions refresh the approval surface.
      if (outcome.code === 'stale_owner' || outcome.code === 'stale_revision' || outcome.code === 'unknown_resource') {
        this.setState({ decided: { ...this.state.decided, [requestId]: 'expired' } });
        await this.refresh(conversationId);
      }
      return { ok: false, code: outcome.code };
    }
    this.bumpRevision(conversationId, outcome.result.ownerRevision);
    return { ok: true };
  }
}

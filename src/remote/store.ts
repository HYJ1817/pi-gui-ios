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
}

export interface StoreState {
  projects: RemoteProject[];
  sessions: RemoteSession[];
  registryRevision: number;
  conversations: Record<string, ConversationState>;
  /** per-requestId resolution flag so a settled approval greys out instantly */
  decided: Record<string, 'allowed' | 'denied' | 'cancelled' | 'answered' | 'expired'>;
  lastError: string | null;
}

const EMPTY: ConversationState = { status: 'unknown', messages: [], ownerRevision: 0, approvals: [], snapshotTruncated: false, loaded: false };

export class ConversationStore {
  private readonly client: RemoteClient;
  private readonly events: EventStreamClient;
  private state: StoreState = { projects: [], sessions: [], registryRevision: 0, conversations: {}, decided: {}, lastError: null };
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

  private setConversation(conversationId: string, patch: Partial<ConversationState>): void {
    const current = this.state.conversations[conversationId] ?? EMPTY;
    this.setState({ conversations: { ...this.state.conversations, [conversationId]: { ...current, ...patch } } });
  }

  conversation(id: string): ConversationState { return this.state.conversations[id] ?? EMPTY; }

  /** Bootstrap: projects + sessions + all known snapshots. */
  async load(): Promise<void> {
    const projects = await this.client.listProjects();
    if (!projects.ok) { this.setState({ lastError: projects.code }); return; }
    let sessions: RemoteSession[] = [];
    for (const project of projects.result.projects) {
      const out = await this.client.listSessions(project.projectId);
      if (out.ok) sessions = sessions.concat(out.result.sessions);
    }
    this.setState({ projects: projects.result.projects, sessions: sessions.slice(0, MAX_SESSIONS), registryRevision: projects.result.registryRevision, lastError: null });
    for (const session of sessions) {
      for (const active of session.activeConversations) await this.refresh(active.conversationId);
    }
  }

  async refresh(conversationId: string): Promise<void> {
    const snap = await this.client.snapshot(conversationId);
    if (!snap.ok) { this.setState({ lastError: snap.code }); return; }
    this.setConversation(conversationId, {
      status: snap.result.status,
      messages: snap.result.messages.slice(-MAX_SNAPSHOT_MESSAGES),
      ownerRevision: snap.result.ownerRevision,
      snapshotTruncated: snap.result.snapshotTruncated === true,
      loaded: true,
    });
    const approvals = await this.client.listApprovals(conversationId);
    if (approvals.ok) this.setConversation(conversationId, { approvals: approvals.result.approvals.slice(0, MAX_APPROVALS) });
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
      if (current.messages.some(m => m.messageId === message.messageId)) return;
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
      this.setState({ decided: { ...this.state.decided, [requestId]: status } });
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
    this.setConversation(conversationId, { ownerRevision: outcome.result.ownerRevision });
    return { ok: true };
  }

  async stop(conversationId: string): Promise<{ ok: boolean; code?: string }> {
    const outcome = await this.client.stopConversation(conversationId, this.conversation(conversationId).ownerRevision);
    if (!outcome.ok) {
      this.setState({ lastError: outcome.code });
      if (outcome.code === 'stale_revision' || outcome.code === 'stale_owner') await this.refresh(conversationId);
      return { ok: false, code: outcome.code };
    }
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
    return { ok: true };
  }
}

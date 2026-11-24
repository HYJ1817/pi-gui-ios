// LEGACY static fixtures kept only for the design-system unit test target
// (tests/design-system.test.mjs transpiles this file). Live screens no longer
// read these — M3 moved every remote surface to the typed client + synthetic
// signed gateway loop in src/remote/. Do not add real data here.

export interface Project { projectId: string; displayName: string; description: string; }
export interface Session { sessionId: string; projectId: string; displayName: string; updatedAt: string; activeConversations: { conversationId: string }[]; }
export interface ChatMessage { messageId: string; conversationId: string; role: 'user' | 'assistant' | 'system'; text: string; timestamp: number; }
export interface Approval { requestId: string; method: 'confirm' | 'select' | 'input' | 'editor'; title: string; message: string; options?: { optionId: string; label: string }[]; pending: boolean; }

export const projects: Project[] = [
  { projectId: "project-a0001", displayName: 'Pi GUI Mobile', description: 'Native iOS client shell' },
  { projectId: "project-b0002", displayName: 'Reference Desktop', description: 'T3 / pi-gui reference codebase' },
];

export const sessions: Session[] = [
  { sessionId: "session-s0001", projectId: "project-a0001", displayName: 'App shell layout', updatedAt: '2026-11-22T09:00:00Z', activeConversations: [{ conversationId: "conversation-c001" }] },
  { sessionId: "session-s0002", projectId: "project-a0001", displayName: 'Theme tokens', updatedAt: '2026-11-22T08:30:00Z', activeConversations: [{ conversationId: "conversation-c002" }] },
  { sessionId: "session-s0003", projectId: "project-b0002", displayName: 'Protocol study', updatedAt: '2026-11-21T16:00:00Z', activeConversations: [{ conversationId: "conversation-c003" }] },
];

export const messages: ChatMessage[] = [
  { messageId: "message-m0001", conversationId: "conversation-c001", role: 'assistant', text: 'App shell is offline — no desktop is connected. This is a layout preview.', timestamp: 1763820000 },
  { messageId: "message-m0002", conversationId: "conversation-c001", role: 'user', text: 'Show the native navigation and Liquid Glass surfaces.', timestamp: 1763820060 },
  { messageId: "message-m0003", conversationId: "conversation-c001", role: 'assistant', text: 'React Navigation drives a native iOS stack; chrome uses real system materials when Reduce Transparency is off.', timestamp: 1763820120 },
  { messageId: "message-m0004", conversationId: "conversation-c002", role: 'user', text: 'Theme tokens for light and dark?', timestamp: 1763820300 },
  { messageId: "message-m0005", conversationId: "conversation-c002", role: 'assistant', text: 'Both palettes live in src/design/tokens.ts with WCAG-checked contrast.', timestamp: 1763820360 },
];

export const approvals: Approval[] = [
  { requestId: "approval-a001", method: 'confirm', title: 'Run a tool', message: 'A tool wants permission to run (synthetic).', pending: true },
  { requestId: "approval-a002", method: 'select', title: 'Choose a model', message: 'Pick an option (synthetic).', options: [{ optionId: "option-a0001", label: 'Model A' }, { optionId: "option-b0002", label: 'Model B' }], pending: true },
];

export function projectById(id: string): Project | undefined { return projects.find(p => p.projectId === id); }
export function sessionsFor(projectId: string): Session[] { return sessions.filter(s => s.projectId === projectId); }
export function sessionById(id: string): Session | undefined { return sessions.find(s => s.sessionId === id); }
export function messagesFor(conversationId: string): ChatMessage[] { return messages.filter(m => m.conversationId === conversationId); }
export function pendingApprovals(): Approval[] { return approvals.filter(a => a.pending); }

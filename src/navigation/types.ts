export type RootStackParamList = {
  Home: undefined;
  Sessions: { projectId: string; title?: string };
  Conversation: { sessionId: string; conversationId: string; title?: string };
  Approvals: undefined;
  ApprovalDetail: { requestId: string; conversationId: string; title?: string };
  Settings: undefined;
  InfrastructureProbe: { focus?: string; label?: string; menu?: string; animate?: string; gesture?: string; scroll?: string } | undefined;
  Diagnostics: undefined;
};

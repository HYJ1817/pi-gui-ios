export type RootStackParamList = {
  Home: undefined;
  Sessions: { projectId: string; title?: string };
  Conversation: { sessionId: string; conversationId: string; title?: string };
  Approvals: undefined;
  ApprovalDetail: { requestId: string; title?: string };
  Settings: undefined;
  InfrastructureProbe: { focus?: string } | undefined;
  Diagnostics: undefined;
};

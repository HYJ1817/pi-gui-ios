import { FlatList, StyleSheet, Text, TextInput, useWindowDimensions, View, Pressable } from 'react-native';
import { useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState } from 'react';
import { contentWidth } from '../design/layout';
import type { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme';
import { useRemote, remoteRuntime } from '../remote/useRemote';
import { StatusBadge } from '../components/StatusBadge';
import { StreamErrorCard } from '../components/StreamErrorCard';
import { utf8Bytes, uuidFromBytes } from '../remote/wire';
import { MAX_TRANSCRIPT_BYTES, type RemoteMessage } from '../remote/types';

function clientMessageId(): string {
  const g = globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } };
  const bytes = new Uint8Array(16);
  if (g.crypto?.getRandomValues) g.crypto.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  return uuidFromBytes(bytes) ?? '00000000-0000-4000-8000-000000000000';
}

function Bubble({ msg }: { msg: RemoteMessage }) {
  const theme = useTheme();
  const isUser = msg.role === 'user';
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={`${isUser ? 'You' : 'Assistant'}: ${msg.text.length > 240 ? msg.text.slice(0, 240) + '…' : msg.text}`}
      style={[styles.bubble, isUser ? styles.bubbleRight : styles.bubbleLeft, { backgroundColor: isUser ? theme.userBubble : theme.assistantBubble }]}
    >
      <Text style={[styles.bubbleText, { color: isUser ? theme.onAccent : theme.text }]}>{msg.text}</Text>
    </View>
  );
}

export default function ConversationScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const route = useRoute<RouteProp<RootStackParamList, 'Conversation'>>();
  const { conversationId } = route.params;
  const { state } = useRemote();
  const runtime = remoteRuntime();
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const conv = state.conversations[conversationId];
  const msgs = conv?.messages ?? [];
  const approvals = conv?.approvals ?? [];
  const status = conv?.status ?? 'unknown';
  const running = status === 'running';
  const col = Math.min(contentWidth({ width, height: 0 }), width);

  const send = async () => {
    const text = draft.trim();
    if (!text || utf8Bytes(text) > MAX_TRANSCRIPT_BYTES || pending) return;
    setPending(true);
    setSendError(null);
    const result = await runtime.store.sendMessage(conversationId, text, clientMessageId());
    setPending(false);
    if (result.ok) setDraft('');
    else setSendError(result.code ?? 'failed');
  };
  const stop = async () => {
    if (pending) return;
    setPending(true);
    await runtime.store.stop(conversationId);
    setPending(false);
  };

  return (
    <KeyboardAwareScrollView
      testID="conversation-scroll"
      style={{ backgroundColor: theme.background }}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.page, { paddingBottom: Math.max(16, insets.bottom) }]}
    >
      <View style={styles.headerRow}>
        <Text style={[styles.sub, { color: theme.secondary }]}>Synthetic remote/v1 conversation — every message flows through the signed sandbox loop.</Text>
        <StatusBadge
          status={running ? 'running' : status === 'stopping' ? 'pending' : status === 'error' ? 'danger' : 'idle'}
          label={status === 'unknown' ? 'Idle' : status.charAt(0).toUpperCase() + status.slice(1)}
        />
      </View>
      {state.lastError === 'stream_unavailable' ? <StreamErrorCard /> : null}
      {conv?.snapshotTruncated ? <Text style={[styles.trunc, { color: theme.tertiary }]}>Earlier history truncated by projection bounds.</Text> : null}
      {approvals.length > 0 ? (
        <Text testID="conversation-approvals" style={[styles.pending, { color: theme.warning }]}>
          {approvals.length} approval{approvals.length > 1 ? 's' : ''} pending — open Approvals to respond.
        </Text>
      ) : null}
      <View style={{ maxWidth: col, alignSelf: 'center', width: '100%' }}>
        <FlatList
          data={msgs}
          keyExtractor={m => m.messageId}
          scrollEnabled={false}
          renderItem={({ item }) => <Bubble msg={item} />}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          testID="message-list"
        />
      </View>
      {sendError ? <Text testID="send-error" style={[styles.error, { color: theme.danger }]}>Send failed: {sendError}</Text> : null}
      <View style={[styles.composer, { maxWidth: col, borderColor: theme.line, backgroundColor: theme.surface }]}>
        <TextInput
          testID="composer-input"
          accessibilityLabel="Message composer"
          value={draft}
          onChangeText={setDraft}
          placeholder="Message (synthetic loop)"
          placeholderTextColor={theme.tertiary}
          multiline
          style={[styles.composerInput, { color: theme.text }]}
        />
        {running ? (
          <Pressable
            testID="composer-stop"
            accessibilityRole="button"
            accessibilityLabel="Stop response"
            onPress={stop}
            style={[styles.send, { backgroundColor: theme.surface, borderColor: theme.line, borderWidth: 1 }]}
          >
            <Text style={[styles.sendText, { color: theme.danger }]}>Stop</Text>
          </Pressable>
        ) : (
          <Pressable
            testID="composer-send"
            accessibilityRole="button"
            accessibilityLabel="Send message"
            accessibilityState={{ disabled: !draft.trim() || pending }}
            disabled={!draft.trim() || pending}
            onPress={send}
            style={[styles.send, { backgroundColor: theme.accent, opacity: draft.trim() && !pending ? 1 : 0.45 }]}
          >
            <Text style={[styles.sendText, { color: theme.onAccent }]}>{pending ? '…' : 'Send'}</Text>
          </Pressable>
        )}
      </View>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingTop: 12, gap: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'space-between' },
  sub: { fontSize: 13, flex: 1 },
  trunc: { fontSize: 12, textAlign: 'center' },
  pending: { fontSize: 13, fontWeight: '600', textAlign: 'center' },
  error: { fontSize: 13, fontWeight: '600', textAlign: 'center' },
  bubble: { maxWidth: '82%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleLeft: { alignSelf: 'flex-start', borderTopLeftRadius: 6 },
  bubbleRight: { alignSelf: 'flex-end', borderTopRightRadius: 6 },
  bubbleText: { fontSize: 16, lineHeight: 22 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 12, padding: 8, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth },
  composerInput: { flex: 1, minHeight: 40, maxHeight: 120, fontSize: 16, paddingHorizontal: 8, paddingVertical: 8 },
  send: { minWidth: 56, minHeight: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  sendText: { fontSize: 15, fontWeight: '600' },
});

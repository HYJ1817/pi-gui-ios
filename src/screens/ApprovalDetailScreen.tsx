import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { useState } from 'react';
import type { RootStackParamList } from '../navigation/types';
import { GlassSurface } from '../components/GlassSurface';
import { useTheme } from '../theme';
import { useRemote, remoteRuntime } from '../remote/useRemote';
import type { ApprovalDecision } from '../remote/types';

export default function ApprovalDetailScreen() {
  const theme = useTheme();
  const route = useRoute<RouteProp<RootStackParamList, 'ApprovalDetail'>>();
  const { requestId, conversationId } = route.params;
  const { state } = useRemote();
  const runtime = remoteRuntime();
  const approval = state.conversations[conversationId]?.approvals.find(a => a.requestId === requestId);
  const settled = state.decided[requestId];
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!approval && !settled) {
    return <View style={[styles.page, { backgroundColor: theme.background }]}><Text style={{ color: theme.text }}>Unknown approval.</Text></View>;
  }

  const method = approval?.method ?? 'confirm';
  const decide = async (decision: ApprovalDecision, answer?: string) => {
    if (busy || settled) return;
    setBusy(true);
    setError(null);
    const result = await runtime.store.respond(conversationId, requestId, method, decision, answer);
    setBusy(false);
    if (!result.ok) setError(result.code ?? 'failed');
  };

  const statusText = settled ? `Resolved: ${settled}` : busy ? 'Responding…' : null;

  return (
    <KeyboardAwareScrollView testID="approval-detail" style={{ backgroundColor: theme.background }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.page}>
      <GlassSurface testID="approval-card" style={styles.card} contentStyle={[styles.cardContent, { backgroundColor: theme.approvalSurface }]}>
        <Text style={[styles.method, { color: theme.approvalAccent }]}>{method.toUpperCase()}</Text>
        <Text style={[styles.title, { color: theme.text }]}>{approval?.title ?? 'Approval'}</Text>
        <Text style={[styles.message, { color: theme.secondary }]}>{approval?.message ?? ''}</Text>
        <Text style={[styles.note, { color: theme.tertiary }]}>Synthetic loop — the desktop keeps approval authority; each decision is a single signed response.</Text>
      </GlassSurface>

      {!settled && method === 'select' && approval?.options ? (
        <View style={styles.optionCol}>
          {approval.options.map(o => (
            <Pressable
              key={o.optionId}
              testID={`option-${o.optionId}`}
              accessibilityRole="button"
              accessibilityLabel={`Option ${o.label}`}
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={() => decide('answer', o.optionId)}
              style={({ pressed }) => [styles.option, { backgroundColor: theme.surface, borderColor: theme.line, opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={[styles.optionText, { color: theme.text }]}>{o.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {!settled && (method === 'input' || method === 'editor') ? (
        <>
          <TextInput
            testID="approval-value"
            accessibilityLabel="Answer"
            value={value}
            onChangeText={setValue}
            placeholder="Type a response"
            placeholderTextColor={theme.tertiary}
            multiline={method === 'editor'}
            style={[styles.input, { color: theme.text, borderColor: theme.line, backgroundColor: theme.surface }]}
          />
          <View style={styles.row}>
            <Pressable
              testID="approval-answer"
              accessibilityRole="button"
              accessibilityLabel="Answer"
              accessibilityState={{ disabled: !value.trim() || busy }}
              disabled={!value.trim() || busy}
              onPress={() => decide('answer', value)}
              style={[styles.decision, { backgroundColor: theme.accent, opacity: value.trim() && !busy ? 1 : 0.45 }]}
            >
              <Text style={[styles.decisionText, { color: theme.onAccent }]}>Answer</Text>
            </Pressable>
            <Pressable
              testID="approval-cancel"
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={() => decide('cancel')}
              style={[styles.decision, { backgroundColor: theme.surface, borderColor: theme.line, borderWidth: 1 }]}
            >
              <Text style={[styles.decisionText, { color: theme.danger }]}>Cancel</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      {!settled && method === 'confirm' ? (
        <View style={styles.row}>
          <Pressable
            testID="approval-allow"
            accessibilityRole="button"
            accessibilityLabel="Allow"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={() => decide('allow')}
            style={[styles.decision, { backgroundColor: theme.accent, opacity: busy ? 0.45 : 1 }]}
          >
            <Text style={[styles.decisionText, { color: theme.onAccent }]}>Allow</Text>
          </Pressable>
          <Pressable
            testID="approval-deny"
            accessibilityRole="button"
            accessibilityLabel="Deny"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={() => decide('deny')}
            style={[styles.decision, { backgroundColor: theme.surface, borderColor: theme.line, borderWidth: 1 }]}
          >
            <Text style={[styles.decisionText, { color: theme.danger }]}>Deny</Text>
          </Pressable>
        </View>
      ) : null}

      {statusText ? <Text testID="approval-result" style={[styles.result, { color: settled ? theme.success : theme.secondary }]}>{statusText}</Text> : null}
      {error ? <Text testID="approval-error" style={[styles.errorText, { color: theme.danger }]}>Response failed: {error}</Text> : null}
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, gap: 16, paddingBottom: 40 },
  card: { borderRadius: 20 },
  cardContent: { padding: 20, gap: 8, borderRadius: 20 },
  method: { fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  title: { fontSize: 22, fontWeight: '700' },
  message: { fontSize: 16, lineHeight: 23 },
  note: { fontSize: 12, fontStyle: 'italic' },
  optionCol: { gap: 10 },
  option: { minHeight: 52, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center', paddingHorizontal: 16 },
  optionText: { fontSize: 17 },
  input: { minHeight: 48, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16 },
  row: { flexDirection: 'row', gap: 12 },
  decision: { flex: 1, minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  decisionText: { fontSize: 17, fontWeight: '600' },
  result: { fontSize: 15, fontWeight: '600', textAlign: 'center' },
  errorText: { fontSize: 15, fontWeight: '600', textAlign: 'center' },
});

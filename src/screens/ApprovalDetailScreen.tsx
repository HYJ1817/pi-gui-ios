import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { useState } from 'react';
import type { RootStackParamList } from '../navigation/types';
import { GlassSurface } from '../components/GlassSurface';
import { useTheme } from '../theme';
import { approvals } from '../data/fixtures';

export default function ApprovalDetailScreen() {
  const theme = useTheme();
  const route = useRoute<RouteProp<RootStackParamList, 'ApprovalDetail'>>();
  const { requestId } = route.params;
  const approval = approvals.find(a => a.requestId === requestId);
  const [value, setValue] = useState('');
  const [decided, setDecided] = useState<string | null>(null);

  if (!approval) {
    return <View style={[styles.page, { backgroundColor: theme.background }]}><Text style={{ color: theme.text }}>Unknown approval.</Text></View>;
  }

  const decide = (d: string) => setDecided(d);
  const method = approval.method;

  return (
    <ScrollView testID="approval-detail" style={{ backgroundColor: theme.background }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.page}>
      <GlassSurface testID="approval-card" style={styles.card} contentStyle={[styles.cardContent, { backgroundColor: theme.approvalSurface }]}>
        <Text style={[styles.method, { color: theme.approvalAccent }]}>{method.toUpperCase()}</Text>
        <Text style={[styles.title, { color: theme.text }]}>{approval.title}</Text>
        <Text style={[styles.message, { color: theme.secondary }]}>{approval.message}</Text>
        <Text style={[styles.note, { color: theme.tertiary }]}>Offline preview — no real action is authorized.</Text>
      </GlassSurface>

      {method === 'select' && approval.options ? (
        <View style={styles.optionCol}>
          {approval.options.map(o => (
            <Pressable
              key={o.optionId}
              testID={`option-${o.optionId}`}
              accessibilityRole="button"
              accessibilityLabel={`Option ${o.label}`}
              onPress={() => decide(o.optionId)}
              style={({ pressed }) => [styles.option, { backgroundColor: theme.surface, borderColor: theme.line, opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={[styles.optionText, { color: theme.text }]}>{o.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {(method === 'input' || method === 'editor') ? (
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
      ) : null}

      {method === 'confirm' ? (
        <View style={styles.row}>
          <Pressable testID="approval-allow" accessibilityRole="button" accessibilityLabel="Allow" onPress={() => decide('allow')} style={[styles.decision, { backgroundColor: theme.accent }]}><Text style={[styles.decisionText, { color: theme.onAccent }]}>Allow</Text></Pressable>
          <Pressable testID="approval-deny" accessibilityRole="button" accessibilityLabel="Deny" onPress={() => decide('deny')} style={[styles.decision, { backgroundColor: theme.surface, borderColor: theme.line, borderWidth: 1 }]}><Text style={[styles.decisionText, { color: theme.danger }]}>Deny</Text></Pressable>
        </View>
      ) : null}
      {(method === 'input' || method === 'editor') ? (
        <Pressable testID="approval-answer" accessibilityRole="button" accessibilityLabel="Answer" accessibilityState={{ disabled: !value.trim() }} disabled={!value.trim()} onPress={() => decide('answer')} style={[styles.decision, { backgroundColor: theme.accent, opacity: value.trim() ? 1 : 0.45 }]}><Text style={[styles.decisionText, { color: theme.onAccent }]}>Answer</Text></Pressable>
      ) : null}

      {decided ? <Text testID="approval-result" style={[styles.result, { color: theme.success }]}>Decision recorded (offline): {decided}</Text> : null}
    </ScrollView>
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
});

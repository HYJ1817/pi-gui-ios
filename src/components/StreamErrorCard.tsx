/**
 * Terminal stream death recovery affordance. The only copy is generic — the
 * closed wire vocabulary never leaks stream internals ('sequence_gap' is an
 * internal continuity code, never rendered).
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme';
import { remoteRuntime } from '../remote/useRemote';

export function StreamErrorCard() {
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const reload = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await remoteRuntime().recoverStream();
    } finally {
      setBusy(false);
    }
  };
  return (
    <View accessibilityRole="alert" style={[styles.card, { borderColor: theme.danger, backgroundColor: theme.surface }]}>
      <Text style={[styles.title, { color: theme.text }]}>Live updates interrupted</Text>
      <Text style={[styles.body, { color: theme.secondary }]}>Reload to resume the synthetic stream.</Text>
      <Pressable
        testID="stream-reload"
        accessibilityRole="button"
        accessibilityLabel="Reload live stream"
        disabled={busy}
        onPress={() => { void reload(); }}
        style={({ pressed }) => [styles.button, { backgroundColor: theme.accent, opacity: pressed || busy ? 0.6 : 1, minHeight: theme.tokens.minHitTarget }]}
      >
        <Text style={[styles.buttonText, { color: theme.onAccent }]}>{busy ? 'Reloading…' : 'Reload'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 14, gap: 8 },
  title: { fontSize: 15, fontWeight: '600' },
  body: { fontSize: 13, lineHeight: 18 },
  button: { alignSelf: 'flex-start', borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center' },
  buttonText: { fontSize: 14, fontWeight: '600' },
});

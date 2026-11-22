import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme';

interface Props {
  title: string;
  message?: string;
  action?: React.ReactNode;
}

export function EmptyState({ title, message, action }: Props) {
  const theme = useTheme();
  return (
    <View accessibilityRole="summary" style={styles.wrap}>
      <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>{title}</Text>
      {message ? <Text style={[styles.message, { color: theme.secondary }]}>{message}</Text> : null}
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 10, paddingVertical: 48, paddingHorizontal: 24 },
  title: { fontSize: 20, fontWeight: '600', textAlign: 'center' },
  message: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
});

import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme';

export type Status = 'idle' | 'running' | 'success' | 'warning' | 'danger' | 'pending';

const LABEL: Record<Status, string> = {
  idle: 'Idle', running: 'Running', success: 'Done',
  warning: 'Warning', danger: 'Error', pending: 'Pending',
};

export function statusColor(status: Status, colors: { success: string; warning: string; danger: string; pending: string; textSecondary: string }): string {
  switch (status) {
    case 'running': return colors.pending;
    case 'success': return colors.success;
    case 'warning': return colors.warning;
    case 'danger': return colors.danger;
    case 'pending': return colors.pending;
    default: return colors.textSecondary;
  }
}

export function StatusBadge({ status, label }: { status: Status; label?: string }) {
  const theme = useTheme();
  const color = statusColor(status, theme.tokens.colors);
  return (
    <View accessibilityLabel={label ?? LABEL[status]} style={[styles.badge, { borderColor: color }]}>
      <View accessible={false} style={[styles.dot, { backgroundColor: color }]} />
      <Text accessible={false} style={[styles.text, { color }]} numberOfLines={1}>{label ?? LABEL[status]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, alignSelf: 'flex-start' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { fontSize: 12, fontWeight: '600' },
});

import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';

interface Props {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export function ListItem({ title, subtitle, right, onPress, testID, style, accessibilityLabel }: Props) {
  const theme = useTheme();
  const body = (
    <>
      <View style={styles.textCol}>
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={[styles.subtitle, { color: theme.secondary }]} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {right}
      {onPress ? <Text accessible={false} importantForAccessibility="no-hide-descendants" style={[styles.chevron, { color: theme.tertiary }]}>›</Text> : null}
    </>
  );
  if (!onPress) {
    // A non-interactive row must not carry Pressable's disabled/dimmed a11y state.
    return (
      <View testID={testID} accessibilityLabel={accessibilityLabel} style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.line }, style]}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: theme.surface, borderColor: theme.line, opacity: pressed ? 0.7 : 1 },
        style,
      ]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  textCol: { flex: 1, gap: 2 },
  title: { fontSize: 17, fontWeight: '500' },
  subtitle: { fontSize: 14, lineHeight: 19 },
  chevron: { fontSize: 26, fontWeight: '300', marginTop: -2 },
});

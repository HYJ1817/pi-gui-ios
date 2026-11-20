import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../src/theme';

export default function Diagnostics() {
  const theme = useTheme();
  return <ScrollView testID="diagnostics-screen" contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.page} style={{ backgroundColor: theme.background }}><View style={[styles.panel, { backgroundColor: theme.surface }]}><Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>Native navigation works</Text><Text style={[styles.body, { color: theme.secondary }]}>This screen is pushed by Expo Router using a native iOS navigation stack. Swipe back or use the system Back button.</Text><Text style={[styles.body, { color: theme.text }]}>Remote access: disabled</Text><Text style={[styles.body, { color: theme.secondary }]}>No credentials, model accounts or desktop data are used by this infrastructure probe.</Text><Text style={[styles.body, { color: theme.secondary }]}>Simulator validation and an unsigned IPA do not prove SideStore installation.</Text></View></ScrollView>;
}
const styles = StyleSheet.create({ page: { padding: 24, alignItems: 'center' }, panel: { borderRadius: 24, padding: 24, gap: 20, width: '100%', maxWidth: 760 }, title: { fontSize: 26, fontWeight: '700' }, body: { fontSize: 17, lineHeight: 26 } });

import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { contentWidth } from '../design/layout';
import type { RootStackParamList } from '../navigation/types';
import { ListItem } from '../components/ListItem';
import { EmptyState } from '../components/EmptyState';
import { GlassSurface } from '../components/GlassSurface';
import { useTheme } from '../theme';
import { useRemote } from '../remote/useRemote';
import { StatusBadge } from '../components/StatusBadge';

export default function HomeScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'Home'>>();
  const { state } = useRemote();
  const projects = state.projects;
  const running = Object.values(state.conversations).filter(c => c.status === 'running').length;
  const col = Math.min(contentWidth({ width, height: 0 }), width);

  return (
    <FlatList
      testID="home-projects"
      style={{ backgroundColor: theme.background }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.page, { paddingHorizontal: 20 }]}
      data={projects}
      keyExtractor={p => p.projectId}
      ListHeaderComponent={
        <View style={[styles.head, { maxWidth: col }]}>
          <Text style={[styles.eyebrow, { color: theme.accent }]}>PI GUI MOBILE</Text>
          <Text style={[styles.hero, { color: theme.text }]}>Your agents, closer at hand.</Text>
          <Text style={[styles.intro, { color: theme.secondary }]}>Synthetic remote loop — projects, sessions, messages and approvals flow through the typed remote/v1 client and signed sandbox gateway. No real desktop is connected.</Text>
          <GlassSurface testID="home-hero" style={styles.heroCard} contentStyle={styles.heroCardContent}>
            <Text style={[styles.heroCardTitle, { color: theme.text }]}>Native navigation + Liquid Glass</Text>
            <Text style={[styles.heroCardBody, { color: theme.secondary }]}>Real iOS materials over a themed surface; a solid fallback under Reduce Transparency.</Text>
          </GlassSurface>
          <View style={styles.sectionRow}>
            <Text accessibilityRole="header" style={[styles.sectionTitle, { color: theme.text }]}>Projects</Text>
            <StatusBadge status={state.lastError ? 'danger' : running > 0 ? 'running' : 'idle'} label={state.lastError ? 'Error' : running > 0 ? `${running} running` : 'Synthetic loop'} />
          </View>
          <View style={styles.quickRow}>
            <Pressable testID="nav-approvals" accessibilityRole="button" accessibilityLabel="Open approvals" onPress={() => navigation.navigate('Approvals')} style={({ pressed }) => [styles.quickLink, { borderColor: theme.line, opacity: pressed ? 0.7 : 1, minHeight: theme.tokens.minHitTarget }]}>
              <Text style={[styles.quickLinkText, { color: theme.accent }]}>Approvals</Text>
            </Pressable>
            <Pressable testID="nav-settings" accessibilityRole="button" accessibilityLabel="Open settings" onPress={() => navigation.navigate('Settings')} style={({ pressed }) => [styles.quickLink, { borderColor: theme.line, opacity: pressed ? 0.7 : 1, minHeight: theme.tokens.minHitTarget }]}>
              <Text style={[styles.quickLinkText, { color: theme.accent }]}>Settings</Text>
            </Pressable>
            <Pressable testID="nav-probe" accessibilityRole="button" accessibilityLabel="Open infrastructure probe" onPress={() => navigation.navigate('InfrastructureProbe')} style={({ pressed }) => [styles.quickLink, { borderColor: theme.line, opacity: pressed ? 0.7 : 1, minHeight: theme.tokens.minHitTarget }]}>
              <Text style={[styles.quickLinkText, { color: theme.accent }]}>Infrastructure</Text>
            </Pressable>
          </View>
        </View>
      }
      renderItem={({ item }) => (
        <View style={{ maxWidth: col, alignSelf: 'center', width: '100%' }}>
          <ListItem
            title={item.displayName}
            subtitle={`${state.sessions.filter(s => s.projectId === item.projectId).length} sessions · synthetic`}
            testID={`project-${item.projectId}`}
            onPress={() => navigation.navigate('Sessions', { projectId: item.projectId, title: item.displayName })}
          />
        </View>
      )}
      ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      ListEmptyComponent={<EmptyState title="No projects" message="Nothing to show in the synthetic loop." />}
      ListFooterComponent={
        <Pressable testID="home-diagnostics-link" accessibilityRole="button" accessibilityLabel="Open infrastructure details" onPress={() => navigation.navigate('Diagnostics')} style={({ pressed }) => [styles.footerLink, { opacity: pressed ? 0.7 : 1 }]}>
          <Text style={[styles.footerLinkText, { color: theme.accent }]}>Open infrastructure details</Text>
        </Pressable>
      }
    />
  );
}

const styles = StyleSheet.create({
  page: { paddingTop: 16, paddingBottom: 40, gap: 4 },
  head: { gap: 12, paddingBottom: 8, width: '100%', alignSelf: 'center' },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 },
  eyebrow: { fontSize: 12, fontWeight: '700', letterSpacing: 1.6 },
  hero: { fontSize: 34, fontWeight: '700', letterSpacing: -1 },
  intro: { fontSize: 16, lineHeight: 24 },
  heroCard: { borderRadius: 24, marginTop: 6 },
  heroCardContent: { padding: 20, gap: 6 },
  heroCardTitle: { fontSize: 18, fontWeight: '600' },
  heroCardBody: { fontSize: 14, lineHeight: 20 },
  sectionTitle: { fontSize: 22, fontWeight: '700' },
  quickRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  quickLink: { paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, overflow: 'hidden', justifyContent: 'center' },
  quickLinkText: { fontSize: 15, fontWeight: '600' },
  footerLink: { marginTop: 24, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  footerLinkText: { fontSize: 15, fontWeight: '600', textAlign: 'center' },
});

import { FlatList, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { contentWidth } from '../design/layout';
import type { RootStackParamList } from '../navigation/types';
import { ListItem } from '../components/ListItem';
import { EmptyState } from '../components/EmptyState';
import { GlassSurface } from '../components/GlassSurface';
import { useTheme } from '../theme';
import { projects } from '../data/fixtures';

export default function HomeScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'Home'>>();
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
          <Text style={[styles.intro, { color: theme.secondary }]}>Offline app shell — no desktop is connected. Navigate the synthetic workspace to preview the native UI.</Text>
          <GlassSurface testID="home-hero" style={styles.heroCard} contentStyle={styles.heroCardContent}>
            <Text style={[styles.heroCardTitle, { color: theme.text }]}>Native navigation + Liquid Glass</Text>
            <Text style={[styles.heroCardBody, { color: theme.secondary }]}>Real iOS materials over a themed surface; a solid fallback under Reduce Transparency.</Text>
          </GlassSurface>
          <Text accessibilityRole="header" style={[styles.sectionTitle, { color: theme.text }]}>Projects</Text>
          <View style={styles.quickRow}>
            <Text testID="nav-approvals" onPress={() => navigation.navigate('Approvals')} style={[styles.quickLink, { color: theme.accent, borderColor: theme.line }]}>Approvals</Text>
            <Text testID="nav-settings" onPress={() => navigation.navigate('Settings')} style={[styles.quickLink, { color: theme.accent, borderColor: theme.line }]}>Settings</Text>
          </View>
        </View>
      }
      renderItem={({ item }) => (
        <View style={{ maxWidth: col, alignSelf: 'center', width: '100%' }}>
          <ListItem
            title={item.displayName}
            subtitle={item.description}
            testID={`project-${item.projectId}`}
            onPress={() => navigation.navigate('Sessions', { projectId: item.projectId, title: item.displayName })}
          />
        </View>
      )}
      ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      ListEmptyComponent={<EmptyState title="No projects" message="Nothing to show in this offline shell." />}
      ListFooterComponent={
        <Text testID="home-diagnostics-link" onPress={() => navigation.navigate('Diagnostics')} style={[styles.footerLink, { color: theme.accent }]}>
          Open infrastructure details
        </Text>
      }
    />
  );
}

const styles = StyleSheet.create({
  page: { paddingTop: 16, paddingBottom: 40, gap: 4 },
  head: { gap: 12, paddingBottom: 8, width: '100%', alignSelf: 'center' },
  eyebrow: { fontSize: 12, fontWeight: '700', letterSpacing: 1.6 },
  hero: { fontSize: 34, fontWeight: '700', letterSpacing: -1 },
  intro: { fontSize: 16, lineHeight: 24 },
  heroCard: { borderRadius: 24, marginTop: 6 },
  heroCardContent: { padding: 20, gap: 6 },
  heroCardTitle: { fontSize: 18, fontWeight: '600' },
  heroCardBody: { fontSize: 14, lineHeight: 20 },
  sectionTitle: { fontSize: 22, fontWeight: '700', marginTop: 14 },
  quickRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  quickLink: { fontSize: 15, fontWeight: '600', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  footerLink: { fontSize: 15, fontWeight: '600', textAlign: 'center', marginTop: 24, minHeight: 44 },
});

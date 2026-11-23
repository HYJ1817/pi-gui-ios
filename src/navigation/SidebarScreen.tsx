import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import type { RootStackParamList } from './types';
import { ListItem } from '../components/ListItem';
import { useTheme } from '../theme';
import { projects } from '../data/fixtures';

/**
 * iPad split primary column. Sits OUTSIDE the stack navigator but inside the
 * same NavigationContainer, so useNavigation() resolves to the container ref
 * and dispatches onto the detail column's stack (the root navigator).
 */

const QUICK: { key: string; title: string; subtitle: string; route: keyof RootStackParamList }[] = [
  { key: 'home', title: 'Overview', subtitle: 'Workspace home', route: 'Home' },
  { key: 'approvals', title: 'Approvals', subtitle: 'Pending decisions', route: 'Approvals' },
  { key: 'settings', title: 'Settings', subtitle: 'App preferences', route: 'Settings' },
  { key: 'diagnostics', title: 'Diagnostics', subtitle: 'Infrastructure details', route: 'Diagnostics' },
  { key: 'probe', title: 'Infrastructure Probe', subtitle: 'Native capability lab', route: 'InfrastructureProbe' },
];

export default function SidebarScreen() {
  const theme = useTheme();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();

  const data = [
    ...QUICK.map(q => ({ kind: 'quick' as const, ...q })),
    ...projects.map(p => ({ kind: 'project' as const, key: p.projectId, title: p.displayName, subtitle: p.description, projectId: p.projectId })),
  ];

  return (
    <FlatList
      testID="sidebar-list"
      style={{ backgroundColor: theme.background }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.page}
      data={data}
      keyExtractor={i => i.key}
      ListHeaderComponent={
        <View style={styles.head}>
          <Text style={[styles.eyebrow, { color: theme.accent }]}>PI GUI MOBILE</Text>
          <Text accessibilityRole="header" style={[styles.section, { color: theme.text }]}>Workspace</Text>
        </View>
      }
      renderItem={({ item }) => (
        <ListItem
          title={item.title}
          subtitle={item.subtitle}
          testID={`sidebar-${item.key}`}
          onPress={() => {
            if (item.kind === 'project') navigation.navigate('Sessions', { projectId: item.projectId, title: item.title });
            else navigation.navigate(item.route as never);
          }}
        />
      )}
      ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
    />
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 32, gap: 2 },
  head: { gap: 6, paddingBottom: 10 },
  eyebrow: { fontSize: 12, fontWeight: '700', letterSpacing: 1.6 },
  section: { fontSize: 22, fontWeight: '700' },
});

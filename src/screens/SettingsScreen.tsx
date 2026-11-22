import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useState } from 'react';
import { useTheme } from '../theme';
import { ListItem } from '../components/ListItem';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';

export default function SettingsScreen() {
  const theme = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'Settings'>>();
  const [reduceMotion, setReduceMotion] = useState(false);
  const [remoteNotice, setRemoteNotice] = useState(true);

  return (
    <ScrollView testID="settings-screen" style={{ backgroundColor: theme.background }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.page}>
      <Text style={[styles.sub, { color: theme.secondary }]}>Local preferences only — no remote connection is configured.</Text>
      <View style={styles.group}>
        <View style={[styles.row, { borderColor: theme.line, backgroundColor: theme.surface }]}>
          <Text style={[styles.rowLabel, { color: theme.text }]}>Follow Reduce Motion</Text>
          <Switch testID="reduce-motion" accessibilityLabel="Follow Reduce Motion" value={reduceMotion} onValueChange={setReduceMotion} />
        </View>
        <View style={[styles.row, { borderColor: theme.line, backgroundColor: theme.surface }]}>
          <Text style={[styles.rowLabel, { color: theme.text }]}>Show offline notice</Text>
          <Switch testID="remote-notice" accessibilityLabel="Show offline notice" value={remoteNotice} onValueChange={setRemoteNotice} />
        </View>
      </View>
      <Text style={[styles.groupTitle, { color: theme.secondary }]}>About</Text>
      <View style={styles.group}>
        <ListItem title="Infrastructure probe" subtitle="Native capability checks" onPress={() => navigation.navigate('InfrastructureProbe')} />
        <ListItem title="Diagnostics" subtitle="Infrastructure details" onPress={() => navigation.navigate('Diagnostics')} />
      </View>
      <Text style={[styles.version, { color: theme.tertiary }]}>Pi GUI Mobile · M2 shell · offline</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, gap: 16, paddingBottom: 40 },
  sub: { fontSize: 14, textAlign: 'center' },
  group: { gap: 10 },
  groupTitle: { fontSize: 13, fontWeight: '600', marginTop: 8, textTransform: 'uppercase', letterSpacing: 0.6 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, minHeight: 48, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  rowLabel: { fontSize: 17, flex: 1 },
  version: { fontSize: 12, textAlign: 'center', marginTop: 16 },
});

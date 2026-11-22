import { FlatList, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { contentWidth } from '../design/layout';
import type { RootStackParamList } from '../navigation/types';
import { ListItem } from '../components/ListItem';
import { EmptyState } from '../components/EmptyState';
import { useTheme } from '../theme';
import { pendingApprovals } from '../data/fixtures';

export default function ApprovalsScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'Approvals'>>();
  const items = pendingApprovals();
  const col = Math.min(contentWidth({ width, height: 0 }), width);

  return (
    <FlatList
      testID="approvals-list"
      style={{ backgroundColor: theme.background }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.page}
      data={items}
      keyExtractor={a => a.requestId}
      ListHeaderComponent={<Text style={[styles.sub, { color: theme.secondary }]}>Synthetic pending approvals (offline).</Text>}
      renderItem={({ item }) => (
        <View style={{ maxWidth: col, alignSelf: 'center', width: '100%' }}>
          <ListItem
            title={item.title}
            subtitle={`${item.method} · ${item.message}`}
            testID={`approval-${item.requestId}`}
            onPress={() => navigation.navigate('ApprovalDetail', { requestId: item.requestId, title: item.title })}
          />
        </View>
      )}
      ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      ListEmptyComponent={<EmptyState title="No pending approvals" message="Nothing is waiting on you in the offline shell." />}
    />
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, paddingBottom: 40 },
  sub: { fontSize: 14, marginBottom: 12, textAlign: 'center' },
});

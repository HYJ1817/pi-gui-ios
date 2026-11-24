import { FlatList, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RemoteSession } from '../remote/types';
import { contentWidth } from '../design/layout';
import type { RootStackParamList } from '../navigation/types';
import { ListItem } from '../components/ListItem';
import { EmptyState } from '../components/EmptyState';
import { StatusBadge } from '../components/StatusBadge';
import { useTheme } from '../theme';
import { useRemote } from '../remote/useRemote';
import type { ConversationStatus } from '../remote/types';

export default function SessionsScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'Sessions'>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Sessions'>>();
  const { projectId } = route.params;
  const { state } = useRemote();
  const items = state.sessions.filter(s => s.projectId === projectId);
  const col = Math.min(contentWidth({ width, height: 0 }), width);

  // Aggregate over ALL active conversations: worst status wins; pending
  // approvals always dominate.
  const statusOf = (item: RemoteSession): { status: 'idle' | 'running' | 'pending' | 'warning' | 'danger'; label: string } => {
    const convs = item.activeConversations.map(c => state.conversations[c.conversationId]).filter((c): c is NonNullable<typeof c> => c !== undefined);
    const pending = convs.reduce((n, c) => n + c.approvals.length, 0);
    if (pending > 0) return { status: 'warning', label: `${pending} approval${pending > 1 ? 's' : ''}` };
    if (convs.some(c => c.status === 'error')) return { status: 'danger', label: 'Error' };
    if (convs.some(c => c.status === 'running')) return { status: 'running', label: 'Running' };
    if (convs.some(c => c.status === 'stopping')) return { status: 'running', label: 'Stopping' };
    return { status: 'idle', label: 'Idle' };
  };

  return (
    <FlatList
      testID="sessions-list"
      style={{ backgroundColor: theme.background }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.page}
      data={items}
      keyExtractor={s => s.sessionId}
      ListHeaderComponent={
        <Text style={[styles.sub, { color: theme.secondary }]}>Sessions projected through the synthetic remote/v1 loop.</Text>
      }
      renderItem={({ item }) => (
        <View style={{ maxWidth: col, alignSelf: 'center', width: '100%' }}>
          <ListItem
            title={item.displayName}
            subtitle={`${item.activeConversations.length} active · ${item.updatedAt.slice(0, 10)}`}
            testID={`session-${item.sessionId}`}
            right={(() => { const s = statusOf(item); return <StatusBadge status={s.status} label={s.label} />; })()}
            onPress={item.activeConversations.length
              ? () => navigation.navigate('Conversation', { sessionId: item.sessionId, conversationId: item.activeConversations[0]!.conversationId, title: item.displayName })
              : undefined}
          />
        </View>
      )}
      ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      ListEmptyComponent={<EmptyState title="No sessions" message="This project has no sessions in the synthetic loop." />}
    />
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, paddingBottom: 40 },
  sub: { fontSize: 14, marginBottom: 12, textAlign: 'center' },
});

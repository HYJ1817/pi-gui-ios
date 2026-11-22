import { FlatList, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { contentWidth } from '../design/layout';
import type { RootStackParamList } from '../navigation/types';
import { ListItem } from '../components/ListItem';
import { EmptyState } from '../components/EmptyState';
import { StatusBadge } from '../components/StatusBadge';
import { useTheme } from '../theme';
import { sessionsFor } from '../data/fixtures';

export default function SessionsScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'Sessions'>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Sessions'>>();
  const { projectId } = route.params;
  const items = sessionsFor(projectId);
  const col = Math.min(contentWidth({ width, height: 0 }), width);

  return (
    <FlatList
      testID="sessions-list"
      style={{ backgroundColor: theme.background }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.page}
      data={items}
      keyExtractor={s => s.sessionId}
      ListHeaderComponent={
        <Text style={[styles.sub, { color: theme.secondary }]}>Synthetic sessions for this project (offline).</Text>
      }
      renderItem={({ item }) => (
        <View style={{ maxWidth: col, alignSelf: 'center', width: '100%' }}>
          <ListItem
            title={item.displayName}
            subtitle={`${item.activeConversations.length} active · ${item.updatedAt.slice(0, 10)}`}
            testID={`session-${item.sessionId}`}
            right={<StatusBadge status={item.activeConversations.length > 0 ? 'running' : 'idle'} label={item.activeConversations.length > 0 ? 'Active' : 'Idle'} />}
            onPress={() => navigation.navigate('Conversation', { sessionId: item.sessionId, conversationId: item.activeConversations[0]?.conversationId ?? 'conversation-none', title: item.displayName })}
          />
        </View>
      )}
      ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      ListEmptyComponent={<EmptyState title="No sessions" message="This project has no sessions in the offline shell." />}
    />
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, paddingBottom: 40 },
  sub: { fontSize: 14, marginBottom: 12, textAlign: 'center' },
});

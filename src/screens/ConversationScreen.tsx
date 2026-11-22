import { FlatList, StyleSheet, Text, TextInput, useWindowDimensions, View, Pressable } from 'react-native';
import { useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState } from 'react';
import { contentWidth } from '../design/layout';
import type { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme';
import { messagesFor, type ChatMessage } from '../data/fixtures';

function Bubble({ msg }: { msg: ChatMessage }) {
  const theme = useTheme();
  const isUser = msg.role === 'user';
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={`${isUser ? 'You' : 'Assistant'}: ${msg.text}`}
      style={[styles.bubble, isUser ? styles.bubbleRight : styles.bubbleLeft, { backgroundColor: isUser ? theme.userBubble : theme.assistantBubble }]}
    >
      <Text style={[styles.bubbleText, { color: isUser ? theme.onAccent : theme.text }]}>{msg.text}</Text>
    </View>
  );
}

export default function ConversationScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const route = useRoute<RouteProp<RootStackParamList, 'Conversation'>>();
  const { conversationId } = route.params;
  const [draft, setDraft] = useState('');
  const msgs = messagesFor(conversationId);
  const col = Math.min(contentWidth({ width, height: 0 }), width);

  return (
    <KeyboardAwareScrollView
      testID="conversation-scroll"
      style={{ backgroundColor: theme.background }}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.page, { paddingBottom: Math.max(16, insets.bottom) }]}
    >
      <Text style={[styles.sub, { color: theme.secondary }]}>Offline conversation preview — no agent is connected.</Text>
      <View style={{ maxWidth: col, alignSelf: 'center', width: '100%' }}>
        <FlatList
          data={msgs}
          keyExtractor={m => m.messageId}
          scrollEnabled={false}
          renderItem={({ item }) => <Bubble msg={item} />}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          testID="message-list"
        />
      </View>
      <View style={[styles.composer, { maxWidth: col, borderColor: theme.line, backgroundColor: theme.surface }]}>
        <TextInput
          testID="composer-input"
          accessibilityLabel="Message composer"
          value={draft}
          onChangeText={setDraft}
          placeholder="Message (offline preview)"
          placeholderTextColor={theme.tertiary}
          multiline
          style={[styles.composerInput, { color: theme.text }]}
        />
        <Pressable
          testID="composer-send"
          accessibilityRole="button"
          accessibilityLabel="Send message"
          disabled
          style={[styles.send, { backgroundColor: theme.accent, opacity: draft.trim() ? 1 : 0.45 }]}
        >
          <Text style={[styles.sendText, { color: theme.onAccent }]}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingTop: 12, gap: 12 },
  sub: { fontSize: 13, textAlign: 'center', marginBottom: 4 },
  bubble: { maxWidth: '82%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleLeft: { alignSelf: 'flex-start', borderTopLeftRadius: 6 },
  bubbleRight: { alignSelf: 'flex-end', borderTopRightRadius: 6 },
  bubbleText: { fontSize: 16, lineHeight: 22 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 12, padding: 8, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth },
  composerInput: { flex: 1, minHeight: 40, maxHeight: 120, fontSize: 16, paddingHorizontal: 8, paddingVertical: 8 },
  send: { minWidth: 56, minHeight: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  sendText: { fontSize: 15, fontWeight: '600' },
});

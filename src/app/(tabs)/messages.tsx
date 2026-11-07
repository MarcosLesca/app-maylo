import { useMemo, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { showDialog } from '@/components/dialog';
import { Icon } from '@/components/icon';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/auth-provider';
import { buildChatRows, type ChatRow } from '@/features/messages/chat-rows';
import { useChat } from '@/features/messages/use-chat';
import { useTheme } from '@/hooks/use-theme';

export default function MessagesScreen() {
  const theme = useTheme();
  const { session } = useAuth();
  const { messages, send, remove } = useChat();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const container = useRef<ComponentRef<typeof View>>(null);

  // The list is inverted (newest at the bottom, next to the input), so rows go newest first.
  const rows = useMemo(
    () => buildChatRows(messages, session?.user.id ?? '').reverse(),
    [messages, session?.user.id],
  );

  const submit = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    const sent = await send(body);
    if (sent) setDraft('');
    setSending(false);
  };

  const confirmDelete = (id: string) =>
    showDialog('¿Borrar este mensaje?', 'Se borra para los dos.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Borrar', style: 'destructive', onPress: () => remove(id) },
    ]);

  const renderRow = ({ item }: { item: ChatRow }) => {
    if (item.type === 'day') {
      return (
        <View style={[styles.dayPill, { backgroundColor: theme.backgroundElement }]}>
          <Text style={[styles.dayText, { color: theme.textSecondary }]}>{item.label}</Text>
        </View>
      );
    }
    const { mine, message, time } = item;
    return (
      <Pressable
        onLongPress={mine ? () => confirmDelete(message.id) : undefined}
        accessibilityLabel={`${mine ? 'Vos' : 'Mensaje'}: ${message.body}, ${time}`}
        style={[
          styles.bubble,
          mine
            ? [styles.mine, { backgroundColor: theme.accent }]
            : [styles.theirs, { backgroundColor: theme.backgroundElement }],
        ]}>
        <Text style={[styles.body, { color: mine ? theme.onAccent : theme.text }]}>{message.body}</Text>
        <Text style={[styles.time, { color: mine ? theme.onAccent : theme.textSecondary }]}>{time}</Text>
      </Pressable>
    );
  };

  // Android draws edge-to-edge, so the window no longer resizes for the keyboard:
  // pad the chat ourselves. The offset is where the chat starts on screen (below the header).
  const measureOffset = () => {
    container.current?.measureInWindow((_x: number, y: number) => setKeyboardOffset(y));
  };

  return (
    <View ref={container} onLayout={measureOffset} style={[styles.screen, { backgroundColor: theme.background }]}>
    <KeyboardAvoidingView style={styles.screen} behavior="padding" keyboardVerticalOffset={keyboardOffset}>
      <FlatList
        inverted
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={renderRow}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <Text style={[styles.empty, { color: theme.textSecondary }]}>
            Todavía no hay mensajes. Escribí el primero.
          </Text>
        }
      />

      <View style={[styles.composer, { borderTopColor: theme.backgroundSelected }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Escribí un mensaje"
          placeholderTextColor={theme.textSecondary}
          returnKeyType="send"
          submitBehavior="submit"
          onSubmitEditing={submit}
          editable={!sending}
          maxLength={2000}
          style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Enviar"
          onPress={submit}
          disabled={!draft.trim() || sending}
          style={[styles.send, { backgroundColor: theme.accent, opacity: draft.trim() ? 1 : 0.4 }]}>
          {sending ? (
            <ActivityIndicator size="small" color={theme.onAccent} />
          ) : (
            <Icon name="send" color={theme.onAccent} size={20} />
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: { padding: Spacing.three, gap: Spacing.two, flexGrow: 1 },
  empty: { textAlign: 'center', marginTop: Spacing.six, transform: [{ scaleY: -1 }] },
  dayPill: { alignSelf: 'center', borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, marginVertical: Spacing.two },
  dayText: { fontSize: 12, fontWeight: '600' },
  bubble: { maxWidth: '80%', borderRadius: 18, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, gap: 2 },
  mine: { alignSelf: 'flex-end', borderBottomRightRadius: 6 },
  theirs: { alignSelf: 'flex-start', borderBottomLeftRadius: 6 },
  body: { fontSize: 16, lineHeight: 22 },
  time: { fontSize: 11, alignSelf: 'flex-end', opacity: 0.8 },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: { flex: 1, minHeight: 46, borderRadius: 23, paddingHorizontal: Spacing.three, fontSize: 16 },
  send: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
});

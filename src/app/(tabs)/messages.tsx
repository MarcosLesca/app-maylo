import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useMemo, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { showDialog } from '@/components/dialog';
import { Icon } from '@/components/icon';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/auth-provider';
import { buildChatRows, deliveryStatus, type ChatMessage, type ChatRow } from '@/features/messages/chat-rows';
import { fitImage } from '@/features/messages/image-size';
import { CHAT_IMAGES_BUCKET, useChat } from '@/features/messages/use-chat';
import { useTheme } from '@/hooks/use-theme';
import { pickPhoto, type PhotoSource } from '@/lib/photos';
import { errorMessage } from '@/lib/use-query';

const IMAGE_MAX_WIDTH = 240;

export default function MessagesScreen() {
  const theme = useTheme();
  const { session } = useAuth();
  const { messages, imageUrls, send, remove } = useChat(session?.user.id);
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

  // The typed text (if any) goes along as the photo's caption.
  const sendPhoto = async (source: PhotoSource) => {
    try {
      const photo = await pickPhoto(source);
      if (!photo) return;
      setSending(true);
      const sent = await send(draft.trim() || null, photo);
      if (sent) setDraft('');
    } catch (error) {
      showDialog('No se pudo enviar la foto', errorMessage(error));
    } finally {
      setSending(false);
    }
  };

  const choosePhoto = () =>
    showDialog('Enviar foto', undefined, [
      { text: 'Sacar foto', onPress: () => sendPhoto('camera') },
      { text: 'Desde la galería', onPress: () => sendPhoto('gallery') },
      { text: 'Cancelar', style: 'cancel' },
    ]);

  const confirmDelete = (message: ChatMessage) =>
    showDialog('¿Borrar este mensaje?', 'Se borra para los dos.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Borrar', style: 'destructive', onPress: () => remove(message) },
    ]);

  const openPhoto = (path: string) =>
    router.push({ pathname: '/receipt', params: { path, mime: 'image/jpeg', bucket: CHAT_IMAGES_BUCKET } });

  const renderRow = ({ item }: { item: ChatRow }) => {
    if (item.type === 'day') {
      return (
        <View style={[styles.dayPill, { backgroundColor: theme.backgroundElement }]}>
          <Text style={[styles.dayText, { color: theme.textSecondary }]}>{item.label}</Text>
        </View>
      );
    }

    const { mine, message, time } = item;
    const status = deliveryStatus(message, session?.user.id ?? '');
    const textColor = mine ? theme.onAccent : theme.text;
    const imagePath = message.image_path;
    const size = fitImage(message.image_width, message.image_height, IMAGE_MAX_WIDTH);

    return (
      <Pressable
        onLongPress={mine ? () => confirmDelete(message) : undefined}
        accessibilityLabel={`${mine ? 'Vos' : 'Mensaje'}: ${imagePath ? 'foto. ' : ''}${message.body ?? ''}, ${time}`}
        style={[
          styles.bubble,
          imagePath && styles.bubbleWithImage,
          mine
            ? [styles.mine, { backgroundColor: theme.accent }]
            : [styles.theirs, { backgroundColor: theme.backgroundElement }],
        ]}>
        {imagePath ? (
          <Pressable
            accessibilityRole="imagebutton"
            accessibilityLabel="Abrir foto"
            onPress={() => openPhoto(imagePath)}
            onLongPress={mine ? () => confirmDelete(message) : undefined}>
            <Image
              source={imageUrls[imagePath] ? { uri: imageUrls[imagePath] } : undefined}
              style={[styles.image, size, { backgroundColor: theme.backgroundSelected }]}
              contentFit="cover"
              transition={150}
            />
          </Pressable>
        ) : null}
        {message.body ? (
          <Text style={[styles.body, imagePath && styles.caption, { color: textColor }]}>{message.body}</Text>
        ) : null}
        <View style={[styles.meta, imagePath && styles.caption]}>
          <Text style={[styles.time, { color: mine ? theme.onAccent : theme.textSecondary }]}>{time}</Text>
          {status ? (
            <View accessibilityLabel={status === 'delivered' ? 'Entregado' : 'Enviado'}>
              <Icon name={status === 'delivered' ? 'checks' : 'check'} color={theme.onAccent} size={15} strokeWidth={2.2} />
            </View>
          ) : null}
        </View>
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Enviar foto"
            onPress={choosePhoto}
            disabled={sending}
            hitSlop={8}
            style={[styles.attach, { backgroundColor: theme.backgroundElement }]}>
            <Icon name="image" color={theme.accent} size={22} />
          </Pressable>
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
            style={[styles.send, { backgroundColor: theme.accent, opacity: draft.trim() || sending ? 1 : 0.4 }]}>
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
  dayPill: {
    alignSelf: 'center',
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    marginVertical: Spacing.two,
  },
  dayText: { fontSize: 12, fontWeight: '600' },
  bubble: { maxWidth: '80%', borderRadius: 18, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, gap: 2 },
  bubbleWithImage: { padding: Spacing.one, paddingHorizontal: Spacing.one },
  mine: { alignSelf: 'flex-end', borderBottomRightRadius: 6 },
  theirs: { alignSelf: 'flex-start', borderBottomLeftRadius: 6 },
  image: { borderRadius: 14 },
  body: { fontSize: 16, lineHeight: 22 },
  caption: { paddingHorizontal: Spacing.two },
  meta: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: 3, paddingBottom: 2 },
  time: { fontSize: 11, opacity: 0.8 },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  attach: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, minHeight: 46, borderRadius: 23, paddingHorizontal: Spacing.three, fontSize: 16 },
  send: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
});

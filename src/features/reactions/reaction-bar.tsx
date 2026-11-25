import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { showDialog } from '@/components/dialog';
import { Icon } from '@/components/icon';
import { Field } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/use-query';

import { sendReaction } from './api';
import { charLength, MAX_MESSAGE_LENGTH, REACTION_EMOJIS, validateReaction, type Reaction } from './rules';

export type ReactionBarProps = {
  /** Called after a reaction was stored (the other phone gets it via Realtime or push). */
  onSent?: (reaction: Reaction) => void;
  /** Disables every control (e.g. while offline). */
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * Six quick emojis plus a short message (≤ 80 characters) for the other
 * member's phone. Self-contained: validates, sends and reports errors itself.
 */
export function ReactionBar({ onSent, disabled, style }: ReactionBarProps) {
  const theme = useTheme();
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sentLabel, setSentLabel] = useState<string | null>(null);

  const length = charLength(message.trim());
  const tooLong = length > MAX_MESSAGE_LENGTH;
  const canSendMessage = !disabled && !sending && validateReaction({ message }).ok;

  const send = async (input: { emoji?: string; message?: string }) => {
    if (disabled || sending) return;
    setSending(true);
    try {
      const reaction = await sendReaction(input);
      if (input.message !== undefined) setMessage('');
      setSentLabel(input.emoji ? `Enviaste ${input.emoji}` : 'Mensaje enviado');
      setTimeout(() => setSentLabel(null), 2000);
      onSent?.(reaction);
    } catch (error) {
      showDialog('No se pudo enviar', errorMessage(error));
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={[styles.container, style]}>
      <View style={styles.emojis}>
        {REACTION_EMOJIS.map((emoji) => (
          <Pressable
            key={emoji}
            accessibilityRole="button"
            accessibilityLabel={`Enviar ${emoji}`}
            disabled={disabled || sending}
            onPress={() => send({ emoji })}
            style={({ pressed }) => [
              styles.emojiButton,
              { backgroundColor: theme.backgroundElement, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
            ]}>
            <Text style={styles.emoji}>{emoji}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.row}>
        <Field
          value={message}
          onChangeText={setMessage}
          placeholder="Mensajito…"
          editable={!disabled}
          returnKeyType="send"
          onSubmitEditing={() => canSendMessage && send({ message })}
          accessibilityLabel="Mensaje corto"
          style={styles.field}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Enviar mensaje"
          disabled={!canSendMessage}
          onPress={() => send({ message })}
          style={({ pressed }) => [
            styles.sendButton,
            { backgroundColor: theme.accent, opacity: !canSendMessage ? 0.5 : pressed ? 0.8 : 1 },
          ]}>
          <Icon name="send" color={theme.onAccent} size={20} />
        </Pressable>
      </View>
      <Text style={[styles.hint, { color: tooLong ? theme.danger : theme.textSecondary }]}>
        {sentLabel ?? `${length}/${MAX_MESSAGE_LENGTH}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.two },
  emojis: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.one },
  emojiButton: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 10, paddingVertical: Spacing.two },
  emoji: { fontSize: 26 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  field: { flex: 1 },
  sendButton: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  hint: { fontSize: 13, textAlign: 'right' },
});

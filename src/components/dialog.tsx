import { useSyncExternalStore } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { layoutDialog, type DialogButton } from '@/lib/dialog-layout';

export type { DialogButton } from '@/lib/dialog-layout';

type DialogRequest = { id: number; title: string; message?: string; buttons?: DialogButton[] };

// Imperative API (like Alert.alert) backed by a tiny store and one <DialogHost /> at the root.
// Dialogs shown before the host mounts wait in the queue; they are never lost.
let nextId = 1;
let queue: DialogRequest[] = [];
const listeners = new Set<() => void>();

function setQueue(next: DialogRequest[]) {
  queue = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Drop-in, themed replacement for Alert.alert(title, message, buttons). */
export function showDialog(title: string, message?: string, buttons?: DialogButton[]) {
  setQueue([...queue, { id: nextId++, title, message, buttons }]);
}

export function DialogHost() {
  const theme = useTheme();
  const current = useSyncExternalStore(subscribe, () => queue[0]);
  if (!current) return null;

  const layout = layoutDialog(current.buttons);
  const close = (button: DialogButton | null) => {
    setQueue(queue.slice(1));
    button?.onPress?.();
  };

  const buttonColors = (button: DialogButton) => {
    if (button.style === 'destructive') return { bg: theme.danger, fg: '#FFFFFF' };
    if (button.style === 'cancel') return { bg: theme.backgroundSelected, fg: theme.text };
    if (layout.direction === 'column') return { bg: theme.accentSoft, fg: theme.accentText };
    return { bg: theme.accent, fg: theme.onAccent };
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => close(layout.dismiss)}>
      <Pressable
        style={styles.backdrop}
        onPress={() => close(layout.dismiss)}
        accessibilityLabel="Cerrar"
        accessibilityRole="button">
        <Pressable
          accessibilityViewIsModal
          accessibilityRole="alert"
          onPress={() => undefined}
          style={[styles.card, { backgroundColor: theme.background }]}>
          <View style={[styles.stripe, { backgroundColor: theme.accent }]} />
          <Text style={[styles.title, { color: theme.text }]}>{current.title}</Text>
          {current.message ? (
            <Text style={[styles.message, { color: theme.textSecondary }]}>{current.message}</Text>
          ) : null}
          <View style={layout.direction === 'row' ? styles.row : styles.column}>
            {layout.buttons.map((button) => {
              const { bg, fg } = buttonColors(button);
              return (
                <Pressable
                  key={button.text}
                  accessibilityRole="button"
                  onPress={() => close(button)}
                  style={({ pressed }) => [
                    styles.button,
                    layout.direction === 'row' && styles.buttonRow,
                    { backgroundColor: bg, opacity: pressed ? 0.8 : 1 },
                  ]}>
                  <Text style={[styles.buttonText, { color: fg }]}>{button.text}</Text>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  card: {
    borderRadius: 20,
    padding: Spacing.four,
    paddingTop: Spacing.four + 6,
    gap: Spacing.two,
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
    overflow: 'hidden',
  },
  stripe: { position: 'absolute', top: 0, left: 0, right: 0, height: 6 },
  title: { fontSize: 19, fontWeight: '700' },
  message: { fontSize: 15, lineHeight: 21 },
  row: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.three },
  column: { gap: Spacing.two, marginTop: Spacing.three },
  button: { minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.three },
  buttonRow: { flex: 1 },
  buttonText: { fontSize: 15, fontWeight: '700' },
});

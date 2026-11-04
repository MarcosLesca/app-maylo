import { useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';

import { Icon } from '@/components/icon';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type QuickAddFieldProps = {
  placeholder: string;
  /** Optional small second field (e.g. quantity), passed along when adding. */
  secondaryPlaceholder?: string;
  /** Resolves to false when saving failed, so the typed text is kept. */
  onAdd: (text: string, secondary: string) => Promise<boolean>;
};

/**
 * Type and press Enter to add. No button: the item is added on submit, the
 * field clears and the keyboard stays open for the next one.
 */
export function QuickAddField({ placeholder, secondaryPlaceholder, onAdd }: QuickAddFieldProps) {
  const theme = useTheme();
  const [text, setText] = useState('');
  const [secondary, setSecondary] = useState('');
  const [saving, setSaving] = useState(false);
  const mainInput = useRef<ComponentRef<typeof TextInput>>(null);

  const submit = async () => {
    const value = text.trim();
    if (!value || saving) return;
    setSaving(true);
    try {
      const saved = await onAdd(value, secondary.trim());
      if (saved) {
        setText('');
        setSecondary('');
      }
      mainInput.current?.focus();
    } finally {
      setSaving(false);
    }
  };

  const inputProps = {
    placeholderTextColor: theme.textSecondary,
    returnKeyType: 'done' as const,
    submitBehavior: 'submit' as const,
    onSubmitEditing: submit,
    editable: !saving,
  };

  return (
    <View style={styles.row}>
      <View style={[styles.field, styles.main, { backgroundColor: theme.backgroundElement }]}>
        {saving ? (
          <ActivityIndicator size="small" color={theme.accent} />
        ) : (
          <Icon name="plus" color={theme.accent} size={20} strokeWidth={2.5} />
        )}
        <TextInput
          ref={mainInput}
          {...inputProps}
          placeholder={placeholder}
          value={text}
          onChangeText={setText}
          style={[styles.input, { color: theme.text }]}
        />
      </View>
      {secondaryPlaceholder ? (
        <TextInput
          {...inputProps}
          placeholder={secondaryPlaceholder}
          value={secondary}
          onChangeText={setSecondary}
          style={[styles.field, styles.secondary, styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.two },
  field: { borderRadius: 10, minHeight: 48 },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingLeft: Spacing.three },
  secondary: { width: 88, paddingHorizontal: Spacing.three },
  input: { flex: 1, fontSize: 16, paddingVertical: Spacing.two + 2, paddingRight: Spacing.three },
});

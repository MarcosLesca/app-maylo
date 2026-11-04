import { type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { Icon, type IconName } from '@/components/icon';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
};

export function Button({ label, onPress, variant = 'primary', disabled, loading, style }: ButtonProps) {
  const theme = useTheme();
  const background =
    variant === 'primary' ? theme.accent : variant === 'danger' ? theme.danger : theme.backgroundSelected;
  const color = variant === 'primary' ? theme.onAccent : variant === 'danger' ? '#ffffff' : theme.text;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: background, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
        style,
      ]}>
      {loading ? <ActivityIndicator color={color} /> : <Text style={[styles.buttonText, { color }]}>{label}</Text>}
    </Pressable>
  );
}

export function Field(props: TextInputProps) {
  const theme = useTheme();
  return (
    <TextInput
      placeholderTextColor={theme.textSecondary}
      {...props}
      style={[
        styles.field,
        { backgroundColor: theme.backgroundElement, color: theme.text },
        props.style,
      ]}
    />
  );
}

type CheckRowProps = {
  checked: boolean;
  title: string;
  subtitle?: string;
  onToggle: () => void;
  onLongPress?: () => void;
  right?: ReactNode;
  children?: ReactNode;
};

export function CheckRow({ checked, title, subtitle, onToggle, onLongPress, right, children }: CheckRowProps) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: checked ? theme.successSoft : theme.backgroundElement }]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        onPress={onToggle}
        onLongPress={onLongPress}
        style={styles.row}>
        <View
          style={[
            styles.box,
            { borderColor: checked ? theme.success : theme.textSecondary },
            checked && { backgroundColor: theme.success },
          ]}>
          {checked && <Icon name="check" color={theme.onSuccess} size={16} strokeWidth={3} />}
        </View>
        <View style={styles.rowBody}>
          <Text
            style={[
              styles.title,
              { color: checked ? theme.textSecondary : theme.text },
              checked && styles.strike,
            ]}>
            {title}
          </Text>
          {subtitle ? <Text style={[styles.subtitle, { color: theme.textSecondary }]}>{subtitle}</Text> : null}
        </View>
        {right}
      </Pressable>
      {children}
    </View>
  );
}

export function SectionTitle({ children, icon }: { children: ReactNode; icon?: IconName }) {
  const theme = useTheme();
  if (!icon) return <Text style={[styles.section, { color: theme.text }]}>{children}</Text>;
  return (
    <View style={styles.sectionWithIcon}>
      <Icon name={icon} color={theme.accent} size={20} />
      <Text style={[styles.section, styles.sectionInline, { color: theme.text }]}>{children}</Text>
    </View>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <Text style={{ color: theme.textSecondary }}>{children}</Text>;
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: Spacing.two + 2,
    paddingHorizontal: Spacing.three,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 15, fontWeight: '600' },
  field: {
    paddingVertical: Spacing.two + 2,
    paddingHorizontal: Spacing.three,
    borderRadius: 10,
    fontSize: 16,
  },
  card: { borderRadius: 12, padding: Spacing.three, gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  rowBody: { flex: 1, gap: 2 },
  box: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 16, fontWeight: '600' },
  strike: { textDecorationLine: 'line-through' },
  subtitle: { fontSize: 13 },
  section: { fontSize: 18, fontWeight: '700', marginTop: Spacing.three },
  sectionWithIcon: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.three },
  sectionInline: { marginTop: 0 },
});

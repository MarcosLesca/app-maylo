import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text } from 'react-native';

import { Calendar } from '@/components/calendar';
import { Icon } from '@/components/icon';
import { Button } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { toIsoDate } from '@/lib/calendar';

type DateFieldProps = {
  value: string | null;
  onChange: (date: string) => void;
  /** Days to highlight in the calendar. */
  planned: ReadonlySet<string>;
  placeholder?: string;
  /** Formats the selected ISO date for the field. */
  format: (iso: string) => string;
};

const monthOf = (iso: string) => `${iso.slice(0, 7)}-01`;

/** A field that shows the chosen date and opens a calendar when tapped. */
export function DateField({ value, onChange, planned, placeholder = 'Elegir fecha', format }: DateFieldProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(monthOf(value ?? toIsoDate(new Date())));

  const show = () => {
    setMonth(monthOf(value ?? toIsoDate(new Date())));
    setOpen(true);
  };

  const pick = (date: string) => {
    onChange(date);
    setOpen(false);
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={value ? `Fecha: ${format(value)}. Cambiar` : placeholder}
        onPress={show}
        style={({ pressed }) => [
          styles.field,
          { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.8 : 1 },
        ]}>
        <Icon name="calendar" color={theme.accent} size={20} />
        <Text style={[styles.value, { color: value ? theme.text : theme.textSecondary }]}>
          {value ? format(value) : placeholder}
        </Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityLabel="Cerrar calendario">
          {/* Stop taps inside the card from closing the modal. */}
          <Pressable style={[styles.sheet, { backgroundColor: theme.background }]} onPress={() => undefined}>
            <Calendar month={month} onMonthChange={setMonth} selected={value} onSelect={pick} planned={planned} />
            <Button label="Cancelar" variant="secondary" onPress={() => setOpen(false)} />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 10,
    minHeight: 48,
    paddingHorizontal: Spacing.three,
  },
  value: { fontSize: 16, flex: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: Spacing.three,
  },
  sheet: { borderRadius: 20, padding: Spacing.three, gap: Spacing.three, width: '100%', maxWidth: 420, alignSelf: 'center' },
});

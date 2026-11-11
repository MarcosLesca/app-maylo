import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { Button } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { currentPeriod } from '@/lib/period';

const SHORT_MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

type MonthPickerProps = {
  title: string;
  /** Selected period ("2026-12-01") or null. */
  value: string | null;
  onSelect: (period: string | null) => void;
  onClose: () => void;
};

/** Modal grid of the 12 months with a year switcher. "Sin mes" clears the choice. */
export function MonthPicker({ title, value, onSelect, onClose }: MonthPickerProps) {
  const theme = useTheme();
  const [year, setYear] = useState(() => Number((value ?? currentPeriod()).slice(0, 4)));

  const pick = (period: string | null) => {
    onClose();
    onSelect(period);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Cerrar" accessibilityRole="button">
        <Pressable onPress={() => undefined} style={[styles.card, { backgroundColor: theme.background }]}>
          <Text style={[styles.title, { color: theme.text }]} numberOfLines={2}>
            {title}
          </Text>
          <View style={styles.yearRow}>
            <Pressable accessibilityLabel="Año anterior" hitSlop={12} onPress={() => setYear(year - 1)} style={styles.arrow}>
              <Icon name="chevronLeft" color={theme.accent} size={26} strokeWidth={2.5} />
            </Pressable>
            <Text style={[styles.year, { color: theme.text }]}>{year}</Text>
            <Pressable accessibilityLabel="Año siguiente" hitSlop={12} onPress={() => setYear(year + 1)} style={styles.arrow}>
              <Icon name="chevronRight" color={theme.accent} size={26} strokeWidth={2.5} />
            </Pressable>
          </View>
          <View style={styles.grid}>
            {SHORT_MONTHS.map((label, index) => {
              const period = `${year}-${String(index + 1).padStart(2, '0')}-01`;
              const selected = period === value;
              return (
                <Pressable
                  key={label}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => pick(period)}
                  style={[styles.month, { backgroundColor: selected ? theme.accent : theme.backgroundElement }]}>
                  <Text style={[styles.monthText, { color: selected ? theme.onAccent : theme.text }]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.actions}>
            <Button label="Sin mes" variant="secondary" style={styles.flex} onPress={() => pick(null)} />
            <Button label="Cancelar" variant="secondary" style={styles.flex} onPress={onClose} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: Spacing.four },
  card: { borderRadius: 20, padding: Spacing.four, gap: Spacing.three, width: '100%', maxWidth: 400, alignSelf: 'center' },
  title: { fontSize: 19, fontWeight: '700' },
  yearRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  arrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  year: { fontSize: 18, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  month: { width: '31%', flexGrow: 1, minHeight: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  monthText: { fontSize: 15, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: Spacing.two },
});

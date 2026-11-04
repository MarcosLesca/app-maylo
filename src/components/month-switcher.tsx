import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { useTheme } from '@/hooks/use-theme';
import { formatPeriod, shiftPeriod } from '@/lib/period';

type Props = { period: string; onChange: (period: string) => void };

export function MonthSwitcher({ period, onChange }: Props) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Mes anterior"
        hitSlop={12}
        style={styles.arrow}
        onPress={() => onChange(shiftPeriod(period, -1))}>
        <Icon name="chevronLeft" color={theme.accent} size={28} strokeWidth={2.5} />
      </Pressable>
      <Text style={[styles.label, { color: theme.text }]}>{formatPeriod(period)}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Mes siguiente"
        hitSlop={12}
        style={styles.arrow}
        onPress={() => onChange(shiftPeriod(period, 1))}>
        <Icon name="chevronRight" color={theme.accent} size={28} strokeWidth={2.5} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  arrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 20, fontWeight: '700' },
});

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Accent } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { formatPeriod, shiftPeriod } from '@/lib/period';

type Props = { period: string; onChange: (period: string) => void };

export function MonthSwitcher({ period, onChange }: Props) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <Pressable accessibilityLabel="Mes anterior" hitSlop={12} onPress={() => onChange(shiftPeriod(period, -1))}>
        <Text style={styles.arrow}>‹</Text>
      </Pressable>
      <Text style={[styles.label, { color: theme.text }]}>{formatPeriod(period)}</Text>
      <Pressable accessibilityLabel="Mes siguiente" hitSlop={12} onPress={() => onChange(shiftPeriod(period, 1))}>
        <Text style={styles.arrow}>›</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  arrow: { fontSize: 32, color: Accent, paddingHorizontal: 8 },
  label: { fontSize: 20, fontWeight: '700' },
});

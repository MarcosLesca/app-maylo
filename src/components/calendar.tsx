import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MonthSwitcher } from '@/components/month-switcher';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { monthGrid, toIsoDate } from '@/lib/calendar';

const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

type CalendarProps = {
  /** First day of the visible month, e.g. "2027-02-01". */
  month: string;
  onMonthChange: (month: string) => void;
  selected: string | null;
  onSelect: (date: string) => void;
  /** Days that already have something planned; shown in green. */
  planned: ReadonlySet<string>;
};

export function Calendar({ month, onMonthChange, selected, onSelect, planned }: CalendarProps) {
  const theme = useTheme();
  const today = toIsoDate(new Date());

  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
      <MonthSwitcher period={month} onChange={onMonthChange} />

      <View style={styles.week}>
        {WEEKDAYS.map((label, i) => (
          <Text key={i} style={[styles.weekday, { color: theme.textSecondary }]}>
            {label}
          </Text>
        ))}
      </View>

      {monthGrid(month).map((week, w) => (
        <View key={w} style={styles.week}>
          {week.map((date, d) => {
            if (!date) return <View key={d} style={styles.cell} />;

            const isSelected = date === selected;
            const isPlanned = planned.has(date);
            const isToday = date === today;
            const background = isSelected ? theme.accent : isPlanned ? theme.successSoft : 'transparent';
            const color = isSelected ? theme.onAccent : isPlanned ? theme.successText : theme.text;
            const day = Number(date.slice(8));

            return (
              <Pressable
                key={d}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`${day}${isPlanned ? ', con comidas planificadas' : ''}${isToday ? ', hoy' : ''}`}
                onPress={() => onSelect(date)}
                style={styles.cell}>
                <View
                  style={[
                    styles.day,
                    { backgroundColor: background },
                    isToday && !isSelected && { borderWidth: 1.5, borderColor: theme.accent },
                  ]}>
                  <Text style={[styles.dayText, { color }, (isPlanned || isSelected) && styles.dayStrong]}>
                    {day}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}

      <View style={styles.legend}>
        <LegendItem color={theme.successSoft} border={theme.success} label="Con comidas planificadas" />
        <LegendItem color={theme.accent} label="Seleccionado" />
      </View>
    </View>
  );
}

function LegendItem({ color, border, label }: { color: string; border?: string; label: string }) {
  const theme = useTheme();
  return (
    <View style={styles.legendItem}>
      <View style={[styles.swatch, { backgroundColor: color }, border ? { borderWidth: 1, borderColor: border } : null]} />
      <Text style={[styles.legendText, { color: theme.textSecondary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, padding: Spacing.two, gap: 2 },
  week: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', fontSize: 12, fontWeight: '600', paddingVertical: Spacing.one },
  cell: { flex: 1, height: 44, alignItems: 'center', justifyContent: 'center' },
  day: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  dayText: { fontSize: 15 },
  dayStrong: { fontWeight: '700' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three, paddingTop: Spacing.two, paddingHorizontal: Spacing.one },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one + 2 },
  swatch: { width: 12, height: 12, borderRadius: 6 },
  legendText: { fontSize: 12 },
});

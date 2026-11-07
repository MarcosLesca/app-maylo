import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DateField } from '@/components/date-field';
import { showDialog } from '@/components/dialog';
import { QuickAddField } from '@/components/quick-add-field';
import { Screen } from '@/components/screen';
import { Button, CheckRow, Muted, SectionTitle } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/auth-provider';
import {
  dosesFor,
  effectiveWeek,
  FIXED_FOODS,
  planWeek,
  TRAINING_DAYS_PER_WEEK,
  weekStartOf,
  type AfterWeek4,
  type DayType,
} from '@/features/recomp/plan';
import {
  deleteWeight,
  getSettings,
  listDays,
  listWeights,
  saveAfterWeek4,
  saveDay,
  saveStartDate,
  saveWeight,
} from '@/features/recomp/recomp-api';
import { WeightChart } from '@/features/recomp/weight-chart';
import { useTheme } from '@/hooks/use-theme';
import { toIsoDate } from '@/lib/calendar';
import { mutate, useQuery } from '@/lib/use-query';

const NO_DATES = new Set<string>();

const LONG_DATE = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });
const formatDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return LONG_DATE.format(new Date(y, m - 1, d));
};

export default function RecompScreen() {
  const theme = useTheme();
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  const today = toIsoDate(new Date());

  const { data: settings, refreshing, refresh: refreshSettings } = useQuery(null, getSettings, null);
  const weekStart = settings ? weekStartOf(settings.start_date, today) : null;
  const { data: days, refresh: refreshDays } = useQuery(weekStart, (from) => (from ? listDays(from) : Promise.resolve([])), []);
  const { data: weights, refresh: refreshWeights } = useQuery(null, listWeights, []);
  const [startDraft, setStartDraft] = useState<string | null>(today);

  const refreshAll = async () => {
    await Promise.all([refreshSettings(), refreshDays(), refreshWeights()]);
  };

  if (!settings) {
    return (
      <Screen refreshing={refreshing} onRefresh={refreshAll}>
        <SectionTitle>Recomposición corporal</SectionTitle>
        <Muted>Elegí el día en que empezás el plan. Las semanas y las cantidades se calculan solas desde esa fecha.</Muted>
        <DateField value={startDraft} onChange={setStartDraft} planned={NO_DATES} format={formatDate} />
        <Button
          label="Empezar plan"
          disabled={!startDraft}
          onPress={() => startDraft && mutate(() => saveStartDate(userId, startDraft), refreshAll)}
        />
      </Screen>
    );
  }

  const week = planWeek(settings.start_date, today);
  const portionsWeek = effectiveWeek(week, settings.after_week4);
  const todayLog = days.find((d) => d.day === today);
  const dayType: DayType = todayLog?.day_type ?? 'training';
  const doses = dosesFor(portionsWeek, dayType);
  const trainingThisWeek = days.filter((d) => d.day_type === 'training').length;
  const weekLabel = week === 0 ? 'Todavía no empezó' : `Semana ${week >= 5 ? '5+' : week}`;

  const setDayType = (type: DayType) =>
    mutate(() => saveDay(userId, { day: today, day_type: type, completed: todayLog?.completed ?? false }), refreshDays);

  const toggleCompleted = () =>
    mutate(() => saveDay(userId, { day: today, day_type: dayType, completed: !todayLog?.completed }), refreshDays);

  const chooseAfterWeek4 = (choice: AfterWeek4 | null) => mutate(() => saveAfterWeek4(userId, choice), refreshSettings);

  const addWeight = async (text: string) => {
    const kg = Number(text.replace(',', '.'));
    if (!Number.isFinite(kg) || kg < 20 || kg > 400) {
      showDialog('Peso inválido', 'Ingresá el peso en kilos, por ejemplo 78,5.');
      return false;
    }
    return mutate(() => saveWeight(userId, today, kg), refreshWeights);
  };

  const confirmDeleteWeight = (day: string) =>
    showDialog(`¿Borrar el peso del ${formatDate(day)}?`, undefined, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Borrar', style: 'destructive', onPress: () => mutate(() => deleteWeight(userId, day), refreshWeights) },
    ]);

  const changeStartDate = (date: string) =>
    showDialog('¿Cambiar la fecha de inicio?', `El plan va a contar las semanas desde el ${formatDate(date)}.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Cambiar', onPress: () => mutate(() => saveStartDate(userId, date), refreshAll) },
    ]);

  return (
    <Screen refreshing={refreshing} onRefresh={refreshAll}>
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={[styles.week, { color: theme.text }]}>{weekLabel}</Text>
          {portionsWeek !== week && week > 0 ? <Muted>Cantidades de semana 4 (mantenimiento)</Muted> : null}
        </View>
        <View style={[styles.counter, { backgroundColor: theme.accentSoft }]}>
          <Text style={[styles.counterValue, { color: theme.accentText }]}>
            {trainingThisWeek}/{TRAINING_DAYS_PER_WEEK}
          </Text>
          <Text style={[styles.counterLabel, { color: theme.accentText }]}>entrenos</Text>
        </View>
      </View>

      <View style={[styles.segment, { backgroundColor: theme.backgroundElement }]}>
        {(['training', 'rest'] as const).map((type) => {
          const active = dayType === type;
          return (
            <Pressable
              key={type}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setDayType(type)}
              style={[styles.segmentItem, active && { backgroundColor: theme.accent }]}>
              <Text style={[styles.segmentText, { color: active ? theme.onAccent : theme.text }]}>
                {type === 'training' ? 'Hoy entreno' : 'Hoy descanso'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
        <SectionTitle>Hoy comés</SectionTitle>
        <Portion label="Papa" value={`${doses.potatoG} g`} hint="pesada recién hervida, antes de congelar" />
        <Portion label="Maní" value={`${doses.peanutsG} g`} />
        <Portion label="Aceite" value={`${doses.oilTsp} cdtas`} />
        <Portion label="Pan" value={`${doses.breadG} g`} />
        {FIXED_FOODS.map((food) => (
          <Text key={food} style={[styles.fixed, { color: theme.textSecondary }]}>
            + {food}
          </Text>
        ))}
        <View style={[styles.totals, { borderTopColor: theme.backgroundSelected }]}>
          <Total label="kcal" value={doses.kcal} />
          <Total label="Prot" value={`${doses.protein} g`} />
          <Total label="Carb" value={`${doses.carbs} g`} />
          <Total label="Grasa" value={`${doses.fat} g`} />
        </View>
      </View>

      <CheckRow checked={!!todayLog?.completed} title="Cumplí el plan hoy" onToggle={toggleCompleted} />

      {week >= 4 ? (
        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <SectionTitle>Decisión de la semana 4</SectionTitle>
          {settings.after_week4 ? (
            <>
              <Muted>
                {settings.after_week4 === 'maintain'
                  ? 'Elegiste mantener la semana 4: priorizás no ganar grasa.'
                  : 'Elegiste seguir a la semana 5: buscás el máximo músculo.'}
              </Muted>
              <Button label="Cambiar decisión" variant="secondary" onPress={() => chooseAfterWeek4(null)} />
            </>
          ) : (
            <>
              <Muted>Mantener la semana 4: no sumás grasa, pero el músculo crece más lento.</Muted>
              <Muted>Pasar a la semana 5: más músculo, con un superávit chico que puede sumar algo de grasa.</Muted>
              <View style={styles.choiceRow}>
                <Button label="Mantener" variant="secondary" style={styles.flex} onPress={() => chooseAfterWeek4('maintain')} />
                <Button label="Semana 5" style={styles.flex} onPress={() => chooseAfterWeek4('continue')} />
              </View>
            </>
          )}
        </View>
      ) : null}

      <SectionTitle>Peso</SectionTitle>
      <QuickAddField placeholder="Peso de hoy (kg)" keyboardType="decimal-pad" onAdd={addWeight} />
      <WeightChart points={weights} />
      {weights
        .slice(-5)
        .reverse()
        .map((w) => (
          <Pressable
            key={w.day}
            onLongPress={() => confirmDeleteWeight(w.day)}
            style={[styles.weightRow, { borderBottomColor: theme.backgroundSelected }]}>
            <Text style={{ color: theme.textSecondary }}>{formatDate(w.day)}</Text>
            <Text style={[styles.weightValue, { color: theme.text }]}>
              {w.kg.toLocaleString('es-AR', { maximumFractionDigits: 1 })} kg
            </Text>
          </Pressable>
        ))}
      {weights.length > 0 ? <Muted>Mantené presionado un peso para borrarlo.</Muted> : null}

      <SectionTitle>Inicio del plan</SectionTitle>
      <DateField value={settings.start_date} onChange={changeStartDate} planned={NO_DATES} format={formatDate} />
    </Screen>
  );
}

function Portion({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.portion}>
      <View style={styles.flex}>
        <Text style={[styles.portionLabel, { color: theme.text }]}>{label}</Text>
        {hint ? <Text style={[styles.hint, { color: theme.textSecondary }]}>{hint}</Text> : null}
      </View>
      <Text style={[styles.portionValue, { color: theme.accentText }]}>{value}</Text>
    </View>
  );
}

function Total({ label, value }: { label: string; value: string | number }) {
  const theme = useTheme();
  return (
    <View style={styles.total}>
      <Text style={[styles.totalValue, { color: theme.text }]}>{value}</Text>
      <Text style={[styles.totalLabel, { color: theme.textSecondary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  headerText: { flex: 1, gap: 2 },
  week: { fontSize: 26, fontWeight: '800' },
  counter: { borderRadius: 14, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, alignItems: 'center' },
  counterValue: { fontSize: 20, fontWeight: '800' },
  counterLabel: { fontSize: 12, fontWeight: '600' },
  segment: { flexDirection: 'row', borderRadius: 14, padding: 4, gap: 4 },
  segmentItem: { flex: 1, minHeight: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  segmentText: { fontSize: 15, fontWeight: '700' },
  card: { borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
  portion: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  portionLabel: { fontSize: 16, fontWeight: '600' },
  portionValue: { fontSize: 18, fontWeight: '800' },
  hint: { fontSize: 12 },
  fixed: { fontSize: 14 },
  totals: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.two, marginTop: Spacing.one },
  total: { flex: 1, alignItems: 'center' },
  totalValue: { fontSize: 16, fontWeight: '700' },
  totalLabel: { fontSize: 12 },
  choiceRow: { flexDirection: 'row', gap: Spacing.two },
  weightRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  weightValue: { fontSize: 16, fontWeight: '700' },
});

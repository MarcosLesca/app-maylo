import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { showDialog } from '@/components/dialog';
import { Icon } from '@/components/icon';
import { QuickAddField } from '@/components/quick-add-field';
import { Screen } from '@/components/screen';
import { Segmented } from '@/components/segmented';
import { Muted, SectionTitle } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/auth-provider';
import {
  addFood,
  deleteFood,
  listFoods,
  listTotals,
  saveTotal,
  updateFood,
  type BulkFood,
  type TotalField,
} from '@/features/bulk/bulk-api';
import { formatAmount, parseAmount, type DayType } from '@/features/bulk/notebook';
import { useTheme } from '@/hooks/use-theme';
import { mutate, useQuery } from '@/lib/use-query';

const DAY_TYPES = [
  { value: 'training', label: 'Día de entreno' },
  { value: 'rest', label: 'Día de descanso' },
] as const;

const TOTAL_FIELDS: { field: TotalField; label: string; unit: string }[] = [
  { field: 'kcal', label: 'Calorías', unit: 'kcal' },
  { field: 'protein_g', label: 'Proteína', unit: 'g' },
  { field: 'fat_g', label: 'Grasas', unit: 'g' },
];

const invalidAmount = () => showDialog('Cantidad inválida', 'Escribí solo el número, por ejemplo 635 o 12,5.');

/** A personal notebook: what to eat (and how much) on training and rest days. */
export default function BulkScreen() {
  const theme = useTheme();
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  const [dayType, setDayType] = useState<DayType>('training');
  const { data: foods, refreshing, refresh: refreshFoods } = useQuery(null, listFoods, []);
  const { data: totals, refresh: refreshTotals } = useQuery(null, listTotals, []);

  const refresh = async () => {
    await Promise.all([refreshFoods(), refreshTotals()]);
  };

  const dayFoods = foods.filter((f) => f.day_type === dayType);
  const dayTotals = totals.find((t) => t.day_type === dayType);

  const add = (name: string, gramsText: string) => {
    const grams = parseAmount(gramsText);
    if (grams === undefined) {
      invalidAmount();
      return Promise.resolve(false);
    }
    return mutate(() => addFood(dayType, name, grams), refreshFoods);
  };

  const remove = (food: BulkFood) =>
    showDialog(`¿Borrar "${food.name}"?`, undefined, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Borrar', style: 'destructive', onPress: () => mutate(() => deleteFood(food.id), refreshFoods) },
    ]);

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Segmented options={DAY_TYPES} value={dayType} onChange={setDayType} />

      <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
        <SectionTitle>Comidas</SectionTitle>
        {dayFoods.length === 0 ? <Muted>Todavía no anotaste comidas para este día.</Muted> : null}
        {dayFoods.map((food) => (
          // Remount when the stored values change, so an unsaved draft never lingers after a refresh.
          <FoodRow key={`${food.id}-${food.name}-${food.grams ?? ''}`} food={food} onSaved={refreshFoods} onDelete={() => remove(food)} />
        ))}
      </View>
      <QuickAddField placeholder="Agregar comida" secondaryPlaceholder="gramos" onAdd={add} />

      <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
        <SectionTitle>Total del día</SectionTitle>
        {TOTAL_FIELDS.map(({ field, label, unit }) => (
          <AmountField
            // Remount when the day or the stored value changes, so the draft shows the saved number.
            key={`${dayType}-${field}-${dayTotals?.[field] ?? ''}`}
            label={label}
            unit={unit}
            value={dayTotals?.[field] ?? null}
            onSave={(value) => mutate(() => saveTotal(userId, dayType, field, value), refreshTotals)}
          />
        ))}
      </View>
      <Muted>Los cambios se guardan solos al salir de cada campo.</Muted>
    </Screen>
  );
}

type FoodRowProps = { food: BulkFood; onSaved: () => Promise<void>; onDelete: () => void };

function FoodRow({ food, onSaved, onDelete }: FoodRowProps) {
  const theme = useTheme();
  const [name, setName] = useState(food.name);
  const [grams, setGrams] = useState(formatAmount(food.grams));

  const saveName = () => {
    const value = name.trim();
    if (!value) {
      setName(food.name);
      return;
    }
    if (value !== food.name) {
      mutate(() => updateFood(food.id, { name: value }), onSaved).then((saved) => {
        if (!saved) setName(food.name);
      });
    }
  };

  const saveGrams = () => {
    const value = parseAmount(grams);
    if (value === undefined) {
      invalidAmount();
      setGrams(formatAmount(food.grams));
      return;
    }
    if (value !== food.grams) {
      mutate(() => updateFood(food.id, { grams: value }), onSaved).then((saved) => {
        if (!saved) setGrams(formatAmount(food.grams));
      });
    }
  };

  const inputStyle = [styles.input, { backgroundColor: theme.background, color: theme.text }];
  return (
    <View style={styles.foodRow}>
      <TextInput
        value={name}
        onChangeText={setName}
        onEndEditing={saveName}
        placeholder="Comida"
        placeholderTextColor={theme.textSecondary}
        style={[inputStyle, styles.flex]}
      />
      <TextInput
        value={grams}
        onChangeText={setGrams}
        onEndEditing={saveGrams}
        keyboardType="decimal-pad"
        placeholder="0"
        placeholderTextColor={theme.textSecondary}
        style={[inputStyle, styles.grams]}
      />
      <Text style={[styles.unit, { color: theme.textSecondary }]}>g</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Borrar ${food.name}`} hitSlop={8} onPress={onDelete}>
        <Icon name="close" color={theme.textSecondary} size={20} />
      </Pressable>
    </View>
  );
}

type AmountFieldProps = {
  label: string;
  unit: string;
  value: number | null;
  onSave: (value: number | null) => Promise<boolean>;
};

function AmountField({ label, unit, value, onSave }: AmountFieldProps) {
  const theme = useTheme();
  const [draft, setDraft] = useState(formatAmount(value));

  const save = () => {
    const parsed = parseAmount(draft);
    if (parsed === undefined) {
      invalidAmount();
      setDraft(formatAmount(value));
      return;
    }
    if (parsed !== value) {
      onSave(parsed).then((saved) => {
        if (!saved) setDraft(formatAmount(value));
      });
    }
  };

  return (
    <View style={styles.foodRow}>
      <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        onEndEditing={save}
        keyboardType="decimal-pad"
        placeholder="0"
        placeholderTextColor={theme.textSecondary}
        style={[styles.input, styles.amount, { backgroundColor: theme.background, color: theme.text }]}
      />
      <Text style={[styles.unit, styles.totalUnit, { color: theme.textSecondary }]}>{unit}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
  foodRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  input: { minHeight: 44, borderRadius: 10, paddingHorizontal: Spacing.three, fontSize: 16 },
  grams: { width: 80, textAlign: 'right' },
  amount: { width: 110, textAlign: 'right' },
  unit: { fontSize: 14, width: 14 },
  totalUnit: { width: 34 },
  label: { flex: 1, fontSize: 16, fontWeight: '600' },
});

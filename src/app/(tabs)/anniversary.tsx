import { useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import type { IconName } from '@/components/icon';
import { Screen } from '@/components/screen';
import { Button, CheckRow, Field, Muted, SectionTitle } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { isIsoDate } from '@/lib/period';
import { supabase } from '@/lib/supabase';
import { mutate, useQuery } from '@/lib/use-query';

type MealType = 'breakfast' | 'lunch' | 'afternoon_snack' | 'dinner';
type Dish = { id: string; meal: MealType; dish: string; notes: string | null; ready: boolean };

const MEALS: { type: MealType; label: string; icon: IconName }[] = [
  { type: 'breakfast', label: 'Desayuno', icon: 'coffee' },
  { type: 'lunch', label: 'Almuerzo', icon: 'bowl' },
  { type: 'afternoon_snack', label: 'Merienda', icon: 'cake' },
  { type: 'dinner', label: 'Cena', icon: 'glass' },
];

async function latestEventDate(): Promise<string | null> {
  const { data, error } = await supabase
    .from('anniversary_meals')
    .select('event_date')
    .order('event_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.event_date ?? null;
}

async function listDishes(date: string | null): Promise<Dish[]> {
  if (!date) return [];
  const { data, error } = await supabase
    .from('anniversary_meals')
    .select('id, meal, dish, notes, ready')
    .eq('event_date', date)
    .order('created_at');
  if (error) throw error;
  return data;
}

export default function AnniversaryScreen() {
  const [date, setDate] = useState<string | null>(null);
  const [dateInput, setDateInput] = useState('');
  const { data: dishes, refreshing, refresh } = useQuery(date, listDishes, []);

  useEffect(() => {
    latestEventDate()
      .then((latest) => {
        if (latest) {
          setDate(latest);
          setDateInput(latest);
        }
      })
      .catch(() => undefined);
  }, []);

  const applyDate = () => {
    const value = dateInput.trim();
    if (!isIsoDate(value)) return Alert.alert('Usar el formato AAAA-MM-DD', 'Ejemplo: 2027-02-14');
    setDate(value);
  };

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <SectionTitle>Fecha del aniversario</SectionTitle>
      <View style={styles.row}>
        <Field
          style={styles.flex}
          placeholder="AAAA-MM-DD"
          value={dateInput}
          onChangeText={setDateInput}
          onSubmitEditing={applyDate}
        />
        <Button label="Planificar" onPress={applyDate} disabled={!dateInput.trim()} />
      </View>

      {date ? (
        MEALS.map((meal) => (
          <MealSection
            key={meal.type}
            label={meal.label}
            icon={meal.icon}
            dishes={dishes.filter((d) => d.meal === meal.type)}
            onAdd={(dish) =>
              mutate(() => supabase.from('anniversary_meals').insert({ event_date: date, meal: meal.type, dish }), refresh)
            }
            onToggle={(dish) =>
              mutate(() => supabase.from('anniversary_meals').update({ ready: !dish.ready }).eq('id', dish.id), refresh)
            }
            onDelete={(dish) =>
              Alert.alert(`¿Eliminar "${dish.dish}"?`, undefined, [
                { text: 'Cancelar', style: 'cancel' },
                {
                  text: 'Eliminar',
                  style: 'destructive',
                  onPress: () => mutate(() => supabase.from('anniversary_meals').delete().eq('id', dish.id), refresh),
                },
              ])
            }
          />
        ))
      ) : (
        <Muted>Elegir la fecha para empezar a planificar desayuno, almuerzo, merienda y cena.</Muted>
      )}
    </Screen>
  );
}

type MealSectionProps = {
  label: string;
  icon: IconName;
  dishes: Dish[];
  onAdd: (dish: string) => Promise<void>;
  onToggle: (dish: Dish) => void;
  onDelete: (dish: Dish) => void;
};

function MealSection({ label, icon, dishes, onAdd, onToggle, onDelete }: MealSectionProps) {
  const [text, setText] = useState('');
  const add = async () => {
    await onAdd(text.trim());
    setText('');
  };

  return (
    <View style={styles.section}>
      <SectionTitle icon={icon}>{label}</SectionTitle>
      {dishes.map((dish) => (
        <CheckRow
          key={dish.id}
          checked={dish.ready}
          title={dish.dish}
          subtitle={dish.notes ?? undefined}
          onToggle={() => onToggle(dish)}
          onLongPress={() => onDelete(dish)}
        />
      ))}
      <View style={styles.row}>
        <Field style={styles.flex} placeholder="Agregar un plato o idea" value={text} onChangeText={setText} onSubmitEditing={add} />
        <Button label="Agregar" variant="secondary" onPress={add} disabled={!text.trim()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  flex: { flex: 1 },
  section: { gap: Spacing.two },
});

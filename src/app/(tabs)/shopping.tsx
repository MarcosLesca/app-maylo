import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { MonthSwitcher } from '@/components/month-switcher';
import { Screen } from '@/components/screen';
import { Button, CheckRow, Field, Muted } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { currentPeriod, shiftPeriod } from '@/lib/period';
import { supabase } from '@/lib/supabase';
import { mutate, useQuery } from '@/lib/use-query';

type ShoppingItem = { id: string; name: string; quantity: string | null; bought: boolean };

async function listItems(period: string): Promise<ShoppingItem[]> {
  const { data, error } = await supabase
    .from('shopping_items')
    .select('id, name, quantity, bought')
    .eq('period', period)
    .order('bought')
    .order('created_at');
  if (error) throw error;
  return data;
}

/** Copies last month's items (unchecked) into this month, skipping names already present. */
async function copyPreviousMonth(period: string, existing: ShoppingItem[]) {
  const previous = await listItems(shiftPeriod(period, -1));
  const taken = new Set(existing.map((i) => i.name.toLowerCase()));
  const rows = previous
    .filter((i) => !taken.has(i.name.toLowerCase()))
    .map((i) => ({ period, name: i.name, quantity: i.quantity }));
  if (rows.length === 0) return;
  return supabase.from('shopping_items').insert(rows);
}

export default function ShoppingScreen() {
  const [period, setPeriod] = useState(currentPeriod());
  const { data: items, refreshing, refresh } = useQuery(period, listItems, []);
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');

  const add = async () => {
    await mutate(
      () => supabase.from('shopping_items').insert({ period, name: name.trim(), quantity: quantity.trim() || null }),
      refresh,
    );
    setName('');
    setQuantity('');
  };

  const remove = (item: ShoppingItem) =>
    Alert.alert(`¿Eliminar "${item.name}"?`, undefined, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: () => mutate(() => supabase.from('shopping_items').delete().eq('id', item.id), refresh) },
    ]);

  const bought = items.filter((i) => i.bought).length;

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <MonthSwitcher period={period} onChange={setPeriod} />
      <Muted>{bought} de {items.length} comprados</Muted>

      <View style={styles.row}>
        <Field style={styles.name} placeholder="Producto" value={name} onChangeText={setName} onSubmitEditing={add} />
        <Field style={styles.qty} placeholder="Cant." value={quantity} onChangeText={setQuantity} />
        <Button label="Agregar" onPress={add} disabled={!name.trim()} />
      </View>

      {items.map((item) => (
        <CheckRow
          key={item.id}
          checked={item.bought}
          title={item.name}
          subtitle={item.quantity ?? undefined}
          onToggle={() => mutate(() => supabase.from('shopping_items').update({ bought: !item.bought }).eq('id', item.id), refresh)}
          onLongPress={() => remove(item)}
        />
      ))}

      <Button
        label="Copiar productos del mes anterior"
        variant="secondary"
        onPress={() => mutate(() => copyPreviousMonth(period, items), refresh)}
      />
      <Muted>Mantener presionado un producto para eliminarlo.</Muted>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  name: { flex: 3 },
  qty: { flex: 1 },
});

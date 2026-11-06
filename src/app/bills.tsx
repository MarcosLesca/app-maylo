import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { Screen } from '@/components/screen';
import { Button, CheckRow, Field, Muted, SectionTitle } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { createBill, deleteBill, listBills, setBillActive, type RecurringBill } from '@/features/payments/payments-api';
import { formatMoney } from '@/lib/period';
import { mutate, useQuery } from '@/lib/use-query';
import { showDialog } from '@/components/dialog';

function parseAmount(text: string): number | null | undefined {
  const trimmed = text.trim().replace(',', '.');
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function parseDueDay(text: string): number | null | undefined {
  if (!text.trim()) return null;
  const value = Number(text);
  return Number.isInteger(value) && value >= 1 && value <= 31 ? value : undefined;
}

export default function ManageBillsScreen() {
  const { data: bills, refreshing, refresh } = useQuery(false, listBills, []);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDay, setDueDay] = useState('');

  const add = async () => {
    const expected_amount = parseAmount(amount);
    const due_day = parseDueDay(dueDay);
    if (expected_amount === undefined) return showDialog('Monto inválido');
    if (due_day === undefined) return showDialog('El día de vencimiento debe estar entre 1 y 31');
    await mutate(() => createBill({ name: name.trim(), expected_amount, due_day }), refresh);
    setName('');
    setAmount('');
    setDueDay('');
  };

  const confirmDelete = (bill: RecurringBill) =>
    showDialog(
      `¿Eliminar "${bill.name}"?`,
      'Se eliminará todo su historial de pagos y comprobantes. Para que deje de aparecer en los meses nuevos, conviene desactivarlo.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Eliminar', style: 'destructive', onPress: () => mutate(() => deleteBill(bill.id), refresh) },
      ],
    );

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <SectionTitle>Nuevo gasto fijo</SectionTitle>
      <Field placeholder="Nombre (ej. Luz)" value={name} onChangeText={setName} />
      <View style={styles.row}>
        <Field
          style={styles.flex}
          placeholder="Monto habitual"
          keyboardType="decimal-pad"
          value={amount}
          onChangeText={setAmount}
        />
        <Field
          style={styles.flex}
          placeholder="Día de vencimiento (1-31)"
          keyboardType="number-pad"
          value={dueDay}
          onChangeText={setDueDay}
        />
      </View>
      <Button label="Agregar gasto" onPress={add} disabled={!name.trim()} />

      <SectionTitle>Todos los meses</SectionTitle>
      <Muted>Desactivar un gasto evita que aparezca en los meses nuevos. Mantener presionado para eliminar.</Muted>
      {bills.map((bill) => (
        <CheckRow
          key={bill.id}
          checked={false}
          title={bill.name}
          subtitle={`${bill.due_day ? `Día ${bill.due_day}` : 'Sin vencimiento'} · ${formatMoney(bill.expected_amount)}`}
          onToggle={() => mutate(() => setBillActive(bill.id, !bill.active), refresh)}
          onLongPress={() => confirmDelete(bill)}
          right={
            <Switch value={bill.active} onValueChange={(v) => void mutate(() => setBillActive(bill.id, v), refresh)} />
          }
        />
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.two },
  flex: { flex: 1 },
});

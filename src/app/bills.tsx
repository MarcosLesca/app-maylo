import { useState } from 'react';
import { Alert, StyleSheet, Switch, View } from 'react-native';

import { Screen } from '@/components/screen';
import { Button, CheckRow, Field, Muted, SectionTitle } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { createBill, deleteBill, listBills, setBillActive, type RecurringBill } from '@/features/payments/payments-api';
import { formatMoney } from '@/lib/period';
import { mutate, useQuery } from '@/lib/use-query';

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
    if (expected_amount === undefined) return Alert.alert('Invalid amount');
    if (due_day === undefined) return Alert.alert('Due day must be between 1 and 31');
    await mutate(() => createBill({ name: name.trim(), expected_amount, due_day }), refresh);
    setName('');
    setAmount('');
    setDueDay('');
  };

  const confirmDelete = (bill: RecurringBill) =>
    Alert.alert(
      `Delete "${bill.name}"?`,
      'Its whole payment history and receipts records will be deleted. To stop it from appearing in new months, turn it off instead.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => mutate(() => deleteBill(bill.id), refresh) },
      ],
    );

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <SectionTitle>New bill</SectionTitle>
      <Field placeholder="Name (e.g. Electricity)" value={name} onChangeText={setName} />
      <View style={styles.row}>
        <Field
          style={styles.flex}
          placeholder="Usual amount"
          keyboardType="decimal-pad"
          value={amount}
          onChangeText={setAmount}
        />
        <Field
          style={styles.flex}
          placeholder="Due day (1-31)"
          keyboardType="number-pad"
          value={dueDay}
          onChangeText={setDueDay}
        />
      </View>
      <Button label="Add bill" onPress={add} disabled={!name.trim()} />

      <SectionTitle>Every month</SectionTitle>
      <Muted>Switch off a bill to stop it from appearing in new months. Long-press to delete.</Muted>
      {bills.map((bill) => (
        <CheckRow
          key={bill.id}
          checked={false}
          title={bill.name}
          subtitle={`${bill.due_day ? `Day ${bill.due_day}` : 'No due day'} · ${formatMoney(bill.expected_amount)}`}
          onToggle={() => mutate(() => setBillActive(bill.id, !bill.active), refresh)}
          onLongPress={() => confirmDelete(bill)}
          right={
            <Switch value={bill.active} onValueChange={(v) => mutate(() => setBillActive(bill.id, v), refresh)} />
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

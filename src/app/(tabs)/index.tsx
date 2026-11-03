import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { MonthSwitcher } from '@/components/month-switcher';
import { Screen } from '@/components/screen';
import { Accent, Button, CheckRow, Muted } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import {
  getMonthlyChecklist,
  markPaid,
  unmarkPaid,
  type BillPayment,
  type MonthlyChecklistItem,
  type PaymentReceipt,
} from '@/features/payments/payments-api';
import { addReceipt, deleteReceipt, openReceipt, type ReceiptSource } from '@/features/payments/receipts';
import { useTheme } from '@/hooks/use-theme';
import { currentPeriod, formatMoney } from '@/lib/period';
import { errorMessage, mutate, useQuery } from '@/lib/use-query';

export default function BillsScreen() {
  const [period, setPeriod] = useState(currentPeriod());
  const [busyPaymentId, setBusyPaymentId] = useState<string | null>(null);
  const { data: items, refreshing, refresh } = useQuery(period, getMonthlyChecklist, []);

  const paid = items.filter((i) => i.payment);
  const pendingTotal = items
    .filter((i) => !i.payment)
    .reduce((sum, i) => sum + (i.bill.expected_amount ?? 0), 0);

  const toggle = (item: MonthlyChecklistItem) => {
    if (!item.payment) {
      mutate(() => markPaid(item.bill, period), refresh);
      return;
    }
    const payment = item.payment;
    Alert.alert(
      `Mark "${item.bill.name}" as unpaid?`,
      payment.payment_receipts.length > 0 ? 'Its receipts will be deleted too.' : undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Mark unpaid', style: 'destructive', onPress: () => mutate(() => unmarkPaid(payment), refresh) },
      ],
    );
  };

  const upload = async (payment: BillPayment, source: ReceiptSource) => {
    setBusyPaymentId(payment.id);
    try {
      if (await addReceipt(payment, source)) await refresh();
    } catch (error) {
      Alert.alert('Could not upload the receipt', errorMessage(error));
    } finally {
      setBusyPaymentId(null);
    }
  };

  const chooseSource = (payment: BillPayment) =>
    Alert.alert('Add receipt', undefined, [
      { text: 'Take photo', onPress: () => upload(payment, 'camera') },
      { text: 'From gallery', onPress: () => upload(payment, 'gallery') },
      { text: 'PDF file', onPress: () => upload(payment, 'pdf') },
      { text: 'Cancel', style: 'cancel' },
    ]);

  const receiptActions = (receipt: PaymentReceipt) =>
    Alert.alert('Receipt', undefined, [
      { text: 'Open', onPress: () => openReceipt(receipt).catch((e) => Alert.alert('Error', errorMessage(e))) },
      { text: 'Delete', style: 'destructive', onPress: () => mutate(() => deleteReceipt(receipt), refresh) },
      { text: 'Cancel', style: 'cancel' },
    ]);

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <MonthSwitcher period={period} onChange={setPeriod} />
      <Muted>
        {paid.length} of {items.length} paid · {formatMoney(pendingTotal)} still to pay
      </Muted>

      {items.length === 0 && !refreshing ? (
        <Muted>No bills yet. Add the ones you pay every month.</Muted>
      ) : null}

      {items.map((item) => (
        <CheckRow
          key={item.bill.id}
          checked={item.payment != null}
          title={item.bill.name}
          subtitle={subtitleFor(item)}
          onToggle={() => toggle(item)}>
          {item.payment ? (
            <ReceiptList
              payment={item.payment}
              busy={busyPaymentId === item.payment.id}
              onAdd={() => chooseSource(item.payment!)}
              onSelect={receiptActions}
            />
          ) : null}
        </CheckRow>
      ))}

      <Button label="Manage monthly bills" variant="secondary" onPress={() => router.push('/bills')} />
    </Screen>
  );
}

function subtitleFor({ bill, payment }: MonthlyChecklistItem) {
  if (payment) {
    const date = new Date(payment.paid_at).toLocaleDateString();
    return `Paid ${formatMoney(payment.amount_paid)} on ${date}`;
  }
  const due = bill.due_day ? `Due on day ${bill.due_day}` : 'No due day';
  return `${due} · ${formatMoney(bill.expected_amount)}`;
}

type ReceiptListProps = {
  payment: BillPayment;
  busy: boolean;
  onAdd: () => void;
  onSelect: (receipt: PaymentReceipt) => void;
};

function ReceiptList({ payment, busy, onAdd, onSelect }: ReceiptListProps) {
  const theme = useTheme();
  return (
    <View style={styles.receipts}>
      {payment.payment_receipts.map((receipt, index) => (
        <Pressable
          key={receipt.id}
          onPress={() => onSelect(receipt)}
          style={[styles.chip, { backgroundColor: theme.backgroundSelected }]}>
          <Text style={{ color: theme.text }}>
            {receipt.mime_type === 'application/pdf' ? '📄' : '🧾'} Receipt {index + 1}
          </Text>
        </Pressable>
      ))}
      <Pressable onPress={onAdd} disabled={busy} style={[styles.chip, { borderColor: Accent, borderWidth: 1 }]}>
        <Text style={{ color: Accent }}>{busy ? 'Uploading…' : '+ Receipt'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  receipts: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, paddingLeft: 40 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999 },
});

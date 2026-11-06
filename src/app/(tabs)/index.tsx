import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MonthSwitcher } from '@/components/month-switcher';
import { Screen } from '@/components/screen';
import { Dumbbell, Mustache } from '@/components/brand';
import { Icon } from '@/components/icon';
import { Button, CheckRow, Muted } from '@/components/ui';
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
import { showDialog } from '@/components/dialog';

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
    showDialog(
      `¿Marcar "${item.bill.name}" como no pagado?`,
      payment.payment_receipts.length > 0 ? 'También se eliminarán sus comprobantes.' : undefined,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Marcar como no pagado', style: 'destructive', onPress: () => mutate(() => unmarkPaid(payment), refresh) },
      ],
    );
  };

  const upload = async (payment: BillPayment, source: ReceiptSource) => {
    setBusyPaymentId(payment.id);
    try {
      if (await addReceipt(payment, source)) await refresh();
    } catch (error) {
      showDialog('No se pudo subir el comprobante', errorMessage(error));
    } finally {
      setBusyPaymentId(null);
    }
  };

  const chooseSource = (payment: BillPayment) =>
    showDialog('Agregar comprobante', undefined, [
      { text: 'Sacar foto', onPress: () => upload(payment, 'camera') },
      { text: 'Desde la galería', onPress: () => upload(payment, 'gallery') },
      { text: 'Archivo PDF', onPress: () => upload(payment, 'pdf') },
      { text: 'Cancelar', style: 'cancel' },
    ]);

  const receiptActions = (receipt: PaymentReceipt) =>
    showDialog('Comprobante', undefined, [
      { text: 'Abrir', onPress: () => openReceipt(receipt).catch((e) => showDialog('Error', errorMessage(e))) },
      { text: 'Eliminar', style: 'destructive', onPress: () => mutate(() => deleteReceipt(receipt), refresh) },
      { text: 'Cancelar', style: 'cancel' },
    ]);

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <MonthSwitcher period={period} onChange={setPeriod} />
      <Muted>
        {paid.length} de {items.length} pagados · {formatMoney(pendingTotal)} pendiente
      </Muted>

      {items.length === 0 && !refreshing ? (
        <Muted>Aún no hay gastos fijos cargados.</Muted>
      ) : null}

      {items.length > 0 && paid.length === items.length ? <AllPaidBanner /> : null}

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

      <Button label="Gestionar gastos fijos" variant="secondary" onPress={() => router.push('/bills')} />
    </Screen>
  );
}

function subtitleFor({ bill, payment }: MonthlyChecklistItem) {
  if (payment) {
    const date = new Date(payment.paid_at).toLocaleDateString('es-AR');
    return `Pagado ${formatMoney(payment.amount_paid)} el ${date}`;
  }
  const due = bill.due_day ? `Vence el día ${bill.due_day}` : 'Sin vencimiento';
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
          style={[styles.chip, { backgroundColor: theme.accentSoft }]}>
          <Icon
            name={receipt.mime_type === 'application/pdf' ? 'file' : 'receipt'}
            color={theme.accentText}
            size={16}
          />
          <Text style={{ color: theme.accentText }}>Comprobante {index + 1}</Text>
        </Pressable>
      ))}
      <Pressable onPress={onAdd} disabled={busy} style={[styles.chip, { borderColor: theme.accent, borderWidth: 1 }]}>
        <Text style={{ color: theme.accentText }}>{busy ? 'Subiendo…' : '+ Comprobante'}</Text>
      </Pressable>
    </View>
  );
}

/** Shown when every bill of the month is paid. */
function AllPaidBanner() {
  const theme = useTheme();
  return (
    <View style={[styles.banner, { backgroundColor: theme.successSoft, borderColor: theme.success }]}>
      <View style={styles.bannerIcons}>
        <Mustache size={36} />
        <Dumbbell size={36} />
      </View>
      <Text style={[styles.bannerTitle, { color: theme.successText }]}>¡Mes pagado!</Text>
      <Text style={{ color: theme.successText }}>Todo al día. A entrenar tranquilos.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  receipts: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, paddingLeft: 40 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  banner: { borderWidth: 1, borderRadius: 14, padding: Spacing.three, alignItems: 'center', gap: Spacing.one },
  bannerIcons: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  bannerTitle: { fontSize: 18, fontWeight: '700' },
});

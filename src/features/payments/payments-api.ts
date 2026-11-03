import { supabase } from '@/lib/supabase';

export type RecurringBill = {
  id: string;
  name: string;
  expected_amount: number | null;
  due_day: number | null;
  active: boolean;
};

export type PaymentReceipt = {
  id: string;
  storage_path: string;
  mime_type: string;
  created_at: string;
};

export type BillPayment = {
  id: string;
  bill_id: string;
  period: string;
  amount_paid: number | null;
  paid_at: string;
  payment_receipts: PaymentReceipt[];
};

export type MonthlyChecklistItem = {
  bill: RecurringBill;
  payment: BillPayment | null;
};

export async function listBills(onlyActive: boolean): Promise<RecurringBill[]> {
  let query = supabase.from('recurring_bills').select('*').order('due_day', { nullsFirst: false }).order('name');
  if (onlyActive) query = query.eq('active', true);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/**
 * Builds the checklist for a month: every active bill plus its payment, if any.
 * Bills that were deactivated but paid that month still show up, so history stays complete.
 */
export async function getMonthlyChecklist(period: string): Promise<MonthlyChecklistItem[]> {
  const [bills, payments] = await Promise.all([
    listBills(false),
    supabase
      .from('bill_payments')
      .select('*, payment_receipts(*)')
      .eq('period', period)
      .then(({ data, error }) => {
        if (error) throw error;
        return data as BillPayment[];
      }),
  ]);

  const paymentByBill = new Map(payments.map((p) => [p.bill_id, p]));
  return bills
    .filter((bill) => bill.active || paymentByBill.has(bill.id))
    .map((bill) => ({ bill, payment: paymentByBill.get(bill.id) ?? null }));
}

export function markPaid(bill: RecurringBill, period: string) {
  return supabase
    .from('bill_payments')
    .insert({ bill_id: bill.id, period, amount_paid: bill.expected_amount });
}

/** Removes the payment, its receipt rows and the stored files. */
export async function unmarkPaid(payment: BillPayment) {
  const paths = payment.payment_receipts.map((r) => r.storage_path);
  if (paths.length > 0) {
    const { error } = await supabase.storage.from('receipts').remove(paths);
    if (error) return { error };
  }
  return supabase.from('bill_payments').delete().eq('id', payment.id);
}

export function createBill(input: { name: string; expected_amount: number | null; due_day: number | null }) {
  return supabase.from('recurring_bills').insert(input);
}

export function setBillActive(id: string, active: boolean) {
  return supabase.from('recurring_bills').update({ active }).eq('id', id);
}

/** Deletes the bill with its whole history, including the stored receipt files. */
export async function deleteBill(id: string) {
  const { data, error } = await supabase
    .from('payment_receipts')
    .select('storage_path, bill_payments!inner(bill_id)')
    .eq('bill_payments.bill_id', id);
  if (error) return { error };

  const paths = data.map((r) => r.storage_path);
  if (paths.length > 0) {
    const removal = await supabase.storage.from('receipts').remove(paths);
    if (removal.error) return { error: removal.error };
  }
  return supabase.from('recurring_bills').delete().eq('id', id);
}

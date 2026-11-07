import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { router } from 'expo-router';

import { pickPhoto, randomId } from '@/lib/photos';
import { supabase } from '@/lib/supabase';

import type { BillPayment, PaymentReceipt } from './payments-api';

export type ReceiptSource = 'camera' | 'gallery' | 'pdf';

type PickedFile = { uri: string; mimeType: string; extension: string };

async function pick(source: ReceiptSource): Promise<PickedFile | null> {
  if (source === 'pdf') {
    const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
    if (result.canceled) return null;
    return { uri: result.assets[0].uri, mimeType: 'application/pdf', extension: 'pdf' };
  }
  return pickPhoto(source);
}

/** Picks a file and attaches it to the payment. Returns false when the user cancels. */
export async function addReceipt(payment: BillPayment, source: ReceiptSource): Promise<boolean> {
  const file = await pick(source);
  if (!file) return false;

  const path = `${payment.period}/${payment.id}/${randomId()}.${file.extension}`;
  const bytes = await new File(file.uri).arrayBuffer();

  const upload = await supabase.storage
    .from('receipts')
    .upload(path, bytes, { contentType: file.mimeType, upsert: false });
  if (upload.error) throw upload.error;

  const { error } = await supabase
    .from('payment_receipts')
    .insert({ payment_id: payment.id, storage_path: path, mime_type: file.mimeType });
  if (error) {
    // Do not leave orphan files behind if the row could not be saved.
    await supabase.storage.from('receipts').remove([path]);
    throw error;
  }
  return true;
}

/** Private buckets the in-app viewer may open. */
export const VIEWABLE_BUCKETS = ['receipts', 'chat-images'] as const;
export type ViewableBucket = (typeof VIEWABLE_BUCKETS)[number];

/** Short-lived signed URL for a stored file (the buckets are private). */
export async function getReceiptUrl(storagePath: string, bucket: ViewableBucket = 'receipts'): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(storagePath, 120);
  if (error) throw error;
  return data.signedUrl;
}

/** Opens the in-app viewer: no external browser needed. */
export function openReceipt(receipt: PaymentReceipt) {
  router.push({ pathname: '/receipt', params: { path: receipt.storage_path, mime: receipt.mime_type } });
}

export async function deleteReceipt(receipt: PaymentReceipt) {
  const removal = await supabase.storage.from('receipts').remove([receipt.storage_path]);
  if (removal.error) return { error: removal.error };
  return supabase.from('payment_receipts').delete().eq('id', receipt.id);
}

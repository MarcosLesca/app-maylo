import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { router } from 'expo-router';

import { pickPhotos, randomId } from '@/lib/photos';
import { supabase } from '@/lib/supabase';

import type { BillPayment, PaymentReceipt } from './payments-api';

export type ReceiptSource = 'camera' | 'gallery' | 'pdf';

type PickedFile = { uri: string; mimeType: string; extension: string };

async function pick(source: ReceiptSource): Promise<PickedFile[]> {
  if (source === 'pdf') {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      copyToCacheDirectory: true,
      multiple: true,
    });
    if (result.canceled) return [];
    return result.assets.map((asset) => ({ uri: asset.uri, mimeType: 'application/pdf', extension: 'pdf' }));
  }
  return pickPhotos(source, true);
}

/**
 * Picks one or more files (several photos from the gallery or several PDFs) and
 * attaches them to the payment, one by one. Returns how many were uploaded (0 when cancelled).
 * If one fails, the ones already uploaded stay and the error says how many made it.
 */
export async function addReceipts(payment: BillPayment, source: ReceiptSource): Promise<number> {
  const files = await pick(source);
  for (let i = 0; i < files.length; i++) {
    try {
      await uploadReceipt(payment, files[i]);
    } catch (error) {
      if (i === 0) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Se subieron ${i} de ${files.length} comprobantes. ${reason}`);
    }
  }
  return files.length;
}

async function uploadReceipt(payment: BillPayment, file: PickedFile) {
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

import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as WebBrowser from 'expo-web-browser';

import { supabase } from '@/lib/supabase';

import type { BillPayment, PaymentReceipt } from './payments-api';

export type ReceiptSource = 'camera' | 'gallery' | 'pdf';

type PickedFile = { uri: string; mimeType: string; extension: string };

const MAX_IMAGE_WIDTH = 1600;
const JPEG_QUALITY = 0.6;

/** Shrinks photos to ~200 KB so 1 GB of free storage lasts for years. */
async function compressImage(uri: string): Promise<PickedFile> {
  const context = ImageManipulator.manipulate(uri);
  context.resize({ width: MAX_IMAGE_WIDTH, height: null });
  const image = await context.renderAsync();
  const result = await image.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });
  return { uri: result.uri, mimeType: 'image/jpeg', extension: 'jpg' };
}

async function pick(source: ReceiptSource): Promise<PickedFile | null> {
  if (source === 'pdf') {
    const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
    if (result.canceled) return null;
    return { uri: result.assets[0].uri, mimeType: 'application/pdf', extension: 'pdf' };
  }

  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new Error('Se denegó el permiso de cámara.');
  }

  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled) return null;
  return compressImage(result.assets[0].uri);
}

function randomId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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

/** Opens the receipt through a short-lived signed URL (the bucket is private). */
export async function openReceipt(receipt: PaymentReceipt) {
  const { data, error } = await supabase.storage.from('receipts').createSignedUrl(receipt.storage_path, 60);
  if (error) throw error;
  await WebBrowser.openBrowserAsync(data.signedUrl);
}

export async function deleteReceipt(receipt: PaymentReceipt) {
  const removal = await supabase.storage.from('receipts').remove([receipt.storage_path]);
  if (removal.error) return { error: removal.error };
  return supabase.from('payment_receipts').delete().eq('id', receipt.id);
}

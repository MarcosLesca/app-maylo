import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';

import TvCast from '../../../../modules/tv-cast';
import { buildReceiverPage } from './receiver-page';
import {
  generateKey,
  isReceiverKey,
  parseReceiverReport,
  serializeCommand,
  type ReceiverCommand,
  type ReceiverReport,
} from './receiver-state';

export type { ReceiverCommand, ReceiverPlayback, ReceiverReport } from './receiver-state';

/** Shown when the installed APK predates the receiver (an OTA update can reach it). */
export const RECEIVER_OLD_APP = 'Esta versión de la app no tiene el receptor; actualizala';

const KEY_STORAGE = 'maylo.tvReceiver.key';

/** True when the native side has every receiver call. */
export const receiverSupported =
  TvCast?.startReceiverAsync != null &&
  TvCast.pushReceiverCommandAsync != null &&
  TvCast.getReceiverStateAsync != null &&
  TvCast.stopReceiverAsync != null;

let keyPromise: Promise<string> | null = null;

/** The 6-character key, generated once and kept so the TV can save the address as a favorite. */
export function receiverKey(): Promise<string> {
  keyPromise ??= (async () => {
    const stored = await AsyncStorage.getItem(KEY_STORAGE).catch(() => null);
    if (isReceiverKey(stored)) return stored;
    const random =
      typeof globalThis.crypto?.getRandomValues === 'function'
        ? () => globalThis.crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32
        : Math.random;
    const key = generateKey(random);
    await AsyncStorage.setItem(KEY_STORAGE, key).catch(() => undefined);
    return key;
  })();
  return keyPromise;
}

export type ReceiverAddress = { url: string; port: number; address: string };

/** Starts (or keeps) the phone server and serves the receiver page; idempotent. */
export async function startReceiver(): Promise<ReceiverAddress> {
  if (!TvCast?.startReceiverAsync) throw new Error(RECEIVER_OLD_APP);
  const key = await receiverKey();
  const html = buildReceiverPage({ key, phoneName: Device.deviceName ?? Device.modelName ?? '' });
  return TvCast.startReceiverAsync(key, html);
}

/** Queues one command for the TV page (delivered in order, at most once). */
export async function sendCommand(command: ReceiverCommand): Promise<void> {
  if (!TvCast?.pushReceiverCommandAsync) throw new Error(RECEIVER_OLD_APP);
  await TvCast.pushReceiverCommandAsync(serializeCommand(command));
}

/** Whether a TV page is connected (state within 5 s), its IP and what it is playing. */
export async function readState(): Promise<ReceiverReport> {
  if (!TvCast?.getReceiverStateAsync) throw new Error(RECEIVER_OLD_APP);
  return parseReceiverReport(await TvCast.getReceiverStateAsync());
}

/** Stops the receiver; a no-op on old APKs. */
export async function stopReceiver(): Promise<void> {
  await TvCast?.stopReceiverAsync?.();
}

/*
 * Lifetime (S1): the receiver runs while the cast browser or the connect screen
 * is mounted. Each screen holds it with useReceiverHold(); it starts on the first
 * hold and stops when the last one is released. Start/stop calls are chained so a
 * quick release + hold (navigating between both screens) ends started.
 */
let holders = 0;
let chain: Promise<unknown> = Promise.resolve();

/** Starts the receiver for one holder; the promise rejects with RECEIVER_OLD_APP on old APKs. */
export function holdReceiver(): { address: Promise<ReceiverAddress>; release: () => void } {
  holders += 1;
  let released = false;
  const address = chain.then(() => startReceiver());
  chain = address.catch(() => undefined);
  return {
    address,
    release: () => {
      if (released) return;
      released = true;
      holders -= 1;
      chain = chain.then(() => (holders === 0 ? stopReceiver().catch(() => undefined) : undefined));
    },
  };
}

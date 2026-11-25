import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';

import TvCast from '../../../../modules/tv-cast';
import { getAnniversaryDate } from '@/features/settings/couple-settings-api';

import { clearHubTarget, setHubTarget } from './hub-client';
import { buildReceiverPage } from './receiver-page';
import { listReceivers, publishReceiver } from './receivers-api';
import {
  isMissingTableError,
  pagePeers,
  phoneLabel,
  samePeers,
  sharedReceivers,
  type PagePeer,
  type SharedReceiver,
  type SharedStatus,
} from './receivers';
import {
  generateKey,
  isReceiverKey,
  parseReceiverReport,
  serializeCommand,
  type ReceiverCommand,
  type ReceiverReport,
} from './receiver-state';

export type { ReceiverCommand, ReceiverPlayback, ReceiverReport } from './receiver-state';
export type { SharedReceiver, SharedStatus } from './receivers';

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

/*
 * Shared receivers (cast_receivers): the signed-in member, the other phones the
 * page also polls, and what the connect screen shows. Module state, because the
 * receiver itself is shared by every screen that holds it.
 */
let identity: { userId: string | null; name: string } = { userId: null, name: '' };
let peers: PagePeer[] = [];
/** Label of this phone in the page last served. */
let servedLabel = '';
/** Shared anniversary date (couple_settings) for the ambient countdown, and the one last served. */
let anniversary: string | null = null;
let servedAnniversary: string | null = null;

/** What the connect screen shows about the shared list. */
export type SharedSnapshot = { status: SharedStatus; receivers: SharedReceiver[] };

let shared: SharedSnapshot = { status: 'loading', receivers: [] };
const sharedListeners = new Set<() => void>();

export function getSharedReceivers(): SharedSnapshot {
  return shared;
}

export function subscribeSharedReceivers(listener: () => void): () => void {
  sharedListeners.add(listener);
  return () => {
    sharedListeners.delete(listener);
  };
}

function setShared(next: SharedSnapshot) {
  shared = next;
  for (const listener of sharedListeners) listener();
}

/** The signed-in member: their row in cast_receivers and the page's "MayLo de <nombre>". */
/** This phone's receiver URL while held, as registered in the ESP32 hub. */
let heldUrl: string | null = null;

export function setReceiverIdentity(next: { userId: string | null; name: string }): void {
  identity = next;
  if (holders > 0 && heldUrl) setHubTarget(heldUrl, ownName());
}

const ownName = () => identity.name.trim() || Device.deviceName || Device.modelName || '';

/** Starts (or keeps) the phone server and serves the receiver page; idempotent. */
export async function startReceiver(): Promise<ReceiverAddress> {
  if (!TvCast?.startReceiverAsync) throw new Error(RECEIVER_OLD_APP);
  const key = await receiverKey();
  const label = phoneLabel(ownName());
  const date = anniversary;
  const html = buildReceiverPage({ key, phoneName: label, peers, anniversary: date });
  servedLabel = label;
  servedAnniversary = date;
  const address = await TvCast.startReceiverAsync(key, html);
  // Register in the ESP32 hub while held (right after start and whenever the URL changes).
  if (holders > 0) {
    heldUrl = address.url;
    setHubTarget(address.url, ownName());
  }
  return address;
}

let syncChain: Promise<unknown> = Promise.resolve();
let lastSync: { url: string; name: string; at: number } | null = null;

/** A repeated sync for the same address within this time is skipped (several screens mount at once). */
const SYNC_DEDUPE_MS = 5000;

/**
 * Publishes this phone's address (receiver start, address change, app focus),
 * reads both members' rows and, when the other phones changed, serves the
 * page again with them. Without the table (migration not run) or the network
 * the receiver keeps working with this phone only. Never rejects.
 */
export function syncSharedReceivers(address: ReceiverAddress, force = false): Promise<void> {
  const run = syncChain.then(() => syncNow(address, force));
  syncChain = run.catch(() => undefined);
  return run.catch(() => undefined);
}

async function syncNow(address: ReceiverAddress, force: boolean): Promise<void> {
  const userId = identity.userId;
  const name = identity.name.trim();
  if (!userId) return;
  const now = Date.now();
  if (!force && lastSync && lastSync.url === address.url && lastSync.name === name && now - lastSync.at < SYNC_DEDUPE_MS) {
    return;
  }
  lastSync = { url: address.url, name, at: now };
  const own = { userId, url: address.url, name: ownName() };
  let status: SharedStatus = 'ready';
  let rows: Awaited<ReturnType<typeof listReceivers>> = [];
  try {
    await publishReceiver(userId, address.url, name);
    rows = await listReceivers();
  } catch (cause) {
    status = isMissingTableError(cause) ? 'missing' : 'error';
    lastSync = null;
  }
  const list = sharedReceivers(rows, own);
  // A transient failure keeps the phones already known; a missing table means none.
  const nextPeers = status === 'ready' ? pagePeers(list) : status === 'missing' ? [] : peers;
  setShared({
    status,
    receivers: status === 'error' ? [...list, ...shared.receivers.filter((receiver) => !receiver.isOwn)] : list,
  });
  if (samePeers(peers, nextPeers) && servedLabel === phoneLabel(ownName())) return;
  peers = nextPeers;
  // Serve the page again with the new list (a TV that opens or reloads it gets it), only while held.
  chain = chain.then(() => (holders > 0 ? startReceiver().catch(() => undefined) : undefined));
  await chain;
}

/**
 * Sets the anniversary date the page counts down to and, when it differs from
 * the page served, serves it again while held (a TV that opens or reloads the page gets it).
 */
export function setReceiverAnniversary(date: string | null): Promise<void> {
  anniversary = date;
  if (date === servedAnniversary) return Promise.resolve();
  chain = chain.then(() => (holders > 0 && anniversary !== servedAnniversary ? startReceiver().catch(() => undefined) : undefined));
  return chain.then(() => undefined);
}

/** Reads the shared anniversary date; without the table (0017 not run) or network the page keeps the last one. Never rejects. */
export async function refreshReceiverAnniversary(): Promise<void> {
  let date: string | null;
  try {
    date = await getAnniversaryDate();
  } catch {
    return;
  }
  await setReceiverAnniversary(date);
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
      chain = chain.then(() => {
        if (holders !== 0) return undefined;
        heldUrl = null;
        clearHubTarget();
        return stopReceiver().catch(() => undefined);
      });
    },
  };
}

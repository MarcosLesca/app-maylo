import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from '@/lib/supabase';

import {
  DEFAULT_HUB_ADDRESS,
  HUB_REGISTER_MS,
  HUB_TIMEOUT_MS,
  hubMemberNames,
  hubRegisterBody,
  parseHubAddress,
  parseHubPhones,
  type HubProbe,
  type HubRegistration,
} from './hub';

/*
 * The ESP32 TV hub (odd/tasks/esp32-tv-hub.md S4) on the app side.
 *
 * Storage choice: the hub address lives in AsyncStorage on each phone, not in
 * Supabase. It is a property of the home Wi-Fi (an mDNS name or a reserved
 * IP), works without a session or migration, and the default
 * (http://maylo-tv.local) already fits both phones; a member who changes it
 * changes it on their phone only.
 *
 * Registration: while the receiver is held, this phone POSTs its receiver URL
 * to <hub>/register right after start, every 60 s and whenever the URL, the
 * member name or the hub address changes; it stops on release. Failures are
 * silent; the last result is kept for the connect screen.
 *
 * Members (S6): every registration also sends all app members' display names
 * (app_members, oldest member first so both phones send the same order and
 * the hub writes its flash only on real changes). They are read once per app
 * session; a failed or empty read (no session yet) is retried on the next
 * registration, which meanwhile goes out with the names already known.
 */

const HUB_STORAGE = 'maylo.tvHub.address';

let hubAddress = DEFAULT_HUB_ADDRESS;
let loaded: Promise<string> | null = null;
let target: { url: string; name: string } | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let last: HubRegistration | null = null;
/** Bumped on every target change, so a late answer for an old target is not shown. */
let generation = 0;
const listeners = new Set<() => void>();
let members: string[] = [];
let membersLoad: Promise<string[]> | null = null;

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeHub(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Current hub origin (the default until the saved one is read). */
export function getHubAddress(): string {
  return hubAddress;
}

/** Last POST /register result, or null before the first one. */
export function getHubRegistration(): HubRegistration | null {
  return last;
}

/** Reads the saved address once; a missing or invalid one keeps the default. */
export function loadHubAddress(): Promise<string> {
  loaded ??= AsyncStorage.getItem(HUB_STORAGE)
    .catch(() => null)
    .then((stored) => {
      const parsed = stored == null ? null : parseHubAddress(stored);
      // setHubTarget registers once this resolves, so no registration here.
      if (parsed && parsed !== hubAddress) {
        hubAddress = parsed;
        emit();
      }
      return hubAddress;
    });
  return loaded;
}

/** Saves a valid address and registers there at once; false (nothing saved) when invalid. */
export async function saveHubAddress(input: string): Promise<boolean> {
  const parsed = parseHubAddress(input);
  if (!parsed) return false;
  await loadHubAddress();
  await AsyncStorage.setItem(HUB_STORAGE, parsed).catch(() => undefined);
  if (parsed !== hubAddress) {
    hubAddress = parsed;
    last = null;
    emit();
    registerNow();
  }
  return true;
}

async function request(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const abort = setTimeout(() => controller.abort(), HUB_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' });
  } finally {
    clearTimeout(abort);
  }
}

/** The "Probar" button: GET <hub>/phones within 3 s. */
export async function probeHub(hub: string): Promise<HubProbe> {
  try {
    const response = await request(`${hub}/phones`, { method: 'GET' });
    if (!response.ok) return { ok: false };
    const phones = parseHubPhones(await response.text());
    return phones == null ? { ok: false } : { ok: true, phones };
  } catch {
    return { ok: false };
  }
}

/** All members' display names, read once per session (kept after the first non-empty answer). */
function loadMembers(): Promise<string[]> {
  membersLoad ??= (async () => {
    const { data, error } = await supabase
      .from('app_members')
      .select('display_name')
      .order('created_at', { ascending: true })
      .order('user_id', { ascending: true });
    if (error) throw error;
    return hubMemberNames((data ?? []).map((row: { display_name: unknown }) => row.display_name));
  })().then(
    (list) => {
      if (list.length) members = list;
      else membersLoad = null;
      return members;
    },
    () => {
      membersLoad = null;
      return members;
    },
  );
  return membersLoad;
}

/** The member names for the next registration, waiting at most the hub timeout for the first read. */
function currentMembers(): Promise<string[]> {
  let wait: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<string[]>((resolve) => {
    wait = setTimeout(() => resolve(members), HUB_TIMEOUT_MS);
  });
  return Promise.race([loadMembers(), timeout]).finally(() => clearTimeout(wait));
}

function registerNow() {
  if (!target) return;
  const mine = generation;
  const { url, name } = target;
  const done = (hub: string, ok: boolean) => {
    if (mine !== generation || hub !== hubAddress) return;
    last = { ok, at: Date.now() };
    emit();
  };
  currentMembers().then((names) => {
    if (mine !== generation) return;
    const hub = hubAddress;
    const body = hubRegisterBody(url, name, names);
    if (!body) {
      done(hub, false);
      return;
    }
    // text/plain keeps it a simple request (no CORS preflight); the hub reads the body either way.
    request(`${hub}/register`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body }).then(
      (response) => done(hub, response.ok),
      () => done(hub, false),
    );
  });
}

/** Registers `url` (this phone's receiver) under `name`; starts the 60 s loop, re-registers on change. */
export function setHubTarget(url: string, name: string): void {
  if (target && target.url === url && target.name === name && timer) return;
  target = { url, name };
  generation += 1;
  if (timer) clearInterval(timer);
  timer = setInterval(registerNow, HUB_REGISTER_MS);
  loadHubAddress().then(registerNow);
}

/** Receiver released: no more registrations. */
export function clearHubTarget(): void {
  target = null;
  generation += 1;
  if (timer) clearInterval(timer);
  timer = null;
}

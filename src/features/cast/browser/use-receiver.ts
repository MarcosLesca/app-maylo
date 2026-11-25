import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/features/auth/auth-provider';

import { getHubAddress, getHubRegistration, loadHubAddress, subscribeHub } from '../receiver/hub-client';

import {
  getSharedReceivers,
  holdReceiver,
  readState,
  receiverSupported,
  refreshReceiverAnniversary,
  setReceiverIdentity,
  startReceiver,
  subscribeSharedReceivers,
  syncSharedReceivers,
  type ReceiverAddress,
  type ReceiverReport,
  type SharedReceiver,
} from '../receiver/receiver-client';

const POLL_MS = 1000;

/** How often the connect screen checks whether the other phone's receiver answers. */
const PEER_CHECK_MS = 10_000;
const PEER_TIMEOUT_MS = 3000;

/**
 * Keeps the TV browser receiver running while the calling screen is mounted
 * (the cast browser and the connect screen both hold it; it stops when neither
 * does). `address` is where the TV opens the page; `error` the start failure;
 * `shared` the receivers of both members (cast_receivers), published and read
 * when the receiver starts, when its address changes and when the app comes back.
 * The shared anniversary date (ambient countdown) is read on mount and when the app comes back.
 */
export function useReceiverHold() {
  const { session, member } = useAuth();
  const userId = session?.user.id ?? null;
  const name = member?.displayName ?? '';
  const [address, setAddress] = useState<ReceiverAddress | null>(null);
  const [error, setError] = useState<unknown>(null);
  const shared = useSyncExternalStore(subscribeSharedReceivers, getSharedReceivers);
  const addressRef = useRef<ReceiverAddress | null>(null);

  useEffect(() => {
    addressRef.current = address;
  }, [address]);

  // Declared before the hold so the first page already carries the member's name.
  useEffect(() => {
    setReceiverIdentity({ userId, name });
  }, [userId, name]);

  useEffect(() => {
    let active = true;
    // The ambient countdown's date; the page is served again if it differs.
    refreshReceiverAnniversary();
    const hold = holdReceiver();
    hold.address.then(
      (value) => active && setAddress(value),
      (cause: unknown) => active && setError(cause),
    );
    return () => {
      active = false;
      hold.release();
    };
  }, []);

  /** startReceiverAsync again: it rebinds to the current Wi-Fi address when it changed. */
  const refresh = useCallback(async () => {
    try {
      const value = await startReceiver();
      setAddress((current) => (current?.url === value.url ? current : value));
      setError(null);
      return value;
    } catch (cause) {
      setError(cause);
      return null;
    }
  }, []);

  // Publish on start, on a new address and when the member is known.
  // (address keeps its identity while the URL is the same, see refresh.)
  useEffect(() => {
    if (address) syncSharedReceivers(address);
  }, [address, userId, name]);

  // Back in the app: the Wi-Fi address may have changed meanwhile; publish again.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || addressRef.current == null) return;
      // The other member may have changed the anniversary date meanwhile.
      refreshReceiverAnniversary();
      refresh().then((value) => {
        if (value) syncSharedReceivers(value, true);
      });
    });
    return () => subscription.remove();
  }, [refresh]);

  return { address, error, refresh, shared };
}

/** getReceiverStateAsync every second while `active`; null until known or on old APKs. */
export function useReceiverStatus(active: boolean): ReceiverReport | null {
  const [report, setReport] = useState<ReceiverReport | null>(null);

  useEffect(() => {
    if (!active || !receiverSupported) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const next = await readState();
        if (alive) setReport(next);
      } catch {
        if (alive) setReport(null);
      }
      if (alive) timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [active]);

  return report;
}

/**
 * The ESP32 hub as the connect screen shows it: the saved address, the last
 * registration of this phone there and a clock ticking every second for its age.
 */
export function useHubStatus() {
  const hub = useSyncExternalStore(subscribeHub, getHubAddress);
  const registration = useSyncExternalStore(subscribeHub, getHubRegistration);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    loadHubAddress();
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  return { hub, registration, now };
}

/** True when `url` (another phone's receiver page) answers from this phone. */
async function answers(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PEER_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: 'HEAD', signal: controller.signal, cache: 'no-store' });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whether each other phone's receiver answers from this phone, by URL (null
 * while checking); rechecked every 10 s while mounted.
 */
export function usePeerReachability(receivers: readonly SharedReceiver[]): Record<string, boolean | null> {
  const urls = receivers
    .filter((receiver) => !receiver.isOwn)
    .map((receiver) => receiver.url)
    .join('\n');
  const [reachable, setReachable] = useState<Record<string, boolean | null>>({});

  useEffect(() => {
    const list = urls ? urls.split('\n') : [];
    if (list.length === 0) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      const results = await Promise.all(list.map(answers));
      if (!alive) return;
      setReachable(Object.fromEntries(list.map((url, index) => [url, results[index]])));
      timer = setTimeout(check, PEER_CHECK_MS);
    };
    check();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [urls]);

  return reachable;
}

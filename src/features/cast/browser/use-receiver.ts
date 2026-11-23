import { useCallback, useEffect, useState } from 'react';

import {
  holdReceiver,
  readState,
  receiverSupported,
  startReceiver,
  type ReceiverAddress,
  type ReceiverReport,
} from '../receiver/receiver-client';

const POLL_MS = 1000;

/**
 * Keeps the TV browser receiver running while the calling screen is mounted
 * (the cast browser and the connect screen both hold it; it stops when neither
 * does). `address` is where the TV opens the page; `error` the start failure.
 */
export function useReceiverHold() {
  const [address, setAddress] = useState<ReceiverAddress | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let active = true;
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
    } catch (cause) {
      setError(cause);
    }
  }, []);

  return { address, error, refresh };
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

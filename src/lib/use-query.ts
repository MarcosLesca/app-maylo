import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

/**
 * Minimal data loader keyed by `key` (e.g. the selected month).
 * Loads when the screen gains focus and whenever the key changes,
 * and exposes `refresh` for pull-to-refresh and after mutations.
 */
export function useQuery<K, T>(key: K, load: (key: K) => Promise<T>, initial: T) {
  const [data, setData] = useState<T>(initial);
  const [refreshing, setRefreshing] = useState(false);
  const requestId = useRef(0);
  const loadRef = useRef(load);

  useEffect(() => {
    loadRef.current = load;
  });

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    setRefreshing(true);
    try {
      const result = await loadRef.current(key);
      // Ignore stale responses (e.g. when switching months quickly).
      if (id === requestId.current) setData(result);
    } catch (error) {
      if (id === requestId.current) Alert.alert('No se pudieron cargar los datos', errorMessage(error));
    } finally {
      if (id === requestId.current) setRefreshing(false);
    }
  }, [key]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  return { data, refreshing, refresh };
}

export function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}

/** Runs a mutation, shows an alert on failure, then refreshes. */
export async function mutate(
  action: () => PromiseLike<{ error: unknown } | void | undefined>,
  refresh?: () => unknown,
) {
  try {
    const result = await action();
    if (result && result.error) throw result.error;
  } catch (error) {
    Alert.alert('Algo salió mal', errorMessage(error));
  } finally {
    await refresh?.();
  }
}

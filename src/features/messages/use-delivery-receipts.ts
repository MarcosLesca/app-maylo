import { useEffect } from 'react';
import { AppState } from 'react-native';

import { supabase } from '@/lib/supabase';

function markDelivered() {
  // Best effort: a failed stamp just means the sender keeps seeing one tick a bit longer.
  supabase.rpc('mark_messages_delivered').then(
    () => undefined,
    () => undefined,
  );
}

/**
 * While the app is open (any tab), tell the server that messages from the
 * other member reached this phone: on start, when coming back to the
 * foreground, and whenever a new message arrives live.
 */
export function useDeliveryReceipts(userId: string | undefined) {
  useEffect(() => {
    if (!userId) return;

    markDelivered();

    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') markDelivered();
    });

    const channel = supabase
      .channel('delivery-receipts')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        if ((payload.new as { sender_id: string }).sender_id !== userId) markDelivered();
      })
      .subscribe();

    return () => {
      appState.remove();
      supabase.removeChannel(channel);
    };
  }, [userId]);
}

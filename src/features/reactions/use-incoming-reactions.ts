import { useCallback, useEffect, useRef, useState } from 'react';

import { supabase } from '@/lib/supabase';

import { isFromOtherMember, parseReactionRow, type Reaction } from './rules';

/** How long each reaction stays on screen. */
export const REACTION_VISIBLE_MS = 4000;
/** Bursts beyond this drop the oldest so the screen never fills up. */
const MAX_VISIBLE = 6;

/**
 * Live reactions from the OTHER member (never my own), each kept for ~4 s.
 * Subscribes to Realtime inserts on public.reactions while signed in.
 */
export function useIncomingReactions(myId: string | undefined) {
  const [visible, setVisible] = useState<Reaction[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setVisible((prev) => prev.filter((r) => r.id !== id));
  }, []);

  useEffect(() => {
    if (!myId) return;
    const pending = timers.current;
    const channel = supabase
      .channel('reactions-overlay')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reactions' }, (payload) => {
        const reaction = parseReactionRow(payload.new);
        if (!reaction || !isFromOtherMember(reaction, myId) || pending.has(reaction.id)) return;
        pending.set(
          reaction.id,
          setTimeout(() => dismiss(reaction.id), REACTION_VISIBLE_MS),
        );
        setVisible((prev) => [...prev, reaction].slice(-MAX_VISIBLE));
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
      pending.forEach(clearTimeout);
      pending.clear();
      setVisible([]);
    };
  }, [myId, dismiss]);

  return visible;
}

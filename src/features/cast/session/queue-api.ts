import { useSyncExternalStore } from 'react';

import { supabase } from '@/lib/supabase';

import { claimedItem, oldestQueueItem, type QueueInsert } from './queue-rules';

/** One video waiting for the TV (cast_queue, shared by both members, S1). */
export type QueueItem = {
  id: string;
  created_by: string;
  video_url: string;
  referer: string;
  user_agent: string | null;
  cookie: string | null;
  page_url: string;
  title: string;
  created_at: string;
};

/** The queue oldest first, and member names by user id (for "Lo agregó …"). */
export type QueueSnapshot = { items: QueueItem[]; names: Record<string, string> };

const COLUMNS = 'id, created_by, video_url, referer, user_agent, cookie, page_url, title, created_at';

let snapshot: QueueSnapshot = { items: [], names: {} };
const listeners = new Set<() => void>();
let channel: ReturnType<typeof supabase.channel> | null = null;
let namesLoaded = false;

function publish(next: QueueSnapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

const sorted = (items: QueueItem[]) =>
  [...items].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1));

async function loadNames(): Promise<Record<string, string>> {
  if (namesLoaded) return snapshot.names;
  const { data, error } = await supabase.from('app_members').select('user_id, display_name');
  if (error || !data) return snapshot.names;
  namesLoaded = true;
  return Object.fromEntries((data as { user_id: string; display_name: string }[]).map((row) => [row.user_id, row.display_name]));
}

/** Reads the queue again (oldest first) and tells every subscriber. */
export async function refreshQueue(): Promise<QueueItem[]> {
  const [{ data, error }, names] = await Promise.all([
    supabase.from('cast_queue').select(COLUMNS).order('created_at', { ascending: true }),
    loadNames().catch(() => snapshot.names),
  ]);
  if (error) throw error;
  const items = sorted((data ?? []) as QueueItem[]);
  publish({ items, names });
  return items;
}

/** Live queue while someone listens: realtime changes re-read the list. */
export function subscribeQueue(listener: () => void): () => void {
  listeners.add(listener);
  if (!channel) {
    refreshQueue().catch(() => undefined);
    channel = supabase
      .channel('cast-queue')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cast_queue' }, () => {
        refreshQueue().catch(() => undefined);
      })
      .subscribe();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && channel) {
      supabase.removeChannel(channel);
      channel = null;
    }
  };
}

export const getQueue = () => snapshot;

/** The shared queue for a screen (live while mounted). */
export function useCastQueue(): QueueSnapshot {
  return useSyncExternalStore(subscribeQueue, getQueue);
}

export async function addToQueue(row: QueueInsert): Promise<void> {
  const { error } = await supabase.from('cast_queue').insert(row);
  if (error) throw error;
  await refreshQueue().catch(() => undefined);
}

export async function removeFromQueue(id: string): Promise<void> {
  const { error } = await supabase.from('cast_queue').delete().eq('id', id);
  if (error) throw error;
  publish({ ...snapshot, items: snapshot.items.filter((item) => item.id !== id) });
}

/**
 * Claims the oldest item by deleting it (D2): only the phone whose delete returns
 * the row casts it. Null when the queue is empty or the other phone won.
 */
export async function claimNextQueued(): Promise<QueueItem | null> {
  const next = oldestQueueItem(await refreshQueue());
  if (!next) return null;
  const { data, error } = await supabase.from('cast_queue').delete().eq('id', next.id).select(COLUMNS);
  if (error) throw error;
  publish({ ...snapshot, items: snapshot.items.filter((item) => item.id !== next.id) });
  return claimedItem(next.id, data as QueueItem[] | null);
}

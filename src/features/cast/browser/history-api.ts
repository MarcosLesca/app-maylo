import { supabase } from '@/lib/supabase';

import { historyKey, recentHistory, type HistoryEntry, type HistoryRow } from './history';

/** "Lo último que vimos" (browser_history, shared by both members, S6/D5). */

/** The 8 most recent pages, newest first, each once. */
export async function listHistory(): Promise<HistoryRow[]> {
  const { data, error } = await supabase
    .from('browser_history')
    .select('id, url, title, last_watched_at')
    .order('last_watched_at', { ascending: false })
    .limit(40);
  if (error) throw error;
  return recentHistory((data ?? []) as HistoryRow[]);
}

/** Upserted each time a video is cast (top page URL + page title). */
export async function recordHistory(entry: HistoryEntry): Promise<void> {
  const { error } = await supabase
    .from('browser_history')
    .upsert({ ...entry, last_watched_at: new Date().toISOString() }, { onConflict: 'url' });
  if (error) throw error;
}

/** Removes every row of this page (the same page may be stored with and without www). */
export async function removeHistory(saved: HistoryRow[], url: string): Promise<void> {
  const key = historyKey(url);
  const ids = saved.filter((row) => historyKey(row.url) === key).map((row) => row.id);
  if (ids.length === 0) return;
  const { error } = await supabase.from('browser_history').delete().in('id', ids);
  if (error) throw error;
}

import { supabase } from '@/lib/supabase';

import type { SavedProgress } from './progress-rules';

/** Saved positions (watch_progress, shared, S2/D3); keys come from progressKey(). */

export async function getProgress(key: string): Promise<SavedProgress | null> {
  const { data, error } = await supabase
    .from('watch_progress')
    .select('position_s, duration_s')
    .eq('key', key)
    .maybeSingle();
  if (error) throw error;
  return (data as SavedProgress | null) ?? null;
}

export async function saveProgress(input: {
  key: string;
  pageUrl: string;
  title: string;
  position: number;
  duration: number | null;
}): Promise<void> {
  const { error } = await supabase.from('watch_progress').upsert(
    {
      key: input.key,
      page_url: input.pageUrl,
      title: input.title.slice(0, 200),
      position_s: Math.max(0, Math.floor(input.position)),
      duration_s: input.duration != null && input.duration > 0 ? input.duration : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' },
  );
  if (error) throw error;
}

export async function deleteProgress(key: string): Promise<void> {
  const { error } = await supabase.from('watch_progress').delete().eq('key', key);
  if (error) throw error;
}

import { supabase } from '@/lib/supabase';

/**
 * Shared couple settings (migration 0017, table couple_settings): a single row
 * for both members (RLS: public.is_member()).
 */

/** PostgREST / Postgres codes for a table that does not exist yet (migration not run). */
const MISSING_TABLE = new Set(['PGRST205', '42P01']);

/**
 * The anniversary date (YYYY-MM-DD) the TV counts down to every year; null when
 * not set or before migration 0017 runs (so screens do not show a load error).
 */
export async function getAnniversaryDate(): Promise<string | null> {
  const { data, error } = await supabase
    .from('couple_settings')
    .select('anniversary_date')
    .eq('id', true)
    .maybeSingle();
  if (error && MISSING_TABLE.has(String(error.code))) return null;
  if (error) throw error;
  return (data?.anniversary_date as string | null | undefined) ?? null;
}

/** Saves (or clears with null) the shared anniversary date. */
export async function saveAnniversaryDate(date: string | null): Promise<void> {
  const { error } = await supabase
    .from('couple_settings')
    .upsert({ id: true, anniversary_date: date, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  if (error) throw error;
}

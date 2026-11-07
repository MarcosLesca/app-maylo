import { supabase } from '@/lib/supabase';

import type { AfterWeek4, DayType, WeightPoint } from './plan';

export type RecompSettings = { start_date: string; after_week4: AfterWeek4 | null };
export type RecompDay = { day: string; day_type: DayType; completed: boolean };

// Every query is limited to the signed-in user by RLS; user_id defaults to auth.uid().

export async function getSettings(): Promise<RecompSettings | null> {
  const { data, error } = await supabase.from('recomp_settings').select('start_date, after_week4').maybeSingle();
  if (error) throw error;
  return data;
}

export function saveStartDate(userId: string, startDate: string) {
  return supabase
    .from('recomp_settings')
    .upsert({ user_id: userId, start_date: startDate, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
}

export function saveAfterWeek4(userId: string, choice: AfterWeek4 | null) {
  return supabase
    .from('recomp_settings')
    .update({ after_week4: choice, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
}

/** Day logs from `from` (inclusive) onwards: enough for today and this week's count. */
export async function listDays(from: string): Promise<RecompDay[]> {
  const { data, error } = await supabase
    .from('recomp_days')
    .select('day, day_type, completed')
    .gte('day', from)
    .order('day');
  if (error) throw error;
  return data as RecompDay[];
}

export function saveDay(userId: string, day: RecompDay) {
  return supabase.from('recomp_days').upsert({ user_id: userId, ...day }, { onConflict: 'user_id,day' });
}

export async function listWeights(): Promise<WeightPoint[]> {
  const { data, error } = await supabase.from('recomp_weights').select('day, weight_kg').order('day');
  if (error) throw error;
  return data.map((row) => ({ day: row.day as string, kg: Number(row.weight_kg) }));
}

export function saveWeight(userId: string, day: string, kg: number) {
  return supabase.from('recomp_weights').upsert({ user_id: userId, day, weight_kg: kg }, { onConflict: 'user_id,day' });
}

export function deleteWeight(userId: string, day: string) {
  return supabase.from('recomp_weights').delete().eq('user_id', userId).eq('day', day);
}

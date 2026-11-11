import { supabase } from '@/lib/supabase';

import type { DayType } from './notebook';

export type BulkFood = { id: string; day_type: DayType; name: string; grams: number | null };
export type BulkTotals = { day_type: DayType; kcal: number | null; protein_g: number | null; fat_g: number | null };
export type TotalField = 'kcal' | 'protein_g' | 'fat_g';

// Every query is limited to the signed-in user by RLS; user_id defaults to auth.uid().

const toNumber = (value: unknown) => (value == null ? null : Number(value));

export async function listFoods(): Promise<BulkFood[]> {
  const { data, error } = await supabase.from('bulk_foods').select('id, day_type, name, grams').order('created_at');
  if (error) throw error;
  return data.map((row) => ({ ...row, grams: toNumber(row.grams) }) as BulkFood);
}

export function addFood(dayType: DayType, name: string, grams: number | null) {
  return supabase.from('bulk_foods').insert({ day_type: dayType, name, grams });
}

export function updateFood(id: string, changes: { name?: string; grams?: number | null }) {
  return supabase.from('bulk_foods').update(changes).eq('id', id);
}

export function deleteFood(id: string) {
  return supabase.from('bulk_foods').delete().eq('id', id);
}

export async function listTotals(): Promise<BulkTotals[]> {
  const { data, error } = await supabase.from('bulk_day_totals').select('day_type, kcal, protein_g, fat_g');
  if (error) throw error;
  return data.map((row) => ({
    day_type: row.day_type as DayType,
    kcal: toNumber(row.kcal),
    protein_g: toNumber(row.protein_g),
    fat_g: toNumber(row.fat_g),
  }));
}

export function saveTotal(userId: string, dayType: DayType, field: TotalField, value: number | null) {
  return supabase
    .from('bulk_day_totals')
    .upsert({ user_id: userId, day_type: dayType, [field]: value }, { onConflict: 'user_id,day_type' });
}

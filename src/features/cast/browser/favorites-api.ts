import { supabase } from '@/lib/supabase';

import { favoriteKey, type FavoriteInput } from './favorites';

/** Browser favorites, shared by both members (RLS: public.is_member()). */
export type Favorite = { id: string; url: string; title: string };

export async function listFavorites(): Promise<Favorite[]> {
  const { data, error } = await supabase
    .from('browser_favorites')
    .select('id, url, title')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data as Favorite[];
}

export async function addFavorite(input: FavoriteInput): Promise<void> {
  const { error } = await supabase.from('browser_favorites').insert(input);
  if (error) throw error;
}

/** Removes every saved row for this page (the same page may have been saved twice). */
export async function removeFavorite(saved: Favorite[], url: string): Promise<void> {
  const key = favoriteKey(url);
  const ids = saved.filter((favorite) => favoriteKey(favorite.url) === key).map((favorite) => favorite.id);
  if (ids.length === 0) return;
  const { error } = await supabase.from('browser_favorites').delete().in('id', ids);
  if (error) throw error;
}

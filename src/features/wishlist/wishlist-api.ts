import { supabase } from '@/lib/supabase';

import type { WishItem } from './wishlist';

export async function listWishlist(): Promise<WishItem[]> {
  const { data, error } = await supabase
    .from('food_wishlist')
    .select('id, name, eaten, planned_month')
    .order('created_at');
  if (error) throw error;
  return data as WishItem[];
}

export function addWish(name: string) {
  return supabase.from('food_wishlist').insert({ name });
}

export function setEaten(item: WishItem, eaten: boolean) {
  return supabase.from('food_wishlist').update({ eaten }).eq('id', item.id);
}

export function setPlannedMonth(item: WishItem, month: string | null) {
  return supabase.from('food_wishlist').update({ planned_month: month }).eq('id', item.id);
}

export function deleteWish(item: WishItem) {
  return supabase.from('food_wishlist').delete().eq('id', item.id);
}

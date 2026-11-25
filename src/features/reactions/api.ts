import { supabase } from '@/lib/supabase';

import { validateReaction, type Reaction, type ReactionInput } from './rules';

const COLUMNS = 'id, created_by, emoji, message, created_at';

/**
 * Sends an emoji or a short message to the other member. Invalid input throws
 * with a user-facing message before reaching the server. created_by is set by
 * the database (auth.uid()); the push trigger notifies the other phone.
 */
export async function sendReaction(input: ReactionInput): Promise<Reaction> {
  const result = validateReaction(input);
  if (!result.ok) throw new Error(result.error);
  const row: { emoji: string | null; message: string | null } = result.value;
  const { data, error } = await supabase.from('reactions').insert(row).select(COLUMNS).single();
  if (error) throw error;
  return data as Reaction;
}

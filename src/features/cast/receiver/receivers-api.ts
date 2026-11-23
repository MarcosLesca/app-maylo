import { supabase } from '@/lib/supabase';

import type { ReceiverRow } from './receivers';

/** Shared receiver addresses, one row per member (RLS: members read all, write their own; 0015). */

/** Publishes this phone's receiver address under the signed-in member. */
export async function publishReceiver(userId: string, url: string, memberName: string): Promise<void> {
  const { error } = await supabase
    .from('cast_receivers')
    .upsert(
      { user_id: userId, url, member_name: memberName.trim() || null, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
  if (error) throw error;
}

export async function listReceivers(): Promise<ReceiverRow[]> {
  const { data, error } = await supabase.from('cast_receivers').select('user_id, url, member_name');
  if (error) throw error;
  return (data ?? []) as ReceiverRow[];
}

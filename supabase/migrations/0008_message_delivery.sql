-- Delivery receipts for messages (no "seen", on purpose).
-- delivered_at is set when the other member's app receives the message.
-- Members cannot UPDATE messages directly: the only way to touch a message
-- after sending is this function, which only stamps delivered_at on messages
-- sent by someone else. Realtime then pushes the UPDATE to the sender's chat.

alter table public.messages add column delivered_at timestamptz;

create or replace function public.mark_messages_delivered()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  marked integer;
begin
  if not public.is_member() then
    return 0;
  end if;

  update public.messages
     set delivered_at = now()
   where delivered_at is null
     and sender_id <> (select auth.uid());

  get diagnostics marked = row_count;
  return marked;
end;
$$;

revoke all on function public.mark_messages_delivered() from public, anon;
grant execute on function public.mark_messages_delivered() to authenticated;

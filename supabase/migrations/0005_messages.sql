-- Messages: a private chat between the two members.
--   * Members read every message; each one only sends and deletes their own.
--   * Realtime: the table is added to the supabase_realtime publication so the
--     open chat receives new messages instantly (RLS still applies).
--   * Push: the other member gets a notification titled with the sender's name.

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  body text not null check (length(trim(body)) between 1 and 2000),
  sender_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index messages_created_at_idx on public.messages (created_at desc);

alter table public.messages enable row level security;

create policy "members read messages" on public.messages
  for select to authenticated
  using (public.is_member());

create policy "members send as themselves" on public.messages
  for insert to authenticated
  with check (public.is_member() and sender_id = (select auth.uid()));

create policy "members delete their own messages" on public.messages
  for delete to authenticated
  using (public.is_member() and sender_id = (select auth.uid()));

grant select, insert, delete on table public.messages to authenticated;

-- Realtime: deliver inserts and deletes to the open chat
-- (with RLS on, delete events carry only the id, which is all the app needs).
alter publication supabase_realtime add table public.messages;

-- Push notification to the other member.
create or replace function private.on_messages_inserted()
returns trigger language plpgsql security definer set search_path = '' as $$
declare n int; first_body text;
begin
  select count(*), min(body) into n, first_body from new_rows;
  perform private.notify_others(
    private.actor_name(),
    case when n = 1 then left(first_body, 140) else n || ' mensajes nuevos' end,
    '/messages'
  );
  return null;
end;
$$;

revoke all on function private.on_messages_inserted() from public, anon, authenticated;

create trigger messages_notify after insert on public.messages
  referencing new table as new_rows for each statement execute function private.on_messages_inserted();

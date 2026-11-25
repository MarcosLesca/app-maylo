-- Reactions (S4): an emoji or a short message sent from the cast remote that
-- floats on the OTHER member's phone (never on the TV).
--   * Members read every reaction; each one only inserts as themselves.
--     No update/delete from the app: reactions are fire-and-forget.
--   * Realtime: the open app receives inserts and floats them for ~4 s.
--   * Push: the other member's phone gets a headless (data-only) push with
--     kind 'reaction' (title = sender name, body = emoji or message); the app's
--     background task only shows it when the app is not in the foreground.
--     Phones without the headless flag get a normal push whose data carries
--     kind 'reaction', so the foreground handler hides it while the app is open.
--   * Rows older than one day are pruned on each insert; nothing reads them later.
-- Re-runnable: if not exists, create or replace, drop ... if exists.

create table if not exists public.reactions (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  emoji text check (emoji is null or char_length(btrim(emoji)) between 1 and 16),
  message text check (message is null or (char_length(btrim(message)) >= 1 and char_length(message) <= 80)),
  created_at timestamptz not null default now(),
  constraint reactions_emoji_or_message check ((emoji is null) <> (message is null))
);

create index if not exists reactions_created_at_idx on public.reactions (created_at);

alter table public.reactions enable row level security;

drop policy if exists "members read reactions" on public.reactions;
create policy "members read reactions" on public.reactions
  for select to authenticated
  using (public.is_member());

drop policy if exists "members react as themselves" on public.reactions;
create policy "members react as themselves" on public.reactions
  for insert to authenticated
  with check (public.is_member() and created_by = (select auth.uid()));

grant select, insert on table public.reactions to authenticated;

-- Realtime (like 0005), guarded so the migration can run again.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reactions'
  ) then
    alter publication supabase_realtime add table public.reactions;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Push to the other member (same shape as private.notify_others_message, 0009).
-- ---------------------------------------------------------------------------
create or replace function private.notify_others_reaction(p_title text, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  messages jsonb;
begin
  select jsonb_agg(
           case when t.headless then
             jsonb_build_object(
               'to', t.token,
               'data', jsonb_build_object('kind', 'reaction', 'title', p_title, 'body', p_body),
               'priority', 'high'
             )
           else
             jsonb_build_object(
               'to', t.token,
               'title', p_title,
               'body', p_body,
               'data', jsonb_build_object('kind', 'reaction', 'url', '/'),
               'channelId', 'default',
               'sound', 'default',
               'priority', 'high'
             )
           end
         )
    into messages
    from public.push_tokens t
   where t.user_id is distinct from (select auth.uid());

  if messages is null then
    return;
  end if;

  perform net.http_post(
    url := 'https://exp.host/--/api/v2/push/send',
    body := messages,
    headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb
  );
exception when others then
  -- A push must never block or roll back the reaction (same rule as 0012).
  raise warning 'reaction push skipped: %', sqlerrm;
end;
$$;

create or replace function private.on_reactions_inserted()
returns trigger language plpgsql security definer set search_path = '' as $$
declare n int; first_text text;
begin
  select count(*), min(coalesce(emoji, message)) into n, first_text from new_rows;
  if n = 0 then return null; end if;

  perform private.notify_others_reaction(
    private.actor_name(),
    case when n = 1 then first_text else n || ' reacciones' end
  );

  -- Housekeeping: reactions are only shown live, so old ones are dropped.
  delete from public.reactions where created_at < now() - interval '1 day';
  return null;
end;
$$;

revoke all on function private.notify_others_reaction(text, text) from public, anon, authenticated;
revoke all on function private.on_reactions_inserted() from public, anon, authenticated;

drop trigger if exists reactions_notify on public.reactions;
create trigger reactions_notify after insert on public.reactions
  referencing new table as new_rows for each statement execute function private.on_reactions_inserted();

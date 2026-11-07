-- Delivery receipts with the app closed.
-- Phones running 1.3.0+ register headless = true: for chat messages they get a
-- data-only ("headless") push, which wakes a background task in the app that
-- marks the message delivered and shows the notification itself.
-- Older phones keep receiving a normal push, so nobody loses notifications
-- while they update. Other notifications (tasks, bills...) are unchanged.

alter table public.push_tokens add column headless boolean not null default false;

create or replace function private.notify_others_message(p_title text, p_body text, p_url text)
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
               'data', jsonb_build_object('kind', 'message', 'title', p_title, 'body', p_body, 'url', p_url),
               'priority', 'high'
             )
           else
             jsonb_build_object(
               'to', t.token,
               'title', p_title,
               'body', p_body,
               'data', jsonb_build_object('url', p_url),
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
end;
$$;

create or replace function private.on_messages_inserted()
returns trigger language plpgsql security definer set search_path = '' as $$
declare n int; first_body text;
begin
  select count(*), min(body) into n, first_body from new_rows;
  perform private.notify_others_message(
    private.actor_name(),
    case when n = 1 then coalesce(left(first_body, 140), 'Envió una foto') else n || ' mensajes nuevos' end,
    '/messages'
  );
  return null;
end;
$$;

revoke all on function private.notify_others_message(text, text, text) from public, anon, authenticated;

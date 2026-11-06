-- Push notifications: when one member adds something, the other gets a push.
--
-- How it works:
--   * The app stores its Expo push token in public.push_tokens.
--   * Statement-level AFTER INSERT triggers build one message per insert
--     statement (so "copy last month's list" sends one push, not twelve)
--     and send it to every token that does NOT belong to whoever inserted.
--   * pg_net posts to the Expo push API asynchronously, so a slow or failed
--     push never blocks or rolls back the insert.
-- Helper functions live in the "private" schema, which the Data API does not expose.

create extension if not exists pg_net with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Device tokens
-- ---------------------------------------------------------------------------
create table public.push_tokens (
  token text primary key check (token like 'ExponentPushToken[%]'),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  updated_at timestamptz not null default now()
);

alter table public.push_tokens enable row level security;

create policy "members manage their own tokens" on public.push_tokens
  for all to authenticated
  using (user_id = (select auth.uid()) and public.is_member())
  with check (user_id = (select auth.uid()) and public.is_member());

grant select, insert, update, delete on table public.push_tokens to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function private.actor_name()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select m.display_name from public.app_members m where m.user_id = (select auth.uid())),
    'Alguien'
  );
$$;

-- Sends one push to every device that is not the actor's.
create or replace function private.notify_others(p_title text, p_body text, p_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  messages jsonb;
begin
  select jsonb_agg(jsonb_build_object(
           'to', t.token,
           'title', p_title,
           'body', p_body,
           'data', jsonb_build_object('url', p_url),
           'channelId', 'default',
           'sound', 'default'
         ))
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

-- ---------------------------------------------------------------------------
-- One trigger function per table: describes what was added
-- ---------------------------------------------------------------------------
create or replace function private.on_tasks_inserted()
returns trigger language plpgsql security definer set search_path = '' as $$
declare n int; first_title text;
begin
  select count(*), min(title) into n, first_title from new_rows;
  perform private.notify_others(
    'Tareas',
    private.actor_name() || case when n = 1 then ' agregó: ' || first_title else ' agregó ' || n || ' tareas' end,
    '/tasks'
  );
  return null;
end;
$$;

create or replace function private.on_shopping_items_inserted()
returns trigger language plpgsql security definer set search_path = '' as $$
declare n int; first_item text;
begin
  select count(*), min(name || coalesce(' (' || quantity || ')', '')) into n, first_item from new_rows;
  perform private.notify_others(
    'Compras',
    private.actor_name() || case when n = 1 then ' agregó ' || first_item || ' a la lista'
                                 else ' agregó ' || n || ' productos a la lista' end,
    '/shopping'
  );
  return null;
end;
$$;

create or replace function private.on_bill_payments_inserted()
returns trigger language plpgsql security definer set search_path = '' as $$
declare n int; first_bill text;
begin
  select count(*), min(b.name) into n, first_bill
    from new_rows p join public.recurring_bills b on b.id = p.bill_id;
  perform private.notify_others(
    'Pagos',
    private.actor_name() || case when n = 1 then ' marcó ' || first_bill || ' como pagado'
                                 else ' marcó ' || n || ' gastos como pagados' end,
    '/'
  );
  return null;
end;
$$;

create or replace function private.on_payment_receipts_inserted()
returns trigger language plpgsql security definer set search_path = '' as $$
declare first_bill text;
begin
  select min(b.name) into first_bill
    from new_rows r
    join public.bill_payments p on p.id = r.payment_id
    join public.recurring_bills b on b.id = p.bill_id;
  perform private.notify_others(
    'Pagos',
    private.actor_name() || ' subió un comprobante de ' || coalesce(first_bill, 'un pago'),
    '/'
  );
  return null;
end;
$$;

create or replace function private.on_recurring_bills_inserted()
returns trigger language plpgsql security definer set search_path = '' as $$
declare n int; first_bill text;
begin
  select count(*), min(name) into n, first_bill from new_rows;
  perform private.notify_others(
    'Pagos',
    private.actor_name() || case when n = 1 then ' agregó el gasto fijo ' || first_bill
                                 else ' agregó ' || n || ' gastos fijos' end,
    '/'
  );
  return null;
end;
$$;

create or replace function private.on_anniversary_meals_inserted()
returns trigger language plpgsql security definer set search_path = '' as $$
declare n int; first_dish text; first_meal public.meal_type;
begin
  select count(*), min(dish), min(meal::text)::public.meal_type into n, first_dish, first_meal from new_rows;
  perform private.notify_others(
    'Aniversario',
    private.actor_name() || case
      when n > 1 then ' agregó ' || n || ' platos'
      else ' agregó ' || first_dish || case first_meal
        when 'breakfast' then ' al desayuno'
        when 'lunch' then ' al almuerzo'
        when 'afternoon_snack' then ' a la merienda'
        else ' a la cena'
      end
    end,
    '/anniversary'
  );
  return null;
end;
$$;

-- Only the triggers may run these.
revoke all on all functions in schema private from public, anon, authenticated;

create trigger tasks_notify after insert on public.tasks
  referencing new table as new_rows for each statement execute function private.on_tasks_inserted();
create trigger shopping_items_notify after insert on public.shopping_items
  referencing new table as new_rows for each statement execute function private.on_shopping_items_inserted();
create trigger bill_payments_notify after insert on public.bill_payments
  referencing new table as new_rows for each statement execute function private.on_bill_payments_inserted();
create trigger payment_receipts_notify after insert on public.payment_receipts
  referencing new table as new_rows for each statement execute function private.on_payment_receipts_inserted();
create trigger recurring_bills_notify after insert on public.recurring_bills
  referencing new table as new_rows for each statement execute function private.on_recurring_bills_inserted();
create trigger anniversary_meals_notify after insert on public.anniversary_meals
  referencing new table as new_rows for each statement execute function private.on_anniversary_meals_inserted();

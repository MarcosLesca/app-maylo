-- Push notifications for every change, not only additions.
--
-- 0004 notifies the other member when something is added. This adds the
-- missing pushes for edits and deletions (tasks, shopping, bills, payments,
-- receipts, anniversary dishes), plus every add, edit and delete in the
-- "Para comer" wishlist and the bulk notebook.
--
-- Same rules as 0004:
--   * Statement-level triggers with transition tables: one push per statement,
--     never one per row, and never to whoever made the change.
--   * Statements that changed nothing (0 rows, or an update that rewrote the
--     same values) send nothing.
--
-- Cascades: deleting a fixed bill cascades to its payments and receipts, and
-- unmarking a payment cascades to its receipts. Those cascaded deletes run as
-- separate statements after the parent row is already gone, so the payment and
-- receipt triggers only count rows whose parent still exists. Result: one push
-- per user action ("borró el gasto fijo Luz", "desmarcó Luz como pagado").
--
-- Not covered on purpose: chat messages (edits, deletes and delivery receipts
-- stay silent), push_tokens, app_members and the old recomp_* tables.
--
-- Re-runnable: functions use create or replace and triggers are dropped first.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Like private.notify_others, but a failure (pg_net missing, bad payload...)
-- only logs a warning: a push must never block or roll back the user's write.
create or replace function private.notify_others_safe(p_title text, p_body text, p_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.notify_others(p_title, p_body, p_url);
exception when others then
  raise warning 'push notification skipped: %', sqlerrm;
end;
$$;

-- "marzo 2027"
create or replace function private.month_label(p_month date)
returns text
language sql
immutable
set search_path = ''
as $$
  select (array['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
                'septiembre', 'octubre', 'noviembre', 'diciembre'])[extract(month from p_month)::int]
         || ' ' || extract(year from p_month)::int;
$$;

-- " (día de entreno)" when every changed bulk row is for the same day type, '' when mixed.
create or replace function private.bulk_day_label(p_training int, p_rest int)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_rest = 0 then ' (día de entreno)'
    when p_training = 0 then ' (día de descanso)'
    else ''
  end;
$$;

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------
create or replace function private.on_tasks_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare cnt int; cnt_done int; cnt_undone int; first_title text;
begin
  if tg_op = 'DELETE' then
    select count(*), min(title) into cnt, first_title from old_rows;
    if cnt = 0 then return null; end if;
    perform private.notify_others_safe(
      'Tareas',
      private.actor_name() || case when cnt = 1 then ' borró la tarea: ' || first_title else ' borró ' || cnt || ' tareas' end,
      '/tasks'
    );
    return null;
  end if;

  select count(*),
         count(*) filter (where r.done and not o.done),
         count(*) filter (where o.done and not r.done),
         min(r.title)
    into cnt, cnt_done, cnt_undone, first_title
    from new_rows r join old_rows o on o.id = r.id
   where r is distinct from o;
  if cnt = 0 then return null; end if;

  perform private.notify_others_safe(
    'Tareas',
    private.actor_name() || case
      when cnt = 1 and cnt_done = 1 then ' completó: ' || first_title
      when cnt = 1 and cnt_undone = 1 then ' marcó como pendiente: ' || first_title
      when cnt = 1 then ' editó la tarea: ' || first_title
      when cnt_done = cnt then ' completó ' || cnt || ' tareas'
      when cnt_undone = cnt then ' marcó ' || cnt || ' tareas como pendientes'
      else ' editó ' || cnt || ' tareas'
    end,
    '/tasks'
  );
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Shopping list
-- ---------------------------------------------------------------------------
create or replace function private.on_shopping_items_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare cnt int; cnt_bought int; cnt_unbought int; first_item text;
begin
  if tg_op = 'DELETE' then
    select count(*), min(name || coalesce(' (' || quantity || ')', '')) into cnt, first_item from old_rows;
    if cnt = 0 then return null; end if;
    perform private.notify_others_safe(
      'Compras',
      private.actor_name() || case when cnt = 1 then ' borró ' || first_item || ' de la lista'
                                   else ' borró ' || cnt || ' productos de la lista' end,
      '/shopping'
    );
    return null;
  end if;

  select count(*),
         count(*) filter (where r.bought and not o.bought),
         count(*) filter (where o.bought and not r.bought),
         min(r.name || coalesce(' (' || r.quantity || ')', ''))
    into cnt, cnt_bought, cnt_unbought, first_item
    from new_rows r join old_rows o on o.id = r.id
   where r is distinct from o;
  if cnt = 0 then return null; end if;

  perform private.notify_others_safe(
    'Compras',
    private.actor_name() || case
      when cnt = 1 and cnt_bought = 1 then ' compró ' || first_item
      when cnt = 1 and cnt_unbought = 1 then ' marcó ' || first_item || ' como pendiente'
      when cnt = 1 then ' editó ' || first_item
      when cnt_bought = cnt then ' compró ' || cnt || ' productos'
      when cnt_unbought = cnt then ' marcó ' || cnt || ' productos como pendientes'
      else ' editó ' || cnt || ' productos'
    end,
    '/shopping'
  );
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixed bills
-- ---------------------------------------------------------------------------
create or replace function private.on_recurring_bills_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare cnt int; cnt_off int; cnt_on int; first_bill text;
begin
  if tg_op = 'DELETE' then
    select count(*), min(name) into cnt, first_bill from old_rows;
    if cnt = 0 then return null; end if;
    perform private.notify_others_safe(
      'Pagos',
      private.actor_name() || case when cnt = 1 then ' borró el gasto fijo ' || first_bill
                                   else ' borró ' || cnt || ' gastos fijos' end,
      '/'
    );
    return null;
  end if;

  select count(*),
         count(*) filter (where o.active and not r.active),
         count(*) filter (where r.active and not o.active),
         min(r.name)
    into cnt, cnt_off, cnt_on, first_bill
    from new_rows r join old_rows o on o.id = r.id
   where r is distinct from o;
  if cnt = 0 then return null; end if;

  perform private.notify_others_safe(
    'Pagos',
    private.actor_name() || case
      when cnt = 1 and cnt_off = 1 then ' desactivó el gasto fijo ' || first_bill
      when cnt = 1 and cnt_on = 1 then ' reactivó el gasto fijo ' || first_bill
      when cnt = 1 then ' editó el gasto fijo ' || first_bill
      else ' editó ' || cnt || ' gastos fijos'
    end,
    '/'
  );
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Payments. Deletes cascaded from a deleted bill are skipped (the bill is gone).
-- ---------------------------------------------------------------------------
create or replace function private.on_bill_payments_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare cnt int; first_bill text;
begin
  if tg_op = 'DELETE' then
    select count(*), min(b.name) into cnt, first_bill
      from old_rows p join public.recurring_bills b on b.id = p.bill_id;
    if cnt = 0 then return null; end if;
    perform private.notify_others_safe(
      'Pagos',
      private.actor_name() || case when cnt = 1 then ' desmarcó ' || first_bill || ' como pagado'
                                   else ' desmarcó ' || cnt || ' gastos como pagados' end,
      '/'
    );
    return null;
  end if;

  select count(*), min(b.name) into cnt, first_bill
    from new_rows p
    join old_rows o on o.id = p.id
    join public.recurring_bills b on b.id = p.bill_id
   where p is distinct from o;
  if cnt = 0 then return null; end if;

  perform private.notify_others_safe(
    'Pagos',
    private.actor_name() || case when cnt = 1 then ' editó el pago de ' || first_bill
                                 else ' editó ' || cnt || ' pagos' end,
    '/'
  );
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Receipts. Deletes cascaded from a deleted payment or bill are skipped.
-- ---------------------------------------------------------------------------
create or replace function private.on_payment_receipts_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare cnt int; first_bill text;
begin
  if tg_op = 'DELETE' then
    select count(*), min(b.name) into cnt, first_bill
      from old_rows r
      join public.bill_payments p on p.id = r.payment_id
      join public.recurring_bills b on b.id = p.bill_id;
    if cnt = 0 then return null; end if;
    perform private.notify_others_safe(
      'Pagos',
      private.actor_name() || case when cnt = 1 then ' borró el comprobante de ' || first_bill
                                   else ' borró ' || cnt || ' comprobantes' end,
      '/'
    );
    return null;
  end if;

  select count(*), min(b.name) into cnt, first_bill
    from new_rows r
    join old_rows o on o.id = r.id
    join public.bill_payments p on p.id = r.payment_id
    join public.recurring_bills b on b.id = p.bill_id
   where r is distinct from o;
  if cnt = 0 then return null; end if;

  perform private.notify_others_safe(
    'Pagos',
    private.actor_name() || case when cnt = 1 then ' editó el comprobante de ' || first_bill
                                 else ' editó ' || cnt || ' comprobantes' end,
    '/'
  );
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Anniversary menu
-- ---------------------------------------------------------------------------
create or replace function private.on_anniversary_meals_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare cnt int; cnt_ready int; cnt_unready int; first_dish text;
begin
  if tg_op = 'DELETE' then
    select count(*), min(dish) into cnt, first_dish from old_rows;
    if cnt = 0 then return null; end if;
    perform private.notify_others_safe(
      'Aniversario',
      private.actor_name() || case when cnt = 1 then ' borró el plato ' || first_dish
                                   else ' borró ' || cnt || ' platos' end,
      '/anniversary'
    );
    return null;
  end if;

  select count(*),
         count(*) filter (where r.ready and not o.ready),
         count(*) filter (where o.ready and not r.ready),
         min(r.dish)
    into cnt, cnt_ready, cnt_unready, first_dish
    from new_rows r join old_rows o on o.id = r.id
   where r is distinct from o;
  if cnt = 0 then return null; end if;

  perform private.notify_others_safe(
    'Aniversario',
    private.actor_name() || case
      when cnt = 1 and cnt_ready = 1 then ' marcó como listo: ' || first_dish
      when cnt = 1 and cnt_unready = 1 then ' marcó como pendiente: ' || first_dish
      when cnt = 1 then ' editó el plato ' || first_dish
      when cnt_ready = cnt then ' marcó ' || cnt || ' platos como listos'
      else ' editó ' || cnt || ' platos'
    end,
    '/anniversary'
  );
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- "Para comer" wishlist (lives in the anniversary tab). Had no pushes at all.
-- ---------------------------------------------------------------------------
create or replace function private.on_food_wishlist_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare cnt int; cnt_eaten int; cnt_uneaten int; cnt_planned int; first_food text; first_month date;
begin
  if tg_op = 'INSERT' then
    select count(*), min(name) into cnt, first_food from new_rows;
    if cnt = 0 then return null; end if;
    perform private.notify_others_safe(
      'Para comer',
      private.actor_name() || case when cnt = 1 then ' agregó ' || first_food
                                   else ' agregó ' || cnt || ' comidas' end,
      '/anniversary'
    );
    return null;
  end if;

  if tg_op = 'DELETE' then
    select count(*), min(name) into cnt, first_food from old_rows;
    if cnt = 0 then return null; end if;
    perform private.notify_others_safe(
      'Para comer',
      private.actor_name() || case when cnt = 1 then ' borró ' || first_food
                                   else ' borró ' || cnt || ' comidas' end,
      '/anniversary'
    );
    return null;
  end if;

  select count(*),
         count(*) filter (where r.eaten and not o.eaten),
         count(*) filter (where o.eaten and not r.eaten),
         count(*) filter (where r.planned_month is distinct from o.planned_month),
         min(r.name),
         min(r.planned_month)
    into cnt, cnt_eaten, cnt_uneaten, cnt_planned, first_food, first_month
    from new_rows r join old_rows o on o.id = r.id
   where r is distinct from o;
  if cnt = 0 then return null; end if;

  perform private.notify_others_safe(
    'Para comer',
    private.actor_name() || case
      when cnt = 1 and cnt_eaten = 1 then ' ya probó ' || first_food
      when cnt = 1 and cnt_uneaten = 1 then ' marcó ' || first_food || ' como pendiente'
      when cnt = 1 and cnt_planned = 1 and first_month is null then ' sacó ' || first_food || ' de la planificación'
      when cnt = 1 and cnt_planned = 1 then ' planeó ' || first_food || ' para ' || private.month_label(first_month)
      when cnt = 1 then ' editó ' || first_food
      else ' editó ' || cnt || ' comidas'
    end,
    '/anniversary'
  );
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Bulk notebook. Rows are personal, so the push says that something changed
-- and on which day type, without showing foods, grams or totals.
-- ---------------------------------------------------------------------------
create or replace function private.on_bulk_foods_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare cnt int; cnt_training int; cnt_rest int; action text;
begin
  if tg_op = 'INSERT' then
    select count(*), count(*) filter (where day_type = 'training'), count(*) filter (where day_type = 'rest')
      into cnt, cnt_training, cnt_rest from new_rows;
    action := case when cnt = 1 then ' agregó una comida a su Bulk' else ' agregó ' || cnt || ' comidas a su Bulk' end;
  elsif tg_op = 'DELETE' then
    select count(*), count(*) filter (where day_type = 'training'), count(*) filter (where day_type = 'rest')
      into cnt, cnt_training, cnt_rest from old_rows;
    action := case when cnt = 1 then ' borró una comida de su Bulk' else ' borró ' || cnt || ' comidas de su Bulk' end;
  else
    select count(*), count(*) filter (where r.day_type = 'training'), count(*) filter (where r.day_type = 'rest')
      into cnt, cnt_training, cnt_rest
      from new_rows r join old_rows o on o.id = r.id
     where r is distinct from o;
    action := ' editó su Bulk';
  end if;
  if cnt = 0 then return null; end if;

  perform private.notify_others_safe(
    'Bulk',
    private.actor_name() || action || private.bulk_day_label(cnt_training, cnt_rest),
    '/bulk'
  );
  return null;
end;
$$;

-- The app saves totals and meal notes with an upsert: the first save of a day
-- fires the insert trigger, later ones the update trigger; the other one sees
-- 0 rows and stays silent, so each save sends exactly one push.
create or replace function private.on_bulk_day_totals_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare cnt int; cnt_training int; cnt_rest int; action text;
begin
  if tg_op = 'INSERT' then
    select count(*), count(*) filter (where day_type = 'training'), count(*) filter (where day_type = 'rest')
      into cnt, cnt_training, cnt_rest from new_rows;
    action := ' actualizó su Bulk';
  elsif tg_op = 'DELETE' then
    select count(*), count(*) filter (where day_type = 'training'), count(*) filter (where day_type = 'rest')
      into cnt, cnt_training, cnt_rest from old_rows;
    action := ' borró los totales de su Bulk';
  else
    -- No id column: rows that differ from every old row are the changed ones.
    select count(*), count(*) filter (where day_type = 'training'), count(*) filter (where day_type = 'rest')
      into cnt, cnt_training, cnt_rest
      from (select * from new_rows except all select * from old_rows) changed;
    action := ' actualizó su Bulk';
  end if;
  if cnt = 0 then return null; end if;

  perform private.notify_others_safe(
    'Bulk',
    private.actor_name() || action || private.bulk_day_label(cnt_training, cnt_rest),
    '/bulk'
  );
  return null;
end;
$$;

-- Only the triggers may run these.
revoke all on all functions in schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Triggers. The insert triggers from 0004 (tasks_notify, shopping_items_notify...)
-- are left as they are; these only add what was missing.
-- ---------------------------------------------------------------------------
drop trigger if exists tasks_notify_update on public.tasks;
create trigger tasks_notify_update after update on public.tasks
  referencing old table as old_rows new table as new_rows for each statement execute function private.on_tasks_changed();
drop trigger if exists tasks_notify_delete on public.tasks;
create trigger tasks_notify_delete after delete on public.tasks
  referencing old table as old_rows for each statement execute function private.on_tasks_changed();

drop trigger if exists shopping_items_notify_update on public.shopping_items;
create trigger shopping_items_notify_update after update on public.shopping_items
  referencing old table as old_rows new table as new_rows for each statement execute function private.on_shopping_items_changed();
drop trigger if exists shopping_items_notify_delete on public.shopping_items;
create trigger shopping_items_notify_delete after delete on public.shopping_items
  referencing old table as old_rows for each statement execute function private.on_shopping_items_changed();

drop trigger if exists recurring_bills_notify_update on public.recurring_bills;
create trigger recurring_bills_notify_update after update on public.recurring_bills
  referencing old table as old_rows new table as new_rows for each statement execute function private.on_recurring_bills_changed();
drop trigger if exists recurring_bills_notify_delete on public.recurring_bills;
create trigger recurring_bills_notify_delete after delete on public.recurring_bills
  referencing old table as old_rows for each statement execute function private.on_recurring_bills_changed();

drop trigger if exists bill_payments_notify_update on public.bill_payments;
create trigger bill_payments_notify_update after update on public.bill_payments
  referencing old table as old_rows new table as new_rows for each statement execute function private.on_bill_payments_changed();
drop trigger if exists bill_payments_notify_delete on public.bill_payments;
create trigger bill_payments_notify_delete after delete on public.bill_payments
  referencing old table as old_rows for each statement execute function private.on_bill_payments_changed();

drop trigger if exists payment_receipts_notify_update on public.payment_receipts;
create trigger payment_receipts_notify_update after update on public.payment_receipts
  referencing old table as old_rows new table as new_rows for each statement execute function private.on_payment_receipts_changed();
drop trigger if exists payment_receipts_notify_delete on public.payment_receipts;
create trigger payment_receipts_notify_delete after delete on public.payment_receipts
  referencing old table as old_rows for each statement execute function private.on_payment_receipts_changed();

drop trigger if exists anniversary_meals_notify_update on public.anniversary_meals;
create trigger anniversary_meals_notify_update after update on public.anniversary_meals
  referencing old table as old_rows new table as new_rows for each statement execute function private.on_anniversary_meals_changed();
drop trigger if exists anniversary_meals_notify_delete on public.anniversary_meals;
create trigger anniversary_meals_notify_delete after delete on public.anniversary_meals
  referencing old table as old_rows for each statement execute function private.on_anniversary_meals_changed();

drop trigger if exists food_wishlist_notify_insert on public.food_wishlist;
create trigger food_wishlist_notify_insert after insert on public.food_wishlist
  referencing new table as new_rows for each statement execute function private.on_food_wishlist_changed();
drop trigger if exists food_wishlist_notify_update on public.food_wishlist;
create trigger food_wishlist_notify_update after update on public.food_wishlist
  referencing old table as old_rows new table as new_rows for each statement execute function private.on_food_wishlist_changed();
drop trigger if exists food_wishlist_notify_delete on public.food_wishlist;
create trigger food_wishlist_notify_delete after delete on public.food_wishlist
  referencing old table as old_rows for each statement execute function private.on_food_wishlist_changed();

drop trigger if exists bulk_foods_notify_insert on public.bulk_foods;
create trigger bulk_foods_notify_insert after insert on public.bulk_foods
  referencing new table as new_rows for each statement execute function private.on_bulk_foods_changed();
drop trigger if exists bulk_foods_notify_update on public.bulk_foods;
create trigger bulk_foods_notify_update after update on public.bulk_foods
  referencing old table as old_rows new table as new_rows for each statement execute function private.on_bulk_foods_changed();
drop trigger if exists bulk_foods_notify_delete on public.bulk_foods;
create trigger bulk_foods_notify_delete after delete on public.bulk_foods
  referencing old table as old_rows for each statement execute function private.on_bulk_foods_changed();

drop trigger if exists bulk_day_totals_notify_insert on public.bulk_day_totals;
create trigger bulk_day_totals_notify_insert after insert on public.bulk_day_totals
  referencing new table as new_rows for each statement execute function private.on_bulk_day_totals_changed();
drop trigger if exists bulk_day_totals_notify_update on public.bulk_day_totals;
create trigger bulk_day_totals_notify_update after update on public.bulk_day_totals
  referencing old table as old_rows new table as new_rows for each statement execute function private.on_bulk_day_totals_changed();
drop trigger if exists bulk_day_totals_notify_delete on public.bulk_day_totals;
create trigger bulk_day_totals_notify_delete after delete on public.bulk_day_totals
  referencing old table as old_rows for each statement execute function private.on_bulk_day_totals_changed();

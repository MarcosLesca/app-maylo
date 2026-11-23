-- Bulk notebook becomes one notebook shared by both members.
--
--   * bulk_foods: every row of both members is now visible to and editable by
--     both (RLS "members full access", like the food wishlist). user_id stays
--     as the author.
--   * bulk_notebook_days: new shared table, one row per day type, with the
--     day's kcal, protein, fat and breakfast/lunch/dinner notes. Its first
--     content merges both members' bulk_day_totals rows (rules below).
--   * bulk_day_totals and its rows are left untouched (the app no longer uses
--     them) so the merge can be redone or reverted by hand.
--   * Push notifications keep working for the new table, as in 0012.
--
-- Re-runnable: the table and policies are guarded, functions use create or
-- replace, triggers are dropped first, and the merge uses
-- `on conflict (day_type) do nothing`, so a second run never overwrites what
-- was edited in the app after the first one.

-- ---------------------------------------------------------------------------
-- Foods: shared between members.
-- ---------------------------------------------------------------------------
drop policy if exists "own rows only" on public.bulk_foods;
drop policy if exists "members full access" on public.bulk_foods;
create policy "members full access" on public.bulk_foods for all to authenticated
  using (public.is_member()) with check (public.is_member());

-- ---------------------------------------------------------------------------
-- Day totals and meal notes: one shared row per day type.
-- ---------------------------------------------------------------------------
create table if not exists public.bulk_notebook_days (
  day_type text primary key check (day_type in ('training', 'rest')),
  kcal numeric(7, 1) check (kcal is null or kcal >= 0),
  protein_g numeric(7, 1) check (protein_g is null or protein_g >= 0),
  fat_g numeric(7, 1) check (fat_g is null or fat_g >= 0),
  breakfast text,
  lunch text,
  dinner text,
  -- Last member who changed the row (null for the rows created by this migration).
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.bulk_notebook_days enable row level security;
drop policy if exists "members full access" on public.bulk_notebook_days;
create policy "members full access" on public.bulk_notebook_days for all to authenticated
  using (public.is_member()) with check (public.is_member());
grant select, insert, update, delete on table public.bulk_notebook_days to authenticated;

create or replace function private.touch_bulk_notebook_days()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce((select auth.uid()), new.updated_by);
  return new;
end;
$$;

drop trigger if exists bulk_notebook_days_touch on public.bulk_notebook_days;
create trigger bulk_notebook_days_touch before update on public.bulk_notebook_days
  for each row execute function private.touch_bulk_notebook_days();

-- ---------------------------------------------------------------------------
-- Initial merge from bulk_day_totals, per day type:
--   * Rows are ranked by how many numeric fields (kcal, protein_g, fat_g) they
--     have filled, most first. Ties: bulk_day_totals has no creation time, so
--     the first member by app_members order wins, i.e. app_members.created_at
--     ascending, then user_id ascending as a final deterministic tie-break.
--   * Each numeric field takes the first non-null value in that ranking: the
--     top row's value, filling its nulls from the other row.
--   * Each note (breakfast, lunch, dinner) concatenates the distinct non-empty
--     texts (compared after trimming), in ranking order, joined with a blank line.
--   * Only rows of current members are merged. Day types without any old row
--     get no row; the app creates it on the first save.
-- `on conflict do nothing`: a day that already exists (a second run, or an edit
-- made in the app) is never overwritten.
-- ---------------------------------------------------------------------------
with ranked as (
  select t.*,
         row_number() over (
           partition by t.day_type
           order by (t.kcal is not null)::int + (t.protein_g is not null)::int + (t.fat_g is not null)::int desc,
                    m.created_at, m.user_id
         ) as rn
    from public.bulk_day_totals t
    join public.app_members m on m.user_id = t.user_id
),
notes as (
  select day_type, 'breakfast' as field, nullif(btrim(breakfast), '') as note, rn from ranked
  union all
  select day_type, 'lunch', nullif(btrim(lunch), ''), rn from ranked
  union all
  select day_type, 'dinner', nullif(btrim(dinner), ''), rn from ranked
),
distinct_notes as (
  select day_type, field, note, min(rn) as first_rn
    from notes
   where note is not null
   group by day_type, field, note
),
merged_notes as (
  select day_type,
         string_agg(note, E'\n\n' order by first_rn) filter (where field = 'breakfast') as breakfast,
         string_agg(note, E'\n\n' order by first_rn) filter (where field = 'lunch') as lunch,
         string_agg(note, E'\n\n' order by first_rn) filter (where field = 'dinner') as dinner
    from distinct_notes
   group by day_type
),
merged_numbers as (
  select day_type,
         (array_agg(kcal order by rn) filter (where kcal is not null))[1] as kcal,
         (array_agg(protein_g order by rn) filter (where protein_g is not null))[1] as protein_g,
         (array_agg(fat_g order by rn) filter (where fat_g is not null))[1] as fat_g
    from ranked
   group by day_type
)
insert into public.bulk_notebook_days (day_type, kcal, protein_g, fat_g, breakfast, lunch, dinner, updated_by)
select n.day_type, n.kcal, n.protein_g, n.fat_g, mn.breakfast, mn.lunch, mn.dinner, null
  from merged_numbers n
  left join merged_notes mn on mn.day_type = n.day_type
on conflict (day_type) do nothing;

-- ---------------------------------------------------------------------------
-- Push notifications. The notebook is shared now, so the wording says "el Bulk".
-- Pushes still only say that something changed and on which day type.
-- ---------------------------------------------------------------------------
create or replace function private.on_bulk_foods_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare cnt int; cnt_training int; cnt_rest int; action text;
begin
  if tg_op = 'INSERT' then
    select count(*), count(*) filter (where day_type = 'training'), count(*) filter (where day_type = 'rest')
      into cnt, cnt_training, cnt_rest from new_rows;
    action := case when cnt = 1 then ' agregó una comida al Bulk' else ' agregó ' || cnt || ' comidas al Bulk' end;
  elsif tg_op = 'DELETE' then
    select count(*), count(*) filter (where day_type = 'training'), count(*) filter (where day_type = 'rest')
      into cnt, cnt_training, cnt_rest from old_rows;
    action := case when cnt = 1 then ' borró una comida del Bulk' else ' borró ' || cnt || ' comidas del Bulk' end;
  else
    select count(*), count(*) filter (where r.day_type = 'training'), count(*) filter (where r.day_type = 'rest')
      into cnt, cnt_training, cnt_rest
      from new_rows r join old_rows o on o.id = r.id
     where r is distinct from o;
    action := ' editó el Bulk';
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
-- 0 rows and stays silent, so each save sends exactly one push. Updates that
-- only rewrite the same values send nothing (updated_at/updated_by are ignored).
create or replace function private.on_bulk_notebook_days_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare cnt int; cnt_training int; cnt_rest int; action text;
begin
  if tg_op = 'INSERT' then
    select count(*), count(*) filter (where day_type = 'training'), count(*) filter (where day_type = 'rest')
      into cnt, cnt_training, cnt_rest from new_rows;
    action := ' actualizó el Bulk';
  elsif tg_op = 'DELETE' then
    select count(*), count(*) filter (where day_type = 'training'), count(*) filter (where day_type = 'rest')
      into cnt, cnt_training, cnt_rest from old_rows;
    action := ' borró los totales del Bulk';
  else
    select count(*), count(*) filter (where r.day_type = 'training'), count(*) filter (where r.day_type = 'rest')
      into cnt, cnt_training, cnt_rest
      from new_rows r join old_rows o on o.day_type = r.day_type
     where (r.kcal, r.protein_g, r.fat_g, r.breakfast, r.lunch, r.dinner)
           is distinct from (o.kcal, o.protein_g, o.fat_g, o.breakfast, o.lunch, o.dinner);
    action := ' actualizó el Bulk';
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

drop trigger if exists bulk_notebook_days_notify_insert on public.bulk_notebook_days;
create trigger bulk_notebook_days_notify_insert after insert on public.bulk_notebook_days
  referencing new table as new_rows for each statement execute function private.on_bulk_notebook_days_changed();
drop trigger if exists bulk_notebook_days_notify_update on public.bulk_notebook_days;
create trigger bulk_notebook_days_notify_update after update on public.bulk_notebook_days
  referencing old table as old_rows new table as new_rows for each statement execute function private.on_bulk_notebook_days_changed();
drop trigger if exists bulk_notebook_days_notify_delete on public.bulk_notebook_days;
create trigger bulk_notebook_days_notify_delete after delete on public.bulk_notebook_days
  referencing old table as old_rows for each statement execute function private.on_bulk_notebook_days_changed();

-- Only the triggers may run these.
revoke all on all functions in schema private from public, anon, authenticated;

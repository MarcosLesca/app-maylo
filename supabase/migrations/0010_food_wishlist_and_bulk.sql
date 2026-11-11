-- Anniversary food wishlist (shared) and the bulk notebook (personal).
-- Only adds tables: the old recomp_* tables from 0007 are left untouched
-- (the app no longer uses them, but their data is kept).

-- ---------------------------------------------------------------------------
-- Foods we want to try. Shared between both members, like the anniversary menu.
-- ---------------------------------------------------------------------------
create table public.food_wishlist (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  eaten boolean not null default false,
  -- First day of the month it is planned for, or null while unplanned.
  planned_month date check (planned_month is null or extract(day from planned_month) = 1),
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now()
);

alter table public.food_wishlist enable row level security;
create policy "members full access" on public.food_wishlist for all to authenticated
  using (public.is_member()) with check (public.is_member());
grant select, insert, update, delete on table public.food_wishlist to authenticated;

-- ---------------------------------------------------------------------------
-- Bulk notebook: foods and grams for training and rest days, plus the day's
-- kcal, protein and fat. Personal: each member only sees their own rows.
-- ---------------------------------------------------------------------------
create table public.bulk_foods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day_type text not null check (day_type in ('training', 'rest')),
  name text not null check (length(trim(name)) > 0),
  grams numeric(7, 1) check (grams is null or grams >= 0),
  created_at timestamptz not null default now()
);

create index bulk_foods_user_idx on public.bulk_foods (user_id, day_type);

create table public.bulk_day_totals (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day_type text not null check (day_type in ('training', 'rest')),
  kcal numeric(7, 1) check (kcal is null or kcal >= 0),
  protein_g numeric(7, 1) check (protein_g is null or protein_g >= 0),
  fat_g numeric(7, 1) check (fat_g is null or fat_g >= 0),
  primary key (user_id, day_type)
);

do $$
declare
  t text;
begin
  foreach t in array array['bulk_foods', 'bulk_day_totals']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "own rows only" on public.%I for all to authenticated '
      'using (user_id = (select auth.uid()) and public.is_member()) '
      'with check (user_id = (select auth.uid()) and public.is_member())',
      t
    );
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
  end loop;
end $$;

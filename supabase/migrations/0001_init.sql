-- Pagos Casa: initial schema.
-- Run once in the Supabase SQL editor (or with `supabase db push`).
--
-- Security model:
--   * Public sign-up is disabled in the dashboard (Auth > Providers > Email).
--   * Every table has Row Level Security enabled.
--   * Only users listed in public.app_members can read or write anything,
--     so even an account created by mistake has no access to the data.

-- ---------------------------------------------------------------------------
-- Members allowlist
-- ---------------------------------------------------------------------------
create table public.app_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

alter table public.app_members enable row level security;

create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_members m where m.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_member() from public;
grant execute on function public.is_member() to authenticated;

create policy "members read members" on public.app_members
  for select to authenticated using (public.is_member());

-- ---------------------------------------------------------------------------
-- Recurring monthly bills (the template repeated every month)
-- ---------------------------------------------------------------------------
create table public.recurring_bills (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  expected_amount numeric(12, 2) check (expected_amount is null or expected_amount >= 0),
  due_day smallint check (due_day between 1 and 31),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- One row per bill per month once it has been paid.
create table public.bill_payments (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.recurring_bills (id) on delete cascade,
  period date not null check (extract(day from period) = 1),
  amount_paid numeric(12, 2) check (amount_paid is null or amount_paid >= 0),
  paid_at timestamptz not null default now(),
  paid_by uuid not null default auth.uid() references auth.users (id),
  unique (bill_id, period)
);

create table public.payment_receipts (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.bill_payments (id) on delete cascade,
  storage_path text not null unique,
  mime_type text not null,
  uploaded_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- To-do tasks
-- ---------------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  done boolean not null default false,
  done_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Monthly shopping list
-- ---------------------------------------------------------------------------
create table public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  period date not null check (extract(day from period) = 1),
  name text not null check (length(trim(name)) > 0),
  quantity text,
  bought boolean not null default false,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now()
);

create index shopping_items_period_idx on public.shopping_items (period);

-- ---------------------------------------------------------------------------
-- Anniversary meal plan
-- ---------------------------------------------------------------------------
create type public.meal_type as enum ('breakfast', 'lunch', 'afternoon_snack', 'dinner');

create table public.anniversary_meals (
  id uuid primary key default gen_random_uuid(),
  event_date date not null,
  meal public.meal_type not null,
  dish text not null check (length(trim(dish)) > 0),
  notes text,
  ready boolean not null default false,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now()
);

create index anniversary_meals_date_idx on public.anniversary_meals (event_date);

-- ---------------------------------------------------------------------------
-- RLS: members have full access to shared data, nobody else has any.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'recurring_bills', 'bill_payments', 'payment_receipts',
    'tasks', 'shopping_items', 'anniversary_meals'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "members full access" on public.%I for all to authenticated '
      'using (public.is_member()) with check (public.is_member())',
      t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Keep-alive: tiny RPC hit by the GitHub Action so the free project
-- does not get paused. Returns nothing sensitive.
-- ---------------------------------------------------------------------------
create or replace function public.ping()
returns text
language sql
stable
as $$ select 'pong'::text $$;

grant execute on function public.ping() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage: private bucket for receipts (images and PDFs, max 10 MB).
-- Object paths look like: <period>/<payment_id>/<uuid>.<ext>
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipts', 'receipts', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
);

create policy "members read receipts" on storage.objects
  for select to authenticated
  using (bucket_id = 'receipts' and public.is_member());

create policy "members upload receipts" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'receipts' and public.is_member());

create policy "members delete receipts" on storage.objects
  for delete to authenticated
  using (bucket_id = 'receipts' and public.is_member());

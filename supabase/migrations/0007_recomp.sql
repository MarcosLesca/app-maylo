-- Body recomposition tracking. Personal data: every row belongs to one member
-- and only that member can read or change it (weight is not shared).
-- The plan portions themselves live in the app (src/features/recomp/plan.ts).
-- No push notifications here: daily check-ins would only be noise.

create table public.recomp_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  start_date date not null,
  -- Decision at week 4: keep week 4 portions ("maintain") or move on to week 5 ("continue").
  after_week4 text check (after_week4 in ('maintain', 'continue')),
  updated_at timestamptz not null default now()
);

create table public.recomp_days (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day date not null,
  day_type text not null check (day_type in ('training', 'rest')),
  completed boolean not null default false,
  primary key (user_id, day)
);

create table public.recomp_weights (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day date not null,
  weight_kg numeric(5, 2) not null check (weight_kg between 20 and 400),
  primary key (user_id, day)
);

do $$
declare
  t text;
begin
  foreach t in array array['recomp_settings', 'recomp_days', 'recomp_weights']
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

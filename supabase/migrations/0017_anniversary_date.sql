-- Ambient TV mode (S3): shared couple settings, one row for both members.
--   * anniversary_date: the day they started (any year); the TV receiver page
--     counts down to its next yearly occurrence ("Faltan N días…"). Null shows
--     only the clock.
-- Single row enforced by a boolean primary key that can only be true; the app
-- upserts { id: true, anniversary_date }. Members-only RLS through
-- public.is_member(), like browser_favorites. Only adds a table; no existing
-- data is touched. Re-runnable (if not exists / drop policy if exists).

create table if not exists public.couple_settings (
  id boolean primary key default true check (id),
  anniversary_date date,
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.couple_settings enable row level security;
drop policy if exists "members full access" on public.couple_settings;
create policy "members full access" on public.couple_settings for all to authenticated
  using (public.is_member()) with check (public.is_member());
grant select, insert, update, delete on table public.couple_settings to authenticated;

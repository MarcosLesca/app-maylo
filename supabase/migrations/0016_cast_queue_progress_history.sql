-- TV cast extras (S1, S2, S6): the shared queue, "seguir viendo" positions and
-- the shared browser history. All three are shared by both members (like
-- browser_favorites): members-only RLS through public.is_member().
--   * cast_queue: videos waiting for the TV. The phone that is casting claims the
--     oldest one by deleting it (only the phone whose delete returns the row casts
--     it). Keeps the page's cookie (both members agreed) so a queued cast sends the
--     same headers as a normal one; an expired link shows "Abrí la página".
--     Added to the supabase_realtime publication so both remotes see it live.
--   * watch_progress: last position per video, key = normalized top page + title.
--   * browser_history: last time each page was cast, for "Lo último que vimos".
-- Only adds tables; no push triggers. Re-runnable (if not exists / drop policy
-- if exists / publication guarded).

create table if not exists public.cast_queue (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  video_url text not null check (video_url ~* '^https?://' and length(video_url) <= 4096),
  referer text not null check (length(referer) <= 4096),
  user_agent text check (length(user_agent) <= 1024),
  cookie text check (length(cookie) <= 8192),
  page_url text not null check (page_url ~* '^https?://' and length(page_url) <= 4096),
  title text not null check (length(trim(title)) > 0 and length(title) <= 200),
  created_at timestamptz not null default now()
);

create index if not exists cast_queue_created_at_idx on public.cast_queue (created_at, id);

alter table public.cast_queue enable row level security;
drop policy if exists "members full access" on public.cast_queue;
create policy "members full access" on public.cast_queue for all to authenticated
  using (public.is_member()) with check (public.is_member());
grant select, insert, update, delete on table public.cast_queue to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cast_queue'
  ) then
    alter publication supabase_realtime add table public.cast_queue;
  end if;
end
$$;

create table if not exists public.watch_progress (
  key text primary key check (length(key) > 0 and length(key) <= 4500),
  page_url text not null check (page_url ~* '^https?://' and length(page_url) <= 4096),
  title text not null check (length(title) <= 200),
  position_s double precision not null check (position_s >= 0),
  duration_s double precision check (duration_s is null or duration_s > 0),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.watch_progress enable row level security;
drop policy if exists "members full access" on public.watch_progress;
create policy "members full access" on public.watch_progress for all to authenticated
  using (public.is_member()) with check (public.is_member());
grant select, insert, update, delete on table public.watch_progress to authenticated;

create table if not exists public.browser_history (
  id uuid primary key default gen_random_uuid(),
  url text not null unique check (url ~* '^https?://' and length(url) <= 2048),
  title text not null check (length(trim(title)) > 0 and length(title) <= 120),
  watched_by uuid default auth.uid() references auth.users (id) on delete set null,
  last_watched_at timestamptz not null default now()
);

create index if not exists browser_history_last_watched_idx on public.browser_history (last_watched_at desc);

alter table public.browser_history enable row level security;
drop policy if exists "members full access" on public.browser_history;
create policy "members full access" on public.browser_history for all to authenticated
  using (public.is_member()) with check (public.is_member());
grant select, insert, update, delete on table public.browser_history to authenticated;

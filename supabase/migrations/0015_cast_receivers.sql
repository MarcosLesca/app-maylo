-- Where each member's phone serves the TV browser receiver, so the receiver page
-- served by either phone also polls the other one (either phone can cast).
-- One row per member: everyone reads both, each member writes only their own.
-- Only adds a table; re-runnable (if not exists / drop policy if exists).
-- No push triggers: the rows change on their own whenever the receiver starts.

create table if not exists public.cast_receivers (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  url text not null check (url ~* '^http://[0-9.]+:[0-9]+/tv/[A-Za-z0-9]{6}$'),
  member_name text,
  updated_at timestamptz default now()
);

alter table public.cast_receivers enable row level security;

drop policy if exists "members read receivers" on public.cast_receivers;
create policy "members read receivers" on public.cast_receivers for select to authenticated
  using (public.is_member());

drop policy if exists "own receiver insert" on public.cast_receivers;
create policy "own receiver insert" on public.cast_receivers for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_member());

drop policy if exists "own receiver update" on public.cast_receivers;
create policy "own receiver update" on public.cast_receivers for update to authenticated
  using (user_id = (select auth.uid()) and public.is_member())
  with check (user_id = (select auth.uid()) and public.is_member());

drop policy if exists "own receiver delete" on public.cast_receivers;
create policy "own receiver delete" on public.cast_receivers for delete to authenticated
  using (user_id = (select auth.uid()) and public.is_member());

grant select, insert, update, delete on table public.cast_receivers to authenticated;

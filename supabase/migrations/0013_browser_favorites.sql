-- Favorite pages of the TV cast browser. Shared between both members, like the
-- food wishlist. Only adds a table; no existing data is touched.

create table public.browser_favorites (
  id uuid primary key default gen_random_uuid(),
  url text not null check (url ~* '^https?://' and length(url) <= 2048),
  title text not null check (length(trim(title)) > 0 and length(title) <= 120),
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now()
);

alter table public.browser_favorites enable row level security;
create policy "members full access" on public.browser_favorites for all to authenticated
  using (public.is_member()) with check (public.is_member());
grant select, insert, update, delete on table public.browser_favorites to authenticated;

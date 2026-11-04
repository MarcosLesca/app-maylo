-- Explicit Data API privileges.
--
-- The project is created with "Automatically expose new tables" disabled,
-- so tables get no privileges by default. Grant only what the app needs,
-- and only to signed-in users. The anon role gets no table access at all:
-- RLS (members allowlist) is a second layer on top of these grants.

grant usage on schema public to anon, authenticated;

-- Shared household data: full CRUD for signed-in users (RLS limits it to members).
grant select, insert, update, delete on table
  public.recurring_bills,
  public.bill_payments,
  public.payment_receipts,
  public.tasks,
  public.shopping_items,
  public.anniversary_meals
to authenticated;

-- Members allowlist: read-only from the app. Managed by hand in the SQL editor.
grant select on table public.app_members to authenticated;

-- Functions: is_member() (used by RLS) and ping() (keep-alive) were granted
-- explicitly in 0001_init.sql; repeated here so this file is the single
-- reference for what the API can reach.
grant execute on function public.is_member() to authenticated;
grant execute on function public.ping() to anon, authenticated;

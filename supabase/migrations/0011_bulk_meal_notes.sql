-- Bulk notebook: free-text breakfast, lunch and dinner notes per day type.
-- Only adds nullable columns; the grants and RLS from 0010 already cover them.

alter table public.bulk_day_totals
  add column breakfast text,
  add column lunch text,
  add column dinner text;

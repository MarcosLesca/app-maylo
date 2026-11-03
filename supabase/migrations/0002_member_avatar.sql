-- Each member picks the mark shown at the top-left of the app:
-- 'mustache' (the dev) or 'dumbbell' (the gym lover).
-- Additive change: existing members default to 'mustache'.

create type public.member_avatar as enum ('mustache', 'dumbbell');

alter table public.app_members
  add column avatar public.member_avatar not null default 'mustache';

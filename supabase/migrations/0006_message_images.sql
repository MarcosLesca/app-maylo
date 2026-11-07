-- Photos in messages.
--   * A message has text, a photo, or both. Photo size is stored so the chat
--     can lay it out before it downloads.
--   * Photos live in a private "chat-images" bucket, one folder per sender:
--     members can view all of them, but only upload or delete in their own folder.

alter table public.messages
  alter column body drop not null,
  add column image_path text unique,
  add column image_width int check (image_width > 0),
  add column image_height int check (image_height > 0);

-- Replace the text-only rule: text (if any) is 1..2000 chars, and there is text or a photo.
alter table public.messages drop constraint messages_body_check;
alter table public.messages add constraint messages_content_check check (
  (body is null or length(trim(body)) between 1 and 2000)
  and (body is not null or image_path is not null)
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-images', 'chat-images', false, 10485760, array['image/jpeg', 'image/png', 'image/webp']);

create policy "members view chat images" on storage.objects
  for select to authenticated
  using (bucket_id = 'chat-images' and public.is_member());

create policy "members upload chat images to their folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-images'
    and public.is_member()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "members delete their own chat images" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chat-images'
    and public.is_member()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Push text for photo-only messages.
create or replace function private.on_messages_inserted()
returns trigger language plpgsql security definer set search_path = '' as $$
declare n int; first_body text;
begin
  select count(*), min(body) into n, first_body from new_rows;
  perform private.notify_others(
    private.actor_name(),
    case when n = 1 then coalesce(left(first_body, 140), 'Envió una foto') else n || ' mensajes nuevos' end,
    '/messages'
  );
  return null;
end;
$$;

-- Run in Supabase SQL Editor (after supabase-migration.sql)
-- Chat media storage + realtime for messages table

-- ── Realtime on messages ──
alter publication supabase_realtime add table public.messages;

-- ── Chat media bucket ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-media',
  'chat-media',
  true,
  52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'audio/webm', 'audio/mpeg', 'audio/ogg', 'audio/mp4', 'video/webm']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "chat-media: public read" on storage.objects;
create policy "chat-media: public read"
on storage.objects for select
to public
using (bucket_id = 'chat-media');

drop policy if exists "chat-media: authenticated upload" on storage.objects;
create policy "chat-media: authenticated upload"
on storage.objects for insert
to authenticated
with check (bucket_id = 'chat-media');

drop policy if exists "chat-media: authenticated update" on storage.objects;
create policy "chat-media: authenticated update"
on storage.objects for update
to authenticated
using (bucket_id = 'chat-media');

drop policy if exists "chat-media: authenticated delete" on storage.objects;
create policy "chat-media: authenticated delete"
on storage.objects for delete
to authenticated
using (bucket_id = 'chat-media');

-- BuyForMe: Shopper profile videos (run in Supabase SQL editor if you already applied the main migration)

alter table public.users add column if not exists profile_videos jsonb default '[]'::jsonb;

-- Must drop first: CREATE OR REPLACE cannot insert a column in the middle of an existing view.
drop view if exists public.public_shoppers;

create view public.public_shoppers as
select
  uid,
  name,
  avatar_url,
  location,
  about,
  profile_videos,
  tags,
  fee,
  rating,
  review_count,
  completion_rate,
  years_active,
  response_time,
  joined_at
from public.users
where role = 'shopper'
  and verification_status = 'approved';

grant select on public.public_shoppers to authenticated;

-- Storage bucket for shopper profile videos (public read, shoppers upload to their folder)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'shopper-videos',
  'shopper-videos',
  true,
  314572800,
  null
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = 314572800,
  allowed_mime_types = null;

drop policy if exists "shopper-videos: public read" on storage.objects;
create policy "shopper-videos: public read"
on storage.objects for select
to public
using (bucket_id = 'shopper-videos');

drop policy if exists "shopper-videos: upload own" on storage.objects;
create policy "shopper-videos: upload own"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'shopper-videos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "shopper-videos: update own" on storage.objects;
create policy "shopper-videos: update own"
on storage.objects for update
to authenticated
using (
  bucket_id = 'shopper-videos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "shopper-videos: delete own" on storage.objects;
create policy "shopper-videos: delete own"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'shopper-videos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

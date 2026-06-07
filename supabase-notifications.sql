-- BuyForMe Phase 2: notifications + profile extensions
-- Run in Supabase SQL editor (staging first).

-- ─── User profile columns ───
alter table public.users add column if not exists notifications boolean default true;
alter table public.users add column if not exists saved_addresses jsonb default '[]'::jsonb;

-- ─── Notifications table ───
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(uid) on delete cascade,
  type text default 'info', -- info | order | message | system
  title text,
  body text not null,
  link text,
  is_read boolean default false,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists notifications_user_id_idx on public.notifications(user_id);
create index if not exists notifications_user_created_idx on public.notifications(user_id, created_at desc);
create index if not exists notifications_user_unread_idx on public.notifications(user_id, is_read) where is_read = false;

-- ─── RLS ───
alter table public.notifications enable row level security;

drop policy if exists "notifications: read own" on public.notifications;
create policy "notifications: read own"
on public.notifications for select to authenticated
using (user_id::text = auth.uid()::text or public.is_admin());

drop policy if exists "notifications: insert own" on public.notifications;
create policy "notifications: insert own"
on public.notifications for insert to authenticated
with check (user_id::text = auth.uid()::text or public.is_admin());

drop policy if exists "notifications: update own" on public.notifications;
create policy "notifications: update own"
on public.notifications for update to authenticated
using (user_id::text = auth.uid()::text or public.is_admin())
with check (user_id::text = auth.uid()::text or public.is_admin());

drop policy if exists "notifications: delete own" on public.notifications;
create policy "notifications: delete own"
on public.notifications for delete to authenticated
using (user_id::text = auth.uid()::text or public.is_admin());

-- Enable realtime (optional — run if not already enabled)
-- alter publication supabase_realtime add table public.notifications;

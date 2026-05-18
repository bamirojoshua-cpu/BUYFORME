-- BuyForMe — fix messages table for UUID user ids
-- Run in Supabase SQL Editor if chat errors with:
--   invalid input syntax for type bigint: "<uuid>"
--
-- Your app uses auth UUIDs (users.uid). sender_id / receiver_id must be uuid (or text), not bigint.

create extension if not exists "pgcrypto";

-- Backup old table if it exists (optional safety)
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'messages'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'messages'
      and column_name = 'sender_id' and data_type = 'bigint'
  ) then
    execute 'alter table public.messages rename to messages_legacy_bigint';
  end if;
end $$;

-- Correct schema (uuid ids matching auth.users / users.uid)
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null,
  sender_id uuid not null,
  sender_name text,
  sender_role text,
  receiver_id uuid not null,
  receiver_name text,
  content text,
  is_read boolean default false,
  created_at timestamptz default now()
);

create index if not exists messages_conversation_id_idx on public.messages(conversation_id);
create index if not exists messages_receiver_unread_idx on public.messages(receiver_id, is_read);
create index if not exists messages_created_at_idx on public.messages(created_at desc);

alter table public.messages enable row level security;

drop policy if exists "messages: read participant" on public.messages;
create policy "messages: read participant"
on public.messages for select to authenticated
using (
  sender_id::text = auth.uid()::text
  or receiver_id::text = auth.uid()::text
  or exists (select 1 from public.users u where u.uid::text = auth.uid()::text and u.role = 'admin')
);

drop policy if exists "messages: send as self" on public.messages;
create policy "messages: send as self"
on public.messages for insert to authenticated
with check (sender_id::text = auth.uid()::text);

drop policy if exists "messages: receiver mark read" on public.messages;
create policy "messages: receiver mark read"
on public.messages for update to authenticated
using (receiver_id::text = auth.uid()::text)
with check (receiver_id::text = auth.uid()::text);

-- Realtime (ignore error if already added)
do $$
begin
  alter publication supabase_realtime add table public.messages;
exception
  when duplicate_object then null;
end $$;

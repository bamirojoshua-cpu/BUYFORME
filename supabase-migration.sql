-- BuyForMe: Supabase schema + RLS starter migration
-- Run this in the Supabase SQL editor (staging first).
-- This script is written to be "mostly idempotent" (safe-ish to re-run),
-- but ALWAYS review in your environment before applying to prod.

-- ─────────────────────────────────────────────────────────────
-- 0) Extensions (uuid)
-- ─────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────
-- 1) Helper: is_admin()
-- ─────────────────────────────────────────────────────────────
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.users u
    where u.uid::text = auth.uid()::text
      and u.role = 'admin'
  );
$$;

-- ─────────────────────────────────────────────────────────────
-- 2) USERS TABLE (columns used by your app)
--    If your users table already exists, this only adds missing cols.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.users (
  uid uuid primary key,
  name text,
  email text,
  role text default 'buyer',
  verification_status text default 'n/a',

  -- public shopper profile fields
  avatar_url text,
  location text,
  about text,
  tags text,
  fee text,
  rating numeric,
  review_count integer default 0,
  completion_rate text,
  years_active integer,
  response_time text,
  phone text,
  trips jsonb,

  -- buyer profile fields
  address text,
  city text,
  country text,
  currency text,
  payment text,

  -- account controls (used by admin dashboard for buyers)
  suspended boolean default false,

  -- KYC pointers (Supabase Storage paths)
  kyc_passport text,
  kyc_id text,
  kyc_permit text,
  submitted_at timestamptz,

  -- payout details (shopper-dashboard settings)
  payout_method text,
  payout_account_name text,
  payout_account_number text,
  payout_bank_name text,
  payout_country text,
  payout_email text,

  joined_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.users add column if not exists name text;
alter table public.users add column if not exists email text;
alter table public.users add column if not exists role text;
alter table public.users add column if not exists verification_status text;
alter table public.users add column if not exists avatar_url text;
alter table public.users add column if not exists location text;
alter table public.users add column if not exists about text;
alter table public.users add column if not exists tags text;
alter table public.users add column if not exists fee text;
alter table public.users add column if not exists rating numeric;
alter table public.users add column if not exists review_count integer;
alter table public.users add column if not exists completion_rate text;
alter table public.users add column if not exists years_active integer;
alter table public.users add column if not exists response_time text;
alter table public.users add column if not exists phone text;
alter table public.users add column if not exists trips jsonb;
alter table public.users add column if not exists address text;
alter table public.users add column if not exists city text;
alter table public.users add column if not exists country text;
alter table public.users add column if not exists currency text;
alter table public.users add column if not exists payment text;
alter table public.users add column if not exists suspended boolean;
alter table public.users add column if not exists kyc_passport text;
alter table public.users add column if not exists kyc_id text;
alter table public.users add column if not exists kyc_permit text;
alter table public.users add column if not exists submitted_at timestamptz;
alter table public.users add column if not exists payout_method text;
alter table public.users add column if not exists payout_account_name text;
alter table public.users add column if not exists payout_account_number text;
alter table public.users add column if not exists payout_bank_name text;
alter table public.users add column if not exists payout_country text;
alter table public.users add column if not exists payout_email text;
alter table public.users add column if not exists joined_at timestamptz;
alter table public.users add column if not exists created_at timestamptz;
alter table public.users add column if not exists updated_at timestamptz;

create index if not exists users_role_idx on public.users(role);
create index if not exists users_verification_status_idx on public.users(verification_status);

-- ─────────────────────────────────────────────────────────────
-- 3) REQUESTS TABLE (your "orders" + "requests")
-- ─────────────────────────────────────────────────────────────
create table if not exists public.requests (
  id uuid primary key default gen_random_uuid(),

  buyer_id uuid not null,
  buyer_name text,

  shopper_id uuid not null,
  shopper_name text,
  shopper_location text,

  product_name text,
  store_name text,
  quantity integer,
  category text,
  notes text,

  budget numeric,
  shopper_fee numeric,
  platform_fee numeric,
  total_amount numeric,
  currency text,

  address text,
  country text,
  phone text,
  timeline text,

  status text default 'pending',

  payment_reference text,
  paid_at timestamptz,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.requests add column if not exists buyer_id uuid;
alter table public.requests add column if not exists buyer_name text;
alter table public.requests add column if not exists shopper_id uuid;
alter table public.requests add column if not exists shopper_name text;
alter table public.requests add column if not exists shopper_location text;
alter table public.requests add column if not exists product_name text;
alter table public.requests add column if not exists store_name text;
alter table public.requests add column if not exists quantity integer;
alter table public.requests add column if not exists category text;
alter table public.requests add column if not exists notes text;
alter table public.requests add column if not exists budget numeric;
alter table public.requests add column if not exists shopper_fee numeric;
alter table public.requests add column if not exists platform_fee numeric;
alter table public.requests add column if not exists total_amount numeric;
alter table public.requests add column if not exists currency text;
alter table public.requests add column if not exists address text;
alter table public.requests add column if not exists country text;
alter table public.requests add column if not exists phone text;
alter table public.requests add column if not exists timeline text;
alter table public.requests add column if not exists status text;
alter table public.requests add column if not exists payment_reference text;
alter table public.requests add column if not exists paid_at timestamptz;
alter table public.requests add column if not exists created_at timestamptz;
alter table public.requests add column if not exists updated_at timestamptz;

create index if not exists requests_buyer_id_idx on public.requests(buyer_id);
create index if not exists requests_shopper_id_idx on public.requests(shopper_id);
create index if not exists requests_status_idx on public.requests(status);
create index if not exists requests_created_at_idx on public.requests(created_at desc);

-- ─────────────────────────────────────────────────────────────
-- 4) MESSAGES TABLE
-- ─────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────
-- 5) REVIEWS TABLE
-- ─────────────────────────────────────────────────────────────
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  shopper_id uuid not null,
  buyer_id uuid not null,
  buyer_name text,
  stars integer,
  text text,
  created_at timestamptz default now()
);

create index if not exists reviews_shopper_id_idx on public.reviews(shopper_id);
create index if not exists reviews_created_at_idx on public.reviews(created_at desc);

-- ─────────────────────────────────────────────────────────────
-- 6) BROADCASTS TABLE (admin broadcasts)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  target text default 'all', -- all|buyers|shoppers
  title text,
  body text,
  sent_at timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────
-- 7) PLATFORM SETTINGS TABLE (id=1 singleton)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.platform_settings (
  id integer primary key,
  platform_name text,
  support_email text,
  service_fee numeric default 15,
  default_currency text default 'NGN',
  maintenance_mode boolean default false,
  shopper_reg boolean default true,
  buyer_reg boolean default true,
  payments_enabled boolean default true,
  updated_at timestamptz default now()
);

insert into public.platform_settings (id)
values (1)
on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────
-- 8) Public shopper directory view (use this in buyers/profile pages)
-- ─────────────────────────────────────────────────────────────
create or replace view public.public_shoppers as
select
  uid,
  name,
  avatar_url,
  location,
  about,
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

-- ─────────────────────────────────────────────────────────────
-- 9) RLS POLICIES
--    NOTE: enabling RLS without policies will break your app.
-- ─────────────────────────────────────────────────────────────

-- USERS RLS
alter table public.users enable row level security;

drop policy if exists "users: read self" on public.users;
create policy "users: read self"
on public.users
for select
to authenticated
using (uid::text = auth.uid()::text or public.is_admin());

drop policy if exists "users: insert self" on public.users;
create policy "users: insert self"
on public.users
for insert
to authenticated
with check (uid::text = auth.uid()::text or public.is_admin());

-- Allow user to update ONLY their row; prevent role/verification changes by requiring those fields not to change.
-- If you rename columns, update this policy.
drop policy if exists "users: update self safe" on public.users;
create policy "users: update self safe"
on public.users
for update
to authenticated
using (uid::text = auth.uid()::text or public.is_admin())
with check (
  -- admin bypass
  public.is_admin()
  or (
    uid::text = auth.uid()::text
    and role is not distinct from (select u.role from public.users u where u.uid::text = auth.uid()::text)
    and verification_status is not distinct from (select u.verification_status from public.users u where u.uid::text = auth.uid()::text)
    and kyc_passport is not distinct from (select u.kyc_passport from public.users u where u.uid::text = auth.uid()::text)
    and kyc_id       is not distinct from (select u.kyc_id       from public.users u where u.uid::text = auth.uid()::text)
    and kyc_permit   is not distinct from (select u.kyc_permit   from public.users u where u.uid::text = auth.uid()::text)
  )
);

-- REQUESTS RLS
alter table public.requests enable row level security;

drop policy if exists "requests: read participant" on public.requests;
create policy "requests: read participant"
on public.requests
for select
to authenticated
using (
  buyer_id::text = auth.uid()::text
  or shopper_id::text = auth.uid()::text
  or public.is_admin()
);

drop policy if exists "requests: buyer create" on public.requests;
create policy "requests: buyer create"
on public.requests
for insert
to authenticated
with check (
  buyer_id::text = auth.uid()::text
  and status = 'pending'
);

-- Buyer may edit while pending (optional but matches your UI expectations).
drop policy if exists "requests: buyer edit pending" on public.requests;
create policy "requests: buyer edit pending"
on public.requests
for update
to authenticated
using (buyer_id::text = auth.uid()::text and status = 'pending')
with check (buyer_id::text = auth.uid()::text and status = 'pending');

-- Shopper may update after payment confirmed (keeps them from setting "paid")
drop policy if exists "requests: shopper progress post-pay" on public.requests;
create policy "requests: shopper progress post-pay"
on public.requests
for update
to authenticated
using (shopper_id::text = auth.uid()::text)
with check (
  shopper_id::text = auth.uid()::text
  and status in ('paid','purchased','delivering','delivered')
);

-- Admin update
drop policy if exists "requests: admin update" on public.requests;
create policy "requests: admin update"
on public.requests
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- MESSAGES RLS
alter table public.messages enable row level security;

drop policy if exists "messages: read participant" on public.messages;
create policy "messages: read participant"
on public.messages
for select
to authenticated
using (
  sender_id::text = auth.uid()::text
  or receiver_id::text = auth.uid()::text
  or public.is_admin()
);

drop policy if exists "messages: send as self" on public.messages;
create policy "messages: send as self"
on public.messages
for insert
to authenticated
with check (sender_id::text = auth.uid()::text);

drop policy if exists "messages: receiver mark read" on public.messages;
create policy "messages: receiver mark read"
on public.messages
for update
to authenticated
using (receiver_id::text = auth.uid()::text)
with check (receiver_id::text = auth.uid()::text);

-- REVIEWS RLS
alter table public.reviews enable row level security;

drop policy if exists "reviews: read all" on public.reviews;
create policy "reviews: read all"
on public.reviews
for select
to authenticated
using (true);

drop policy if exists "reviews: buyer create" on public.reviews;
create policy "reviews: buyer create"
on public.reviews
for insert
to authenticated
with check (buyer_id::text = auth.uid()::text);

drop policy if exists "reviews: admin update" on public.reviews;
create policy "reviews: admin update"
on public.reviews
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "reviews: admin delete" on public.reviews;
create policy "reviews: admin delete"
on public.reviews
for delete
to authenticated
using (public.is_admin());

-- BROADCASTS RLS (admin-only write; authenticated read optional)
alter table public.broadcasts enable row level security;

drop policy if exists "broadcasts: read all" on public.broadcasts;
create policy "broadcasts: read all"
on public.broadcasts
for select
to authenticated
using (true);

drop policy if exists "broadcasts: admin write" on public.broadcasts;
create policy "broadcasts: admin write"
on public.broadcasts
for insert
to authenticated
with check (public.is_admin());

drop policy if exists "broadcasts: admin update" on public.broadcasts;
create policy "broadcasts: admin update"
on public.broadcasts
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- PLATFORM SETTINGS RLS (admin-only)
alter table public.platform_settings enable row level security;

drop policy if exists "platform_settings: admin read" on public.platform_settings;
create policy "platform_settings: admin read"
on public.platform_settings
for select
to authenticated
using (public.is_admin());

drop policy if exists "platform_settings: admin update" on public.platform_settings;
create policy "platform_settings: admin update"
on public.platform_settings
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Done.

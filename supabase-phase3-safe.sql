-- BuyForMe Phase 3 — safe / idempotent (run in Supabase SQL Editor)
-- Run each section separately if you need to find which part fails.

-- ═══════════════════════════════════════════════════════════════
-- A) Prerequisites
-- ═══════════════════════════════════════════════════════════════
create extension if not exists "pgcrypto";

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

-- Quote columns on orders/requests
alter table public.requests add column if not exists quote_notes text;
alter table public.requests add column if not exists quoted_at timestamptz;
alter table public.requests add column if not exists request_type text default 'purchase';

-- ═══════════════════════════════════════════════════════════════
-- B) Request quote policies (shopper + buyer)
-- ═══════════════════════════════════════════════════════════════
alter table public.requests enable row level security;

drop policy if exists "requests: shopper quote pending" on public.requests;
create policy "requests: shopper quote pending"
on public.requests for update to authenticated
using (
  shopper_id::text = auth.uid()::text
  and status in ('pending', 'quoted')
)
with check (
  shopper_id::text = auth.uid()::text
  and status in ('pending', 'quoted', 'accepted', 'cancelled')
);

drop policy if exists "requests: buyer quote response" on public.requests;
create policy "requests: buyer quote response"
on public.requests for update to authenticated
using (
  buyer_id::text = auth.uid()::text
  and status = 'quoted'
)
with check (
  buyer_id::text = auth.uid()::text
  and status in ('accepted', 'cancelled')
);

-- ═══════════════════════════════════════════════════════════════
-- C) Wishlist (no FK — avoids users.uid constraint issues)
-- ═══════════════════════════════════════════════════════════════
create table if not exists public.wishlist_items (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null,
  shopper_id uuid,
  product_name text not null,
  store_name text,
  product_url text,
  quantity integer default 1,
  category text,
  notes text,
  budget numeric,
  currency text default 'USD',
  created_at timestamptz default now()
);

create index if not exists wishlist_buyer_idx on public.wishlist_items(buyer_id, created_at desc);

alter table public.wishlist_items enable row level security;

drop policy if exists "wishlist: buyer own" on public.wishlist_items;
drop policy if exists "wishlist: buyer select" on public.wishlist_items;
drop policy if exists "wishlist: buyer insert" on public.wishlist_items;
drop policy if exists "wishlist: buyer update" on public.wishlist_items;
drop policy if exists "wishlist: buyer delete" on public.wishlist_items;

create policy "wishlist: buyer select"
on public.wishlist_items for select to authenticated
using (buyer_id::text = auth.uid()::text or public.is_admin());

create policy "wishlist: buyer insert"
on public.wishlist_items for insert to authenticated
with check (buyer_id::text = auth.uid()::text or public.is_admin());

create policy "wishlist: buyer update"
on public.wishlist_items for update to authenticated
using (buyer_id::text = auth.uid()::text or public.is_admin())
with check (buyer_id::text = auth.uid()::text or public.is_admin());

create policy "wishlist: buyer delete"
on public.wishlist_items for delete to authenticated
using (buyer_id::text = auth.uid()::text or public.is_admin());

-- ═══════════════════════════════════════════════════════════════
-- D) Cart
-- ═══════════════════════════════════════════════════════════════
create table if not exists public.cart_items (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null,
  shopper_id uuid not null,
  shopper_name text,
  product_name text not null,
  store_name text,
  quantity integer default 1,
  category text,
  notes text,
  budget numeric,
  currency text default 'USD',
  address text,
  country text,
  phone text,
  timeline text,
  created_at timestamptz default now()
);

create index if not exists cart_buyer_idx on public.cart_items(buyer_id, created_at desc);
create index if not exists cart_shopper_idx on public.cart_items(buyer_id, shopper_id);

alter table public.cart_items enable row level security;

drop policy if exists "cart: buyer own" on public.cart_items;
drop policy if exists "cart: buyer select" on public.cart_items;
drop policy if exists "cart: buyer insert" on public.cart_items;
drop policy if exists "cart: buyer update" on public.cart_items;
drop policy if exists "cart: buyer delete" on public.cart_items;

create policy "cart: buyer select"
on public.cart_items for select to authenticated
using (buyer_id::text = auth.uid()::text or public.is_admin());

create policy "cart: buyer insert"
on public.cart_items for insert to authenticated
with check (buyer_id::text = auth.uid()::text or public.is_admin());

create policy "cart: buyer update"
on public.cart_items for update to authenticated
using (buyer_id::text = auth.uid()::text or public.is_admin())
with check (buyer_id::text = auth.uid()::text or public.is_admin());

create policy "cart: buyer delete"
on public.cart_items for delete to authenticated
using (buyer_id::text = auth.uid()::text or public.is_admin());

-- ═══════════════════════════════════════════════════════════════
-- E) Support tickets
-- ═══════════════════════════════════════════════════════════════
create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  user_name text,
  user_email text,
  subject text not null,
  body text not null,
  status text default 'open',
  priority text default 'normal',
  admin_notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists tickets_status_idx on public.support_tickets(status, created_at desc);
create index if not exists tickets_user_idx on public.support_tickets(user_id);

alter table public.support_tickets enable row level security;

drop policy if exists "tickets: user own" on public.support_tickets;
drop policy if exists "tickets: user create" on public.support_tickets;
drop policy if exists "tickets: admin update" on public.support_tickets;

create policy "tickets: user own"
on public.support_tickets for select to authenticated
using (user_id::text = auth.uid()::text or public.is_admin());

create policy "tickets: user create"
on public.support_tickets for insert to authenticated
with check (user_id::text = auth.uid()::text);

create policy "tickets: admin update"
on public.support_tickets for update to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Done.

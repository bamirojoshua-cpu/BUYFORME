-- BuyForMe Phase 4: shipment tracking + payment metadata
-- Run after supabase-phase3.sql

alter table public.requests add column if not exists tracking_number text;
alter table public.requests add column if not exists carrier text;
alter table public.requests add column if not exists estimated_delivery timestamptz;
alter table public.requests add column if not exists shipped_at timestamptz;
alter table public.requests add column if not exists payment_provider text; -- paystack | stripe

create index if not exists requests_tracking_idx on public.requests(tracking_number) where tracking_number is not null;

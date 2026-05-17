-- BMA - suivi paiement Djomi sans webhook dedie.
-- A executer dans Supabase SQL Editor avant de redeployer les fonctions Djomi.

alter table public.orders
add column if not exists djomi_transaction_id text;

alter table public.orders
add column if not exists djomi_merchant_reference text;

alter table public.orders
add column if not exists djomi_payment_status text;

alter table public.orders
add column if not exists djomi_paid_amount bigint;

alter table public.orders
add column if not exists djomi_received_amount bigint;

alter table public.orders
add column if not exists djomi_payment_method text;

alter table public.orders
add column if not exists djomi_provider_reference text;

alter table public.orders
add column if not exists djomi_payment_url text;

alter table public.orders
add column if not exists djomi_verified_at timestamptz;

alter table public.orders
add column if not exists payment_completed_at timestamptz;

create index if not exists idx_orders_djomi_transaction_id
on public.orders(djomi_transaction_id);

create index if not exists idx_orders_djomi_merchant_reference
on public.orders(djomi_merchant_reference);

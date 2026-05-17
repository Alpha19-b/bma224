-- Patch Supabase: produits réels + comptabilité générale
-- A exécuter dans Supabase > SQL Editor après le schéma principal.

alter table public.products
add column if not exists purchase_price bigint not null default 0
check (purchase_price >= 0);

alter table public.products
add column if not exists cost_price bigint not null default 0
check (cost_price >= 0);

alter table public.products
drop constraint if exists products_cost_price_check;

alter table public.products
add constraint products_cost_price_check
check (cost_price >= purchase_price)
not valid;

alter table public.products
validate constraint products_cost_price_check;

do $$
begin
  create type public.collection_method as enum (
    'cash',
    'djomi',
    'orange_money',
    'other'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.accounting_entries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete set null,
  order_number text,
  entry_date date not null default current_date,
  customer_name text,
  sale_amount bigint not null default 0 check (sale_amount >= 0),
  purchase_amount bigint not null default 0 check (purchase_amount >= 0),
  cost_amount bigint not null default 0 check (cost_amount >= 0),
  margin_amount bigint generated always as (sale_amount - cost_amount) stored,
  collection_method public.collection_method not null default 'cash',
  collected_by uuid references auth.users(id) on delete set null,
  collected_by_name text,
  collected_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orange_money_deposits (
  id uuid primary key default gen_random_uuid(),
  amount bigint not null check (amount > 0),
  deposited_by uuid references auth.users(id) on delete set null,
  deposited_by_name text not null,
  orange_money_reference text not null unique,
  receipt_url text,
  receipt_file_name text,
  deposited_at timestamptz not null default now(),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.orange_money_deposits
add column if not exists receipt_url text;

alter table public.orange_money_deposits
add column if not exists receipt_file_name text;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'orange-money-receipts',
  'orange-money-receipts',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Admins can read orange money receipts" on storage.objects;
create policy "Admins can read orange money receipts"
on storage.objects for select
to authenticated
using (
  bucket_id = 'orange-money-receipts'
  and public.is_admin()
);

drop policy if exists "Admins can upload orange money receipts" on storage.objects;
create policy "Admins can upload orange money receipts"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'orange-money-receipts'
  and public.is_admin()
);

drop policy if exists "Owners can delete orange money receipts" on storage.objects;
create policy "Owners can delete orange money receipts"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'orange-money-receipts'
  and public.is_owner()
);

create table if not exists public.orange_money_deposit_items (
  id uuid primary key default gen_random_uuid(),
  deposit_id uuid not null references public.orange_money_deposits(id) on delete cascade,
  accounting_entry_id uuid not null references public.accounting_entries(id) on delete cascade,
  amount bigint not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (deposit_id, accounting_entry_id)
);

create index if not exists idx_accounting_entries_order_id
on public.accounting_entries(order_id);

create index if not exists idx_accounting_entries_entry_date
on public.accounting_entries(entry_date);

create index if not exists idx_orange_money_deposits_deposited_at
on public.orange_money_deposits(deposited_at);

create index if not exists idx_orange_money_deposit_items_deposit_id
on public.orange_money_deposit_items(deposit_id);

alter table public.accounting_entries enable row level security;
alter table public.orange_money_deposits enable row level security;
alter table public.orange_money_deposit_items enable row level security;

drop trigger if exists set_accounting_entries_updated_at on public.accounting_entries;
create trigger set_accounting_entries_updated_at
before update on public.accounting_entries
for each row execute function public.set_updated_at();

drop trigger if exists set_orange_money_deposits_updated_at on public.orange_money_deposits;
create trigger set_orange_money_deposits_updated_at
before update on public.orange_money_deposits
for each row execute function public.set_updated_at();

drop policy if exists "Admins can manage accounting entries" on public.accounting_entries;
create policy "Admins can manage accounting entries"
on public.accounting_entries for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Admins can manage orange money deposits" on public.orange_money_deposits;
create policy "Admins can manage orange money deposits"
on public.orange_money_deposits for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Admins can manage orange money deposit items" on public.orange_money_deposit_items;
create policy "Admins can manage orange money deposit items"
on public.orange_money_deposit_items for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

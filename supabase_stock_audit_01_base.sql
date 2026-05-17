-- BMA stock/audit - Bloc 1/4 : base, colonnes et securite.
-- Execute ce bloc seul, puis passe au bloc 2.

create or replace function public.current_actor_label()
returns text
language sql
stable
as $bma_actor$
  select coalesce(auth.jwt() ->> 'email', auth.uid()::text, 'system');
$bma_actor$;

do $bma_enum$
begin
  create type public.collection_method as enum (
    'cash',
    'djomi',
    'orange_money',
    'other'
  );
exception when duplicate_object then null;
end $bma_enum$;

alter table public.order_items
add column if not exists selected_size text;

alter table public.order_items
add column if not exists selected_color text;

alter table public.orders
add column if not exists stock_reserved_at timestamptz;

alter table public.orders
add column if not exists stock_released_at timestamptz;

alter table public.accounting_entries
add column if not exists product_id uuid references public.products(id) on delete set null;

alter table public.accounting_entries
add column if not exists quantity integer not null default 1 check (quantity > 0);

alter table public.accounting_entries
add column if not exists source text not null default 'manual';

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  quantity_delta integer not null,
  stock_before integer not null,
  stock_after integer not null,
  reason text not null,
  reference_type text,
  reference_id text,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now()
);

alter table public.stock_movements
add column if not exists product_id uuid references public.products(id) on delete cascade;

alter table public.stock_movements
add column if not exists quantity_delta integer not null default 0;

alter table public.stock_movements
add column if not exists stock_before integer not null default 0;

alter table public.stock_movements
add column if not exists stock_after integer not null default 0;

alter table public.stock_movements
add column if not exists reason text not null default 'adjustment';

alter table public.stock_movements
add column if not exists reference_type text;

alter table public.stock_movements
add column if not exists reference_id text;

alter table public.stock_movements
add column if not exists note text;

alter table public.stock_movements
add column if not exists created_by uuid references auth.users(id) on delete set null;

alter table public.stock_movements
add column if not exists created_by_name text;

alter table public.stock_movements
add column if not exists created_at timestamptz not null default now();

do $bma_legacy_stock_fix$
declare
  v_column record;
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'stock_movements'
      and column_name = 'quantity_change'
  ) then
    execute 'alter table public.stock_movements alter column quantity_change set default 0';
    execute 'update public.stock_movements set quantity_change = 0 where quantity_change is null';
    execute 'alter table public.stock_movements alter column quantity_change drop not null';
    execute 'update public.stock_movements set quantity_delta = quantity_change where quantity_delta is null';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'stock_movements'
      and column_name = 'movement_type'
  ) then
    execute 'alter table public.stock_movements alter column movement_type drop not null';
  end if;

  for v_column in
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'stock_movements'
      and is_nullable = 'NO'
      and column_name <> 'id'
  loop
    execute format(
      'alter table public.stock_movements alter column %I drop not null',
      v_column.column_name
    );
  end loop;
end;
$bma_legacy_stock_fix$;

create index if not exists idx_stock_movements_product_id
on public.stock_movements(product_id);

create index if not exists idx_stock_movements_created_at
on public.stock_movements(created_at desc);

alter table public.stock_movements enable row level security;

drop policy if exists "Admins can read stock movements" on public.stock_movements;
create policy "Admins can read stock movements"
on public.stock_movements for select
to authenticated
using (public.is_admin());

drop policy if exists "Admins can manage stock movements" on public.stock_movements;
create policy "Admins can manage stock movements"
on public.stock_movements for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

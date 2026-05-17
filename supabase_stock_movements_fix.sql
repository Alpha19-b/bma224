-- Correctif BMA : met a niveau une table stock_movements deja existante.
-- A executer une seule fois si tu vois :
-- column "quantity_delta" of relation "stock_movements" does not exist

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

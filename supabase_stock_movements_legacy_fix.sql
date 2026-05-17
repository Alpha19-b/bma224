-- Correctif BMA : compatibilite avec une ancienne table stock_movements.
-- A executer si tu vois une erreur du type :
-- null value in column "quantity_change" of relation "stock_movements"

alter table public.stock_movements
add column if not exists product_id uuid references public.products(id) on delete cascade;

alter table public.stock_movements
add column if not exists quantity_delta integer default 0;

alter table public.stock_movements
add column if not exists stock_before integer default 0;

alter table public.stock_movements
add column if not exists stock_after integer default 0;

alter table public.stock_movements
add column if not exists reason text default 'adjustment';

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
add column if not exists created_at timestamptz default now();

do $bma_legacy_stock$
declare
  v_column record;
begin
  -- Les anciennes versions peuvent avoir des colonnes NOT NULL que la nouvelle
  -- fonction ne remplit pas. On les rend compatibles sans supprimer de donnees.
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
$bma_legacy_stock$;

create index if not exists idx_stock_movements_product_id
on public.stock_movements(product_id);

create index if not exists idx_stock_movements_created_at
on public.stock_movements(created_at desc);

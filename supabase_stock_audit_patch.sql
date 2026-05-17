-- BMA - stock automatique + audit argent/produits.
-- A executer dans Supabase SQL Editor apres les scripts deja appliques.

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

create or replace function public._apply_stock_delta(
  p_product_id uuid,
  p_quantity_delta integer,
  p_reason text,
  p_reference_type text default null,
  p_reference_id text default null,
  p_note text default null
)
returns table(product_id uuid, next_stock integer)
language plpgsql
security definer
set search_path = public
as $bma_apply_stock$
declare
  v_stock_before integer;
  v_stock_after integer;
begin
  if p_product_id is null then
    raise exception 'Produit obligatoire pour ajuster le stock.';
  end if;

  if p_quantity_delta = 0 then
    select stock
    into v_stock_before
    from public.products
    where id = p_product_id;

    return query select p_product_id, coalesce(v_stock_before, 0);
    return;
  end if;

  select stock
  into v_stock_before
  from public.products
  where id = p_product_id
  for update;

  if not found then
    raise exception 'Produit introuvable.';
  end if;

  v_stock_after := v_stock_before + p_quantity_delta;

  if v_stock_after < 0 then
    raise exception 'Stock insuffisant. Stock actuel: %, demande: %',
      v_stock_before,
      abs(p_quantity_delta);
  end if;

  update public.products
  set stock = v_stock_after
  where id = p_product_id;

  insert into public.stock_movements (
    product_id,
    quantity_delta,
    stock_before,
    stock_after,
    reason,
    reference_type,
    reference_id,
    note,
    created_by,
    created_by_name
  )
  values (
    p_product_id,
    p_quantity_delta,
    v_stock_before,
    v_stock_after,
    p_reason,
    p_reference_type,
    p_reference_id,
    p_note,
    auth.uid(),
    public.current_actor_label()
  );

  return query select p_product_id, v_stock_after;
end;
$bma_apply_stock$;

create or replace function public.adjust_product_stock(
  p_product_id uuid,
  p_quantity_delta integer,
  p_reason text default 'adjustment',
  p_reference_type text default null,
  p_reference_id text default null,
  p_note text default null
)
returns table(product_id uuid, next_stock integer)
language plpgsql
security definer
set search_path = public
as $bma_adjust_stock$
begin
  if not public.is_admin() then
    raise exception 'Acces refuse: seul un membre interne peut ajuster le stock.';
  end if;

  return query
  select *
  from public._apply_stock_delta(
    p_product_id,
    p_quantity_delta,
    p_reason,
    p_reference_type,
    p_reference_id,
    p_note
  );
end;
$bma_adjust_stock$;

create or replace function public.record_manual_sale(
  p_product_id uuid,
  p_quantity integer,
  p_order_number text,
  p_entry_date date,
  p_customer_name text,
  p_sale_amount bigint,
  p_purchase_amount bigint,
  p_cost_amount bigint,
  p_collection_method public.collection_method,
  p_collected_by_name text default null,
  p_note text default null
)
returns public.accounting_entries
language plpgsql
security definer
set search_path = public
as $bma_manual_sale$
declare
  v_entry public.accounting_entries;
  v_quantity integer := greatest(1, coalesce(p_quantity, 1));
begin
  if not public.is_admin() then
    raise exception 'Acces refuse: seul un membre interne peut enregistrer une vente.';
  end if;

  insert into public.accounting_entries (
    order_number,
    product_id,
    quantity,
    entry_date,
    customer_name,
    sale_amount,
    purchase_amount,
    cost_amount,
    collection_method,
    collected_by,
    collected_by_name,
    collected_at,
    note,
    source
  )
  values (
    p_order_number,
    p_product_id,
    v_quantity,
    coalesce(p_entry_date, current_date),
    p_customer_name,
    greatest(0, coalesce(p_sale_amount, 0)),
    greatest(0, coalesce(p_purchase_amount, 0)),
    greatest(0, coalesce(p_cost_amount, 0)),
    coalesce(p_collection_method, 'other'),
    auth.uid(),
    coalesce(nullif(p_collected_by_name, ''), public.current_actor_label()),
    now(),
    p_note,
    'manual'
  )
  returning * into v_entry;

  if p_product_id is not null then
    perform public._apply_stock_delta(
      p_product_id,
      -v_quantity,
      'manual_sale',
      'accounting_entry',
      v_entry.id::text,
      coalesce(p_order_number, p_note)
    );
  end if;

  return v_entry;
end;
$bma_manual_sale$;

create or replace function public.reserve_order_item_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $bma_reserve_order_stock$
declare
  v_order_status text;
begin
  select order_status::text
  into v_order_status
  from public.orders
  where id = new.order_id;

  if v_order_status = 'cancelled' then
    return new;
  end if;

  perform public._apply_stock_delta(
    new.product_id,
    -new.quantity,
    'site_order',
    'order',
    new.order_id::text,
    concat_ws(' - ', new.product_name_snapshot, new.selected_size, new.selected_color)
  );

  update public.orders
  set stock_reserved_at = coalesce(stock_reserved_at, now())
  where id = new.order_id;

  return new;
end;
$bma_reserve_order_stock$;

create or replace function public.adjust_order_item_stock_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $bma_adjust_order_stock$
declare
  v_released_at timestamptz;
begin
  select stock_released_at
  into v_released_at
  from public.orders
  where id = new.order_id;

  if v_released_at is not null then
    return new;
  end if;

  if old.product_id = new.product_id then
    perform public._apply_stock_delta(
      new.product_id,
      old.quantity - new.quantity,
      'order_item_update',
      'order',
      new.order_id::text,
      new.product_name_snapshot
    );
  else
    perform public._apply_stock_delta(
      old.product_id,
      old.quantity,
      'order_item_product_changed_restore',
      'order',
      old.order_id::text,
      old.product_name_snapshot
    );

    perform public._apply_stock_delta(
      new.product_id,
      -new.quantity,
      'order_item_product_changed_reserve',
      'order',
      new.order_id::text,
      new.product_name_snapshot
    );
  end if;

  return new;
end;
$bma_adjust_order_stock$;

create or replace function public.restore_order_item_stock_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $bma_restore_delete_stock$
declare
  v_released_at timestamptz;
begin
  select stock_released_at
  into v_released_at
  from public.orders
  where id = old.order_id;

  if v_released_at is null then
    perform public._apply_stock_delta(
      old.product_id,
      old.quantity,
      'order_item_deleted',
      'order',
      old.order_id::text,
      old.product_name_snapshot
    );
  end if;

  return old;
end;
$bma_restore_delete_stock$;

create or replace function public.restore_cancelled_order_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $bma_restore_cancel_stock$
declare
  v_item record;
begin
  if new.order_status::text = 'cancelled'
    and old.order_status::text is distinct from 'cancelled'
    and old.stock_released_at is null
  then
    for v_item in
      select product_id, quantity, product_name_snapshot
      from public.order_items
      where order_id = new.id
    loop
      perform public._apply_stock_delta(
        v_item.product_id,
        v_item.quantity,
        'order_cancelled',
        'order',
        new.id::text,
        v_item.product_name_snapshot
      );
    end loop;

    new.stock_released_at := now();
  end if;

  return new;
end;
$bma_restore_cancel_stock$;

drop trigger if exists reserve_order_item_stock on public.order_items;
create trigger reserve_order_item_stock
after insert on public.order_items
for each row execute function public.reserve_order_item_stock();

drop trigger if exists adjust_order_item_stock_update on public.order_items;
create trigger adjust_order_item_stock_update
after update of product_id, quantity on public.order_items
for each row execute function public.adjust_order_item_stock_update();

drop trigger if exists restore_order_item_stock_delete on public.order_items;
create trigger restore_order_item_stock_delete
after delete on public.order_items
for each row execute function public.restore_order_item_stock_delete();

drop trigger if exists restore_cancelled_order_stock on public.orders;
create trigger restore_cancelled_order_stock
before update of order_status on public.orders
for each row execute function public.restore_cancelled_order_stock();

grant execute on function public.adjust_product_stock(uuid, integer, text, text, text, text)
to authenticated;

grant execute on function public.record_manual_sale(
  uuid,
  integer,
  text,
  date,
  text,
  bigint,
  bigint,
  bigint,
  public.collection_method,
  text,
  text
)
to authenticated;

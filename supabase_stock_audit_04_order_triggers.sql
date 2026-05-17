-- BMA stock/audit - Bloc 4/4 : commandes site et restauration en cas d'annulation.
-- Execute ce bloc seul apres le bloc 3.

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

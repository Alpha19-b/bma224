-- BMA - photos et tailles par couleur.
-- A executer dans Supabase SQL Editor avant d'utiliser les variantes couleur.

alter table public.product_images
add column if not exists color_value text;

alter table public.product_images
add column if not exists sort_order integer not null default 0;

create index if not exists idx_product_images_product_color
on public.product_images(product_id, color_value, sort_order);

alter table public.product_options
add column if not exists parent_value text;

alter table public.product_options
add column if not exists sort_order integer not null default 0;

alter table public.product_options
add column if not exists stock_quantity integer check (stock_quantity is null or stock_quantity >= 0);

do $bma_variant_constraints$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.product_options'::regclass
      and conname = 'product_options_product_id_option_type_value_key'
  ) then
    alter table public.product_options
    drop constraint product_options_product_id_option_type_value_key;
  end if;
end;
$bma_variant_constraints$;

delete from public.product_options a
using public.product_options b
where a.ctid < b.ctid
  and a.product_id = b.product_id
  and a.option_type = b.option_type
  and coalesce(a.parent_value, '') = coalesce(b.parent_value, '')
  and a.value = b.value;

create unique index if not exists uq_product_options_product_type_parent_value
on public.product_options(product_id, option_type, coalesce(parent_value, ''), value);

create index if not exists idx_product_options_product_parent
on public.product_options(product_id, option_type, parent_value, sort_order);

create or replace function public.bma_variant_key(p_value text)
returns text
language sql
immutable
as $bma_variant_key$
  select lower(trim(coalesce(p_value, '')));
$bma_variant_key$;

create or replace function public.bma_replace_product_options(
  p_product_id uuid,
  p_sizes jsonb default '[]'::jsonb,
  p_colors jsonb default '[]'::jsonb,
  p_sizes_by_color jsonb default '{}'::jsonb,
  p_stock_by_color jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $bma_replace_product_options$
declare
  v_size text;
  v_color jsonb;
  v_color_value text;
  v_color_key text;
  v_hex text;
  v_stock_quantity integer;
  v_index integer := 0;
  v_color_index integer := 0;
  v_size_index integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Acces refuse: seul un membre interne peut modifier les options produit.';
  end if;

  delete from public.product_options
  where product_id = p_product_id;

  v_index := 0;
  for v_size in
    select distinct trim(item.value)
    from jsonb_array_elements_text(coalesce(p_sizes, '[]'::jsonb)) as item(value)
    where trim(item.value) <> ''
  loop
    insert into public.product_options (
      product_id,
      option_type,
      value,
      parent_value,
      sort_order,
      is_active
    )
    values (
      p_product_id,
      'size',
      v_size,
      null,
      v_index,
      true
    )
    on conflict do nothing;

    v_index := v_index + 1;
  end loop;

  v_index := 0;
  for v_color in
    select item.value
    from jsonb_array_elements(coalesce(p_colors, '[]'::jsonb)) as item(value)
  loop
    v_color_value := nullif(trim(coalesce(v_color ->> 'value', '')), '');
    v_hex := nullif(trim(coalesce(v_color ->> 'hex', '')), '');

    if v_color_value is not null then
      v_stock_quantity := null;

      if coalesce(p_stock_by_color, '{}'::jsonb) ? public.bma_variant_key(v_color_value) then
        v_stock_quantity := nullif(p_stock_by_color ->> public.bma_variant_key(v_color_value), '')::integer;
      elsif coalesce(p_stock_by_color, '{}'::jsonb) ? v_color_value then
        v_stock_quantity := nullif(p_stock_by_color ->> v_color_value, '')::integer;
      end if;

      insert into public.product_options (
        product_id,
        option_type,
        value,
        hex_color,
        stock_quantity,
        parent_value,
        sort_order,
        is_active
      )
      values (
        p_product_id,
        'color',
        v_color_value,
        v_hex,
        v_stock_quantity,
        null,
        v_index,
        true
      )
      on conflict do nothing;

      v_index := v_index + 1;
    end if;
  end loop;

  v_color_index := 0;
  for v_color_key in
    select item.key
    from jsonb_object_keys(coalesce(p_sizes_by_color, '{}'::jsonb)) as item(key)
  loop
    v_size_index := 0;

    for v_size in
      select distinct trim(item.value)
      from jsonb_array_elements_text(coalesce(p_sizes_by_color -> v_color_key, '[]'::jsonb)) as item(value)
      where trim(item.value) <> ''
    loop
      insert into public.product_options (
        product_id,
        option_type,
        value,
        parent_value,
        sort_order,
        is_active
      )
      values (
        p_product_id,
        'size',
        v_size,
        v_color_key,
        1000 + (v_color_index * 100) + v_size_index,
        true
      )
      on conflict do nothing;

      v_size_index := v_size_index + 1;
    end loop;

    v_color_index := v_color_index + 1;
  end loop;
end;
$bma_replace_product_options$;

create or replace function public.bma_replace_product_images(
  p_product_id uuid,
  p_images jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $bma_replace_product_images$
declare
  v_image jsonb;
  v_image_url text;
  v_color_value text;
  v_index integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Acces refuse: seul un membre interne peut modifier les photos produit.';
  end if;

  delete from public.product_images
  where product_id = p_product_id;

  for v_image in
    select item.value
    from jsonb_array_elements(coalesce(p_images, '[]'::jsonb)) as item(value)
  loop
    v_image_url := nullif(trim(coalesce(v_image ->> 'imageUrl', v_image ->> 'image_url', '')), '');
    v_color_value := nullif(trim(coalesce(v_image ->> 'color', v_image ->> 'color_value', '')), '');

    if v_image_url is not null then
      insert into public.product_images (
        product_id,
        image_url,
        color_value,
        sort_order
      )
      values (
        p_product_id,
        v_image_url,
        v_color_value,
        v_index
      );

      v_index := v_index + 1;
    end if;
  end loop;
end;
$bma_replace_product_images$;

grant execute on function public.bma_replace_product_options(uuid, jsonb, jsonb, jsonb, jsonb)
to authenticated;

grant execute on function public.bma_replace_product_images(uuid, jsonb)
to authenticated;

create or replace function public.bma_apply_color_stock_delta(
  p_product_id uuid,
  p_color_value text,
  p_quantity_delta integer
)
returns void
language plpgsql
security definer
set search_path = public
as $bma_apply_color_stock_delta$
declare
  v_option_id uuid;
  v_stock_before integer;
  v_stock_after integer;
begin
  if p_product_id is null
    or nullif(trim(coalesce(p_color_value, '')), '') is null
    or coalesce(p_quantity_delta, 0) = 0
  then
    return;
  end if;

  select id, stock_quantity
  into v_option_id, v_stock_before
  from public.product_options
  where product_id = p_product_id
    and option_type = 'color'
    and public.bma_variant_key(value) = public.bma_variant_key(p_color_value)
  order by sort_order asc
  limit 1
  for update;

  if v_option_id is null or v_stock_before is null then
    return;
  end if;

  v_stock_after := v_stock_before + p_quantity_delta;

  if v_stock_after < 0 then
    raise exception 'Stock couleur insuffisant pour %. Stock actuel: %, demande: %',
      p_color_value,
      v_stock_before,
      abs(p_quantity_delta);
  end if;

  update public.product_options
  set stock_quantity = v_stock_after
  where id = v_option_id;
end;
$bma_apply_color_stock_delta$;

create or replace function public.adjust_product_color_stock(
  p_product_id uuid,
  p_color_value text,
  p_quantity_delta integer,
  p_reason text default 'adjustment',
  p_reference_type text default null,
  p_reference_id text default null,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $bma_adjust_product_color_stock$
begin
  if not public.is_admin() then
    raise exception 'Acces refuse: seul un membre interne peut ajuster le stock couleur.';
  end if;

  perform public.bma_apply_color_stock_delta(
    p_product_id,
    p_color_value,
    p_quantity_delta
  );
end;
$bma_adjust_product_color_stock$;

grant execute on function public.adjust_product_color_stock(
  uuid,
  text,
  integer,
  text,
  text,
  text,
  text
)
to authenticated;

create or replace function public.bma_reserve_order_item_color_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $bma_reserve_order_item_color_stock$
begin
  perform public.bma_apply_color_stock_delta(
    new.product_id,
    new.selected_color,
    -greatest(1, coalesce(new.quantity, 1))
  );

  return new;
end;
$bma_reserve_order_item_color_stock$;

drop trigger if exists bma_reserve_order_item_color_stock on public.order_items;
create trigger bma_reserve_order_item_color_stock
after insert on public.order_items
for each row execute function public.bma_reserve_order_item_color_stock();

create or replace function public.bma_adjust_order_item_color_stock_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $bma_adjust_order_item_color_stock_update$
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

  perform public.bma_apply_color_stock_delta(
    old.product_id,
    old.selected_color,
    greatest(1, coalesce(old.quantity, 1))
  );

  perform public.bma_apply_color_stock_delta(
    new.product_id,
    new.selected_color,
    -greatest(1, coalesce(new.quantity, 1))
  );

  return new;
end;
$bma_adjust_order_item_color_stock_update$;

drop trigger if exists bma_adjust_order_item_color_stock_update on public.order_items;
create trigger bma_adjust_order_item_color_stock_update
after update of product_id, quantity, selected_color on public.order_items
for each row execute function public.bma_adjust_order_item_color_stock_update();

create or replace function public.bma_restore_order_item_color_stock_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $bma_restore_order_item_color_stock_delete$
declare
  v_released_at timestamptz;
begin
  select stock_released_at
  into v_released_at
  from public.orders
  where id = old.order_id;

  if v_released_at is null then
    perform public.bma_apply_color_stock_delta(
      old.product_id,
      old.selected_color,
      greatest(1, coalesce(old.quantity, 1))
    );
  end if;

  return old;
end;
$bma_restore_order_item_color_stock_delete$;

drop trigger if exists bma_restore_order_item_color_stock_delete on public.order_items;
create trigger bma_restore_order_item_color_stock_delete
after delete on public.order_items
for each row execute function public.bma_restore_order_item_color_stock_delete();

create or replace function public.bma_restore_cancelled_order_color_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $bma_restore_cancelled_order_color_stock$
declare
  v_item record;
begin
  if new.order_status::text = 'cancelled'
    and old.order_status::text is distinct from 'cancelled'
    and old.stock_released_at is null
  then
    for v_item in
      select product_id, selected_color, quantity
      from public.order_items
      where order_id = new.id
    loop
      perform public.bma_apply_color_stock_delta(
        v_item.product_id,
        v_item.selected_color,
        greatest(1, coalesce(v_item.quantity, 1))
      );
    end loop;
  end if;

  return new;
end;
$bma_restore_cancelled_order_color_stock$;

drop trigger if exists bma_restore_cancelled_order_color_stock on public.orders;
create trigger bma_restore_cancelled_order_color_stock
before update of order_status on public.orders
for each row execute function public.bma_restore_cancelled_order_color_stock();

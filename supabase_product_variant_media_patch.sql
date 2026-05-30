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

create or replace function public.bma_replace_product_options(
  p_product_id uuid,
  p_sizes jsonb default '[]'::jsonb,
  p_colors jsonb default '[]'::jsonb,
  p_sizes_by_color jsonb default '{}'::jsonb
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
      insert into public.product_options (
        product_id,
        option_type,
        value,
        hex_color,
        parent_value,
        sort_order,
        is_active
      )
      values (
        p_product_id,
        'color',
        v_color_value,
        v_hex,
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

grant execute on function public.bma_replace_product_options(uuid, jsonb, jsonb, jsonb)
to authenticated;

grant execute on function public.bma_replace_product_images(uuid, jsonb)
to authenticated;

-- BMA - photos et tailles par couleur.
-- A executer dans Supabase SQL Editor avant d'utiliser les variantes couleur.

alter table public.product_images
add column if not exists color_value text;

create index if not exists idx_product_images_product_color
on public.product_images(product_id, color_value, sort_order);

alter table public.product_options
add column if not exists parent_value text;

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

create unique index if not exists uq_product_options_product_type_parent_value
on public.product_options(product_id, option_type, coalesce(parent_value, ''), value);

create index if not exists idx_product_options_product_parent
on public.product_options(product_id, option_type, parent_value, sort_order);

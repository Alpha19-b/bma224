-- BMA - correction suppression article owner-only.
-- A executer dans Supabase SQL Editor si tu vois:
-- column reference "product_id" is ambiguous

drop function if exists public.bma_delete_product(uuid);

create or replace function public.bma_delete_product(p_product_id uuid)
returns table (
  deleted_product_id uuid,
  deleted_mode text
)
language plpgsql
security definer
set search_path = public
as $bma_delete_product$
begin
  if not public.bma_is_owner() then
    raise exception 'Acces refuse: seul le super admin peut supprimer un article.';
  end if;

  update public.products p
  set
    is_active = false,
    stock = 0
  where p.id = p_product_id;

  if not found then
    raise exception 'Article introuvable.';
  end if;

  if to_regclass('public.product_options') is not null then
    update public.product_options po
    set is_active = false
    where po.product_id = p_product_id;
  end if;

  return query select p_product_id, 'retired_from_sale'::text;
end;
$bma_delete_product$;

grant execute on function public.bma_delete_product(uuid)
to authenticated;

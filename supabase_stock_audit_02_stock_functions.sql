-- BMA stock/audit - Bloc 2/4 : fonctions de stock.
-- Execute ce bloc seul apres le bloc 1.

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

grant execute on function public.adjust_product_stock(uuid, integer, text, text, text, text)
to authenticated;

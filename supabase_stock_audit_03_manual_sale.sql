-- BMA stock/audit - Bloc 3/4 : vente manuelle avec baisse automatique du stock.
-- Execute ce bloc seul apres le bloc 2.

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

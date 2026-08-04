-- BMA - ventes manuelles idempotentes et restauration atomique du stock.
-- A executer une seule fois dans Supabase SQL Editor.

alter table public.accounting_entries
add column if not exists request_key text;

create unique index if not exists uq_accounting_entries_request_key
on public.accounting_entries(request_key)
where request_key is not null;

create table if not exists public.accounting_sale_items (
  id uuid primary key default gen_random_uuid(),
  accounting_entry_id uuid not null references public.accounting_entries(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  selected_color text,
  selected_size text,
  created_at timestamptz not null default now()
);

create index if not exists idx_accounting_sale_items_entry
on public.accounting_sale_items(accounting_entry_id);

alter table public.accounting_sale_items enable row level security;

drop policy if exists "Internal users can read accounting sale items"
on public.accounting_sale_items;

create policy "Internal users can read accounting sale items"
on public.accounting_sale_items for select
to authenticated
using (public.is_admin());

create or replace function public.record_manual_sale_v2(
  p_request_key text,
  p_items jsonb,
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
as $bma_record_manual_sale_v2$
declare
  v_entry public.accounting_entries;
  v_item jsonb;
  v_product_id uuid;
  v_quantity integer;
  v_color text;
  v_size text;
  v_total_quantity integer := 0;
  v_single_product_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Acces refuse: seul un membre interne peut enregistrer une vente.';
  end if;

  if nullif(trim(coalesce(p_request_key, '')), '') is null then
    raise exception 'Identifiant de vente manquant.';
  end if;

  select ae.*
  into v_entry
  from public.accounting_entries ae
  where ae.request_key = p_request_key;

  if found then
    return v_entry;
  end if;

  select
    coalesce(sum(greatest(1, coalesce((item.value ->> 'quantity')::integer, 1))), 0)::integer,
    case
      when count(distinct item.value ->> 'product_id') = 1
      then min(item.value ->> 'product_id')::uuid
      else null
    end
  into v_total_quantity, v_single_product_id
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as item(value)
  where nullif(item.value ->> 'product_id', '') is not null;

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
    source,
    request_key
  )
  values (
    p_order_number,
    v_single_product_id,
    greatest(1, v_total_quantity),
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
    'manual',
    p_request_key
  )
  returning * into v_entry;

  for v_item in
    select item.value
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as item(value)
  loop
    v_product_id := nullif(v_item ->> 'product_id', '')::uuid;
    v_quantity := greatest(1, coalesce((v_item ->> 'quantity')::integer, 1));
    v_color := nullif(trim(coalesce(v_item ->> 'color', '')), '');
    v_size := nullif(trim(coalesce(v_item ->> 'size', '')), '');

    if v_product_id is null then
      raise exception 'Produit manquant dans la vente.';
    end if;

    perform public._apply_stock_delta(
      v_product_id,
      -v_quantity,
      'manual_sale',
      'accounting_entry',
      v_entry.id::text,
      p_note
    );

    if v_color is not null
      and to_regprocedure('public.bma_apply_color_stock_delta(uuid,text,integer)') is not null
    then
      perform public.bma_apply_color_stock_delta(v_product_id, v_color, -v_quantity);
    end if;

    if v_color is not null
      and v_size is not null
      and to_regprocedure('public.bma_apply_variant_stock_delta(uuid,text,text,integer)') is not null
    then
      perform public.bma_apply_variant_stock_delta(v_product_id, v_color, v_size, -v_quantity);
    end if;

    insert into public.accounting_sale_items (
      accounting_entry_id,
      product_id,
      quantity,
      selected_color,
      selected_size
    )
    values (
      v_entry.id,
      v_product_id,
      v_quantity,
      v_color,
      v_size
    );
  end loop;

  return v_entry;
exception
  when unique_violation then
    select ae.*
    into v_entry
    from public.accounting_entries ae
    where ae.request_key = p_request_key;

    if not found then
      raise;
    end if;

    return v_entry;
end;
$bma_record_manual_sale_v2$;

drop function if exists public.bma_delete_accounting_entry(uuid);

create or replace function public.bma_delete_accounting_entry(p_entry_id uuid)
returns table (
  accounting_entry_id uuid,
  restored_stock boolean
)
language plpgsql
security definer
set search_path = public
as $bma_delete_accounting_entry$
declare
  v_entry public.accounting_entries;
  v_item record;
  v_movement record;
  v_restored boolean := false;
  v_has_saved_items boolean := false;
  v_deleted_deposit_ids uuid[];
begin
  if not public.bma_is_owner() then
    raise exception 'Acces refuse: seul le super admin peut supprimer une ligne comptable.';
  end if;

  select ae.*
  into v_entry
  from public.accounting_entries ae
  where ae.id = p_entry_id
  for update;

  if not found then
    raise exception 'Ligne comptable introuvable.';
  end if;

  if to_regclass('public.orange_money_deposit_items') is not null then
    with deleted_items as (
      delete from public.orange_money_deposit_items odi
      where odi.accounting_entry_id = p_entry_id
      returning deposit_id
    )
    select array_agg(deposit_id)
    into v_deleted_deposit_ids
    from deleted_items;

    if to_regclass('public.orange_money_deposits') is not null then
      delete from public.orange_money_deposits d
      where d.id = any(coalesce(v_deleted_deposit_ids, array[]::uuid[]))
        and not exists (
          select 1
          from public.orange_money_deposit_items odi
          where odi.deposit_id = d.id
        );
    end if;
  end if;

  for v_item in
    select asi.product_id, asi.quantity, asi.selected_color, asi.selected_size
    from public.accounting_sale_items asi
    where asi.accounting_entry_id = p_entry_id
  loop
    v_has_saved_items := true;

    perform public._apply_stock_delta(
      v_item.product_id,
      v_item.quantity,
      'owner_deleted_manual_sale',
      'accounting_entry',
      p_entry_id::text,
      v_entry.order_number
    );

    if v_item.selected_color is not null
      and to_regprocedure('public.bma_apply_color_stock_delta(uuid,text,integer)') is not null
    then
      perform public.bma_apply_color_stock_delta(
        v_item.product_id,
        v_item.selected_color,
        v_item.quantity
      );
    end if;

    if v_item.selected_color is not null
      and v_item.selected_size is not null
      and to_regprocedure('public.bma_apply_variant_stock_delta(uuid,text,text,integer)') is not null
    then
      perform public.bma_apply_variant_stock_delta(
        v_item.product_id,
        v_item.selected_color,
        v_item.selected_size,
        v_item.quantity
      );
    end if;

    v_restored := true;
  end loop;

  -- Compatibilite avec les ventes creees avant cette mise a niveau.
  if not v_has_saved_items then
    for v_movement in
      select sm.product_id, abs(sum(sm.quantity_delta))::integer as quantity
      from public.stock_movements sm
      where sm.reference_type = 'accounting_entry'
        and sm.reference_id = p_entry_id::text
        and sm.reason = 'manual_sale'
        and sm.quantity_delta < 0
      group by sm.product_id
    loop
      perform public._apply_stock_delta(
        v_movement.product_id,
        v_movement.quantity,
        'owner_deleted_manual_sale',
        'accounting_entry',
        p_entry_id::text,
        v_entry.order_number
      );
      v_restored := true;
    end loop;

    if not v_restored
      and coalesce(v_entry.source, 'manual') = 'manual'
      and v_entry.product_id is not null
      and coalesce(v_entry.quantity, 0) > 0
    then
      perform public._apply_stock_delta(
        v_entry.product_id,
        v_entry.quantity,
        'owner_deleted_manual_sale',
        'accounting_entry',
        p_entry_id::text,
        v_entry.order_number
      );
      v_restored := true;
    end if;
  end if;

  delete from public.accounting_entries ae
  where ae.id = p_entry_id;

  return query select p_entry_id, v_restored;
end;
$bma_delete_accounting_entry$;

grant execute on function public.record_manual_sale_v2(
  text,
  jsonb,
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

grant execute on function public.bma_delete_accounting_entry(uuid)
to authenticated;

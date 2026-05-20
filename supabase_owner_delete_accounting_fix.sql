-- BMA - correction suppression ligne comptable owner-only.
-- A executer dans Supabase SQL Editor si tu vois:
-- column reference "accounting_entry_id" is ambiguous

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
  v_restored boolean := false;
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

  delete from public.accounting_entries ae
  where ae.id = p_entry_id;

  if coalesce(v_entry.source, 'manual') = 'manual'
    and v_entry.product_id is not null
    and coalesce(v_entry.quantity, 0) > 0
  then
    if to_regprocedure('public._apply_stock_delta(uuid,integer,text,text,text,text)') is not null then
      execute 'select * from public._apply_stock_delta($1, $2, $3, $4, $5, $6)'
      using
        v_entry.product_id,
        v_entry.quantity,
        'owner_deleted_manual_sale',
        'accounting_entry',
        p_entry_id::text,
        v_entry.order_number;
    else
      update public.products p
      set stock = coalesce(p.stock, 0) + v_entry.quantity
      where p.id = v_entry.product_id;
    end if;

    v_restored := true;
  end if;

  return query select p_entry_id, v_restored;
end;
$bma_delete_accounting_entry$;

grant execute on function public.bma_delete_accounting_entry(uuid)
to authenticated;

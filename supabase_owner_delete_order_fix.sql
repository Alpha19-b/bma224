-- BMA - correction suppression commande owner-only.
-- A executer dans Supabase SQL Editor si tu vois:
-- column reference "order_id" is ambiguous

drop function if exists public.bma_delete_order(uuid);

create or replace function public.bma_delete_order(p_order_id uuid)
returns table (
  deleted_order_id uuid,
  deleted_order_number text
)
language plpgsql
security definer
set search_path = public
as $bma_delete_order$
declare
  v_order_number text;
  v_accounting_ids uuid[];
  v_deleted_deposit_ids uuid[];
begin
  if not public.bma_is_owner() then
    raise exception 'Acces refuse: seul le super admin peut supprimer une commande.';
  end if;

  select o.order_number
  into v_order_number
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'Commande introuvable.';
  end if;

  select array_agg(ae.id)
  into v_accounting_ids
  from public.accounting_entries ae
  where ae.order_number = v_order_number;

  if to_regclass('public.orange_money_deposit_items') is not null then
    with deleted_items as (
      delete from public.orange_money_deposit_items odi
      where odi.accounting_entry_id = any(coalesce(v_accounting_ids, array[]::uuid[]))
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
  where ae.id = any(coalesce(v_accounting_ids, array[]::uuid[]));

  delete from public.order_items oi
  where oi.order_id = p_order_id;

  if to_regclass('public.order_status_history') is not null then
    execute 'delete from public.order_status_history osh where osh.order_id = $1'
    using p_order_id;
  end if;

  if to_regclass('public.payments') is not null then
    execute 'delete from public.payments p where p.order_id = $1'
    using p_order_id;
  end if;

  if to_regclass('public.sms_logs') is not null then
    execute 'delete from public.sms_logs sl where sl.order_id = $1'
    using p_order_id;
  end if;

  delete from public.orders o
  where o.id = p_order_id;

  return query select p_order_id, v_order_number;
end;
$bma_delete_order$;

grant execute on function public.bma_delete_order(uuid)
to authenticated;

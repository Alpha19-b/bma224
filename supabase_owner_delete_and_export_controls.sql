-- BMA - suppressions reservees au super admin + contexte admin.
-- A executer dans Supabase SQL Editor.
-- Important: les articles sont retires de la vente via is_active=false au lieu d'etre purges,
-- afin de garder l'historique des commandes et de l'audit.

create or replace function public.bma_is_internal_user(p_user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
as $bma_internal$
  select exists (
    select 1
    from public.admin_users au
    where au.id = p_user_id
      and au.role::text in ('owner', 'manager', 'staff', 'admin')
  );
$bma_internal$;

create or replace function public.bma_is_owner(p_user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
as $bma_owner$
  select exists (
    select 1
    from public.admin_users au
    where au.id = p_user_id
      and au.role::text = 'owner'
  );
$bma_owner$;

create or replace function public.get_current_admin_context()
returns table (
  user_id uuid,
  email text,
  role text,
  is_owner boolean,
  is_internal boolean
)
language plpgsql
security definer
set search_path = public
as $bma_admin_context$
begin
  return query
  select
    auth.uid(),
    auth.jwt() ->> 'email',
    au.role::text,
    coalesce(au.role::text = 'owner', false),
    coalesce(au.role::text in ('owner', 'manager', 'staff', 'admin'), false)
  from public.admin_users au
  where au.id = auth.uid();
end;
$bma_admin_context$;

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

  select *
  into v_entry
  from public.accounting_entries
  where id = p_entry_id
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

  delete from public.accounting_entries
  where id = p_entry_id;

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
      update public.products
      set stock = coalesce(stock, 0) + v_entry.quantity
      where id = v_entry.product_id;
    end if;

    v_restored := true;
  end if;

  return query select p_entry_id, v_restored;
end;
$bma_delete_accounting_entry$;

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

grant execute on function public.get_current_admin_context()
to authenticated;

grant execute on function public.bma_delete_product(uuid)
to authenticated;

grant execute on function public.bma_delete_accounting_entry(uuid)
to authenticated;

grant execute on function public.bma_delete_order(uuid)
to authenticated;

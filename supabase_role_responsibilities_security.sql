-- BMA - responsabilites claires par role.
-- A executer dans Supabase SQL Editor apres les scripts deja appliques.
--
-- Logique:
-- - owner / super admin: tout voir, tout modifier, supprimer.
-- - manager: voir les donnees de gestion et les permissions, sans supprimer.
-- - staff / vendeur: enregistrer une vente, sans voir audit, marges, couts ni caisse globale.

create or replace function public.bma_is_manager_or_owner(p_user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
as $bma_manager_or_owner$
  select exists (
    select 1
    from public.admin_users au
    where au.id = p_user_id
      and au.role::text in ('owner', 'manager', 'admin')
  );
$bma_manager_or_owner$;

create or replace function public.bma_current_user_is_manager_or_owner()
returns boolean
language sql
security definer
set search_path = public
as $bma_current_manager_or_owner$
  select public.bma_is_manager_or_owner(auth.uid());
$bma_current_manager_or_owner$;

create or replace function public.get_admin_accounting_entries()
returns table (
  id uuid,
  order_number text,
  product_id uuid,
  quantity integer,
  entry_date date,
  customer_name text,
  sale_amount bigint,
  purchase_amount bigint,
  cost_amount bigint,
  collection_method text,
  collected_by_name text,
  collected_at timestamptz,
  note text,
  source text,
  deposit_orange_money_reference text,
  deposit_deposited_by_name text,
  deposit_receipt_url text,
  deposit_receipt_file_name text,
  deposit_deposited_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $bma_admin_accounting_entries$
begin
  if not public.bma_current_user_is_manager_or_owner() then
    raise exception 'Acces refuse: comptabilite reservee au manager et au super admin.';
  end if;

  return query
  select
    ae.id,
    ae.order_number,
    ae.product_id,
    coalesce(ae.quantity, 1)::integer,
    ae.entry_date,
    ae.customer_name,
    ae.sale_amount::bigint,
    ae.purchase_amount::bigint,
    ae.cost_amount::bigint,
    ae.collection_method::text,
    ae.collected_by_name,
    ae.collected_at,
    ae.note,
    coalesce(ae.source, 'manual')::text,
    dep.orange_money_reference,
    dep.deposited_by_name,
    dep.receipt_url,
    dep.receipt_file_name,
    dep.deposited_at
  from public.accounting_entries ae
  left join lateral (
    select
      omd.orange_money_reference,
      omd.deposited_by_name,
      omd.receipt_url,
      omd.receipt_file_name,
      omd.deposited_at
    from public.orange_money_deposit_items odi
    join public.orange_money_deposits omd
      on omd.id = odi.deposit_id
    where odi.accounting_entry_id = ae.id
    order by omd.deposited_at desc
    limit 1
  ) dep on true
  order by ae.entry_date desc, ae.created_at desc
  limit 300;
end;
$bma_admin_accounting_entries$;

grant execute on function public.get_admin_accounting_entries()
to authenticated;

alter table public.accounting_entries enable row level security;
alter table public.orange_money_deposits enable row level security;
alter table public.orange_money_deposit_items enable row level security;
alter table public.stock_movements enable row level security;

drop policy if exists "BMA internal read accounting entries" on public.accounting_entries;
drop policy if exists "BMA manager read accounting entries" on public.accounting_entries;
create policy "BMA manager read accounting entries"
on public.accounting_entries for select
to authenticated
using (public.bma_current_user_is_manager_or_owner());

drop policy if exists "BMA internal read orange money deposits" on public.orange_money_deposits;
drop policy if exists "BMA manager read orange money deposits" on public.orange_money_deposits;
create policy "BMA manager read orange money deposits"
on public.orange_money_deposits for select
to authenticated
using (public.bma_current_user_is_manager_or_owner());

drop policy if exists "BMA internal read orange money deposit items" on public.orange_money_deposit_items;
drop policy if exists "BMA manager read orange money deposit items" on public.orange_money_deposit_items;
create policy "BMA manager read orange money deposit items"
on public.orange_money_deposit_items for select
to authenticated
using (public.bma_current_user_is_manager_or_owner());

drop policy if exists "BMA internal read stock movements" on public.stock_movements;
drop policy if exists "BMA manager read stock movements" on public.stock_movements;
create policy "BMA manager read stock movements"
on public.stock_movements for select
to authenticated
using (public.bma_current_user_is_manager_or_owner());

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
as $bma_manual_sale_role_safe$
declare
  v_entry public.accounting_entries;
  v_quantity integer := greatest(1, coalesce(p_quantity, 1));
  v_purchase_amount bigint := greatest(0, coalesce(p_purchase_amount, 0));
  v_cost_amount bigint := greatest(0, coalesce(p_cost_amount, 0));
  v_unit_purchase bigint;
  v_unit_cost bigint;
begin
  if not public.is_admin() then
    raise exception 'Acces refuse: seul un membre interne peut enregistrer une vente.';
  end if;

  if p_product_id is not null then
    select
      coalesce(p.purchase_price, 0)::bigint,
      coalesce(nullif(p.cost_price, 0), p.purchase_price, 0)::bigint
    into v_unit_purchase, v_unit_cost
    from public.products p
    where p.id = p_product_id;

    if not found then
      raise exception 'Produit introuvable.';
    end if;

    v_purchase_amount := greatest(0, coalesce(v_unit_purchase, 0)) * v_quantity;
    v_cost_amount := greatest(0, coalesce(v_unit_cost, 0)) * v_quantity;
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
    v_purchase_amount,
    v_cost_amount,
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
$bma_manual_sale_role_safe$;

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

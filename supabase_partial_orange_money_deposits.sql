-- BMA - Depots Orange Money partiels.
-- A executer dans Supabase SQL Editor apres les scripts de comptabilite deja appliques.
-- Objectif:
-- - une vente liquide peut etre deposee en plusieurs fois;
-- - la comptabilite remonte le montant deja depose et le reste a deposer;
-- - aucun historique existant n'est supprime.

alter table public.orange_money_deposit_items
add column if not exists amount bigint;

update public.orange_money_deposit_items odi
set amount = coalesce(odi.amount, ae.sale_amount, 1)
from public.accounting_entries ae
where odi.accounting_entry_id = ae.id
  and odi.amount is null;

alter table public.orange_money_deposit_items
alter column amount set not null;

alter table public.orange_money_deposit_items
drop constraint if exists orange_money_deposit_items_amount_check;

alter table public.orange_money_deposit_items
add constraint orange_money_deposit_items_amount_check
check (amount > 0)
not valid;

alter table public.orange_money_deposit_items
validate constraint orange_money_deposit_items_amount_check;

create index if not exists idx_orange_money_deposit_items_entry_id
on public.orange_money_deposit_items(accounting_entry_id);

drop function if exists public.get_admin_accounting_entries();

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
  deposit_deposited_at timestamptz,
  deposit_deposited_amount bigint,
  deposit_remaining_amount bigint,
  deposit_count integer
)
language plpgsql
security definer
set search_path = public
as $bma_accounting_partial_deposits$
begin
  if not public.bma_current_user_is_internal() then
    raise exception 'Acces refuse: compte admin requis.';
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
    latest_deposit.orange_money_reference,
    latest_deposit.deposited_by_name,
    latest_deposit.receipt_url,
    latest_deposit.receipt_file_name,
    latest_deposit.deposited_at,
    coalesce(deposit_totals.deposited_amount, 0)::bigint,
    greatest(
      0,
      ae.sale_amount::bigint - coalesce(deposit_totals.deposited_amount, 0)::bigint
    )::bigint,
    coalesce(deposit_totals.deposit_count, 0)::integer
  from public.accounting_entries ae
  left join lateral (
    select
      coalesce(sum(odi.amount), 0)::bigint as deposited_amount,
      count(*)::integer as deposit_count
    from public.orange_money_deposit_items odi
    where odi.accounting_entry_id = ae.id
  ) deposit_totals on true
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
  ) latest_deposit on true
  order by ae.entry_date desc, ae.created_at desc
  limit 300;
end;
$bma_accounting_partial_deposits$;

grant execute on function public.get_admin_accounting_entries()
to authenticated;

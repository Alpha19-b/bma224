-- BMA - Lecture comptable admin fiable.
-- A executer dans Supabase SQL Editor.
-- Ne supprime aucune donnee. Ne change pas les montants.
-- Cree une fonction RPC qui lit la compta cote serveur pour eviter les blocages RLS/front.

alter table public.accounting_entries
add column if not exists product_id uuid references public.products(id) on delete set null;

alter table public.accounting_entries
add column if not exists quantity integer not null default 1 check (quantity > 0);

alter table public.accounting_entries
add column if not exists source text not null default 'manual';

create or replace function public.bma_current_user_is_internal()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users au
    where au.id = auth.uid()
      and au.role::text in ('owner', 'manager', 'staff', 'admin')
  );
$$;

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
as $$
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
$$;

grant execute on function public.get_admin_accounting_entries()
to authenticated;

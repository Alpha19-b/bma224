-- BMA - comptabilite automatique des paiements Djomi.
-- A executer dans Supabase SQL Editor apres les patchs compta, stock/audit et Djomi.
--
-- Objectif:
-- - Quand une commande site passe en payment_status = paid via Djomi,
--   une ligne est creee dans accounting_entries.
-- - Les anciennes commandes Djomi deja payees sont aussi rattrapees.
-- - La fonction est idempotente: elle ne cree pas deux lignes pour la meme commande.

alter table public.accounting_entries
add column if not exists order_id uuid references public.orders(id) on delete set null;

alter table public.accounting_entries
add column if not exists product_id uuid references public.products(id) on delete set null;

alter table public.accounting_entries
add column if not exists quantity integer not null default 1 check (quantity > 0);

alter table public.accounting_entries
add column if not exists source text not null default 'manual';

alter table public.order_items
add column if not exists selected_size text;

alter table public.order_items
add column if not exists selected_color text;

alter table public.orders
add column if not exists djomi_transaction_id text;

alter table public.orders
add column if not exists djomi_merchant_reference text;

alter table public.orders
add column if not exists djomi_payment_status text;

alter table public.orders
add column if not exists djomi_paid_amount bigint;

alter table public.orders
add column if not exists djomi_received_amount bigint;

alter table public.orders
add column if not exists djomi_payment_method text;

alter table public.orders
add column if not exists djomi_provider_reference text;

alter table public.orders
add column if not exists djomi_verified_at timestamptz;

alter table public.orders
add column if not exists payment_completed_at timestamptz;

create index if not exists idx_accounting_entries_order_number
on public.accounting_entries(order_number);

create index if not exists idx_accounting_entries_source
on public.accounting_entries(source);

create or replace function public.sync_order_accounting_entry(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $bma_sync_order_accounting$
declare
  v_order record;
  v_existing_id uuid;
  v_entry_id uuid;
  v_sale_amount bigint;
  v_purchase_amount bigint;
  v_cost_amount bigint;
  v_quantity integer;
  v_product_id uuid;
  v_items_note text;
  v_collection_method public.collection_method;
begin
  if p_order_id is null then
    raise exception 'Commande obligatoire pour synchroniser la comptabilite.';
  end if;

  select *
  into v_order
  from public.orders
  where id = p_order_id;

  if not found then
    raise exception 'Commande introuvable.';
  end if;

  if v_order.payment_status::text <> 'paid' then
    return null;
  end if;

  select id
  into v_existing_id
  from public.accounting_entries
  where order_id = p_order_id
  limit 1;

  if v_existing_id is not null then
    return v_existing_id;
  end if;

  v_collection_method :=
    case
      when v_order.payment_provider::text = 'djomi'
        or v_order.djomi_transaction_id is not null
        or upper(coalesce(v_order.djomi_payment_status, '')) in ('SUCCESS', 'CAPTURED')
        then 'djomi'::public.collection_method
      when v_order.payment_provider::text = 'orange_money'
        then 'orange_money'::public.collection_method
      when v_order.payment_provider::text = 'cash_on_delivery'
        then 'cash'::public.collection_method
      else 'other'::public.collection_method
    end;

  v_sale_amount := greatest(
    0,
    coalesce(
      nullif(v_order.djomi_paid_amount, 0),
      round(coalesce(v_order.total_amount, 0))::bigint,
      0
    )
  );

  select
    coalesce(sum(oi.quantity), 0)::integer,
    case
      when count(distinct oi.product_id) = 1 then min(oi.product_id)
      else null
    end,
    coalesce(sum(coalesce(p.purchase_price, 0)::bigint * oi.quantity), 0)::bigint,
    coalesce(
      sum(
        coalesce(nullif(p.cost_price, 0), p.purchase_price, 0)::bigint
        * oi.quantity
      ),
      0
    )::bigint,
    string_agg(
      concat_ws(
        ' - ',
        concat(oi.quantity, 'x ', coalesce(oi.product_name_snapshot, p.name, 'Article')),
        nullif(concat('Taille ', coalesce(oi.selected_size, '')), 'Taille '),
        nullif(concat('Couleur ', coalesce(oi.selected_color, '')), 'Couleur ')
      ),
      E'\n'
      order by oi.id
    )
  into
    v_quantity,
    v_product_id,
    v_purchase_amount,
    v_cost_amount,
    v_items_note
  from public.order_items oi
  left join public.products p on p.id = oi.product_id
  where oi.order_id = p_order_id;

  insert into public.accounting_entries (
    order_id,
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
  select
    v_order.id,
    v_order.order_number,
    v_product_id,
    greatest(1, coalesce(v_quantity, 1)),
    coalesce(v_order.payment_completed_at, v_order.djomi_verified_at, v_order.created_at, now())::date,
    coalesce(v_order.delivery_recipient_name, v_order.guest_name, 'Client BMA'),
    v_sale_amount,
    greatest(0, coalesce(v_purchase_amount, 0)),
    greatest(0, coalesce(v_cost_amount, 0)),
    v_collection_method,
    null,
    case
      when v_collection_method = 'djomi' then 'Djomi automatique'
      else 'Site BMA'
    end,
    coalesce(v_order.payment_completed_at, v_order.djomi_verified_at, now()),
    concat_ws(
      E'\n',
      nullif(v_items_note, ''),
      case
        when v_order.djomi_merchant_reference is not null
          then concat('Reference Djomi: ', v_order.djomi_merchant_reference)
        else null
      end,
      case
        when v_order.djomi_transaction_id is not null
          then concat('Transaction Djomi: ', v_order.djomi_transaction_id)
        else null
      end
    ),
    case
      when v_collection_method = 'djomi' then 'site_djomi'
      else 'site_order'
    end
  where not exists (
    select 1
    from public.accounting_entries existing
    where existing.order_id = v_order.id
  )
  returning id into v_entry_id;

  return coalesce(v_entry_id, v_existing_id);
end;
$bma_sync_order_accounting$;

create or replace function public.sync_paid_order_accounting_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $bma_paid_order_accounting_trigger$
begin
  if new.payment_status::text = 'paid'
    and (
      old.payment_status is distinct from new.payment_status
      or old.djomi_payment_status is distinct from new.djomi_payment_status
      or old.djomi_paid_amount is distinct from new.djomi_paid_amount
      or old.payment_completed_at is distinct from new.payment_completed_at
      or old.payment_provider is distinct from new.payment_provider
    )
  then
    perform public.sync_order_accounting_entry(new.id);
  end if;

  return new;
end;
$bma_paid_order_accounting_trigger$;

drop trigger if exists sync_paid_order_accounting on public.orders;
create trigger sync_paid_order_accounting
after update of payment_status, payment_provider, djomi_payment_status, djomi_paid_amount, payment_completed_at
on public.orders
for each row execute function public.sync_paid_order_accounting_trigger();

do $bma_backfill_djomi_accounting$
declare
  v_order record;
begin
  for v_order in
    select id
    from public.orders
    where payment_status::text = 'paid'
      and (
        payment_provider::text = 'djomi'
        or djomi_transaction_id is not null
        or upper(coalesce(djomi_payment_status, '')) in ('SUCCESS', 'CAPTURED')
      )
  loop
    perform public.sync_order_accounting_entry(v_order.id);
  end loop;
end;
$bma_backfill_djomi_accounting$;

grant execute on function public.sync_order_accounting_entry(uuid)
to authenticated, service_role;

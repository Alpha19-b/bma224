-- BMA - Secours lecture admin.
-- Objectif: restaurer l'affichage admin si RLS bloque les lectures.
-- Ce script ne supprime aucune donnee.

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

alter table public.accounting_entries enable row level security;
alter table public.orange_money_deposits enable row level security;
alter table public.orange_money_deposit_items enable row level security;
alter table public.stock_movements enable row level security;

drop policy if exists "BMA internal read accounting entries" on public.accounting_entries;
create policy "BMA internal read accounting entries"
on public.accounting_entries for select
to authenticated
using (public.bma_is_internal_user());

drop policy if exists "BMA internal insert accounting entries" on public.accounting_entries;
create policy "BMA internal insert accounting entries"
on public.accounting_entries for insert
to authenticated
with check (public.bma_is_internal_user());

drop policy if exists "BMA owner update accounting entries" on public.accounting_entries;
create policy "BMA owner update accounting entries"
on public.accounting_entries for update
to authenticated
using (public.bma_is_owner())
with check (public.bma_is_owner());

drop policy if exists "BMA owner delete accounting entries" on public.accounting_entries;
create policy "BMA owner delete accounting entries"
on public.accounting_entries for delete
to authenticated
using (public.bma_is_owner());

drop policy if exists "BMA internal read orange money deposits" on public.orange_money_deposits;
create policy "BMA internal read orange money deposits"
on public.orange_money_deposits for select
to authenticated
using (public.bma_is_internal_user());

drop policy if exists "BMA internal insert orange money deposits" on public.orange_money_deposits;
create policy "BMA internal insert orange money deposits"
on public.orange_money_deposits for insert
to authenticated
with check (public.bma_is_internal_user());

drop policy if exists "BMA owner update orange money deposits" on public.orange_money_deposits;
create policy "BMA owner update orange money deposits"
on public.orange_money_deposits for update
to authenticated
using (public.bma_is_owner())
with check (public.bma_is_owner());

drop policy if exists "BMA owner delete orange money deposits" on public.orange_money_deposits;
create policy "BMA owner delete orange money deposits"
on public.orange_money_deposits for delete
to authenticated
using (public.bma_is_owner());

drop policy if exists "BMA internal read orange money deposit items" on public.orange_money_deposit_items;
create policy "BMA internal read orange money deposit items"
on public.orange_money_deposit_items for select
to authenticated
using (public.bma_is_internal_user());

drop policy if exists "BMA internal insert orange money deposit items" on public.orange_money_deposit_items;
create policy "BMA internal insert orange money deposit items"
on public.orange_money_deposit_items for insert
to authenticated
with check (public.bma_is_internal_user());

drop policy if exists "BMA owner update orange money deposit items" on public.orange_money_deposit_items;
create policy "BMA owner update orange money deposit items"
on public.orange_money_deposit_items for update
to authenticated
using (public.bma_is_owner())
with check (public.bma_is_owner());

drop policy if exists "BMA owner delete orange money deposit items" on public.orange_money_deposit_items;
create policy "BMA owner delete orange money deposit items"
on public.orange_money_deposit_items for delete
to authenticated
using (public.bma_is_owner());

drop policy if exists "BMA internal read stock movements" on public.stock_movements;
create policy "BMA internal read stock movements"
on public.stock_movements for select
to authenticated
using (public.bma_is_internal_user());

drop policy if exists "BMA internal insert stock movements" on public.stock_movements;
create policy "BMA internal insert stock movements"
on public.stock_movements for insert
to authenticated
with check (public.bma_is_internal_user());

select
  'accounting_entries' as table_name,
  count(*) as rows_count
from public.accounting_entries
union all
select
  'orange_money_deposits',
  count(*)
from public.orange_money_deposits
union all
select
  'orange_money_deposit_items',
  count(*)
from public.orange_money_deposit_items
union all
select
  'stock_movements',
  count(*)
from public.stock_movements;

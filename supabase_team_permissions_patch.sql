-- Permissions reglables BMA.
-- A lancer apres supabase_admin_access_fix.sql.
--
-- Ce script retire les verrous stricts d'immutabilite ajoutes precedemment
-- et remplace la logique par une table de permissions modifiable par le owner.

drop trigger if exists owner_only_accounting_entries_changes on public.accounting_entries;
drop trigger if exists owner_only_orange_money_deposits_changes on public.orange_money_deposits;
drop trigger if exists owner_only_orange_money_deposit_items_changes on public.orange_money_deposit_items;
drop trigger if exists owner_only_product_price_changes on public.products;

create table if not exists public.role_permissions (
  role text not null,
  permission_key text not null,
  label text not null,
  is_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (role, permission_key)
);

alter table public.role_permissions enable row level security;

drop policy if exists "Internal users can read role permissions" on public.role_permissions;
create policy "Internal users can read role permissions"
on public.role_permissions for select
to authenticated
using (public.is_admin());

drop policy if exists "Owners can manage role permissions" on public.role_permissions;
create policy "Owners can manage role permissions"
on public.role_permissions for all
to authenticated
using (public.is_owner())
with check (public.is_owner());

create or replace function public.has_permission(permission_key text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users au
    join public.role_permissions rp
      on rp.role = au.role::text
    where au.id = auth.uid()
      and rp.permission_key = has_permission.permission_key
      and rp.is_enabled = true
  );
$$;

insert into public.role_permissions (role, permission_key, label, is_enabled)
values
  ('owner', 'view_costs', 'Voir prix achat et revient', true),
  ('owner', 'view_orange_balance', 'Voir solde Orange Money', true),
  ('owner', 'manage_products', 'Créer et modifier les articles', true),
  ('owner', 'manage_permissions', 'Modifier les permissions équipe', true),
  ('owner', 'edit_accounting', 'Modifier la comptabilité', true),
  ('manager', 'view_costs', 'Voir prix achat et revient', true),
  ('manager', 'view_orange_balance', 'Voir solde Orange Money', true),
  ('manager', 'manage_products', 'Créer et modifier les articles', false),
  ('manager', 'manage_permissions', 'Modifier les permissions équipe', false),
  ('manager', 'edit_accounting', 'Modifier la comptabilité', true),
  ('staff', 'view_costs', 'Voir prix achat et revient', false),
  ('staff', 'view_orange_balance', 'Voir solde Orange Money', false),
  ('staff', 'manage_products', 'Créer et modifier les articles', false),
  ('staff', 'manage_permissions', 'Modifier les permissions équipe', false),
  ('staff', 'edit_accounting', 'Modifier la comptabilité', false)
on conflict (role, permission_key) do nothing;

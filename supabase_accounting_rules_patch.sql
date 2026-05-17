-- Regles comptables avancees.
-- A lancer apres le schema principal, supabase_product_accounting_patch.sql
-- et supabase_admin_access_fix.sql.
--
-- Principe:
-- - owner = super admin
-- - manager/staff = peut creer les ventes, encaissements et depots
-- - seules les personnes owner peuvent modifier ou supprimer l'historique sensible

create or replace function public.current_actor_label()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'email', auth.uid()::text, 'system');
$$;

create or replace function public.fill_accounting_actor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'accounting_entries' then
    new.collected_by := coalesce(new.collected_by, auth.uid());
    new.collected_by_name := coalesce(
      nullif(new.collected_by_name, ''),
      public.current_actor_label()
    );
    new.collected_at := coalesce(new.collected_at, now());
  end if;

  if tg_table_name = 'orange_money_deposits' then
    new.deposited_by := coalesce(new.deposited_by, auth.uid());
    new.deposited_by_name := coalesce(
      nullif(new.deposited_by_name, ''),
      public.current_actor_label()
    );
    new.deposited_at := coalesce(new.deposited_at, now());
  end if;

  return new;
end;
$$;

drop trigger if exists fill_accounting_entries_actor on public.accounting_entries;
create trigger fill_accounting_entries_actor
before insert on public.accounting_entries
for each row execute function public.fill_accounting_actor();

drop trigger if exists fill_orange_money_deposits_actor on public.orange_money_deposits;
create trigger fill_orange_money_deposits_actor
before insert on public.orange_money_deposits
for each row execute function public.fill_accounting_actor();

-- Djomi uniquement: si l'ancien enum contient deja 'djamo', on l'interdit en nouvelle saisie.
alter table public.accounting_entries
drop constraint if exists accounting_entries_no_djamo;

alter table public.accounting_entries
add constraint accounting_entries_no_djamo
check (collection_method::text <> 'djamo');

create or replace function public.owner_only_sensitive_history_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_owner(auth.uid()) then
    if tg_op = 'DELETE' then
      return old;
    end if;

    return new;
  end if;

  raise exception 'Historique verrouille: seul le owner peut modifier ou supprimer cette donnee.';
end;
$$;

drop trigger if exists owner_only_accounting_entries_changes on public.accounting_entries;
create trigger owner_only_accounting_entries_changes
before update or delete on public.accounting_entries
for each row execute function public.owner_only_sensitive_history_changes();

drop trigger if exists owner_only_orange_money_deposits_changes on public.orange_money_deposits;
create trigger owner_only_orange_money_deposits_changes
before update or delete on public.orange_money_deposits
for each row execute function public.owner_only_sensitive_history_changes();

drop trigger if exists owner_only_orange_money_deposit_items_changes on public.orange_money_deposit_items;
create trigger owner_only_orange_money_deposit_items_changes
before update or delete on public.orange_money_deposit_items
for each row execute function public.owner_only_sensitive_history_changes();

create or replace function public.owner_only_product_price_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if public.is_owner(auth.uid()) then
      return old;
    end if;

    raise exception 'Produit verrouille: seul le owner peut supprimer un produit.';
  end if;

  if public.is_owner(auth.uid()) then
    return new;
  end if;

  if old.price is distinct from new.price
    or old.purchase_price is distinct from new.purchase_price
    or old.cost_price is distinct from new.cost_price
    or old.slug is distinct from new.slug
  then
    raise exception 'Prix produit verrouille: seul le owner peut modifier prix, achat, revient ou slug.';
  end if;

  return new;
end;
$$;

drop trigger if exists owner_only_product_price_changes on public.products;
create trigger owner_only_product_price_changes
before update or delete on public.products
for each row execute function public.owner_only_product_price_changes();

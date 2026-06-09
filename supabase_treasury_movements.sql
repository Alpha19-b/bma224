-- BMA - mouvements de trésorerie.
-- À exécuter dans Supabase SQL Editor pour suivre les sorties/entrées hors ventes :
-- achats de stock, frais, retraits, corrections de solde.

create table if not exists public.treasury_movements (
  id uuid primary key default gen_random_uuid(),
  movement_date date not null default current_date,
  account text not null default 'orange_money'
    check (account in ('cash', 'orange_money', 'djomi', 'bank', 'other')),
  direction text not null default 'out'
    check (direction in ('in', 'out', 'adjustment')),
  category text not null default 'stock_purchase',
  amount bigint not null check (amount > 0),
  label text not null,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now()
);

create index if not exists idx_treasury_movements_date
on public.treasury_movements(movement_date desc, created_at desc);

create index if not exists idx_treasury_movements_account
on public.treasury_movements(account);

alter table public.treasury_movements enable row level security;

drop policy if exists "Internal users can read treasury movements" on public.treasury_movements;
create policy "Internal users can read treasury movements"
on public.treasury_movements for select
to authenticated
using (public.is_admin());

drop policy if exists "Managers can create treasury movements" on public.treasury_movements;
create policy "Managers can create treasury movements"
on public.treasury_movements for insert
to authenticated
with check (public.is_admin());

drop policy if exists "Owners can delete treasury movements" on public.treasury_movements;
create policy "Owners can delete treasury movements"
on public.treasury_movements for delete
to authenticated
using (public.is_owner());

drop policy if exists "Owners can update treasury movements" on public.treasury_movements;
create policy "Owners can update treasury movements"
on public.treasury_movements for update
to authenticated
using (public.is_owner())
with check (public.is_owner());

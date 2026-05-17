-- BMA - profils clients + options reelles de produits.
-- A executer dans Supabase SQL Editor apres les scripts deja appliques.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.customer_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text,
  last_name text,
  full_name text,
  phone text,
  preferred_delivery_address text,
  preferred_delivery_commune text,
  preferred_delivery_quartier text,
  preferred_latitude text,
  preferred_longitude text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.customer_profiles enable row level security;

drop trigger if exists set_customer_profiles_updated_at on public.customer_profiles;
create trigger set_customer_profiles_updated_at
before update on public.customer_profiles
for each row execute function public.set_updated_at();

drop policy if exists "Customers can read own profile" on public.customer_profiles;
create policy "Customers can read own profile"
on public.customer_profiles for select
to authenticated
using (id = auth.uid());

drop policy if exists "Customers can create own profile" on public.customer_profiles;
create policy "Customers can create own profile"
on public.customer_profiles for insert
to authenticated
with check (id = auth.uid());

drop policy if exists "Customers can update own profile" on public.customer_profiles;
create policy "Customers can update own profile"
on public.customer_profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "Admins can read customer profiles" on public.customer_profiles;
create policy "Admins can read customer profiles"
on public.customer_profiles for select
to authenticated
using (public.is_admin());

create or replace function public.create_customer_profile_from_auth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.customer_profiles (
    id,
    first_name,
    last_name,
    full_name,
    phone,
    preferred_delivery_address,
    preferred_delivery_commune,
    preferred_delivery_quartier,
    preferred_latitude,
    preferred_longitude
  )
  values (
    new.id,
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name',
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'phone',
    new.raw_user_meta_data ->> 'preferred_delivery_address',
    new.raw_user_meta_data ->> 'preferred_delivery_commune',
    new.raw_user_meta_data ->> 'preferred_delivery_quartier',
    new.raw_user_meta_data ->> 'preferred_latitude',
    new.raw_user_meta_data ->> 'preferred_longitude'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_customer_profile on auth.users;
create trigger on_auth_user_created_customer_profile
after insert on auth.users
for each row execute function public.create_customer_profile_from_auth();

create table if not exists public.product_options (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  option_type text not null check (option_type in ('size', 'color')),
  value text not null,
  hex_color text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, option_type, value)
);

create index if not exists idx_product_options_product_id
on public.product_options(product_id);

create index if not exists idx_product_options_type
on public.product_options(option_type);

alter table public.product_options enable row level security;

drop trigger if exists set_product_options_updated_at on public.product_options;
create trigger set_product_options_updated_at
before update on public.product_options
for each row execute function public.set_updated_at();

drop policy if exists "Public can read active product options" on public.product_options;
create policy "Public can read active product options"
on public.product_options for select
to anon, authenticated
using (is_active = true);

drop policy if exists "Admins can manage product options" on public.product_options;
create policy "Admins can manage product options"
on public.product_options for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

alter table public.order_items
add column if not exists selected_size text;

alter table public.order_items
add column if not exists selected_color text;

-- Si des comptes clients existaient deja avant ce script, ceci cree leur ligne profil.
insert into public.customer_profiles (
  id,
  first_name,
  last_name,
  full_name,
  phone,
  preferred_delivery_address,
  preferred_delivery_commune,
  preferred_delivery_quartier,
  preferred_latitude,
  preferred_longitude
)
select
  id,
  raw_user_meta_data ->> 'first_name',
  raw_user_meta_data ->> 'last_name',
  raw_user_meta_data ->> 'full_name',
  raw_user_meta_data ->> 'phone',
  raw_user_meta_data ->> 'preferred_delivery_address',
  raw_user_meta_data ->> 'preferred_delivery_commune',
  raw_user_meta_data ->> 'preferred_delivery_quartier',
  raw_user_meta_data ->> 'preferred_latitude',
  raw_user_meta_data ->> 'preferred_longitude'
from auth.users
on conflict (id) do nothing;

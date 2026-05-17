-- A lancer dans Supabase SQL Editor apres avoir cree ton compte admin
-- dans Authentication > Users.
--
-- Remplace TON_EMAIL_ADMIN@example.com par l'email du compte admin.

create or replace function public.has_internal_role(
  user_id uuid default auth.uid(),
  allowed_roles text[] default array['owner', 'manager', 'staff']
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users au
    where au.id = $1
      and au.role::text = any($2)
  );
$$;

create or replace function public.is_admin(user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.has_internal_role(user_id, array['owner', 'manager', 'staff']);
$$;

create or replace function public.is_owner(user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.has_internal_role(user_id, array['owner']);
$$;

alter table public.admin_users enable row level security;
alter table public.products enable row level security;

drop policy if exists "Admins can manage admin users" on public.admin_users;
drop policy if exists "Admins can read admin users" on public.admin_users;
drop policy if exists "Owners can manage admin users" on public.admin_users;
drop policy if exists "Internal users can read admin users" on public.admin_users;

create policy "Owners can manage admin users"
on public.admin_users for all
to authenticated
using (public.is_owner())
with check (public.is_owner());

create policy "Internal users can read admin users"
on public.admin_users for select
to authenticated
using (
  public.has_internal_role(auth.uid(), array['owner', 'manager', 'staff'])
);

drop policy if exists "Admins can manage products" on public.products;

create policy "Admins can manage products"
on public.products for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Remplace l'email ci-dessous puis execute ce bloc.
do $$
declare
  v_admin_email text := 'TON_EMAIL_ADMIN@example.com';
  v_admin_id uuid;
begin
  select id
  into v_admin_id
  from auth.users
  where email = v_admin_email;

  if v_admin_id is null then
    raise exception 'Aucun utilisateur Auth trouve pour %', v_admin_email;
  end if;

  insert into public.admin_users (id, role)
  values (v_admin_id, 'owner')
  on conflict (id) do update
  set role = excluded.role;
end $$;

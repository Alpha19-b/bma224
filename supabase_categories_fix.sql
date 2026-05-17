-- Correctif categories BMA.
-- A lancer dans Supabase SQL Editor si les categories restent en "Produit"
-- ou si l'ajout d'article retourne une erreur de categorie.

alter table public.categories enable row level security;

drop policy if exists "Public can read active categories" on public.categories;
create policy "Public can read active categories"
on public.categories for select
to public
using (is_active = true);

drop policy if exists "Admins can manage categories" on public.categories;
create policy "Admins can manage categories"
on public.categories for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

alter table public.products
add column if not exists category_id uuid references public.categories(id) on delete set null;

create index if not exists idx_products_category_id
on public.products(category_id);

-- Stockage des photos produits BMA.
-- A lancer une seule fois dans Supabase SQL Editor.
-- Le bucket public permet d'afficher les photos côté client.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'product-images',
  'product-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can read product images" on storage.objects;
create policy "Public can read product images"
on storage.objects for select
to public
using (bucket_id = 'product-images');

drop policy if exists "Admins can upload product images" on storage.objects;
create policy "Admins can upload product images"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and public.is_admin()
);

drop policy if exists "Admins can update product images" on storage.objects;
create policy "Admins can update product images"
on storage.objects for update
to authenticated
using (
  bucket_id = 'product-images'
  and public.is_admin()
)
with check (
  bucket_id = 'product-images'
  and public.is_admin()
);

drop policy if exists "Owners can delete product images" on storage.objects;
create policy "Owners can delete product images"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'product-images'
  and public.is_owner()
);

create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  image_url text not null,
  alt_text text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_product_images_product_id
on public.product_images(product_id);

alter table public.product_images enable row level security;

drop policy if exists "Public can read product images rows" on public.product_images;
create policy "Public can read product images rows"
on public.product_images for select
to public
using (true);

drop policy if exists "Admins can manage product images rows" on public.product_images;
create policy "Admins can manage product images rows"
on public.product_images for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

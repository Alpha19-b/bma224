-- BMA - historique client connecte.
-- A executer dans Supabase SQL Editor si "Mes achats" reste vide pour un client connecte.

alter table public.orders enable row level security;
alter table public.order_items enable row level security;

drop policy if exists "Users can read own orders" on public.orders;
create policy "Users can read own orders"
on public.orders for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Users can read own order items" on public.order_items;
create policy "Users can read own order items"
on public.order_items for select
to authenticated
using (
  exists (
    select 1
    from public.orders
    where orders.id = order_items.order_id
      and orders.user_id = auth.uid()
  )
);

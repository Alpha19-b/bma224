-- BMA - Diagnostic comptabilite Djomi.
-- Ce script ne modifie rien. Il sert seulement a comprendre pourquoi
-- la synchronisation comptable Djomi ne s'installe pas.

select
  'orders' as table_name,
  column_name,
  data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'orders'
  and column_name in (
    'id',
    'order_number',
    'user_id',
    'guest_name',
    'delivery_recipient_name',
    'payment_status',
    'payment_provider',
    'order_status',
    'total_amount',
    'created_at',
    'djomi_transaction_id',
    'djomi_merchant_reference',
    'djomi_payment_status',
    'djomi_paid_amount',
    'djomi_verified_at',
    'payment_completed_at'
  )
union all
select
  'order_items' as table_name,
  column_name,
  data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'order_items'
  and column_name in (
    'id',
    'order_id',
    'product_id',
    'quantity',
    'unit_price',
    'product_name_snapshot',
    'selected_size',
    'selected_color'
  )
union all
select
  'products' as table_name,
  column_name,
  data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'products'
  and column_name in (
    'id',
    'name',
    'purchase_price',
    'cost_price'
  )
union all
select
  'accounting_entries' as table_name,
  column_name,
  data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'accounting_entries'
  and column_name in (
    'id',
    'order_id',
    'order_number',
    'product_id',
    'quantity',
    'entry_date',
    'customer_name',
    'sale_amount',
    'purchase_amount',
    'cost_amount',
    'collection_method',
    'collected_by_name',
    'collected_at',
    'note',
    'source'
  )
order by table_name, column_name;

select
  'missing_required_columns' as check_name,
  required.table_name,
  required.column_name
from (
  values
    ('orders', 'id'),
    ('orders', 'order_number'),
    ('orders', 'payment_status'),
    ('orders', 'total_amount'),
    ('order_items', 'order_id'),
    ('order_items', 'product_id'),
    ('order_items', 'quantity'),
    ('accounting_entries', 'id'),
    ('accounting_entries', 'order_number'),
    ('accounting_entries', 'sale_amount'),
    ('accounting_entries', 'purchase_amount'),
    ('accounting_entries', 'cost_amount'),
    ('accounting_entries', 'collection_method')
) as required(table_name, column_name)
where not exists (
  select 1
  from information_schema.columns existing
  where existing.table_schema = 'public'
    and existing.table_name = required.table_name
    and existing.column_name = required.column_name
);

select
  'existing_functions' as check_name,
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'sync_order_accounting_entry',
    'sync_paid_order_accounting_trigger',
    'record_manual_sale'
  )
order by p.proname;

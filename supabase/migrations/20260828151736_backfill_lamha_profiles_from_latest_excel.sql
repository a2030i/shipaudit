-- Seed the Excel fallback layer from the latest historical manual merchant
-- snapshot. New API-only stores remain valid profiles with no invented Excel
-- values until a later stores.xlsx upload supplies them.
with latest_excel as (
  select snapshot_id, max(uploaded_at) as uploaded_at
  from public.merchants
  where left(snapshot_id, 2) = 'm_'
  group by snapshot_id
  order by max(uploaded_at) desc
  limit 1
), source_rows as (
  select m.*, l.uploaded_at as source_uploaded_at
  from public.merchants m
  join latest_excel l on l.snapshot_id = m.snapshot_id
)
insert into public.lamha_store_profiles (
  store_id, excel_data, excel_imported_at, excel_source_file, updated_at
)
select
  store_id,
  jsonb_strip_nulls(jsonb_build_object(
    'id', store_id,
    'name', store_name,
    'phone', phone,
    'shipmentsCount', shipment_count,
    'lastShipmentDate', last_shipment_at,
    'integrationType', integration_type,
    'invoiceStatus', billing_type,
    'status', status,
    'joinDate', created_at_platform,
    'lastTopupAt', last_topup_at,
    'walletBalance', wallet_balance,
    'profileStatus', profile_status,
    'vatRegistered', vat_registered,
    'zatcaCompleted', zatca_completed,
    'verificationStatus', verification_status
  )),
  source_uploaded_at,
  'historical merchants snapshot:' || snapshot_id,
  clock_timestamp()
from source_rows
on conflict (store_id) do update set
  excel_data = excluded.excel_data || public.lamha_store_profiles.excel_data,
  excel_imported_at = greatest(
    excluded.excel_imported_at,
    public.lamha_store_profiles.excel_imported_at
  ),
  excel_source_file = coalesce(
    public.lamha_store_profiles.excel_source_file,
    excluded.excel_source_file
  ),
  updated_at = clock_timestamp();

-- Lamha API owns the operational directory, while stores.xlsx contributes a
-- small set of enrichment fields. Missing enrichment is unknown, not zero or
-- false. Preserve that distinction when a service-role ingestion creates the
-- immutable merchant snapshot.

create or replace function public.ingest_platform_merchant_snapshot(
  p_event_id text,
  p_snapshot_at timestamptz,
  p_payload_hash text,
  p_rows jsonb,
  p_source text default 'platform_webhook'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_existing public.platform_snapshot_receipts%rowtype;
  v_snapshot_id text;
  v_received_at timestamptz := clock_timestamp();
  v_row_count integer;
  v_previous_row_count integer;
  v_inserted integer;
  v_lifecycle jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not_allowed';
  end if;

  if p_event_id is null or length(btrim(p_event_id)) < 8 or length(p_event_id) > 160 then
    raise exception 'invalid_event_id';
  end if;
  if p_snapshot_at is null
     or p_snapshot_at < now() - interval '7 days'
     or p_snapshot_at > now() + interval '10 minutes' then
    raise exception 'invalid_snapshot_at';
  end if;
  if p_payload_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_payload_hash';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows_must_be_array';
  end if;

  v_row_count := jsonb_array_length(p_rows);
  if v_row_count < 1 or v_row_count > 5000 then
    raise exception 'invalid_row_count';
  end if;

  select count(*)::int
  into v_previous_row_count
  from public.merchants
  where snapshot_id = (
    select snapshot_id from public.merchants order by uploaded_at desc limit 1
  );

  if v_previous_row_count >= 100
     and (
       v_row_count < floor(v_previous_row_count * 0.60)
       or v_row_count > ceil(v_previous_row_count * 1.50)
     ) then
    raise exception 'suspicious_row_count_change';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_event_id, 0));

  select * into v_existing
  from public.platform_snapshot_receipts
  where event_id = p_event_id;

  if found then
    if v_existing.payload_hash <> p_payload_hash then
      raise exception 'idempotency_conflict';
    end if;
    return jsonb_build_object(
      'status', 'duplicate',
      'event_id', v_existing.event_id,
      'snapshot_id', v_existing.snapshot_id,
      'row_count', v_existing.row_count,
      'received_at', v_existing.received_at,
      'lifecycle', v_existing.lifecycle
    );
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) item
    where nullif(btrim(item->>'store_id'), '') is null
       or nullif(btrim(item->>'store_name'), '') is null
       or nullif(btrim(item->>'phone'), '') is null
  ) then
    raise exception 'missing_required_merchant_field';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) item
    group by btrim(item->>'store_id')
    having count(*) > 1
  ) then
    raise exception 'duplicate_store_id';
  end if;

  v_snapshot_id := 'api_' || left(
    encode(extensions.digest(convert_to(p_event_id, 'UTF8'), 'sha256'), 'hex'),
    32
  );

  insert into public.platform_snapshot_receipts (
    event_id, payload_hash, snapshot_id, snapshot_at, source, row_count, received_at
  ) values (
    p_event_id, p_payload_hash, v_snapshot_id, p_snapshot_at,
    coalesce(nullif(btrim(p_source), ''), 'platform_webhook'), v_row_count, v_received_at
  );

  insert into public.merchants (
    snapshot_id, snapshot_date, store_id, store_name, phone,
    shipment_count, last_shipment_at, integration_type, billing_type, status,
    created_at_platform, last_topup_at, wallet_balance,
    profile_status, vat_registered, zatca_completed, verification_status,
    uploaded_by, uploaded_at
  )
  select
    v_snapshot_id,
    (p_snapshot_at at time zone 'Asia/Riyadh')::date,
    btrim(row_data.store_id),
    btrim(row_data.store_name),
    btrim(row_data.phone),
    coalesce(row_data.shipment_count, 0),
    row_data.last_shipment_at,
    nullif(btrim(row_data.integration_type), ''),
    nullif(btrim(row_data.billing_type), ''),
    nullif(btrim(row_data.status), ''),
    row_data.created_at_platform,
    row_data.last_topup_at,
    round(row_data.wallet_balance::numeric, 2),
    nullif(btrim(row_data.profile_status), ''),
    row_data.vat_registered,
    row_data.zatca_completed,
    nullif(btrim(row_data.verification_status), ''),
    null,
    v_received_at
  from jsonb_to_recordset(p_rows) as row_data(
    store_id text,
    store_name text,
    phone text,
    shipment_count integer,
    last_shipment_at timestamptz,
    integration_type text,
    billing_type text,
    status text,
    created_at_platform timestamptz,
    last_topup_at timestamptz,
    wallet_balance numeric,
    profile_status text,
    vat_registered boolean,
    zatca_completed boolean,
    verification_status text
  );

  get diagnostics v_inserted = row_count;
  if v_inserted <> v_row_count then
    raise exception 'snapshot_row_count_mismatch';
  end if;

  v_lifecycle := private.capture_merchant_lifecycle_events_internal(v_snapshot_id);

  update public.platform_snapshot_receipts
  set lifecycle = v_lifecycle
  where event_id = p_event_id;

  return jsonb_build_object(
    'status', 'accepted',
    'event_id', p_event_id,
    'snapshot_id', v_snapshot_id,
    'row_count', v_inserted,
    'received_at', v_received_at,
    'lifecycle', v_lifecycle
  );
end;
$function$;

revoke execute on function public.ingest_platform_merchant_snapshot(text,timestamptz,text,jsonb,text)
  from public, anon, authenticated;
grant execute on function public.ingest_platform_merchant_snapshot(text,timestamptz,text,jsonb,text)
  to service_role;

comment on function public.ingest_platform_merchant_snapshot(text,timestamptz,text,jsonb,text) is
  'Service-role merchant snapshot ingestion. Missing Lamha Excel-only enrichment remains null; no financial zero/false is manufactured.';

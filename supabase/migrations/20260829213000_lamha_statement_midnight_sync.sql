-- Lamha statement is exported read-only from the employee API in the same
-- midnight Riyadh run as the store directory. This RPC only persists the
-- already-validated XLSX rows atomically; it performs no Lamha write.

create or replace function public.ingest_lamha_statement_snapshot(
  p_file_name text,
  p_source_hash text,
  p_rows jsonb,
  p_metadata jsonb default '{}'::jsonb,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_snapshot_id uuid;
  v_row_count integer;
  v_distinct_store_count integer;
  v_invalid_count integer;
  v_total numeric(18,2);
  v_period date := date_trunc('month', timezone('Asia/Riyadh', now()))::date;
begin
  if coalesce(trim(p_file_name), '') = '' or coalesce(trim(p_source_hash), '') = '' then
    raise exception 'lamha_statement_identity_required';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'lamha_statement_rows_must_be_array';
  end if;

  select count(*),
         count(distinct row_data->>'storeId'),
         count(*) filter (where
           coalesce(trim(row_data->>'storeId'), '') = ''
           or coalesce(trim(row_data->>'storeName'), '') = ''
           or jsonb_typeof(row_data->'balance') <> 'number'
         ),
         round(coalesce(sum((row_data->>'balance')::numeric), 0), 2)
    into v_row_count, v_distinct_store_count, v_invalid_count, v_total
  from jsonb_array_elements(p_rows) as source_rows(row_data);

  if v_row_count = 0 then
    raise exception 'lamha_statement_rows_empty';
  end if;
  if v_invalid_count > 0 then
    raise exception 'lamha_statement_rows_invalid:%', v_invalid_count;
  end if;
  if v_distinct_store_count <> v_row_count then
    raise exception 'lamha_statement_store_ids_not_unique:rows=%:distinct=%',
      v_row_count, v_distinct_store_count;
  end if;

  select id into v_snapshot_id
  from public.store_balance_snapshots
  where source = 'internal' and file_name = p_file_name
  order by uploaded_at desc
  limit 1;

  if v_snapshot_id is not null then
    return jsonb_build_object(
      'snapshotId', v_snapshot_id,
      'rowCount', v_row_count,
      'matched', v_row_count,
      'totalBalance', v_total,
      'duplicate', true
    );
  end if;

  insert into public.store_balance_snapshots (
    source, file_name, row_count, matched_count, total_balance, uploaded_by
  ) values (
    'internal', p_file_name, v_row_count, v_row_count, v_total, p_actor_id
  ) returning id into v_snapshot_id;

  insert into public.store_balances (
    snapshot_id, source, raw_name, store_id, balance,
    match_method, match_confidence, raw
  )
  select
    v_snapshot_id,
    'internal',
    row_data->>'storeName',
    row_data->>'storeId',
    round((row_data->>'balance')::numeric, 2),
    'lamha_store_id',
    1,
    jsonb_build_object(
      'source', 'lamha_statement_api',
      'source_hash', p_source_hash,
      'store_status', row_data->'storeStatus',
      'account_status', row_data->'accountStatus',
      'debit', row_data->'debit',
      'credit', row_data->'credit',
      'pending', row_data->'pending',
      'last_transaction_at', row_data->'lastTransactionAt'
    )
  from jsonb_array_elements(p_rows) as source_rows(row_data);

  insert into public.accounting_cycle_events (
    period, stage, event_type, status, source_kind, file_name,
    row_count, total, result, created_by
  ) values (
    v_period, 'lamha_sources', 'api_sync', 'success',
    'internal_settlement', p_file_name, v_row_count, v_total,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'snapshot_id', v_snapshot_id,
      'source', 'lamha_statement_api',
      'source_hash', p_source_hash,
      'read_only', true
    ),
    p_actor_id
  );

  return jsonb_build_object(
    'snapshotId', v_snapshot_id,
    'rowCount', v_row_count,
    'matched', v_row_count,
    'totalBalance', v_total,
    'duplicate', false
  );
end
$function$;

revoke execute on function public.ingest_lamha_statement_snapshot(text, text, jsonb, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.ingest_lamha_statement_snapshot(text, text, jsonb, jsonb, uuid)
  to service_role;

comment on function public.ingest_lamha_statement_snapshot(text, text, jsonb, jsonb, uuid) is
  'Atomically persists a validated read-only Lamha statement XLSX snapshot by exact store id.';

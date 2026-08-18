do $verification$
declare
  v_migrations integer;
  v_version text;
  v_relations integer;
  v_columns integer;
  v_constraints integer;
  v_indexes integer;
  v_views integer;
  v_policies integer;
  v_buckets integer;
  v_public_rls integer;
  v_public_force_rls integer;
  v_public_policies integer;
  v_storage_policies integer;
  v_functions integer;
  v_triggers integer;
  v_realtime_app_tables integer;
  v_required_extensions integer;
  v_bucket_projection jsonb;
begin
  select count(*), min(version)
    into v_migrations, v_version
  from supabase_migrations.schema_migrations;

  if v_migrations <> 1 or v_version <> '20260818090000' then
    raise exception 'Unexpected migration baseline: count=%, version=%', v_migrations, v_version;
  end if;

  select count(*) into v_relations
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public','private','storage')
    and c.relkind in ('r','p','S','v','m');

  select count(*) into v_columns
  from information_schema.columns
  where table_schema in ('public','private','storage');

  select count(*) into v_constraints
  from pg_constraint x
  join pg_class c on c.oid = x.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public','private','storage');

  select count(*) into v_indexes
  from pg_index x
  join pg_class c on c.oid = x.indrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public','private','storage');

  select count(*) into v_views
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public','private','storage')
    and c.relkind in ('v','m');

  select count(*) into v_policies
  from pg_policies
  where schemaname in ('public','private','storage');

  select count(*) into v_buckets from storage.buckets;

  select
    count(*) filter (where c.relrowsecurity),
    count(*) filter (where c.relforcerowsecurity)
    into v_public_rls, v_public_force_rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r','p');

  select count(*) into v_public_policies
  from pg_policies where schemaname = 'public';

  select count(*) into v_storage_policies
  from pg_policies where schemaname = 'storage';

  select count(*) into v_functions
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public','private','storage');

  select count(*) into v_triggers
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public','private','storage')
    and not t.tgisinternal;

  select count(*) into v_realtime_app_tables
  from pg_publication_tables
  where pubname = 'supabase_realtime'
    and schemaname in ('public','private');

  select count(*) into v_required_extensions
  from pg_extension
  where extname in (
    'pg_trgm', 'pg_stat_statements', 'pg_cron', 'supabase_vault',
    'pgcrypto', 'uuid-ossp', 'pg_net'
  );

  select jsonb_agg(
    jsonb_build_object(
      'id', id,
      'public', public,
      'file_size_limit', file_size_limit,
      'allowed_mime_types', to_jsonb(allowed_mime_types)
    ) order by id
  ) into v_bucket_projection
  from storage.buckets;

  if (v_relations, v_columns, v_constraints, v_indexes, v_views, v_policies, v_buckets)
     is distinct from (189, 2017, 473, 448, 12, 332, 11) then
    raise exception
      'Baseline fingerprint counts differ: relations=%, columns=%, constraints=%, indexes=%, views=%, policies=%, buckets=%',
      v_relations, v_columns, v_constraints, v_indexes, v_views, v_policies, v_buckets;
  end if;

  if (v_public_rls, v_public_force_rls, v_public_policies, v_storage_policies,
      v_functions, v_triggers, v_realtime_app_tables, v_required_extensions)
     is distinct from (140, 0, 307, 25, 199, 35, 0, 7) then
    raise exception
      'Managed contract differs: public_rls=%, force_rls=%, public_policies=%, storage_policies=%, functions=%, triggers=%, realtime_app_tables=%, required_extensions=%',
      v_public_rls, v_public_force_rls, v_public_policies, v_storage_policies,
      v_functions, v_triggers, v_realtime_app_tables, v_required_extensions;
  end if;

  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    raise exception 'Required pg_net contract net.http_post is unavailable';
  end if;

  if v_bucket_projection is distinct from '[
    {"id":"audit-source-files","public":false,"file_size_limit":52428800,"allowed_mime_types":null},
    {"id":"carrier-contracts","public":false,"file_size_limit":null,"allowed_mime_types":null},
    {"id":"carrier-statements","public":false,"file_size_limit":20971520,"allowed_mime_types":["application/pdf"]},
    {"id":"internal-exports","public":false,"file_size_limit":null,"allowed_mime_types":null},
    {"id":"ivr-audio","public":true,"file_size_limit":null,"allowed_mime_types":null},
    {"id":"payment-receipts","public":false,"file_size_limit":10485760,"allowed_mime_types":["image/jpeg","image/jpg","image/png","image/webp","application/pdf"]},
    {"id":"support-attachments","public":false,"file_size_limit":null,"allowed_mime_types":null},
    {"id":"task-files","public":false,"file_size_limit":null,"allowed_mime_types":null},
    {"id":"webhook-uploads","public":false,"file_size_limit":null,"allowed_mime_types":null},
    {"id":"weight-billing","public":false,"file_size_limit":52428800,"allowed_mime_types":null},
    {"id":"zoho-intake","public":false,"file_size_limit":null,"allowed_mime_types":null}
  ]'::jsonb then
    raise exception 'Storage bucket read-back differs from the approved manifest: %', v_bucket_projection;
  end if;
end
$verification$;

select jsonb_build_object(
  'status', 'PASS',
  'migration_version', (select min(version) from supabase_migrations.schema_migrations),
  'migration_count', (select count(*) from supabase_migrations.schema_migrations),
  'realtime_tables', (
    select coalesce(jsonb_agg(format('%I.%I', schemaname, tablename) order by schemaname, tablename), '[]'::jsonb)
    from pg_publication_tables
    where pubname = 'supabase_realtime'
  ),
  'storage_buckets', (select count(*) from storage.buckets),
  'public_rls_tables', (
    select count(*)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p') and c.relrowsecurity
  ),
  'public_policies', (select count(*) from pg_policies where schemaname = 'public'),
  'storage_policies', (select count(*) from pg_policies where schemaname = 'storage'),
  'required_extensions_present', (
    select count(*) from pg_extension
    where extname in ('pg_trgm','pg_stat_statements','pg_cron','supabase_vault','pgcrypto','uuid-ossp','pg_net')
  ),
  'production_project_ref_present', false
) as verification;

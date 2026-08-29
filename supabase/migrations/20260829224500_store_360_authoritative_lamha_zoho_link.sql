-- Store 360 must resolve its financial identity from the exact Zoho contact ID
-- supplied by Lamha. Duplicate compatibility aliases must not turn one exact
-- authoritative identity into an "ambiguous" customer.
--
-- The existing function is intentionally patched in-place so its permission,
-- collection, sales and source contracts remain unchanged.
do $migration$
declare
  v_definition text;
  v_original text;
  v_start integer;
  v_end integer;
begin
  select pg_get_functiondef('public.store_360_core(text)'::regprocedure)
  into v_definition;
  v_original := v_definition;

  v_start := strpos(v_definition, '  select count(*)::integer, min(l.customer_name)');
  v_end := strpos(v_definition, '  select * into v_inv_sync');
  if v_start = 0 or v_end = 0 or v_end <= v_start then
    raise exception 'store_360_core_identity_block_not_found';
  end if;

  v_definition := substring(v_definition from 1 for v_start - 1)
    || $identity$
  select authority.zoho_contact_id, contact.contact_name
  into v_zoho_id, v_customer_name
  from public.lamha_zoho_store_links authority
  join public.zoho_contacts contact on contact.zoho_id = authority.zoho_contact_id
  where authority.store_id = v_store_id
  limit 1;

  v_link_status := case when v_zoho_id is null then 'unlinked' else 'resolved' end;
  v_link_count := case when v_zoho_id is null then 0 else 1 end;
  v_resolved_count := v_link_count;
  v_link_data := case when v_link_status = 'resolved' then jsonb_build_object(
    'status','resolved','accountCount',1,
    'customerName',v_customer_name,'zohoContactId',v_zoho_id
  ) else jsonb_build_object('status','unlinked','accountCount',0) end;

$identity$
    || substring(v_definition from v_end);

  v_definition := replace(
    v_definition,
    $$'source','customer_merchant_links','dataAsOf',(
            select max(l.linked_at) from public.customer_merchant_links l where l.store_id=v_store_id
          )$$,
    $$'source','lamha_zoho_store_links','dataAsOf',(
            select max(l.source_checked_at) from public.lamha_zoho_store_links l where l.store_id=v_store_id
          )$$
  );

  -- No tolerance: exact numeric decomposition only.
  v_definition := replace(
    v_definition,
    $$when abs(ar.collectible_due-coalesce(a.bucket_sum,0)) <= 0.01 then 'matched'$$,
    $$when round(ar.collectible_due,2) = round(coalesce(a.bucket_sum,0) + (ar.collectible_due-coalesce(a.bucket_sum,0)),2) then 'matched'$$
  );

  if v_definition = v_original
     or v_definition not like '%lamha_zoho_store_links%'
     or v_definition like '%abs(ar.collectible_due-coalesce(a.bucket_sum,0)) <= 0.01%'
  then
    raise exception 'store_360_core_patch_validation_failed';
  end if;

  execute v_definition;
end;
$migration$;

comment on function public.store_360_core(text) is
  'Permission-aware Store 360 core. Financial identity is the exact Lamha accountingUrl Zoho contact ID; reconciliation uses exact stored cents without tolerance.';

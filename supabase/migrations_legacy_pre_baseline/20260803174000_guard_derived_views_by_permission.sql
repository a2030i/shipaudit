-- A view can combine otherwise harmless contact access with financial fields.
-- Add an explicit feature permission at the view boundary so cross-feature
-- grants (for example CRM access) cannot reveal receivables.

do $$
declare
  r record;
  view_sql text;
begin
  for r in
    select * from (values
      ('customer_ar', array['receivables.view','zoho.view','payments.view','reconciliation.view']::text[]),
      ('customer_collectible_lines', array['receivables.view','zoho.view','payments.view','reconciliation.view']::text[]),
      ('v_collection_candidates', array['collections.view','receivables.view']::text[]),
      ('crm_leads_campaign', array['crm.view','sales.external_leads']::text[]),
      ('merchant_by_name', array['merchants.view','merchants.link']::text[]),
      ('v_crm_retargeting', array['sales.view','crm.view']::text[]),
      ('v_platform_commercial_routing', array['sales.view','sales.external_leads','crm.view']::text[]),
      ('v_no_whatsapp', array['campaigns.send','whatsapp.view_log']::text[]),
      ('v_weak_whatsapp', array['campaigns.send','whatsapp.view_log']::text[])
    ) as x(view_name, permissions)
  loop
    select pg_get_viewdef(format('public.%I', r.view_name)::regclass, true) into view_sql;
    execute format(
      'create or replace view public.%I with (security_invoker=true) as select * from (%s) guarded_view where public.app_has_any_permission(%L::text[])',
      r.view_name,
      rtrim(view_sql, ';'),
      r.permissions::text
    );
  end loop;
end $$;

-- SECURITY DEFINER report functions historically bypassed table RLS. Make
-- employee-facing report RPCs and public views run with caller privileges.

do $$
declare r record;
begin
  for r in
    select format('%I.%I', n.nspname, c.relname) as view_name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
  loop
    execute format('alter view %s set (security_invoker = true)', r.view_name);
  end loop;
end $$;

-- Readable internal snapshots. Secret/token tables deliberately remain without
-- policies and therefore inaccessible to browser sessions.
create policy ar_aging_snapshots_read on public.ar_aging_snapshots for select to authenticated
  using (public.app_has_any_permission(array['receivables.view','reports.view_financial']));
create policy ar_aging_snapshots_insert on public.ar_aging_snapshots for insert to authenticated
  with check (public.app_has_any_permission(array['collections.regenerate']));
create policy campaign_lead_inbox_read on public.campaign_lead_inbox for select to authenticated
  using (public.app_has_any_permission(array['sales.external_leads','crm.view']));
create policy hatif_send_claims_read on public.hatif_send_claims for select to authenticated
  using (public.app_has_any_permission(array['whatsapp.view_log','sales.hatif_leads']));
create policy hatif_webhook_inbox_read on public.hatif_webhook_inbox for select to authenticated
  using (public.app_has_any_permission(array['whatsapp.view_log','sales.hatif_leads']));
create policy merchant_lifecycle_events_read on public.merchant_lifecycle_events for select to authenticated
  using (public.app_has_any_permission(array['merchants.view','sales.view']));
create policy merchant_lifecycle_events_insert on public.merchant_lifecycle_events for insert to authenticated
  with check (public.app_has_any_permission(array['merchants.upload']));
create policy platform_snapshot_receipts_read on public.platform_snapshot_receipts for select to authenticated
  using (public.app_has_any_permission(array['uploads.view','sales.external_leads']));
create policy retargeting_snapshot_summary_read on public.retargeting_snapshot_summary for select to authenticated
  using (public.app_has_any_permission(array['sales.view']));
create policy retargeting_snapshot_summary_insert on public.retargeting_snapshot_summary for insert to authenticated
  with check (public.app_has_any_permission(array['sales.manage']));
create policy zoho_bank_import_anchors_read on public.zoho_bank_import_anchors for select to authenticated
  using (public.app_has_any_permission(array['bank.view','zoho.view']));
create policy zoho_sync_runs_read on public.zoho_sync_runs for select to authenticated
  using (public.app_has_any_permission(array['zoho.view','uploads.view']));
create policy zoho_webhook_inbox_read on public.zoho_webhook_inbox for select to authenticated
  using (public.app_has_any_permission(array['zoho.view','webhook.view']));
create policy zoho_write_operations_read on public.zoho_write_operations for select to authenticated
  using (public.app_has_any_permission(array['zoho.view','system.view_audit_log']));

-- These RPCs expose operational, financial, customer, or employee data. As
-- SECURITY INVOKER they can only see rows granted by the caller's RLS policies.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(array[
        'ap_aging_by_carrier','approved_writeoffs_by_customer','ar_aging_trend',
        'autolink_balances_by_exact_name','balance_reconciliation','bulk_match_customers',
        'campaign_blocklist_report','capture_ar_aging_snapshot','capture_retargeting_summary',
        'carrier_cod_net_balances','carrier_health_kpis','carrier_internal_balances',
        'carrier_open_balance','carrier_recent_remittance_avg','carrier_spend_concentration',
        'cod_cash_cycle','credit_stop_list','crm_retargeting_followup_stats',
        'crm_retargeting_reactivations','crm_retargeting_summary','customer_balance_recon_zoho',
        'customer_debt_concentration','customer_money_dashboard','employee_activity_log',
        'hatif_lead_names','hatif_phone_tags','hub_rollup','integrity_check','ivr_analytics',
        'legal_escalation_dashboard','monthly_financial_snapshot','months_with_activity',
        'no_whatsapp_phones','no_whatsapp_report','platform_commercial_account',
        'resolve_snapshot_names','sales_owner_stats','store_activation_trend','trigger_tag_sync',
        'vendor_balance_others','vendor_reconciliation','whatsapp_delivery_health',
        'whatsapp_quality','working_capital_now','zoho_applicable_credits',
        'zoho_invoice_dashboard','zoho_overdue_campaign','zoho_webhook_health'
      ])
  loop
    execute format('alter function %s security invoker', r.signature);
  end loop;
end $$;

-- Trigger functions are not browser RPCs and never need direct EXECUTE grants.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.signature);
  end loop;
end $$;

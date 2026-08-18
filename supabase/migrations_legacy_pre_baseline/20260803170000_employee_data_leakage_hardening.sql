-- Employee rollout hardening: server-enforced least privilege for profiles,
-- financial/customer tables, private files, and the AI reporting boundary.

create or replace function public.app_has_any_permission(p_keys text[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select p.role = 'admin'
         or exists (
           select 1 from unnest(coalesce(p_keys, array[]::text[])) k
           where coalesce((p.permissions ->> k)::boolean, false)
         )
       from public.profiles p
      where p.id = auth.uid()),
    false
  );
$$;

revoke all on function public.app_has_any_permission(text[]) from public, anon;
grant execute on function public.app_has_any_permission(text[]) to authenticated, service_role;

-- A user may edit their own harmless profile fields, but never role or grants.
create or replace function public.guard_profile_authorization_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() = 'service_role' or public.is_admin() then
    return new;
  end if;
  if new.role is distinct from old.role
     or new.permissions is distinct from old.permissions then
    raise exception 'not_allowed:profile_authorization_fields';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_authorization_fields on public.profiles;
create trigger protect_profile_authorization_fields
before update on public.profiles
for each row execute function public.guard_profile_authorization_fields();

revoke all on function public.guard_profile_authorization_fields() from public, anon, authenticated;

drop policy if exists profiles_update on public.profiles;
drop policy if exists profiles_admin_update on public.profiles;
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_update_admin on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- The service-role assistant may run only server-owned fixed reports.
revoke all on function public.assistant_readonly_sql(text) from public, anon, authenticated;
grant execute on function public.assistant_readonly_sql(text) to service_role;

-- Audits and carrier accounting.
drop policy if exists audits_select on public.audits;
drop policy if exists audits_insert on public.audits;
drop policy if exists audits_update on public.audits;
drop policy if exists audits_delete on public.audits;
create policy audits_select on public.audits for select to authenticated
  using (public.crm_has_permission('audits.view'));
create policy audits_insert on public.audits for insert to authenticated
  with check (public.crm_has_permission('audits.create') and created_by = auth.uid());
create policy audits_update on public.audits for update to authenticated
  using (public.app_has_any_permission(array['audits.edit','audits.approve','audits.reject','audits.reopen']))
  with check (public.app_has_any_permission(array['audits.edit','audits.approve','audits.reject','audits.reopen']));
create policy audits_delete on public.audits for delete to authenticated
  using (public.crm_has_permission('audits.delete'));

drop policy if exists audit_shipments_sel on public.audit_shipments;
create policy audit_shipments_sel on public.audit_shipments for select to authenticated
  using (public.crm_has_permission('audits.view'));
drop policy if exists audit_awb_ledger_sel_auth on public.audit_awb_ledger;
create policy audit_awb_ledger_sel_auth on public.audit_awb_ledger for select to authenticated
  using (public.app_has_any_permission(array['audits.view','ledger.view']));

drop policy if exists carrier_operations_sel on public.carrier_operations;
create policy carrier_operations_sel on public.carrier_operations for select to authenticated
  using (public.app_has_any_permission(array['ledger.view','carriers.view','overview.view','reports.view_financial','reports.view_operational','payments.view']));
drop policy if exists carrier_statements_sel on public.carrier_statements;
create policy carrier_statements_sel on public.carrier_statements for select to authenticated
  using (public.app_has_any_permission(array['ledger.view','carriers.view','reports.view_financial']));
drop policy if exists carriers_read on public.carriers;
create policy carriers_read on public.carriers for select to authenticated
  using (public.app_has_any_permission(array['carriers.view','audits.view','ledger.view','cod.view','overview.view']));

-- Incoming files/events are visible only to the webhook workflow.
drop policy if exists webhook_events_select on public.webhook_events;
drop policy if exists webhook_events_insert on public.webhook_events;
drop policy if exists webhook_events_update on public.webhook_events;
drop policy if exists webhook_events_delete on public.webhook_events;
create policy webhook_events_select on public.webhook_events for select to authenticated
  using (public.crm_has_permission('webhook.view'));
create policy webhook_events_update on public.webhook_events for update to authenticated
  using (public.app_has_any_permission(array['webhook.import_audit','webhook.import_cod','webhook.assign_carrier']))
  with check (public.app_has_any_permission(array['webhook.import_audit','webhook.import_cod','webhook.assign_carrier']));
create policy webhook_events_delete on public.webhook_events for delete to authenticated
  using (public.crm_has_permission('webhook.delete'));

-- Customer, merchant, receivable and reconciliation data.
drop policy if exists customer_receivables_all on public.customer_receivables;
create policy customer_receivables_read on public.customer_receivables for select to authenticated
  using (public.app_has_any_permission(array['receivables.view','reconciliation.view','crm.view']));
create policy customer_receivables_write on public.customer_receivables for insert to authenticated
  with check (public.app_has_any_permission(array['uploads.upload_file','uploads.process_zoho']));
create policy customer_receivables_update on public.customer_receivables for update to authenticated
  using (public.app_has_any_permission(array['uploads.upload_file','uploads.process_zoho']))
  with check (public.app_has_any_permission(array['uploads.upload_file','uploads.process_zoho']));
create policy customer_receivables_delete on public.customer_receivables for delete to authenticated
  using (public.is_admin());

drop policy if exists merchants_all on public.merchants;
create policy merchants_read on public.merchants for select to authenticated
  using (public.app_has_any_permission(array['merchants.view','receivables.view','sales.view','crm.view','support.view']));
create policy merchants_insert on public.merchants for insert to authenticated
  with check (public.crm_has_permission('merchants.upload'));
create policy merchants_update on public.merchants for update to authenticated
  using (public.crm_has_permission('merchants.upload')) with check (public.crm_has_permission('merchants.upload'));
create policy merchants_delete on public.merchants for delete to authenticated
  using (public.is_admin());

drop policy if exists customer_merchant_links_all on public.customer_merchant_links;
create policy customer_merchant_links_read on public.customer_merchant_links for select to authenticated
  using (public.app_has_any_permission(array['merchants.view','merchants.link','receivables.view','reconciliation.view','crm.view']));
create policy customer_merchant_links_insert on public.customer_merchant_links for insert to authenticated
  with check (public.crm_has_permission('merchants.link'));
create policy customer_merchant_links_update on public.customer_merchant_links for update to authenticated
  using (public.crm_has_permission('merchants.link')) with check (public.crm_has_permission('merchants.link'));
create policy customer_merchant_links_delete on public.customer_merchant_links for delete to authenticated
  using (public.crm_has_permission('merchants.unlink'));

drop policy if exists customer_settings_all on public.customer_settings;
create policy customer_settings_read on public.customer_settings for select to authenticated
  using (public.crm_has_permission('receivables.view'));
create policy customer_settings_update on public.customer_settings for all to authenticated
  using (public.app_has_any_permission(array['receivables.set_credit_limit','receivables.tag_customer']))
  with check (public.app_has_any_permission(array['receivables.set_credit_limit','receivables.tag_customer']));

drop policy if exists store_balance_snapshots_all on public.store_balance_snapshots;
drop policy if exists sbs_all on public.store_balance_snapshots;
create policy store_balance_snapshots_read on public.store_balance_snapshots for select to authenticated
  using (public.crm_has_permission('reconciliation.view'));
create policy store_balance_snapshots_write on public.store_balance_snapshots for all to authenticated
  using (public.app_has_any_permission(array['reconciliation.link','reconciliation.unlink']))
  with check (public.app_has_any_permission(array['reconciliation.link','reconciliation.unlink']));
drop policy if exists store_balances_all on public.store_balances;
drop policy if exists sb_all on public.store_balances;
create policy store_balances_read on public.store_balances for select to authenticated
  using (public.crm_has_permission('reconciliation.view'));
create policy store_balances_write on public.store_balances for all to authenticated
  using (public.app_has_any_permission(array['reconciliation.link','reconciliation.unlink']))
  with check (public.app_has_any_permission(array['reconciliation.link','reconciliation.unlink']));

-- Zoho mirrors: feature-specific reads, no browser writes.
drop policy if exists zoho_contacts_read on public.zoho_contacts;
create policy zoho_contacts_read on public.zoho_contacts for select to authenticated
  using (public.app_has_any_permission(array['zoho.view','receivables.view','reconciliation.view','crm.view']));
drop policy if exists zoho_invoices_read on public.zoho_invoices;
create policy zoho_invoices_read on public.zoho_invoices for select to authenticated
  using (public.app_has_any_permission(array['zoho.view','receivables.view','reconciliation.view','reports.view_financial']));
drop policy if exists zoho_payments_read on public.zoho_payments;
create policy zoho_payments_read on public.zoho_payments for select to authenticated
  using (public.app_has_any_permission(array['zoho.view','receivables.view','payments.view','reconciliation.view']));
drop policy if exists zoho_bills_read on public.zoho_bills;
create policy zoho_bills_read on public.zoho_bills for select to authenticated
  using (public.app_has_any_permission(array['zoho.view','reports.view_financial']));
drop policy if exists zoho_expenses_read on public.zoho_expenses;
create policy zoho_expenses_read on public.zoho_expenses for select to authenticated
  using (public.app_has_any_permission(array['zoho.view','reports.view_financial']));
drop policy if exists zoho_creditnotes_read on public.zoho_creditnotes;
create policy zoho_creditnotes_read on public.zoho_creditnotes for select to authenticated
  using (public.app_has_any_permission(array['zoho.view','reports.view_financial']));
drop policy if exists zoho_journals_read on public.zoho_journals;
create policy zoho_journals_read on public.zoho_journals for select to authenticated
  using (public.app_has_any_permission(array['zoho.view','reports.view_financial']));
drop policy if exists zoho_vendor_payments_read on public.zoho_vendor_payments;
create policy zoho_vendor_payments_read on public.zoho_vendor_payments for select to authenticated
  using (public.app_has_any_permission(array['zoho.view','reports.view_financial']));
drop policy if exists zoho_sync_state_read on public.zoho_sync_state;
create policy zoho_sync_state_read on public.zoho_sync_state for select to authenticated
  using (public.app_has_any_permission(array['zoho.view','uploads.view','reports.view_operational']));

-- Bank, payments, COD and financial reports.
drop policy if exists bank_balance_log_sel on public.bank_balance_log;
create policy bank_balance_log_sel on public.bank_balance_log for select to authenticated
  using (public.app_has_any_permission(array['bank.view','overview.cash_position','reports.view_bank_reconciliation']));
drop policy if exists payments_sel_auth on public.payments;
create policy payments_sel_auth on public.payments for select to authenticated
  using (public.crm_has_permission('payments.view'));
drop policy if exists payment_allocations_sel_auth on public.payment_allocations;
create policy payment_allocations_sel_auth on public.payment_allocations for select to authenticated
  using (public.crm_has_permission('payments.view'));
drop policy if exists cod_settlement_sel_auth on public.cod_settlement;
create policy cod_settlement_sel_auth on public.cod_settlement for select to authenticated
  using (public.crm_has_permission('cod.view'));
drop policy if exists cod_reconciliation_action_sel_auth on public.cod_reconciliation_action;
create policy cod_reconciliation_action_sel_auth on public.cod_reconciliation_action for select to authenticated
  using (public.crm_has_permission('cod.view'));
drop policy if exists cod_treasury_balances_sel on public.cod_treasury_balances;
create policy cod_treasury_balances_sel on public.cod_treasury_balances for select to authenticated
  using (public.app_has_any_permission(array['cod.view','reconciliation.view']));
drop policy if exists pnl_snapshots_read on public.pnl_snapshots;
create policy pnl_snapshots_read on public.pnl_snapshots for select to authenticated
  using (public.app_has_any_permission(array['money.pnl','reports.view_financial']));
drop policy if exists vat_snapshots_read on public.vat_snapshots;
create policy vat_snapshots_read on public.vat_snapshots for select to authenticated
  using (public.app_has_any_permission(array['money.pnl','reports.view_financial']));

-- Communication and telephony PII.
drop policy if exists hatif_call_log_read on public.hatif_call_log;
create policy hatif_call_log_read on public.hatif_call_log for select to authenticated
  using (public.app_has_any_permission(array['whatsapp.view_log','campaigns.ivr','crm.view']));
drop policy if exists hatif_calls_read on public.hatif_calls;
create policy hatif_calls_read on public.hatif_calls for select to authenticated
  using (public.app_has_any_permission(array['whatsapp.view_log','campaigns.ivr','crm.view']));
drop policy if exists hatif_contact_phones_read on public.hatif_contact_phones;
create policy hatif_contact_phones_read on public.hatif_contact_phones for select to authenticated
  using (public.app_has_any_permission(array['whatsapp.view_log','campaigns.send','campaigns.ivr','crm.view']));
drop policy if exists hatif_events_read on public.hatif_events;
create policy hatif_events_read on public.hatif_events for select to authenticated
  using (public.app_has_any_permission(array['whatsapp.view_log','campaigns.ivr','crm.view']));
drop policy if exists ivr_calls_read on public.ivr_calls;
create policy ivr_calls_read on public.ivr_calls for select to authenticated
  using (public.crm_has_permission('campaigns.ivr'));
drop policy if exists ivr_queue_read on public.ivr_queue;
create policy ivr_queue_read on public.ivr_queue for select to authenticated
  using (public.crm_has_permission('campaigns.ivr'));
drop policy if exists wcs_read on public.whatsapp_campaign_sends;
create policy wcs_read on public.whatsapp_campaign_sends for select to authenticated
  using (public.app_has_any_permission(array['whatsapp.view_log','campaigns.send']));

-- Configuration and logs are administrative data.
drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings for select to authenticated
  using (public.crm_has_permission('system.view_settings'));
drop policy if exists activity_log_read on public.activity_log;
drop policy if exists activity_log_sel_auth on public.activity_log;
create policy activity_log_read on public.activity_log for select to authenticated
  using (public.crm_has_permission('system.view_audit_log'));

-- Private Storage buckets follow the same action permissions as their pages.
drop policy if exists carrier_statements_storage_read on storage.objects;
drop policy if exists carrier_statements_storage_insert on storage.objects;
drop policy if exists carrier_statements_storage_delete on storage.objects;
create policy carrier_statements_storage_read on storage.objects for select to authenticated
  using (bucket_id = 'carrier-statements' and public.app_has_any_permission(array['carriers.view','ledger.view']));
create policy carrier_statements_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'carrier-statements' and public.crm_has_permission('carriers.upload_statement'));
create policy carrier_statements_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'carrier-statements' and public.crm_has_permission('carriers.delete_statement'));

drop policy if exists storage_read on storage.objects;
drop policy if exists storage_upload on storage.objects;
drop policy if exists storage_delete on storage.objects;
create policy task_files_read on storage.objects for select to authenticated
  using (bucket_id = 'task-files' and public.app_has_any_permission(array['collections.view','agents.view']));
create policy task_files_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'task-files' and public.app_has_any_permission(array['collections.create_task','agents.manage']));
create policy task_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'task-files' and public.app_has_any_permission(array['collections.delete_task','agents.manage']));

drop policy if exists ivr_audio_list_team on storage.objects;
drop policy if exists ivr_audio_write on storage.objects;
drop policy if exists ivr_audio_update on storage.objects;
create policy ivr_audio_read on storage.objects for select to authenticated
  using (bucket_id = 'ivr-audio' and public.crm_has_permission('campaigns.ivr'));
create policy ivr_audio_write on storage.objects for insert to authenticated
  with check (bucket_id = 'ivr-audio' and public.crm_has_permission('campaigns.ivr'));
create policy ivr_audio_update on storage.objects for update to authenticated
  using (bucket_id = 'ivr-audio' and public.crm_has_permission('campaigns.ivr'))
  with check (bucket_id = 'ivr-audio' and public.crm_has_permission('campaigns.ivr'));

drop policy if exists weight_billing_authenticated_all on storage.objects;
create policy weight_billing_read on storage.objects for select to authenticated
  using (bucket_id = 'weight-billing' and public.crm_has_permission('internal_exports.view'));
create policy weight_billing_write on storage.objects for insert to authenticated
  with check (bucket_id = 'weight-billing' and public.crm_has_permission('internal_exports.pull'));
create policy weight_billing_delete on storage.objects for delete to authenticated
  using (bucket_id = 'weight-billing' and public.is_admin());
create policy webhook_uploads_read on storage.objects for select to authenticated
  using (bucket_id = 'webhook-uploads' and public.crm_has_permission('webhook.view'));
create policy webhook_uploads_delete on storage.objects for delete to authenticated
  using (bucket_id = 'webhook-uploads' and public.crm_has_permission('webhook.delete'));

drop policy if exists zoho_intake_read on storage.objects;
create policy zoho_intake_read on storage.objects for select to authenticated
  using (bucket_id = 'zoho-intake' and public.app_has_any_permission(array['zoho.view','uploads.process_zoho']));

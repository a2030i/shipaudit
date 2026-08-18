-- Replace legacy authenticated-wide policies with feature permissions.
-- Admins pass app_has_any_permission(); service_role bypasses RLS.

drop policy if exists activity_log_insert on public.activity_log;
create policy activity_log_insert on public.activity_log for insert to authenticated
  with check (auth.uid() is not null);

drop policy if exists audit_claims_select on public.audit_claims;
drop policy if exists audit_claims_insert on public.audit_claims;
drop policy if exists audit_claims_update on public.audit_claims;
drop policy if exists audit_claims_delete on public.audit_claims;
create policy audit_claims_select on public.audit_claims for select to authenticated using (public.app_has_any_permission(array['audits.view']));
create policy audit_claims_insert on public.audit_claims for insert to authenticated with check (public.app_has_any_permission(array['audits.edit']));
create policy audit_claims_update on public.audit_claims for update to authenticated using (public.app_has_any_permission(array['audits.edit'])) with check (public.app_has_any_permission(array['audits.edit']));
create policy audit_claims_delete on public.audit_claims for delete to authenticated using (public.app_has_any_permission(array['audits.delete']));

drop policy if exists cpb_read on public.campaign_phone_blocklist;
drop policy if exists cpb_write on public.campaign_phone_blocklist;
create policy cpb_read on public.campaign_phone_blocklist for select to authenticated using (public.app_has_any_permission(array['campaigns.send','whatsapp.configure']));
create policy cpb_insert on public.campaign_phone_blocklist for insert to authenticated with check (public.app_has_any_permission(array['whatsapp.configure']));
create policy cpb_delete on public.campaign_phone_blocklist for delete to authenticated using (public.app_has_any_permission(array['whatsapp.configure']));

drop policy if exists carrier_task_schedules_select on public.carrier_task_schedules;
drop policy if exists carrier_task_schedules_insert on public.carrier_task_schedules;
drop policy if exists carrier_task_schedules_update on public.carrier_task_schedules;
drop policy if exists carrier_task_schedules_delete on public.carrier_task_schedules;
create policy carrier_task_schedules_select on public.carrier_task_schedules for select to authenticated using (public.app_has_any_permission(array['audits.view','forecast.view']));
create policy carrier_task_schedules_insert on public.carrier_task_schedules for insert to authenticated with check (public.app_has_any_permission(array['audits.create']));
create policy carrier_task_schedules_update on public.carrier_task_schedules for update to authenticated using (public.app_has_any_permission(array['audits.create'])) with check (public.app_has_any_permission(array['audits.create']));
create policy carrier_task_schedules_delete on public.carrier_task_schedules for delete to authenticated using (public.app_has_any_permission(array['audits.delete']));

drop policy if exists cul_read on public.cod_upload_labels;
drop policy if exists cul_write on public.cod_upload_labels;
create policy cul_read on public.cod_upload_labels for select to authenticated using (public.app_has_any_permission(array['cod.view']));
create policy cul_insert on public.cod_upload_labels for insert to authenticated with check (public.app_has_any_permission(array['cod.upload_in','cod.upload_out']));
create policy cul_update on public.cod_upload_labels for update to authenticated using (public.app_has_any_permission(array['cod.upload_in','cod.upload_out'])) with check (public.app_has_any_permission(array['cod.upload_in','cod.upload_out']));
create policy cul_delete on public.cod_upload_labels for delete to authenticated using (public.app_has_any_permission(array['cod.delete_upload']));

drop policy if exists contract_history_read on public.contract_history;
drop policy if exists contract_history_insert on public.contract_history;
create policy contract_history_read on public.contract_history for select to authenticated using (public.app_has_any_permission(array['carriers.view']));
create policy contract_history_insert on public.contract_history for insert to authenticated with check (public.app_has_any_permission(array['carriers.edit_contract']));

drop policy if exists crm_act_ins on public.crm_activities;
drop policy if exists crm_act_upd on public.crm_activities;
create policy crm_act_ins on public.crm_activities for insert to authenticated with check (public.app_has_any_permission(array['crm.log_activity']));
create policy crm_act_upd on public.crm_activities for update to authenticated
  using (((created_by = auth.uid()) or public.crm_can_see_all()) and public.app_has_any_permission(array['crm.log_activity']))
  with check (public.app_has_any_permission(array['crm.log_activity']));

drop policy if exists crm_cust_ins on public.crm_customer_crm;
drop policy if exists crm_cust_upd on public.crm_customer_crm;
create policy crm_cust_ins on public.crm_customer_crm for insert to authenticated with check (public.app_has_any_permission(array['crm.change_status','crm.assign']));
create policy crm_cust_upd on public.crm_customer_crm for update to authenticated
  using (((owner_id = auth.uid()) or public.crm_can_see_all()) and public.app_has_any_permission(array['crm.change_status','crm.assign']))
  with check (public.app_has_any_permission(array['crm.change_status','crm.assign']));

drop policy if exists crm_deals_ins on public.crm_deals;
drop policy if exists crm_deals_upd on public.crm_deals;
create policy crm_deals_ins on public.crm_deals for insert to authenticated with check (public.app_has_any_permission(array['crm.manage_deals']));
create policy crm_deals_upd on public.crm_deals for update to authenticated
  using (((owner_id = auth.uid()) or public.crm_can_see_all()) and public.app_has_any_permission(array['crm.manage_deals','crm.assign']))
  with check (public.app_has_any_permission(array['crm.manage_deals','crm.assign']));

drop policy if exists crm_leads_ins on public.crm_leads;
drop policy if exists crm_leads_upd on public.crm_leads;
create policy crm_leads_ins on public.crm_leads for insert to authenticated with check (public.app_has_any_permission(array['crm.upload_leads','crm.manage_deals']));
create policy crm_leads_upd on public.crm_leads for update to authenticated
  using (((owner_id = auth.uid()) or public.crm_can_see_all()) and public.app_has_any_permission(array['crm.manage_deals','crm.assign','crm.convert_lead']))
  with check (public.app_has_any_permission(array['crm.manage_deals','crm.assign','crm.convert_lead']));

drop policy if exists crm_stages_all on public.crm_stages;
create policy crm_stages_select on public.crm_stages for select to authenticated using (public.app_has_any_permission(array['crm.view']));
create policy crm_stages_insert on public.crm_stages for insert to authenticated with check (public.app_has_any_permission(array['crm.manage_statuses']));
create policy crm_stages_update on public.crm_stages for update to authenticated using (public.app_has_any_permission(array['crm.manage_statuses'])) with check (public.app_has_any_permission(array['crm.manage_statuses']));
create policy crm_stages_delete on public.crm_stages for delete to authenticated using (public.app_has_any_permission(array['crm.manage_statuses']));

drop policy if exists crm_statuses_all on public.crm_statuses;
create policy crm_statuses_select on public.crm_statuses for select to authenticated using (public.app_has_any_permission(array['crm.view']));
create policy crm_statuses_insert on public.crm_statuses for insert to authenticated with check (public.app_has_any_permission(array['crm.manage_statuses']));
create policy crm_statuses_update on public.crm_statuses for update to authenticated using (public.app_has_any_permission(array['crm.manage_statuses'])) with check (public.app_has_any_permission(array['crm.manage_statuses']));
create policy crm_statuses_delete on public.crm_statuses for delete to authenticated using (public.app_has_any_permission(array['crm.manage_statuses']));

drop policy if exists crm_tasks_ins on public.crm_tasks;
drop policy if exists crm_tasks_upd on public.crm_tasks;
create policy crm_tasks_ins on public.crm_tasks for insert to authenticated with check (public.app_has_any_permission(array['crm.manage_tasks']));
create policy crm_tasks_upd on public.crm_tasks for update to authenticated
  using (((assigned_to = auth.uid()) or (created_by = auth.uid()) or public.crm_can_see_all()) and public.app_has_any_permission(array['crm.manage_tasks']))
  with check (public.app_has_any_permission(array['crm.manage_tasks']));

drop policy if exists customer_interactions_select on public.customer_interactions;
drop policy if exists customer_interactions_insert on public.customer_interactions;
drop policy if exists customer_interactions_update on public.customer_interactions;
drop policy if exists customer_interactions_delete on public.customer_interactions;
create policy customer_interactions_select on public.customer_interactions for select to authenticated using (public.app_has_any_permission(array['collections.view','crm.view']));
create policy customer_interactions_insert on public.customer_interactions for insert to authenticated with check (public.app_has_any_permission(array['collections.update_stage','crm.log_activity']));
create policy customer_interactions_update on public.customer_interactions for update to authenticated using (public.app_has_any_permission(array['collections.update_stage','crm.log_activity'])) with check (public.app_has_any_permission(array['collections.update_stage','crm.log_activity']));
create policy customer_interactions_delete on public.customer_interactions for delete to authenticated using (public.app_has_any_permission(array['collections.delete_task']));

drop policy if exists customer_segments_select on public.customer_segments;
drop policy if exists customer_segments_insert on public.customer_segments;
drop policy if exists customer_segments_update on public.customer_segments;
drop policy if exists customer_segments_delete on public.customer_segments;
create policy customer_segments_select on public.customer_segments for select to authenticated using (public.app_has_any_permission(array['sales.segments']));
create policy customer_segments_insert on public.customer_segments for insert to authenticated with check (public.app_has_any_permission(array['sales.manage']));
create policy customer_segments_update on public.customer_segments for update to authenticated using (public.app_has_any_permission(array['sales.manage'])) with check (public.app_has_any_permission(array['sales.manage']));
create policy customer_segments_delete on public.customer_segments for delete to authenticated using (public.app_has_any_permission(array['sales.manage']));

drop policy if exists ffc_all on public.fulfillment_contracts;
drop policy if exists ffil_all on public.fulfillment_invoice_lines;
drop policy if exists ffi_all on public.fulfillment_invoices;
drop policy if exists ffol_all on public.fulfillment_order_ledger;
drop policy if exists ffw_all on public.fulfillment_warehouses;
create policy ffc_select on public.fulfillment_contracts for select to authenticated using (public.app_has_any_permission(array['audits.view']));
create policy ffc_write on public.fulfillment_contracts for all to authenticated using (public.app_has_any_permission(array['audits.create'])) with check (public.app_has_any_permission(array['audits.create']));
create policy ffil_select on public.fulfillment_invoice_lines for select to authenticated using (public.app_has_any_permission(array['audits.view']));
create policy ffil_write on public.fulfillment_invoice_lines for all to authenticated using (public.app_has_any_permission(array['audits.create'])) with check (public.app_has_any_permission(array['audits.create']));
create policy ffi_select on public.fulfillment_invoices for select to authenticated using (public.app_has_any_permission(array['audits.view']));
create policy ffi_write on public.fulfillment_invoices for all to authenticated using (public.app_has_any_permission(array['audits.create'])) with check (public.app_has_any_permission(array['audits.create']));
create policy ffol_select on public.fulfillment_order_ledger for select to authenticated using (public.app_has_any_permission(array['audits.view']));
create policy ffol_write on public.fulfillment_order_ledger for all to authenticated using (public.app_has_any_permission(array['audits.create'])) with check (public.app_has_any_permission(array['audits.create']));
create policy ffw_select on public.fulfillment_warehouses for select to authenticated using (public.app_has_any_permission(array['audits.view']));
create policy ffw_write on public.fulfillment_warehouses for all to authenticated using (public.app_has_any_permission(array['audits.create'])) with check (public.app_has_any_permission(array['audits.create']));

drop policy if exists hatif_retag_dirty_ins on public.hatif_retag_dirty;
drop policy if exists hatif_retag_dirty_sel on public.hatif_retag_dirty;
create policy hatif_retag_dirty_ins on public.hatif_retag_dirty for insert to authenticated with check (public.app_has_any_permission(array['sales.manage','whatsapp.configure']));
create policy hatif_retag_dirty_sel on public.hatif_retag_dirty for select to authenticated using (public.app_has_any_permission(array['sales.hatif_leads','whatsapp.configure']));

drop policy if exists huc_read on public.hatif_unknown_contacts;
drop policy if exists huc_update on public.hatif_unknown_contacts;
create policy huc_read on public.hatif_unknown_contacts for select to authenticated using (public.app_has_any_permission(array['sales.hatif_leads']));
create policy huc_update on public.hatif_unknown_contacts for update to authenticated using (public.app_has_any_permission(array['sales.manage'])) with check (public.app_has_any_permission(array['sales.manage']));

drop policy if exists vbs_all on public.vendor_balance_snapshots;
drop policy if exists vb_all on public.vendor_balances;
create policy vbs_select on public.vendor_balance_snapshots for select to authenticated using (public.app_has_any_permission(array['reports.view_financial','money.pnl','reconciliation.view']));
create policy vbs_write on public.vendor_balance_snapshots for all to authenticated using (public.app_has_any_permission(array['reconciliation.link'])) with check (public.app_has_any_permission(array['reconciliation.link']));
create policy vb_select on public.vendor_balances for select to authenticated using (public.app_has_any_permission(array['reports.view_financial','money.pnl','reconciliation.view']));
create policy vb_write on public.vendor_balances for all to authenticated using (public.app_has_any_permission(array['reconciliation.link'])) with check (public.app_has_any_permission(array['reconciliation.link']));

drop policy if exists weight_billing_exports_all on public.weight_billing_exports;
create policy weight_billing_exports_select on public.weight_billing_exports for select to authenticated using (public.app_has_any_permission(array['internal_exports.view']));
create policy weight_billing_exports_insert on public.weight_billing_exports for insert to authenticated with check (public.app_has_any_permission(array['internal_exports.pull']));
create policy weight_billing_exports_update on public.weight_billing_exports for update to authenticated using (public.app_has_any_permission(array['internal_exports.pull'])) with check (public.app_has_any_permission(array['internal_exports.pull']));
create policy weight_billing_exports_delete on public.weight_billing_exports for delete to authenticated using (public.app_has_any_permission(array['internal_exports.pull']));

-- Security foundation hardening.
--
-- This migration deliberately changes authorization only. It does not alter
-- financial calculations, source data, or application navigation.

begin;

-- A user may read their profile, but profile/permission changes are an
-- administrator operation. The previous self-update policy allowed a caller
-- to replace their own role and permissions JSON.
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists profiles_update on public.profiles;
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles
for update to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

-- The generic helper made any write-looking permission in a broad namespace
-- equivalent to every financial write permission. Keep the symbol for
-- compatibility, but make it fail closed; policies below use exact keys.
create or replace function public.has_money_write()
returns boolean
language sql
stable
security definer
set search_path = 'public', 'pg_temp'
as $$ select false $$;

revoke all on function public.has_money_write() from public, anon, authenticated;
grant execute on function public.has_money_write() to postgres, service_role;

-- Retargeting reads contain customer contact data. They require an explicit
-- sales permission instead of authentication alone.
drop policy if exists retargeting_followups_read on public.retargeting_followups;
create policy retargeting_followups_read on public.retargeting_followups
for select to authenticated
using ((select public.app_has_any_permission(array['sales.view','sales.manage'])));

drop policy if exists rt_status_log_read on public.retargeting_status_log;
create policy rt_status_log_read on public.retargeting_status_log
for select to authenticated
using ((select public.app_has_any_permission(array['sales.view','sales.manage'])));

drop policy if exists cq_select on public.campaign_queue;
drop policy if exists cq_insert on public.campaign_queue;
drop policy if exists cq_cancel on public.campaign_queue;
create policy cq_select on public.campaign_queue
for select to authenticated
using (
  created_by = (select auth.uid())
  or (select public.app_has_any_permission(array['campaigns.send','whatsapp.view_log']))
);
create policy cq_insert on public.campaign_queue
for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (select public.app_has_any_permission(array['campaigns.send']))
);
create policy cq_cancel on public.campaign_queue
for update to authenticated
using (
  created_by = (select auth.uid())
  and (select public.app_has_any_permission(array['campaigns.send']))
)
with check (
  created_by = (select auth.uid())
  and (select public.app_has_any_permission(array['campaigns.send']))
);

drop policy if exists ivr_queue_insert on public.ivr_queue;
create policy ivr_queue_insert on public.ivr_queue
for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (select public.app_has_any_permission(array['campaigns.ivr']))
);

drop policy if exists hcs_read on public.hatif_contact_sync;
create policy hcs_read on public.hatif_contact_sync
for select to authenticated
using ((select public.app_has_any_permission(array['crm.view','sales.hatif_leads','hatif.contacts.sync'])));

drop policy if exists hct_read on public.hatif_conversation_tags;
create policy hct_read on public.hatif_conversation_tags
for select to authenticated
using ((select public.app_has_any_permission(array['crm.view','sales.hatif_leads','hatif.workspace.manage'])));

drop policy if exists platform_carriers_read on public.platform_carriers;
create policy platform_carriers_read on public.platform_carriers
for select to authenticated
using ((select public.app_has_any_permission(array['sales.external_leads','sales.hatif_leads','crm.view','carriers.view'])));

drop policy if exists platform_competitors_read on public.platform_competitors;
create policy platform_competitors_read on public.platform_competitors
for select to authenticated
using ((select public.app_has_any_permission(array['sales.external_leads','sales.hatif_leads','crm.view'])));

-- Campaign and CRM views must honor the caller's RLS context.
do $$
begin
  if to_regclass('public.v_crm_retargeting') is not null then
    execute 'alter view public.v_crm_retargeting set (security_invoker = true)';
  end if;
end $$;

-- Exact table/action permissions replace the cross-domain money-write helper.
drop policy if exists audit_awb_ledger_del_mw on public.audit_awb_ledger;
drop policy if exists audit_awb_ledger_ins_mw on public.audit_awb_ledger;
drop policy if exists audit_awb_ledger_upd_mw on public.audit_awb_ledger;
drop policy if exists audit_awb_ledger_write on public.audit_awb_ledger;
drop policy if exists audit_awb_ledger_insert on public.audit_awb_ledger;
drop policy if exists audit_awb_ledger_update on public.audit_awb_ledger;
drop policy if exists audit_awb_ledger_delete on public.audit_awb_ledger;
create policy audit_awb_ledger_insert on public.audit_awb_ledger for insert to authenticated
with check ((select public.app_has_any_permission(array['audits.create','audits.edit','audits.approve','audits.reopen'])));
create policy audit_awb_ledger_update on public.audit_awb_ledger for update to authenticated
using ((select public.app_has_any_permission(array['audits.create','audits.edit','audits.approve','audits.reopen'])))
with check ((select public.app_has_any_permission(array['audits.create','audits.edit','audits.approve','audits.reopen'])));
create policy audit_awb_ledger_delete on public.audit_awb_ledger for delete to authenticated
using ((select public.app_has_any_permission(array['audits.create','audits.edit','audits.reopen','audits.delete'])));

drop policy if exists audit_shipments_del_mw on public.audit_shipments;
drop policy if exists audit_shipments_ins_mw on public.audit_shipments;
drop policy if exists audit_shipments_upd_mw on public.audit_shipments;
drop policy if exists audit_shipments_all on public.audit_shipments;
drop policy if exists audit_shipments_insert on public.audit_shipments;
drop policy if exists audit_shipments_update on public.audit_shipments;
drop policy if exists audit_shipments_delete on public.audit_shipments;
create policy audit_shipments_insert on public.audit_shipments for insert to authenticated
with check ((select public.app_has_any_permission(array['audits.create','audits.edit','audits.approve','audits.reopen'])));
create policy audit_shipments_update on public.audit_shipments for update to authenticated
using ((select public.app_has_any_permission(array['audits.create','audits.edit','audits.approve','audits.reopen'])))
with check ((select public.app_has_any_permission(array['audits.create','audits.edit','audits.approve','audits.reopen'])));
create policy audit_shipments_delete on public.audit_shipments for delete to authenticated
using ((select public.app_has_any_permission(array['audits.create','audits.edit','audits.reopen','audits.delete'])));

drop policy if exists bad_debt_writeoffs_sel on public.bad_debt_writeoffs;
drop policy if exists bad_debt_writeoffs_del_mw on public.bad_debt_writeoffs;
drop policy if exists bad_debt_writeoffs_ins_mw on public.bad_debt_writeoffs;
drop policy if exists bad_debt_writeoffs_upd_mw on public.bad_debt_writeoffs;
drop policy if exists bdw_all on public.bad_debt_writeoffs;
drop policy if exists bad_debt_writeoffs_select on public.bad_debt_writeoffs;
drop policy if exists bad_debt_writeoffs_insert on public.bad_debt_writeoffs;
drop policy if exists bad_debt_writeoffs_update on public.bad_debt_writeoffs;
drop policy if exists bad_debt_writeoffs_delete on public.bad_debt_writeoffs;
create policy bad_debt_writeoffs_select on public.bad_debt_writeoffs for select to authenticated
using ((select public.app_has_any_permission(array['receivables.view','collections.view','crm.write_off'])));
create policy bad_debt_writeoffs_insert on public.bad_debt_writeoffs for insert to authenticated
with check ((select public.app_has_any_permission(array['crm.write_off'])));
create policy bad_debt_writeoffs_update on public.bad_debt_writeoffs for update to authenticated
using ((select public.app_has_any_permission(array['crm.write_off'])))
with check ((select public.app_has_any_permission(array['crm.write_off'])));
create policy bad_debt_writeoffs_delete on public.bad_debt_writeoffs for delete to authenticated
using ((select public.app_has_any_permission(array['crm.write_off'])));

drop policy if exists bank_balance_log_del_mw on public.bank_balance_log;
drop policy if exists bank_balance_log_ins_mw on public.bank_balance_log;
drop policy if exists bank_balance_log_upd_mw on public.bank_balance_log;
drop policy if exists bank_balance_log_all on public.bank_balance_log;
drop policy if exists bank_balance_log_write on public.bank_balance_log;
drop policy if exists bank_balance_log_insert on public.bank_balance_log;
drop policy if exists bank_balance_log_update on public.bank_balance_log;
drop policy if exists bank_balance_log_delete on public.bank_balance_log;
create policy bank_balance_log_insert on public.bank_balance_log for insert to authenticated
with check ((select public.app_has_any_permission(array['bank.set_balance'])));
create policy bank_balance_log_update on public.bank_balance_log for update to authenticated
using ((select public.app_has_any_permission(array['bank.set_balance'])))
with check ((select public.app_has_any_permission(array['bank.set_balance'])));
create policy bank_balance_log_delete on public.bank_balance_log for delete to authenticated
using ((select public.app_has_any_permission(array['bank.set_balance'])));

drop policy if exists carrier_operations_del_mw on public.carrier_operations;
drop policy if exists carrier_operations_ins_mw on public.carrier_operations;
drop policy if exists carrier_operations_upd_mw on public.carrier_operations;
drop policy if exists carrier_operations_all on public.carrier_operations;
drop policy if exists carrier_operations_insert on public.carrier_operations;
drop policy if exists carrier_operations_update on public.carrier_operations;
drop policy if exists carrier_operations_delete on public.carrier_operations;
create policy carrier_operations_insert on public.carrier_operations for insert to authenticated
with check ((select public.app_has_any_permission(array[
  'audits.approve','audits.reopen','carriers.upload_statement','ledger.manual_entry',
  'payments.create','payments.allocate','cod.upload_in','cod.upload_out','cod.approve_dispute'
])));
create policy carrier_operations_update on public.carrier_operations for update to authenticated
using ((select public.app_has_any_permission(array[
  'audits.approve','audits.reopen','carriers.upload_statement','ledger.manual_entry',
  'payments.create','payments.allocate','cod.upload_in','cod.upload_out','cod.approve_dispute'
])))
with check ((select public.app_has_any_permission(array[
  'audits.approve','audits.reopen','carriers.upload_statement','ledger.manual_entry',
  'payments.create','payments.allocate','cod.upload_in','cod.upload_out','cod.approve_dispute'
])));
create policy carrier_operations_delete on public.carrier_operations for delete to authenticated
using ((select public.app_has_any_permission(array[
  'audits.reopen','audits.delete','carriers.delete_statement','ledger.delete_entry','payments.delete','cod.delete_upload'
])));

drop policy if exists carrier_statements_del_mw on public.carrier_statements;
drop policy if exists carrier_statements_ins_mw on public.carrier_statements;
drop policy if exists carrier_statements_upd_mw on public.carrier_statements;
drop policy if exists carrier_statements_all on public.carrier_statements;
drop policy if exists carrier_statements_insert on public.carrier_statements;
drop policy if exists carrier_statements_update on public.carrier_statements;
drop policy if exists carrier_statements_delete on public.carrier_statements;
create policy carrier_statements_insert on public.carrier_statements for insert to authenticated
with check ((select public.app_has_any_permission(array['carriers.upload_statement'])));
create policy carrier_statements_update on public.carrier_statements for update to authenticated
using ((select public.app_has_any_permission(array['carriers.upload_statement'])))
with check ((select public.app_has_any_permission(array['carriers.upload_statement'])));
create policy carrier_statements_delete on public.carrier_statements for delete to authenticated
using ((select public.app_has_any_permission(array['carriers.delete_statement'])));

drop policy if exists carriers_write on public.carriers;
drop policy if exists carriers_update on public.carriers;
drop policy if exists carriers_insert on public.carriers;
create policy carriers_insert on public.carriers for insert to authenticated
with check ((select public.app_has_any_permission(array['carriers.create'])));
create policy carriers_update on public.carriers for update to authenticated
using ((select public.app_has_any_permission(array['carriers.edit_contract','carriers.edit_signature'])))
with check ((select public.app_has_any_permission(array['carriers.edit_contract','carriers.edit_signature'])));

drop policy if exists cra_del_mw on public.cod_reconciliation_action;
drop policy if exists cra_ins_mw on public.cod_reconciliation_action;
drop policy if exists cra_upd_mw on public.cod_reconciliation_action;
drop policy if exists p_cod_action_write on public.cod_reconciliation_action;
drop policy if exists cod_reconciliation_action_insert on public.cod_reconciliation_action;
drop policy if exists cod_reconciliation_action_update on public.cod_reconciliation_action;
drop policy if exists cod_reconciliation_action_delete on public.cod_reconciliation_action;
create policy cod_reconciliation_action_insert on public.cod_reconciliation_action for insert to authenticated
with check ((select public.app_has_any_permission(array['cod.approve_dispute'])));
create policy cod_reconciliation_action_update on public.cod_reconciliation_action for update to authenticated
using ((select public.app_has_any_permission(array['cod.approve_dispute'])))
with check ((select public.app_has_any_permission(array['cod.approve_dispute'])));
create policy cod_reconciliation_action_delete on public.cod_reconciliation_action for delete to authenticated
using ((select public.app_has_any_permission(array['cod.approve_dispute'])));

drop policy if exists cod_settlement_del_mw on public.cod_settlement;
drop policy if exists cod_settlement_ins_mw on public.cod_settlement;
drop policy if exists cod_settlement_upd_mw on public.cod_settlement;
drop policy if exists p_cod_settlement_write on public.cod_settlement;
drop policy if exists cod_settlement_insert on public.cod_settlement;
drop policy if exists cod_settlement_update on public.cod_settlement;
drop policy if exists cod_settlement_delete on public.cod_settlement;
create policy cod_settlement_insert on public.cod_settlement for insert to authenticated
with check ((select public.app_has_any_permission(array['cod.upload_in','cod.upload_out','audits.approve'])));
create policy cod_settlement_update on public.cod_settlement for update to authenticated
using ((select public.app_has_any_permission(array['cod.upload_in','cod.upload_out','audits.approve','audits.reopen'])))
with check ((select public.app_has_any_permission(array['cod.upload_in','cod.upload_out','audits.approve','audits.reopen'])));
create policy cod_settlement_delete on public.cod_settlement for delete to authenticated
using ((select public.app_has_any_permission(array['cod.delete_upload','audits.reopen','audits.delete'])));

drop policy if exists cod_treasury_balances_del_mw on public.cod_treasury_balances;
drop policy if exists cod_treasury_balances_ins_mw on public.cod_treasury_balances;
drop policy if exists cod_treasury_balances_upd_mw on public.cod_treasury_balances;
drop policy if exists cod_treasury_balances_all on public.cod_treasury_balances;
drop policy if exists cod_treasury_balances_insert on public.cod_treasury_balances;
drop policy if exists cod_treasury_balances_update on public.cod_treasury_balances;
drop policy if exists cod_treasury_balances_delete on public.cod_treasury_balances;
create policy cod_treasury_balances_insert on public.cod_treasury_balances for insert to authenticated
with check ((select public.app_has_any_permission(array['reconciliation.link'])));
create policy cod_treasury_balances_update on public.cod_treasury_balances for update to authenticated
using ((select public.app_has_any_permission(array['reconciliation.link','reconciliation.unlink'])))
with check ((select public.app_has_any_permission(array['reconciliation.link','reconciliation.unlink'])));
create policy cod_treasury_balances_delete on public.cod_treasury_balances for delete to authenticated
using ((select public.app_has_any_permission(array['reconciliation.unlink'])));

drop policy if exists dispute_notes_sel_auth on public.dispute_notes;
drop policy if exists dispute_notes_del_mw on public.dispute_notes;
drop policy if exists dispute_notes_ins_mw on public.dispute_notes;
drop policy if exists dispute_notes_upd_mw on public.dispute_notes;
drop policy if exists p_dispute_notes_select on public.dispute_notes;
drop policy if exists p_dispute_notes_write on public.dispute_notes;
drop policy if exists dispute_notes_select on public.dispute_notes;
drop policy if exists dispute_notes_insert on public.dispute_notes;
drop policy if exists dispute_notes_update on public.dispute_notes;
drop policy if exists dispute_notes_delete on public.dispute_notes;
create policy dispute_notes_select on public.dispute_notes for select to authenticated
using ((select public.app_has_any_permission(array['ledger.view','carriers.view','audits.view'])));
create policy dispute_notes_insert on public.dispute_notes for insert to authenticated
with check ((select public.app_has_any_permission(array['ledger.manual_entry','cod.approve_dispute'])));
create policy dispute_notes_update on public.dispute_notes for update to authenticated
using ((select public.app_has_any_permission(array['ledger.manual_entry','cod.approve_dispute'])))
with check ((select public.app_has_any_permission(array['ledger.manual_entry','cod.approve_dispute'])));
create policy dispute_notes_delete on public.dispute_notes for delete to authenticated
using ((select public.app_has_any_permission(array['ledger.delete_entry'])));

drop policy if exists payment_allocations_del_mw on public.payment_allocations;
drop policy if exists payment_allocations_ins_mw on public.payment_allocations;
drop policy if exists payment_allocations_upd_mw on public.payment_allocations;
drop policy if exists p_payment_allocations_write on public.payment_allocations;
drop policy if exists payment_allocations_insert on public.payment_allocations;
drop policy if exists payment_allocations_update on public.payment_allocations;
drop policy if exists payment_allocations_delete on public.payment_allocations;
create policy payment_allocations_insert on public.payment_allocations for insert to authenticated
with check ((select public.app_has_any_permission(array['payments.allocate'])));
create policy payment_allocations_update on public.payment_allocations for update to authenticated
using ((select public.app_has_any_permission(array['payments.allocate'])))
with check ((select public.app_has_any_permission(array['payments.allocate'])));
create policy payment_allocations_delete on public.payment_allocations for delete to authenticated
using ((select public.app_has_any_permission(array['payments.allocate','payments.delete'])));

drop policy if exists payments_del_mw on public.payments;
drop policy if exists payments_ins_mw on public.payments;
drop policy if exists payments_upd_mw on public.payments;
drop policy if exists p_payments_write on public.payments;
drop policy if exists payments_insert on public.payments;
drop policy if exists payments_update on public.payments;
drop policy if exists payments_delete on public.payments;
create policy payments_insert on public.payments for insert to authenticated
with check ((select public.app_has_any_permission(array['payments.create'])));
create policy payments_update on public.payments for update to authenticated
using ((select public.app_has_any_permission(array['payments.create','payments.allocate'])))
with check ((select public.app_has_any_permission(array['payments.create','payments.allocate'])));
create policy payments_delete on public.payments for delete to authenticated
using ((select public.app_has_any_permission(array['payments.delete'])));

drop policy if exists period_closes_select on public.period_closes;
drop policy if exists period_closes_write on public.period_closes;
drop policy if exists period_closes_insert on public.period_closes;
drop policy if exists period_closes_update on public.period_closes;
drop policy if exists period_closes_delete on public.period_closes;
create policy period_closes_select on public.period_closes for select to authenticated
using ((select public.app_has_any_permission(array['system.period_close','reports.view_financial'])));
create policy period_closes_insert on public.period_closes for insert to authenticated
with check ((select public.app_has_any_permission(array['system.period_close'])));
create policy period_closes_update on public.period_closes for update to authenticated
using ((select public.app_has_any_permission(array['system.period_close'])))
with check ((select public.app_has_any_permission(array['system.period_close'])));
create policy period_closes_delete on public.period_closes for delete to authenticated
using ((select public.app_has_any_permission(array['system.period_close'])));

-- Guard CRM write RPCs at the SECURITY DEFINER boundary.
create or replace function public.set_retargeting_followup(
  p_phone text,
  p_status text default null,
  p_owner uuid default null,
  p_next timestamptz default null,
  p_notes text default null,
  p_touch boolean default false
) returns json
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_uid uuid := (select auth.uid());
  v_old text;
  v_stage text;
begin
  if v_uid is null or not public.app_has_any_permission(array['sales.manage']) then
    raise exception 'not_allowed';
  end if;
  if p_phone is null or btrim(p_phone) = '' then raise exception 'phone_required'; end if;

  select status into v_old from public.retargeting_followups where phone = p_phone;
  v_stage := case
    when p_status in ('converted','returned') then 'won'
    when p_status in ('not_interested','competitor','closed_business') then 'lost'
    when p_status in ('supplier','noise','blacklist','test') then 'disqualified'
    when p_status = 'interested' then 'qualified'
    when p_status in ('contacted','whatsapp_sent','price_issue','support_issue','integration_issue','finance') then 'contacted'
    when p_status in ('needs_followup','no_answer') then 'nurture'
    when p_status = 'new' then 'new'
  end;

  insert into public.retargeting_followups (
    phone,status,sales_stage,owner_id,next_action_at,notes,last_touch_at,
    first_contact_at,contact_attempts,updated_by,updated_at
  ) values (
    p_phone,coalesce(p_status,'new'),coalesce(v_stage,'new'),p_owner,p_next,p_notes,
    case when p_touch then now() end,case when p_touch then now() end,
    case when p_touch then 1 else 0 end,v_uid,now()
  )
  on conflict (phone) do update set
    status=coalesce(p_status,public.retargeting_followups.status),
    sales_stage=coalesce(v_stage,public.retargeting_followups.sales_stage),
    owner_id=case when p_owner is not null then p_owner else public.retargeting_followups.owner_id end,
    next_action_at=coalesce(p_next,public.retargeting_followups.next_action_at),
    notes=coalesce(p_notes,public.retargeting_followups.notes),
    last_touch_at=case when p_touch then now() else public.retargeting_followups.last_touch_at end,
    first_contact_at=case when p_touch then coalesce(public.retargeting_followups.first_contact_at,now()) else public.retargeting_followups.first_contact_at end,
    contact_attempts=public.retargeting_followups.contact_attempts+case when p_touch then 1 else 0 end,
    lost_at=case when v_stage='lost' then coalesce(public.retargeting_followups.lost_at,now()) when v_stage is not null and v_stage<>'lost' then null else public.retargeting_followups.lost_at end,
    won_at=case when v_stage='won' then coalesce(public.retargeting_followups.won_at,now()) when v_stage is not null and v_stage<>'won' then null else public.retargeting_followups.won_at end,
    updated_by=v_uid,updated_at=now();

  if p_status is not null and p_status is distinct from coalesce(v_old,'new') then
    insert into public.retargeting_status_log(phone,old_status,new_status,changed_by)
    values (p_phone,v_old,p_status,v_uid);
  end if;
  return (select row_to_json(f) from public.retargeting_followups f where f.phone=p_phone);
end $$;

create or replace function public.set_retargeting_followups_bulk(
  p_phones text[],
  p_owner uuid default null,
  p_status text default null,
  p_touch boolean default false
) returns integer
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  n integer;
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not public.app_has_any_permission(array['sales.manage']) then
    raise exception 'not_allowed';
  end if;
  if coalesce(cardinality(p_phones),0) = 0 or cardinality(p_phones) > 1000 then
    raise exception 'invalid_batch_size';
  end if;
  insert into public.retargeting_followups(phone,owner_id,status,last_touch_at,updated_at,updated_by)
  select distinct btrim(ph),p_owner,coalesce(p_status,'new'),case when p_touch then now() end,now(),v_uid
  from unnest(p_phones) ph where nullif(btrim(ph),'') is not null
  on conflict (phone) do update set
    owner_id=coalesce(p_owner,public.retargeting_followups.owner_id),
    status=coalesce(p_status,public.retargeting_followups.status),
    last_touch_at=case when p_touch then now() else public.retargeting_followups.last_touch_at end,
    updated_at=now(),updated_by=v_uid;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.crm_retargeting_leads(
  p_segment text default null,
  p_priority text default null,
  p_integration text default null,
  p_billing text default null,
  p_has_balance boolean default null,
  p_q text default null,
  p_status text default null,
  p_owner uuid default null,
  p_unassigned boolean default null,
  p_include_excluded boolean default false,
  p_limit integer default 50,
  p_offset integer default 0,
  p_campaign text default null
) returns json
language sql
stable
security definer
set search_path = 'public', 'pg_temp'
as $$
  with allowed as (
    select 1
    where (select auth.uid()) is not null
      and public.app_has_any_permission(array['sales.view','sales.manage'])
  ),
  lc as (
    select phone, max(sent_at) as last_at
    from public.whatsapp_campaign_sends
    where phone is not null
    group by phone
  ),
  f as (
    select v.*, coalesce(fu.status,'new') as fu_status, fu.owner_id as fu_owner,
      pr.name as owner_name, fu.next_action_at, fu.notes as fu_notes, fu.last_touch_at,
      lc.last_at as last_campaign_at
    from allowed
    cross join public.v_crm_retargeting v
    left join public.retargeting_followups fu on fu.phone = v.phone
    left join public.profiles pr on pr.id = fu.owner_id
    left join lc on lc.phone = public.norm_sa_phone(v.phone)
    where (p_segment is null or v.segment = p_segment)
      and (p_priority is null or coalesce(v.priority,'none') = p_priority)
      and (p_integration is null or coalesce(v.integration_type,'none') = p_integration)
      and (p_billing is null or v.billing_type = p_billing)
      and (p_has_balance is null or (p_has_balance and v.wallet > 0.5) or (not p_has_balance))
      and (p_q is null or btrim(p_q) = '' or v.primary_store ilike '%'||p_q||'%' or v.phone ilike '%'||p_q||'%')
      and (p_status is null or coalesce(fu.status,'new') = p_status)
      and (p_owner is null or fu.owner_id = p_owner)
      and (p_unassigned is null or (p_unassigned and fu.owner_id is null) or (not p_unassigned))
      and (p_include_excluded or p_status in ('blacklist','test') or coalesce(fu.status,'new') not in ('blacklist','test'))
      and (p_campaign is null or p_campaign = ''
        or (p_campaign = 'none' and lc.last_at is null)
        or (p_campaign = 'within7' and lc.last_at >= now() - interval '7 days')
        or (p_campaign = 'within30' and lc.last_at >= now() - interval '30 days')
        or (p_campaign = 'older30' and lc.last_at is not null and lc.last_at < now() - interval '30 days'))
  )
  select json_build_object(
    'count', (select count(*) from f),
    'rows', (select coalesce(json_agg(r), '[]') from (
      select phone, primary_store, store_names, store_count, total_shipments, last_shipment,
        days_since_last, wallet, last_topup, created_at, integration_type, billing_type,
        profile_done, verified, segment, priority, channel, high_value,
        fu_status, fu_owner, owner_name, next_action_at, fu_notes, last_touch_at, last_campaign_at
      from f
      order by case coalesce(priority,'none')
        when 'A' then 1 when 'B' then 2 when 'C' then 3 when 'D' then 4 when 'FIN' then 5 else 6 end,
        total_shipments desc
      limit greatest(1,least(p_limit,200)) offset greatest(0,p_offset)
    ) r)
  );
$$;

-- Existing sales RPCs already protect ownership; add the missing feature
-- permission so an unrelated authenticated account cannot call them.
create or replace function public.sales_today_routed(p_user uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid:=coalesce(p_user,(select auth.uid()));
  v_base jsonb; v_due jsonb; v_opportunities jsonb;
  v_opportunity_count integer; v_followups_total integer;
begin
  if (select auth.uid()) is null
     or not public.app_has_any_permission(array['sales.view','sales.manage']) then
    raise exception 'not_allowed';
  end if;
  if v_user is distinct from (select auth.uid()) and not public.crm_can_see_all() then
    raise exception 'not_allowed';
  end if;
  v_base:=public.sales_today(v_user);
  select coalesce(jsonb_agg(item order by item->>'next_at'),'[]'::jsonb) into v_due
  from jsonb_array_elements(coalesce(v_base->'due_followups','[]'::jsonb)) item
  left join public.v_platform_commercial_routing routing on routing.phone=item->>'phone'
  where routing.phone is null or routing.sales_eligible;
  select coalesce(jsonb_agg(to_jsonb(opportunity) order by opportunity.signal_score desc),'[]'::jsonb)
  into v_opportunities from (
    select routing.phone,routing.primary_store as store,routing.segment,routing.priority,routing.channel,routing.total_shipments,routing.wallet,
      routing.created_at,routing.last_shipment,routing.days_since_last,routing.store_count,routing.store_names,routing.integration_type,routing.billing_type,
      routing.profile_done,routing.verified,routing.vat_reg,routing.zatca_done,routing.compliance_pending,routing.readiness_score,routing.opportunity_score,
      routing.team_route,routing.next_step,routing.direct_live,routing.integration_class,routing.positive_wallet,routing.negative_wallet,routing.debt,
      routing.commercial_signal,routing.signal_score,routing.signal_reason,routing.assigned_team,routing.hot_live_new,routing.hot_live_topped,
      routing.recent_stop,routing.wallet_stranded,routing.live_inactive
    from public.v_platform_commercial_routing routing
    left join public.retargeting_followups followup on followup.phone=routing.phone
    where followup.phone is null and routing.sales_eligible
      and (routing.hot_live_new or routing.hot_live_topped or routing.recent_stop or routing.wallet_stranded or routing.live_inactive or (routing.direct_live and routing.total_shipments=0))
    order by routing.signal_score desc,routing.latest_created_at desc nulls last,routing.total_shipments desc limit 30
  ) opportunity;
  select count(*) into v_opportunity_count
  from public.v_platform_commercial_routing routing
  left join public.retargeting_followups followup on followup.phone=routing.phone
  where followup.phone is null and routing.sales_eligible
    and (routing.hot_live_new or routing.hot_live_topped or routing.recent_stop or routing.wallet_stranded or routing.live_inactive or (routing.direct_live and routing.total_shipments=0));
  select count(*) into v_followups_total
  from public.retargeting_followups followup
  left join public.v_platform_commercial_routing routing on routing.phone=followup.phone
  where followup.owner_id=v_user and (routing.phone is null or routing.sales_eligible)
    and followup.status not in ('converted','returned','not_interested','supplier','noise','blacklist','test');
  v_base:=jsonb_set(v_base,'{due_followups}',v_due,true);
  v_base:=jsonb_set(v_base,'{platform_opportunities}',v_opportunities,true);
  v_base:=jsonb_set(v_base,'{platform_opportunity_count}',to_jsonb(v_opportunity_count),true);
  v_base:=jsonb_set(v_base,'{my_followups_total}',to_jsonb(v_followups_total),true);
  return v_base;
end $$;

-- The application uses the guarded routed endpoint. Prevent bypassing its
-- feature check by calling the lower-level helper directly.
revoke execute on function public.sales_today(uuid) from authenticated;

-- A provider may redeliver the same IVR completion callback. Persist the
-- originating call/attempt on retry rows and make the enqueue idempotent.
alter table public.ivr_queue
  add column if not exists source_ivr_call_id uuid references public.ivr_calls(id) on delete cascade,
  add column if not exists source_attempt integer;

create unique index if not exists ivr_queue_one_retry_per_call_attempt
  on public.ivr_queue(source_ivr_call_id, source_attempt)
  where source_ivr_call_id is not null and source_attempt is not null;

commit;

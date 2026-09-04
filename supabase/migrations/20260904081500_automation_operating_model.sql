-- V2 automation operating model.
-- Makes the action, recipient and risk explicit for every rule. This migration
-- does not dispatch a message or mutate Lamha/Zoho. Customer writes remain
-- behind their existing, separately authorized execution functions.

alter table public.automation_rules
  drop constraint if exists automation_rules_category_check;

alter table public.automation_rules
  add constraint automation_rules_category_check
  check (category in ('sales','retention','collections','operations','management'));

alter table public.automation_rules
  add column if not exists audience_type text not null default 'customer',
  add column if not exists action_type text not null default 'send_hatif_template',
  add column if not exists action_config jsonb not null default '{}'::jsonb,
  add column if not exists risk_level text not null default 'medium',
  add column if not exists approval_policy text not null default 'operator_review';

alter table public.automation_rules
  drop constraint if exists automation_rules_audience_type_check,
  drop constraint if exists automation_rules_action_type_check,
  drop constraint if exists automation_rules_risk_level_check,
  drop constraint if exists automation_rules_approval_policy_check;

alter table public.automation_rules
  add constraint automation_rules_audience_type_check
    check (audience_type in ('customer','employee','management','internal_queue')),
  add constraint automation_rules_action_type_check
    check (action_type in ('send_hatif_template','notify_employee_template','create_task','review_queue','in_app_report','linked_system_agent','account_action')),
  add constraint automation_rules_risk_level_check
    check (risk_level in ('low','medium','high','critical')),
  add constraint automation_rules_approval_policy_check
    check (approval_policy in ('none','operator_review','manager_approval','explicit_each_run'));

update public.automation_rules set
  audience_type = case
    when rule_key = 'financial_suspension_review_31d' then 'internal_queue'
    else 'customer'
  end,
  action_type = case
    when rule_key = 'financial_suspension_review_31d' then 'review_queue'
    when rule_key = 'account_deactivated' then 'review_queue'
    else 'send_hatif_template'
  end,
  action_config = case
    when rule_key = 'financial_suspension_review_31d' then '{"workspace":"collections","resultSet":"financial_suspension_candidates","externalWrite":false}'::jsonb
    when rule_key = 'account_deactivated' then '{"workspace":"operations","externalWrite":false}'::jsonb
    else jsonb_build_object('provider','hatif','channel','whatsapp','externalWrite',true)
  end,
  risk_level = case
    when rule_key = 'financial_suspension_review_31d' then 'critical'
    when category = 'collections' then 'high'
    else 'medium'
  end,
  approval_policy = case
    when rule_key = 'welcome_new_customer' then 'none'
    when rule_key = 'financial_suspension_review_31d' then 'explicit_each_run'
    else 'operator_review'
  end;

create table if not exists public.automation_capabilities (
  capability_key text primary key,
  kind text not null check (kind in ('trigger','action','guard')),
  label text not null,
  description text not null default '',
  source text,
  risk_level text not null default 'low' check (risk_level in ('low','medium','high','critical')),
  supports_automatic boolean not null default false,
  handler_key text,
  configuration_schema jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.automation_capabilities enable row level security;
revoke all on table public.automation_capabilities from public, anon, authenticated;
grant select on table public.automation_capabilities to authenticated;
grant select, insert, update, delete on table public.automation_capabilities to service_role;

drop policy if exists automation_capabilities_read on public.automation_capabilities;
create policy automation_capabilities_read on public.automation_capabilities
for select to authenticated using (public.app_has_any_permission(array['agents.view']));

insert into public.automation_capabilities
  (capability_key,kind,label,description,source,risk_level,supports_automatic,handler_key,configuration_schema)
values
  ('trigger.lamha_sync_succeeded','trigger','نجاح مزامنة لمحة','يعمل فقط بعد اعتماد لقطة كاملة؛ لا يعمل على مزامنة جزئية.','lamha','low',true,'lamha_sync_succeeded','{"requiresFreshSnapshot":true}'),
  ('trigger.new_store','trigger','متجر جديد','ظهور معرف متجر للمرة الأولى في لقطة لمحة مع منع تكرار الجوال داخل اللقطة.','lamha','low',true,'new_customer','{"identity":"store_id"}'),
  ('trigger.shipment_stopped','trigger','توقف الشحن','آخر شحنة أقدم من العدد المحدد مع بقاء حساب لمحة عاملًا.','lamha','medium',true,'stopped_shipping','{"operator":"strict_gt"}'),
  ('trigger.never_shipped','trigger','لم يشحن إطلاقًا','مرور المهلة منذ التسجيل دون أي شحنة.','lamha','medium',true,'never_shipped','{"requiresRegistrationDate":true}'),
  ('trigger.invoice_age','trigger','عمر فاتورة','عبور فاتورة قابلة للتحصيل تشغيليًا حد الأيام المحدد.','zoho','high',true,'invoice_overdue','{"moneySource":"operational_collectible"}'),
  ('trigger.schedule','trigger','موعد مجدول','تشغيل داخلي وفق توقيت السعودية.','manual','low',true,'schedule','{"timezone":"Asia/Riyadh"}'),
  ('action.hatif_customer_template','action','قالب هاتف للعميل','إرسال قالب واتساب معتمد بعقد متغيرات ثابت.','hatif','medium',true,'send_hatif_template','{"requiresApprovedContract":true}'),
  ('action.hatif_employee_template','action','تنبيه موظف عبر هاتف','يتطلب قالب موظفين معتمدًا واستراتيجية مستلم واضحة.','hatif','medium',true,'notify_employee_template','{"requiresApprovedContract":true,"requiresRecipientStrategy":true}'),
  ('action.internal_report','action','تقرير داخل النظام','يحفظ لقطة إدارة قابلة للتدقيق دون إرسال خارجي.','manual','low',true,'in_app_report','{"externalWrite":false}'),
  ('action.review_queue','action','قائمة مراجعة','ينشئ نتيجة قرار داخل النظام ولا ينفذ الإجراء الخارجي.','manual','low',true,'review_queue','{"externalWrite":false}'),
  ('action.account_status','action','تغيير حالة حساب','إجراء Lamha حساس؛ لا يسمح بتشغيله تلقائيًا.','lamha','critical',false,'account_action','{"requiresLivePreflight":true}'),
  ('guard.source_freshness','guard','حداثة المصادر','ينقل الحالة للمراجعة إذا كانت لقطة المصدر قديمة.','manual','low',true,'source_freshness','{}'),
  ('guard.phone_identity','guard','هوية الجوال','يطبّع الجوال ويمنع تكراره ضمن نطاق القاعدة.','hatif','low',true,'phone_identity','{}'),
  ('guard.communication_collision','guard','منع تعارض التواصل','يمنع إرسال أكثر من رسالة آلية للجوال خلال 24 ساعة.','hatif','low',true,'communication_collision','{"hours":24}'),
  ('guard.template_contract','guard','عقد القالب','يفرض عدد المتغيرات وترتيبها ومصدرها قبل التفعيل.','hatif','low',true,'template_contract','{}'),
  ('guard.live_lamha_preflight','guard','فحص لمحة الحي','إلزامي قبل أي تغيير حالة حساب؛ لا يعتمد اللقطة وحدها.','lamha','low',true,'live_lamha_preflight','{}'),
  ('guard.audit_result','guard','نتيجة وسجل تدقيق','كل تشغيل يترك نسخة القاعدة والأعداد والنتيجة والأخطاء.','manual','low',true,'audit_result','{}')
on conflict (capability_key) do update set
  label=excluded.label,description=excluded.description,source=excluded.source,
  risk_level=excluded.risk_level,supports_automatic=excluded.supports_automatic,
  handler_key=excluded.handler_key,configuration_schema=excluded.configuration_schema,
  enabled=excluded.enabled,updated_at=now();

create or replace function public.save_automation_rule(p_rule jsonb, p_change_note text default null)
returns public.automation_rules
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_id uuid := nullif(p_rule->>'id','')::uuid;
  v_current public.automation_rules;
  v_saved public.automation_rules;
  v_version integer;
begin
  if not public.app_has_any_permission(array['agents.manage']) then raise exception 'forbidden'; end if;
  if nullif(trim(p_rule->>'name'),'') is null or nullif(trim(p_rule->>'event_type'),'') is null then
    raise exception 'invalid_automation_rule';
  end if;

  if v_id is null then
    insert into public.automation_rules (
      rule_key,name,objective,category,status,execution_mode,event_type,trigger_source,
      trigger_config,conditions,exclusions,template_name,template_language,template_variables,
      schedule_config,safeguards,audience_type,action_type,action_config,risk_level,approval_policy,
      created_by,updated_by
    ) values (
      coalesce(nullif(trim(p_rule->>'rule_key'),''),'custom_'||replace(gen_random_uuid()::text,'-','')),
      trim(p_rule->>'name'),coalesce(p_rule->>'objective',''),coalesce(p_rule->>'category','operations'),
      coalesce(p_rule->>'status','draft'),coalesce(p_rule->>'execution_mode','preview'),
      p_rule->>'event_type',coalesce(p_rule->>'trigger_source','manual'),
      coalesce(p_rule->'trigger_config','{}'::jsonb),coalesce(p_rule->'conditions','[]'::jsonb),
      coalesce(p_rule->'exclusions','[]'::jsonb),coalesce(p_rule->>'template_name',''),
      coalesce(p_rule->>'template_language','ar'),coalesce(p_rule->'template_variables','[]'::jsonb),
      coalesce(p_rule->'schedule_config','{}'::jsonb),coalesce(p_rule->'safeguards','{}'::jsonb),
      coalesce(p_rule->>'audience_type','customer'),coalesce(p_rule->>'action_type','send_hatif_template'),
      coalesce(p_rule->'action_config','{}'::jsonb),coalesce(p_rule->>'risk_level','medium'),
      coalesce(p_rule->>'approval_policy','operator_review'),(select auth.uid()),(select auth.uid())
    ) returning * into v_saved;
  else
    select * into v_current from public.automation_rules where id=v_id for update;
    if not found then raise exception 'automation_rule_not_found'; end if;
    v_version:=v_current.version+1;
    update public.automation_rules set
      name=trim(p_rule->>'name'),objective=coalesce(p_rule->>'objective',''),
      category=coalesce(p_rule->>'category',category),status=coalesce(p_rule->>'status',status),
      execution_mode=coalesce(p_rule->>'execution_mode',execution_mode),
      event_type=coalesce(p_rule->>'event_type',event_type),trigger_source=coalesce(p_rule->>'trigger_source',trigger_source),
      trigger_config=coalesce(p_rule->'trigger_config',trigger_config),conditions=coalesce(p_rule->'conditions',conditions),
      exclusions=coalesce(p_rule->'exclusions',exclusions),template_name=coalesce(p_rule->>'template_name',''),
      template_language=coalesce(p_rule->>'template_language','ar'),template_variables=coalesce(p_rule->'template_variables','[]'::jsonb),
      schedule_config=coalesce(p_rule->'schedule_config','{}'::jsonb),safeguards=coalesce(p_rule->'safeguards',safeguards),
      audience_type=coalesce(p_rule->>'audience_type',audience_type),action_type=coalesce(p_rule->>'action_type',action_type),
      action_config=coalesce(p_rule->'action_config',action_config),risk_level=coalesce(p_rule->>'risk_level',risk_level),
      approval_policy=coalesce(p_rule->>'approval_policy',approval_policy),version=v_version,
      updated_by=(select auth.uid()),updated_at=now()
    where id=v_id returning * into v_saved;
  end if;

  insert into public.automation_rule_versions(rule_id,version,snapshot,change_note,created_by)
  values(v_saved.id,v_saved.version,to_jsonb(v_saved)-'last_preview_at'-'last_preview_count'-'last_run_at'-'next_run_at',p_change_note,(select auth.uid()));
  return v_saved;
end;
$function$;

revoke all on function public.save_automation_rule(jsonb,text) from public,anon;
grant execute on function public.save_automation_rule(jsonb,text) to authenticated;

create or replace function private.validate_automation_rule_activation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_contract public.automation_template_contracts;
  v_expected jsonb;
  v_actual jsonb;
begin
  if new.action_type='account_action' and (new.status='active' or new.execution_mode='automatic') then
    raise exception 'account_action_requires_explicit_each_run';
  end if;
  if new.risk_level='critical' and new.execution_mode='automatic' then
    raise exception 'critical_automation_cannot_be_automatic';
  end if;
  if new.rule_key='financial_suspension_review_31d' and (new.status='active' or new.execution_mode='automatic') then
    raise exception 'financial_suspension_automation_requires_explicit_external_approval';
  end if;

  if new.status='active' and new.execution_mode='automatic'
     and new.action_type in ('send_hatif_template','notify_employee_template') then
    if nullif(trim(new.template_name),'') is null then raise exception 'active_automation_template_required'; end if;
    select * into v_contract from public.automation_template_contracts
    where template_name=new.template_name and approved is true;
    if not found then raise exception 'approved_automation_template_contract_required'; end if;
    if jsonb_typeof(new.template_variables)<>'array'
       or jsonb_array_length(new.template_variables)<>jsonb_array_length(v_contract.variable_contract) then
      raise exception 'automation_template_variable_arity_mismatch';
    end if;
    for v_expected in select value from jsonb_array_elements(v_contract.variable_contract) loop
      select value into v_actual from jsonb_array_elements(new.template_variables)
      where (value->>'position')::integer=(v_expected->>'position')::integer limit 1;
      if v_actual is null then raise exception 'automation_template_variable_missing'; end if;
      if v_expected->>'mode'='fixed' and (v_actual->>'mode'<>'fixed' or nullif(trim(v_actual->>'value'),'') is null) then
        raise exception 'automation_fixed_template_variable_required';
      end if;
      if v_expected->>'mode'='field' and (v_actual->>'mode'<>'field' or v_actual->>'source' is distinct from v_expected->>'source') then
        raise exception 'automation_template_variable_source_mismatch';
      end if;
      v_actual:=null;
    end loop;
    if coalesce((new.schedule_config->>'afterSuccessfulSync')::boolean,false) is not true then
      raise exception 'active_automation_successful_sync_required';
    end if;
    if coalesce((new.safeguards->>'maxMessagesPerPhonePerDay')::integer,0)<>1 then
      raise exception 'automation_one_message_per_phone_per_day_required';
    end if;
    if coalesce((new.safeguards->>'blockUnknownDeliveryRetry')::boolean,false) is not true then
      raise exception 'automation_unknown_delivery_retry_must_be_blocked';
    end if;
    if new.action_type='notify_employee_template'
       and nullif(new.action_config->>'recipientStrategy','') is null then
      raise exception 'employee_notification_recipient_strategy_required';
    end if;
    if new.rule_key='welcome_new_customer' and coalesce(new.safeguards->>'dedupeMode','')<>'once_per_snapshot_phone' then
      raise exception 'welcome_automation_snapshot_dedupe_required';
    end if;
  end if;
  return new;
end;
$function$;

revoke all on function private.validate_automation_rule_activation() from public,anon,authenticated;

insert into public.automation_rules (
  rule_key,name,objective,category,status,execution_mode,event_type,trigger_source,
  trigger_config,conditions,exclusions,template_name,template_variables,schedule_config,safeguards,
  audience_type,action_type,action_config,risk_level,approval_policy
) values
  ('management_operating_brief_12h','موجز الإدارة كل 12 ساعة',
   'يلخص المبيعات والتحصيل والتشغيل وصحة التكاملات داخل النظام دون إرسال خارجي.',
   'management','active','automatic','scheduled_digest','manual',
   '{"hours":[9,21],"timezone":"Asia/Riyadh"}'::jsonb,'[]'::jsonb,'[]'::jsonb,'','[]'::jsonb,
   '{"afterSuccessfulSync":false,"hours":["09:00","21:00"],"timezone":"Asia/Riyadh"}'::jsonb,
   '{"requireFreshSources":false,"externalWritesAllowed":false,"immutableRunSnapshot":true}'::jsonb,
   'management','linked_system_agent','{"agentKey":"management_daily_report","delivery":"in_app","externalWrite":false}'::jsonb,
   'low','none'),
  ('new_customer_sales_staff_alert','تنبيه المبيعات بالمتجر الجديد',
   'يرسل للموظف المسؤول ملخص متجر لمحة الجديد ورابطه؛ يبقى مسودة حتى اعتماد قالب موظفين وتحديد سياسة الإسناد.',
   'sales','draft','preview','new_customer','lamha','{"lookbackHours":24}'::jsonb,
   '[{"field":"merchant_is_new","operator":"eq","value":true}]'::jsonb,
   '["missing_assignee","missing_employee_phone","duplicate_phone"]'::jsonb,'','[]'::jsonb,
   '{"afterSuccessfulSync":true,"delayMinutes":10,"sendWindowStart":"09:00","sendWindowEnd":"20:00"}'::jsonb,
   '{"dedupeMode":"once_per_snapshot_phone","maxMessagesPerPhonePerDay":1,"requireFreshSources":true,"blockUnknownDeliveryRetry":true}'::jsonb,
   'employee','notify_employee_template','{"recipientStrategy":"assigned_sales_owner","fallback":"review_queue","externalWrite":true}'::jsonb,
   'medium','operator_review'),
  ('stopped_customer_retention_staff_alert','تنبيه الحفاظ على العميل المتوقف',
   'ينبه الموظف المسؤول عندما يتجاوز العميل خمسة أيام منذ آخر شحنة؛ يبقى مسودة حتى اعتماد قالب موظفين وإسناد المالك.',
   'retention','draft','preview','stopped_shipping','lamha','{"days":5}'::jsonb,
   '[{"field":"shipment_count","operator":"gt","value":0},{"field":"days_since_last_shipment","operator":"gt","value":5}]'::jsonb,
   '["inactive_account","missing_assignee","missing_employee_phone","stale_source"]'::jsonb,'','[]'::jsonb,
   '{"afterSuccessfulSync":true,"delayMinutes":10,"sendWindowStart":"09:00","sendWindowEnd":"20:00"}'::jsonb,
   '{"dedupeMode":"within_hours","dedupeHours":24,"maxMessagesPerPhonePerDay":1,"requireFreshSources":true,"blockUnknownDeliveryRetry":true}'::jsonb,
   'employee','notify_employee_template','{"recipientStrategy":"assigned_retention_owner","fallback":"review_queue","externalWrite":true}'::jsonb,
   'medium','operator_review')
on conflict(rule_key) do update set
  name=excluded.name,objective=excluded.objective,category=excluded.category,
  trigger_config=excluded.trigger_config,conditions=excluded.conditions,exclusions=excluded.exclusions,
  schedule_config=excluded.schedule_config,safeguards=excluded.safeguards,audience_type=excluded.audience_type,
  action_type=excluded.action_type,action_config=excluded.action_config,risk_level=excluded.risk_level,
  approval_policy=excluded.approval_policy,updated_at=now();

-- The management brief is internal and read-only. Run at 09:00 and 21:00 KSA.
update public.work_agents set
  name='وكيل موجز الإدارة كل 12 ساعة',
  description='يحفظ داخل النظام موجزًا تشغيليًا كل 12 ساعة عن التحصيل والمبيعات والمهام وصحة الوكلاء، دون إرسال خارجي.',
  status='active',cadence_label='كل 12 ساعة · 9:00 ص و9:00 م بتوقيت السعودية',
  cron_expression='0 6,18 * * *',timezone='Asia/Riyadh',safety_level='monitor',
  config=coalesce(config,'{}'::jsonb)||'{"hour":9,"hours":[9,21],"minute":0,"delivery":"in_app","external_write":false}'::jsonb,
  next_run_at=(
    case
      when (now() at time zone 'Asia/Riyadh')::time < time '09:00' then date_trunc('day',now() at time zone 'Asia/Riyadh')+interval '9 hours'
      when (now() at time zone 'Asia/Riyadh')::time < time '21:00' then date_trunc('day',now() at time zone 'Asia/Riyadh')+interval '21 hours'
      else date_trunc('day',now() at time zone 'Asia/Riyadh')+interval '1 day 9 hours'
    end
  ) at time zone 'Asia/Riyadh',updated_at=now()
where agent_key='management_daily_report';

create or replace function public.configure_management_report_agent(
  p_enabled boolean,p_hour integer,p_minute integer
)
returns public.work_agents
language plpgsql
security definer
set search_path=public,cron,pg_temp
as $function$
declare
  v_agent public.work_agents;
  v_first_utc integer;
  v_second_local integer;
  v_second_utc integer;
  v_expression text;
  v_next_local timestamp;
begin
  if not exists(
    select 1 from public.profiles p where p.id=(select auth.uid())
      and (p.role='admin' or coalesce((p.permissions->>'agents.manage')::boolean,false))
  ) then raise exception 'forbidden'; end if;
  if p_hour not between 0 and 23 or p_minute not between 0 and 59 then
    raise exception 'invalid_agent_configuration';
  end if;

  v_second_local:=(p_hour+12)%24;
  v_first_utc:=(p_hour+21)%24;
  v_second_utc:=(v_second_local+21)%24;
  v_expression:=format('%s %s,%s * * *',p_minute,v_first_utc,v_second_utc);

  select min(candidate) into v_next_local
  from (
    select day_start+make_interval(days=>day_offset,hours=>run_hour,mins=>p_minute) candidate
    from (select date_trunc('day',now() at time zone 'Asia/Riyadh') day_start) base
    cross join generate_series(0,1) day_offset
    cross join unnest(array[p_hour,v_second_local]) run_hour
  ) choices
  where candidate>now() at time zone 'Asia/Riyadh';

  update public.work_agents set
    status=case when p_enabled then 'active' else 'paused' end,
    cadence_label=format('كل 12 ساعة · %s و%s بتوقيت السعودية',
      to_char(make_time(p_hour,p_minute,0),'HH12:MI AM'),
      to_char(make_time(v_second_local,p_minute,0),'HH12:MI AM')),
    cron_expression=v_expression,
    config=coalesce(config,'{}'::jsonb)||jsonb_build_object(
      'hour',p_hour,'hours',jsonb_build_array(p_hour,v_second_local),'minute',p_minute,
      'delivery','in_app','external_write',false),
    next_run_at=case when p_enabled then v_next_local at time zone 'Asia/Riyadh' else null end,
    updated_at=now()
  where agent_key='management_daily_report'
  returning * into v_agent;

  perform cron.alter_job(job_id=>jobid,schedule=>v_expression,active=>p_enabled)
  from cron.job where jobname='work-agent-management-daily';
  return v_agent;
end;
$function$;

revoke all on function public.configure_management_report_agent(boolean,integer,integer) from public,anon;
grant execute on function public.configure_management_report_agent(boolean,integer,integer) to authenticated;

select cron.alter_job(job_id:=jobid,schedule:='0 6,18 * * *',active:=true)
from cron.job where jobname='work-agent-management-daily';

comment on table public.automation_capabilities is
  'Registry of supported automation trigger/action/guard capabilities. A capability is not permission to execute it.';
comment on column public.automation_rules.action_type is
  'Explicit action contract. Previewing a rule never implies this action was executed.';
comment on column public.automation_rules.risk_level is
  'Governance risk used to prohibit critical automatic actions.';

-- Automation control center foundation.
-- This migration creates governance, previews and immutable versions only.
-- It deliberately does not schedule or send messages. A rule can be prepared in
-- preview/review mode without making any external write.

create table if not exists public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null unique,
  name text not null,
  objective text not null default '',
  category text not null check (category in ('sales','retention','collections','operations')),
  status text not null default 'draft' check (status in ('draft','preview','review','active','paused','error','archived')),
  execution_mode text not null default 'preview' check (execution_mode in ('preview','review','automatic')),
  event_type text not null,
  trigger_source text not null check (trigger_source in ('lamha','zoho','hatif','manual')),
  trigger_config jsonb not null default '{}'::jsonb,
  conditions jsonb not null default '[]'::jsonb,
  exclusions jsonb not null default '[]'::jsonb,
  template_name text not null default '',
  template_language text not null default 'ar',
  template_variables jsonb not null default '[]'::jsonb,
  schedule_config jsonb not null default '{}'::jsonb,
  safeguards jsonb not null default jsonb_build_object(
    'audienceIdentity','normalized_phone',
    'dedupeHours',72,
    'maxMessagesPerPhonePerDay',1,
    'maxRecipientsPerRun',500,
    'requireFreshSources',true,
    'retryConfirmedFailures',1,
    'blockUnknownDeliveryRetry',true
  ),
  version integer not null default 1 check (version > 0),
  last_preview_at timestamptz,
  last_preview_count integer check (last_preview_count is null or last_preview_count >= 0),
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.automation_rule_versions (
  id bigint generated always as identity primary key,
  rule_id uuid not null references public.automation_rules(id) on delete cascade,
  version integer not null check (version > 0),
  snapshot jsonb not null,
  change_note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (rule_id, version)
);

create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.automation_rules(id) on delete restrict,
  rule_version integer not null,
  status text not null check (status in ('previewed','queued','running','succeeded','partial','failed','cancelled')),
  trigger_type text not null default 'manual' check (trigger_type in ('schedule','manual','event','retry')),
  source_snapshot jsonb not null default '{}'::jsonb,
  checked_count integer not null default 0 check (checked_count >= 0),
  eligible_count integer not null default 0 check (eligible_count >= 0),
  review_count integer not null default 0 check (review_count >= 0),
  excluded_count integer not null default 0 check (excluded_count >= 0),
  action_count integer not null default 0 check (action_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  summary text,
  details jsonb not null default '{}'::jsonb,
  approved_by uuid references public.profiles(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists automation_runs_rule_started_idx
  on public.automation_runs (rule_id, started_at desc);
create index if not exists automation_rules_status_category_idx
  on public.automation_rules (status, category, updated_at desc);

alter table public.automation_rules enable row level security;
alter table public.automation_rule_versions enable row level security;
alter table public.automation_runs enable row level security;

revoke all on table public.automation_rules, public.automation_rule_versions, public.automation_runs
  from public, anon;
grant select, insert, update on table public.automation_rules to authenticated;
grant select, insert on table public.automation_rule_versions to authenticated;
grant select on table public.automation_runs to authenticated;
grant select, insert, update, delete on table public.automation_rules, public.automation_rule_versions, public.automation_runs
  to service_role;
grant usage, select on sequence public.automation_rule_versions_id_seq to authenticated, service_role;

drop policy if exists automation_rules_read on public.automation_rules;
create policy automation_rules_read on public.automation_rules for select to authenticated
  using (public.app_has_any_permission(array['agents.view']));
drop policy if exists automation_rules_insert on public.automation_rules;
create policy automation_rules_insert on public.automation_rules for insert to authenticated
  with check (public.app_has_any_permission(array['agents.manage']) and created_by = (select auth.uid()));
drop policy if exists automation_rules_update on public.automation_rules;
create policy automation_rules_update on public.automation_rules for update to authenticated
  using (public.app_has_any_permission(array['agents.manage']))
  with check (public.app_has_any_permission(array['agents.manage']) and updated_by = (select auth.uid()));

drop policy if exists automation_rule_versions_read on public.automation_rule_versions;
create policy automation_rule_versions_read on public.automation_rule_versions for select to authenticated
  using (public.app_has_any_permission(array['agents.view']));
drop policy if exists automation_rule_versions_insert on public.automation_rule_versions;
create policy automation_rule_versions_insert on public.automation_rule_versions for insert to authenticated
  with check (public.app_has_any_permission(array['agents.manage']) and created_by = (select auth.uid()));

drop policy if exists automation_runs_read on public.automation_runs;
create policy automation_runs_read on public.automation_runs for select to authenticated
  using (public.app_has_any_permission(array['agents.view']));

create or replace function public.save_automation_rule(p_rule jsonb, p_change_note text default null)
returns public.automation_rules
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id uuid := nullif(p_rule->>'id','')::uuid;
  v_current public.automation_rules;
  v_saved public.automation_rules;
  v_version integer;
begin
  if not public.app_has_any_permission(array['agents.manage']) then
    raise exception 'forbidden';
  end if;
  if nullif(trim(p_rule->>'name'),'') is null or nullif(trim(p_rule->>'event_type'),'') is null then
    raise exception 'invalid_automation_rule';
  end if;

  if v_id is null then
    insert into public.automation_rules (
      rule_key,name,objective,category,status,execution_mode,event_type,trigger_source,
      trigger_config,conditions,exclusions,template_name,template_language,template_variables,
      schedule_config,safeguards,created_by,updated_by
    ) values (
      coalesce(nullif(trim(p_rule->>'rule_key'),''),'custom_'||replace(gen_random_uuid()::text,'-','')),
      trim(p_rule->>'name'),coalesce(p_rule->>'objective',''),coalesce(p_rule->>'category','operations'),
      coalesce(p_rule->>'status','draft'),coalesce(p_rule->>'execution_mode','preview'),
      p_rule->>'event_type',coalesce(p_rule->>'trigger_source','manual'),
      coalesce(p_rule->'trigger_config','{}'::jsonb),coalesce(p_rule->'conditions','[]'::jsonb),
      coalesce(p_rule->'exclusions','[]'::jsonb),coalesce(p_rule->>'template_name',''),
      coalesce(p_rule->>'template_language','ar'),coalesce(p_rule->'template_variables','[]'::jsonb),
      coalesce(p_rule->'schedule_config','{}'::jsonb),coalesce(p_rule->'safeguards','{}'::jsonb),
      (select auth.uid()),(select auth.uid())
    ) returning * into v_saved;
  else
    select * into v_current from public.automation_rules where id = v_id for update;
    if not found then raise exception 'automation_rule_not_found'; end if;
    v_version := v_current.version + 1;
    update public.automation_rules set
      name=trim(p_rule->>'name'), objective=coalesce(p_rule->>'objective',''),
      category=coalesce(p_rule->>'category',category), status=coalesce(p_rule->>'status',status),
      execution_mode=coalesce(p_rule->>'execution_mode',execution_mode),
      event_type=coalesce(p_rule->>'event_type',event_type), trigger_source=coalesce(p_rule->>'trigger_source',trigger_source),
      trigger_config=coalesce(p_rule->'trigger_config',trigger_config), conditions=coalesce(p_rule->'conditions',conditions),
      exclusions=coalesce(p_rule->'exclusions',exclusions), template_name=coalesce(p_rule->>'template_name',''),
      template_language=coalesce(p_rule->>'template_language','ar'),
      template_variables=coalesce(p_rule->'template_variables','[]'::jsonb),
      schedule_config=coalesce(p_rule->'schedule_config','{}'::jsonb),
      safeguards=coalesce(p_rule->'safeguards',safeguards), version=v_version,
      updated_by=(select auth.uid()), updated_at=now()
    where id=v_id returning * into v_saved;
  end if;

  insert into public.automation_rule_versions(rule_id,version,snapshot,change_note,created_by)
  values (v_saved.id,v_saved.version,to_jsonb(v_saved)-'last_preview_at'-'last_preview_count'-'last_run_at'-'next_run_at',p_change_note,(select auth.uid()));
  return v_saved;
end;
$$;
revoke all on function public.save_automation_rule(jsonb,text) from public, anon;
grant execute on function public.save_automation_rule(jsonb,text) to authenticated;

create schema if not exists private;
create or replace function private.automation_preview_payload(p_rule public.automation_rules)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_days integer := greatest(coalesce((p_rule.trigger_config->>'days')::integer,5),0);
  v_lookback integer := greatest(coalesce((p_rule.trigger_config->>'lookbackHours')::integer,24),1);
  v_min_amount numeric := greatest(coalesce((p_rule.trigger_config->>'minAmount')::numeric,0.50),0);
  v_limit integer := least(greatest(coalesce((p_rule.safeguards->>'maxRecipientsPerRun')::integer,500),1),2000);
  v_payload jsonb;
begin
  if not public.app_has_any_permission(array['agents.view']) then raise exception 'forbidden'; end if;

  if p_rule.event_type in ('new_customer','account_deactivated') then
    with base as (
      select e.store_id,e.store_name,public.norm_sa_phone(e.phone) phone,e.observed_at,
             row_number() over(partition by public.norm_sa_phone(e.phone) order by e.observed_at desc,e.store_id) rn
      from public.merchant_lifecycle_events e
      where e.event_type=case when p_rule.event_type='new_customer' then 'registered' else 'deactivated' end
        and e.observed_at >= now()-(v_lookback||' hours')::interval
    ), scored as (
      select *,
        case when phone is null or length(phone)<11 then 'ineligible'
             when exists(select 1 from public.no_whatsapp_phones() b where b.phone=base.phone) then 'ineligible'
             else 'eligible' end decision,
        case when phone is null or length(phone)<11 then 'رقم الجوال غير صالح'
             when exists(select 1 from public.no_whatsapp_phones() b where b.phone=base.phone) then 'الرقم محظور أو غير قابل للتسليم'
             else 'مطابق للشروط' end reason
      from base where rn=1
    ), stats as (
      select count(*)::int total,count(*) filter(where decision='eligible')::int eligible,
             count(*) filter(where decision='ineligible')::int ineligible from scored
    ), items as (
      select coalesce(jsonb_agg(jsonb_build_object('storeId',store_id,'name',store_name,'phone',phone,'decision',decision,'reason',reason,'observedAt',observed_at) order by observed_at desc),'[]'::jsonb) value
      from (select * from scored order by observed_at desc limit 50) q
    )
    select jsonb_build_object('total',stats.total,'eligible',stats.eligible,'review',0,'ineligible',stats.ineligible,'items',items.value,'source','Lamha lifecycle events')
    into v_payload from stats cross join items;

  elsif p_rule.event_type in ('stopped_shipping','never_shipped') then
    with latest as (select snapshot_id,max(uploaded_at) source_at from public.merchants group by snapshot_id order by source_at desc limit 1),
    grouped as (
      select public.norm_sa_phone(m.phone) phone,(array_agg(m.store_name order by coalesce(m.shipment_count,0) desc,m.store_id))[1] name,
             count(*)::int store_count,sum(coalesce(m.shipment_count,0))::bigint shipments,max(m.last_shipment_at) last_shipment,
             bool_or(public.lamha_account_enabled(m.status)) account_enabled
      from public.merchants m join latest l on l.snapshot_id=m.snapshot_id
      group by public.norm_sa_phone(m.phone)
    ), base as (
      select *,case when phone is null or length(phone)<11 then 'ineligible'
                    when not account_enabled then 'ineligible'
                    when exists(select 1 from public.no_whatsapp_phones() b where b.phone=grouped.phone) then 'ineligible'
                    else 'eligible' end decision
      from grouped
      where case when p_rule.event_type='never_shipped' then shipments=0 or last_shipment is null
                 else shipments>0 and last_shipment::date <= current_date-v_days end
    ), stats as (
      select count(*)::int total,count(*) filter(where decision='eligible')::int eligible,
             count(*) filter(where decision='ineligible')::int ineligible from base
    ), items as (
      select coalesce(jsonb_agg(jsonb_build_object('name',name,'phone',phone,'storeCount',store_count,'shipments',shipments,'lastShipment',last_shipment,'decision',decision,'reason',case when decision='eligible' then 'مطابق للشروط' when not account_enabled then 'الحساب موقوف' else 'رقم غير صالح أو محظور' end) order by last_shipment nulls first),'[]'::jsonb) value
      from (select * from base order by last_shipment nulls first limit 50) q
    )
    select jsonb_build_object('total',stats.total,'eligible',stats.eligible,'review',0,'ineligible',stats.ineligible,'items',items.value,'source','Latest Lamha merchant snapshot')
    into v_payload from stats cross join items;

  elsif p_rule.event_type='invoice_overdue' then
    with debts as (
      select z.customer_name,sum(z.balance)::numeric owed,count(*)::int invoice_count,
             min(coalesce(z.due_date,z.date)) oldest_due
      from public.zoho_invoices z
      where coalesce(z.balance,0)>v_min_amount
        and lower(coalesce(z.status,'')) not in ('draft','void','cancelled','paid')
        and current_date-coalesce(z.due_date,z.date)>=v_days
      group by z.customer_name
    ), latest as (select snapshot_id,max(uploaded_at) source_at from public.merchants group by snapshot_id order by source_at desc limit 1),
    linked as (
      select d.*,m.store_name,public.norm_sa_phone(m.phone) phone,
             row_number() over(partition by d.customer_name order by coalesce(m.shipment_count,0) desc,m.store_id) rn
      from debts d left join public.customer_merchant_links l on l.customer_name=d.customer_name
      left join public.merchants m on m.store_id=l.store_id and m.snapshot_id=(select snapshot_id from latest)
    ), base as (
      select *,case when phone is null or length(phone)<11 then 'review'
                    when exists(select 1 from public.no_whatsapp_phones() b where b.phone=linked.phone) then 'ineligible'
                    else 'eligible' end decision
      from linked where rn=1 limit v_limit
    ), stats as (
      select count(*)::int total,count(*) filter(where decision='eligible')::int eligible,
             count(*) filter(where decision='review')::int review,
             count(*) filter(where decision='ineligible')::int ineligible from base
    ), items as (
      select coalesce(jsonb_agg(jsonb_build_object('name',coalesce(store_name,customer_name),'customerName',customer_name,'phone',phone,'amount',owed,'invoiceCount',invoice_count,'oldestDue',oldest_due,'decision',decision,'reason',case when decision='eligible' then 'مطابق للشروط' when decision='review' then 'لا يوجد ربط بجوال صالح' else 'الرقم محظور أو غير قابل للتسليم' end) order by owed desc),'[]'::jsonb) value
      from (select * from base order by owed desc limit 50) q
    )
    select jsonb_build_object('total',stats.total,'eligible',stats.eligible,'review',stats.review,'ineligible',stats.ineligible,'items',items.value,'source','Zoho open invoices + Lamha directory')
    into v_payload from stats cross join items;
  else
    v_payload:=jsonb_build_object('total',0,'eligible',0,'review',0,'ineligible',0,'items','[]'::jsonb,'source','Manual rule','notice','لا تتوفر معاينة تلقائية لهذا المحفز بعد');
  end if;
  return coalesce(v_payload,jsonb_build_object('total',0,'eligible',0,'review',0,'ineligible',0,'items','[]'::jsonb));
end;
$$;
revoke all on function private.automation_preview_payload(public.automation_rules) from public, anon, authenticated;

create or replace function public.preview_automation_rule(p_rule_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
declare v_rule public.automation_rules; v_payload jsonb;
begin
  if not public.app_has_any_permission(array['agents.view']) then raise exception 'forbidden'; end if;
  select * into v_rule from public.automation_rules where id=p_rule_id;
  if not found then raise exception 'automation_rule_not_found'; end if;
  v_payload:=private.automation_preview_payload(v_rule);
  if public.app_has_any_permission(array['agents.manage']) then
    update public.automation_rules set last_preview_at=now(),last_preview_count=coalesce((v_payload->>'eligible')::integer,0),updated_by=(select auth.uid()) where id=p_rule_id;
  end if;
  return v_payload;
end;
$$;
revoke all on function public.preview_automation_rule(uuid) from public, anon;
grant execute on function public.preview_automation_rule(uuid) to authenticated;

insert into public.automation_rules (
  rule_key,name,objective,category,status,execution_mode,event_type,trigger_source,
  trigger_config,conditions,exclusions,template_name,template_variables,schedule_config,safeguards
) values
('welcome_new_customer','ترحيب العميل الجديد','التواصل مع كل رقم جديد يظهر لأول مرة في دليل لمحة.','sales','preview','preview','new_customer','lamha',
 '{"lookbackHours":24}'::jsonb,'[{"field":"first_seen","operator":"within_window"}]'::jsonb,
 '["invalid_phone","blocked_phone","duplicate_phone","previous_same_template"]'::jsonb,'newcustmer',
 '[{"position":1,"mode":"fixed","value":""},{"position":2,"mode":"fixed","value":""}]'::jsonb,
 '{"afterSuccessfulSync":true,"delayMinutes":10,"sendWindowStart":"09:00","sendWindowEnd":"20:00"}'::jsonb,
 '{"audienceIdentity":"normalized_phone","dedupeHours":720,"maxMessagesPerPhonePerDay":1,"maxRecipientsPerRun":200,"requireFreshSources":true,"retryConfirmedFailures":1,"blockUnknownDeliveryRetry":true}'::jsonb),
('invoice_overdue_15','تذكير فواتير 15 يومًا','تجهيز تذكير للعملاء الذين لديهم رصيد قابل للتحصيل تشغيليًا وفاتورة بلغ عمرها 15 يومًا.','collections','preview','preview','invoice_overdue','zoho',
 '{"days":15,"minAmount":0.50}'::jsonb,'[{"field":"invoice_age_days","operator":"gte","value":15},{"field":"operational_collectible","operator":"gt","value":0.50}]'::jsonb,
 '["draft_invoice","residual_balance_only","invalid_phone","blocked_phone","recent_collection_message"]'::jsonb,'sadad',
 '[{"position":1,"mode":"fixed","value":""},{"position":2,"mode":"fixed","value":""}]'::jsonb,
 '{"afterSuccessfulSync":true,"delayMinutes":15,"sendWindowStart":"09:00","sendWindowEnd":"18:00"}'::jsonb,
 '{"audienceIdentity":"normalized_phone","dedupeHours":168,"maxMessagesPerPhonePerDay":1,"maxRecipientsPerRun":500,"requireFreshSources":true,"retryConfirmedFailures":1,"blockUnknownDeliveryRetry":true}'::jsonb),
('account_deactivated','إشعار الحساب الموقوف','التقاط انتقال حساب لمحة إلى inactive فقط دون تنفيذ إيقاف أو تشغيل.','operations','preview','preview','account_deactivated','lamha',
 '{"lookbackHours":24}'::jsonb,'[{"field":"account_status","operator":"eq","value":"inactive"}]'::jsonb,
 '["invalid_phone","blocked_phone","unknown_transition"]'::jsonb,'',
 '[{"position":1,"mode":"fixed","value":""},{"position":2,"mode":"fixed","value":""}]'::jsonb,
 '{"afterSuccessfulSync":true,"delayMinutes":10,"sendWindowStart":"09:00","sendWindowEnd":"20:00"}'::jsonb,
 '{"audienceIdentity":"normalized_phone","dedupeHours":720,"maxMessagesPerPhonePerDay":1,"maxRecipientsPerRun":200,"requireFreshSources":true,"retryConfirmedFailures":1,"blockUnknownDeliveryRetry":true}'::jsonb),
('stopped_shipping_5d','توقف الشحن 5 أيام','إحالة من سبق له الشحن ثم تجاوزت آخر شحنة خمسة أيام إلى الحفاظ على العملاء.','retention','preview','preview','stopped_shipping','lamha',
 '{"days":5}'::jsonb,'[{"field":"shipment_count","operator":"gt","value":0},{"field":"days_since_last_shipment","operator":"gte","value":5}]'::jsonb,
 '["inactive_account","invalid_phone","blocked_phone","recent_retention_contact"]'::jsonb,'',
 '[{"position":1,"mode":"fixed","value":""},{"position":2,"mode":"fixed","value":""}]'::jsonb,
 '{"afterSuccessfulSync":true,"delayMinutes":20,"sendWindowStart":"09:00","sendWindowEnd":"20:00"}'::jsonb,
 '{"audienceIdentity":"normalized_phone","dedupeHours":336,"maxMessagesPerPhonePerDay":1,"maxRecipientsPerRun":500,"requireFreshSources":true,"retryConfirmedFailures":1,"blockUnknownDeliveryRetry":true}'::jsonb),
('never_shipped','لم يشحن إطلاقًا','إحالة العميل الذي لم ينفذ أي شحنة إلى المبيعات بدل خلطه مع العملاء المتوقفين.','sales','preview','preview','never_shipped','lamha',
 '{"days":5}'::jsonb,'[{"field":"shipment_count","operator":"eq","value":0},{"field":"days_since_registration","operator":"gte","value":5}]'::jsonb,
 '["inactive_account","invalid_phone","blocked_phone","recent_sales_contact"]'::jsonb,'',
 '[{"position":1,"mode":"fixed","value":""},{"position":2,"mode":"fixed","value":""}]'::jsonb,
 '{"afterSuccessfulSync":true,"delayMinutes":20,"sendWindowStart":"09:00","sendWindowEnd":"20:00"}'::jsonb,
 '{"audienceIdentity":"normalized_phone","dedupeHours":336,"maxMessagesPerPhonePerDay":1,"maxRecipientsPerRun":500,"requireFreshSources":true,"retryConfirmedFailures":1,"blockUnknownDeliveryRetry":true}'::jsonb)
on conflict(rule_key) do nothing;

insert into public.automation_rule_versions(rule_id,version,snapshot,change_note)
select r.id,r.version,to_jsonb(r)-'last_preview_at'-'last_preview_count'-'last_run_at'-'next_run_at','تأسيس آمن بوضع المعاينة'
from public.automation_rules r
where r.rule_key in ('welcome_new_customer','invoice_overdue_15','account_deactivated','stopped_shipping_5d','never_shipped')
on conflict(rule_id,version) do nothing;

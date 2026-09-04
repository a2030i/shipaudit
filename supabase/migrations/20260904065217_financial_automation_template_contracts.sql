-- Approved Hatif template contracts and safe financial automation previews.
-- This migration does not queue a campaign and does not write to Lamha or Zoho.

create table if not exists public.automation_template_contracts (
  template_name text primary key,
  language text not null default 'ar',
  category text not null check (category in ('sales','retention','collections','operations','marketing')),
  purpose text not null,
  approved boolean not null default false,
  variable_contract jsonb not null default '[]'::jsonb check (jsonb_typeof(variable_contract) = 'array'),
  notes text,
  updated_at timestamptz not null default now()
);

alter table public.automation_template_contracts enable row level security;
revoke all on table public.automation_template_contracts from public, anon;
grant select on table public.automation_template_contracts to authenticated;
grant select, insert, update, delete on table public.automation_template_contracts to service_role;

drop policy if exists automation_template_contracts_read on public.automation_template_contracts;
create policy automation_template_contracts_read
on public.automation_template_contracts for select to authenticated
using (public.app_has_any_permission(array['agents.view']));

insert into public.automation_template_contracts (
  template_name, language, category, purpose, approved, variable_contract, notes
) values
  ('masrah','ar','sales','ترحيب العميل الجديد بعد ظهوره في مزامنة لمحة الناجحة.',true,
   '[{"position":1,"key":"employee_name","label":"اسم الموظف","mode":"fixed"},{"position":2,"key":"contact_reason","label":"سبب التواصل","mode":"fixed"}]'::jsonb,
   'القيمتان ثابتتان ويعدلهما المدير من مركز الأتمتة.'),
  ('retarget_no_ship','ar','sales','تفعيل متجر مسجل لم ينفذ أي شحنة بعد.',true,
   '[{"position":1,"key":"name","label":"اسم المتجر/العميل","mode":"field","source":"field:name"}]'::jsonb,
   'لا يرسل إلى حساب inactive.'),
  ('retarget_stopped','ar','retention','التواصل مع متجر سبق له الشحن ثم توقف نشاطه.',true,
   '[{"position":1,"key":"name","label":"اسم المتجر/العميل","mode":"field","source":"field:name"},{"position":2,"key":"last_shipment","label":"تاريخ آخر شحنة","mode":"field","source":"field:last_shipment"}]'::jsonb,
   'القالب يذكر أن الحساب فعال؛ لذلك يستبعد حساب inactive.'),
  ('sadad','ar','collections','مطالبة سداد عامة بمبلغ وعدد فواتير.',true,
   '[{"position":1,"key":"name","label":"اسم المتجر/العميل","mode":"field","source":"field:name"},{"position":2,"key":"full_amount","label":"إجمالي القابل للتحصيل","mode":"field","source":"field:full_amount"},{"position":3,"key":"count","label":"عدد الفواتير","mode":"field","source":"field:count"}]'::jsonb,
   'قالب عام ولا يذكر عمر الدين أو مهلة الإيقاف.'),
  ('tahseel_portal_balance_v2','ar','collections','تذكير تحصيل يوضح الإجمالي وشريحة التأخير ويربط ببوابة التحصيل.',true,
   '[{"position":1,"key":"name","label":"اسم المتجر/العميل","mode":"field","source":"field:name"},{"position":2,"key":"full_amount","label":"إجمالي القابل للتحصيل","mode":"field","source":"field:full_amount"},{"position":3,"key":"count","label":"عدد الفواتير","mode":"field","source":"field:count"},{"position":4,"key":"filtered_overdue_amount","label":"مبلغ الفواتير المطابقة للعمر","mode":"field","source":"field:filtered_overdue_amount"},{"position":5,"key":"aging_filter","label":"وصف شريحة عمر الدين","mode":"field","source":"field:aging_filter"}]'::jsonb,
   'القالب المعتمد الأنسب لتذكير اليوم 15؛ لا يتضمن تهديد إيقاف.'),
  ('saudi_national_day_shipping_offer','ar','marketing','عرض تسويقي معتمد دون متغيرات.',true,'[]'::jsonb,
   'ليس قالبًا تشغيليًا للتحصيل أو الاحتفاظ.')
on conflict (template_name) do update set
  language=excluded.language,
  category=excluded.category,
  purpose=excluded.purpose,
  approved=excluded.approved,
  variable_contract=excluded.variable_contract,
  notes=excluded.notes,
  updated_at=now();

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
  if new.rule_key = 'financial_suspension_review_31d'
     and (new.status = 'active' or new.execution_mode = 'automatic') then
    raise exception 'financial_suspension_automation_requires_explicit_external_approval';
  end if;

  if new.status = 'active' and new.execution_mode = 'automatic' then
    if nullif(trim(new.template_name), '') is null then
      raise exception 'active_automation_template_required';
    end if;

    select * into v_contract
    from public.automation_template_contracts
    where template_name = new.template_name and approved is true;
    if not found then raise exception 'approved_automation_template_contract_required'; end if;

    if jsonb_typeof(new.template_variables) <> 'array'
       or jsonb_array_length(new.template_variables) <> jsonb_array_length(v_contract.variable_contract) then
      raise exception 'automation_template_variable_arity_mismatch';
    end if;

    for v_expected in select value from jsonb_array_elements(v_contract.variable_contract)
    loop
      select value into v_actual
      from jsonb_array_elements(new.template_variables)
      where (value->>'position')::integer = (v_expected->>'position')::integer
      limit 1;
      if v_actual is null then raise exception 'automation_template_variable_missing'; end if;
      if v_expected->>'mode' = 'fixed'
         and (v_actual->>'mode' <> 'fixed' or nullif(trim(v_actual->>'value'),'') is null) then
        raise exception 'automation_fixed_template_variable_required';
      end if;
      if v_expected->>'mode' = 'field'
         and (v_actual->>'mode' <> 'field' or v_actual->>'source' is distinct from v_expected->>'source') then
        raise exception 'automation_template_variable_source_mismatch';
      end if;
      v_actual := null;
    end loop;

    if coalesce((new.schedule_config->>'afterSuccessfulSync')::boolean, false) is not true then
      raise exception 'active_automation_successful_sync_required';
    end if;
    if coalesce((new.safeguards->>'maxMessagesPerPhonePerDay')::integer, 0) <> 1 then
      raise exception 'automation_one_message_per_phone_per_day_required';
    end if;
    if coalesce((new.safeguards->>'blockUnknownDeliveryRetry')::boolean, false) is not true then
      raise exception 'automation_unknown_delivery_retry_must_be_blocked';
    end if;
    if new.rule_key = 'welcome_new_customer'
       and coalesce(new.safeguards->>'dedupeMode', '') <> 'once_per_snapshot_phone' then
      raise exception 'welcome_automation_snapshot_dedupe_required';
    end if;
  end if;
  return new;
end;
$function$;

revoke all on function private.validate_automation_rule_activation() from public, anon, authenticated;

create or replace function private.financial_automation_preview_payload(p_rule public.automation_rules)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_days integer := greatest(coalesce((p_rule.trigger_config->>'days')::integer,15),1);
  v_min_amount numeric := greatest(coalesce((p_rule.trigger_config->>'minAmount')::numeric,0.50),0.50);
  v_source_hours integer := least(greatest(coalesce((p_rule.safeguards->>'maxSourceAgeHours')::integer,18),1),72);
  v_strict_age boolean := p_rule.event_type = 'financial_suspension_review';
  v_payload jsonb;
begin
  if not public.app_has_any_permission(array['agents.view']) then raise exception 'forbidden'; end if;

  with latest_merchant as (
    select snapshot_id,max(uploaded_at) source_at
    from public.merchants group by snapshot_id order by source_at desc limit 1
  ), source_state as (
    select
      (select source_at from latest_merchant) lamha_at,
      (select last_sync from public.zoho_sync_state where entity='invoices' and last_status='succeeded') zoho_at
  ), debts as (
    select l.contact_id::text contact_id,l.contact_name,
      round(sum(l.collectible_amount)::numeric,2) overdue_amount,
      count(distinct l.line_id)::int invoice_count,
      max(l.age_days)::int oldest_days
    from public.customer_collectible_lines l
    where l.line_kind='invoice'
      and l.collectible_amount>v_min_amount
      and lower(coalesce(l.status,'')) not in ('draft','مسودة','void','cancelled','paid')
      and case when v_strict_age then l.age_days>v_days else l.age_days>=v_days end
    group by l.contact_id::text,l.contact_name
  ), linked_ranked as (
    select d.*,fp.accounting_outstanding,fp.operational_collectible,fp.residual_balance,fp.reconciled_exactly,
      m.store_id,m.store_name,public.norm_sa_phone(m.phone) phone,m.status account_status,
      row_number() over(partition by d.contact_id order by coalesce(m.shipment_count,0) desc,m.store_id) rn
    from debts d
    left join public.customer_financial_operational_position fp on fp.zoho_id=d.contact_id
    left join public.customer_merchant_links link on link.zoho_contact_id=d.contact_id
    left join latest_merchant snapshot on true
    left join public.merchants m on m.store_id=link.store_id and m.snapshot_id=snapshot.snapshot_id
  ), linked as (
    select * from linked_ranked where rn=1
  ), phone_scope as (
    select l.*,count(*) over(partition by l.phone) phone_entity_count
    from linked l
  ), scored as (
    select p.*,
      case
        when p.phone is null or length(p.phone)<11 or p.store_id is null then 'review'
        when p.phone_entity_count>1 then 'review'
        when p.reconciled_exactly is not true then 'review'
        when s.lamha_at is null or s.zoho_at is null
          or s.lamha_at<now()-(v_source_hours||' hours')::interval
          or s.zoho_at<now()-(v_source_hours||' hours')::interval then 'review'
        when exists(select 1 from public.no_whatsapp_phones() b where b.phone=p.phone) then 'ineligible'
        when exists(select 1 from public.whatsapp_campaign_sends w where public.norm_sa_phone(w.phone)=p.phone and w.sent_at>=now()-interval '24 hours') then 'ineligible'
        when v_strict_age and not public.lamha_account_enabled(p.account_status) then 'ineligible'
        else 'eligible'
      end decision,
      case
        when p.phone is null or length(p.phone)<11 or p.store_id is null then 'لا يوجد ربط موثوق بمتجر وجوال صالح'
        when p.phone_entity_count>1 then 'الجوال مرتبط بأكثر من جهة Zoho؛ يحتاج قرارًا دون دمج الديون'
        when p.reconciled_exactly is not true then 'المركز المالي لا يطابق العقد الدقيق'
        when s.lamha_at is null or s.zoho_at is null
          or s.lamha_at<now()-(v_source_hours||' hours')::interval
          or s.zoho_at<now()-(v_source_hours||' hours')::interval then 'أحد مصدري لمحة أو Zoho قديم'
        when exists(select 1 from public.no_whatsapp_phones() b where b.phone=p.phone) then 'الرقم محظور أو غير قابل للتسليم'
        when exists(select 1 from public.whatsapp_campaign_sends w where public.norm_sa_phone(w.phone)=p.phone and w.sent_at>=now()-interval '24 hours') then 'وصلت للجوال رسالة خلال آخر 24 ساعة'
        when v_strict_age and not public.lamha_account_enabled(p.account_status) then 'الحساب موقوف مسبقًا في لمحة'
        else case when v_strict_age then 'مؤهل لمراجعة الإيقاف فقط' else 'مؤهل لمراجعة تذكير السداد' end
      end reason,
      s.lamha_at,s.zoho_at
    from phone_scope p cross join source_state s
  ), stats as (
    select count(*)::int total,
      count(*) filter(where decision='eligible')::int eligible,
      count(*) filter(where decision='review')::int review,
      count(*) filter(where decision='ineligible')::int ineligible
    from scored
  ), items as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'storeId',store_id,'name',coalesce(store_name,contact_name),'customerName',contact_name,
      'phone',phone,'amount',overdue_amount,'invoiceCount',invoice_count,'oldestDays',oldest_days,
      'accountingOutstanding',accounting_outstanding,'operationalCollectible',operational_collectible,
      'residualBalance',residual_balance,'accountStatus',account_status,
      'decision',decision,'reason',reason
    ) order by overdue_amount desc),'[]'::jsonb) value
    from (select * from scored order by overdue_amount desc limit 50) q
  )
  select jsonb_build_object(
    'total',stats.total,'eligible',stats.eligible,'review',stats.review,'ineligible',stats.ineligible,
    'items',items.value,'source','Operational Collectible + authoritative Zoho/Lamha link',
    'freshness',jsonb_build_object('lamhaAt',(select lamha_at from source_state),'zohoAt',(select zoho_at from source_state)),
    'notice',case when v_strict_age
      then 'معاينة قرار فقط: العمر أكبر من 30 يومًا، الرصيد الافتتاحي مستبعد حتى اعتماد تعريفه، ولا ينفذ أي إيقاف.'
      else 'المبلغ من الفواتير القابلة للتحصيل تشغيليًا فقط؛ الرصيد الهامشي والافتتاحي لا يدخلان هذا الجمهور.' end
  ) into v_payload from stats cross join items;

  return coalesce(v_payload,jsonb_build_object('total',0,'eligible',0,'review',0,'ineligible',0,'items','[]'::jsonb));
end;
$function$;

revoke all on function private.financial_automation_preview_payload(public.automation_rules)
  from public, anon, authenticated;

create or replace function public.preview_automation_rule(p_rule_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $function$
declare v_rule public.automation_rules; v_payload jsonb;
begin
  if not public.app_has_any_permission(array['agents.view']) then raise exception 'forbidden'; end if;
  select * into v_rule from public.automation_rules where id=p_rule_id;
  if not found then raise exception 'automation_rule_not_found'; end if;
  if v_rule.event_type in ('invoice_overdue','financial_suspension_review') then
    v_payload:=private.financial_automation_preview_payload(v_rule);
  else
    v_payload:=private.automation_preview_payload(v_rule);
  end if;
  if public.app_has_any_permission(array['agents.manage']) then
    update public.automation_rules
    set last_preview_at=now(),last_preview_count=coalesce((v_payload->>'eligible')::integer,0),updated_by=(select auth.uid())
    where id=p_rule_id;
  end if;
  return v_payload;
end;
$function$;

revoke all on function public.preview_automation_rule(uuid) from public, anon;
grant execute on function public.preview_automation_rule(uuid) to authenticated;

update public.automation_rules set
  status='review', execution_mode='review', template_name='tahseel_portal_balance_v2',
  template_variables='[{"position":1,"mode":"field","source":"field:name","value":""},{"position":2,"mode":"field","source":"field:full_amount","value":""},{"position":3,"mode":"field","source":"field:count","value":""},{"position":4,"mode":"field","source":"field:filtered_overdue_amount","value":""},{"position":5,"mode":"field","source":"field:aging_filter","value":""}]'::jsonb,
  exclusions='["draft_invoice","residual_balance_only","opening_balance_requires_manual_review","invalid_phone","blocked_phone","recent_collection_message","shared_phone_multiple_zoho_entities","stale_source","reconciliation_issue"]'::jsonb,
  safeguards=safeguards||'{"maxSourceAgeHours":18,"crossAutomationCooldownHours":24,"openingBalancePolicy":"excluded_pending_business_approval","templateContractVersion":1}'::jsonb,
  version=version+1,updated_at=now()
where rule_key='invoice_overdue_15';

update public.automation_rules set
  template_name='retarget_stopped',
  template_variables='[{"position":1,"mode":"field","source":"field:name","value":""},{"position":2,"mode":"field","source":"field:last_shipment","value":""}]'::jsonb,
  safeguards=safeguards||'{"crossAutomationCooldownHours":24,"templateContractVersion":1}'::jsonb,
  version=version+1,updated_at=now()
where rule_key='stopped_shipping_5d';

update public.automation_rules set
  template_name='retarget_no_ship',
  template_variables='[{"position":1,"mode":"field","source":"field:name","value":""}]'::jsonb,
  safeguards=safeguards||'{"crossAutomationCooldownHours":24,"templateContractVersion":1}'::jsonb,
  version=version+1,updated_at=now()
where rule_key='never_shipped';

insert into public.automation_rules (
  rule_key,name,objective,category,status,execution_mode,event_type,trigger_source,
  trigger_config,conditions,exclusions,template_name,template_variables,schedule_config,safeguards
) values
  ('invoice_overdue_final_warning_30d','إنذار السداد النهائي عند 30 يومًا',
   'تجهيز جمهور إنذار نهائي منفصل قبل أي مراجعة إيقاف؛ لا يرسل حتى اعتماد قالب يذكر المهلة والنتيجة بوضوح.',
   'collections','draft','preview','invoice_overdue','zoho','{"days":30,"minAmount":0.50}'::jsonb,
   '[{"field":"invoice_age_days","operator":"gte","value":30},{"field":"operational_collectible","operator":"gt","value":0.50}]'::jsonb,
   '["draft_invoice","residual_balance_only","opening_balance_requires_manual_review","invalid_phone","blocked_phone","recent_collection_message","shared_phone_multiple_zoho_entities","stale_source","reconciliation_issue"]'::jsonb,
   '','[]'::jsonb,'{"afterSuccessfulSync":true,"delayMinutes":15,"sendWindowStart":"09:00","sendWindowEnd":"18:00"}'::jsonb,
   '{"audienceIdentity":"normalized_phone","dedupeMode":"within_hours","dedupeHours":168,"crossAutomationCooldownHours":24,"maxMessagesPerPhonePerDay":1,"maxRecipientsPerRun":500,"maxSourceAgeHours":18,"requireFreshSources":true,"retryConfirmedFailures":1,"blockUnknownDeliveryRetry":true,"openingBalancePolicy":"excluded_pending_business_approval","requiresApprovedTemplate":true}'::jsonb),
  ('financial_suspension_review_31d','مراجعة الإيقاف المالي بعد 30 يومًا',
   'يبني قائمة قرار للحسابات العاملة ذات فواتير قابلة للتحصيل عمرها أكبر من 30 يومًا؛ لا ينفذ إيقافًا تلقائيًا.',
   'collections','review','review','financial_suspension_review','zoho','{"days":30,"minAmount":0.50,"strictAfter":true}'::jsonb,
   '[{"field":"invoice_age_days","operator":"gt","value":30},{"field":"operational_collectible","operator":"gt","value":0.50},{"field":"lamha_account_enabled","operator":"eq","value":true}]'::jsonb,
   '["draft_invoice","residual_balance_only","opening_balance_requires_manual_review","inactive_account","invalid_phone","shared_phone_multiple_zoho_entities","stale_source","reconciliation_issue"]'::jsonb,
   '','[]'::jsonb,'{"afterSuccessfulSync":true,"delayMinutes":20,"sendWindowStart":"09:00","sendWindowEnd":"18:00"}'::jsonb,
   '{"audienceIdentity":"authoritative_store_id","dedupeMode":"within_hours","dedupeHours":24,"maxMessagesPerPhonePerDay":1,"maxRecipientsPerRun":200,"maxSourceAgeHours":18,"requireFreshSources":true,"retryConfirmedFailures":0,"blockUnknownDeliveryRetry":true,"openingBalancePolicy":"excluded_pending_business_approval","requiresLiveLamhaPreflight":true,"externalWritesAllowed":false}'::jsonb)
on conflict(rule_key) do nothing;

insert into public.automation_rule_versions(rule_id,version,snapshot,change_note)
select r.id,r.version,to_jsonb(r)-'last_preview_at'-'last_preview_count'-'last_run_at'-'next_run_at',
  case r.rule_key
    when 'invoice_overdue_15' then 'ربط قالب بوابة التحصيل المعتمد وعقد متغيراته مع إبقاء التنفيذ في المراجعة'
    when 'stopped_shipping_5d' then 'ربط قالب الاحتفاظ المعتمد بمصادر بيانات مقفلة'
    when 'never_shipped' then 'ربط قالب أول شحنة المعتمد بمصدر الاسم'
    when 'invoice_overdue_final_warning_30d' then 'إنشاء مسودة إنذار نهائي دون قالب أو إرسال'
    else 'إنشاء مراجعة إيقاف مالية للقراءة فقط بعد 30 يومًا'
  end
from public.automation_rules r
where r.rule_key in ('invoice_overdue_15','stopped_shipping_5d','never_shipped','invoice_overdue_final_warning_30d','financial_suspension_review_31d')
on conflict(rule_id,version) do nothing;

comment on table public.automation_template_contracts is
  'Approved Hatif automation contracts. Variable order and source are explicit; an approved name alone is not enough to activate automation.';
comment on function private.financial_automation_preview_payload(public.automation_rules) is
  'Read-only preview based on operational collectible invoice lines, exact financial reconciliation, authoritative Zoho-to-Lamha links, source freshness and 24h communication collision protection.';

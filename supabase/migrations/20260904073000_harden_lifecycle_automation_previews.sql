-- Safe lifecycle previews: freshness, exact day semantics and cross-automation
-- communication collision protection. No campaign rows are created here.

create or replace function private.lifecycle_automation_preview_payload(p_rule public.automation_rules)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_days integer := greatest(coalesce((p_rule.trigger_config->>'days')::integer,5),0);
  v_source_hours integer := least(greatest(coalesce((p_rule.safeguards->>'maxSourceAgeHours')::integer,18),1),72);
  v_dedupe_hours integer := least(greatest(coalesce((p_rule.safeguards->>'dedupeHours')::integer,336),1),8760);
  v_payload jsonb;
begin
  if not public.app_has_any_permission(array['agents.view']) then raise exception 'forbidden'; end if;

  with latest as (
    select snapshot_id,max(uploaded_at) source_at
    from public.merchants group by snapshot_id order by source_at desc limit 1
  ), grouped as (
    select public.norm_sa_phone(m.phone) phone,
      (array_agg(m.store_name order by coalesce(m.shipment_count,0) desc,m.store_id))[1] name,
      count(*)::int store_count,sum(coalesce(m.shipment_count,0))::bigint shipments,
      max(m.last_shipment_at) last_shipment,min(m.created_at_platform) first_registered,
      bool_or(public.lamha_account_enabled(m.status)) account_enabled,
      max(l.source_at) source_at
    from public.merchants m join latest l on l.snapshot_id=m.snapshot_id
    group by public.norm_sa_phone(m.phone)
  ), candidates as (
    select * from grouped
    where case
      when p_rule.event_type='never_shipped' then
        (shipments=0 or last_shipment is null)
        and first_registered is not null
        and first_registered::date<=current_date-v_days
      else shipments>0 and last_shipment is not null and last_shipment::date<current_date-v_days
    end
  ), scored as (
    select c.*,
      case
        when phone is null or length(phone)<11 then 'ineligible'
        when not account_enabled then 'ineligible'
        when exists(select 1 from public.no_whatsapp_phones() b where b.phone=c.phone) then 'ineligible'
        when exists(select 1 from public.whatsapp_campaign_sends w where public.norm_sa_phone(w.phone)=c.phone and w.sent_at>=now()-interval '24 hours') then 'ineligible'
        when exists(select 1 from public.whatsapp_campaign_sends w where public.norm_sa_phone(w.phone)=c.phone and w.template_name=p_rule.template_name and w.sent_at>=now()-(v_dedupe_hours||' hours')::interval) then 'ineligible'
        when source_at<now()-(v_source_hours||' hours')::interval then 'review'
        when store_count>1 then 'review'
        else 'eligible'
      end decision,
      case
        when phone is null or length(phone)<11 then 'رقم الجوال غير صالح'
        when not account_enabled then 'الحساب موقوف في لمحة'
        when exists(select 1 from public.no_whatsapp_phones() b where b.phone=c.phone) then 'الرقم محظور أو غير قابل للتسليم'
        when exists(select 1 from public.whatsapp_campaign_sends w where public.norm_sa_phone(w.phone)=c.phone and w.sent_at>=now()-interval '24 hours') then 'وصلت للجوال رسالة خلال آخر 24 ساعة'
        when exists(select 1 from public.whatsapp_campaign_sends w where public.norm_sa_phone(w.phone)=c.phone and w.template_name=p_rule.template_name and w.sent_at>=now()-(v_dedupe_hours||' hours')::interval) then 'سبق إرسال القالب ضمن مدة الحماية'
        when source_at<now()-(v_source_hours||' hours')::interval then 'لقطة لمحة قديمة؛ يلزم تحديثها قبل القرار'
        when store_count>1 then 'الجوال مرتبط بعدة متاجر؛ يحتاج مراجعة الاسم قبل الإرسال'
        else 'مطابق للشروط'
      end reason
    from candidates c
  ), stats as (
    select count(*)::int total,
      count(*) filter(where decision='eligible')::int eligible,
      count(*) filter(where decision='review')::int review,
      count(*) filter(where decision='ineligible')::int ineligible
    from scored
  ), items as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name',name,'phone',phone,'storeCount',store_count,'shipments',shipments,
      'lastShipment',last_shipment,'firstRegistered',first_registered,
      'decision',decision,'reason',reason
    ) order by last_shipment nulls first),'[]'::jsonb) value
    from (select * from scored order by last_shipment nulls first limit 50) q
  )
  select jsonb_build_object(
    'total',stats.total,'eligible',stats.eligible,'review',stats.review,'ineligible',stats.ineligible,
    'items',items.value,'source','Latest Lamha merchant snapshot',
    'freshness',jsonb_build_object('lamhaAt',(select source_at from latest)),
    'notice',case when p_rule.event_type='never_shipped'
      then 'يشترط مرور مدة التسجيل المحددة دون أي شحنة، وحساب Lamha يعمل، ولا توجد رسالة أخرى خلال 24 ساعة.'
      else 'توقف النشاط يعني أن آخر شحنة مضى عليها أكثر من المدة المحددة؛ inactive مستبعد لأن القالب يذكر أن الحساب فعال.' end
  ) into v_payload from stats cross join items;

  return coalesce(v_payload,jsonb_build_object('total',0,'eligible',0,'review',0,'ineligible',0,'items','[]'::jsonb));
end;
$function$;

revoke all on function private.lifecycle_automation_preview_payload(public.automation_rules)
  from public, anon;
grant execute on function private.lifecycle_automation_preview_payload(public.automation_rules)
  to authenticated;

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
  elsif v_rule.event_type in ('stopped_shipping','never_shipped') then
    v_payload:=private.lifecycle_automation_preview_payload(v_rule);
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
  safeguards=safeguards||'{"maxSourceAgeHours":18,"crossAutomationCooldownHours":24}'::jsonb,
  conditions='[{"field":"shipment_count","operator":"gt","value":0},{"field":"days_since_last_shipment","operator":"gt","value":5}]'::jsonb,
  version=version+1,updated_at=now()
where rule_key='stopped_shipping_5d';

update public.automation_rules set
  safeguards=safeguards||'{"maxSourceAgeHours":18,"crossAutomationCooldownHours":24}'::jsonb,
  conditions='[{"field":"shipment_count","operator":"eq","value":0},{"field":"days_since_registration","operator":"gte","value":5}]'::jsonb,
  version=version+1,updated_at=now()
where rule_key='never_shipped';

insert into public.automation_rule_versions(rule_id,version,snapshot,change_note)
select r.id,r.version,to_jsonb(r)-'last_preview_at'-'last_preview_count'-'last_run_at'-'next_run_at',
  'اشتراط حداثة لمحة ومنع تعارض التواصل وتطبيق مهلة التسجيل/التوقف بدقة'
from public.automation_rules r
where r.rule_key in ('stopped_shipping_5d','never_shipped')
on conflict(rule_id,version) do nothing;

comment on function private.lifecycle_automation_preview_payload(public.automation_rules) is
  'Read-only Lamha lifecycle preview with source freshness, >5 stopped semantics, registration wait, account-enabled policy and cross-automation cooldown.';

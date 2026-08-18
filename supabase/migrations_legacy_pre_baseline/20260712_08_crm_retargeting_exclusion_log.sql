-- CRM إعادة الاستهداف: استبعاد دائم (بلاك لست/تجريبي) + سجلّ تغيّرات الحالات.
-- المتابعة مربوطة بالهاتف (لا snapshot) فالاستبعاد والحالات تبقى عبر رفعات الملفات.
create table if not exists public.retargeting_status_log (
  id bigserial primary key, phone text not null,
  old_status text, new_status text, changed_by uuid,
  changed_at timestamptz not null default now()
);
create index if not exists ix_rt_status_log_at    on public.retargeting_status_log(changed_at desc);
create index if not exists ix_rt_status_log_phone on public.retargeting_status_log(phone);

-- set_retargeting_followup + تسجيل تغيّر الحالة.
create or replace function public.set_retargeting_followup(
  p_phone text, p_status text default null, p_owner uuid default null,
  p_next timestamptz default null, p_notes text default null, p_touch boolean default false
) returns json language plpgsql security definer set search_path to public as $$
declare v_uid uuid := auth.uid(); v_old text;
begin
  if p_phone is null or btrim(p_phone) = '' then raise exception 'phone مطلوب'; end if;
  select status into v_old from public.retargeting_followups where phone = p_phone;
  insert into public.retargeting_followups(phone, status, owner_id, next_action_at, notes, last_touch_at, updated_by, updated_at)
    values (p_phone, coalesce(p_status,'new'), p_owner, p_next, p_notes,
            case when p_touch then now() else null end, v_uid, now())
  on conflict (phone) do update set
    status = coalesce(p_status, retargeting_followups.status),
    owner_id = case when p_owner is not null then p_owner else retargeting_followups.owner_id end,
    next_action_at = coalesce(p_next, retargeting_followups.next_action_at),
    notes = coalesce(p_notes, retargeting_followups.notes),
    last_touch_at = case when p_touch then now() else retargeting_followups.last_touch_at end,
    updated_by = v_uid, updated_at = now();
  if p_status is not null and p_status is distinct from coalesce(v_old, 'new') then
    insert into public.retargeting_status_log(phone, old_status, new_status, changed_by) values (p_phone, v_old, p_status, v_uid);
  end if;
  return (select row_to_json(f) from public.retargeting_followups f where f.phone = p_phone);
end;
$$;
revoke all on function public.set_retargeting_followup(text,text,uuid,timestamptz,text,boolean) from public;
grant execute on function public.set_retargeting_followup(text,text,uuid,timestamptz,text,boolean) to authenticated;

-- crm_retargeting_leads: إخفاء المستبعَدين (blacklist/test) افتراضياً (p_include_excluded).
drop function if exists public.crm_retargeting_leads(text,text,text,text,boolean,text,text,uuid,boolean,int,int);
create or replace function public.crm_retargeting_leads(
  p_segment text default null, p_priority text default null, p_integration text default null,
  p_billing text default null, p_has_balance boolean default null, p_q text default null,
  p_status text default null, p_owner uuid default null, p_unassigned boolean default null,
  p_include_excluded boolean default false, p_limit int default 50, p_offset int default 0
) returns json language sql stable security definer set search_path to public as $$
  with f as (
    select v.*, coalesce(fu.status,'new') as fu_status, fu.owner_id as fu_owner,
      pr.name as owner_name, fu.next_action_at, fu.notes as fu_notes, fu.last_touch_at
    from public.v_crm_retargeting v
    left join public.retargeting_followups fu on fu.phone = v.phone
    left join public.profiles pr on pr.id = fu.owner_id
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
  )
  select json_build_object(
    'count', (select count(*) from f),
    'rows', (select coalesce(json_agg(r), '[]') from (
      select phone, primary_store, store_names, store_count, total_shipments, last_shipment,
             days_since_last, wallet, last_topup, created_at, integration_type, billing_type,
             profile_done, verified, segment, priority, channel, high_value,
             fu_status, fu_owner, owner_name, next_action_at, fu_notes, last_touch_at
      from f
      order by case coalesce(priority,'none')
                 when 'A' then 1 when 'B' then 2 when 'C' then 3 when 'D' then 4 when 'FIN' then 5 else 6 end,
               total_shipments desc
      limit greatest(1, least(p_limit, 200)) offset greatest(0, p_offset)
    ) r)
  );
$$;
revoke all on function public.crm_retargeting_leads(text,text,text,text,boolean,text,text,uuid,boolean,boolean,int,int) from public;
grant execute on function public.crm_retargeting_leads(text,text,text,text,boolean,text,text,uuid,boolean,boolean,int,int) to authenticated;

-- سجلّ التغيّرات المقروء.
create or replace function public.crm_retargeting_status_changes(p_limit int default 50)
returns json language sql stable security definer set search_path to public as $$
  select coalesce(json_agg(r), '[]') from (
    select l.phone, l.old_status, l.new_status, l.changed_at,
           coalesce(pr.name, '—') as changed_by_name, v.primary_store
    from public.retargeting_status_log l
    left join public.profiles pr on pr.id = l.changed_by
    left join public.v_crm_retargeting v on v.phone = l.phone
    order by l.changed_at desc limit greatest(1, least(p_limit, 200))
  ) r;
$$;
revoke all on function public.crm_retargeting_status_changes(int) from public;
grant execute on function public.crm_retargeting_status_changes(int) to authenticated;

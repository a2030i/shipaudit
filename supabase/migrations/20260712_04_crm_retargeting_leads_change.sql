-- CRM إعادة الاستهداف — المرحلة 2: فرص مفلترة/مُرقّمة + التقاط التغيّر بين الرفعات.

-- (1) صفوف الفرص من v_crm_retargeting مع فلاتر + ترقيم + عدّ إجمالي.
create or replace function public.crm_retargeting_leads(
  p_segment     text default null,
  p_priority    text default null,
  p_integration text default null,   -- 'none' = بلا ربط
  p_billing     text default null,
  p_has_balance boolean default null,
  p_q           text default null,
  p_limit       int default 50,
  p_offset      int default 0
) returns json language sql stable security definer set search_path to public as $$
  with f as (
    select * from public.v_crm_retargeting
    where (p_segment     is null or segment = p_segment)
      and (p_priority    is null or coalesce(priority,'none') = p_priority)
      and (p_integration is null or coalesce(integration_type,'none') = p_integration)
      and (p_billing     is null or billing_type = p_billing)
      and (p_has_balance is null or (p_has_balance and wallet > 0.5) or (not p_has_balance))
      and (p_q is null or btrim(p_q) = '' or primary_store ilike '%'||p_q||'%' or phone ilike '%'||p_q||'%')
  )
  select json_build_object(
    'count', (select count(*) from f),
    'rows', (select coalesce(json_agg(r), '[]') from (
      select phone, primary_store, store_names, store_count, total_shipments,
             last_shipment, days_since_last, wallet, last_topup, created_at,
             integration_type, billing_type, profile_done, verified,
             segment, priority, channel, high_value
      from f
      order by case coalesce(priority,'none')
                 when 'A' then 1 when 'B' then 2 when 'C' then 3 when 'D' then 4
                 when 'FIN' then 5 else 6 end,
               total_shipments desc
      limit greatest(1, least(p_limit, 200)) offset greatest(0, p_offset)
    ) r)
  );
$$;
revoke all on function public.crm_retargeting_leads(text,text,text,text,boolean,text,int,int) from public;
grant execute on function public.crm_retargeting_leads(text,text,text,text,boolean,text,int,int) to authenticated;

-- (2) التقاط ملخّص الرفعة الحالية + إرجاع السابقة لحساب نسبة التغيّر.
create table if not exists public.retargeting_snapshot_summary (
  snapshot_id   text primary key,
  snapshot_date date,
  stats         jsonb not null,
  captured_at   timestamptz not null default now()
);
alter table public.retargeting_snapshot_summary enable row level security;

create or replace function public.capture_retargeting_summary()
returns json language plpgsql security definer set search_path to public as $$
declare v_snap text; v_date date; v_stats jsonb; v_prev jsonb; v_prev_snap text;
begin
  select snapshot_id, snapshot_date into v_snap, v_date from public.merchants order by uploaded_at desc limit 1;
  if v_snap is null then return json_build_object('current', null, 'previous', null); end if;
  v_stats := (public.crm_retargeting_summary() -> 'stats');
  insert into public.retargeting_snapshot_summary(snapshot_id, snapshot_date, stats, captured_at)
    values (v_snap, v_date, v_stats, now())
  on conflict (snapshot_id) do update set stats = excluded.stats, snapshot_date = excluded.snapshot_date, captured_at = now();
  select stats, snapshot_id into v_prev, v_prev_snap
  from public.retargeting_snapshot_summary where snapshot_id <> v_snap
  order by captured_at desc limit 1;
  return json_build_object('current', v_stats, 'current_snapshot', v_snap, 'current_date', v_date,
                           'previous', v_prev, 'previous_snapshot', v_prev_snap);
end;
$$;
revoke all on function public.capture_retargeting_summary() from public;
grant execute on function public.capture_retargeting_summary() to authenticated;

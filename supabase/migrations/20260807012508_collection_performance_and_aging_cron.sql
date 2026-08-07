-- إقفال تطوير التحصيل: تقرير إشرافي مبني على دفعات Zoho بعد الوعود،
-- ولقطة أعمار يومية مستقلة عن فتح الشاشة.

create or replace function public.capture_ar_aging_snapshot()
returns json
language sql
security definer
set search_path = ''
as $function$
  with clock as (
    select (now() at time zone 'Asia/Riyadh')::date as as_of
  ),
  inv as (
    select
      coalesce(sum(i.balance) filter (where (c.as_of - i.date)::int <= 30), 0) b0,
      coalesce(sum(i.balance) filter (where (c.as_of - i.date)::int between 31 and 60), 0) b1,
      coalesce(sum(i.balance) filter (where (c.as_of - i.date)::int between 61 and 90), 0) b2,
      coalesce(sum(i.balance) filter (where (c.as_of - i.date)::int > 90), 0) b3
    from public.zoho_invoices i
    cross join clock c
    where i.balance > 0.5
  ),
  opening as (
    select coalesce(sum(ar.opening_due), 0) op
    from public.customer_ar ar
    where ar.opening_due > 0.5
  ),
  agg as (
    select b0, b1, b2, b3 + op b3, b0 + b1 + b2 + b3 + op tot
    from inv, opening
  ),
  up as (
    insert into public.ar_aging_snapshots
      (period, b0_30, b31_60, b61_90, b90p, total, captured_at)
    select
      to_char(c.as_of, 'YYYY-MM'),
      round(a.b0::numeric, 2),
      round(a.b1::numeric, 2),
      round(a.b2::numeric, 2),
      round(a.b3::numeric, 2),
      round(a.tot::numeric, 2),
      now()
    from agg a
    cross join clock c
    on conflict (period) do update set
      b0_30 = excluded.b0_30,
      b31_60 = excluded.b31_60,
      b61_90 = excluded.b61_90,
      b90p = excluded.b90p,
      total = excluded.total,
      captured_at = excluded.captured_at
    returning *
  )
  select row_to_json(up) from up;
$function$;

create or replace function public.ar_aging_trend(p_months integer default 6)
returns json
language sql
stable
security invoker
set search_path = ''
as $function$
  select coalesce(
    json_agg(row_to_json(t) order by t.period),
    '[]'::json
  )
  from (
    select s.period, s.b0_30, s.b31_60, s.b61_90, s.b90p, s.total, s.captured_at
    from public.ar_aging_snapshots s
    order by s.period desc
    limit greatest(2, least(coalesce(p_months, 6), 24))
  ) t;
$function$;

create or replace function public.collection_team_performance(p_period date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_start date := date_trunc(
    'month',
    coalesce(p_period, (now() at time zone 'Asia/Riyadh')::date)
  )::date;
  v_end date := (v_start + interval '1 month')::date;
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
  v_result jsonb;
begin
  if (select auth.uid()) is null
     or not public.crm_has_permission('collections.view_all') then
    raise exception 'not_allowed';
  end if;

  with promise_base as (
    select
      t.id,
      t.assigned_to,
      t.customer_name,
      t.promised_at,
      t.promise_date,
      greatest(coalesce(t.promise_amount, 0), 0)::numeric as promise_amount
    from public.collection_tasks t
    where t.promised_at is not null
      and coalesce(t.promise_amount, 0) > 0.5
  ),
  bound_payments as (
    select
      p.zoho_id,
      p.date,
      p.amount,
      chosen.task_id
    from public.zoho_payments p
    join lateral (
      select pb.id as task_id
      from promise_base pb
      where pb.customer_name = p.customer_name
        and pb.promised_at::date <= p.date
      order by pb.promised_at desc, pb.id desc
      limit 1
    ) chosen on true
    where p.amount > 0
      and p.date < v_end
  ),
  promise_progress as (
    select
      pb.id,
      pb.assigned_to,
      pb.promised_at,
      pb.promise_date,
      pb.promise_amount,
      coalesce(sum(bp.amount) filter (where bp.date < v_start), 0)::numeric as prior_paid,
      coalesce(sum(bp.amount) filter (where bp.date >= v_start and bp.date < v_end), 0)::numeric as period_paid,
      coalesce(sum(bp.amount), 0)::numeric as paid_to_period_end
    from promise_base pb
    left join bound_payments bp on bp.task_id = pb.id
    group by pb.id, pb.assigned_to, pb.promised_at, pb.promise_date, pb.promise_amount
  ),
  promise_metrics as (
    select
      pp.assigned_to,
      count(*) filter (
        where pp.promised_at >= v_start
          and pp.promised_at < v_end
      )::int as promises_made,
      count(*) filter (
        where pp.promise_date >= v_start
          and pp.promise_date < v_end
      )::int as promises_due,
      count(*) filter (
        where pp.promise_date >= v_start
          and pp.promise_date < v_end
          and pp.paid_to_period_end >= greatest(pp.promise_amount - 0.5, 0)
      )::int as promises_kept,
      count(*) filter (
        where pp.promise_date >= v_start
          and pp.promise_date < least(v_end, v_today + 1)
          and pp.paid_to_period_end < greatest(pp.promise_amount - 0.5, 0)
      )::int as promises_broken,
      coalesce(sum(
        least(
          pp.period_paid,
          greatest(pp.promise_amount - pp.prior_paid, 0)
        )
      ), 0)::numeric as verified_collected,
      coalesce(sum(
        case
          when pp.period_paid > 0
            or (pp.promise_date >= v_start and pp.promise_date < v_end)
          then greatest(pp.promise_amount - pp.prior_paid, 0)
          else 0
        end
      ), 0)::numeric as eligible_promise_amount
    from promise_progress pp
    group by pp.assigned_to
  ),
  open_portfolio as (
    select
      x.assigned_to,
      count(*)::int as open_tasks,
      coalesce(sum(coalesce(ar.total_due, x.debt_at_creation)), 0)::numeric as open_debt,
      round(avg(greatest(v_today - x.created_at::date, 0)))::int as avg_open_age_days,
      count(*) filter (
        where x.stage = 'promised'
          and x.promise_date < v_today
      )::int as overdue_promises
    from (
      select distinct on (t.assigned_to, t.customer_name)
        t.assigned_to,
        t.customer_name,
        t.stage,
        t.promise_date,
        t.debt_at_creation,
        t.created_at,
        t.updated_at
      from public.collection_tasks t
      where t.stage in ('todo', 'contacted', 'promised', 'snoozed')
      order by t.assigned_to, t.customer_name, t.updated_at desc
    ) x
    left join public.customer_ar ar on ar.contact_name = x.customer_name
    group by x.assigned_to
  ),
  task_metrics as (
    select
      t.assigned_to,
      count(*) filter (
        where t.done_at >= v_start
          and t.done_at < v_end
      )::int as completed_in_period
    from public.collection_tasks t
    group by t.assigned_to
  ),
  collector_pool as (
    select p.id as collector_id, p.name as collector_name, false as is_unassigned
    from public.profiles p
    where p.role <> 'admin'
      and coalesce((p.permissions ->> 'collections.update_stage')::boolean, false)
    union
    select distinct p.id, p.name, false
    from public.collection_tasks t
    join public.profiles p on p.id = t.assigned_to
    union
    select null::uuid, 'غير مسند'::text, true
    where exists (
      select 1 from public.collection_tasks t
      where t.assigned_to is null
    )
  ),
  rows as (
    select
      cp.collector_id,
      cp.collector_name,
      cp.is_unassigned,
      coalesce(op.open_tasks, 0)::int as open_tasks,
      round(coalesce(op.open_debt, 0), 2) as open_debt,
      coalesce(op.avg_open_age_days, 0)::int as avg_open_age_days,
      coalesce(tm.completed_in_period, 0)::int as completed_in_period,
      coalesce(pm.promises_made, 0)::int as promises_made,
      coalesce(pm.promises_due, 0)::int as promises_due,
      coalesce(pm.promises_kept, 0)::int as promises_kept,
      coalesce(pm.promises_broken, 0)::int as promises_broken,
      coalesce(op.overdue_promises, 0)::int as overdue_promises,
      round(coalesce(pm.verified_collected, 0), 2) as verified_collected,
      case
        when coalesce(pm.eligible_promise_amount, 0) <= 0.5 then 0
        else round(
          least(
            100,
            (pm.verified_collected / nullif(pm.eligible_promise_amount, 0)) * 100
          ),
          1
        )
      end as promise_fulfillment_pct
    from collector_pool cp
    left join open_portfolio op
      on op.assigned_to is not distinct from cp.collector_id
    left join task_metrics tm
      on tm.assigned_to is not distinct from cp.collector_id
    left join promise_metrics pm
      on pm.assigned_to is not distinct from cp.collector_id
  ),
  summary as (
    select
      coalesce(sum(r.open_tasks), 0)::int as open_tasks,
      round(coalesce(sum(r.open_debt), 0), 2) as open_debt,
      coalesce(sum(r.completed_in_period), 0)::int as completed_in_period,
      coalesce(sum(r.promises_made), 0)::int as promises_made,
      coalesce(sum(r.promises_due), 0)::int as promises_due,
      coalesce(sum(r.promises_kept), 0)::int as promises_kept,
      coalesce(sum(r.promises_broken), 0)::int as promises_broken,
      coalesce(sum(r.overdue_promises), 0)::int as overdue_promises,
      round(coalesce(sum(r.verified_collected), 0), 2) as verified_collected,
      case
        when coalesce(sum(pm.eligible_promise_amount), 0) <= 0.5 then 0
        else round(
          least(
            100,
            (
              coalesce(sum(pm.verified_collected), 0)
              / nullif(sum(pm.eligible_promise_amount), 0)
            ) * 100
          ),
          1
        )
      end as promise_fulfillment_pct
    from rows r
    left join promise_metrics pm
      on pm.assigned_to is not distinct from r.collector_id
  )
  select jsonb_build_object(
    'period', to_char(v_start, 'YYYY-MM'),
    'period_start', v_start,
    'period_end', v_end - 1,
    'generated_at', now(),
    'summary', (
      select jsonb_build_object(
        'open_tasks', s.open_tasks,
        'open_debt', s.open_debt,
        'completed_in_period', s.completed_in_period,
        'promises_made', s.promises_made,
        'promises_due', s.promises_due,
        'promises_kept', s.promises_kept,
        'promises_broken', s.promises_broken,
        'overdue_promises', s.overdue_promises,
        'verified_collected', s.verified_collected,
        'promise_fulfillment_pct', s.promise_fulfillment_pct
      )
      from summary s
    ),
    'rows', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'collector_id', r.collector_id,
          'collector_name', r.collector_name,
          'is_unassigned', r.is_unassigned,
          'open_tasks', r.open_tasks,
          'open_debt', r.open_debt,
          'avg_open_age_days', r.avg_open_age_days,
          'completed_in_period', r.completed_in_period,
          'promises_made', r.promises_made,
          'promises_due', r.promises_due,
          'promises_kept', r.promises_kept,
          'promises_broken', r.promises_broken,
          'overdue_promises', r.overdue_promises,
          'verified_collected', r.verified_collected,
          'promise_fulfillment_pct', r.promise_fulfillment_pct
        )
        order by r.is_unassigned, r.verified_collected desc, r.collector_name
      )
      from rows r
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$function$;

drop policy if exists ar_aging_snapshots_read on public.ar_aging_snapshots;
create policy ar_aging_snapshots_read
on public.ar_aging_snapshots
for select
to authenticated
using (
  public.app_has_any_permission(
    array['collections.view', 'receivables.view', 'reports.view_financial']
  )
);

drop policy if exists ar_aging_snapshots_insert on public.ar_aging_snapshots;

revoke all on function public.capture_ar_aging_snapshot() from public, anon, authenticated;
grant execute on function public.capture_ar_aging_snapshot() to service_role;

revoke all on function public.ar_aging_trend(integer) from public, anon;
grant execute on function public.ar_aging_trend(integer) to authenticated, service_role;

revoke all on function public.collection_team_performance(date) from public, anon;
grant execute on function public.collection_team_performance(date) to authenticated, service_role;

do $cron$
declare
  v_job_id bigint;
begin
  select j.jobid
  into v_job_id
  from cron.job j
  where j.jobname = 'capture-ar-aging-daily'
  limit 1;

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
end;
$cron$;

select cron.schedule(
  'capture-ar-aging-daily',
  '50 20 * * *',
  $job$select public.capture_ar_aging_snapshot();$job$
);

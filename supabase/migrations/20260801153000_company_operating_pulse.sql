-- طبقة قيادة موحدة فوق مصادر العمل القائمة.
-- لا تنشئ مهام ولا تنقل ملكية البيانات: المبيعات تبقى في Lead OS،
-- والتحصيل في collection_tasks، والدعم في support_tickets.

create or replace function public.company_operating_pulse()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_sales_visible boolean;
  v_sales_all boolean;
  v_collections_visible boolean;
  v_collections_all boolean;
  v_support_visible boolean;
  v_sales jsonb;
  v_collections jsonb;
  v_support jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  if not public.crm_has_permission('overview.view') then
    raise exception 'not_allowed';
  end if;

  v_sales_visible := public.crm_has_permission('sales.view')
    or public.crm_has_permission('crm.view');
  v_sales_all := v_sales_visible and public.crm_can_see_all();
  v_collections_visible := public.crm_has_permission('collections.view');
  v_collections_all := v_collections_visible
    and public.crm_has_permission('collections.view_all');
  v_support_visible := public.crm_has_permission('support.view');

  if v_sales_visible then
    with
    routing as materialized (
      select
        source.phone,
        source.sales_eligible,
        source.financial_hold,
        source.hot_live_new,
        source.hot_live_topped,
        source.recent_stop,
        source.wallet_stranded,
        source.live_inactive,
        source.direct_live,
        source.total_shipments
      from public.v_platform_commercial_routing source
    ),
    opportunity_pool as (
      select count(*)::integer as total
      from routing
      left join public.retargeting_followups followup
        on followup.phone = routing.phone
      where followup.phone is null
        and routing.sales_eligible
        and (
          routing.hot_live_new
          or routing.hot_live_topped
          or routing.recent_stop
          or routing.wallet_stranded
          or routing.live_inactive
          or (routing.direct_live and routing.total_shipments = 0)
        )
    ),
    followups as (
      select
        followup.phone,
        followup.owner_id,
        followup.next_action_at,
        followup.last_touch_at,
        routing.financial_hold
      from public.retargeting_followups followup
      left join routing
        on routing.phone = followup.phone
      where coalesce(followup.sales_stage, 'new')
        not in ('won', 'lost', 'disqualified')
        and (v_sales_all or followup.owner_id = v_uid)
    ),
    leads as (
      select
        lead.id,
        lead.owner_id,
        lead.lead_kind,
        lead.status,
        lead.next_action_at,
        lead.first_attempt_at,
        lead.first_response_due_at
      from public.crm_leads lead
      where lead.status not in ('converted', 'activated', 'lost', 'existing_customer')
        and (
          lead.lead_kind = 'inbound'
          or lead.next_action_at is not null
          or lead.first_attempt_at is not null
          or lead.last_touch_at is not null
        )
        and (v_sales_all or lead.owner_id = v_uid)
    ),
    metrics as (
      select
        (select total from opportunity_pool) as opportunity_total,
        (select count(*)::integer from followups) as followup_total,
        (select count(*)::integer from leads) as lead_total,
        (select count(*)::integer from followups
          where next_action_at <= now() + interval '12 hours') as followup_due,
        (select count(*)::integer from leads
          where next_action_at <= now() + interval '12 hours'
             or (lead_kind = 'inbound' and status = 'new')) as lead_due,
        (select count(*)::integer from followups
          where next_action_at < now()) as followup_overdue,
        (select count(*)::integer from leads
          where next_action_at < now()) as lead_overdue,
        (select count(*)::integer from leads
          where lead_kind = 'inbound'
            and first_attempt_at is null
            and first_response_due_at < now()) as inbound_sla_breached,
        (select count(*)::integer from public.crm_leads lead
          where v_sales_all
            and lead.lead_kind = 'inbound'
            and lead.owner_id is null
            and lead.status not in ('converted', 'activated', 'lost', 'existing_customer'))
          as inbound_unassigned,
        (select count(*)::integer from followups
          where last_touch_at is not null and next_action_at is null)
          +
        (select count(*)::integer from leads
          where first_attempt_at is not null and next_action_at is null)
          as without_next_action,
        (select count(*)::integer from followups where financial_hold)
          as financial_hold_conflicts
    )
    select jsonb_build_object(
      'visible', true,
      'scope', case when v_sales_all then 'team' else 'mine' end,
      'today', least(opportunity_total, 12) + followup_due + lead_due,
      'backlog', opportunity_total + followup_total + lead_total,
      'overdue', followup_overdue + lead_overdue + inbound_sla_breached,
      'unassigned', inbound_unassigned,
      'without_next_action', without_next_action,
      'financial_hold_conflicts', financial_hold_conflicts,
      'platform_opportunities', opportunity_total,
      'followups', followup_total,
      'leads', lead_total
    ) into v_sales
    from metrics;
  end if;

  if v_collections_visible then
    with ranked as (
      select
        task.*,
        row_number() over (
          partition by task.customer_name
          order by case task.stage
            when 'promised' then 4
            when 'contacted' then 3
            when 'snoozed' then 2
            else 1
          end desc, task.created_at desc
        ) as customer_rank
      from public.collection_tasks task
      where task.stage in ('todo', 'contacted', 'promised', 'snoozed')
        and (v_collections_all or task.assigned_to = v_uid)
    ),
    active as (
      select ranked.*
      from ranked
      where customer_rank = 1
    ),
    metrics as (
      select
        count(*)::integer as open_count,
        coalesce(round(sum(coalesce(ar.total_due, active.debt_at_creation, 0))::numeric, 2), 0)
          as open_amount,
        count(*) filter (
          where active.stage = 'promised'
            and active.promise_date < (now() at time zone 'Asia/Riyadh')::date
        )::integer as promise_overdue,
        count(*) filter (
          where active.stage = 'promised'
            and active.promise_date = (now() at time zone 'Asia/Riyadh')::date
        )::integer as promise_today,
        count(*) filter (
          where active.stage = 'snoozed'
            and active.snooze_until <= now()
        )::integer as snooze_expired,
        count(*) filter (where active.assigned_to is null)::integer as unassigned
      from active
      left join public.customer_ar ar
        on ar.contact_name = active.customer_name
    )
    select jsonb_build_object(
      'visible', true,
      'scope', case when v_collections_all then 'team' else 'mine' end,
      'today', least(open_count, 25),
      'backlog', greatest(open_count - 25, 0),
      'open', open_count,
      'open_amount', open_amount,
      'promise_overdue', promise_overdue,
      'promise_today', promise_today,
      'snooze_expired', snooze_expired,
      'unassigned', unassigned
    ) into v_collections
    from metrics;
  end if;

  if v_support_visible then
    with active as (
      select ticket.*
      from public.support_tickets ticket
      where ticket.status in ('open', 'in_progress', 'waiting_customer')
    ),
    metrics as (
      select
        count(*)::integer as open_count,
        count(*) filter (
          where priority = 'urgent'
             or assigned_to is null
             or next_followup_at is null
             or next_followup_at <= now() + interval '24 hours'
        )::integer as today_count,
        count(*) filter (where next_followup_at < now())::integer as overdue,
        count(*) filter (where assigned_to is null)::integer as unassigned,
        count(*) filter (where next_followup_at is null)::integer as without_followup,
        count(*) filter (where priority = 'urgent')::integer as urgent,
        count(*) filter (where created_at < now() - interval '3 days')::integer as stale_3d
      from active
    )
    select jsonb_build_object(
      'visible', true,
      'scope', 'team',
      'today', today_count,
      'backlog', greatest(open_count - today_count, 0),
      'open', open_count,
      'overdue', overdue,
      'unassigned', unassigned,
      'without_followup', without_followup,
      'urgent', urgent,
      'stale_3d', stale_3d
    ) into v_support
    from metrics;
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'sales', v_sales,
    'collections', v_collections,
    'support', v_support
  );
end;
$function$;

revoke execute on function public.company_operating_pulse()
  from public, anon;
grant execute on function public.company_operating_pulse()
  to authenticated, service_role;

comment on function public.company_operating_pulse() is
  'Read-only executive pulse over the existing sales, collections and support work sources; creates no parallel task system.';

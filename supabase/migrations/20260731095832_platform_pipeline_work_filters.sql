-- A non-breaking v2 of the platform pipeline. The original RPC remains
-- available to older clients; this version adds operational contact filters,
-- work-state counts and deterministic sorting before pagination.

create or replace function public.platform_commercial_pipeline_v2(
  p_bucket text default 'hot_live_new',
  p_work_filter text default 'all',
  p_sort text default 'recommended',
  p_owner uuid default null,
  p_unassigned boolean default false,
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_see_all boolean;
  v_result jsonb;
begin
  if v_uid is null
     or not (
       public.crm_has_permission('sales.view')
       or public.crm_has_permission('crm.view')
       or public.crm_has_permission('merchants.view')
     ) then
    raise exception 'not_allowed';
  end if;

  v_see_all := public.crm_can_see_all();
  if p_owner is not null and p_owner is distinct from v_uid and not v_see_all then
    raise exception 'not_allowed';
  end if;

  if coalesce(p_bucket, 'all') not in (
    'all', 'hot_live_new', 'recent_stop', 'wallet_stranded', 'live_inactive',
    'new', 'in_progress', 'recontact_due', 'scheduled',
    'active', 'stopped', 'reactivated', 'won', 'lost', 'unscheduled'
  ) then
    raise exception 'invalid_bucket';
  end if;

  if coalesce(p_work_filter, 'all') not in (
    'all', 'action_now', 'never_contacted', 'no_answer', 'due',
    'contacted_no_next', 'scheduled', 'contacted', 'unassigned'
  ) then
    raise exception 'invalid_work_filter';
  end if;

  if coalesce(p_sort, 'recommended') not in (
    'recommended', 'recent_first', 'action_first', 'largest', 'least_contacted'
  ) then
    raise exception 'invalid_sort';
  end if;

  with recent_events as (
    select
      phone,
      bool_or(
        event_type in ('reactivated', 'shipping_resumed')
        and observed_at >= now() - interval '30 days'
      ) as reactivated_30d,
      max(observed_at) filter (
        where event_type in ('reactivated', 'shipping_resumed')
      ) as last_reactivated_at
    from public.merchant_lifecycle_events
    where phone is not null
    group by phone
  ),
  base as (
    select
      routing.*,
      followup.phone is not null as has_followup,
      coalesce(followup.sales_stage, 'new') as sales_stage,
      coalesce(followup.status, 'new') as last_outcome,
      followup.owner_id,
      profile.name as owner_name,
      followup.next_action_at,
      coalesce(followup.next_action_type, 'call') as next_action_type,
      followup.notes,
      followup.last_touch_at,
      followup.first_contact_at,
      coalesce(followup.contact_attempts, 0) as contact_attempts,
      followup.loss_reason,
      followup.lost_at,
      followup.won_at,
      followup.updated_at,
      coalesce(events.reactivated_30d, false) as reactivated_30d,
      events.last_reactivated_at,
      case
        when routing.financial_hold then 'financial_hold'
        when routing.total_shipments = 0 then 'pending_first_shipment'
        when routing.segment = 'active' then 'active'
        when routing.segment in ('stopped_recent', 'stopped_long') then 'stopped'
        else 'unknown'
      end as platform_state
    from public.v_platform_commercial_routing routing
    left join public.retargeting_followups followup
      on followup.phone = routing.phone
    left join public.profiles profile on profile.id = followup.owner_id
    left join recent_events events on events.phone = routing.phone
  ),
  prepared as (
    select
      base.*,
      case
        when next_action_at is not null and next_action_at <= now() then 'due'
        when last_outcome = 'no_answer' then 'no_answer'
        when next_action_at > now() then 'scheduled'
        when contact_attempts = 0 and last_touch_at is null then 'never_contacted'
        when last_touch_at is not null
          and next_action_at is null
          and sales_stage in (
            'new', 'contacted', 'qualified', 'proposal', 'negotiation', 'nurture'
          ) then 'contacted_no_next'
        when last_touch_at is not null or contact_attempts > 0 then 'contacted'
        else 'unassigned'
      end as work_state
    from base
  ),
  ranked as (
    select
      prepared.*,
      case
        when work_state = 'due' then 0
        when work_state = 'no_answer' then 1
        when work_state = 'never_contacted'
          and (
            commercial_signal in ('hot_live_new', 'hot_live_topped')
            or (recent_stop and days_since_last between 6 and 14)
          ) then 2
        when work_state = 'contacted_no_next' then 3
        when work_state = 'never_contacted' then 4
        when work_state = 'scheduled' then 5
        else 6
      end as work_rank
    from prepared
  ),
  scoped_raw as (
    select *
    from ranked
    where (v_see_all or owner_id = v_uid or not has_followup)
      and (p_owner is null or owner_id = p_owner)
      and (not p_unassigned or not has_followup or owner_id is null)
  ),
  sales_scoped as (
    select *
    from scoped_raw
    where sales_eligible
  ),
  searched as (
    select *
    from sales_scoped
    where p_search is null
       or btrim(p_search) = ''
       or phone ilike '%' || btrim(p_search) || '%'
       or primary_store ilike '%' || btrim(p_search) || '%'
       or exists (
         select 1
         from unnest(store_names) store_name
         where store_name ilike '%' || btrim(p_search) || '%'
       )
  ),
  bucketed as (
    select *
    from searched
    where coalesce(p_bucket, 'all') = 'all'
      or (p_bucket = 'hot_live_new' and (hot_live_new or hot_live_topped))
      or (p_bucket = 'recent_stop' and recent_stop)
      or (p_bucket = 'wallet_stranded' and wallet_stranded)
      or (p_bucket = 'live_inactive' and live_inactive)
      or (
        p_bucket = 'new'
        and total_shipments = 0
        and latest_created_at >= current_date - 30
        and sales_stage = 'new'
      )
      or (
        p_bucket = 'in_progress'
        and has_followup
        and sales_stage in (
          'new', 'contacted', 'qualified', 'proposal', 'negotiation', 'nurture'
        )
      )
      or (
        p_bucket = 'recontact_due'
        and has_followup
        and next_action_at is not null
        and next_action_at <= now()
        and sales_stage not in ('won', 'disqualified')
      )
      or (
        p_bucket = 'scheduled'
        and has_followup
        and next_action_at > now()
        and sales_stage not in ('won', 'disqualified')
      )
      or (p_bucket = 'active' and platform_state = 'active')
      or (p_bucket = 'stopped' and platform_state = 'stopped')
      or (p_bucket = 'reactivated' and reactivated_30d)
      or (p_bucket = 'won' and sales_stage = 'won')
      or (p_bucket = 'lost' and sales_stage = 'lost')
      or (
        p_bucket = 'unscheduled'
        and has_followup
        and next_action_at is null
        and sales_stage in (
          'new', 'contacted', 'qualified', 'proposal', 'negotiation', 'nurture'
        )
      )
  ),
  filtered as (
    select *
    from bucketed
    where coalesce(p_work_filter, 'all') = 'all'
      or (p_work_filter = 'action_now' and work_rank <= 3)
      or (
        p_work_filter = 'never_contacted'
        and contact_attempts = 0
        and last_touch_at is null
      )
      or (p_work_filter = 'no_answer' and last_outcome = 'no_answer')
      or (
        p_work_filter = 'due'
        and next_action_at is not null
        and next_action_at <= now()
      )
      or (
        p_work_filter = 'contacted_no_next'
        and last_touch_at is not null
        and next_action_at is null
        and sales_stage in (
          'new', 'contacted', 'qualified', 'proposal', 'negotiation', 'nurture'
        )
      )
      or (p_work_filter = 'scheduled' and next_action_at > now())
      or (
        p_work_filter = 'contacted'
        and (last_touch_at is not null or contact_attempts > 0)
      )
      or (p_work_filter = 'unassigned' and owner_id is null)
  ),
  sequenced as (
    select
      filtered.*,
      row_number() over (
        order by
          case
            when p_sort = 'recent_first'
              or (p_sort = 'recommended' and p_bucket = 'recent_stop')
            then days_since_last
          end asc nulls last,
          case
            when p_sort in ('recommended', 'action_first') then work_rank
          end asc nulls last,
          case when p_sort = 'largest' then total_shipments end desc nulls last,
          case when p_sort = 'least_contacted' then contact_attempts end asc nulls last,
          case when p_sort = 'least_contacted' then last_touch_at end asc nulls first,
          signal_score desc,
          next_action_at asc nulls last,
          updated_at desc nulls last,
          latest_created_at desc nulls last,
          primary_store,
          phone
      ) as result_order
    from filtered
  ),
  ordered as (
    select *
    from sequenced
    order by result_order
    limit greatest(1, least(coalesce(p_limit, 50), 100))
    offset greatest(0, coalesce(p_offset, 0))
  )
  select jsonb_build_object(
    'summary', (
      select jsonb_build_object(
        'total', count(*) filter (where sales_eligible),
        'hot_live_new', count(*) filter (
          where sales_eligible and (hot_live_new or hot_live_topped)
        ),
        'recent_stop', count(*) filter (where sales_eligible and recent_stop),
        'wallet_stranded', count(*) filter (
          where sales_eligible and wallet_stranded
        ),
        'live_inactive', count(*) filter (where sales_eligible and live_inactive),
        'collections_hold', count(*) filter (where financial_hold),
        'held_debt', coalesce(round(sum(debt) filter (where financial_hold), 2), 0),
        'held_negative_wallet', coalesce(
          round(sum(negative_wallet) filter (where financial_hold), 2), 0
        ),
        'manual_trials', count(*) filter (
          where sales_eligible and manual_only and joined_5d and total_shipments = 0
        ),
        'new', count(*) filter (
          where sales_eligible and total_shipments = 0
            and latest_created_at >= current_date - 30 and sales_stage = 'new'
        ),
        'in_progress', count(*) filter (
          where sales_eligible and has_followup
            and sales_stage in ('new', 'contacted', 'qualified', 'proposal', 'negotiation', 'nurture')
        ),
        'recontact_due', count(*) filter (
          where sales_eligible and has_followup and next_action_at is not null
            and next_action_at <= now() and sales_stage not in ('won', 'disqualified')
        ),
        'scheduled', count(*) filter (
          where sales_eligible and has_followup and next_action_at > now()
            and sales_stage not in ('won', 'disqualified')
        ),
        'active', count(*) filter (where sales_eligible and platform_state = 'active'),
        'stopped', count(*) filter (where sales_eligible and platform_state = 'stopped'),
        'reactivated', count(*) filter (where sales_eligible and reactivated_30d),
        'won', count(*) filter (where sales_eligible and sales_stage = 'won'),
        'lost', count(*) filter (where sales_eligible and sales_stage = 'lost'),
        'unscheduled', count(*) filter (
          where sales_eligible and has_followup and next_action_at is null
            and sales_stage in ('new', 'contacted', 'qualified', 'proposal', 'negotiation', 'nurture')
        ),
        'unassigned', count(*) filter (
          where sales_eligible and (not has_followup or owner_id is null)
        )
      )
      from scoped_raw
    ),
    'work_summary', (
      select jsonb_build_object(
        'total', count(*),
        'action_now', count(*) filter (where work_rank <= 3),
        'never_contacted', count(*) filter (
          where contact_attempts = 0 and last_touch_at is null
        ),
        'no_answer', count(*) filter (where last_outcome = 'no_answer'),
        'due', count(*) filter (
          where next_action_at is not null and next_action_at <= now()
        ),
        'contacted_no_next', count(*) filter (
          where last_touch_at is not null and next_action_at is null
            and sales_stage in ('new', 'contacted', 'qualified', 'proposal', 'negotiation', 'nurture')
        ),
        'scheduled', count(*) filter (where next_action_at > now()),
        'contacted', count(*) filter (
          where last_touch_at is not null or contact_attempts > 0
        ),
        'unassigned', count(*) filter (where owner_id is null)
      )
      from bucketed
    ),
    'count', (select count(*) from filtered),
    'rows', coalesce(
      (
        select jsonb_agg(
          to_jsonb(row_data) - 'result_order'
          order by row_data.result_order
        )
        from ordered row_data
      ),
      '[]'::jsonb
    )
  )
  into v_result;

  return v_result;
end;
$function$;

revoke execute on function public.platform_commercial_pipeline_v2(
  text, text, text, uuid, boolean, text, integer, integer
) from public, anon;
grant execute on function public.platform_commercial_pipeline_v2(
  text, text, text, uuid, boolean, text, integer, integer
) to authenticated, service_role;

comment on function public.platform_commercial_pipeline_v2(
  text, text, text, uuid, boolean, text, integer, integer
) is
  'Platform sales pipeline with server-side work-status facets, filters and deterministic pagination.';

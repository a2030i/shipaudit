-- Production migration 20260731001741: commercial routing for platform merchants.
-- Facts come from the latest platform snapshot; financial holds come from
-- Zoho open AR plus any negative wallet on any store linked to the phone.

create or replace view public.v_platform_commercial_routing
with (security_invoker = true)
as
with latest_id as (
  select snapshot_id
  from public.merchants
  order by uploaded_at desc
  limit 1
),
latest_merchants as (
  select merchant.*
  from public.merchants merchant
  where merchant.snapshot_id = (select snapshot_id from latest_id)
    and merchant.phone is not null
    and btrim(merchant.phone) <> ''
),
store_flags as (
  select
    merchant.phone,
    bool_or(
      lower(coalesce(btrim(merchant.integration_type), '')) like 'live%'
    ) as direct_live,
    bool_or(
      lower(coalesce(btrim(merchant.integration_type), '')) like 'live%'
      and merchant.status <> 'نشط'
    ) as direct_live_inactive,
    bool_and(coalesce(btrim(merchant.integration_type), '') = '') as manual_only,
    bool_or(
      lower(coalesce(btrim(merchant.integration_type), '')) in ('webhook', 'zapier')
    ) as automated_integration,
    bool_or(merchant.created_at_platform::date >= current_date - 5) as joined_5d,
    max(merchant.created_at_platform) as latest_created_at,
    round(sum(greatest(coalesce(merchant.wallet_balance, 0), 0)), 2)
      as positive_wallet,
    round(abs(sum(least(coalesce(merchant.wallet_balance, 0), 0))), 2)
      as negative_wallet,
    bool_or(coalesce(merchant.wallet_balance, 0) < -0.5) as has_negative_wallet
  from latest_merchants merchant
  group by merchant.phone
),
open_ar as (
  select
    invoice.customer_name,
    round(sum(invoice.balance), 2) as debt
  from public.zoho_invoices invoice
  where invoice.balance > 0.5
  group by invoice.customer_name
),
phone_customers as (
  select distinct
    merchant.phone,
    link.customer_name
  from latest_merchants merchant
  join public.customer_merchant_links link
    on link.store_id = merchant.store_id
),
phone_debt as (
  select
    phone_customer.phone,
    round(sum(coalesce(open_ar.debt, 0)), 2) as debt
  from phone_customers phone_customer
  left join open_ar
    on open_ar.customer_name = phone_customer.customer_name
  group by phone_customer.phone
),
base as (
  select
    merchant_rollup.*,
    flags.direct_live,
    flags.direct_live_inactive,
    flags.manual_only,
    flags.automated_integration,
    flags.joined_5d,
    flags.latest_created_at,
    flags.positive_wallet,
    flags.negative_wallet,
    flags.has_negative_wallet,
    coalesce(phone_debt.debt, 0::numeric) as debt,
    (
      flags.has_negative_wallet
      or coalesce(phone_debt.debt, 0) > 0.5
    ) as financial_hold,
    (
      flags.direct_live
      and flags.joined_5d
      and merchant_rollup.total_shipments = 0
      and merchant_rollup.last_topup is null
    ) as hot_live_new,
    (
      flags.direct_live
      and flags.joined_5d
      and merchant_rollup.total_shipments = 0
      and merchant_rollup.last_topup is not null
    ) as hot_live_topped,
    (
      merchant_rollup.total_shipments > 0
      and merchant_rollup.days_since_last between 1 and 5
    ) as recent_stop,
    (
      flags.positive_wallet > 0.5
      and (
        merchant_rollup.total_shipments = 0
        or merchant_rollup.days_since_last > 5
        or not merchant_rollup.any_active
      )
    ) as wallet_stranded,
    flags.direct_live_inactive as live_inactive,
    case
      when flags.direct_live then 'direct_live'
      when flags.automated_integration then 'automation'
      when flags.manual_only then 'manual'
      else 'other'
    end as integration_class,
    case
      when flags.has_negative_wallet and coalesce(phone_debt.debt, 0) > 0.5
        then 'مديونية زوهو ومحفظة سالبة'
      when flags.has_negative_wallet then 'محفظة سالبة'
      when coalesce(phone_debt.debt, 0) > 0.5 then 'مديونية زوهو مفتوحة'
      else null
    end as financial_hold_reason
  from public.v_crm_retargeting merchant_rollup
  join store_flags flags on flags.phone = merchant_rollup.phone
  left join phone_debt on phone_debt.phone = merchant_rollup.phone
),
classified as (
  select
    base.*,
    not base.financial_hold as sales_eligible,
    case
      when base.financial_hold then 'collections_hold'
      when base.hot_live_topped then 'hot_live_topped'
      when base.hot_live_new then 'hot_live_new'
      when base.recent_stop then 'recent_stop'
      when base.wallet_stranded then 'wallet_stranded'
      when base.live_inactive then 'live_inactive'
      when base.direct_live and base.total_shipments = 0 then 'live_no_first_shipment'
      when base.manual_only and base.joined_5d and base.total_shipments = 0 then 'manual_trial'
      when base.segment in ('stopped_recent', 'stopped_long') then 'recovery'
      when base.segment = 'active' then 'account_growth'
      else 'nurture'
    end as commercial_signal,
    case
      when base.financial_hold then 0
      when base.hot_live_topped then 100
      when base.hot_live_new then 98
      when base.recent_stop
        then least(99, 92 + least(base.total_shipments / 250, 7))::integer
      when base.wallet_stranded
        then least(96, 88 + least(base.positive_wallet::integer / 500, 8))::integer
      when base.live_inactive
        then least(93, 82 + least(base.total_shipments / 500, 11))::integer
      when base.direct_live and base.total_shipments = 0 then 78
      when base.manual_only and base.joined_5d and base.total_shipments = 0 then 45
      else greatest(25, least(coalesce(base.opportunity_score, 30), 85))
    end as signal_score,
    case
      when base.financial_hold
        then 'محوّل للتحصيل: ' || base.financial_hold_reason
      when base.hot_live_topped
        then 'ربط متجره مباشرة خلال 5 أيام وشحن الرصيد؛ يحتاج تنفيذ أول شحنة'
      when base.hot_live_new
        then 'ربط متجره مباشرة خلال 5 أيام ولم يشحن رصيدًا أو ينفّذ أول شحنة'
      when base.recent_stop
        then 'كان يشحن وآخر شحنة قبل ' || base.days_since_last::text || ' أيام'
      when base.wallet_stranded
        then 'لديه ' || base.positive_wallet::text || ' ر.س في المحفظة بلا شحن حديث'
      when base.live_inactive and base.total_shipments > 0
        then 'ربط مباشر غير نشط بعد ' || base.total_shipments::text || ' شحنة'
      when base.live_inactive
        then 'ربط متجره مباشرة ثم أصبح غير نشط قبل أول شحنة'
      when base.direct_live and base.total_shipments = 0
        then 'ربط مباشر قائم لكنه لم ينفّذ أول شحنة'
      when base.manual_only and base.joined_5d and base.total_shipments = 0
        then 'تسجيل يدوي حديث؛ نية أقل من العميل الذي ربط متجره'
      when base.segment in ('stopped_recent', 'stopped_long')
        then 'له شحنات سابقة ويحتاج فهم سبب التوقف'
      else base.next_step
    end as signal_reason,
    case
      when base.financial_hold then 'collections'
      when base.recent_stop or base.live_inactive then 'sales_recovery'
      when base.wallet_stranded then 'customer_success'
      when base.total_shipments = 0 then 'sales_activation'
      when base.segment = 'active' then 'account_management'
      else base.team_route
    end as assigned_team
  from base
)
select *
from classified;

revoke all on public.v_platform_commercial_routing
  from public, anon, authenticated;
grant select on public.v_platform_commercial_routing to service_role;

comment on view public.v_platform_commercial_routing is
  'Commercial intent and team routing for latest platform merchant accounts. Direct live means live/live2; financial holds use Zoho open AR and any negative store wallet.';

create or replace function public.platform_commercial_pipeline(
  p_bucket text default 'hot_live_new',
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
  scoped_raw as (
    select *
    from base
    where (v_see_all or owner_id = v_uid or not has_followup)
      and (p_owner is null or owner_id = p_owner)
      and (not p_unassigned or not has_followup)
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
  filtered as (
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
  ordered as (
    select *
    from filtered
    order by
      case when next_action_at is not null and next_action_at <= now() then 0 else 1 end,
      signal_score desc,
      next_action_at asc nulls last,
      updated_at desc nulls last,
      latest_created_at desc nulls last,
      primary_store
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
          round(sum(negative_wallet) filter (where financial_hold), 2),
          0
        ),
        'manual_trials', count(*) filter (
          where sales_eligible
            and manual_only
            and joined_5d
            and total_shipments = 0
        ),
        'new', count(*) filter (
          where sales_eligible
            and total_shipments = 0
            and latest_created_at >= current_date - 30
            and sales_stage = 'new'
        ),
        'in_progress', count(*) filter (
          where sales_eligible
            and has_followup
            and sales_stage in (
              'new', 'contacted', 'qualified', 'proposal', 'negotiation', 'nurture'
            )
        ),
        'recontact_due', count(*) filter (
          where sales_eligible
            and has_followup
            and next_action_at is not null
            and next_action_at <= now()
            and sales_stage not in ('won', 'disqualified')
        ),
        'scheduled', count(*) filter (
          where sales_eligible
            and has_followup
            and next_action_at > now()
            and sales_stage not in ('won', 'disqualified')
        ),
        'active', count(*) filter (
          where sales_eligible and platform_state = 'active'
        ),
        'stopped', count(*) filter (
          where sales_eligible and platform_state = 'stopped'
        ),
        'reactivated', count(*) filter (
          where sales_eligible and reactivated_30d
        ),
        'won', count(*) filter (
          where sales_eligible and sales_stage = 'won'
        ),
        'lost', count(*) filter (
          where sales_eligible and sales_stage = 'lost'
        ),
        'unscheduled', count(*) filter (
          where sales_eligible
            and has_followup
            and next_action_at is null
            and sales_stage in (
              'new', 'contacted', 'qualified', 'proposal', 'negotiation', 'nurture'
            )
        ),
        'unassigned', count(*) filter (
          where sales_eligible and not has_followup
        )
      )
      from scoped_raw
    ),
    'count', (select count(*) from filtered),
    'rows', coalesce(
      (select jsonb_agg(to_jsonb(row_data)) from ordered row_data),
      '[]'::jsonb
    )
  )
  into v_result;

  return v_result;
end;
$function$;

create or replace function public.platform_commercial_account(p_phone text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_base jsonb;
  v_routing jsonb;
begin
  v_base := public.platform_sales_account(p_phone);

  select to_jsonb(routing)
  into v_routing
  from public.v_platform_commercial_routing routing
  where routing.phone = p_phone
  limit 1;

  if v_routing is null then
    raise exception 'account_not_found';
  end if;

  return jsonb_set(
    v_base,
    '{account}',
    coalesce(v_base -> 'account', '{}'::jsonb) || v_routing,
    true
  );
end;
$function$;

create or replace function public.platform_commercial_signals()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if (select auth.uid()) is null
     or not (
       public.crm_has_permission('sales.view')
       or public.crm_has_permission('merchants.view')
       or public.crm_has_permission('crm.view')
     ) then
    raise exception 'not_allowed';
  end if;

  select jsonb_build_object(
    'summary', (
      select jsonb_build_object(
        'hot_live_new', count(*) filter (
          where sales_eligible and (hot_live_new or hot_live_topped)
        ),
        'recent_stop', count(*) filter (where sales_eligible and recent_stop),
        'wallet_stranded', count(*) filter (
          where sales_eligible and wallet_stranded
        ),
        'live_inactive', count(*) filter (where sales_eligible and live_inactive),
        'manual_trials', count(*) filter (
          where sales_eligible and manual_only and joined_5d
            and total_shipments = 0
        ),
        'collections_only', count(*) filter (where financial_hold),
        'ready_to_activate', count(*) filter (
          where sales_eligible
            and total_shipments = 0
            and profile_done
            and verified
            and direct_live
        ),
        'topped_no_ship', count(*) filter (
          where sales_eligible and segment = 'topped_no_ship'
        ),
        'new_7d_no_ship', count(*) filter (
          where sales_eligible and total_shipments = 0 and joined_5d
        ),
        'stopped_30d', count(*) filter (
          where sales_eligible
            and segment = 'stopped_recent'
            and days_since_last <= 30
        ),
        'key_accounts_at_risk', count(*) filter (
          where sales_eligible
            and segment in ('stopped_recent', 'stopped_long')
            and total_shipments >= 1000
        ),
        'compliance_pending', count(*) filter (
          where sales_eligible
            and compliance_pending
            and total_shipments > 0
            and days_since_last <= 30
        ),
        'multi_store_accounts', count(*) filter (
          where sales_eligible and store_count > 1
        )
      )
      from public.v_platform_commercial_routing
    ),
    'opportunity_details', (
      select coalesce(jsonb_agg(to_jsonb(detail)), '[]'::jsonb)
      from (
        select routing.*
        from public.v_platform_commercial_routing routing
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
        order by
          routing.signal_score desc,
          routing.total_shipments desc,
          routing.latest_created_at desc nulls last
        limit 200
      ) detail
    ),
    'activation_ready', (
      select coalesce(
        jsonb_agg(
          to_jsonb(ready)
          order by ready.signal_score desc, ready.latest_created_at desc
        ),
        '[]'::jsonb
      )
      from (
        select
          routing.phone,
          routing.primary_store as store,
          routing.*
        from public.v_platform_commercial_routing routing
        left join public.retargeting_followups followup
          on followup.phone = routing.phone
        where followup.phone is null
          and routing.sales_eligible
          and routing.total_shipments = 0
          and routing.profile_done
          and routing.verified
          and routing.direct_live
          and (
            routing.latest_created_at is null
            or routing.latest_created_at < now() - interval '30 days'
          )
        order by routing.signal_score desc, routing.latest_created_at desc nulls last
        limit 15
      ) ready
    ),
    'activation_ready_count', (
      select count(*)
      from public.v_platform_commercial_routing routing
      left join public.retargeting_followups followup
        on followup.phone = routing.phone
      where followup.phone is null
        and routing.sales_eligible
        and routing.total_shipments = 0
        and routing.profile_done
        and routing.verified
        and routing.direct_live
        and (
          routing.latest_created_at is null
          or routing.latest_created_at < now() - interval '30 days'
        )
    )
  )
  into v_result;

  return v_result;
end;
$function$;

create or replace function public.sales_today_routed(p_user uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user uuid := coalesce(p_user, (select auth.uid()));
  v_base jsonb;
  v_due jsonb;
  v_opportunities jsonb;
  v_opportunity_count integer;
  v_followups_total integer;
begin
  v_base := public.sales_today(p_user);

  select coalesce(jsonb_agg(item order by item ->> 'next_at'), '[]'::jsonb)
  into v_due
  from jsonb_array_elements(coalesce(v_base -> 'due_followups', '[]'::jsonb)) item
  left join public.v_platform_commercial_routing routing
    on routing.phone = item ->> 'phone'
  where routing.phone is null or routing.sales_eligible;

  select coalesce(jsonb_agg(to_jsonb(opportunity) order by opportunity.signal_score desc), '[]'::jsonb)
  into v_opportunities
  from (
    select
      routing.phone,
      routing.primary_store as store,
      routing.segment,
      routing.priority,
      routing.channel,
      routing.total_shipments,
      routing.wallet,
      routing.created_at,
      routing.last_shipment,
      routing.days_since_last,
      routing.store_count,
      routing.store_names,
      routing.integration_type,
      routing.billing_type,
      routing.profile_done,
      routing.verified,
      routing.vat_reg,
      routing.zatca_done,
      routing.compliance_pending,
      routing.readiness_score,
      routing.opportunity_score,
      routing.team_route,
      routing.next_step,
      routing.direct_live,
      routing.integration_class,
      routing.positive_wallet,
      routing.negative_wallet,
      routing.debt,
      routing.commercial_signal,
      routing.signal_score,
      routing.signal_reason,
      routing.assigned_team,
      routing.hot_live_new,
      routing.hot_live_topped,
      routing.recent_stop,
      routing.wallet_stranded,
      routing.live_inactive
    from public.v_platform_commercial_routing routing
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
    order by
      routing.signal_score desc,
      routing.latest_created_at desc nulls last,
      routing.total_shipments desc
    limit 30
  ) opportunity;

  select count(*)
  into v_opportunity_count
  from public.v_platform_commercial_routing routing
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
    );

  select count(*)
  into v_followups_total
  from public.retargeting_followups followup
  left join public.v_platform_commercial_routing routing
    on routing.phone = followup.phone
  where followup.owner_id = v_user
    and (
      routing.phone is null
      or routing.sales_eligible
    )
    and followup.status not in (
      'converted', 'returned', 'not_interested',
      'supplier', 'noise', 'blacklist', 'test'
    );

  v_base := jsonb_set(v_base, '{due_followups}', v_due, true);
  v_base := jsonb_set(v_base, '{platform_opportunities}', v_opportunities, true);
  v_base := jsonb_set(
    v_base,
    '{platform_opportunity_count}',
    to_jsonb(v_opportunity_count),
    true
  );
  v_base := jsonb_set(
    v_base,
    '{my_followups_total}',
    to_jsonb(v_followups_total),
    true
  );

  return v_base;
end;
$function$;

create or replace function public.guard_platform_sales_financial_hold()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if exists (
    select 1
    from public.v_platform_commercial_routing routing
    where routing.phone = new.phone
      and routing.financial_hold
  ) then
    raise exception 'financial_hold';
  end if;

  return new;
end;
$function$;

drop trigger if exists retargeting_followups_financial_hold_guard
  on public.retargeting_followups;
create trigger retargeting_followups_financial_hold_guard
before insert or update on public.retargeting_followups
for each row
execute function public.guard_platform_sales_financial_hold();

revoke execute on function public.platform_commercial_pipeline(
  text, uuid, boolean, text, integer, integer
) from public, anon;
grant execute on function public.platform_commercial_pipeline(
  text, uuid, boolean, text, integer, integer
) to authenticated, service_role;

revoke execute on function public.platform_commercial_account(text)
  from public, anon;
grant execute on function public.platform_commercial_account(text)
  to authenticated, service_role;

revoke execute on function public.platform_commercial_signals()
  from public, anon;
grant execute on function public.platform_commercial_signals()
  to authenticated, service_role;

revoke execute on function public.sales_today_routed(uuid)
  from public, anon;
grant execute on function public.sales_today_routed(uuid)
  to authenticated, service_role;

revoke execute on function public.guard_platform_sales_financial_hold()
  from public, anon, authenticated;

comment on function public.platform_commercial_pipeline(
  text, uuid, boolean, text, integer, integer
) is
  'Sales pipeline with intent signals and hard exclusion of Zoho-debt/negative-wallet accounts.';

comment on function public.sales_today_routed(uuid) is
  'Existing sales_today payload with platform opportunities and followups filtered through commercial team routing.';

comment on function public.guard_platform_sales_financial_hold() is
  'Prevents sales followups from being inserted or changed while the platform account belongs to collections.';

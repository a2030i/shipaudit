-- Sales Today v3
-- Platform merchants are the primary sales work queue.
-- WhatsApp replies remain owned by the Hatif team and do not create/open leads here.

create or replace function public.sales_today(p_user uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  u uuid := coalesce(p_user, auth.uid());
  out jsonb;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if u is distinct from auth.uid() and not public.crm_can_see_all() then
    raise exception 'not_allowed';
  end if;

  select jsonb_build_object(
    'due_followups', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.next_at), '[]'::jsonb)
      from (
        select
          f.phone,
          v.primary_store as store,
          f.status,
          f.next_action_at as next_at,
          f.notes,
          greatest(0, extract(day from now() - f.next_action_at))::int as days_over
        from public.retargeting_followups f
        left join lateral (
          select primary_store
          from public.v_crm_retargeting v
          where v.phone = f.phone
          limit 1
        ) v on true
        where f.owner_id = u
          and f.next_action_at is not null
          and f.next_action_at <= now() + interval '12 hours'
          and f.status not in (
            'converted', 'returned', 'not_interested',
            'supplier', 'noise', 'blacklist', 'test'
          )
        order by f.next_action_at
        limit 30
      ) x
    ),
    'platform_opportunities', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.rank_order, x.created_at desc nulls last), '[]'::jsonb)
      from (
        select
          v.phone,
          v.primary_store as store,
          v.segment,
          v.priority,
          v.channel,
          v.total_shipments,
          v.wallet,
          v.created_at,
          v.last_shipment,
          v.days_since_last,
          case
            when v.segment = 'topped_no_ship' then 1
            when v.segment in ('new_active', 'linked_no_ship', 'registered_no_ship')
              and v.created_at >= now() - interval '7 days' then 2
            when v.segment = 'stopped_recent' and v.priority = 'A' then 3
            when v.segment = 'stopped_recent' then 4
            when v.segment = 'stopped_long' and v.priority = 'A' then 5
            when v.segment = 'linked_no_ship' then 6
            else 7
          end as rank_order
        from public.v_crm_retargeting v
        left join public.retargeting_followups f on f.phone = v.phone
        where f.phone is null
          and (
            v.segment = 'topped_no_ship'
            or v.segment = 'stopped_recent'
            or (v.segment = 'stopped_long' and v.priority = 'A')
            or (
              v.segment in ('new_active', 'linked_no_ship', 'registered_no_ship')
              and v.created_at >= now() - interval '30 days'
            )
          )
        order by rank_order, v.created_at desc nulls last, v.total_shipments desc
        limit 30
      ) x
    ),
    'platform_opportunity_count', (
      select count(*)
      from public.v_crm_retargeting v
      left join public.retargeting_followups f on f.phone = v.phone
      where f.phone is null
        and (
          v.segment = 'topped_no_ship'
          or v.segment = 'stopped_recent'
          or (v.segment = 'stopped_long' and v.priority = 'A')
          or (
            v.segment in ('new_active', 'linked_no_ship', 'registered_no_ship')
            and v.created_at >= now() - interval '30 days'
          )
        )
    ),
    'lead_actions', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.next_at), '[]'::jsonb)
      from (
        select
          l.id,
          l.name,
          l.phone_normalized as phone,
          l.status,
          l.last_disposition,
          l.next_action_at as next_at,
          l.campaign_name,
          l.received_at
        from public.crm_leads l
        where l.owner_id = u
          and l.next_action_at is not null
          and l.next_action_at <= now() + interval '12 hours'
          and l.status not in ('converted', 'activated', 'lost', 'existing_customer')
        order by l.next_action_at
        limit 30
      ) x
    ),
    'my_new_leads', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.received_at desc), '[]'::jsonb)
      from (
        select
          l.id,
          l.name,
          l.phone_normalized as phone,
          l.category,
          l.campaign_name,
          l.received_at,
          l.first_response_due_at
        from public.crm_leads l
        where l.owner_id = u
          and l.lead_kind = 'inbound'
          and l.status = 'new'
        order by l.received_at desc
        limit 30
      ) x
    ),
    'my_new_leads_count', (
      select count(*)
      from public.crm_leads
      where owner_id = u
        and lead_kind = 'inbound'
        and status = 'new'
    ),
    'unassigned_inbound', (
      select case
        when public.crm_has_permission('crm.assign') then
          coalesce(jsonb_agg(to_jsonb(x) order by x.received_at), '[]'::jsonb)
        else '[]'::jsonb
      end
      from (
        select
          l.id,
          l.name,
          l.phone_normalized as phone,
          l.campaign_name,
          l.received_at,
          l.first_response_due_at
        from public.crm_leads l
        where l.owner_id is null
          and l.lead_kind = 'inbound'
          and l.status not in ('converted', 'activated', 'lost', 'existing_customer')
        order by l.received_at
        limit 30
      ) x
    ),
    'my_tasks', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.due_at), '[]'::jsonb)
      from (
        select t.id, t.title, t.due_at, t.kind, t.entity_ref as entity, t.entity_type
        from public.crm_tasks t
        where t.assigned_to = u
          and t.status = 'open'
          and t.due_at <= now() + interval '24 hours'
          -- Retargeting follow-ups are shown once in due_followups.
          -- Campaign replies are handled by Hatif and are not sales leads here.
          and not (t.entity_type = 'retargeting' and t.kind = 'followup')
        order by t.due_at
        limit 30
      ) x
    ),
    'my_followups_total', (
      select count(*)
      from public.retargeting_followups
      where owner_id = u
        and status not in (
          'converted', 'returned', 'not_interested',
          'supplier', 'noise', 'blacklist', 'test'
        )
    )
  )
  into out;

  return out;
end;
$function$;

revoke execute on function public.sales_today(uuid) from public, anon;
grant execute on function public.sales_today(uuid) to authenticated, service_role;

comment on function public.sales_today(uuid) is
  'Daily sales queue led by platform merchant signals; WhatsApp replies are owned by Hatif and excluded from lead creation.';

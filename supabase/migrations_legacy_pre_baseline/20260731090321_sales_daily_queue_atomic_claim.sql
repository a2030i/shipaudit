-- «قائمة اليوم» تعرض حصة قابلة للعمل من مخزون الفرص.
-- الاستلام يجب أن يكون ذريًا ومصحوبًا بموعد حتى لا:
--   1) يستلم موظفان الفرصة نفسها.
--   2) تتحول الفرصة إلى متابعة مفتوحة بلا موعد وتختفي من يوم الموظف.

create or replace function public.claim_platform_sales_opportunity(
  p_phone text,
  p_next timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_followup public.retargeting_followups%rowtype;
  v_inserted boolean := false;
  v_claimed boolean := false;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  if not (
    public.crm_has_permission('sales.view')
    or public.crm_has_permission('crm.view')
  ) then
    raise exception 'not_allowed';
  end if;

  if p_phone is null or btrim(p_phone) = '' then
    raise exception 'phone_required';
  end if;

  if not exists (
    select 1
    from public.v_platform_commercial_routing routing
    where routing.phone = btrim(p_phone)
      and routing.sales_eligible
  ) then
    raise exception 'not_sales_eligible';
  end if;

  insert into public.retargeting_followups (
    phone,
    status,
    sales_stage,
    owner_id,
    next_action_at,
    next_action_type,
    updated_by,
    updated_at
  )
  values (
    btrim(p_phone),
    'needs_followup',
    'new',
    v_uid,
    coalesce(p_next, now()),
    'call',
    v_uid,
    now()
  )
  on conflict (phone) do nothing
  returning *
  into v_followup;

  v_inserted := found;
  v_claimed := v_inserted;

  if not v_inserted then
    select *
    into v_followup
    from public.retargeting_followups
    where phone = btrim(p_phone)
    for update;

    if v_followup.owner_id is not null
       and v_followup.owner_id is distinct from v_uid then
      raise exception 'already_claimed';
    end if;

    update public.retargeting_followups
    set
      owner_id = v_uid,
      status = case
        when owner_id is null then 'needs_followup'
        else status
      end,
      next_action_at = coalesce(next_action_at, p_next, now()),
      next_action_type = coalesce(next_action_type, 'call'),
      updated_by = v_uid,
      updated_at = now()
    where phone = btrim(p_phone)
    returning *
    into v_followup;

    v_claimed := true;
  end if;

  if v_claimed then
    insert into public.crm_activities (
      entity_type,
      entity_ref,
      kind,
      disposition,
      summary,
      occurred_at,
      owner_id,
      created_by
    )
    values (
      'platform_merchant',
      btrim(p_phone),
      'sales_claim',
      'needs_followup',
      'أُضيفت الفرصة إلى قائمة اليوم',
      now(),
      v_uid,
      v_uid
    );
  end if;

  return to_jsonb(v_followup);
end;
$function$;

revoke execute on function public.claim_platform_sales_opportunity(
  text, timestamptz
) from public, anon;
grant execute on function public.claim_platform_sales_opportunity(
  text, timestamptz
) to authenticated, service_role;

comment on function public.claim_platform_sales_opportunity(
  text, timestamptz
) is
  'Atomically assigns an eligible platform opportunity to the caller and schedules it in today''s queue.';

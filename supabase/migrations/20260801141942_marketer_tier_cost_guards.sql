-- Keep marketer commission plans economically valid even when an RPC is
-- called outside the UI: contiguous progressive tiers and a final rate that
-- stays strictly below the plan's target cost per order.

create or replace function public.marketing_assert_plan_tiers(p_plan_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_bad boolean;
  v_target numeric;
begin
  select target_cost_per_order into v_target
  from public.marketing_compensation_plans
  where id = p_plan_id;
  if not found then raise exception 'plan_not_found'; end if;

  select count(*) = 0 into v_bad
  from public.marketing_commission_tiers where plan_id = p_plan_id;
  if v_bad then raise exception 'tiers_required'; end if;

  select exists (
    select 1
    from (
      select from_order, to_order,
             lag(to_order) over (order by from_order) as previous_to,
             row_number() over (order by from_order) as rn,
             count(*) over () as total_rows
      from public.marketing_commission_tiers
      where plan_id = p_plan_id
    ) x
    where (rn = 1 and from_order <> 1)
       or (rn > 1 and (previous_to is null or from_order <> previous_to + 1))
       or (rn < total_rows and to_order is null)
       or (rn = total_rows and to_order is not null)
  ) into v_bad;
  if v_bad then raise exception 'tiers_must_be_contiguous_and_open_ended'; end if;

  select exists (
    select 1
    from (
      select rate_per_order,
             lag(rate_per_order) over (order by from_order) as previous_rate
      from public.marketing_commission_tiers
      where plan_id = p_plan_id
    ) x
    where previous_rate is not null and rate_per_order < previous_rate
  ) into v_bad;
  if v_bad then raise exception 'tiers_must_be_non_decreasing'; end if;

  select rate_per_order >= v_target into v_bad
  from public.marketing_commission_tiers
  where plan_id = p_plan_id
  order by from_order desc
  limit 1;
  if coalesce(v_bad, true) then raise exception 'last_tier_must_be_below_target'; end if;
end;
$$;

revoke all on function public.marketing_assert_plan_tiers(uuid) from public, anon, authenticated;
grant execute on function public.marketing_assert_plan_tiers(uuid) to service_role;

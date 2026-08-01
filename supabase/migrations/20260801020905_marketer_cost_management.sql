-- إدارة تكلفة المسوقين ونقطة التعادل الشهرية.
-- نقطة التعادل هنا لا تعتمد على ربح لمحة: هي أول عدد طلبات تصبح عنده
-- (الراتب + عمولة المسوق) / الطلبات <= التكلفة المستهدفة للطلب.

create table public.marketing_marketers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 120),
  phone text,
  start_month date not null default date_trunc('month', current_date)::date
    check (start_month = date_trunc('month', start_month)::date),
  lifecycle_status text not null default 'green'
    check (lifecycle_status in ('green', 'yellow', 'red', 'stopped')),
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.marketing_compensation_plans (
  id uuid primary key default gen_random_uuid(),
  marketer_id uuid not null references public.marketing_marketers(id) on delete cascade,
  effective_month date not null
    check (effective_month = date_trunc('month', effective_month)::date),
  monthly_salary numeric(14,2) not null default 0 check (monthly_salary >= 0),
  target_cost_per_order numeric(14,4) not null check (target_cost_per_order > 0),
  monthly_order_target integer check (monthly_order_target is null or monthly_order_target >= 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (marketer_id, effective_month)
);

create table public.marketing_commission_tiers (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.marketing_compensation_plans(id) on delete cascade,
  from_order integer not null check (from_order >= 1),
  to_order integer check (to_order is null or to_order >= from_order),
  rate_per_order numeric(14,4) not null default 0 check (rate_per_order >= 0),
  unique (plan_id, from_order)
);

create table public.marketing_monthly_performance (
  id uuid primary key default gen_random_uuid(),
  marketer_id uuid not null references public.marketing_marketers(id) on delete cascade,
  period date not null check (period = date_trunc('month', period)::date),
  eligible_orders integer not null default 0 check (eligible_orders >= 0),
  notes text,
  close_state text not null default 'draft' check (close_state in ('draft', 'closed')),
  plan_id uuid references public.marketing_compensation_plans(id) on delete restrict,
  salary_snapshot numeric(14,2),
  target_cost_snapshot numeric(14,4),
  order_target_snapshot integer,
  variable_commission_snapshot numeric(14,2),
  total_cost_snapshot numeric(14,2),
  effective_cost_snapshot numeric(14,4),
  break_even_orders_snapshot integer,
  achieved_break_even boolean,
  resulting_status text check (resulting_status is null or resulting_status in ('green', 'yellow', 'red', 'stopped')),
  created_by uuid references public.profiles(id) on delete set null,
  closed_by uuid references public.profiles(id) on delete set null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (marketer_id, period)
);

create table public.marketing_status_history (
  id uuid primary key default gen_random_uuid(),
  marketer_id uuid not null references public.marketing_marketers(id) on delete cascade,
  period date not null,
  from_status text not null check (from_status in ('green', 'yellow', 'red', 'stopped')),
  to_status text not null check (to_status in ('green', 'yellow', 'red', 'stopped')),
  achieved_break_even boolean not null,
  eligible_orders integer not null,
  break_even_orders integer,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now(),
  unique (marketer_id, period)
);

create index marketing_plans_marketer_month_idx
  on public.marketing_compensation_plans (marketer_id, effective_month desc);
create index marketing_performance_period_idx
  on public.marketing_monthly_performance (period desc, marketer_id);
create index marketing_history_marketer_period_idx
  on public.marketing_status_history (marketer_id, period desc);

alter table public.marketing_marketers enable row level security;
alter table public.marketing_compensation_plans enable row level security;
alter table public.marketing_commission_tiers enable row level security;
alter table public.marketing_monthly_performance enable row level security;
alter table public.marketing_status_history enable row level security;

create policy marketing_marketers_select on public.marketing_marketers
  for select to authenticated using (public.crm_has_permission('marketers.view'));
create policy marketing_marketers_insert on public.marketing_marketers
  for insert to authenticated with check (public.crm_has_permission('marketers.manage'));
create policy marketing_marketers_update on public.marketing_marketers
  for update to authenticated
  using (public.crm_has_permission('marketers.manage'))
  with check (public.crm_has_permission('marketers.manage'));

create policy marketing_plans_select on public.marketing_compensation_plans
  for select to authenticated using (public.crm_has_permission('marketers.view'));
create policy marketing_plans_insert on public.marketing_compensation_plans
  for insert to authenticated with check (public.crm_has_permission('marketers.manage'));

create policy marketing_tiers_select on public.marketing_commission_tiers
  for select to authenticated using (public.crm_has_permission('marketers.view'));
create policy marketing_tiers_insert on public.marketing_commission_tiers
  for insert to authenticated with check (public.crm_has_permission('marketers.manage'));

create policy marketing_months_select on public.marketing_monthly_performance
  for select to authenticated using (public.crm_has_permission('marketers.view'));
create policy marketing_months_insert on public.marketing_monthly_performance
  for insert to authenticated
  with check (public.crm_has_permission('marketers.record_month') and created_by = auth.uid());
create policy marketing_months_update on public.marketing_monthly_performance
  for update to authenticated
  using (public.crm_has_permission('marketers.record_month') and close_state = 'draft')
  with check (public.crm_has_permission('marketers.record_month'));

create policy marketing_history_select on public.marketing_status_history
  for select to authenticated using (public.crm_has_permission('marketers.view'));

grant select on public.marketing_marketers,
  public.marketing_compensation_plans,
  public.marketing_commission_tiers,
  public.marketing_monthly_performance,
  public.marketing_status_history to authenticated;
grant insert, update on public.marketing_marketers to authenticated;
grant insert on public.marketing_compensation_plans, public.marketing_commission_tiers to authenticated;
grant insert, update on public.marketing_monthly_performance to authenticated;
grant select, insert, update, delete on public.marketing_marketers,
  public.marketing_compensation_plans,
  public.marketing_commission_tiers,
  public.marketing_monthly_performance,
  public.marketing_status_history to service_role;

create or replace function public.marketing_variable_commission(p_plan_id uuid, p_orders integer)
returns numeric
language sql
stable
set search_path = public
as $$
  select coalesce(sum(
    greatest(
      0,
      least(greatest(coalesce(p_orders, 0), 0), coalesce(t.to_order, greatest(coalesce(p_orders, 0), 0)))
      - t.from_order + 1
    ) * t.rate_per_order
  ), 0)::numeric
  from public.marketing_commission_tiers t
  where t.plan_id = p_plan_id;
$$;

create or replace function public.marketing_break_even_orders(p_plan_id uuid)
returns integer
language plpgsql
stable
set search_path = public
as $$
declare
  v_salary numeric;
  v_target numeric;
  v_margin numeric;
  v_progress numeric := 0;
  v_width integer;
  v_needed integer;
  v_tier record;
begin
  select monthly_salary, target_cost_per_order
    into v_salary, v_target
  from public.marketing_compensation_plans
  where id = p_plan_id;
  if not found then raise exception 'plan_not_found'; end if;

  for v_tier in
    select from_order, to_order, rate_per_order
    from public.marketing_commission_tiers
    where plan_id = p_plan_id
    order by from_order
  loop
    v_margin := v_target - v_tier.rate_per_order;
    if v_tier.to_order is null then
      if v_margin = 0 and v_progress >= v_salary then return v_tier.from_order; end if;
      if v_margin <= 0 then return null; end if;
      v_needed := greatest(1, ceil((v_salary - v_progress) / v_margin)::integer);
      return (v_tier.from_order - 1) + v_needed;
    end if;

    v_width := v_tier.to_order - v_tier.from_order + 1;
    if v_margin = 0 and v_progress >= v_salary then return v_tier.from_order; end if;
    if v_margin > 0 and v_progress + (v_width * v_margin) >= v_salary then
      v_needed := greatest(1, ceil((v_salary - v_progress) / v_margin)::integer);
      return (v_tier.from_order - 1) + v_needed;
    end if;
    v_progress := v_progress + (v_width * v_margin);
  end loop;
  return null;
end;
$$;

create or replace function public.marketing_assert_plan_tiers(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bad boolean;
begin
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
end;
$$;

create or replace function public.marketing_create_marketer(
  p_name text,
  p_phone text,
  p_start_month date,
  p_monthly_salary numeric,
  p_target_cost_per_order numeric,
  p_monthly_order_target integer,
  p_tiers jsonb,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_marketer uuid;
  v_plan uuid;
begin
  if v_uid is null or not public.crm_has_permission('marketers.manage') then
    raise exception 'not_allowed';
  end if;
  if p_start_month <> date_trunc('month', p_start_month)::date then raise exception 'month_required'; end if;
  if coalesce(jsonb_array_length(p_tiers), 0) = 0 then raise exception 'tiers_required'; end if;

  insert into public.marketing_marketers (name, phone, start_month, notes, created_by)
  values (trim(p_name), nullif(trim(p_phone), ''), p_start_month, nullif(trim(p_notes), ''), v_uid)
  returning id into v_marketer;

  insert into public.marketing_compensation_plans
    (marketer_id, effective_month, monthly_salary, target_cost_per_order, monthly_order_target, created_by)
  values
    (v_marketer, p_start_month, p_monthly_salary, p_target_cost_per_order, p_monthly_order_target, v_uid)
  returning id into v_plan;

  insert into public.marketing_commission_tiers (plan_id, from_order, to_order, rate_per_order)
  select v_plan,
         (x->>'from_order')::integer,
         nullif(x->>'to_order', '')::integer,
         (x->>'rate_per_order')::numeric
  from jsonb_array_elements(p_tiers) x;

  perform public.marketing_assert_plan_tiers(v_plan);
  return v_marketer;
end;
$$;

create or replace function public.marketing_create_plan(
  p_marketer_id uuid,
  p_effective_month date,
  p_monthly_salary numeric,
  p_target_cost_per_order numeric,
  p_monthly_order_target integer,
  p_tiers jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_plan uuid;
begin
  if v_uid is null or not public.crm_has_permission('marketers.manage') then raise exception 'not_allowed'; end if;
  if p_effective_month <> date_trunc('month', p_effective_month)::date then raise exception 'month_required'; end if;
  if coalesce(jsonb_array_length(p_tiers), 0) = 0 then raise exception 'tiers_required'; end if;
  if not exists (select 1 from public.marketing_marketers where id = p_marketer_id) then raise exception 'marketer_not_found'; end if;

  select id into v_plan
  from public.marketing_compensation_plans
  where marketer_id = p_marketer_id and effective_month = p_effective_month
  for update;

  if v_plan is not null then
    if exists (
      select 1 from public.marketing_monthly_performance
      where plan_id = v_plan and close_state = 'closed'
    ) then raise exception 'plan_month_locked'; end if;
    update public.marketing_compensation_plans set
      monthly_salary = p_monthly_salary,
      target_cost_per_order = p_target_cost_per_order,
      monthly_order_target = p_monthly_order_target
    where id = v_plan;
    delete from public.marketing_commission_tiers where plan_id = v_plan;
  else
    insert into public.marketing_compensation_plans
      (marketer_id, effective_month, monthly_salary, target_cost_per_order, monthly_order_target, created_by)
    values
      (p_marketer_id, p_effective_month, p_monthly_salary, p_target_cost_per_order, p_monthly_order_target, v_uid)
    returning id into v_plan;
  end if;

  insert into public.marketing_commission_tiers (plan_id, from_order, to_order, rate_per_order)
  select v_plan,
         (x->>'from_order')::integer,
         nullif(x->>'to_order', '')::integer,
         (x->>'rate_per_order')::numeric
  from jsonb_array_elements(p_tiers) x;
  perform public.marketing_assert_plan_tiers(v_plan);
  return v_plan;
end;
$$;

create or replace function public.marketing_save_month(
  p_marketer_id uuid,
  p_period date,
  p_eligible_orders integer,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null or not public.crm_has_permission('marketers.record_month') then raise exception 'not_allowed'; end if;
  if p_period <> date_trunc('month', p_period)::date then raise exception 'month_required'; end if;
  if p_eligible_orders < 0 then raise exception 'orders_must_be_positive'; end if;
  if exists (
    select 1 from public.marketing_monthly_performance
    where marketer_id = p_marketer_id and period = p_period and close_state = 'closed'
  ) then raise exception 'month_already_closed'; end if;

  insert into public.marketing_monthly_performance
    (marketer_id, period, eligible_orders, notes, created_by, updated_at)
  values
    (p_marketer_id, p_period, p_eligible_orders, nullif(trim(p_notes), ''), v_uid, now())
  on conflict (marketer_id, period) do update
    set eligible_orders = excluded.eligible_orders,
        notes = excluded.notes,
        updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.marketing_close_month(p_marketer_id uuid, p_period date)
returns table (
  performance_id uuid,
  resulting_status text,
  achieved_break_even boolean,
  break_even_orders integer,
  total_cost numeric,
  effective_cost numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_marketer public.marketing_marketers%rowtype;
  v_perf public.marketing_monthly_performance%rowtype;
  v_plan public.marketing_compensation_plans%rowtype;
  v_commission numeric;
  v_total numeric;
  v_effective numeric;
  v_break_even integer;
  v_success boolean;
  v_next text;
  v_current_month date := date_trunc('month', timezone('Asia/Riyadh', now()))::date;
begin
  if v_uid is null or not public.crm_has_permission('marketers.close_month') then raise exception 'not_allowed'; end if;
  if p_period <> date_trunc('month', p_period)::date then raise exception 'month_required'; end if;
  if p_period >= v_current_month then raise exception 'month_not_finished'; end if;

  select * into v_marketer from public.marketing_marketers where id = p_marketer_id for update;
  if not found then raise exception 'marketer_not_found'; end if;
  select * into v_perf from public.marketing_monthly_performance
    where marketer_id = p_marketer_id and period = p_period for update;
  if not found then raise exception 'orders_not_recorded'; end if;
  if v_perf.close_state = 'closed' then raise exception 'month_already_closed'; end if;
  if exists (
    select 1 from public.marketing_monthly_performance
    where marketer_id = p_marketer_id and period > p_period and close_state = 'closed'
  ) then raise exception 'close_months_in_order'; end if;

  select * into v_plan from public.marketing_compensation_plans
  where marketer_id = p_marketer_id and effective_month <= p_period
  order by effective_month desc limit 1;
  if not found then raise exception 'plan_not_found_for_month'; end if;

  v_commission := round(public.marketing_variable_commission(v_plan.id, v_perf.eligible_orders), 2);
  v_total := round(v_plan.monthly_salary + v_commission, 2);
  v_effective := case when v_perf.eligible_orders > 0 then round(v_total / v_perf.eligible_orders, 4) else null end;
  v_break_even := public.marketing_break_even_orders(v_plan.id);
  v_success := v_break_even is not null and v_perf.eligible_orders >= v_break_even;
  v_next := case
    when v_marketer.lifecycle_status = 'stopped' then 'stopped'
    when v_success and v_marketer.lifecycle_status = 'red' then 'yellow'
    when v_success and v_marketer.lifecycle_status = 'yellow' then 'green'
    when v_success then 'green'
    when v_marketer.lifecycle_status = 'green' then 'yellow'
    when v_marketer.lifecycle_status = 'yellow' then 'red'
    when v_marketer.lifecycle_status = 'red' then 'stopped'
    else v_marketer.lifecycle_status
  end;

  update public.marketing_monthly_performance set
    close_state = 'closed', plan_id = v_plan.id,
    salary_snapshot = v_plan.monthly_salary,
    target_cost_snapshot = v_plan.target_cost_per_order,
    order_target_snapshot = v_plan.monthly_order_target,
    variable_commission_snapshot = v_commission,
    total_cost_snapshot = v_total,
    effective_cost_snapshot = v_effective,
    break_even_orders_snapshot = v_break_even,
    achieved_break_even = v_success,
    resulting_status = v_next,
    closed_by = v_uid, closed_at = now(), updated_at = now()
  where id = v_perf.id;

  update public.marketing_marketers
    set lifecycle_status = v_next, updated_at = now()
  where id = p_marketer_id;

  insert into public.marketing_status_history
    (marketer_id, period, from_status, to_status, achieved_break_even, eligible_orders, break_even_orders, changed_by)
  values
    (p_marketer_id, p_period, v_marketer.lifecycle_status, v_next, v_success, v_perf.eligible_orders, v_break_even, v_uid);

  return query select v_perf.id, v_next, v_success, v_break_even, v_total, v_effective;
end;
$$;

revoke all on function public.marketing_variable_commission(uuid, integer) from public, anon;
revoke all on function public.marketing_break_even_orders(uuid) from public, anon;
revoke all on function public.marketing_assert_plan_tiers(uuid) from public, anon;
revoke all on function public.marketing_create_marketer(text, text, date, numeric, numeric, integer, jsonb, text) from public, anon;
revoke all on function public.marketing_create_plan(uuid, date, numeric, numeric, integer, jsonb) from public, anon;
revoke all on function public.marketing_save_month(uuid, date, integer, text) from public, anon;
revoke all on function public.marketing_close_month(uuid, date) from public, anon;

grant execute on function public.marketing_variable_commission(uuid, integer) to authenticated, service_role;
grant execute on function public.marketing_break_even_orders(uuid) to authenticated, service_role;
grant execute on function public.marketing_create_marketer(text, text, date, numeric, numeric, integer, jsonb, text) to authenticated, service_role;
grant execute on function public.marketing_create_plan(uuid, date, numeric, numeric, integer, jsonb) to authenticated, service_role;
grant execute on function public.marketing_save_month(uuid, date, integer, text) to authenticated, service_role;
grant execute on function public.marketing_close_month(uuid, date) to authenticated, service_role;

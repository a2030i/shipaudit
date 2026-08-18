alter table public.carrier_task_schedules
  add column if not exists schedule_basis text not null default 'month_days',
  add column if not exists due_days smallint[] not null default '{}';

alter table public.carrier_task_schedules
  drop constraint if exists carrier_task_schedules_schedule_basis_check;

alter table public.carrier_task_schedules
  add constraint carrier_task_schedules_schedule_basis_check
  check (schedule_basis in ('weekday', 'month_days'));

update public.carrier_task_schedules
set
  schedule_basis = case
    when cadence = 'weekly' and day_of_period between 0 and 6 then 'weekday'
    else 'month_days'
  end,
  due_days = case
    when cadence = 'on_demand' or day_of_period is null then '{}'::smallint[]
    when cadence = 'weekly' and day_of_period between 0 and 6 then array[day_of_period]::smallint[]
    when cadence = 'weekly' then array(
      select value::smallint
      from generate_series(day_of_period::integer, 31, 7) value
    )
    when cadence = 'biweekly' then array(
      select value::smallint
      from unnest(array[day_of_period::integer, day_of_period::integer + 15]) value
      where value <= 31
    )
    else array[day_of_period]::smallint[]
  end;

comment on column public.carrier_task_schedules.schedule_basis is
  'weekday = due_days stores 0..6 weekdays; month_days = due_days stores explicit calendar dates.';
comment on column public.carrier_task_schedules.due_days is
  'Explicit expected delivery weekdays or month dates used by accounting-cycle close checks.';

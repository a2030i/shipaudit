-- Explicit, auditable collection-task assignment for the team cutover.
-- No existing employee receives collections.assign automatically.

create table if not exists public.collection_task_assignment_batches (
  id uuid primary key default gen_random_uuid(),
  task_ids uuid[] not null,
  task_count integer not null check (task_count > 0),
  assignee_id uuid references public.profiles(id) on delete set null,
  assigned_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.collection_task_assignment_batches enable row level security;

drop policy if exists collection_task_assignment_batches_select
  on public.collection_task_assignment_batches;
create policy collection_task_assignment_batches_select
on public.collection_task_assignment_batches
for select to authenticated
using (
  public.crm_has_permission('collections.assign')
  or public.crm_has_permission('collections.view_all')
);

create index if not exists collection_task_assignment_batches_created_idx
  on public.collection_task_assignment_batches (created_at desc);

create or replace function public.collection_assignment_candidates()
returns table (
  user_id uuid,
  employee_name text,
  employee_email text,
  open_tasks bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.crm_has_permission('collections.assign') then
    raise exception 'not_allowed';
  end if;

  return query
  select
    profile.id,
    profile.name,
    profile.email,
    count(task.id) filter (
      where task.stage in ('todo', 'contacted', 'promised', 'snoozed')
    ) as open_tasks
  from public.profiles profile
  left join public.collection_tasks task on task.assigned_to = profile.id
  where profile.role <> 'admin'
    and coalesce((profile.permissions ->> 'collections.view')::boolean, false)
    and coalesce((profile.permissions ->> 'collections.update_stage')::boolean, false)
  group by profile.id, profile.name, profile.email
  order by count(task.id) filter (
    where task.stage in ('todo', 'contacted', 'promised', 'snoozed')
  ), profile.name nulls last, profile.email;
end;
$$;

create or replace function public.assign_collection_tasks(
  p_task_ids uuid[],
  p_assignee uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_ids uuid[];
  v_updated integer := 0;
begin
  if v_uid is null or not public.crm_has_permission('collections.assign') then
    raise exception 'not_allowed';
  end if;

  if coalesce(cardinality(p_task_ids), 0) = 0 then
    raise exception 'task_ids_required';
  end if;

  if cardinality(p_task_ids) > 500 then
    raise exception 'too_many_tasks';
  end if;

  if p_assignee is not null and not exists (
    select 1
    from public.profiles profile
    where profile.id = p_assignee
      and profile.role <> 'admin'
      and coalesce((profile.permissions ->> 'collections.view')::boolean, false)
      and coalesce((profile.permissions ->> 'collections.update_stage')::boolean, false)
  ) then
    raise exception 'assignee_not_eligible';
  end if;

  select array_agg(distinct task.id order by task.id)
  into v_ids
  from public.collection_tasks task
  where task.id = any(p_task_ids)
    and task.stage in ('todo', 'contacted', 'promised', 'snoozed');

  if coalesce(cardinality(v_ids), 0) = 0 then
    raise exception 'no_open_tasks';
  end if;

  update public.collection_tasks task
  set assigned_to = p_assignee,
      updated_at = now()
  where task.id = any(v_ids);
  get diagnostics v_updated = row_count;

  insert into public.collection_task_assignment_batches (
    task_ids, task_count, assignee_id, assigned_by
  ) values (
    v_ids, v_updated, p_assignee, v_uid
  );

  return jsonb_build_object(
    'updated', v_updated,
    'assignee_id', p_assignee,
    'unassigned', p_assignee is null
  );
end;
$$;

revoke all on table public.collection_task_assignment_batches from public, anon;
grant select on table public.collection_task_assignment_batches to authenticated;

revoke all on function public.collection_assignment_candidates() from public, anon;
grant execute on function public.collection_assignment_candidates() to authenticated, service_role;

revoke all on function public.assign_collection_tasks(uuid[], uuid) from public, anon;
grant execute on function public.assign_collection_tasks(uuid[], uuid) to authenticated, service_role;

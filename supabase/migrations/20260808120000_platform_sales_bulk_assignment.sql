-- Explicit, audited bulk assignment for the platform-sales workspace.
-- The action changes only retargeting_followups.owner_id; it never changes
-- the sales stage, outcome, next action, notes, or financial data.

create table if not exists public.platform_sales_assignment_batches (
  id uuid primary key default gen_random_uuid(),
  assignee_id uuid not null references public.profiles(id) on delete restrict,
  assigned_by uuid not null references public.profiles(id) on delete restrict,
  requested_count integer not null check (requested_count > 0),
  assigned_count integer not null check (assigned_count >= 0),
  reassigned_count integer not null default 0 check (reassigned_count >= 0),
  phones text[] not null,
  created_at timestamptz not null default now()
);

alter table public.platform_sales_assignment_batches enable row level security;
revoke all on table public.platform_sales_assignment_batches from public, anon, authenticated;
grant select on table public.platform_sales_assignment_batches to authenticated;

drop policy if exists platform_sales_assignment_batches_select on public.platform_sales_assignment_batches;
create policy platform_sales_assignment_batches_select
on public.platform_sales_assignment_batches
for select to authenticated
using (public.crm_has_permission('crm.assign'));

create index if not exists platform_sales_assignment_batches_created_at_idx
  on public.platform_sales_assignment_batches (created_at desc);
create index if not exists platform_sales_assignment_batches_assignee_idx
  on public.platform_sales_assignment_batches (assignee_id, created_at desc);

create or replace function public.assign_platform_sales_accounts(
  p_phones text[],
  p_owner uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
  v_requested integer;
  v_assigned integer;
  v_reassigned integer;
  v_batch uuid;
  v_phones text[];
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.crm_has_permission('crm.assign') then raise exception 'not_allowed'; end if;
  if p_owner is null then raise exception 'assignee_required'; end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = p_owner
      and p.role <> 'admin'
      and coalesce((p.permissions ->> 'sales.view')::boolean, false)
      and coalesce((p.permissions ->> 'sales.manage')::boolean, false)
  ) then
    raise exception 'assignee_not_sales_operator';
  end if;

  select array_agg(phone order by phone), count(*)
  into v_phones, v_requested
  from (
    select distinct btrim(raw_phone) as phone
    from unnest(coalesce(p_phones, array[]::text[])) raw_phone
    where nullif(btrim(raw_phone), '') is not null
  ) selected;

  if coalesce(v_requested, 0) = 0 then raise exception 'no_accounts_selected'; end if;
  if v_requested > 5000 then raise exception 'bulk_limit_5000'; end if;

  -- Only accounts that are still eligible for the platform-sales workspace
  -- can be assigned. Financially held customers remain outside this workflow.
  select array_agg(selected.phone order by selected.phone), count(*)
  into v_phones, v_assigned
  from unnest(v_phones) selected(phone)
  join public.v_platform_commercial_routing routing on routing.phone = selected.phone
  where routing.sales_eligible;

  if coalesce(v_assigned, 0) = 0 then raise exception 'no_eligible_accounts'; end if;
  if v_assigned <> v_requested then raise exception 'selection_changed_refresh_required'; end if;

  select count(*) into v_reassigned
  from public.retargeting_followups followup
  where followup.phone = any(v_phones)
    and followup.owner_id is not null
    and followup.owner_id is distinct from p_owner;

  insert into public.retargeting_followups (
    phone, status, owner_id, updated_by, updated_at
  )
  select phone, 'new', p_owner, v_uid, now()
  from unnest(v_phones) selected(phone)
  on conflict (phone) do update set
    owner_id = excluded.owner_id,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

  insert into public.platform_sales_assignment_batches (
    assignee_id, assigned_by, requested_count, assigned_count,
    reassigned_count, phones
  ) values (
    p_owner, v_uid, v_requested, v_assigned, v_reassigned, v_phones
  ) returning id into v_batch;

  return jsonb_build_object(
    'batch_id', v_batch,
    'requested_count', v_requested,
    'assigned_count', v_assigned,
    'reassigned_count', v_reassigned,
    'assignee_id', p_owner
  );
end;
$$;

revoke all on function public.assign_platform_sales_accounts(text[], uuid) from public, anon;
grant execute on function public.assign_platform_sales_accounts(text[], uuid) to authenticated, service_role;


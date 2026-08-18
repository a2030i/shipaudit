alter table public.collection_tasks
  add column if not exists promised_at timestamptz,
  add column if not exists promise_baseline_debt numeric(14,2),
  add column if not exists promise_paid_amount numeric(14,2),
  add column if not exists promise_verified_at timestamptz;

create index if not exists collection_tasks_assignee_open_idx
  on public.collection_tasks (assigned_to, stage, promise_date, created_at desc)
  where stage in ('todo','contacted','promised','snoozed');
create index if not exists zoho_payments_customer_date_idx
  on public.zoho_payments (customer_name, date desc);

create or replace function public.collection_can_see_all()
returns boolean language sql stable security definer
set search_path=public,pg_temp
as $$ select public.crm_has_permission('collections.view_all') $$;

create or replace function public.reconcile_collection_promises_internal()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_updated integer:=0;
begin
  with calc as (
    select t.id,coalesce(ar.total_due,0)::numeric current_debt,
      least(
        coalesce((select sum(p.amount) from public.zoho_payments p
          where p.customer_name=t.customer_name
            and p.date>=coalesce(t.promised_at,t.updated_at)::date),0),
        greatest(coalesce(t.promise_baseline_debt,t.debt_at_creation)-coalesce(ar.total_due,0),0)
      )::numeric verified_paid
    from public.collection_tasks t
    left join public.customer_ar ar on ar.contact_name=t.customer_name
    where t.stage='promised' and coalesce(t.promise_status,'pending') in ('pending','partial')
  )
  update public.collection_tasks t set
    promise_paid_amount=round(c.verified_paid,2),promise_verified_at=now(),
    promise_status=case
      when c.verified_paid>=greatest(coalesce(t.promise_amount,0)-0.5,0) then 'honored'
      when t.promise_date<current_date then 'broken'
      when c.verified_paid>0.5 then 'partial' else 'pending' end,
    honored_amount=case when c.verified_paid>=greatest(coalesce(t.promise_amount,0)-0.5,0)
      then round(c.verified_paid,2) else t.honored_amount end,
    stage=case when c.current_debt<=0.5 then 'done'
      when c.verified_paid>=greatest(coalesce(t.promise_amount,0)-0.5,0) then 'todo'
      when t.promise_date<current_date then 'contacted' else 'promised' end,
    done_at=case when c.current_debt<=0.5 then now() else t.done_at end,
    updated_at=now()
  from calc c where c.id=t.id;
  get diagnostics v_updated=row_count;
  return jsonb_build_object('checked',v_updated);
end;
$$;

create or replace function public.collection_record_promise(
  p_task_id uuid,p_amount numeric,p_date date,p_notes text default null
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=(select auth.uid());v_task public.collection_tasks%rowtype;v_debt numeric;
begin
  if v_uid is null or not public.crm_has_permission('collections.record_promise') then raise exception 'not_allowed';end if;
  if p_amount is null or p_amount<=0 or p_date is null then raise exception 'invalid_promise';end if;
  select * into v_task from public.collection_tasks where id=p_task_id for update;
  if not found then raise exception 'task_not_found';end if;
  if v_task.assigned_to is distinct from v_uid and not public.collection_can_see_all() then raise exception 'not_owner';end if;
  select coalesce(total_due,0) into v_debt from public.customer_ar where contact_name=v_task.customer_name;
  v_debt:=coalesce(v_debt,v_task.debt_at_creation,0);
  update public.collection_tasks set stage='promised',promise_amount=round(p_amount,2),promise_date=p_date,
    promise_status='pending',promised_at=now(),promise_baseline_debt=round(v_debt,2),
    promise_paid_amount=0,promise_verified_at=now(),honored_amount=null,
    notes=coalesce(nullif(btrim(p_notes),''),notes),updated_at=now()
  where id=p_task_id returning * into v_task;
  return to_jsonb(v_task);
end;
$$;

revoke all on function public.collection_can_see_all() from public,anon;
grant execute on function public.collection_can_see_all() to authenticated,service_role;
revoke all on function public.reconcile_collection_promises_internal() from public,anon,authenticated;
grant execute on function public.reconcile_collection_promises_internal() to service_role;
revoke all on function public.collection_record_promise(uuid,numeric,date,text) from public,anon;
grant execute on function public.collection_record_promise(uuid,numeric,date,text) to authenticated,service_role;

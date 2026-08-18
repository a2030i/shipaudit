create or replace view public.v_collection_candidates
with (security_invoker=true)
as
with latest_snapshot as (
  select snapshot_id from public.merchants order by uploaded_at desc limit 1
), merchant_context as (
  select l.customer_name,
    bool_or(coalesce(m.billing_type,'')='دفع مسبق') prepaid,
    bool_or(lower(coalesce(m.status,'')) in ('active','نشط','enabled')) active
  from public.customer_merchant_links l
  join public.merchants m on m.store_id=l.store_id
    and m.snapshot_id=(select snapshot_id from latest_snapshot)
  group by l.customer_name
), base as (
  select ar.contact_name customer_name,round(ar.total_due::numeric,2) debt,
    greatest(coalesce(ar.days_oldest,0),case when ar.opening_due>0.5 then 91 else 0 end)::int days_outstanding,
    coalesce(mc.prepaid,false) prepaid,coalesce(mc.active,false) active
  from public.customer_ar ar
  left join merchant_context mc on mc.customer_name=ar.contact_name
  where ar.total_due>0.5
)
select b.*,
  case when b.prepaid then 'prepaid_with_debt'
    when b.debt>10000 then 'over_credit_limit'
    when b.days_outstanding>90 then 'aged_90'
    when b.days_outstanding>60 then 'aged_60'
    when b.days_outstanding>30 then 'aged_30' end trigger,
  case when b.prepaid then 500
    when b.active and b.debt>10000 then 450
    when b.days_outstanding>90 then 400
    when b.debt>10000 then 350
    when b.days_outstanding>60 then 300
    when b.days_outstanding>30 then 200 else 0 end priority_score
from base b
where b.prepaid or b.debt>10000 or b.days_outstanding>30;

create or replace function public.refresh_collection_tasks()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_uid uuid:=(select auth.uid());v_collectors uuid[];
  v_created int:=0;v_closed int:=0;v_cancelled int:=0;v_reassigned int:=0;v_promises jsonb;
begin
  if v_uid is null or not public.crm_has_permission('collections.regenerate') then raise exception 'not_allowed';end if;
  perform pg_advisory_xact_lock(hashtextextended('refresh_collection_tasks',0));
  v_promises:=public.reconcile_collection_promises_internal();
  update public.collection_tasks t set stage='done',done_at=now(),updated_at=now(),
    notes=concat_ws(' · ',nullif(t.notes,''),'أُغلقت تلقائياً: لا يوجد رصيد مفتوح في زوهو')
  where t.stage in ('todo','contacted','promised','snoozed') and t.trigger<>'manual'
    and not exists(select 1 from public.customer_ar ar where ar.contact_name=t.customer_name and ar.total_due>0.5);
  get diagnostics v_closed=row_count;
  update public.collection_tasks t set stage='cancelled',updated_at=now(),
    notes=concat_ws(' · ',nullif(t.notes,''),'استُبدلت تلقائياً بسبب تحصيل أعلى أولوية')
  from public.v_collection_candidates c
  where c.customer_name=t.customer_name and c.trigger is distinct from t.trigger
    and t.stage in ('todo','contacted','snoozed');
  get diagnostics v_cancelled=row_count;
  select array_agg(p.id order by p.id) into v_collectors
  from public.profiles p where p.role<>'admin'
    and coalesce((p.permissions->>'collections.update_stage')::boolean,false);
  if coalesce(cardinality(v_collectors),0)=0 then v_collectors:=array[v_uid];end if;
  with movable as (
    select t.id,row_number() over(order by c.priority_score desc,c.debt desc,t.created_at) rn
    from public.collection_tasks t
    join public.v_collection_candidates c on c.customer_name=t.customer_name
    left join public.profiles p on p.id=t.assigned_to
    where t.stage='todo' and t.updated_at<=t.created_at+interval '5 seconds'
      and (t.assigned_to is null or p.role='admin')
  )
  update public.collection_tasks t set
    assigned_to=v_collectors[((m.rn-1)%cardinality(v_collectors))+1],updated_at=now()
  from movable m where m.id=t.id;
  get diagnostics v_reassigned=row_count;
  with missing as (
    select c.*,row_number() over(order by c.priority_score desc,c.debt desc,c.customer_name) rn
    from public.v_collection_candidates c
    where c.trigger is not null and not exists(
      select 1 from public.collection_tasks t where t.customer_name=c.customer_name
        and t.stage in ('todo','contacted','promised','snoozed')
    )
  )
  insert into public.collection_tasks(customer_name,trigger,stage,debt_at_creation,credit_limit,days_outstanding,assigned_to)
  select customer_name,trigger,'todo',debt,10000,days_outstanding,
    v_collectors[((rn-1)%cardinality(v_collectors))+1]
  from missing on conflict do nothing;
  get diagnostics v_created=row_count;
  return jsonb_build_object('created',v_created,'closed',v_closed,'cancelled',v_cancelled,
    'reassigned',v_reassigned,'promises',v_promises);
end;
$$;

revoke all on public.v_collection_candidates from public,anon,authenticated;
grant select on public.v_collection_candidates to service_role;
revoke all on function public.refresh_collection_tasks() from public,anon;
grant execute on function public.refresh_collection_tasks() to authenticated,service_role;

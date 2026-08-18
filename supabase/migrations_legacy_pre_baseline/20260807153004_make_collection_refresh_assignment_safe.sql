-- Refreshing the collection queue is a financial maintenance action, not an
-- assignment action. Assignment is intentionally kept behind
-- assign_collection_tasks() and collections.assign so a refresh cannot move
-- work between employees or silently assign new debtors.
create or replace function public.refresh_collection_tasks()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_created int := 0;
  v_closed int := 0;
  v_cancelled int := 0;
  v_promises jsonb;
begin
  if v_uid is null or not public.crm_has_permission('collections.regenerate') then
    raise exception 'not_allowed';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('refresh_collection_tasks', 0));
  v_promises := public.reconcile_collection_promises_internal();

  update public.collection_tasks t
  set stage = 'done',
      done_at = now(),
      updated_at = now(),
      notes = concat_ws(
        ' · ',
        nullif(t.notes, ''),
        'أُغلقت تلقائياً: لا يوجد مبلغ مطلوب تحصيله بعد احتساب رصيد زوهو الدائن'
      )
  where t.stage in ('todo', 'contacted', 'promised', 'snoozed')
    and t.trigger <> 'manual'
    and not exists (
      select 1
      from public.customer_ar ar
      where ar.contact_name = t.customer_name
        and ar.collectible_due > 0.5
    );
  get diagnostics v_closed = row_count;

  update public.collection_tasks t
  set stage = 'cancelled',
      updated_at = now(),
      notes = concat_ws(
        ' · ',
        nullif(t.notes, ''),
        'استُبدلت تلقائياً بسبب تحصيل أعلى أولوية'
      )
  from public.v_collection_candidates c
  where c.customer_name = t.customer_name
    and c.trigger is distinct from t.trigger
    and t.stage in ('todo', 'contacted', 'snoozed');
  get diagnostics v_cancelled = row_count;

  with missing as (
    select c.*
    from public.v_collection_candidates c
    where c.trigger is not null
      and not exists (
        select 1
        from public.collection_tasks t
        where t.customer_name = c.customer_name
          and t.stage in ('todo', 'contacted', 'promised', 'snoozed')
      )
  )
  insert into public.collection_tasks (
    customer_name,
    trigger,
    stage,
    debt_at_creation,
    credit_limit,
    days_outstanding,
    assigned_to
  )
  select
    customer_name,
    trigger,
    'todo',
    debt,
    10000,
    days_outstanding,
    null
  from missing
  on conflict do nothing;
  get diagnostics v_created = row_count;

  return jsonb_build_object(
    'created', v_created,
    'closed', v_closed,
    'cancelled', v_cancelled,
    'reassigned', 0,
    'promises', v_promises
  );
end;
$function$;

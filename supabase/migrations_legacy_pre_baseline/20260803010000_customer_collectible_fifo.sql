-- Separate Zoho's gross debit and unused credit without mutating either source.
-- For collection-only reporting, credit covers the oldest balance first:
-- opening balance (2026-01-10), then invoices ordered by due date/date/id.

create or replace view public.customer_ar as
select
  c.contact_name,
  c.zoho_id,
  c.outstanding_receivable as total_due,
  coalesce(inv.invoiced_due, 0::numeric) as invoiced_due,
  round(c.outstanding_receivable - coalesce(inv.invoiced_due, 0::numeric), 2) as opening_due,
  coalesce(inv.open_count, 0::bigint) as open_invoices,
  inv.oldest_invoice_date,
  coalesce(inv.days_oldest, 0) as days_oldest,
  c.unused_credits_receivable as unused_credits,
  c.status,
  round(least(greatest(coalesce(c.outstanding_receivable, 0), 0), greatest(coalesce(c.unused_credits_receivable, 0), 0)), 2) as credit_offset,
  round(greatest(coalesce(c.outstanding_receivable, 0) - greatest(coalesce(c.unused_credits_receivable, 0), 0), 0), 2) as collectible_due,
  round(greatest(coalesce(c.unused_credits_receivable, 0) - greatest(coalesce(c.outstanding_receivable, 0), 0), 0), 2) as credit_surplus,
  (coalesce(c.outstanding_receivable, 0) > 0.5 and coalesce(c.unused_credits_receivable, 0) > 0.005) as needs_zoho_settlement
from public.zoho_contacts c
left join lateral (
  select
    sum(i.balance) as invoiced_due,
    count(*) as open_count,
    min(i.date) as oldest_invoice_date,
    current_date - min(i.date) as days_oldest
  from public.zoho_invoices i
  where i.customer_name = c.contact_name and i.balance > 0.5
) inv on true
where c.contact_type = 'customer';

comment on view public.customer_ar is
  'Zoho customer balance truth. total_due and unused_credits stay separate; collectible_due is a collection-only projection and never writes to Zoho.';

create or replace view public.customer_collectible_lines
with (security_invoker = true) as
with balances as (
  select
    ar.contact_name,
    ar.zoho_id as contact_id,
    greatest(coalesce(ar.opening_due, 0), 0)::numeric as opening_gross,
    greatest(coalesce(ar.unused_credits, 0), 0)::numeric as available_credit,
    least(
      greatest(coalesce(ar.opening_due, 0), 0),
      greatest(coalesce(ar.unused_credits, 0), 0)
    )::numeric as opening_credit,
    greatest(
      greatest(coalesce(ar.unused_credits, 0), 0) - greatest(coalesce(ar.opening_due, 0), 0),
      0
    )::numeric as invoice_credit
  from public.customer_ar ar
), invoice_base as (
  select
    b.contact_name,
    b.contact_id,
    i.zoho_id as line_id,
    i.invoice_number,
    i.date as line_date,
    coalesce(i.due_date, i.date) as due_date,
    i.status,
    i.balance::numeric as gross_amount,
    b.invoice_credit,
    coalesce(sum(i.balance::numeric) over (
      partition by b.contact_name
      order by coalesce(i.due_date, i.date), i.date, i.zoho_id
      rows between unbounded preceding and 1 preceding
    ), 0)::numeric as prior_gross
  from balances b
  join public.zoho_invoices i on i.customer_name = b.contact_name
  where i.balance > 0.5
), invoice_lines as (
  select
    contact_name,
    contact_id,
    'invoice'::text as line_kind,
    line_id,
    invoice_number,
    line_date,
    due_date,
    status,
    gross_amount,
    least(gross_amount, greatest(invoice_credit - prior_gross, 0))::numeric as allocated_credit
  from invoice_base
), opening_lines as (
  select
    contact_name,
    contact_id,
    'opening_balance'::text as line_kind,
    null::text as line_id,
    null::text as invoice_number,
    date '2026-01-10' as line_date,
    date '2026-01-10' as due_date,
    'opening_balance'::text as status,
    opening_gross as gross_amount,
    opening_credit as allocated_credit
  from balances
  where opening_gross > 0.005
)
select
  contact_name,
  contact_id,
  line_kind,
  line_id,
  invoice_number,
  line_date,
  due_date,
  status,
  round(gross_amount, 2) as gross_amount,
  round(allocated_credit, 2) as allocated_credit,
  round(greatest(gross_amount - allocated_credit, 0), 2) as collectible_amount,
  greatest(current_date - due_date, 0)::int as age_days
from (
  select * from opening_lines
  union all
  select * from invoice_lines
) lines;

comment on view public.customer_collectible_lines is
  'Read-only FIFO projection for collection: unused credit covers 2026-01-10 opening balance first, then the oldest invoice. No Zoho balance is changed.';

grant select on public.customer_collectible_lines to authenticated;

create or replace function public.customer_money_dashboard()
returns json
language sql
stable security definer
set search_path to 'public'
as $function$
  with latest_merch as (select snapshot_id from merchants order by uploaded_at desc limit 1),
  merch as (
    select m.store_id, m.store_name, m.phone, normalize_arabic_name(m.store_name) norm,
           m.billing_type, m.status platform_status, m.wallet_balance, m.last_shipment_at
    from merchants m where m.snapshot_id = (select snapshot_id from latest_merch)
  ),
  links as (select customer_name, store_id from customer_merchant_links where store_id is not null),
  line_agg as (
    select l.contact_name,
      sum(l.collectible_amount) filter (
        where l.line_kind = 'opening_balance' or lower(coalesce(l.status,'')) = 'overdue'
      ) as overdue_amt,
      count(*) filter (where l.line_kind = 'invoice' and l.collectible_amount > 0.5)::int as inv_cnt,
      max(l.age_days) filter (where l.collectible_amount > 0.005) as oldest_days,
      sum(l.collectible_amount) filter (where l.age_days <= 30) as b0,
      sum(l.collectible_amount) filter (where l.age_days between 31 and 60) as b1,
      sum(l.collectible_amount) filter (where l.age_days between 61 and 90) as b2,
      sum(l.collectible_amount) filter (where l.age_days > 90) as b3,
      sum(l.collectible_amount) filter (where l.line_kind = 'opening_balance') as opening_balance
    from customer_collectible_lines l
    where l.collectible_amount > 0.005
    group by l.contact_name
  ),
  cust as (
    select ar.contact_name customer_name,
      ar.total_due gross_due,
      greatest(coalesce(ar.unused_credits,0),0) unused_credit,
      ar.credit_offset,
      ar.collectible_due owed,
      ar.credit_surplus,
      ar.needs_zoho_settlement,
      coalesce(a.overdue_amt,0) overdue_amt,
      coalesce(a.inv_cnt,0) inv_cnt,
      coalesce(a.oldest_days,0) oldest_days,
      coalesce(a.b0,0) b0, coalesce(a.b1,0) b1, coalesce(a.b2,0) b2, coalesce(a.b3,0) b3,
      coalesce(a.opening_balance,0) opening_balance,
      greatest(coalesce(ar.opening_due,0),0) opening_gross
    from customer_ar ar
    left join line_agg a on a.contact_name = ar.contact_name
    where ar.collectible_due > 0.5
  ),
  settlement_base as (
    select ar.contact_name customer_name,
      ar.total_due gross_due,
      greatest(coalesce(ar.unused_credits,0),0) unused_credit,
      ar.credit_offset,
      ar.collectible_due,
      ar.credit_surplus,
      greatest(coalesce(ar.opening_due,0),0) opening_gross,
      coalesce((select collectible_amount from customer_collectible_lines l
        where l.contact_name=ar.contact_name and l.line_kind='opening_balance' limit 1),0) opening_collectible
    from customer_ar ar
    where ar.total_due > 0.5 and ar.credit_offset > 0.005
  ),
  last_pay as (select customer_name,max(date) last_date from zoho_payments where customer_name is not null group by customer_name),
  last_pay_amt as (
    select p.customer_name,p.date,sum(p.amount) amount from zoho_payments p join last_pay lp
      on lp.customer_name=p.customer_name and p.date=lp.last_date group by p.customer_name,p.date
  ),
  cust_full as (
    select distinct on (c.customer_name) c.*,lpa.date last_payment_date,lpa.amount last_payment_amount,
      m.store_id,m.phone,m.store_name,m.billing_type,m.platform_status,m.wallet_balance,m.last_shipment_at
    from cust c left join last_pay_amt lpa on lpa.customer_name=c.customer_name
    left join links l on l.customer_name=c.customer_name
    left join merch m on m.store_id=l.store_id or (l.store_id is null and m.norm=normalize_arabic_name(c.customer_name))
    order by c.customer_name,(l.store_id is not null) desc
  ),
  settlement_full as (
    select distinct on (s.customer_name) s.*,m.store_id,m.phone,m.store_name
    from settlement_base s
    left join links l on l.customer_name=s.customer_name
    left join merch m on m.store_id=l.store_id or (l.store_id is null and m.norm=normalize_arabic_name(s.customer_name))
    order by s.customer_name,(l.store_id is not null) desc
  ),
  monthly_col as (
    select to_char(date,'YYYY-MM') ym,sum(amount) amount,count(*)::int cnt from zoho_payments
    where date >= current_date-interval '12 months' group by 1 order by 1 desc
  )
  select json_build_object(
    'gross_outstanding',(select coalesce(round(sum(total_due)::numeric,2),0) from customer_ar where total_due > 0.5),
    'credit_offset',(select coalesce(round(sum(credit_offset)::numeric,2),0) from customer_ar where total_due > 0.5),
    'unused_credits',(select coalesce(round(sum(greatest(coalesce(unused_credits,0),0))::numeric,2),0) from customer_ar),
    'credit_surplus',(select coalesce(round(sum(credit_surplus)::numeric,2),0) from customer_ar),
    'outstanding',(select coalesce(round(sum(owed)::numeric,2),0) from cust),
    'outstanding_cnt',(select count(*) from cust),
    'settlement_count',(select count(*) from settlement_base),
    'settlement_total',(select coalesce(round(sum(credit_offset)::numeric,2),0) from settlement_base),
    'overdue_amt',(select coalesce(round(sum(overdue_amt)::numeric,2),0) from cust),
    'aging',json_build_object(
      'b0_30',(select coalesce(round(sum(b0)::numeric,2),0) from cust),
      'b31_60',(select coalesce(round(sum(b1)::numeric,2),0) from cust),
      'b61_90',(select coalesce(round(sum(b2)::numeric,2),0) from cust),
      'b90p',(select coalesce(round(sum(b3)::numeric,2),0) from cust),
      'opening_balance',(select coalesce(round(sum(opening_balance)::numeric,2),0) from cust),
      'opening_gross',(select coalesce(round(sum(opening_gross)::numeric,2),0) from cust)),
    'collected_this_month',(select coalesce(round(sum(amount)::numeric,2),0) from zoho_payments where date>=date_trunc('month',current_date) and date<date_trunc('month',current_date)+interval '1 month'),
    'collected_prev_month',(select coalesce(round(sum(amount)::numeric,2),0) from zoho_payments where date>=date_trunc('month',current_date)-interval '1 month' and date<date_trunc('month',current_date)),
    'monthly_collected',(select coalesce(json_agg(row_to_json(m)),'[]') from monthly_col m),
    'customers',(select coalesce(json_agg(json_build_object(
      'name',cf.customer_name,'store_name',cf.store_name,'store_id',cf.store_id,'phone',cf.phone,
      'gross_due',round(cf.gross_due::numeric,2),'unused_credit',round(cf.unused_credit::numeric,2),
      'credit_offset',round(cf.credit_offset::numeric,2),'credit_surplus',round(cf.credit_surplus::numeric,2),
      'needs_zoho_settlement',cf.needs_zoho_settlement,
      'owed',round(cf.owed::numeric,2),'overdue',coalesce(round(cf.overdue_amt::numeric,2),0),
      'inv_cnt',cf.inv_cnt,'oldest_days',cf.oldest_days,
      'b0',round(cf.b0::numeric,2),'b1',round(cf.b1::numeric,2),'b2',round(cf.b2::numeric,2),'b3',round(cf.b3::numeric,2),
      'opening_balance',round(cf.opening_balance::numeric,2),'opening_gross',round(cf.opening_gross::numeric,2),
      'last_payment_date',cf.last_payment_date,'last_payment_amount',coalesce(round(cf.last_payment_amount::numeric,2),0),
      'billing_type',cf.billing_type,'platform_status',cf.platform_status,
      'wallet_balance',round(coalesce(cf.wallet_balance,0)::numeric,2),'last_shipment_at',cf.last_shipment_at
    ) order by cf.owed desc),'[]') from cust_full cf),
    'settlements',(select coalesce(json_agg(json_build_object(
      'name',sf.customer_name,'store_name',sf.store_name,'store_id',sf.store_id,'phone',sf.phone,
      'gross_due',round(sf.gross_due::numeric,2),'unused_credit',round(sf.unused_credit::numeric,2),
      'credit_offset',round(sf.credit_offset::numeric,2),'collectible_due',round(sf.collectible_due::numeric,2),
      'credit_surplus',round(sf.credit_surplus::numeric,2),
      'opening_gross',round(sf.opening_gross::numeric,2),'opening_collectible',round(sf.opening_collectible::numeric,2),
      'covered_fully',sf.collectible_due <= 0.5
    ) order by sf.credit_offset desc),'[]') from settlement_full sf)
  );
$function$;

create or replace view public.v_collection_candidates
with (security_invoker = true) as
with latest_snapshot as (
  select snapshot_id from public.merchants order by uploaded_at desc limit 1
), merchant_context as (
  select l.customer_name,
    bool_or(coalesce(m.billing_type,'')='دفع مسبق') prepaid,
    bool_or(lower(coalesce(m.status,''))=any(array['active','نشط','enabled'])) active
  from public.customer_merchant_links l
  join public.merchants m on m.store_id=l.store_id and m.snapshot_id=(select snapshot_id from latest_snapshot)
  group by l.customer_name
), base as (
  select ar.contact_name customer_name, round(ar.collectible_due,2) debt,
    greatest(coalesce((select max(age_days) from public.customer_collectible_lines l
      where l.contact_name=ar.contact_name and l.collectible_amount>0.005),0),0) days_outstanding,
    coalesce(mc.prepaid,false) prepaid, coalesce(mc.active,false) active
  from public.customer_ar ar
  left join merchant_context mc on mc.customer_name=ar.contact_name
  where ar.collectible_due>0.5
)
select customer_name,debt,days_outstanding,prepaid,active,
  case when prepaid then 'prepaid_with_debt'
       when debt>10000 then 'over_credit_limit'
       when days_outstanding>90 then 'aged_90'
       when days_outstanding>60 then 'aged_60'
       when days_outstanding>30 then 'aged_30' else null end trigger,
  case when prepaid then 500 when active and debt>10000 then 450 when days_outstanding>90 then 400
       when debt>10000 then 350 when days_outstanding>60 then 300 when days_outstanding>30 then 200 else 0 end priority_score
from base
where prepaid or debt>10000 or days_outstanding>30;

create or replace function public.zoho_overdue_campaign()
returns table(customer_name text, phone text, store_name text, owed numeric, inv_count integer, oldest date, oldest_age_days integer, invoice_list text)
language sql
stable security definer
set search_path to 'public'
as $function$
  with latest_merch as (select snapshot_id from merchants order by uploaded_at desc limit 1),
  merch as (
    select m.store_id,m.store_name,m.phone,normalize_arabic_name(m.store_name) norm
    from merchants m where m.snapshot_id=(select snapshot_id from latest_merch)
  ),
  links as (select customer_name,store_id from customer_merchant_links where store_id is not null),
  overdue as (
    select l.contact_name customer_name,
      sum(l.collectible_amount) owed,
      count(*) filter(where l.line_kind='invoice' and l.collectible_amount>0.5)::int cnt,
      min(l.due_date) oldest,
      string_agg(
        case when l.line_kind='opening_balance'
          then 'رصيد افتتاحي 10-01-2026 ('||round(l.collectible_amount,2)||')'
          else l.invoice_number||' ('||round(l.collectible_amount,2)||')' end,
        ' · ' order by l.due_date,l.line_id
      ) invs
    from customer_collectible_lines l
    where l.collectible_amount>0.5
      and (l.line_kind='opening_balance' or lower(coalesce(l.status,''))='overdue')
    group by l.contact_name
  )
  select o.customer_name,m.phone,m.store_name,round(o.owed,2),o.cnt,o.oldest,
    (current_date-o.oldest)::int,o.invs
  from overdue o
  left join links l on l.customer_name=o.customer_name
  left join merch m on m.store_id=l.store_id or (l.store_id is null and m.norm=normalize_arabic_name(o.customer_name))
  order by o.owed desc;
$function$;

create or replace function public.work_agent_overdue_candidates(
  p_min_days integer default 30,
  p_min_balance numeric default 0.5,
  p_limit integer default 500
)
returns table(customer_name text, store_name text, phone text, owed numeric, invoice_count bigint, oldest_due date)
language sql
stable security definer
set search_path to 'public','pg_temp'
as $function$
  with latest_snapshot as (
    select snapshot_id from public.merchants order by snapshot_date desc,uploaded_at desc limit 1
  ), debts as (
    select l.contact_name customer_name,sum(l.collectible_amount)::numeric owed,
      count(*) filter(where l.line_kind='invoice')::bigint invoice_count,min(l.due_date) oldest_due
    from public.customer_collectible_lines l
    where l.collectible_amount>=greatest(p_min_balance,0.01)
      and l.due_date<current_date-greatest(p_min_days,0)
    group by l.contact_name
  )
  select d.customer_name,coalesce(m.store_name,d.customer_name),public.norm_sa_phone(m.phone),
    d.owed,d.invoice_count,d.oldest_due
  from debts d
  left join public.customer_merchant_links l on l.customer_name=d.customer_name
  left join public.merchants m on m.store_id=l.store_id and m.snapshot_id=(select snapshot_id from latest_snapshot)
  order by d.owed desc,d.oldest_due
  limit least(greatest(p_limit,1),2000);
$function$;

create or replace function public.credit_stop_list(p_limit numeric default 10000,p_overdue integer default 30)
returns json
language sql
stable security definer
set search_path to 'public'
as $function$
  with latest_merch as (select snapshot_id from merchants order by uploaded_at desc limit 1),
  merch as (
    select store_id,store_name,phone,billing_type,status,wallet_balance,normalize_arabic_name(store_name) norm
    from merchants where snapshot_id=(select snapshot_id from latest_merch)
  ), links as (select customer_name,store_id from customer_merchant_links where store_id is not null),
  line_agg as (
    select contact_name,
      coalesce(sum(collectible_amount) filter(where age_days>p_overdue),0) overdue_amount,
      max(age_days) oldest_days,
      count(*) filter(where line_kind='invoice' and collectible_amount>0.5)::int inv_cnt
    from customer_collectible_lines where collectible_amount>0.005 group by contact_name
  ), per_cust as (
    select ar.contact_name customer_name,round(ar.collectible_due,2) total_open,
      round(coalesce(a.overdue_amount,0),2) overdue_amount,coalesce(a.oldest_days,0) oldest_days,coalesce(a.inv_cnt,0) inv_cnt
    from customer_ar ar left join line_agg a on a.contact_name=ar.contact_name where ar.collectible_due>0.5
  ), breached as (select * from per_cust where total_open>p_limit or oldest_days>p_overdue),
  joined as (
    select distinct on (b.customer_name) b.customer_name,b.total_open,b.overdue_amount,b.oldest_days,b.inv_cnt,
      m.store_id,m.store_name,m.phone,m.billing_type,m.status,round(coalesce(m.wallet_balance,0),2) wallet,
      (m.status='نشط') active,
      case when b.total_open>p_limit and b.oldest_days>p_overdue then 'both'
           when b.total_open>p_limit then 'over_limit' else 'overdue' end reason
    from breached b left join links l on l.customer_name=b.customer_name
    left join merch m on m.store_id=l.store_id or (l.store_id is null and m.norm=normalize_arabic_name(b.customer_name))
    order by b.customer_name,(l.store_id is not null) desc
  ), filtered as (select * from joined where coalesce(billing_type,'')<>'دفع مسبق')
  select json_build_object(
    'limit',p_limit,'overdue_days',p_overdue,
    'summary',(select json_build_object('count',count(*),'total',round(coalesce(sum(total_open),0),2),
      'active_count',count(*) filter(where active),'active_total',round(coalesce(sum(total_open) filter(where active),0),2)) from filtered),
    'rows',(select coalesce(json_agg(json_build_object(
      'customer_name',customer_name,'store_name',store_name,'store_id',store_id,'phone',phone,
      'billing_type',billing_type,'status',status,'active',active,'wallet',wallet,
      'total_open',total_open,'overdue_amount',overdue_amount,'oldest_days',oldest_days,
      'inv_cnt',inv_cnt,'reason',reason
    ) order by active desc,total_open desc),'[]') from filtered)
  );
$function$;

create or replace function public.collection_record_promise(p_task_id uuid,p_amount numeric,p_date date,p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare v_uid uuid:=(select auth.uid());v_task public.collection_tasks%rowtype;v_debt numeric;
begin
  if v_uid is null or not public.crm_has_permission('collections.record_promise') then raise exception 'not_allowed';end if;
  if p_amount is null or p_amount<=0 or p_date is null then raise exception 'invalid_promise';end if;
  select * into v_task from public.collection_tasks where id=p_task_id for update;
  if not found then raise exception 'task_not_found';end if;
  if v_task.assigned_to is distinct from v_uid and not public.collection_can_see_all() then raise exception 'not_owner';end if;
  select coalesce(collectible_due,0) into v_debt from public.customer_ar where contact_name=v_task.customer_name;
  v_debt:=coalesce(v_debt,v_task.debt_at_creation,0);
  if p_amount>v_debt+0.5 then raise exception 'promise_exceeds_collectible';end if;
  update public.collection_tasks set stage='promised',promise_amount=round(p_amount,2),promise_date=p_date,
    promise_status='pending',promised_at=now(),promise_baseline_debt=round(v_debt,2),
    promise_paid_amount=0,promise_verified_at=now(),honored_amount=null,
    notes=coalesce(nullif(btrim(p_notes),''),notes),updated_at=now()
  where id=p_task_id returning * into v_task;
  return to_jsonb(v_task);
end;
$function$;

create or replace function public.reconcile_collection_promises_internal()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare v_updated integer:=0;
begin
  with calc as (
    select t.id,coalesce(ar.collectible_due,0)::numeric current_debt,
      least(
        coalesce((select sum(p.amount) from public.zoho_payments p
          where p.customer_name=t.customer_name and p.date>=coalesce(t.promised_at,t.updated_at)::date),0),
        greatest(coalesce(t.promise_baseline_debt,t.debt_at_creation)-coalesce(ar.collectible_due,0),0)
      )::numeric verified_paid
    from public.collection_tasks t
    left join public.customer_ar ar on ar.contact_name=t.customer_name
    where t.stage='promised' and coalesce(t.promise_status,'pending') in ('pending','partial')
  )
  update public.collection_tasks t set
    promise_paid_amount=round(c.verified_paid,2),promise_verified_at=now(),
    promise_status=case when c.verified_paid>=greatest(coalesce(t.promise_amount,0)-0.5,0) then 'honored'
      when t.promise_date<current_date then 'broken' when c.verified_paid>0.5 then 'partial' else 'pending' end,
    honored_amount=case when c.verified_paid>=greatest(coalesce(t.promise_amount,0)-0.5,0)
      then round(c.verified_paid,2) else t.honored_amount end,
    stage=case when c.current_debt<=0.5 then 'done'
      when c.verified_paid>=greatest(coalesce(t.promise_amount,0)-0.5,0) then 'todo'
      when t.promise_date<current_date then 'contacted' else 'promised' end,
    done_at=case when c.current_debt<=0.5 then now() else t.done_at end,updated_at=now()
  from calc c where c.id=t.id;
  get diagnostics v_updated=row_count;
  return jsonb_build_object('checked',v_updated);
end;
$function$;

create or replace function public.refresh_collection_tasks()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid:=(select auth.uid());v_collectors uuid[];
  v_created int:=0;v_closed int:=0;v_cancelled int:=0;v_reassigned int:=0;v_promises jsonb;
begin
  if v_uid is null or not public.crm_has_permission('collections.regenerate') then raise exception 'not_allowed';end if;
  perform pg_advisory_xact_lock(hashtextextended('refresh_collection_tasks',0));
  v_promises:=public.reconcile_collection_promises_internal();
  update public.collection_tasks t set stage='done',done_at=now(),updated_at=now(),
    notes=concat_ws(' · ',nullif(t.notes,''),'أُغلقت تلقائياً: لا يوجد مبلغ مطلوب تحصيله بعد احتساب رصيد زوهو الدائن')
  where t.stage in ('todo','contacted','promised','snoozed') and t.trigger<>'manual'
    and not exists(select 1 from public.customer_ar ar where ar.contact_name=t.customer_name and ar.collectible_due>0.5);
  get diagnostics v_closed=row_count;
  update public.collection_tasks t set stage='cancelled',updated_at=now(),
    notes=concat_ws(' · ',nullif(t.notes,''),'استُبدلت تلقائياً بسبب تحصيل أعلى أولوية')
  from public.v_collection_candidates c
  where c.customer_name=t.customer_name and c.trigger is distinct from t.trigger
    and t.stage in ('todo','contacted','snoozed');
  get diagnostics v_cancelled=row_count;
  select array_agg(p.id order by p.id) into v_collectors from public.profiles p where p.role<>'admin'
    and coalesce((p.permissions->>'collections.update_stage')::boolean,false);
  if coalesce(cardinality(v_collectors),0)=0 then v_collectors:=array[v_uid];end if;
  with movable as (
    select t.id,row_number() over(order by c.priority_score desc,c.debt desc,t.created_at) rn
    from public.collection_tasks t join public.v_collection_candidates c on c.customer_name=t.customer_name
    left join public.profiles p on p.id=t.assigned_to
    where t.stage='todo' and t.updated_at<=t.created_at+interval '5 seconds'
      and (t.assigned_to is null or p.role='admin')
  )
  update public.collection_tasks t set assigned_to=v_collectors[((m.rn-1)%cardinality(v_collectors))+1],updated_at=now()
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
$function$;

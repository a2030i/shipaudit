-- Additive, read-only receivables work queue.
--
-- This RPC centralizes the existing customer_ar/customer_collectible_lines
-- read path and paginates operational rows on the server.  It deliberately
-- does not infer identity from names or phone numbers:
--   * finance grain is customer_ar.zoho_id
--   * Store 360 context is exposed only through an explicit
--     customer_merchant_links.store_id
--   * legacy name-keyed collection tasks are attached only when that name
--     identifies exactly one customer_ar row

create or replace function public.customer_receivables_work_queue(
  p_aging text[] default array[]::text[],
  p_search text default null,
  p_status text default 'all',
  p_owner text default 'all',
  p_collection text default 'all',
  p_promise text default 'all',
  p_contact text default 'all',
  p_action text default 'all',
  p_source text default 'all',
  p_min_amount numeric default null,
  p_max_amount numeric default null,
  p_sort text default 'amount',
  p_page integer default 1,
  p_page_size integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '2500ms'
as $function$
declare
  v_can_tasks boolean;
  v_can_assign boolean;
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 20), 1), 100);
  v_aging text[];
  v_search text := nullif(lower(btrim(coalesce(p_search, ''))), '');
begin
  if auth.uid() is null or not public.crm_has_permission('receivables.view') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  v_can_tasks := public.crm_has_permission('collections.view');
  v_can_assign := public.crm_has_permission('collections.assign');

  select coalesce(array_agg(distinct key order by key), array[]::text[])
  into v_aging
  from unnest(coalesce(p_aging, array[]::text[])) key
  where key = any(array['inv1_15','inv16_30','inv31_60','inv61_90','inv90p','opening']);

  return (
    with
    legacy_dashboard as materialized (
      select public.customer_money_dashboard()::jsonb payload
    ),
    latest_merchants as materialized (
      select m.store_id, m.store_name, m.phone, m.billing_type,
             m.status platform_status, m.wallet_balance, m.last_shipment_at,
             m.uploaded_at
      from public.merchants m
      where m.snapshot_id = (
        select snapshot_id from public.merchants order by uploaded_at desc limit 1
      )
    ),
    ar_name_cardinality as materialized (
      select a.contact_name, count(*)::integer row_count
      from public.customer_ar a
      group by a.contact_name
    ),
    ar_base as materialized (
      select a.*
      from public.customer_ar a
      where a.collectible_due > 0.5
        and nullif(btrim(a.zoho_id), '') is not null
    ),
    normalized_lines as materialized (
      select
        l.contact_id::text zoho_id,
        l.contact_name,
        case
          when l.line_kind = 'opening_balance'
            or (l.line_kind = 'invoice' and position('الرصيد الافتتاحي' in coalesce(l.invoice_number, '')) > 0)
            then 'opening_balance'
          else l.line_kind
        end effective_kind,
        l.line_id, l.invoice_number, l.due_date, l.line_date, l.status,
        l.collectible_amount, l.age_days
      from public.customer_collectible_lines l
      join ar_base a on a.zoho_id::text = l.contact_id::text
      where l.collectible_amount > 0.005
    ),
    line_agg as materialized (
      select
        l.zoho_id,
        round(sum(l.collectible_amount)::numeric, 2) all_lines_amount,
        round(coalesce(sum(l.collectible_amount) filter (
          where l.effective_kind = 'invoice' and l.age_days between 1 and 15
        ), 0)::numeric, 2) inv1_15,
        round(coalesce(sum(l.collectible_amount) filter (
          where l.effective_kind = 'invoice' and l.age_days between 16 and 30
        ), 0)::numeric, 2) inv16_30,
        round(coalesce(sum(l.collectible_amount) filter (
          where l.effective_kind = 'invoice' and l.age_days between 31 and 60
        ), 0)::numeric, 2) inv31_60,
        round(coalesce(sum(l.collectible_amount) filter (
          where l.effective_kind = 'invoice' and l.age_days between 61 and 90
        ), 0)::numeric, 2) inv61_90,
        round(coalesce(sum(l.collectible_amount) filter (
          where l.effective_kind = 'invoice' and l.age_days > 90
        ), 0)::numeric, 2) inv90p,
        round(coalesce(sum(l.collectible_amount) filter (
          where l.effective_kind = 'opening_balance'
        ), 0)::numeric, 2) opening,
        round(coalesce(sum(l.collectible_amount) filter (
          where l.effective_kind = 'opening_balance'
             or lower(coalesce(l.status, '')) = 'overdue'
        ), 0)::numeric, 2) overdue,
        max(l.age_days) oldest_days
      from normalized_lines l
      group by l.zoho_id
    ),
    selected_line_agg as materialized (
      select
        l.zoho_id,
        round(coalesce(sum(l.collectible_amount) filter (
          where cardinality(v_aging) = 0
             or ('inv1_15' = any(v_aging) and l.effective_kind = 'invoice' and l.age_days between 1 and 15)
             or ('inv16_30' = any(v_aging) and l.effective_kind = 'invoice' and l.age_days between 16 and 30)
             or ('inv31_60' = any(v_aging) and l.effective_kind = 'invoice' and l.age_days between 31 and 60)
             or ('inv61_90' = any(v_aging) and l.effective_kind = 'invoice' and l.age_days between 61 and 90)
             or ('inv90p' = any(v_aging) and l.effective_kind = 'invoice' and l.age_days > 90)
             or ('opening' = any(v_aging) and l.effective_kind = 'opening_balance')
        ), 0)::numeric, 2) amount,
        count(*) filter (
          where l.effective_kind = 'invoice' and (
            cardinality(v_aging) = 0
            or ('inv1_15' = any(v_aging) and l.age_days between 1 and 15)
            or ('inv16_30' = any(v_aging) and l.age_days between 16 and 30)
            or ('inv31_60' = any(v_aging) and l.age_days between 31 and 60)
            or ('inv61_90' = any(v_aging) and l.age_days between 61 and 90)
            or ('inv90p' = any(v_aging) and l.age_days > 90)
          )
        )::integer invoice_count,
        count(*) filter (
          where l.effective_kind = 'opening_balance'
            and (cardinality(v_aging) = 0 or 'opening' = any(v_aging))
        )::integer opening_count,
        max(l.age_days) filter (
          where cardinality(v_aging) = 0
             or ('inv1_15' = any(v_aging) and l.effective_kind = 'invoice' and l.age_days between 1 and 15)
             or ('inv16_30' = any(v_aging) and l.effective_kind = 'invoice' and l.age_days between 16 and 30)
             or ('inv31_60' = any(v_aging) and l.effective_kind = 'invoice' and l.age_days between 31 and 60)
             or ('inv61_90' = any(v_aging) and l.effective_kind = 'invoice' and l.age_days between 61 and 90)
             or ('inv90p' = any(v_aging) and l.effective_kind = 'invoice' and l.age_days > 90)
             or ('opening' = any(v_aging) and l.effective_kind = 'opening_balance')
        ) oldest_days,
        min(coalesce(l.due_date, l.line_date)) filter (
          where cardinality(v_aging) = 0
             or ('inv1_15' = any(v_aging) and l.effective_kind = 'invoice' and l.age_days between 1 and 15)
             or ('inv16_30' = any(v_aging) and l.effective_kind = 'invoice' and l.age_days between 16 and 30)
             or ('inv31_60' = any(v_aging) and l.effective_kind = 'invoice' and l.age_days between 31 and 60)
             or ('inv61_90' = any(v_aging) and l.effective_kind = 'invoice' and l.age_days between 61 and 90)
             or ('inv90p' = any(v_aging) and l.effective_kind = 'invoice' and l.age_days > 90)
             or ('opening' = any(v_aging) and l.effective_kind = 'opening_balance')
        ) oldest_due_date
      from normalized_lines l
      group by l.zoho_id
    ),
    explicit_store as materialized (
      select l.customer_name, l.store_id, m.store_name, m.phone, m.billing_type,
             m.platform_status, m.wallet_balance, m.last_shipment_at, m.uploaded_at
      from public.customer_merchant_links l
      left join latest_merchants m on m.store_id = l.store_id
      where l.store_id is not null
    ),
    ranked_tasks as materialized (
      select t.*,
             row_number() over (
               partition by t.customer_name
               order by case t.stage
                 when 'promised' then 4 when 'contacted' then 3
                 when 'snoozed' then 2 when 'todo' then 1 else 0 end desc,
                 t.updated_at desc nulls last, t.id
             ) task_rank
      from public.collection_tasks t
      join ar_name_cardinality nc on nc.contact_name = t.customer_name and nc.row_count = 1
      where v_can_tasks
        and t.stage in ('todo','contacted','promised','snoozed')
    ),
    last_pay as materialized (
      select distinct on (p.customer_id)
             p.customer_id::text zoho_id, p.date, p.amount
      from public.zoho_payments p
      where p.customer_id is not null
      order by p.customer_id, p.date desc, p.zoho_id desc
    ),
    normalized_store as materialized (
      select s.*,
        case
          when regexp_replace(coalesce(s.phone,''), '\\D', '', 'g') like '00966%'
            then substring(regexp_replace(coalesce(s.phone,''), '\\D', '', 'g') from 3)
          when regexp_replace(coalesce(s.phone,''), '\\D', '', 'g') like '05%'
            then '966' || substring(regexp_replace(coalesce(s.phone,''), '\\D', '', 'g') from 2)
          when length(regexp_replace(coalesce(s.phone,''), '\\D', '', 'g')) = 9
            and regexp_replace(coalesce(s.phone,''), '\\D', '', 'g') like '5%'
            then '966' || regexp_replace(coalesce(s.phone,''), '\\D', '', 'g')
          else regexp_replace(coalesce(s.phone,''), '\\D', '', 'g')
        end phone_normalized
      from explicit_store s
    ),
    latest_communication as materialized (
      select distinct on (phone_normalized)
        phone_normalized, sent_at last_sent_at, status last_status,
        template_name last_template, delivered_at, read_at, replied_at
      from (
        select w.*,
          case
            when regexp_replace(coalesce(w.phone,''), '\\D', '', 'g') like '00966%'
              then substring(regexp_replace(coalesce(w.phone,''), '\\D', '', 'g') from 3)
            when regexp_replace(coalesce(w.phone,''), '\\D', '', 'g') like '05%'
              then '966' || substring(regexp_replace(coalesce(w.phone,''), '\\D', '', 'g') from 2)
            when length(regexp_replace(coalesce(w.phone,''), '\\D', '', 'g')) = 9
              and regexp_replace(coalesce(w.phone,''), '\\D', '', 'g') like '5%'
              then '966' || regexp_replace(coalesce(w.phone,''), '\\D', '', 'g')
            else regexp_replace(coalesce(w.phone,''), '\\D', '', 'g')
          end phone_normalized
        from public.whatsapp_campaign_sends w
      ) w
      where phone_normalized <> ''
      order by phone_normalized, sent_at desc nulls last, id desc
    ),
    sadad_phones as materialized (
      select distinct
        case
          when regexp_replace(coalesce(w.phone,''), '\\D', '', 'g') like '00966%'
            then substring(regexp_replace(coalesce(w.phone,''), '\\D', '', 'g') from 3)
          when regexp_replace(coalesce(w.phone,''), '\\D', '', 'g') like '05%'
            then '966' || substring(regexp_replace(coalesce(w.phone,''), '\\D', '', 'g') from 2)
          when length(regexp_replace(coalesce(w.phone,''), '\\D', '', 'g')) = 9
            and regexp_replace(coalesce(w.phone,''), '\\D', '', 'g') like '5%'
            then '966' || regexp_replace(coalesce(w.phone,''), '\\D', '', 'g')
          else regexp_replace(coalesce(w.phone,''), '\\D', '', 'g')
        end phone_normalized
      from public.whatsapp_campaign_sends w
      where w.template_name = 'sadad'
    ),
    integrity as materialized (
      select i.zoho_id::text, i.balance_sync_gap, i.balance_sync_overage,
             i.balance_integrity_status
      from public.customer_balance_integrity_issues i
      where i.zoho_id is not null
    ),
    base_rows as materialized (
      select
        a.zoho_id::text zoho_id,
        a.contact_name,
        s.store_id, s.store_name, s.phone, s.phone_normalized,
        s.billing_type, s.platform_status, s.wallet_balance, s.last_shipment_at,
        round(a.total_due::numeric, 2) gross_due,
        round(a.credit_offset::numeric, 2) credit_offset,
        round(a.collectible_due::numeric, 2) collectible_due,
        round(coalesce(la.overdue, 0)::numeric, 2) overdue,
        round(coalesce(la.inv1_15, 0)::numeric, 2) inv1_15,
        round(coalesce(la.inv16_30, 0)::numeric, 2) inv16_30,
        round(coalesce(la.inv31_60, 0)::numeric, 2) inv31_60,
        round(coalesce(la.inv61_90, 0)::numeric, 2) inv61_90,
        round(coalesce(la.inv90p, 0)::numeric, 2) inv90p,
        round(coalesce(la.opening, 0)::numeric, 2) opening,
        round(coalesce(sa.amount, 0)::numeric, 2) selected_amount,
        coalesce(sa.invoice_count, 0) selected_invoice_count,
        coalesce(sa.opening_count, 0) selected_opening_count,
        coalesce(sa.oldest_days, 0) selected_oldest_days,
        sa.oldest_due_date,
        lp.date last_payment_date, round(coalesce(lp.amount, 0)::numeric, 2) last_payment_amount,
        t.id task_id, t.stage task_stage, t.assigned_to, t.promise_amount,
        t.promise_date, t.promise_status, t.snooze_until, t.updated_at task_updated_at,
        case when v_can_assign then p.name else null end assignee_name,
        lc.last_sent_at, lc.last_status, lc.last_template,
        (lc.delivered_at is not null) communication_delivered,
        (lc.read_at is not null) communication_read,
        (lc.replied_at is not null) communication_replied,
        (sp.phone_normalized is not null) sadad_sent,
        (i.zoho_id is not null) balance_sync_issue,
        round(coalesce(i.balance_sync_gap, 0)::numeric, 2) balance_sync_gap,
        round(coalesce(i.balance_sync_overage, 0)::numeric, 2) balance_sync_overage,
        case
          when s.store_id is null then 'unlinked'
          when s.store_name is null then 'store_not_in_latest_snapshot'
          else 'resolved'
        end store_link_status,
        case
          when lower(coalesce(s.platform_status,'')) in ('active','نشط') then 'active'
          when lower(coalesce(s.platform_status,'')) in ('inactive','غير نشط') then 'inactive'
          else 'unknown'
        end platform_status_key
      from ar_base a
      join selected_line_agg sa on sa.zoho_id = a.zoho_id::text
      left join line_agg la on la.zoho_id = a.zoho_id::text
      left join normalized_store s on s.customer_name = a.contact_name
      left join ranked_tasks t on t.customer_name = a.contact_name and t.task_rank = 1
      left join public.profiles p on p.id = t.assigned_to
      left join last_pay lp on lp.zoho_id = a.zoho_id::text
      left join latest_communication lc on lc.phone_normalized = s.phone_normalized
      left join sadad_phones sp on sp.phone_normalized = s.phone_normalized
      left join integrity i on i.zoho_id = a.zoho_id::text
      where coalesce(sa.amount, 0) > 0.005
    ),
    filtered as materialized (
      select b.*,
        case
          when b.task_id is null then true
          when b.assigned_to is null then true
          when b.task_stage <> 'snoozed' then true
          when b.snooze_until is null then true
          else b.snooze_until <= now()
        end needs_action
      from base_rows b
      where (v_search is null or lower(coalesce(b.contact_name,'')) like '%' || v_search || '%'
          or lower(coalesce(b.store_name,'')) like '%' || v_search || '%'
          or lower(coalesce(b.store_id,'')) like '%' || v_search || '%'
          or lower(coalesce(b.zoho_id,'')) like '%' || v_search || '%')
        and (coalesce(p_status,'all') = 'all' or b.platform_status_key = p_status)
        and (p_min_amount is null or b.selected_amount >= p_min_amount)
        and (p_max_amount is null or b.selected_amount <= p_max_amount)
        and (not v_can_tasks or coalesce(p_owner,'all') = 'all'
          or (p_owner = 'unassigned' and b.assigned_to is null)
          or b.assigned_to::text = p_owner)
        and (not v_can_tasks or coalesce(p_collection,'all') = 'all'
          or (p_collection = 'no_task' and b.task_id is null)
          or b.task_stage = p_collection)
        and (not v_can_tasks or coalesce(p_promise,'all') = 'all'
          or (p_promise = 'today' and b.promise_date = current_date)
          or (p_promise = 'overdue' and b.promise_date < current_date)
          or (p_promise = 'none' and b.promise_date is null))
        and (coalesce(p_contact,'all') = 'all'
          or (p_contact = 'none' and b.last_sent_at is null)
          or (p_contact = '7d' and b.last_sent_at >= now() - interval '7 days')
          or (p_contact = '30d' and b.last_sent_at >= now() - interval '30 days'))
        and (coalesce(p_action,'all') <> 'needed' or
          b.task_id is null or b.assigned_to is null or b.task_stage <> 'snoozed'
          or b.snooze_until is null or b.snooze_until <= now())
        and (coalesce(p_source,'all') <> 'unclaimed'
          or (b.phone_normalized <> '' and not b.sadad_sent))
    ),
    ranked as materialized (
      select f.*,
        row_number() over (order by
          case when p_sort = 'oldest' then f.selected_oldest_days end desc nulls last,
          case when p_sort = 'promise' then f.promise_date end asc nulls last,
          case when p_sort = 'last_contact' then f.last_sent_at end desc nulls last,
          case when coalesce(p_sort,'amount') in ('amount','owed') then f.selected_amount end desc nulls last,
          f.zoho_id
        ) result_row
      from filtered f
    ),
    page_rows as materialized (
      select * from ranked
      where result_row > (v_page - 1) * v_page_size
        and result_row <= v_page * v_page_size
      order by result_row
    ),
    invoice_summary as materialized (
      select
        round(coalesce(sum(balance) filter (
          where lower(coalesce(status,'')) not in ('paid','void','cancelled','canceled','draft')
            and balance > 0.005
        ), 0)::numeric, 2) unpaid,
        round(coalesce(sum(balance) filter (
          where lower(coalesce(status,'')) = 'draft' and balance > 0.005
        ), 0)::numeric, 2) draft,
        count(*) filter (
          where lower(coalesce(status,'')) = 'draft' and balance > 0.005
        )::integer draft_count,
        max(synced_at) data_as_of
      from public.zoho_invoices
    ),
    platform_counts as materialized (
      select platform_status_key, count(*)::integer count from base_rows group by platform_status_key
    ),
    totals as materialized (
      select count(*)::integer total_rows,
             round(coalesce(sum(selected_amount), 0)::numeric, 2) total_amount
      from filtered
    ),
    source_times as materialized (
      select
        (select max(synced_at) from public.zoho_invoices) zoho_as_of,
        (select max(uploaded_at) from public.merchants) merchants_as_of,
        (select max(updated_at) from public.collection_tasks) tasks_as_of,
        (select max(sent_at) from public.whatsapp_campaign_sends) communications_as_of
    ),
    assignee_rows as materialized (
      select p.id, p.name, p.email,
        count(t.id) filter (where t.stage in ('todo','contacted','promised','snoozed'))::integer open_tasks
      from public.profiles p
      left join public.collection_tasks t on t.assigned_to = p.id
      where v_can_assign
        and p.role <> 'admin'
        and coalesce((p.permissions ->> 'collections.view')::boolean, false)
        and coalesce((p.permissions ->> 'collections.update_stage')::boolean, false)
      group by p.id, p.name, p.email
    ),
    assignees as materialized (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'email', c.email,
        'openTasks', c.open_tasks
      ) order by c.open_tasks, c.name), '[]'::jsonb) value
      from assignee_rows c
    )
    select jsonb_build_object(
      'contractVersion', 1,
      'generatedAt', now(),
      'summary',
        ((select payload - 'customers' from legacy_dashboard)
          || jsonb_build_object(
            'zohoUnpaidInvoices', (select unpaid from invoice_summary),
            'zohoDraftOutstanding', (select draft from invoice_summary),
            'zohoDraftCount', (select draft_count from invoice_summary),
            'campaignAging', jsonb_build_object(
              'inv1_15', coalesce((select round(sum(inv1_15)::numeric,2) from line_agg),0),
              'inv16_30', coalesce((select round(sum(inv16_30)::numeric,2) from line_agg),0),
              'inv31_60', coalesce((select round(sum(inv31_60)::numeric,2) from line_agg),0),
              'inv61_90', coalesce((select round(sum(inv61_90)::numeric,2) from line_agg),0),
              'inv90p', coalesce((select round(sum(inv90p)::numeric,2) from line_agg),0),
              'opening', coalesce((select round(sum(opening)::numeric,2) from line_agg),0)
            ),
            'platformCounts', jsonb_build_object(
              'all', (select count(*) from base_rows),
              'active', coalesce((select count from platform_counts where platform_status_key='active'),0),
              'inactive', coalesce((select count from platform_counts where platform_status_key='inactive'),0),
              'unknown', coalesce((select count from platform_counts where platform_status_key='unknown'),0)
            ),
            'unclaimedCount', (select count(*) from base_rows where phone_normalized <> '' and not sadad_sent),
            'balanceSyncIssueCount', (select count(*) from integrity),
            'balanceSyncGapTotal', coalesce((select round(sum(greatest(balance_sync_gap,balance_sync_overage))::numeric,2) from integrity),0)
          )),
      'page', jsonb_build_object(
        'number', v_page,
        'size', v_page_size,
        'totalRows', (select total_rows from totals),
        'totalPages', greatest(1, ceil((select total_rows from totals)::numeric / v_page_size)::integer),
        'totalAmount', (select total_amount from totals),
        'sliceTotal', coalesce((select round(sum(selected_amount)::numeric, 2) from base_rows), 0),
        'rows', coalesce((select jsonb_agg(jsonb_build_object(
          'identityKey', case when store_id is not null then 'store:' || store_id else 'zoho:' || zoho_id end,
          'customer', jsonb_build_object(
            'name', contact_name, 'zohoId', zoho_id,
            'storeId', store_id, 'storeName', store_name, 'phone', phone,
            'billingType', billing_type, 'platformStatus', platform_status,
            'walletBalance', coalesce(wallet_balance,0), 'lastShipmentAt', last_shipment_at,
            'grossDue', gross_due, 'creditOffset', credit_offset,
            'owed', collectible_due, 'overdue', overdue,
            'invCnt', selected_invoice_count, 'oldestDays', selected_oldest_days,
            'inv1_15', inv1_15, 'inv16_30', inv16_30,
            'inv31_60', inv31_60, 'inv61_90', inv61_90,
            'inv90p', inv90p, 'opening', opening,
            'lastPaymentDate', last_payment_date, 'lastPaymentAmount', last_payment_amount,
            'balanceSyncIssue', balance_sync_issue,
            'balanceSyncGap', balance_sync_gap, 'balanceSyncOverage', balance_sync_overage,
            'storeLinkStatus', store_link_status
          ),
          'summary', jsonb_build_object(
            'amount', selected_amount, 'invoiceCount', selected_invoice_count,
            'openingCount', selected_opening_count, 'oldestDays', selected_oldest_days,
            'oldestDueDate', oldest_due_date
          ),
          'task', case when v_can_tasks and task_id is not null then jsonb_build_object(
            'id', task_id, 'stage', task_stage, 'assigned_to', assigned_to,
            'promise_amount', promise_amount, 'promise_date', promise_date,
            'promise_status', promise_status, 'snooze_until', snooze_until,
            'updated_at', task_updated_at
          ) else null end,
          'assignee', case when v_can_tasks then coalesce(assignee_name,'') else null end,
          'lastCommunicationAt', last_sent_at,
          'communication', case when last_sent_at is null then null else jsonb_build_object(
            'status', last_status, 'template', last_template,
            'delivered', communication_delivered, 'read', communication_read,
            'replied', communication_replied
          ) end,
          'needsAction', needs_action,
          'nextAction', case
            when task_id is null then 'إنشاء مهمة تحصيل'
            when assigned_to is null then 'إسناد لمحصل'
            when task_stage = 'promised' and promise_date < current_date then 'متابعة وعد متأخر'
            when task_stage = 'promised' and promise_date = current_date then 'تحقق من وعد اليوم'
            when task_stage = 'promised' then 'متابعة الوعد'
            when task_stage = 'snoozed' then 'متابعة بعد التأجيل'
            when task_stage = 'contacted' then 'تسجيل نتيجة التواصل'
            else 'بدء التواصل' end,
          'reason', case
            when cardinality(v_aging)=0 then 'لديه مبلغ مستحق قابل للتحصيل'
            else 'دخل الشرائح المحددة · ' || selected_invoice_count || ' فاتورة'
              || case when selected_opening_count > 0 then ' + رصيد افتتاحي' else '' end
            end
        ) order by result_row) from page_rows), '[]'::jsonb)
      ),
      'permissions', jsonb_build_object(
        'receivables', true, 'collections', v_can_tasks, 'assign', v_can_assign
      ),
      'assignees', coalesce((select value from assignees), '[]'::jsonb),
      'sources', (select jsonb_build_object(
        'finance', jsonb_build_object(
          'name','customer_ar + customer_collectible_lines',
          'dataAsOf', zoho_as_of,
          'freshnessStatus', case when zoho_as_of is null then 'failed'
            when zoho_as_of >= now()-interval '1 hour' then 'fresh'
            when zoho_as_of >= now()-interval '24 hours' then 'delayed' else 'stale' end),
        'stores', jsonb_build_object('name','merchants latest snapshot','dataAsOf',merchants_as_of,
          'freshnessStatus',case when merchants_as_of is null then 'failed'
            when merchants_as_of >= now()-interval '24 hours' then 'fresh'
            when merchants_as_of >= now()-interval '72 hours' then 'delayed' else 'stale' end),
        'collections', jsonb_build_object('name','collection_tasks','dataAsOf',tasks_as_of,
          'freshnessStatus',case when not v_can_tasks then 'restricted'
            when tasks_as_of is null then 'empty' else 'fresh' end),
        'communications', jsonb_build_object('name','whatsapp_campaign_sends','dataAsOf',communications_as_of,
          'freshnessStatus',case when communications_as_of is null then 'empty' else 'fresh' end)
      ) from source_times),
      'identity', jsonb_build_object(
        'unlinkedRows', (select count(*) from base_rows where store_link_status='unlinked'),
        'missingLatestStoreRows', (select count(*) from base_rows where store_link_status='store_not_in_latest_snapshot'),
        'ambiguousTaskRows', (select count(*) from public.collection_tasks t
          where (select count(*) from public.customer_ar a where a.contact_name=t.customer_name) <> 1),
        'phoneUsedForIdentity', false,
        'nameUsedForFinancialIdentity', false
      )
    )
  );
end;
$function$;

comment on function public.customer_receivables_work_queue(
  text[], text, text, text, text, text, text, text, text,
  numeric, numeric, text, integer, integer
) is 'Read-only, permission-aware and server-paginated receivables work queue. Financial identity is Zoho ID; Store 360 context requires an explicit customer_merchant_links.store_id.';

revoke all on function public.customer_receivables_work_queue(
  text[], text, text, text, text, text, text, text, text,
  numeric, numeric, text, integer, integer
) from public, anon;
grant execute on function public.customer_receivables_work_queue(
  text[], text, text, text, text, text, text, text, text,
  numeric, numeric, text, integer, integer
) to authenticated, service_role;

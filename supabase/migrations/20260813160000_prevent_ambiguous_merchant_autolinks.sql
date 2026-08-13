-- A store name is not an identity. The latest Lamha directory can contain
-- multiple stores with the same display name but different store_id and
-- billing type. Automatic matching must not pick an arbitrary row in that
-- situation; it must leave the customer for an explicit store-id link.

create or replace function public.bulk_match_customers(
  p_names text[],
  p_threshold numeric default 0.78
)
returns table(
  customer_name text,
  store_id text,
  store_name text,
  confidence numeric,
  method text
)
language sql
stable
set search_path to 'public'
as $function$
  with latest_snapshot as (
    select snapshot_id
    from public.merchants
    order by uploaded_at desc
    limit 1
  ),
  segs as (
    select
      n as customer_name,
      public.normalize_arabic_name(seg) as nseg
    from unnest(p_names) as n
    cross join lateral regexp_split_to_table(n, '[-|]') as seg
    where length(public.normalize_arabic_name(seg)) >= 2
  ),
  candidates as (
    select
      s.customer_name,
      s.nseg,
      m.store_id,
      m.store_name,
      public.normalize_arabic_name(m.store_name) as nname
    from segs s
    cross join lateral (
      select store_id, store_name
      from public.merchants m
      where m.snapshot_id = (select snapshot_id from latest_snapshot)
        and public.normalize_arabic_name(m.store_name) % s.nseg
      order by similarity(public.normalize_arabic_name(m.store_name), s.nseg) desc
      limit 8
    ) as m
  ),
  scored as (
    select
      c.customer_name,
      c.store_id,
      c.store_name,
      case
        when c.nseg = c.nname then 1.0
        when length(c.nseg) >= 3 and (
          c.nseg like '%' || c.nname || '%'
          or c.nname like '%' || c.nseg || '%'
        ) then least(length(c.nseg), length(c.nname))::numeric
             / greatest(length(c.nseg), length(c.nname))::numeric
        else similarity(c.nseg, c.nname)::numeric
      end as confidence,
      case when c.nseg = c.nname then 'auto-exact' else 'auto-fuzzy' end as method
    from candidates c
  ),
  per_store as (
    select
      customer_name,
      store_id,
      max(store_name) as store_name,
      max(confidence) as confidence,
      case when bool_or(method = 'auto-exact') then 'auto-exact' else 'auto-fuzzy' end as method
    from scored
    group by customer_name, store_id
  ),
  ranked as (
    select
      p.*,
      row_number() over (
        partition by customer_name
        order by confidence desc, (method = 'auto-exact') desc, store_id
      ) as candidate_rank,
      lead(confidence) over (
        partition by customer_name
        order by confidence desc, (method = 'auto-exact') desc, store_id
      ) as runner_up_confidence
    from per_store p
  )
  select
    customer_name,
    store_id,
    store_name,
    round(confidence, 2),
    method
  from ranked
  where candidate_rank = 1
    and confidence >= p_threshold
    -- Equal or near-equal store candidates are ambiguous. Five percentage
    -- points is deliberately conservative because this mapping drives money
    -- collection, suspension and activation decisions.
    and (runner_up_confidence is null or confidence - runner_up_confidence >= 0.05);
$function$;

-- These two links were verified against the latest Lamha snapshot, store IDs,
-- phones, billing types and the corresponding Zoho customer ledgers. Marking
-- them manual protects them from future automatic re-matching.
update public.customer_merchant_links
set match_method = 'manual', confidence = 1.00, linked_at = now()
where (customer_name = 'مشاري سعد نجيب عبد العال - مختلفٌ' and store_id = '1961')
   or (customer_name = 'حبيب سعد نجيب عبد العال - مختلفٌ' and store_id = '654');


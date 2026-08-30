-- External campaign audiences are phone-unique and must never contain a
-- customer present in Lamha's latest merchant directory.
-- Every removed lead and its history are archived before deletion.

create table if not exists public.crm_lead_cleanup_archive (
  archive_id bigint generated always as identity primary key,
  lead_id uuid not null,
  reason text not null check (reason in ('duplicate_phone', 'lamha_customer')),
  phone_normalized text,
  lead_payload jsonb not null,
  history_payload jsonb not null default '[]'::jsonb,
  archived_at timestamptz not null default now(),
  unique (lead_id, reason)
);

comment on table public.crm_lead_cleanup_archive is
  'Recoverable archive for external CRM leads removed as duplicate phones or current Lamha customers.';

alter table public.crm_lead_cleanup_archive enable row level security;
revoke all on table public.crm_lead_cleanup_archive from public, anon, authenticated;
grant all on table public.crm_lead_cleanup_archive to service_role;
grant usage, select on sequence public.crm_lead_cleanup_archive_archive_id_seq to service_role;

with latest_snapshot as (
  select snapshot_id
  from public.merchants
  order by uploaded_at desc nulls last
  limit 1
),
lamha_phones as (
  select distinct public.norm_sa_phone(m.phone) as phone_normalized
  from public.merchants m
  where m.snapshot_id = (select snapshot_id from latest_snapshot)
    and public.norm_sa_phone(m.phone) is not null
),
targets as (
  select l.*
  from public.crm_leads l
  join lamha_phones p on p.phone_normalized = l.phone_normalized
  where l.source in ('external_directory', 'campaign_excel')
)
insert into public.crm_lead_cleanup_archive (
  lead_id, reason, phone_normalized, lead_payload, history_payload
)
select
  t.id,
  'lamha_customer',
  t.phone_normalized,
  to_jsonb(t),
  coalesce((
    select jsonb_agg(to_jsonb(h) order by h.created_at, h.id)
    from public.crm_lead_history h
    where h.lead_id = t.id
  ), '[]'::jsonb)
from targets t
on conflict (lead_id, reason) do nothing;

with latest_snapshot as (
  select snapshot_id
  from public.merchants
  order by uploaded_at desc nulls last
  limit 1
),
lamha_phones as (
  select distinct public.norm_sa_phone(m.phone) as phone_normalized
  from public.merchants m
  where m.snapshot_id = (select snapshot_id from latest_snapshot)
    and public.norm_sa_phone(m.phone) is not null
)
delete from public.crm_leads l
using lamha_phones p
where l.source in ('external_directory', 'campaign_excel')
  and l.phone_normalized = p.phone_normalized;

-- Keep one operationally strongest/richest row for each phone.
create temporary table crm_duplicate_lead_targets on commit drop as
with ranked as (
  select
    l.id,
    row_number() over (
      partition by l.phone_normalized
      order by
        (coalesce(l.status, 'new') not in ('new', 'existing_customer')) desc,
        (l.owner_id is not null) desc,
        (coalesce(l.contact_attempts, 0) > 0) desc,
        (l.last_touch_at is not null) desc,
        (
          (l.email is not null)::int +
          (l.city is not null)::int +
          (l.category is not null)::int +
          (l.website is not null)::int +
          (l.store_url is not null)::int +
          (l.address is not null)::int
        ) desc,
        l.updated_at desc nulls last,
        l.created_at asc nulls last,
        l.id
    ) as row_rank
  from public.crm_leads l
  where l.source in ('external_directory', 'campaign_excel')
    and nullif(btrim(l.phone_normalized), '') is not null
)
select id from ranked where row_rank > 1;

insert into public.crm_lead_cleanup_archive (
  lead_id, reason, phone_normalized, lead_payload, history_payload
)
select
  l.id,
  'duplicate_phone',
  l.phone_normalized,
  to_jsonb(l),
  coalesce((
    select jsonb_agg(to_jsonb(h) order by h.created_at, h.id)
    from public.crm_lead_history h
    where h.lead_id = l.id
  ), '[]'::jsonb)
from public.crm_leads l
join crm_duplicate_lead_targets t on t.id = l.id
on conflict (lead_id, reason) do nothing;

delete from public.crm_leads l
using crm_duplicate_lead_targets t
where l.id = t.id;

update public.crm_leads
set duplicate_key = null,
    duplicate_count = 1,
    duplicate_names = '{}'::text[]
where source in ('external_directory', 'campaign_excel')
  and (
    duplicate_key is not null
    or duplicate_count <> 1
    or cardinality(duplicate_names) <> 0
  );

drop index if exists public.ux_crm_leads_snap_phone_name;
drop index if exists public.ix_crm_leads_phone_norm;

create unique index if not exists ux_crm_file_leads_phone
  on public.crm_leads (phone_normalized)
  where source in ('external_directory', 'campaign_excel')
    and nullif(btrim(phone_normalized), '') is not null;

create index if not exists ix_crm_leads_phone_norm
  on public.crm_leads (phone_normalized)
  where phone_normalized is not null;

create index if not exists ix_merchants_snapshot_phone_norm
  on public.merchants (snapshot_id, public.norm_sa_phone(phone))
  where phone is not null;

-- A store becoming a Lamha customer later must leave the external audience.
create or replace function private.crm_remove_leads_for_new_lamha_merchants()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.crm_lead_cleanup_archive (
    lead_id, reason, phone_normalized, lead_payload, history_payload
  )
  select
    l.id,
    'lamha_customer',
    l.phone_normalized,
    to_jsonb(l),
    coalesce((
      select jsonb_agg(to_jsonb(h) order by h.created_at, h.id)
      from public.crm_lead_history h
      where h.lead_id = l.id
    ), '[]'::jsonb)
  from public.crm_leads l
  where l.source in ('external_directory', 'campaign_excel')
    and exists (
      select 1
      from new_lamha_merchants m
      where public.norm_sa_phone(m.phone) = l.phone_normalized
    )
  on conflict (lead_id, reason) do nothing;

  delete from public.crm_leads l
  where l.source in ('external_directory', 'campaign_excel')
    and exists (
      select 1
      from new_lamha_merchants m
      where public.norm_sa_phone(m.phone) = l.phone_normalized
    );

  return null;
end;
$$;

revoke all on function private.crm_remove_leads_for_new_lamha_merchants()
  from public, anon, authenticated;

drop trigger if exists crm_remove_leads_for_new_lamha_merchants on public.merchants;
create trigger crm_remove_leads_for_new_lamha_merchants
after insert on public.merchants
referencing new table as new_lamha_merchants
for each statement
execute function private.crm_remove_leads_for_new_lamha_merchants();

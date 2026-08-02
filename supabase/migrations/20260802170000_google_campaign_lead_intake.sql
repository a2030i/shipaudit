-- Google campaign leads -> ShipAudit CRM. This workflow MUST NOT create or
-- update Zoho contacts. Zoho customer creation remains owned by the platform.

alter table public.profiles
  add column if not exists lead_notification_phone text,
  add column if not exists accepts_campaign_leads boolean not null default false,
  add column if not exists last_campaign_lead_assigned_at timestamptz;

create table if not exists public.campaign_lead_inbox (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'google_sheets',
  external_event_id text not null,
  payload_hash text not null,
  payload jsonb not null,
  status text not null default 'received'
    check (status in ('received','created','duplicate','failed')),
  lead_id uuid references public.crm_leads(id) on delete set null,
  assigned_to uuid references public.profiles(id) on delete set null,
  notification_status text not null default 'pending'
    check (notification_status in ('pending','sent','skipped','failed')),
  notification_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (source, external_event_id)
);

create index if not exists campaign_lead_inbox_status_idx
  on public.campaign_lead_inbox(status, received_at desc);

alter table public.campaign_lead_inbox enable row level security;
revoke all on table public.campaign_lead_inbox from public, anon, authenticated;
grant select, insert, update on table public.campaign_lead_inbox to service_role;

create or replace function public.ingest_google_campaign_lead(
  p_external_event_id text,
  p_payload_hash text,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.campaign_lead_inbox%rowtype;
  v_lead public.crm_leads%rowtype;
  v_owner public.profiles%rowtype;
  v_name text := nullif(btrim(coalesce(p_payload->>'name', p_payload->>'الاسم', '')), '');
  v_phone text := regexp_replace(coalesce(p_payload->>'phone', p_payload->>'الجوال', p_payload->>'رقم الجوال', ''), '\D', '', 'g');
  v_campaign text := nullif(btrim(coalesce(p_payload->>'campaign_name', p_payload->>'campaign', p_payload->>'اسم الحملة', '')), '');
  v_city text := nullif(btrim(coalesce(p_payload->>'city', p_payload->>'المدينة', '')), '');
  v_email text := nullif(btrim(coalesce(p_payload->>'email', p_payload->>'البريد الإلكتروني', '')), '');
  v_category text := nullif(btrim(coalesce(p_payload->>'category', p_payload->>'activity', p_payload->>'النشاط', '')), '');
begin
  if nullif(btrim(coalesce(p_external_event_id, '')), '') is null then
    raise exception 'external_event_id_required';
  end if;
  if v_name is null or v_phone = '' then raise exception 'name_and_phone_required'; end if;
  if left(v_phone, 2) = '00' then v_phone := substr(v_phone, 3); end if;
  if left(v_phone, 3) <> '966' and length(v_phone) = 10 and left(v_phone, 2) = '05' then
    v_phone := '966' || substr(v_phone, 2);
  elsif left(v_phone, 3) <> '966' and length(v_phone) = 9 and left(v_phone, 1) = '5' then
    v_phone := '966' || v_phone;
  end if;
  if v_phone !~ '^9665[0-9]{8}$' then raise exception 'invalid_sa_phone'; end if;

  insert into public.campaign_lead_inbox(source, external_event_id, payload_hash, payload)
  values ('google_sheets', btrim(p_external_event_id), p_payload_hash, p_payload)
  on conflict (source, external_event_id) do nothing
  returning * into v_event;

  if v_event.id is null then
    select * into v_event from public.campaign_lead_inbox
    where source='google_sheets' and external_event_id=btrim(p_external_event_id);
    return jsonb_build_object('ok', true, 'duplicate_event', true, 'inbox_id', v_event.id,
      'lead_id', v_event.lead_id, 'status', v_event.status, 'notification_status', v_event.notification_status);
  end if;

  -- Serialize round-robin selection and assignment.
  perform pg_advisory_xact_lock(hashtext('google_campaign_lead_assignment'));

  select * into v_lead from public.crm_leads
  where phone_normalized = v_phone
    and lead_kind = 'inbound'
    and status not in ('converted','activated','lost','existing_customer')
  order by received_at desc limit 1;

  if v_lead.id is not null then
    update public.campaign_lead_inbox set status='duplicate', lead_id=v_lead.id,
      assigned_to=v_lead.owner_id, notification_status='skipped', processed_at=now()
    where id=v_event.id;
    return jsonb_build_object('ok', true, 'duplicate_lead', true, 'inbox_id', v_event.id,
      'lead_id', v_lead.id, 'assigned_to', v_lead.owner_id);
  end if;

  select p.* into v_owner from public.profiles p
  where p.accepts_campaign_leads = true
    and nullif(btrim(p.lead_notification_phone), '') is not null
    and (p.role='admin' or coalesce((p.permissions->>'sales.external_leads')::boolean,false)
         or coalesce((p.permissions->>'sales.manage')::boolean,false))
  order by p.last_campaign_lead_assigned_at asc nulls first, p.created_at asc
  limit 1;

  insert into public.crm_leads(
    name, name_normalized, phone, phone_normalized, whatsapp, whatsapp_normalized,
    email, city, category, source, source_channel, lead_kind, campaign_name,
    campaign_meta, raw_payload, snapshot_id, status, owner_id, received_at,
    first_response_due_at
  ) values (
    v_name, lower(v_name), v_phone, v_phone, v_phone, v_phone,
    v_email, v_city, v_category, 'google_campaign', 'google_sheets', 'inbound', v_campaign,
    jsonb_strip_nulls(jsonb_build_object(
      'utm_source', p_payload->>'utm_source', 'utm_medium', p_payload->>'utm_medium',
      'utm_campaign', p_payload->>'utm_campaign', 'utm_content', p_payload->>'utm_content',
      'utm_term', p_payload->>'utm_term', 'google_event_id', p_external_event_id,
      'expected_shipments', coalesce(p_payload->>'expected_shipments', p_payload->>'عدد الشحنات المتوقع')
    )), p_payload, 'google:' || btrim(p_external_event_id), 'new', v_owner.id, now(), now() + interval '15 minutes'
  ) returning * into v_lead;

  if v_owner.id is not null then
    update public.profiles set last_campaign_lead_assigned_at=now() where id=v_owner.id;
    insert into public.crm_tasks(entity_type, entity_ref, title, kind, due_at, priority, assigned_to)
    values ('lead', v_lead.id::text, 'التواصل الأول مع عميل الحملة', 'first_contact',
      v_lead.first_response_due_at, 'high', v_owner.id);
  end if;

  update public.campaign_lead_inbox set status='created', lead_id=v_lead.id,
    assigned_to=v_owner.id,
    notification_status=case when v_owner.id is null then 'skipped' else 'pending' end,
    notification_error=case when v_owner.id is null then 'no_eligible_assignee' end,
    processed_at=now()
  where id=v_event.id;

  return jsonb_build_object('ok', true, 'created', true, 'inbox_id', v_event.id,
    'lead_id', v_lead.id, 'assigned_to', v_owner.id,
    'assignee_name', v_owner.name, 'assignee_phone', v_owner.lead_notification_phone,
    'lead_name', v_lead.name, 'lead_phone', v_lead.phone_normalized,
    'campaign_name', v_lead.campaign_name, 'city', v_lead.city, 'category', v_lead.category);
exception when others then
  if v_event.id is not null then
    update public.campaign_lead_inbox set status='failed', notification_status='skipped',
      notification_error=sqlerrm, processed_at=now() where id=v_event.id;
  end if;
  raise;
end;
$$;

revoke all on function public.ingest_google_campaign_lead(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.ingest_google_campaign_lead(text,text,jsonb) to service_role;

comment on function public.ingest_google_campaign_lead(text,text,jsonb) is
  'Idempotent Google campaign intake into internal CRM. Never creates or updates Zoho customers.';

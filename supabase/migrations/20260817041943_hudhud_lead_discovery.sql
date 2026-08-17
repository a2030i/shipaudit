-- Hudhud nationwide merchant discovery. This is a review queue only: discovery
-- never sends a message and never changes an existing customer's lifecycle.

create table if not exists public.hudhud_lead_scans (
  id uuid primary key default gen_random_uuid(),
  scope_key text not null,
  scope_label text not null,
  category_keys text[] not null default '{}',
  status text not null default 'queued' check (status in ('queued','running','completed','partial','failed')),
  places_found integer not null default 0,
  places_enriched integer not null default 0,
  candidates_saved integer not null default 0,
  error_summary text,
  started_at timestamptz,
  finished_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.hudhud_lead_candidates (
  id uuid primary key default gen_random_uuid(),
  hudhud_place_id text not null unique,
  scan_id uuid references public.hudhud_lead_scans(id) on delete set null,
  name_ar text not null,
  name_en text,
  category_ar text,
  category_key text,
  city_ar text,
  district_ar text,
  phone text,
  phone_normalized text,
  email text,
  website_url text,
  instagram_url text,
  x_url text,
  snapchat_url text,
  tiktok_url text,
  latitude double precision,
  longitude double precision,
  rating numeric(3,2),
  place_status text,
  ecommerce_score integer not null default 0 check (ecommerce_score between 0 and 100),
  qualification_evidence jsonb not null default '{}'::jsonb,
  review_status text not null default 'pending' check (review_status in ('pending','approved','rejected','existing_customer')),
  review_notes text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  crm_lead_id uuid references public.crm_leads(id) on delete set null,
  raw_payload jsonb not null default '{}'::jsonb,
  first_discovered_at timestamptz not null default now(),
  last_discovered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hudhud_candidates_review_score_idx
  on public.hudhud_lead_candidates(review_status, ecommerce_score desc, last_discovered_at desc);
create index if not exists hudhud_candidates_city_idx on public.hudhud_lead_candidates(city_ar);
create index if not exists hudhud_candidates_phone_idx on public.hudhud_lead_candidates(phone_normalized)
  where phone_normalized is not null;

alter table public.hudhud_lead_scans enable row level security;
alter table public.hudhud_lead_candidates enable row level security;

create or replace function public.hudhud_can_review_leads()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'admin'
        or coalesce((p.permissions->>'sales.external_leads')::boolean, false)
        or coalesce((p.permissions->>'crm.upload_leads')::boolean, false)
      )
  );
$$;
revoke all on function public.hudhud_can_review_leads() from public, anon;
grant execute on function public.hudhud_can_review_leads() to authenticated;

create policy hudhud_scans_select on public.hudhud_lead_scans
  for select to authenticated using (public.hudhud_can_review_leads());
create policy hudhud_candidates_select on public.hudhud_lead_candidates
  for select to authenticated using (public.hudhud_can_review_leads());
create policy hudhud_candidates_update on public.hudhud_lead_candidates
  for update to authenticated
  using (public.hudhud_can_review_leads())
  with check (public.hudhud_can_review_leads());

grant select on public.hudhud_lead_scans to authenticated;
grant select, update on public.hudhud_lead_candidates to authenticated;

create or replace function public.approve_hudhud_lead_candidate(p_candidate_id uuid, p_notes text default null)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  c public.hudhud_lead_candidates%rowtype;
  lead_id uuid;
begin
  if auth.uid() is null or not public.hudhud_can_review_leads() then
    raise exception 'not_authorized';
  end if;

  select * into c from public.hudhud_lead_candidates where id = p_candidate_id for update;
  if not found then raise exception 'candidate_not_found'; end if;
  if c.crm_lead_id is not null then return c.crm_lead_id; end if;

  if c.phone_normalized is not null then
    select id into lead_id from public.crm_leads
    where phone_normalized = c.phone_normalized
    order by created_at desc limit 1;
  end if;

  if lead_id is null then
    insert into public.crm_leads (
      name, name_en, phone, phone_normalized, email, city, category, address,
      website, social_links, notes, source, snapshot_id, status, lead_kind,
      source_channel, campaign_meta, created_by
    ) values (
      c.name_ar, c.name_en, c.phone, c.phone_normalized, c.email, c.city_ar,
      c.category_ar, concat_ws('، ', c.district_ar, c.city_ar), c.website_url,
      jsonb_strip_nulls(jsonb_build_object('instagram',c.instagram_url,'x',c.x_url,'snapchat',c.snapchat_url,'tiktok',c.tiktok_url)),
      nullif(trim(p_notes),''), 'hudhud_places', 'hudhud_' || c.hudhud_place_id,
      'new', 'cold', 'hudhud_places',
      jsonb_build_object('hudhud_candidate_id',c.id,'ecommerce_score',c.ecommerce_score,'evidence',c.qualification_evidence),
      auth.uid()
    ) returning id into lead_id;
  end if;

  update public.hudhud_lead_candidates set
    review_status = 'approved', review_notes = nullif(trim(p_notes),''),
    reviewed_by = auth.uid(), reviewed_at = now(), crm_lead_id = lead_id, updated_at = now()
  where id = c.id;
  return lead_id;
end;
$$;
revoke all on function public.approve_hudhud_lead_candidate(uuid,text) from public, anon;
grant execute on function public.approve_hudhud_lead_candidate(uuid,text) to authenticated;

-- أرقام في هاتف ليست في كشف متاجرنا — فرص إعادة استهداف + موردون/ضجيج.
-- named_manually = سمّاه موظف (الاسم يحوي حرفاً) → إشارة اهتمام حقيقية.
create table if not exists public.hatif_unknown_contacts (
  phone            text primary key,
  contact_id       text,
  name             text,
  company          text,
  named_manually   boolean not null default false,
  phone_kind       text,   -- mobile_sa | landline_sa | service_sa | foreign | other
  created_at_hatif timestamptz,
  first_seen       timestamptz not null default now(),
  last_seen        timestamptz not null default now(),
  status           text not null default 'new',   -- new | lead | supplier | noise | converted
  owner_id         uuid,
  note             text,
  updated_at       timestamptz not null default now()
);
create index if not exists ix_huc_kind   on public.hatif_unknown_contacts (phone_kind);
create index if not exists ix_huc_named  on public.hatif_unknown_contacts (named_manually);
create index if not exists ix_huc_status on public.hatif_unknown_contacts (status);
alter table public.hatif_unknown_contacts enable row level security;
drop policy if exists huc_read on public.hatif_unknown_contacts;
create policy huc_read on public.hatif_unknown_contacts for select to authenticated using (true);
drop policy if exists huc_update on public.hatif_unknown_contacts;
create policy huc_update on public.hatif_unknown_contacts for update to authenticated using (true) with check (true);

-- Align CRM lead snapshot uniqueness with the sales importer identity.
-- Same normalized name can appear more than once in a directory upload
-- when the phone is different; exact duplicates remain phone+name scoped.

drop index if exists public.ux_crm_leads_snap_norm;

create unique index if not exists ux_crm_leads_snap_phone_name
  on public.crm_leads (snapshot_id, phone_normalized, name_normalized)
  where snapshot_id is not null
    and phone_normalized is not null
    and name_normalized is not null;

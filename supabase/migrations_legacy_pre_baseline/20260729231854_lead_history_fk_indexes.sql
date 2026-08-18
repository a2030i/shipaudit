-- Cover the two secondary history foreign keys flagged by the performance advisor.
create index if not exists idx_crm_lead_history_changed_by
  on public.crm_lead_history(changed_by)
  where changed_by is not null;

create index if not exists idx_crm_lead_history_owner
  on public.crm_lead_history(owner_id)
  where owner_id is not null;

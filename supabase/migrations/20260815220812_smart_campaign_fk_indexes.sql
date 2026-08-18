-- Cover user foreign keys reported by the Supabase performance advisor.
create index if not exists smart_campaigns_updated_by_idx
  on public.smart_campaigns (updated_by);

create index if not exists smart_campaign_events_created_by_idx
  on public.smart_campaign_events (created_by);

create index if not exists smart_campaign_tasks_created_by_idx
  on public.smart_campaign_tasks (created_by);

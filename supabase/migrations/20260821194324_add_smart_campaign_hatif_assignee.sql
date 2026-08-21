-- Optional Hatif assignee persisted with a smart campaign draft/review.
-- The ID belongs to Hatif, not public.profiles, so no local FK is correct here.
alter table public.smart_campaigns
  add column if not exists assigned_hatif_user_id uuid,
  add column if not exists assigned_hatif_user_name text;

comment on column public.smart_campaigns.assigned_hatif_user_id is
  'External Hatif user UUID selected to own replies for this campaign.';

comment on column public.smart_campaigns.assigned_hatif_user_name is
  'Display-name snapshot for the selected Hatif user; not an identity key.';

notify pgrst, 'reload schema';

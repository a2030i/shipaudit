set lock_timeout = '5s';

alter table public.smart_campaigns
  drop constraint if exists smart_campaigns_objective_check;

alter table public.smart_campaigns
  add constraint smart_campaigns_objective_check
  check (objective = any (array[
    'general'::text,
    'collection'::text,
    'reactivation'::text,
    'sales'::text,
    'service'::text
  ]));

comment on constraint smart_campaigns_objective_check on public.smart_campaigns is
  'Campaign objectives supported by Smart Campaign Center, including manually supplied general audiences.';

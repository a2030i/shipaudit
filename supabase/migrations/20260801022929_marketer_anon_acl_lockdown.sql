-- RLS already denies anon rows. Remove the underlying Data API grants too so
-- the feature has no anonymous table surface even when project default ACLs
-- grant public-schema tables to anon.
revoke all privileges on table
  public.marketing_marketers,
  public.marketing_compensation_plans,
  public.marketing_commission_tiers,
  public.marketing_monthly_performance,
  public.marketing_status_history
from anon;

revoke all privileges on table
  public.marketing_marketers,
  public.marketing_compensation_plans,
  public.marketing_commission_tiers,
  public.marketing_monthly_performance,
  public.marketing_status_history
from public;

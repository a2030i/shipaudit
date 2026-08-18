-- The tier assertion is an internal read-only helper called from guarded RPCs.
-- It needs neither SECURITY DEFINER nor direct Data API exposure.
alter function public.marketing_assert_plan_tiers(uuid) security invoker;
revoke all on function public.marketing_assert_plan_tiers(uuid) from authenticated;
grant execute on function public.marketing_assert_plan_tiers(uuid) to service_role;

-- Avoid per-row auth.uid() initialization in the insert policy.
drop policy if exists marketing_months_insert on public.marketing_monthly_performance;
create policy marketing_months_insert on public.marketing_monthly_performance
  for insert to authenticated
  with check (
    public.crm_has_permission('marketers.record_month')
    and created_by = (select auth.uid())
  );

-- Cover the FKs used by plan snapshots and pending OAuth cleanup/cascade.
create index if not exists marketing_months_plan_idx
  on public.marketing_monthly_performance (plan_id)
  where plan_id is not null;
create index if not exists zoho_oauth_pending_user_idx
  on public.zoho_oauth_pending_grants (user_id);

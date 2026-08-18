-- Fast dashboard metadata for external CRM leads.
-- Replaces client-side scans over all crm_leads rows on every tab visit.

create or replace function public.crm_leads_dashboard_meta()
returns jsonb
language sql
stable
set search_path = public
as $$
  with rows as (
    select status, owner_id, duplicate_count, matched_store_id, category, platform
    from public.crm_leads
  ),
  stats as (
    select
      count(*)::int as total,
      count(*) filter (where status = 'new')::int as new_count,
      count(*) filter (where matched_store_id is not null or status = 'existing_customer')::int as existing_customers,
      count(*) filter (where coalesce(duplicate_count, 1) > 1)::int as duplicate_rows,
      count(*) filter (where owner_id is null)::int as unassigned,
      count(*) filter (where status = 'converted')::int as converted
    from rows
  ),
  categories as (
    select coalesce(jsonb_agg(category order by category), '[]'::jsonb) as items
    from (select distinct category from rows where nullif(category, '') is not null) d
  ),
  platforms as (
    select coalesce(jsonb_agg(platform order by platform), '[]'::jsonb) as items
    from (select distinct platform from rows where nullif(platform, '') is not null) d
  ),
  statuses as (
    select coalesce(jsonb_agg(status order by status), '[]'::jsonb) as items
    from (select distinct status from rows where nullif(status, '') is not null) d
  )
  select jsonb_build_object(
    'stats', jsonb_build_object(
      'total', stats.total,
      'newCount', stats.new_count,
      'existingCustomers', stats.existing_customers,
      'duplicateRows', stats.duplicate_rows,
      'unassigned', stats.unassigned,
      'converted', stats.converted
    ),
    'options', jsonb_build_object(
      'categories', categories.items,
      'platforms', platforms.items,
      'statuses', statuses.items
    )
  )
  from stats, categories, platforms, statuses;
$$;

revoke all on function public.crm_leads_dashboard_meta() from public;
grant execute on function public.crm_leads_dashboard_meta() to authenticated;

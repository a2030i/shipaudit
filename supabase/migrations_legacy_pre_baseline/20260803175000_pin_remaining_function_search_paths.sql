-- Prevent object-shadowing in the two remaining functions reported by the DB linter.
alter function public._test_alloc_guard() set search_path = public, pg_temp;
alter function public.canon_lead_category(text) set search_path = public, pg_temp;

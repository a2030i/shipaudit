-- customer_ar is read-only and its sources already have authenticated SELECT RLS.
-- Keep view RLS semantics aligned with the querying role.
alter view public.customer_ar set (security_invoker = true);

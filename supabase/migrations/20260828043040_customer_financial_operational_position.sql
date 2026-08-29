-- Read-only contract separating Zoho's raw accounting balance from the amount
-- that can enter collection workflows under the existing > 0.50 invoice rule.
-- No source balance, credit, invoice, or Zoho record is changed by this view.

create or replace view public.customer_financial_operational_position
with (security_invoker = true) as
with operational as (
  select
    l.contact_id::text as zoho_id,
    round(coalesce(sum(l.collectible_amount), 0)::numeric, 2) as operational_collectible
  from public.customer_collectible_lines l
  -- customer_collectible_lines is built only from source invoice balances
  -- strictly greater than 0.50. The small positive guard below only removes
  -- zero lines left after FIFO credit allocation; it does not redefine the
  -- approved source-balance threshold.
  where l.collectible_amount > 0.005
  group by l.contact_id::text
)
select
  ar.zoho_id::text as zoho_id,
  ar.contact_name,
  round(coalesce(ar.total_due, 0)::numeric, 2) as accounting_outstanding,
  round(coalesce(op.operational_collectible, 0)::numeric, 2) as operational_collectible,
  round((coalesce(ar.total_due, 0) - coalesce(op.operational_collectible, 0))::numeric, 2) as residual_balance,
  round(coalesce(ar.credit_offset, 0)::numeric, 2) as credit_offset,
  0.50::numeric as operational_source_balance_threshold,
  (
    round(coalesce(ar.total_due, 0)::numeric, 2)
    = round((coalesce(op.operational_collectible, 0)
      + (coalesce(ar.total_due, 0) - coalesce(op.operational_collectible, 0)))::numeric, 2)
  ) as reconciled_exactly
from public.customer_ar ar
left join operational op on op.zoho_id = ar.zoho_id::text;

comment on view public.customer_financial_operational_position is
  'Read-only financial position: Zoho accounting outstanding = operational collectible + residual balance, exactly at SAR 0.01 precision. Operational collection continues to use the existing source invoice balance > 0.50 rule.';

revoke all on public.customer_financial_operational_position from public, anon;
grant select on public.customer_financial_operational_position to authenticated;

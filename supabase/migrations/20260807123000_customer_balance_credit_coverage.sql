-- A contact whose unused Zoho credit fully covers its receivable cannot be
-- over-collected, even when Zoho's contact total contains a settled historical
-- balance that is no longer returned as a configured opening balance.
-- Keep the unexplained residual visible for diagnostics, but do not classify
-- it as a mirror-integrity blocker. The FIFO collectible view will allocate
-- the credit and emit zero collectible amount.

create or replace view public.customer_ar
with (security_invoker = true) as
select
  c.contact_name,
  c.zoho_id,
  coalesce(c.outstanding_receivable, 0)::numeric as total_due,
  coalesce(inv.invoiced_due, 0::numeric) as invoiced_due,
  round(
    least(
      greatest(calc.balance_residual, 0),
      greatest(coalesce(c.opening_balance_configured, 0), 0)
    ),
    2
  ) as opening_due,
  coalesce(inv.open_count, 0::bigint) as open_invoices,
  inv.oldest_invoice_date,
  coalesce(inv.days_oldest, 0) as days_oldest,
  coalesce(c.unused_credits_receivable, 0)::numeric as unused_credits,
  c.status,
  round(least(greatest(coalesce(c.outstanding_receivable, 0), 0), greatest(coalesce(c.unused_credits_receivable, 0), 0)), 2) as credit_offset,
  round(greatest(coalesce(c.outstanding_receivable, 0) - greatest(coalesce(c.unused_credits_receivable, 0), 0), 0), 2) as collectible_due,
  round(greatest(coalesce(c.unused_credits_receivable, 0) - greatest(coalesce(c.outstanding_receivable, 0), 0), 0), 2) as credit_surplus,
  (coalesce(c.outstanding_receivable, 0) > 0.5 and coalesce(c.unused_credits_receivable, 0) > 0.005) as needs_zoho_settlement,
  c.opening_balance_configured,
  c.opening_balance_checked_at,
  calc.balance_residual,
  round(greatest(calc.balance_residual - greatest(coalesce(c.opening_balance_configured, 0), 0), 0), 2) as balance_sync_gap,
  round(greatest(-calc.balance_residual, 0), 2) as balance_sync_overage,
  case
    when abs(calc.balance_residual) <= 0.5 then 'valid'
    when greatest(coalesce(c.unused_credits_receivable, 0), 0)
      >= greatest(coalesce(c.outstanding_receivable, 0), 0) - 0.005 then 'valid'
    when c.opening_balance_checked_at is null then 'unchecked'
    when calc.balance_residual - greatest(coalesce(c.opening_balance_configured, 0), 0) > 0.5 then 'mismatch'
    when -calc.balance_residual > 0.5 then 'mismatch'
    else 'valid'
  end as balance_integrity_status
from public.zoho_contacts c
left join lateral (
  select
    coalesce(sum(i.balance), 0)::numeric as invoiced_due,
    count(*) as open_count,
    min(i.date) as oldest_invoice_date,
    current_date - min(i.date) as days_oldest
  from public.zoho_invoices i
  where (
      i.customer_id = c.zoho_id
      or (i.customer_id is null and i.customer_name = c.contact_name)
    )
    and i.balance > 0.5
) inv on true
cross join lateral (
  select round(coalesce(c.outstanding_receivable, 0) - coalesce(inv.invoiced_due, 0), 2) as balance_residual
) calc
where c.contact_type = 'customer';

comment on view public.customer_ar is
  'Zoho customer balance truth. Explicit opening balances remain separate; fully credit-covered contacts are safe from collection while retaining diagnostic residuals.';

grant select on public.customer_ar to authenticated;

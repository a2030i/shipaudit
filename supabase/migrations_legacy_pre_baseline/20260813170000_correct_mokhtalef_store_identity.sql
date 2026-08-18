-- Correct the two same-name Lamha stores using their operational identity:
-- store 654 is postpaid and carries Mishari's open Zoho ledger (SAR 460),
-- while store 1961 is prepaid and corresponds to Habib's settled ledger.
-- This only changes the customer/store link; it never changes invoices or balances.
update public.customer_merchant_links
set store_id = '654',
    match_method = 'manual',
    confidence = 1.00,
    linked_at = now()
where customer_name = 'مشاري سعد نجيب عبد العال - مختلفٌ';

update public.customer_merchant_links
set store_id = '1961',
    match_method = 'manual',
    confidence = 1.00,
    linked_at = now()
where customer_name = 'حبيب سعد نجيب عبد العال - مختلفٌ';

-- A bare trade name cannot distinguish the two stores. Keep it unlinked until
-- a phone, store ID or verified customer identity resolves the ambiguity.
update public.customer_merchant_links
set store_id = null,
    match_method = 'unmatched',
    confidence = 0,
    linked_at = now()
where customer_name in ('مختلف', 'مختلفٌ')
  and coalesce(match_method, '') <> 'manual';

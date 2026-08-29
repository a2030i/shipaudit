-- zoho_contact_id already has a UNIQUE constraint, whose index covers exact
-- lookups. Keep one index instead of paying for two on every authority change.
drop index if exists public.lamha_zoho_store_links_contact_idx;

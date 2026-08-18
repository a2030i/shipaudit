-- تسريع صفحة «ليسوا عملاء لنا» (crm_leads، 51 ألف صف):
-- فهرس للفرز الافتراضي updated_at + فهارس trigram للبحث النصّي بـ ilike.
create index if not exists ix_crm_leads_updated on public.crm_leads (updated_at desc);
create extension if not exists pg_trgm;
create index if not exists ix_crm_leads_name_trgm  on public.crm_leads using gin (name gin_trgm_ops);
create index if not exists ix_crm_leads_email_trgm on public.crm_leads using gin (email gin_trgm_ops);

-- صلاحيات v2 — backfill المفاتيح الجديدة لمن كان يملك القديمة (لا فقدان وصول):
-- sales.* ← crm.view · campaigns.send+whatsapp.view_log ← collections.view|crm.view
-- whatsapp.configure ← collections.view · zoho.view ← money.pnl · legal.view ← receivables.view
update profiles set permissions = coalesce(permissions, '{}'::jsonb)
  || '{"sales.view": true, "sales.manage": true, "sales.export": true}'::jsonb
where role = 'accountant' and coalesce(permissions->>'crm.view', 'false') = 'true';
update profiles set permissions = coalesce(permissions, '{}'::jsonb)
  || '{"campaigns.send": true, "whatsapp.view_log": true}'::jsonb
where role = 'accountant' and (
  coalesce(permissions->>'collections.view', 'false') = 'true'
  or coalesce(permissions->>'crm.view', 'false') = 'true');
update profiles set permissions = coalesce(permissions, '{}'::jsonb)
  || '{"whatsapp.configure": true}'::jsonb
where role = 'accountant' and coalesce(permissions->>'collections.view', 'false') = 'true';
update profiles set permissions = coalesce(permissions, '{}'::jsonb)
  || '{"zoho.view": true}'::jsonb
where role = 'accountant' and coalesce(permissions->>'money.pnl', 'false') = 'true';
update profiles set permissions = coalesce(permissions, '{}'::jsonb)
  || '{"legal.view": true}'::jsonb
where role = 'accountant' and coalesce(permissions->>'receivables.view', 'false') = 'true';

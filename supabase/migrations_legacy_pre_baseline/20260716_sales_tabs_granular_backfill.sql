-- تفصيص تبويبات مركز المبيعات (2026-07-16): sales.view صار «إعادة الاستهداف فقط».
-- backfill: مَن يملك sales.manage (دور مبيعات كامل) يُمنح مفاتيح التبويبات الجديدة
-- كي لا يفقد وصوله. أصحاب sales.view وحدها (المحدودون عمداً) لا يُمنحون شيئاً.
-- (مُطبَّقة على FIN عبر MCP باسم sales_tabs_granular_backfill)
update profiles
set permissions = permissions
  || '{"sales.hatif_leads": true, "sales.external_leads": true, "sales.segments": true}'::jsonb
where role = 'accountant'
  and coalesce(permissions->>'sales.manage', 'false') = 'true';

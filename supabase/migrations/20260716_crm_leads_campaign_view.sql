-- ربط الجهات المحتملة بآخر حملة واتساب (طلب المستخدم 2026-07-16):
-- view يضم لكل جهة آخر إرسال من whatsapp_campaign_sends بهاتفها المطبَّع —
-- فالفلترة (بلا حملة / خلال فترة) تتم على الخادم مهما بلغ العدد (51 ألف جهة).
-- (مُطبَّقة على FIN عبر MCP باسم crm_leads_campaign_view)
create index if not exists wcs_phone_sent_idx
  on public.whatsapp_campaign_sends(phone, sent_at desc);

create or replace view public.crm_leads_campaign
with (security_invoker = true) as
select l.*,
  s.sent_at        as last_campaign_at,
  s.status         as last_campaign_status,
  s.template_name  as last_campaign_template,
  s.replied_at     as last_campaign_replied_at
from public.crm_leads l
left join lateral (
  select sent_at, status, template_name, replied_at
  from public.whatsapp_campaign_sends w
  where w.phone = l.phone_normalized
  order by sent_at desc
  limit 1
) s on true;

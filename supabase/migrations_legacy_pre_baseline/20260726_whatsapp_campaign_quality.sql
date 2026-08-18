-- تحسينات جودة الحملات (من مراقبة الحملات 2026-07-26):
-- v_weak_whatsapp: أرقام أُرسل لها ولا أي تسليم/قراءة/ردّ (>يوم) = رقم ميت → تُستبعَد.
-- whatsapp_number_health: علم خطر جودة الرقم (تسليم<60% أو حملة كبيرة بردّ<1.5%).
-- campaign_template_stats / campaign_hour_stats: أداء كل قالب وأفضل ساعة إرسال.
-- (التعريفات الكاملة مطبَّقة عبر MCP — هذا مرجع. أعِد التطبيق من DB عند الحاجة.)
create or replace view public.v_weak_whatsapp with (security_invoker = on) as
  select phone from whatsapp_campaign_sends where phone is not null
  group by phone
  having max(sent_at) < now() - interval '1 day'
     and count(*) filter (where delivered_at is not null or read_at is not null or replied_at is not null) = 0;
revoke all on public.v_weak_whatsapp from anon;
grant select on public.v_weak_whatsapp to authenticated, service_role;

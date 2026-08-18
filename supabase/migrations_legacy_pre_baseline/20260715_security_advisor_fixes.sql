-- إصلاح تنبيهَي Advisor (CRITICAL) من عمل إعادة الاستهداف:
-- 1) retargeting_status_log كان بلا RLS (بقية جداول CRM عليها RLS). الكتابة
--    تتم حصراً عبر set_retargeting_followup (SECURITY DEFINER) فلا تتأثر بالـRLS.
--    نضيف سياسة قراءة authenticated فقط؛ لا كتابة مباشرة للعملاء.
alter table public.retargeting_status_log enable row level security;
drop policy if exists rt_status_log_read on public.retargeting_status_log;
create policy rt_status_log_read on public.retargeting_status_log
  for select to authenticated using (true);

-- 2) v_crm_retargeting كان SECURITY DEFINER (يتجاوز RLS للمستعلِم). العرض يقرأ
--    من merchants فقط (عليها RLS تسمح لـauthenticated بالقراءة) فتحويله لـ
--    security_invoker آمن ويزيل التحذير.
alter view public.v_crm_retargeting set (security_invoker = on);

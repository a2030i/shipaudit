-- الاختبار الحيّ لدالة جديدة كشف أن سحب `anon` من الامتيازات الافتراضية
-- **لا يكفي**: بمجرد إزالة منح anon الصريح يعود المنح المدمج لـ**PUBLIC**
-- (`=X` في proacl) وanon يرثه — فالدالة الجديدة تولد مكشوفة رغم الإصلاح.
--
-- القاعدة النهائية (بعد قياسين): **يُسحَب من `public` و`anon` معاً** — في
-- الامتيازات الافتراضية وفي أي سحب لدالة قائمة.
alter default privileges for role postgres in schema public
  revoke execute on functions from public;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon;
-- ويبقى المنح الصريح للأدوار التي تحتاجه فعلاً
alter default privileges for role postgres in schema public
  grant execute on functions to authenticated, service_role;

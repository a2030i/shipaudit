-- ⚠️ **تصحيح لقاعدة §1.49** (اكتُشف 2026-07-29 بالقياس لا بالافتراض):
-- «اسحب من public ثم امنح صراحةً» **غير كافٍ على Supabase**. السبب أن
-- `pg_default_acl` في هذا المشروع يحمل `defaclobjtype='f'` بقيمة
-- `{postgres=X, anon=X, authenticated=X, service_role=X}` — أي أن **كل دالة
-- جديدة في `public` تُنشأ بمنح EXECUTE صريح لـ`anon`**، لا موروثاً من PUBLIC.
-- فالـ`revoke ... from public` لا يمسّه (تحقّقتُ: `has_function_privilege('anon',…)`
-- بقيت `true` بعده).
--
-- **القاعدة الصحيحة: `revoke execute … from public, anon` صراحةً**، ثم منح
-- authenticated/service_role. وأي RPC جديد لا يُقصد به الزائر المجهول يلتزم بها.
revoke execute on function public.whatsapp_quality(text,int) from public, anon;
grant  execute on function public.whatsapp_quality(text,int) to authenticated, service_role;

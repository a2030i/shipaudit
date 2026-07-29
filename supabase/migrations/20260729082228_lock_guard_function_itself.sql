-- الحارس نفسه أُنشئ قبل أن يوجد الحارس، فوُلد مكشوفاً. استدعاؤه مباشرةً
-- غير ضارّ (يفشل خارج سياق event trigger) لكن الاتّساق يقتضي إقفاله.
revoke execute on function public.lock_new_function_acl() from public, anon;

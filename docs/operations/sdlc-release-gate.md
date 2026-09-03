# ShipAudit release gate and rollback

هذا العقد يفرّق بين رفع الكود، نجاح Preview، وترقية Production. لا تعتبر النسخة منشورة لأن Commit وصل إلى GitHub فقط.

## بوابة ما قبل الدمج

1. افتح Pull Request إلى `main` من Commit محدد.
2. يجب أن ينجح `Product quality gate`: تثبيت `package-lock.json`، فحص فرق Git، المجموعة الكاملة للاختبارات، ثم Production Build.
3. راجع أي تغيير قاعدة بيانات مقابل `supabase_migrations.schema_migrations`؛ أسماء وأرقام ملفات Git يجب أن تطابق Production.
4. شغّل Supabase security/performance advisors بعد أي DDL.
5. يمنع دمج أسرار أو قيم Tokens في Git أو مخرجات الاختبارات.

## بوابة النشر

- **Database:** طبّق migrations بالترتيب ثم اقرأ سجلها ووظيفة/جدول الهدف للتحقق.
- **Edge Functions:** انشر من نفس Git revision واقرأ الإصدار والحالة والمصدر المنشور.
- **Frontend:** الدمج في `main` هو طلب النشر الإنتاجي. انتظر Vercel Deployment بحالة `success` وتأكد أن SHA المنشور يساوي SHA الدمج.
- لا يثبت نجاح أحد الأسطح نجاح السطحين الآخرين.

## فحص ما بعد النشر

نفّذ Read-only smoke test مصادقًا على Production:

1. افتح مركز نمو متاجر لمحة.
2. تحقق من ظهور المؤشرات ومصدر/حداثة البيانات.
3. افتح فلترًا ثم Store 360 وارجع إلى نفس الفلتر.
4. راجع Console وطلبات Network الفاشلة.
5. يمنع تنفيذ Suspend أو Reactivate أو حملة أو تسوية خلال Smoke Test.

## Rollback

1. **Frontend أولًا:** أعد ترقية آخر Vercel Production سليم، أو أنشئ `git revert` للـCommit المتسبب ومرره عبر Pull Request والبوابة نفسها.
2. **Edge Function:** أعد نشر ملفات الوظيفة من آخر Git revision سليم، ثم تحقق من رقم الإصدار والحالة. لا تغيّر Secrets أثناء rollback إلا إذا كان الحادث متعلقًا بسر مكشوف.
3. **Database:** لا تستخدم حذفًا عشوائيًا أو تعديل Migration History. أنشئ forward migration تعيد تعريف الدالة/العقد السابق. أزل RPC فقط بعد رجوع الواجهة وعدم وجود مستهلكين له.
4. أعد الاختبارات والفحص المقروء وسجّل SHA والإصدارات قبل/بعد الاسترجاع.

## مطابقة migration مركز أداء لمحة

Production سجل الخطوات التالية، ولذلك يحمل Git الأرقام نفسها:

- `20260829215247_lamha_store_performance_command_center`
- `20260829215359_lamha_store_performance_require_midnight`
- `20260829215712_lamha_store_performance_recent_first`
- `20260903191410_lamha_directory_twice_daily_riyadh`

جسم الدالة النهائي موحد في الخطوة الأولى لبناء قاعدة جديدة من الصفر، والخطوتان التاليتان تثبتان العقد التاريخي والترتيب، ثم تنقل الخطوة الأخيرة الجدولة إلى 09:00 و18:00 بتوقيت الرياض مع إبقاء اللقطة المسائية مرجع إقفال اليوم.

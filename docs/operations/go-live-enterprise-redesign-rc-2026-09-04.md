# Go-Live Checklist — Enterprise Redesign RC

Release Candidate: `enterprise-redesign-rc-2026-09-04`  
الحالة الحالية: **PRODUCTION READY WITH DOCUMENTED EXCEPTION**

## 1. تثبيت هوية الإصدار

- [ ] اعتماد commit SHA الذي يشير إليه الوسم `enterprise-redesign-rc-2026-09-04`.
- [ ] التأكد أن working tree نظيف قبل بدء النشر.
- [ ] التأكد أن CI يبني الـSHA نفسه، وليس رأس فرع متغيرًا.
- [ ] حفظ آخر Production SHA سليم وVercel deployment ID قبل أي ترقية.
- [ ] توثيق صاحب قرار Go-Live ووقت نافذة النشر.

## 2. بوابة ما قبل النشر

- [ ] Production build PASS من الـRC SHA.
- [ ] Full test suite PASS: 538 pass / 0 fail / 1 intentional skip أو نتيجة أحدث مكافئة على الـSHA نفسه.
- [ ] Business Logic locks مطابقة: 50/50 عبر 45 ملفًا.
- [ ] Route/deep-link contract يحافظ على 70 route.
- [ ] لا ملفات `.env` أو أسرار أو tokens ضمن commit.
- [ ] لا migrations أو Edge Function أو Database changes ضمن هذا الإصدار.
- [ ] مراجعة RLA-01 وRLA-02 وRLA-03 في Release Notes.
- [ ] قبول الاستثناء المعروف صراحةً: `Permissions: CONTRACT PASS / LIVE SESSION NOT VERIFIED`، أو إغلاقه بجلسة Limited User طبيعية على نفس الـSHA.

## 3. نشر مضبوط — بعد أمر صريح فقط

- [ ] نشر Frontend من commit/tag المعتمد فقط.
- [ ] عدم تغيير Environment variables أو Supabase أو integrations أثناء النشر.
- [ ] التحقق أن Deployment SHA يساوي Release Candidate SHA.
- [ ] الانتظار حتى تصبح حالة المنصة `success` قبل بدء smoke test.
- [ ] عدم تشغيل أي إجراء مالي أو تشغيلي غير قابل للعكس خلال القبول.

## 4. فحص ما بعد النشر

- [ ] تسجيل دخول Admin حقيقي.
- [ ] فتح المراكز الثمانية والتحقق من AppShell/PageHeader/Navigation/RTL.
- [ ] إعادة الرحلات A–F مع حفظ filters/page/tabs/date range/returnTo.
- [ ] Customer 360: عميل وهوية وسياق مالي وفاتورة.
- [ ] Finance: reconciliation mismatch والعودة لنفس Result Set.
- [ ] Operations: ناقل وشحنة وCarrier 360.
- [ ] Campaigns: audience/preflight دون إرسال.
- [ ] Reports: KPI → Result Set → Detail → Return.
- [ ] إجراء حساس حتى confirmation فقط ثم الإلغاء.
- [ ] Desktop وMobile representative visual smoke.
- [ ] Console/Network: لا 401/403 غير متوقعة، لا 5xx، لا timeouts أو request storms.
- [ ] Limited User live verification عند توفر جلسة طبيعية: navigation، direct URLs، financial/admin/bulk/integration/forbidden actions والرفض من backend.

## 5. قرار Go-Live

- [ ] لا Release Blockers مفتوحة.
- [ ] جميع أدلة الاختبار مرتبطة بالـSHA المنشور.
- [ ] الاستثناءات المتبقية موثقة ومقبولة من صاحب القرار.
- [ ] إعلان Production Ready/Go-Live في سجل الإصدار.

## Rollback Plan

1. أوقف الترقية أو حركة النشر الجديدة، ولا تغيّر البيانات لمعالجة مشكلة Frontend.
2. أعد ترقية آخر Vercel Production deployment سليم المسجل قبل النشر، أو أنشئ `git revert` للـRC عبر Pull Request وبوابة الاختبار المعتادة.
3. لا تعدّل Supabase migrations أو migration history؛ هذا الإصدار لا يتضمن Database changes.
4. تحقق من SHA الفعلي بعد rollback، ثم أعد Admin login وroute smoke والرحلة المتأثرة وConsole/Network checks.
5. سجّل سبب rollback والـSHA قبل/بعد وأي Release Blocker جديد في incident/release log.


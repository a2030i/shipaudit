# ShipAudit Enterprise Redesign — Release Candidate

التاريخ: 2026-09-04
الحالة: **PRODUCTION READY WITH DOCUMENTED EXCEPTION**
الفرع المحلي: `release/enterprise-redesign-rc-2026-09-04`
الوسم المحلي: `enterprise-redesign-rc-2026-09-04`

هذه الوثيقة تثبت نطاق Release Candidate النهائي لمشروع إعادة التصميم. لا يعني إنشاء الـcommit أو الوسم أن النسخة نُشرت إلى Production، ولا يصرح بتغيير Environment أو Database.

## نطاق الإصدار

- App Shell وNavigation وInformation Architecture موحدة للمراكز الثمانية.
- Design System مركزي ومكونات Enterprise مشتركة.
- ترحيل العملاء والتحصيل، المالية، التشغيل، المبيعات، الحملات، التقارير، والإدارة.
- Customer 360 وCarrier 360 ومسارات drill-down و`returnTo` الموحدة.
- Phase 7 cleanup المحافظ المثبت باختبارات dependency/reference.
- الحفاظ على 70 route وروابط التوافق التاريخية.

## Release Acceptance

- Admin Live Session: PASS.
- Cross-workspace journeys: 6/6 PASS.
- Desktop Visual Acceptance: 8/8 workspaces PASS.
- Mobile Visual Acceptance: 8/8 workspaces PASS.
- Live Smoke Suite: PASS.
- Runtime Health: PASS؛ لا Console errors أو warnings أثناء الجولة النهائية.
- Production build: PASS — 2,021 modules.
- Full suite: 539 tests / 538 pass / 0 fail / 1 intentional skip.
- Business Logic locks: 50/50 matched عبر 45 ملفًا.

## Release Blocker Remediations

### RLA-01 — Workspace ownership

- السبب: كان من الممكن استعادة `/carrier-kpi` كآخر مسار للتشغيل بينما تصنفه طبقات أخرى ضمن التقارير، فتظهر حالة Workspace مختلطة.
- المعالجة: توحيد عقد ملكية المسار والتحقق من أن المسار المحفوظ ينتمي للمركز المطلوب قبل استعادته، مع fallback آمن وعدم جعل query parameters تغير الملكية.
- النتيجة: Sidebar وBreadcrumb وHeader والمحتوى متفقة، والـdeep link محفوظ.

### RLA-02 — Reconciliation journey context

- السبب: حالة Result Set للمطابقة، ومنها `mismatch`، لم تكن ممثلة بالكامل في URL؛ لذلك كان `returnTo` يعيد الصفحة العامة بدل نفس النتيجة.
- المعالجة: مزامنة ثنائية الاتجاه بين URL وواجهة المطابقة، وتمرير URL الحالي الكامل إلى Customer 360 ثم استعادته بصورة deterministic.
- النتيجة: العودة تحافظ على tab/status/filters/page/query parameters؛ عينة القبول بقيت 10/94.

### RLA-03 — Phone presentation formatting

- السبب: `LamhaStorePerformance` عرض `row.phone` مباشرة، فظهر Excel apostrophe في أرقام سعودية موثقة.
- المعالجة: تمرير العرض عبر `PhoneNumber` و`normalizePhoneForDisplay` المركزيين؛ إزالة artifact المؤكد في Presentation فقط دون تعديل المصدر أو الاستيراد أو قاعدة البيانات.
- النتيجة: `'+966508184944` يعرض `+966508184944`، والقيم الصحيحة والفارغة تحافظ على عقدها.

## العقود غير المتغيرة

لم يغير الإصدار الحسابات المالية، Zoho mappings، التحصيل، shipment/COD/carrier settlements، sales classification، campaign eligibility، report metrics، الصلاحيات، التكاملات، APIs، أو Database schema.

## الاستثناء المعروف

**Permissions: CONTRACT PASS / LIVE SESSION NOT VERIFIED**

لم تتوفر جلسة Limited User طبيعيًا. لم يُنشأ مستخدم ولم تُعدّل permission data لأجل الاختبار. يلزم تنفيذ الاختبار الحي متى توفرت الجلسة بصورة طبيعية، دون تغيير هذا الـRelease Candidate.

## قيود الإصدار

- لا نشر تلقائي.
- لا Environment أو Database أو configuration changes.
- لا Cleanup أو Refactor أو Phase 8 ضمن هذا الإصدار.
- أي تحسين لاحق يبدأ من ticket وbaseline مستقلين بعد الإطلاق.

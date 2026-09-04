# Phase 6 — Final Gate Remediation Sprint

التاريخ: 2026-09-04  
النطاق: `FSG-01..FSG-09` فقط  
النتيجة: **PASS — 9/9 closed**

لم يبدأ Phase 7، ولم يُحذف أي Legacy، ولم تتغير IA أو APIs أو قاعدة البيانات أو الصلاحيات أو Business Logic.

## نتيجة البنود

| FSG ID | Root cause | Fix | Test added | Result |
|---|---|---|---|---|
| FSG-01 | صفوف مهام الاستعادة كانت نتيجة تشغيلية بلا رابط هوية موحد. | حل هوية الصف عبر البحث العام الموجود، وفتح Customer 360 مع `source=sales` و`returnTo` الكامل. | عقد آلي للسياق + رحلة Chrome حية حافظت على `view/status/page/source`. | PASS |
| FSG-02 | سجلات Audience Result Set لم تكن قابلة للانتقال إلى الكيان. | جعل صف DataTable يفتح Customer 360 نفسه مع `source=campaign-audience` و`returnTo` الكامل. | عقد آلي + رحلة Audience حية لـZerosouq وعودة مطابقة حرفيًا. | PASS |
| FSG-03 | رابط الاستثناء لم يحمل سياق التشغيل، ودفتر الناقل المضمّن أعاد إضافة alias باسم `carrier`. | helper موحد يضيف `returnTo/source` ويحافظ على filters، ويطبّع الهوية إلى `id`. مُنع CarrierLedger المضمّن من تعديل URL المملوك لـCarrier 360. | عقد آلي + رحلة Aramex حية أثبتت `id` واحدًا وغياب `carrier` والعودة المطابقة. | PASS |
| FSG-04 | Result Set المالي حفظ سياق التقرير داخليًا، لكن PageHeader الأب لم يعرض طريق العودة عند العرض المضمّن. | أضيف إجراء `العودة إلى التقرير` في PageHeader المركزي لـCollectionsHub مع قبول مسار داخلي آمن فقط. | عقد آلي + رحلة حية Report → Result Set → Preview → Customer 360 → Result Set → Report. | PASS |
| FSG-05 | Customer Directory نقل دين Zoho عبر compatibility link قبل التحقق من الربط المالي الفعلي الذي يستخدمه Store 360. | الصفوف المالية المرئية فقط تتحقق من `store_360_core` الحالي؛ لا حساب مالي يعني صفرًا بلا تنبيه دين، وفشل المصدر يظهر `المصدر غير متاح`. لا يوجد احتساب مالي داخل UI. | اختبار store 199 غير المرتبط + linked store contract + مقارنة Chrome حية مع store 1996. | PASS |
| FSG-06 | apostrophe من Excel بقي ضمن القيمة المصدرية وعُرض خامًا في أكثر من سطح. | `normalizePhoneForDisplay` و`PhoneNumber` مركزيان؛ تزال العلامة فقط عند تطابق artifact سعودي مؤكد. طُبق في الدليل، Store 360، المبيعات، الحملات والمطابقة. | اختبارات الحالات الصحيحة/السلبية + عقد Reconciliation + تحقق حي للمتجر 847. | PASS |
| FSG-07 | الحملات ركبت أسطحًا وإحصاءات وتحكمات بvisual language محلي. | تركيب Page/PageHeader/StatStrip/FilterBar/Surface/DataTable/Alert/Buttons المركزية، وربط ما بقي من layout task-specific بـDS tokens بلا shadows زخرفية. | اختبار primitives/tokens + Chrome desktop/mobile ومصفوفة responsive. | PASS |
| FSG-08 | metadata غائبة لثلاثة workspaces. | أضيفت عناوين customers/finance/admin إلى عقد `PAGE_TITLES` نفسه. | اختبار صريح للعناوين + ظهور حي في المراكز. | PASS |
| FSG-09 | Command Menu لم يحفظ trigger قبل نقل focus. | حفظ العنصر السابق واستعادته بعد Escape/زر الإغلاق/الاختيار إذا بقي متصلًا بالـDOM. | اختبار عقد keyboard/focus + تحقق Chrome لمسارات الإغلاق الثلاثة. | PASS |

## التحقق الموجّه

- Remediation tests: **12/12 PASS**، منها اختبار سلوكي مستقل لكل رحلة من FSG-01 إلى FSG-04.
- Cross-workspace journeys التي كانت فاشلة: **4/4 PASS** حيًا.
- Store `199`: الدليل `0.00 ر.س`؛ Customer 360: `لا يوجد حساب مالي مرتبط`.
- Store `1996`: بقي `1,047.90 ر.س` من `store_360_core`، لإثبات أن الإصلاح لا يصفر الربط الصحيح.
- Store `847`: `+966550413239` بلا apostrophe في المطابقة وCustomer 360.
- Production build: **PASS — 2,022 modules**.
- Full tests بعد الإصلاح: **535 total / 534 pass / 0 fail / 1 intentional skip**.

## حدود التغيير

- لم تُعدّل الصيغ المالية أو eligibility أو shipment/COD/settlement أو campaign rules.
- لم تتغير services المجمدة في SHA-256.
- لم تُنشأ endpoints أو migrations.
- CSS الحملات القديم لم يُحذف؛ أصبح legacy layer مصنفًا `Replace then delete` لـPhase 7، بينما الـvisible decisions الحالية تأتي من Enterprise primitives/tokens.

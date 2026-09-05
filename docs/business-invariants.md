# قواعد العمل والحواجز

هذه القواعد مختصرة من العقود والاختبارات الحالية. أي تغيير لها تغيير منتج/تشغيل، وليس refactor عاديًا.

## المال والموقف المالي

- افصل دائمًا بين **Accounting Outstanding** و**Operational Collectible** و**Residual**. لا تعرضها أو تجمعها كرصيد واحد.
- الرصيد الدائن غير المستخدم، رصيد محفظة Lamha، ورصيد كشف الحساب مفاهيم مختلفة.
- حد الرصيد المتبقي الصغير هو `0.50`: ما يساويه أو يقل عنه residual، و`0.51` قابل للتحصيل تشغيليًا إذا استوفى بقية الشروط.
- نفّذ الحسابات الحساسة بوحدات صغرى صحيحة، لا بمقارنات float غير منضبطة.
- الاسم أو الهاتف لا يثبتان هوية مالية. الربط مع Zoho يستخدم معرف الاتصال/جداول الربط الصريحة.
- paid/partial carrier operations لها قيود تجميد؛ لا تعِد حسابها أو تعدّل مبلغها بلا مسار مصالحة مثبت.

المرجع: `docs/architecture/financial-position-contract.md` و`src/lib/customerFinancialPosition.js`.

## هوية جمهور الحملات

- رقم الجوال السعودي المطبّع هو هوية الجمهور الخارجي الوحيدة.
- لا ينشأ صف ثانٍ للرقم نفسه بسبب اختلاف اسم المتجر.
- الرقم الموجود في أحدث دليل Lamha لا يدخل كـexternal lead، ويؤرشف التنظيف في `crm_lead_cleanup_archive`.
- شرائح فواتير الحملات هي `1–15` و`16–30` و`31–60` و`61–90` و`+90`؛ استحقاق اليوم لا يدخل `1–15`.
- الرصيد الافتتاحي غير المدفوع شريحة مستقلة ولا يندمج تلقائيًا مع `+90`.

## Lamha

- `inactive` أو `غير نشط` فقط يعني أن حساب المتجر معطل. `active` و`idle` و`stopped` وأي حالة غير فارغة أخرى تعني أنه يعمل؛ `stopped` يبقى وصف دورة حياة.
- `ownerActivated` ليس إشارة تشغيل حساب ولا يدخل قرار الإيقاف/التشغيل.
- مزامنة الدليل لقطة كاملة أو لا شيء: ترتيب ثابت، pagination كاملة، تحقق العدد، ثم commit ذري.
- `api_data` و`excel_data` يبقيان منفصلين؛ API غير الفارغ يتقدم، وExcel يملأ الناقص فقط.
- لا تستنتج wallet balance من `hasWalletTransactions` ولا shipment count من `monthlyAvgOrders`.
- التغيير الجماعي للحالة يحتاج فحصًا حيًا حديثًا، سياقًا معتمدًا، وموافقة لكل تشغيل. الحساب الذي لم يوقفه الحارس المالي لا يعاد تشغيله جماعيًا.

المراجع: `src/lib/lamhaAccountState.js` و`src/lib/lamhaFinancialPolicy.js` و`docs/architecture/lamha-data-authority.md`.

## الناقلون والتدقيق ودورة المحاسب

- نموذج التشغيل الحالي منذ 2026-08-19 هو **تدقيق الفواتير فقط**. لا تنشئ متطلبات COD دورية جديدة من التصنيفات التاريخية.
- بيانات COD القديمة لا تُحذف، لكن غياب ملف COD جديد ليس مانع إقفال. رصيد legacy القائم يبقى قابلًا للتسوية التاريخية.
- جدول invoice صالح مطلوب لكل ناقل متعاقد ضمن الفترة.
- صفوف التدقيق الحقيقية في `audit_shipments`; لا تعِد إدخال blob بديل في `audits.results`.
- التصدير/الاعتماد يحتاج audit proof حديثًا صالحًا: نسخة العقد المطلوبة، اسم المصدر، والعقود المستخدمة.
- اكتمال Lamha shipments يعتمد مطابقة مجموعة AWB المتوقعة بالمستوردة، لا مجرد وجود ملف.
- الجداول متعددة المواعيد تعتمد `scheduleSlot`; وجود عدة ملفات لا يكمل موعدًا غير منسوب.
- `carrier_operations` دفتر تشغيلي مستقل بقواعد DR/CR؛ لا تنشئ قيدًا لكل AWB تلقائيًا.

المراجع: `docs/architecture/carrier-operating-model.md` و`src/lib/carrierOperatingModel.js` و`src/lib/accountingCycleStages.js` و`src/lib/auditProof.js`.

## Zoho والبنوك

- Zoho هو المصدر الوحيد لرفع كشف البنك. ShipAudit لا ينشئ ولا يرحّل bank statement إلى Zoho.
- مسار ShipAudit يقرأ ويقارن، ثم قد ينتج Excel نظيفًا للرفع اليدوي في Zoho.
- نقص أو فشل قراءة Zoho يمنع التصدير؛ لا تفترض قائمة فارغة أو نظيفة.
- وجود زر أو capability تاريخي لا يلغي حظر `bank_import`; افحص `zoho-operations` والعقود الحالية.
- ZATCA يمر عبر Zoho في المعمارية الحالية؛ لا تضف تكامل ZATCA مباشرًا بلا قرار معماري.

## الأتمتة والتواصل

- كل قاعدة تصرح بـaudience وaction وrisk وapproval policy.
- التسلسل: مصدر ← محفز ← شروط ← جمهور ← إجراء ← حماية ← نتيجة ← تدقيق.
- preview/review/save لا يمنح إذن تنفيذ أو إرسال.
- `account_action` و`critical` لا ينفذان تلقائيًا.
- كل اتصال خارجي يحتاج حداثة مصدر، عقد قالب، هوية مستلم، منع تعارض/تكرار، idempotency، وسجل نتيجة.
- لا تستخدم قالب عميل لموظف، ولا تختر موظفًا عشوائيًا عند غياب استراتيجية مستلم.
- موجز الإدارة الداخلي يعمل وفق جدوله ولا يتحول إلى إرسال خارجي.

المرجع: `docs/automation-operating-model-v2.md` وعقود القوالب في `src/lib/`.

## المصادقة والصلاحيات

- صلاحية الواجهة ليست حدًا أمنيًا. كل read/write حساس يحتاج حماية backend.
- admin bypass داخل React لا يعوض RLS أو التحقق داخل الوظيفة.
- صلاحيات accountant opt-in؛ الحقل الغائب denied.
- توزيع مهام التحصيل يحتاج `collections.assign` مستقلًا عن العرض وتحديث المرحلة.
- لا تمنح صلاحيات تلقائيًا عند إضافة capability أو migration.

## حواجز تقنية لا تُكسر عشوائيًا

- `PageSlot` قد يبقي الصفحة mounted؛ لا تعتمد effects الحساسة على mount وحيد.
- ترتيب CSS في `src/main.jsx` مقصود، وكذلك توحيد عرض التاريخ بتوقيت السعودية.
- pagination: استخدم ترتيبًا فريدًا ثابتًا، ولا تعتمد `last_page` وحده عندما يلزم تطابق العدد.
- `upsert(..., { onConflict })` لا يطابق دائمًا partial unique index؛ افحص predicate والعقد، وقد يكون delete-then-insert هو المسار المقصود.
- ملفات Excel: استخدم القراءة الخام في المعرفات، واحرص على توسيع `!ref` عند إضافة خلايا خارج النطاق.
- filenames المعروضة قد تكون عربية، لكن storage keys يجب أن تبقى ASCII وآمنة.
- طبّع line endings قبل fingerprint عندما تكون البصمة عقد محتوى نصي مستقلًا عن نظام التشغيل؛ لا تغيّر باقي البايتات دون عقد صريح.

## أين تبدأ الاختبارات

- تغييرات permissions/auth/RLS: اختبارات security وpermissions وعقود RPC ذات الصلة.
- navigation/App shell: `tests/ui-layout-contract.test.mjs` واختبارات route/navigation الأقرب.
- carrier/accounting cycle: اختبارات carrier operating model وaccounting cycle وaudit proof.
- المال/Zoho: اختبارات customer financial position وZoho sync/operations والعقود المالية.
- Lamha: اختبارات state policy وdirectory sync والـEdge Functions ذات الصلة.
- الحملات/الأتمتة: اختبارات campaign audience/template/automation gates.

استخدم `rg` للعثور على استيراد الوحدة واسم RPC أو الجدول داخل `tests/` قبل التعديل؛ هذه القائمة توجيه وليست حصرًا.

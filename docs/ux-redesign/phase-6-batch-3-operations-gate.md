# Phase 6 — Batch 3: التشغيل والناقلون ودورة المحاسب

**النتيجة النهائية: PASS**
**التاريخ:** 2026-09-04
**نطاق التغيير:** Presentation + IA فقط. لم يبدأ Batch 4.

## 1. Scope Map

### Routes والصفحات

| الوجهة | التصنيف | الموقع المستهدف | التبعيات المقفلة |
|---|---|---|---|
| `/workspace/operations` | Migrate | Overview لمركز التشغيل | قراءة `loadCarriersHub` الحالية: الناقلون، المراجعات، دفتر الناقل وCOD التاريخي |
| `/hub` | Migrate | دليل الناقلين داخل Workspace | ملف الناقل، الفواتير، المطالبات، الأرصدة، COD التاريخي، إعداد المصدر |
| `/carrier` | Keep as detail view | Carrier 360 | carrier core/read model، audits، audit shipments، claims، ledger، statements، contracts، Zoho vendor link |
| `/tasks` | Migrate | Exceptions / جداول الناقلين | عقود الناقلين، مواعيد استلام الفواتير، audit receipts، اكتمال الجداول |
| `/accounting-cycle` | Migrate | Accountant Cycle | مراحل الدورة، carrier audits، Lamha shipment imports، weight billing، COD التاريخي، period close |
| `/drop` | Migrate | Files / Imports | اكتشاف نوع الملف والناقل، parsers الحالية، upload validation |
| `/audits` | Migrate | Invoices / Files | audits read model، linked ledger index، audit shipments، merged weight export |
| `/aramex-statements` | Migrate | Statements داخل التشغيل | carrier statements وعمليات الربط الحالية |
| `/ledger` | Migrate | Carrier 360 / account drill-down | ledger operations، payments، linked audits، COD history |
| `/fulfillment` | Migrate | Service Billing | fulfillment parser، validation، billing read/write paths الحالية |
| `/weight-billing` | Migrate | Service Billing | approved audits، Lamha weight exports، source evidence |
| `/claims` | Merge | Carrier 360 + carrier workspace | `claimsService` وارتباط المطالبة بالمراجعة/الناقل |
| `/carrier-kpi` | Merge | Carrier workspace / Carrier 360 performance | carrier score والقراءات التاريخية نفسها |
| `/upload` | Redirect | Carrier 360 upload عند وجود `carrier`؛ وإلا Hub action | UploadWizard وparsers الحالية |
| `/results` | Redirect | Carrier 360 invoice result | audit id، carrier id، query context و`returnTo` |
| `/carriers` | Admin/utility only | Batch 6 — الإدارة | تعريف الناقل وصلاحيات الإدارة |
| `/contracts` | Admin/utility only | Batch 6 — الإدارة | العقود والتسعير |
| `/operations` | Admin/utility only | Batch 6 — صحة التكاملات | Carrier/Lamha integrations monitoring |
| `/uploads` | Admin/utility only | Batch 6 — مصادر البيانات | سجل الاستيراد والمصادر |
| `/webhook` | Admin/utility only | Batch 6 — التكاملات | inbound carrier events |
| `/platform-carriers` | Admin/utility only | Batch 5 — التقارير | مقارنة أسعار المنصات |

`/cod-settlements` و`/payments` بقيا تحت مصدرهما المالي من Batch 2؛ يظهر رابط COD/التسويات داخل تشغيل بوصفه انتقالًا سياقيًا فقط، من دون نسخ الوظيفة أو منطقها.

### Modals / Drawers / flows

| التدفق | التصنيف | القرار |
|---|---|---|
| رفع فاتورة الناقل | Merge | UploadWizard نفسه داخل Carrier 360 ودورة المحاسب؛ لا uploader موازٍ |
| نتيجة التدقيق | Merge | AuditResults نفسها داخل Carrier 360 والدورة |
| ربط مورد Zoho / إعداد قارئ / تعديل بيانات الناقل | Keep as detail view | بقيت في Carrier 360 وبنفس الصلاحيات وpreflight |
| إنشاء/تعديل مهمة وجدول ناقل | Migrate | العرض داخل `/tasks`، والخدمة وعقد الجدولة بلا تغيير |
| حذف مراجعة | Migrate | `Dialog` موحد؛ المراجعة المرتبطة بقيد تظل غير قابلة للحذف |
| رفع شحنات لمحة / ملف التحصيل التاريخي | Keep in accountant stage | parsers والـvalidation نفسها؛ تغير الغلاف فقط |
| Settlement upload المضمّن | Utility from Batch 2 | لم يُنقل من مصدره المالي ولم يتغير منطق التسوية |

## 2. Coverage

| الحالة | العدد | التفاصيل |
|---|---:|---|
| Migrated | 10 | Workspace + hub + tasks + cycle + drop + audits + statements + ledger + fulfillment + weight billing |
| Merged | 2 | claims، carrier KPI |
| Redirected | 2 | upload، results؛ إضافة إلى aliases المقيدة بناقل |
| Detail routes | 1 | Carrier 360 |
| Admin/utility deferred | 6 | محجوزة صراحة للدفعات 5–6 |
| Remaining داخل Scope Batch 3 | **0** | لا توجد وجهة تشغيل معتمدة متبقية خارج النظام الجديد |

أصبح `/workspace/operations` وجهة فعلية بدل redirect. وتستخدم صفحات التشغيل المعتمدة `PageHeader` و`OperationsWorkspaceNav` و`DataTable` و`FilterBar` و`StatusBadge` و`Dialog` وحالات Empty/Loading/Error المشتركة. استُبدل Card-list القديم في `/audits` بجدول موحد، مع إبقاء تنفيذه القديم غير المستخدم للتنظيف في Phase 7.

## 3. Operational Parity

| البند | النتيجة | الدليل |
|---|---|---|
| Shipment status parity | PASS | Carrier 360 يعرض مفردات audit shipment المخزنة نفسها (`مطابقة`/الفروق) بلا أسماء حالات جديدة. عينة J&T: AWB `JTE001000064053` بقيت مطابقة بقيمة 16.00/16.00 وفرق 0.00. لا يوجد في read model الحالي Route مستقل لحالات tracking الحية؛ لذلك لم تُخترع حالات متأخر/مغلق غير موجودة في المصدر. |
| Carrier data parity | PASS | SMSA: الرصيد 399,959.78، COD تاريخي 44,021.03، الصافي 443,980.81. J&T: الرصيد 86,374.03، الفواتير 104,596.50، COD 530.46. Aramex: الرصيد 11,550.99، الفواتير 226,040.59، COD 961.90 و12 عملية غير مرتبطة. |
| COD parity | PASS | إجمالي COD التاريخي 82,900.10، وعرضه موسوم تاريخيًا فقط. لا متطلب COD شهري جديد ولا تأثير على الإقفال. |
| Invoice / settlement parity | PASS | فاتورة J&T يوليو: 27,617.21 مفوتر، 27,617.21 متوقع، فرق 0.00، 1,669 شحنة. عينة Aramex ذات الاستثناء: 78.55 فرق محفوظ و8 مخالفات. لم يتغير settlement service. |
| Accountant workflow parity | PASS | سبتمبر 2026: 2/7 مراحل، 29%، الإجراء التالي «مراجعة فواتير شركات الشحن»، و3 ناقلين يحتاجون جدول فاتورة. شاشة الدورة تملك Navigation واحدًا فقط. |
| Action eligibility parity | PASS | لم يتغير evaluator أو preflight أو permission code. الصف المختصر ذو proof جزئي أصبح `legacy_unverified` للعرض فقط ولا يكتسب أهلية؛ الفاتورة الكاملة تستمر في المسار الأصلي. |
| Import behavior parity | PASS | بقيت `.xlsx/.xls/.pdf`، parsers، duplicate behavior، validation، progress وerror paths نفسها. |

### عينات القرار والإجراء

- شحنة عادية/مطابقة: J&T July audit rows، نفس AWB والقيمة والحالة.
- شحنة ذات فرق: Aramex March، 8 مخالفات و78.55 ر.س كما في القيمة المخزنة.
- COD: SMSA وJ&T وAramex بالقيم التاريخية نفسها ومن دون تحويلها إلى التزام جديد.
- ناقل متعدد السياقات: J&T يعرض الفواتير والشحنات والحساب والعقد والأداء في Carrier 360 واحد.
- ناقل له فاتورة ودورة: J&T invoice drill-down يفتح داخل Carrier 360 ويحافظ على رابط الدورة.
- حالة جدول متأخرة: `/tasks` بقي عند 7 متأخر و0 هذا الأسبوع، وتغطية 7/10.

تعريفات «شحنة متأخرة/مغلقة/مشكلة تسليم» ليست state machine تشغيلية مستقلة في مصادر Batch 3 الحالية؛ الموجود هو حالة مطابقة سطر الفاتورة، وبيانات Lamha داخل سياقات العميل/الدورة. لم يُنشأ تفسير أو API بديل لإكمال الشكل.

### Business Logic Lock

أعيد حساب SHA-256 بعد التنفيذ لـ16 ملفًا حساسًا، وتطابقت مع baseline قبل التنفيذ، ومنها:

- `carrierOperatingModel.js`
- `carrierProfileService.js`
- `coreService.js`
- `tasksService.js`
- `accountingCycleService.js` و`accountingCycleStages.js`
- `codSettlementService.js`
- `carrierStatementsService.js`
- `claimsService.js`
- `fulfillmentService.js` و`weightBillingService.js`
- audit engine وCOD/Aramex/SMSA parsers

لم تتغير API mappings أو schema أو permissions أو pricing أو eligibility أو settlement logic.

## 4. Technical Gate

| الفحص | النتيجة |
|---|---|
| Production build | PASS — Vite، 2,014 modules |
| Full tests | PASS — 505 إجمالي، 504 ناجح، 0 فشل، 1 skipped legacy contract |
| Batch 3 focused gate | PASS — 77 ناجح، 0 فشل، 1 skipped legacy contract |
| Browser console | PASS — 0 errors على Overview، Hub، Carrier 360، invoices، shipments، tasks، cycle، audits والروابط القديمة بعد الإصلاح |
| API/source errors | PASS — لم تظهر source/API failure states في العينات الحية، وبقي fail-closed behavior مغطى بالاختبارات |
| Broken routes | PASS — لا روابط مكسورة في العينة |

### Deep-link preservation

- `/ledger?carrier=smsa&filter=open&returnTo=/tasks&shipment=AWB-1` وصل إلى Carrier 360 وحفظ `filter` و`returnTo` و`shipment`.
- `/upload?returnTo=/tasks&filter=late` وصل إلى Hub upload action وحفظ السياق.
- `/results?carrier=jnt&audit=...&returnTo=/tasks&filter=late` وصل إلى نتيجة الفاتورة داخل Carrier 360 وحفظ `returnTo` و`filter` والكيان.

## 5. UX / RTL / Responsive / Accessibility

| الفحص | النتيجة |
|---|---|
| RTL وSAR | PASS — الأرقام والعملات معزولة بـ`dir=ltr`/`bdi`، الدقة العشرية لم تُخف، و0.00 والقيم السالبة/الصغيرة تستخدم Money contract نفسه |
| Table density | PASS — sticky headers على Desktop، أهم identifier ثابت، وسجل المراجعات/الناقلون/الاستثناءات يستخدمون DataTable نفسه |
| Drill-down | PASS — كل مؤشر في Overview يفتح Result Set أو Carrier 360 أو الدورة |
| Action hierarchy | PASS — إجراء أساسي واحد، والبقية في Overflow؛ الإجراءات المالية/الخارجية بقيت في preflight الأصلي |
| Mobile navigation | PASS — Bottom Navigation واحدة، وTabs تتحول إلى select، ولا Drawer مكرر |
| Keyboard | PASS — ArrowLeft من تبويب «نظرة عامة» نقل إلى «شركات الشحن»؛ الصفوف قابلة للفتح بـEnter/Space؛ focus-visible مركزي |
| Semantics | PASS — `nav/tablist/table/dialog/search/status/alert` وتسميات عربية للأزرار والجداول |

فُحصت الواجهة الفعلية داخل browsing contexts مستقلة بعروض **375، 390، 430، 768، 1024، 1280، 1440px**:

- `scrollWidth === clientWidth` في كل المقاسات؛ لا horizontal overflow.
- عند 375–768: Mobile select ظاهر وDesktop tabs مخفية، Bottom Nav بارتفاع 64px و`main` يملك 66px padding سفليًا؛ لا يغطي المحتوى.
- Page header على الجوال 92px، وعلى Desktop 70px.
- لا أزرار حرجة أقل من 40px على الجوال.
- عند 1024+: Desktop tabs ظاهرة وBottom Nav مخفية.

## 6. Design-language fidelity

- App Shell واحد وقائمة مراكز هادئة من دون ألوان أقسام.
- Page headers ومسار الصفحة وتبويبات الـworkspace بالنمط المعتمد نفسه.
- خلفيات neutral وحدود خفيفة، radius منخفض وغياب gradients في الصفحات الجديدة.
- الأرقام المهمة مضغوطة في Stat strip، لا KPI card catalog.
- Result Sets وجداول كثيفة بدل Card لكل سجل.
- Carrier 360 نقطة تجميع الكيان ولا يعيد بيانات الناقل في routes متوازية.

الأدلة البصرية:

- `phase-6-batch-3-operations-desktop.png`
- `phase-6-batch-3-audits-desktop.png`

## 7. Legacy المتبقي — موثق فقط

لم يُحذف شيء في Phase 6، ولم يُضف اعتماد جديد على التالي:

- `store-360.css` وطبقة `!important` المؤقتة العامة.
- `DropZone` القديم داخل AccountingCycle وFulfillment، وداخل شاشة COD المالية من Batch 2؛ parsers الحساسة منعت استبداله شكليًا قبل Phase 7.
- `Badge` القديم داخل UploadWizard/AuditResults/Fulfillment، و`StatCard`/`DiffCell` داخل AuditResults.
- `CarrierTabs` داخل `CodSettlements` المالي القديم فقط؛ لا يظهر في صفحات التشغيل الجديدة، ويظل مرشحًا للتنظيف بعد اكتمال الترحيل.
- تنفيذ `AuditsHistory` القديم داخل `Settings.jsx` أصبح غير مستخدم في Route `/audits` لكنه لم يُحذف التزامًا بسياسة Phase 7.
- CSS محلي في Carrier 360 ودورة المحاسب وواجهات الرفع، مطلوب حاليًا لحماية flows المعقدة؛ لا توجد raw tables في قائمة صفحات Batch 3 المعتمدة.
- Modals محلية قديمة داخل تدفقات الاستيراد الحساسة ما زالت موثقة؛ الإجراءات الجديدة/المباشرة تستخدم Dialog/Overflow المشتركة.

## 8. Gate decision

**PASS كامل لـBatch 3.**

انخفض عدد patterns الفعلية: اختفت أغلفة `CenterWorkspace` الملونة الثلاثة، وأصبح هناك Operations navigation واحد، وDataTable واحد للصفحات المعتمدة، وCarrier 360 واحد للكيان، وصفحة مستقلة موحدة لسجل المراجعات. بقيت الحسابات والحالات والأهلية والخدمات على مصادر الحقيقة السابقة دون إعادة تفسير.

**توقف التنفيذ هنا. لم يبدأ Batch 4 (المبيعات والحملات).**

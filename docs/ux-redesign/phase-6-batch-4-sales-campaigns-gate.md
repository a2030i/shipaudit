# Phase 6 — Batch 4: المبيعات والحملات

**النتيجة النهائية: PASS**  
**التاريخ:** 2026-09-04  
**نطاق التغيير:** Presentation + IA فقط. لم يبدأ Batch 5.

## 1. Scope Map

### Routes والصفحات

| الوجهة / السطح | التصنيف | الموقع المستهدف | التبعيات المقفلة |
|---|---|---|---|
| `/workspace/sales` | Migrate | Workspace المبيعات الموحد | customer/store data، sales status، last shipment/contact، owner، notes، tasks |
| Store Activation | Merge | `Overview` داخل المبيعات | customer growth snapshot والحركة التشغيلية الحالية |
| Platform Sales CRM | Merge | `Pipeline` داخل المبيعات | `retargetingService` وحالات pipeline والإسناد الحالية |
| CRM Leads / LeadsTab | Merge | `Customers / Prospects` | `crmLeadsService`، استبعادات دليل Lamha وهوية الجوال الحالية |
| `/hatif-leads` | Redirect + Merge | سياق Hatif داخل `Customers / Prospects` | Hatif leads/commitments وowner/assignee |
| `/next-actions` | Redirect + Merge | `Follow-up` | `nextActionsService`، last contact، tasks، pagination |
| `/retargeting` | Redirect + Merge | `Tasks / recovery` | segmentation الحالية، last shipment، stop/activate eligibility |
| `/segments` | Redirect + Merge | `Segments / Saved Views` | `segmentsService` وعقود الشرائح الحالية |
| `/workspace/campaigns` | Migrate | Workspace الحملات الموحد | audience builder، eligibility، exclusions، campaign history/results |
| `/campaigns` | Redirect + Merge | `/workspace/campaigns` | campaign id، audience id، القناة، الحماية، نتائج الحملة |
| `/whatsapp-settings?tab=campaigns|impact|ivr` | Migrate | `Results / History` داخل الحملات | WhatsApp/IVR logs، handoff results، إعدادات القنوات الحالية |
| `/merchants` | Redirect | Customer 360 | customer/store identity، query و`returnTo` |
| `/sales`, `/crm` | Redirect | `/workspace/sales` | كل query params الحالية |
| `/marketers` | Redirect / utility only | مركز المبيعات؛ وظيفة العمولات ليست Workspace مستقلًا | الصلاحيات والسلوك التاريخي الحاليان |
| Customer account drawer | Keep as detail view | Preview سريع مع انتقال إلى Customer 360 | customer/store identifiers و`returnTo` |
| Campaign result / audience result set | Keep as detail view | Result Set أو Dialog داخل Workspace | campaign/audience identifiers والنتائج المخزنة |
| إعدادات WhatsApp العامة | Admin/utility only | Batch 6 — الإدارة | channel configuration والصلاحيات |

### Modals / Drawers / flows

| التدفق | التصنيف | القرار |
|---|---|---|
| تفاصيل فرصة المبيعات | Keep as detail view | Drawer موحد؛ فتح الكيان الكامل يذهب إلى Customer 360 نفسه |
| تحديث المرحلة / النتيجة / المتابعة | Migrate | Dialog/Form controls المشتركة مع نفس service calls والتحقق |
| إسناد فردي أو جماعي | Migrate | نفس eligibility ونفس assignment service؛ لا عملية على السجلات غير المؤهلة |
| Audience result set | Migrate | DataTable فعلي يشرح السجلات المكوّنة لكل رقم |
| WhatsApp handoff | Keep protected flow | `WhatsAppSendModal` نفسه وبنفس `onBeforeExecute` وconfirmation |
| IVR handoff | Keep protected flow | `IvrCampaignModal` نفسه وبنفس preflight والنتيجة |
| Campaign result | Keep as detail view | النتيجة التاريخية نفسها داخل سياق الحملات |

## 2. IA الناتجة

### المبيعات

Workspace واحد بستة أقسام فقط:

1. نظرة عامة
2. مسار المبيعات
3. العملاء والفرص
4. المتابعة
5. مهام الاستعادة
6. الشرائح والعروض

لا يوجد Sales Customer Profile موازٍ. كل فتح للعميل الكامل يستخدم Customer 360، ويحمل `returnTo` وسياق البحث والفلاتر. الصفحات التاريخية أصبحت aliases آمنة ولا تظهر كوجهات رئيسية جديدة.

### الحملات

Workspace واحد يفصل بوضوح بين:

1. نظرة عامة
2. الجمهور
3. الإعداد والمسودات
4. المراجعة والإطلاق
5. الحملات النشطة
6. النتائج والسجل

بناء الجمهور لا ينفذ إرسالًا. المراجعة والحماية والقناة تبقى مراحل مستقلة، والإرسال الخارجي لا يحدث إلا عبر preflight وconfirmation الحاليين.

## 3. Coverage

| الحالة | العدد | التفاصيل |
|---|---:|---|
| Migrated routes/workspaces | 3 | sales workspace، campaign workspace، channel results workspace |
| Merged functional surfaces | 7 | activation، pipeline، external leads، Hatif، next actions، retargeting، segments |
| Redirected legacy routes | 9 | sales، crm، retargeting، hatif-leads، segments، next-actions، campaigns، merchants، marketers |
| Detail routes/views | 4 | Customer 360، account drawer، audience result set، campaign result |
| Admin/utility deferred | 1 | channel configuration داخل الإدارة |
| Remaining داخل Scope Batch 4 | **0** | لا توجد وجهة مبيعات أو حملات معتمدة خارج الـworkspaces الجديدة |

كل الجداول المرئية في صفحات Batch 4 تستخدم `DataTable` المركزي. أزيلت raw tables من PlatformSalesCrm وRetargeting وHatifLeads وSegments وCrmWorkspace وSmartCampaignCenter وWhatsAppSettings. كما استُبدلت بطاقات مؤشرات pipeline الخمس بـ`StatStrip` مركزي محايد؛ بقي كل مؤشر يفتح Result Set نفسه.

## 4. Sales Parity

| البند | النتيجة | الدليل |
|---|---|---|
| Statuses | PASS | لم تتغير stage/outcome constants أو transition services، ولم تُضف مراحل تصميمية جديدة |
| Segments | PASS | نفس خدمات retargeting/segments والعدّادات؛ لا segmentation داخل UI |
| Assignments | PASS | `assignPlatformSalesAccounts` وعقد الصلاحيات لم يتغيرا |
| Tasks | PASS | `nextActionsService` وpagination وURL state بقيت byte-identical |
| Follow-up state | PASS | notes، last contact، next action والنتيجة تمر عبر نفس الخدمات |
| Customer identity | PASS | Customer 360 واحد؛ أزيل اعتماد SalesHub على صفحة Merchants المكررة |

### عينة حيّة بعد الترحيل

- لايف جديد عالي النية: **7**.
- توقف أكثر من 5 أيام: **238**.
- رصيد يحتاج حلًا: **217**.
- ربط لايف غير نشط: **490**.
- محوّلون للتحصيل: **84**.
- بلا مسؤول في قائمة العمل: **7**.
- مراحل المسار: جديد **124**، قيد المتابعة **45**، تم الاتفاق **0**، خسرناهم **1**، الإجمالي **1,525**.
- سلوك الشحن: بدأوا ويعملون **137**، اشتغلوا ثم توقفوا **205**، عادوا للنشاط **45**.

هذه القيم طابقت القيم المقروءة قبل تعديل presentation. النقر على المؤشرات يغيّر Result Set فقط ولا يعيد احتسابها.

## 5. Campaign Parity

| البند | النتيجة | الدليل |
|---|---|---|
| Audience counts | PASS | المكوّن يعرض ناتج `summarizeWhatsAppAudience` الحالي؛ لا حساب أهلية جديد |
| Eligibility | PASS | `whatsappAudience.js` مقفول بالـhash، والسجل غير المكتمل يظهر `Requires Review` بصورة fail-closed |
| Exclusions / suppression | PASS | قواعد exclusion والهوية الخارجية وحماية Lamha لم تتغير |
| Preflight | PASS | `prepareChannelExecution` بقي قبل WhatsApp/IVR، ولا تمنح المعاينة حق التنفيذ |
| Handoff behavior | PASS | WhatsApp/IVR modals والخدمات بقيت byte-identical |
| Historical results | PASS | 48 حملة تاريخية ظهرت من المصدر نفسه داخل DataTable الموحد |

### عينات الجمهور والحملات

- Eligible-only حي: شرائح `61–90` و`+90` أعادت **12 إجمالي / 12 مؤهل / 0 مستبعد / 0 يحتاج مراجعة** بقيمة **23,900.34 ر.س**.
- Mixed audience: اختبار العقد الموجود يثبت **44 نتيجة = 26 جاهزة + 18 مستبعدة**.
- Requires Review: عندما لا تكتمل safeguards لا يُفترض التأهيل؛ تظهر المجموعة للمراجعة ويبقى الإطلاق معطلًا.
- Campaign history: **48** حملة؛ الملخص الحالي **2 مسودة، 0 مجدولة، 5 تعمل الآن، 12 تحتاج قرارًا**.
- Hatif preflight: عدم وجود موظف صالح أعاد التحذير نفسه وأبقى إطلاق WhatsApp متوقفًا؛ لم تُمنح صلاحية افتراضية.

## 6. Business Logic Lock

اختبار Batch 4 يقارن SHA-256 لثمانية عشر ملفًا حساسًا بالقيم المأخوذة قبل التنفيذ، ومنها:

- `retargetingService.js`، `nextActionsService.js`، `crmService.js` و`crmLeadsService.js`
- `smartCampaignService.js` و`whatsappAudience.js`
- `whatsappService.js` و`ivrService.js`
- `agingOperations.js` و`customerCampaignBuckets.js`
- `customerGrowthTaxonomy.js` و`customer360Service.js`
- `merchantsService.js` و`segmentsService.js`
- `hatifLeadsService.js` و`hatifCommitmentsService.js`
- `WhatsAppSendModal.jsx` و`IvrCampaignModal.jsx`

كلها بقيت byte-identical. لم تتغير APIs أو schema أو permissions أو classification أو segmentation أو assignment أو eligibility أو channel handoff.

## 7. Technical Gate

| الفحص | النتيجة |
|---|---|
| Production build | PASS — Vite، 2,014 modules، 12.77s |
| Full tests | PASS — 510 إجمالي، 509 ناجح، 0 فشل، 1 skipped legacy contract |
| Batch 4 focused gate | PASS — 43 إجمالي، 42 ناجح، 0 فشل، 1 skipped legacy contract |
| Browser console | PASS — 0 errors و0 warnings بعد المرور على sales/campaign workspaces والـaliases |
| API/source behavior | PASS — إعادة التحميل النهائية أعادت 48 حملة وعينة الجمهور 12/12؛ ظهر statement timeout عابر مرة أثناء ضغط إعادة التحميل، عُرض fail-closed ثم نجحت الإعادة من دون تغيير كود أو قيمة |
| Broken routes | PASS — لا روابط مكسورة في العينة |

### Deep-link preservation

- `/retargeting?status=new&assignee=abc&returnTo=/overview&page=2` وصل إلى `/workspace/sales` وحفظ `status` و`assignee` و`returnTo` و`page` وأضاف `view=pipeline`.
- `/campaigns?campaign_id=CMP-123&audience_id=AUD-9&returnTo=/workspace/campaigns` وصل إلى workspace الحملات وحفظ كل المعرّفات والسياق.
- `/merchants?customer=472&returnTo=/workspace/sales?view=pipeline` وصل إلى Customer 360 وحفظ العميل و`returnTo`.

## 8. UX / RTL / Responsive / Accessibility

| الفحص | النتيجة |
|---|---|
| RTL / identifiers / SAR | PASS — الأرقام والأموال معزولة بعقد Money/Identifier، والقيمة `23,900.34 ر.س` لم تتفكك |
| DataTable consistency | PASS — جدول pipeline، الجمهور، الحملات، Hatif، segments والنتائج تستخدم المكوّن نفسه |
| Result-set drill-down | PASS — إجمالي/مستبعد/مؤهل/يحتاج مراجعة تفتح سجلات المكوّن الفعلية؛ عينة الإجمالي فتحت 12 سجلًا |
| Action hierarchy | PASS — إجراء أساسي واحد حسب السياق، والكتابة الخارجية خلف preflight وconfirmation |
| Mobile navigation | PASS — Bottom Navigation واحدة؛ Workspace tabs تتحول إلى select ولا تتكرر كشريط مرئي |
| Keyboard / focus | PASS — ArrowLeft في RTL نقل التركيز من «الجمهور» إلى «الإعداد والمسودات»، مع outline ظاهر |
| Semantics / labels | PASS — `nav/tablist/table/dialog/search/alert` مستخدمة، و0 controls مرئية بلا label في عينة الحملات |

فُحصت الواجهة الحية على **375، 390، 430، 768، 1024، 1280، 1440px**:

- `scrollWidth === clientWidth` في كل المقاسات.
- 375–768px: select مركز العمل بارتفاع 44px، desktop workspace tabs مخفية، Bottom Nav بارتفاع 64px، والمحتوى يملك 66px padding سفليًا.
- PageHeader يشغل نحو 13% من ارتفاع شاشة الجوال و10% على Desktop، ولا يحجب سياق العمل.
- فلاتر pipeline المرئية على الجوال بارتفاع 44–48px.
- معادلة الجمهور على 375px تظهر في شبكة 2×2؛ كل Result Set target بارتفاع 56px ومن دون overflow.
- 1024px فأعلى: Bottom Navigation مخفية وTabs المكتبية ظاهرة.

## 9. Design-language fidelity

- App Shell وPageHeader وBreadcrumbs وTabs موحدة في المساحتين.
- المبيعات تستخدم ستة أقسام فقط؛ الحملات تستخدم ست مراحل عمل واضحة فقط.
- مؤشرات المبيعات أصبحت شريطًا محايدًا كثيفًا، بلا gradients أو مربعات أيقونات ملونة.
- الجداول هي عنصر البيانات الرئيسي، بما في ذلك سجل الحملات والـpipeline.
- Customer 360 هو الهوية التفصيلية الوحيدة للعميل.
- حالات Eligible/Ineligible/Requires Review تستخدم الألوان الدلالية فقط.
- SalesHub يحمل الشاشات الداخلية lazy حسب القسم؛ bundle المركز نفسه أصبح نحو **6.5 kB** قبل gzip بدل تحميل كل تدفقات المبيعات مقدمًا.

الأدلة البصرية:

- `phase-6-batch-4-sales-desktop.png`
- `phase-6-batch-4-campaigns-desktop.png`
- `phase-6-batch-4-campaigns-mobile.png`
- `phase-6-batch-4-audience-mobile.png`

## 10. Legacy المتبقي — موثق فقط

لم يُحذف شيء التزامًا بتأجيل التنظيف إلى Phase 7، ولم يُضف اعتماد جديد على الطبقات التالية:

- `PlatformSalesCrm.css`: قواعد `psc-summary-card` و`psc-summary-icon` أصبحت بلا markup مستخدم بعد الانتقال إلى `StatStrip`؛ مرشحة للحذف في Phase 7.
- `StoreActivation.css` و`SmartCampaignCenter.css` و`WhatsAppSettings.css`: ما زالت تحمي التدفقات المعقدة داخليًا، بينما الغلاف والتنقل والمكونات المحورية من Design System.
- `SalesMobileCard` وبعض compact row helpers القديمة باقية للعرض المتوافق؛ لا يوجد جدول ثانٍ موازٍ.
- `Card/Btn/Input/Select` القديمة ما زالت داخل تفاصيل النماذج المهاجرة ولم تنشئ Workspace أو PageHeader أو Table جديدًا.
- CSS محلي في Retargeting وHatifLeads وSegments وCrmWorkspace موثق للتنظيف؛ لا raw tables داخله.
- `WhatsAppSendModal` و`IvrCampaignModal` وCSS الخاص بهما بقيا عمدًا لأنهما حواجز تنفيذ حساسة ومقفلة بالـhash.
- aliases التاريخية باقية داخل router لحماية deep links؛ لا تظهر في القائمة الرئيسية.

## 11. Gate decision

**PASS كامل لـBatch 4.**

انخفض التشعب فعليًا: مركز مبيعات واحد، مركز حملات واحد، Customer 360 واحد، DataTable واحد، وست وجهات عمل كحد أقصى لكل مركز. لم تُنقل CSS القديمة إلى أسماء جديدة، ولم تُضف stages أو segments أو eligibility rules جديدة.

**توقف التنفيذ هنا. لم يبدأ Batch 5 (التقارير).**

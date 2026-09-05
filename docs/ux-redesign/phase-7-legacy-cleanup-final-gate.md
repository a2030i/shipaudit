# Phase 7 — Legacy Cleanup & Final Hardening

التاريخ: 2026-09-04
النطاق: حذف/استبدال محافظ مبني على Legacy Dependency Map وCleanup Manifest فقط
النتيجة: **PHASE 7 PASS WITH DOCUMENTED EXCEPTIONS**

لم تُغيّر هذه المرحلة IA أو APIs أو قاعدة البيانات أو الصلاحيات أو أي Business Logic. لم يبدأ أي Phase 8 أو Performance refactor.

## 1. Baseline

| المقياس | قبل Phase 7 |
|---|---:|
| Routes المعروفة، بما فيها `/` | 70 |
| Production build | PASS |
| Build modules | 2,022 |
| Full suite | 535 / 534 pass / 0 fail / 1 skip |
| Business locks المحفوظة | 50 assertions / 45 unique files، كلها matched |
| raw `<table>` | 14 / 10 files |
| legacy/local `StatCard` | 25 / 3 files |
| legacy `DropZone` | 11 uses / 6 files + تعريف واحد في UI.jsx |
| legacy `<Modal>` وفق عدّ Phase 7 المباشر | 81 / 39 files |
| CSS يحمل `!important` | 39 files / 3,032 occurrence |
| mapped A dead files | 9 |
| `CenterWorkspace` | تعريف واحد / مستهلكان |

ملاحظة القياس: تقرير FSG السابق عدّ 87 Modal في 40 ملفًا بنمط أوسع. للمقارنة داخل Phase 7 ثُبّت النمط المباشر `<Modal>` عند 81/39، ولم يتغير هذا العدد في المرحلة.

## 2. Cleanup المنفذ

### 7.1 Dead components / CSS

حُذفت بعد إثبات عدم وجود imports أو routes أو dynamic imports أو tests:

- `src/pages/Marketers.jsx`
- `src/pages/Marketers.css`
- `src/pages/OperationsCenter.css`
- `src/pages/legal-escalation.css`
- `src/components/operations/FigmaCustomerPortfolio.jsx`
- `src/components/operations/figma-customer-portfolio.css`

لم يُحذف `FigmaCommandCenter.jsx` أو CSS الخاص به، ولا `Merchants.jsx`: كلاهما runtime-dead لكن ما زالت اختبارات عقود تقرأ المصدر مباشرة، ولذلك انتقلا من A إلى D بدل حذفهما مع فقدان التغطية.

### 7.2 Component replacement

- استُبدل `StatCard` في AuditResults وCashAging وCarrierProfile بـ`StatStrip` المركزي؛ صفر `<StatCard>` متبقٍ.
- أزيل export القديم لـ`StatCard` من `components/UI.jsx` بعد إثبات صفر مستهلك.
- نُقل غلاف `DropZone` إلى `EnterpriseUI` مع إبقاء `onFile`, `accept`, multi-file behavior، parsers وvalidation كما هي.
- أزيل export القديم لـ`DropZone` بعد تحويل المستهلكين الستة وإثبات صفر imports قديمة.
- الغلاف الجديد يدعم focus وEnter/Space ولا يغيّر parsing أو upload behavior.

### 7.3 Advanced utilities

استُبدلت الجداول الخام السبعة النشطة بغلاف `DataTable` المركزي دون تغيير صفوفها أو إجراءاتها أو queries:

- IvrSettingsTab: 3
- WhatsAppCampaignLog: 1
- LamhaStorePerformance: 1
- UploadsHub review: 1
- WebhookEvents: 1

المتبقي من raw tables خمسة فقط: اثنان داخل تنفيذ DataTable نفسه، واحد في public utility المعتمد، واثنان في `Merchants.jsx` المصنف D.

### 7.4 CSS cleanup

- حُذفت أربعة ملفات CSS ذات zero consumers ضمن قائمة A.
- حُذفت selectors الخاصة بـ`CenterWorkspace` بعد حذف wrapper.
- لم تُحذف أي طبقة CSS واسعة أو selector نشط اعتمادًا على التخمين.
- انخفض `!important` من 3,032 إلى 3,006، ومن 39 إلى 36 ملفًا. المتبقي له consumers فعلية أو يحتاج cascade proof مستقل.

### 7.5 Navigation / routes

- أزيل `CenterWorkspace` واستبدل باختيار مباشر للعرض النشط داخل App دون تغيير permission filtering أو المسارات.
- بقيت routes/aliases والـquery parameters كاملة؛ لم يُحذف أي deep link تاريخي.
- لم يُحذف `PAGE_TITLES['/payment-requests']` لأنه D — Investigate.

### 7.6 Dead code

- أزيلت exports الميتة `StatCard` و`DropZone` وimport الأيقونة الذي لم يعد مستخدمًا.
- أزيل wrapper `CenterWorkspace` وCSS الخاص به.
- لم تُمس services أو read models أو parsers أو controllers.

## 3. Before / after

| المقياس | قبل | بعد | النتيجة |
|---|---:|---:|---|
| Build modules | 2,022 | 2,021 | معلوماتي فقط |
| Full tests | 535 | 539 | 538 pass / 0 fail / 1 skip |
| Routes | 70 | 70 | محفوظة |
| raw tables | 14 / 10 files | 5 / 3 files | كل الجداول النشطة centralized |
| StatCard | 25 / 3 files | 0 | أُغلق |
| legacy DropZone export | 1 | 0 | أُغلق؛ 11 uses على DS |
| Modal | 81 / 39 files | 81 / 39 files | intentional keep |
| `!important` | 3,032 / 39 files | 3,006 / 36 files | خفض محافظ |
| A/dead files المحذوفة | 0 | 7، منها wrapper واحد | proof-based |
| obsolete navigation wrappers | 1 | 0 | أُغلق |
| dead routes removed | 0 | 0 | backward compatibility محفوظة |

## 4. Regression gates

بعد كل مجموعة حذف/استبدال شُغّل targeted gate ثم production build وfull suite. عند حذف CenterWorkspace اكتشف الاختبار فورًا dependency قديمة على الملف المحذوف؛ توقفت الدفعة، ونُقل العقد إلى App الفعلي، ثم عادت النتائج إلى الصفر فشلًا قبل الاستمرار.

النتيجة النهائية:

- Production build: **PASS — 2,021 modules**.
- Full suite: **539 tests / 538 pass / 0 fail / 1 intentional skip**.
- Phase 7 cleanup tests: **4/4 PASS**.
- Business Logic SHA contracts: **PASS** ضمن full suite؛ كل baselines المحفوظة matched.
- Financial/report/operations/campaign/permissions contracts: **PASS** ضمن الاختبارات الكاملة.
- Route/deep-link contracts: **PASS**؛ 70 route بقيت مسجلة.
- Console على Chrome: **0 errors / 0 warnings**.
- 1440 و375: لا document overflow، الصفحة غير فارغة، لا framework overlay.

## 5. Final live-browser limitation

جلسة Chrome المتاحة وصلت إلى شاشة تسجيل الدخول ولم تستعد جلسة Admin الحية المستخدمة في Final System Gate السابق. لم تُنشأ جلسة، ولم تُقرأ credentials، ولم تُعدّل permission data. لذلك لم تُعد الرحلات A–F حيًا بعد Cleanup، واعتمد هذا الجزء على:

- 6/6 live PASS من Final System Gate Rerun قبل Phase 7.
- بقاء route/journey contracts ناجحة بعد Cleanup.
- عدم تغيير ملفات navigation context helpers أو business controllers في Cleanup.

النتيجة لهذا الجزء: **CONTRACT PASS / POST-CLEANUP LIVE SESSION NOT VERIFIED**.

استثناء الصلاحيات يبقى كما هو: **CONTRACT PASS / LIVE SESSION NOT VERIFIED**.

## 6. Remaining intentional legacy

### INTENTIONAL KEEP — active and high-risk

- 81 legacy Modal uses في 39 ملفًا: flows حساسة تشمل WhatsApp/IVR/Zoho/bank/destructive confirmations. لم يوجد parity proof كافٍ لاستبدالها جماعيًا دون توسيع scope.
- legacy UI primitives Card/Btn/Badge/PageHeader/Input/Select: ما زالت لها consumers فعلية؛ حذفها يحتاج migration مستقل flow-by-flow، وليس safe cleanup.
- CSS ذات consumers فعلية، ومنها store-360/global compatibility layers و3,006 `!important`: إبقاؤها أفضل من كسر cascade نادر بلا consumer proof.
- public raw table في PublicInternationalRates: C — Keep.
- services/read models/parsers/business controllers/aliases/PageSlot/safe-area: C — Keep.

### D — Investigate

- `FigmaCommandCenter.jsx` و`figma-command-center.css`: لا runtime import، لكن 12 ملفات اختبار تقريبًا تعتمد مصدرهما لعقود لم تُنقل كلها إلى EnterpriseCommandCenter.
- `Merchants.jsx`: لا runtime route rendering، لكنه dependency مباشر لاختبار عقد مزامنة Lamha الآلية ويحتوي raw tables المتبقية.
- `/payment-requests` title metadata والـaliases التاريخية، خصوصًا `/legal`.
- formatting candidates وdynamic/feature-flag modules التي لا يكفي معها صفر import نصي.

## 7. Final verdict

**PHASE 7 PASS WITH DOCUMENTED EXCEPTIONS**

التنظيف المنفذ خفّض الـlegacy footprint المثبت دون تغيير business behavior، وأبقى كل deep links والـ70 route. الاستثناءان اللذان يمنعان وصف النتيجة بـ«zero legacy» هما dependencies الاختبارية لملفات runtime-dead، والـModal/UI/CSS النشطة عالية المخاطر. كما أن الرحلات الحية بعد Cleanup لم تُعد لغياب جلسة مصادق عليها؛ لا يوصف هذا الجزء Live PASS.

لا توجد Phase 8 منفذة أو مقترحة ضمن هذا التقرير.

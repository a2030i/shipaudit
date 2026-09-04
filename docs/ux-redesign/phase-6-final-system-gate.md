# Phase 6 — Final System Gate

التاريخ: 2026-09-04  
نوع المرحلة: تحقق فقط — لم يبدأ Phase 7 ولم يُحذف أو يُنظف أي Legacy.  
النتيجة النهائية: **FAIL**

## 1. Executive decision

اكتمل ترحيل المداخل الأساسية: لا توجد صفحة رئيسية ظاهرة خارج المراكز الثمانية، والـbuild والاختبارات وعقود الحسابات والصلاحيات الحالية ناجحة. لكن النظام لا يجتاز Gate كمنتج واحد بعد، لأن أربع رحلات عابرة للمراكز لا تكتمل بعقد سياق صريح، ولأن هناك تناقضًا ظاهرًا لنفس العميل بين الدليل وCustomer 360، وتسربًا مرئيًا من نظام التصميم المحلي للحملات، ومشكلة formatting حية في أرقام الهاتف، وفجوة وصولية في استعادة التركيز.

لا يجوز بدء Phase 7 قبل إغلاق البنود المانعة أدناه ثم إعادة هذا الـGate.

### Gate blockers

| ID | الشدة | الدليل | المطلوب قبل إعادة Gate |
|---|---|---|---|
| FSG-01 | مانع | صفوف Sales Result Set لا تفتح Customer 360؛ صفوف `retargeting` المعروضة لا تملك row link/`onRowClick` للعميل، والإجراءات الظاهرة تخص القنوات فقط. | ربط هوية العميل بـCustomer 360 مع `returnTo` والفلاتر والصفحة. |
| FSG-02 | مانع | Audience Result Set يعرض السجلات والأهلية، لكنه لا يوفر انتقالًا من السجل إلى Customer 360. | إضافة drill-down موحد دون تغيير eligibility أو handoff. |
| FSG-03 | مانع | Operations exception يفتح Carrier 360، لكن الرابط الناتج لا يحمل `returnTo` أو filter context، ويحمل `id` و`carrier` معًا. | تطبيع المعرّف وحفظ `returnTo/status/filters`. |
| FSG-04 | مانع | تقرير ذمم العملاء يحفظ سياق التقرير عند الدخول إلى `/customer-money`، ثم يفتح Customer 360 بصورة صحيحة، لكن العودة تتوقف في نتيجة التحصيل ولا توجد عودة صريحة للتقرير؛ الاعتماد على browser history قد يعيد المستخدم إلى Customer 360 مرة أخرى. | جعل سلسلة العودة تقرير ← Result Set ← Detail ← Result Set ← التقرير صريحة وتحفظ كل filters/date range. |
| FSG-05 | مانع | المتجر `199` يظهر في Customer Directory بذمم مفتوحة `1,094.72 ر.س`، بينما Customer 360 لنفس Store ID يعرض أنه لا يوجد حساب مالي مرتبط. | تفسير اختلاف المصدر داخل UI أو إصلاح ربط العرض؛ يمنع عرض موقفين ماليين متناقضين بلا provenance. |
| FSG-06 | مانع | أرقام هاتف حية تظهر بعلامة Excel apostrophe، ومنها Store `847`: `'+966550413239`، وظهرت عينات إضافية في الدليل. | normalization عرضي مركزي مع إبقاء القيمة المصدرية دون تغيير. |
| FSG-07 | مانع | مساحة الحملات ما زالت تعتمد `smart-campaign-center.css` كـvisual system مستقل، مع ألوان ومقاسات وأسـطح hard-coded؛ ليست مجرد استثناء وظيفي صغير. | نقل الأسطح والحالات والcontrols إلى tokens/primitives المركزية دون مس Business Logic. |
| FSG-08 | مانع | `PAGE_TITLES` لا يعرّف `/workspace/customers` و`/workspace/finance` و`/workspace/admin`؛ لذلك يظهر title عام في TopHeader لهذه المراكز. | إضافة metadata فقط للمسارات الثلاثة. |
| FSG-09 | مانع | Command Menu ينقل التركيز إلى حقل البحث عند الفتح، لكنه يعيده إلى `BODY` بعد Escape حتى عند الفتح من زر TopHeader. | استعادة التركيز إلى trigger السابق. |

## 2. Full migration inventory

تم استخراج الجرد من `KNOWN_PATHS` و`NAV_SECTIONS` والمسارات العامة و`/settings/*` الفعلية، وليس من تقارير الدفعات فقط.

| التصنيف المتنافي | العدد | ملاحظات |
|---|---:|---|
| Routes الكلية المعروفة، بما فيها `/` | **70** | 67 authenticated/technical + 3 public utilities |
| Primary workspaces | **8** | الرئيسية + 7 مسارات `/workspace/*` |
| Canonical detail/report routes | **29** | صفحات كيان، قوائم عمل، تقارير ووظائف متخصصة |
| Advanced/Admin/technical utilities | **13** | منها 12 وجهة إدارية/متقدمة و`/zoho-callback` تقني |
| Redirect-only aliases، بما فيها `/` | **17** | 16 legacy aliases + default root redirect |
| Public utilities | **3** | short/national address وinternational rates |
| Unmigrated primary user-facing routes | **0** | الشرط المستهدف متحقق |

قراءة التغطية حسب مصطلحات Phase 6:

- Migrated active user-facing surfaces: **49** = 8 workspaces + 29 detail/report + 12 admin/advanced.
- Merged legacy source routes: **16**.
- Redirected routes: **17** عند احتساب `/`، أو **16** legacy-only.
- Detail routes: **29**.
- Advanced/Admin utilities: **13** عند احتساب callback التقني.
- Legacy-only routes: **16**، كلها redirects وليست شاشات رئيسية.
- Unmigrated primary user-facing pages: **0**.

ملاحظة: `/upload` و`/bank` و`/cod-settlements` و`/payments` routes شرطية؛ تعمل كوجهات عامة canonical/merged، وتتحول إلى Carrier 360 عند وجود `carrier`. لذلك صُنفت ضمن canonical details لا redirect-only حتى لا تُحسب مرتين.

## 3. Information Architecture and navigation graph

### PASS

- الـPrimary Navigation يعرض بالترتيب: الرئيسية، العملاء، المبيعات، الحملات، المالية، التشغيل، التقارير، الإدارة.
- Desktop يملك Sidebar واحدة، والجوال يملك Bottom Navigation واحدة بأربع وجهات و«المزيد»؛ لا يوجد تكرار Drawer + Bottom Bar للمداخل نفسها.
- Detail pages وAdmin utilities مخفية من Primary Navigation وتبقى قابلة للوصول من workspace أو deep link.
- جميع الـ16 legacy aliases تحافظ على Route فعّال عبر redirect بدل كسر deep links.
- `subTabs` بقي metadata للصلاحيات والتوافق، ولا يبني Sidebar ثانية.

### Exceptions / findings

- Navigation graph يفشل في روابط الكيان داخل Sales وCampaigns وفي العودة الصريحة من Operations وReports كما في FSG-01..04.
- `CenterWorkspace` ما زال مستخدمًا في موضعين compatibility داخل `App.jsx`; لا يظهر كمركز رئيسي، لكنه wrapper قديم يحتاج استبدالًا قبل حذفه.
- `/short-address` و`/national-address` و`/international-rates` لا تملك روابط داخلية من النظام؛ هذا **Valid public exception** وليس orphan مؤكدًا.
- `PAGE_TITLES['/payment-requests']` موجود بلا route معروف؛ يصنف **Investigate**.
- ملفات العرض `Marketers.jsx` و`Merchants.jsx` بلا references فعلية بينما مساراهما redirects؛ هذه dead presentation candidates مثبتة، وليست خدمات البيانات التي ما زالت مستخدمة.

## 4. Cross-workspace journeys

| الرحلة | النتيجة | الدليل |
|---|---|---|
| A — Customers → Customer 360 → Finance/Collections → return | **PASS** | Store `199`; حفظ `status=all&page=0&source=final-gate`، وتبديل `view=finance/work`، ثم رجوع مطابق للمصدر. |
| B — Sales Result Set → Customer 360 → return | **FAIL** | صفوف result set لا توفر Customer 360 action أو row navigation. |
| C — Audience → Eligibility → Customer 360 → Preflight | **FAIL** | فتح إجمالي الجمهور أعطى 12 سجلًا و12 eligible، لكن السجلات لا تفتح Customer 360. |
| D — Finance reconciliation mismatch → Customer 360 → return | **PASS** | Store `847`; حفظ `tab=customers&status=mismatch&page=0&source=final-gate` وفتح finance tab ثم العودة نفسها. |
| E — Operations exception → Carrier 360 → COD/settlement → return | **FAIL** | فتح Aramex نجح؛ `returnTo` والفلاتر غائبة، وظهر `id` و`carrier` معًا. |
| F — Report → Result Set → entity → report context | **FAIL** | context متداخل محفوظ حتى Customer 360، لكن لا توجد عودة صريحة من Result Set إلى التقرير بنفس `q/range/from/to`. |

النتيجة: **2 PASS / 4 FAIL**.

## 5. Design System compliance

### Central foundation

- 65 ملف JSX يستورد `EnterpriseUI`.
- المكوّن المركزي يغطي Page/PageHeader/Breadcrumbs/Tabs/DataTable/FilterBar/Stat/StatusBadge/Dialog/Drawer/Form/Empty/Loading/Error.
- DataTable المركزي يملك sorting/filter/search/pagination/sticky header/columns/selection/bulk/states وعرض الجوال.

### Occurrence audit

| النوع | العدد | التصنيف |
|---|---:|---|
| raw `<table>` | **14 occurrences / 10 files** | 2 canonical داخل DataTable؛ 1 public valid؛ 4 داخل dead candidates؛ 7 active legacy leaks |
| native/custom `<button>` | **349 / 71 files** | ليست كلها مخالفة؛ تحتاج replacement ledger بدل حذف آلي |
| legacy `<Modal>` consumers | **87 / 40 files** | Replace then delete؛ الحواجز الحساسة لا تُمس قبل فصل controller عن presentation |
| `DropZone` render uses | **11 / 6 consumer files** | Replace then delete مع تثبيت parsing/validation |
| legacy/local `StatCard` | **25 render uses / 4 files** | Replace then delete |
| files rendering `PageHeader` | **62** | تعريفان مختلفان ما زالا موجودين: EnterpriseUI و`components/UI.jsx` |
| CSS files containing `!important` | **39** | **3,032 occurrences**؛ تشمل compatibility overrides وlegacy layers |

الـ7 raw tables النشطة خارج Design System:

- `components/IvrSettingsTab.jsx`: 3.
- `components/WhatsAppCampaignLog.jsx`: 1.
- `components/LamhaStorePerformance.jsx`: 1.
- `pages/UploadsHub.jsx`: 1.
- `pages/WebhookEvents.jsx`: 1.

الاستثناءات الصحيحة:

- `design-system/EnterpriseUI.jsx`: جدولان هما تنفيذ DataTable نفسه.
- `pages/PublicInternationalRates.jsx`: public utility مستقل.

## 6. Visual consistency and semantic color

### PASS

- في 1440px ثبت Sidebar عند 232px وTopHeader عند 64px في المراكز الثمانية، ولم يظهر page-level horizontal overflow.
- نفس shell وbreadcrumbs وbrand interaction مستخدمة في المراكز الثمانية.
- Primary navigation لا يستخدم ألوان أقسام مختلفة، ولا مربعات ملونة مستقلة لكل icon.
- semantic states المركزية تستخدم green/success، red/danger، amber/warning، والـbrand للتفاعل.

### FAIL / deferred

- الحملات تستخدم surface/typography/control palette محلية hard-coded؛ النتيجة مرئية كنظام فرعي مختلف.
- TopHeader metadata غير موحد في 3 workspaces بسبب FSG-08.
- `product-shell.css` و`navigation-hub.css` ما زالا يحملان قدرة legacy على section accents، رغم أن `NAV_SECTIONS` الحالي لا يمرر accents. هذا **Replace then delete/dead branch**، وليس تسرب لون ظاهر في الـPrimary Sidebar الحالي.
- كثير من status colors المحلية صحيحة معنويًا، لكن مصدرها raw hex/legacy variables لا tokens؛ يجب نقلها دون تغيير semantics.

## 7. RTL and formatting global gate

### PASS

- `Money`, `NumberValue`, `Identifier`, `Percent`, `DateTime` تستخدم `bdi/dir=ltr/unicode-bidi:isolate` مع tabular numerals.
- عينات `30,270.63 ر.س`، القيم السالبة، الصفر، النسب، IDs وAWBs بقيت متماسكة بصريًا.
- Breadcrumbs وpagination والأسهم تعمل داخل اتجاه RTL وفق العقود والاختبارات.

### FAIL

- leading apostrophe في الهواتف ظاهر حيًا: FSG-06.
- يوجد formatter presentation محلي واسع خارج Design System. البحث الموسع وجد 90 ملفًا يستخدم `fmt*` أو `toLocaleString` أو `Intl.NumberFormat`; هذا الرقم يشمل date/export/business formatting، لذا يصنف **Investigate ثم consolidate presentation-only**، ولا يجوز استبداله آليًا.

## 8. Responsive system gate

- تم قياس المراكز الثمانية على `375 / 390 / 430 / 768 / 1024 / 1280 / 1440` = **56 زيارة**، وأهم 6 detail views على 375 و1440 = **12 زيارة** إضافية.
- النتيجة: **68/68** بلا document horizontal overflow.
- Bottom Navigation: 64px على الجوال؛ صفحات Design System تترك 96px end padding، وpagination تتوقف فوق القائمة.
- أعلى header مقاس في عينات المراكز كان 115px على 375px، فلا يستهلك نصف الشاشة.
- DataTable يتحول إلى compact records؛ customer/reconciliation/admin بقيت قابلة للقراءة.
- تدقيق viewport الفعلي للحملات/Carrier 360/التحصيل على 375px: لا control ظاهر أصغر من 32px؛ بقيت عدة controls بين 32 و39px في Carrier 360 والحملات وتحتاج تحسينًا، لكنها ليست مانع overflow.

النتيجة الهيكلية: **PASS WITH TOUCH-SIZE DEBT**. لا تلغي هذه النتيجة فشل الـSystem Gate العام.

## 9. Accessibility

### PASS

- عينة Reports Workspace: 38 controls مرئية، 0 بلا accessible name، 0 inputs بلا label، و0 duplicate IDs.
- Command Menu يفتح بـCtrl+K وينقل التركيز إلى search input.
- الصفوف المركزية تستخدم Enter/Space وfocus-visible، والـDataTable يحمل caption/roles.
- dialogs المركزية تملك semantics وعزل الخلفية وفق اختبارات العقد.

### FAIL / legacy leakage

- Command Menu لا يعيد focus إلى trigger بعد Escape: FSG-09.
- `HatifLeads.jsx` يملك `role="dialog"` محليًا بلا `aria-modal`; يحتاج replacement ضمن modal migration.
- بعض legacy dialogs/forms تعتمد semantics محلية؛ لا يمكن منح Accessibility PASS كامل قبل استبدالها أو توثيقها كاستثناءات وظيفية.

## 10. Global business-logic integrity

### Automated result

- Focused Phase 6 + reference + layout gates: **74 tests; 73 pass; 0 fail; 1 intentional skip**.
- Full repository suite: **523 tests; 522 pass; 0 fail; 1 intentional skip**.
- Production build: **PASS**, 2,019 modules transformed.
- SHA-256 baselines persisted in code: **50 assertions over 45 unique files** across Sales/Campaigns, Reports, Auth/Permissions/Admin/Integration; كلها matched.

### Baseline evidence gap

- Batch 3 report states that 16 operational files matched a pre-migration SHA-256 baseline, but the 16 numeric baseline values are not persisted in tests/docs. لذلك لا يمكن للـFinal Gate إعادة المقارنة مستقلاً؛ النتيجة: **historical claim present / independent SHA re-verification unavailable**.
- Batches 1–2 have parity/contract tests and live comparison reports, but no persisted SHA baseline map.

لا يوجد دليل على تغير finance calculations، Zoho mappings، collections eligibility، shipment/COD/settlements، sales/campaign rules، report metrics، permissions أو integrations. لكن سجل الإثبات المشفر ليس كاملًا تاريخيًا لكل Batches 1–3.

## 11. Cross-system data parity

- **Customer identity:** Store IDs والأسماء والهواتف تنتقل صحيحة في رحلتي Customer وReconciliation.
- **Customer financial position:** **FAIL** على Store `199` بسبب FSG-05.
- **Customer formatting:** **FAIL** على Store `847` وعينات الدليل بسبب FSG-06.
- **Carrier identity:** Aramex ظهر بالهوية نفسها في Operations وCarrier 360 وCarrier KPI.
- **Carrier state/context:** Operations يعرض 12 عملية غير مرتبطة بالمراجعة، ويتسق مع سجل Batch 3؛ لا تناقض حالة مثبت.
- **Carrier financial values:** تعرض الشاشات تعريفات مختلفة (ledger net مقابل balance/COD)، ولم يثبت اختلاف معادلة، لكن العودة والسياق غير مكتملان كما في FSG-03.

## 12. Permissions — live session gate

النتيجة الدقيقة: **CONTRACT PASS / LIVE SESSION NOT VERIFIED**.

- الجلسة الحية المتاحة كانت Admin فقط.
- لم يُنشأ مستخدم، ولم تتغير permissions لغرض الاختبار.
- route guards وvisibility filtering وRPC/backend permission contracts اجتازت الاختبارات، بما فيها منع self-escalation وmoney writes وPII وbulk assignment وadmin integrations.
- لا يجوز وصف limited-user sidebar/direct URL/forbidden action/backend denial بأنها Live PASS حتى تتوفر جلسة محدودة فعلية آمنة.

## 13. Loading, empty, error and failure states

- Loading: ظهرت states مركزية أثناء تحميل Customer 360 والحملات والتقارير.
- Empty: بحث تقرير غير موجود أعطى `لا توجد تقارير تطابق البحث والفلاتر`.
- Missing entity: Store ID غير موجود أعطى Alert صريحًا ورفض عرض ملف ناقص على أنه Customer 360 مكتمل.
- Integration unavailable: الحملات أظهرت أن WhatsApp متوقف لغياب موظف Hatif، وعطلت الاستمرار؛ fail-closed.
- Stale/timeout/partial/unauthorized/forbidden: covered بعقود الاختبارات؛ لم تُحقن failures شبكية حية ولم تتوفر جلسة limited-user.
- statement timeout السابق في Batch 4 لم يتكرر في جلسة Final Gate.
- Browser console: 0 errors و0 warnings تطبيقية؛ الظاهر فقط Vite/React development info/debug.

النتيجة: **CONTRACT PASS / PARTIAL LIVE VERIFICATION**.

## 14. Performance sanity

- لا render loop أو console storm ظاهر في الجولة الحية.
- `PageSlot` يركب الصفحة عند أول زيارة، ويبقيها mounted مع `isActive` لمنع polling المخفي؛ العقود الخاصة بذلك ناجحة.
- build ناجح، لكن توجد flags واضحة لمرحلة مستقلة بعد cleanup:
  - global `index` CSS: **373.94 kB raw / 62.32 kB gzip**.
  - `CollectionsHub`: **239.36 kB raw / 72.25 kB gzip**، أكبر route-owned chunk.
  - vendor chunks الكبيرة: MapLibre 935.99 kB، XLSX 499.55 kB، PDF.js 408.13 kB؛ هي lazy/feature-specific وفق build، ولا يوجد دليل أنها regressions جديدة.
  - `SmartCampaignCenter.css`: 16.98 kB، وStore 360 CSS المتراكم يتجاوز 48 kB عبر ملفين.

النتيجة: **PASS للسلوك الأساسي، مع footprint debt موثق**. لا Performance refactor في هذا Gate.

## 15. Legacy dependency map

### A — Safe to delete بعد إعادة Gate وقبل أي مجموعة حذف

هذه العناصر لا تملك references فعلية حاليًا؛ المسارات ذات الصلة redirects:

- `src/pages/Marketers.jsx`
- `src/pages/Marketers.css` — self-import فقط من الملف أعلاه.
- `src/pages/Merchants.jsx`
- `src/pages/OperationsCenter.css` — لا import.
- `src/pages/legal-escalation.css` — لا import، و`/legal` redirect.
- `src/components/operations/FigmaCommandCenter.jsx`
- `src/components/operations/figma-command-center.css`
- `src/components/operations/FigmaCustomerPortfolio.jsx`
- `src/components/operations/figma-customer-portfolio.css`

ملاحظة: لا تشمل القائمة `marketersService.js` أو `merchantsService.js`; الخدمات مستخدمة فعليًا وتدخل C — Keep.

### B — Replace then delete

#### Components and wrappers

- legacy primitives في `src/components/UI.jsx`: `Card`, `Btn`, `Badge`, legacy `PageHeader`, `StatCard`, `Modal`, `Input`, `Select`, `DropZone`.
- local `StatCard` داخل `CarrierProfile.jsx`، وlegacy StatCard في `AuditResults.jsx` و`CashAging.jsx`.
- `CenterWorkspace.jsx` — مستخدم مرتين في `App.jsx`.
- active raw tables السبعة المدرجة في §5.
- local status presentations في `WorkAgents.jsx` و`ZohoData.jsx`.
- custom tabs في `LamhaFinancialAccountReview`, `CustomerMoney`, `CustomerWatch`, `Store360Page`, `PlatformSalesCrm`; يُستبدل page-level navigation فقط، وتبقى micro-filters الحقيقية.
- legacy/custom dialogs: 87 consumers في 40 ملفًا؛ يبدأ الاستبدال بالأقل خطورة، وتؤجل حواجز WhatsApp/IVR/Zoho/bank/destructive حتى توجد parity tests لكل flow.
- `CampaignResultModal`, `WhatsAppSendModal`, `IvrCampaignModal`, `StatementUploadModal`: استبدال presentation shell فقط؛ controller/preflight/confirmation يبقى.

#### CSS layers

- global legacy: `index.css`, `design-v5.css`, `workspace-layout.css`, `product-shell.css`, `operations-os.css`, `shipaudit-os-v2.css`, `mobile-experience.css`.
- page/workspace legacy: `smart-campaign-center.css`, `PlatformSalesCrm.css`, `store-360.css`, `carrier-360.css`, `CustomerFinanceCenter.css`, `finance-executive.css`, `Reconciliation.css`, `StoreActivation.css`, `WhatsAppSettings.css`, `ZohoData.css`.
- compatibility overrides: `design-system/reference-screens.css` وأجزاء `shell.css/responsive.css/components.css` التي تستخدم `!important`; تزال القواعد بعد إزالة المصدر القديم، وليس قبلها.
- operational compatibility: `customer-context-drawer.css`, `aging-operations-queue.css`, `operational-result-set.css`, `lamha-store-operations.css`, `sales-mobile-card.css`, `batch4-workspaces.css`, `enterprise-workspaces.css`.

### C — Keep

- كل services/read models/parsers/business logic وSupabase migrations.
- `NavigationHub.jsx` و`navigation-hub.css` للـCommand Menu/compact directory الحاليين؛ تزال فقط الفروع القديمة بعد إثباتها.
- `mobile-scroll.css` وحاجز safe-area/PageSlot end spacer الحالي.
- `PageSlot` keep-alive و`isActive` polling contract.
- `NAV_SECTIONS`, `NAV_ITEM_IA`, route aliases و`subTabs` permission metadata حتى Route Cleanup المعتمد.
- `Forecast` SVG renderer؛ visualization ذات معنى وعقد metric محفوظ.
- Public utilities وCSS الخاص بها، ومنها raw table في `PublicInternationalRates`.
- parsing/validation/upload-progress/duplicate handling خلف DropZone؛ يتغير wrapper لا المنطق.
- business controllers داخل modals الحساسة بعد نقل presentation.
- `marketersService.js` و`merchantsService.js` وكل الخدمات المستهلكة من Customer/Sales/Campaigns.

### D — Investigate

- `PAGE_TITLES['/payment-requests']` بلا route معروف.
- الحاجة الدائمة لكل legacy aliases، خصوصًا `/legal`; الحذف يتطلب telemetry/product approval لا مجرد صفر references داخل repo.
- formatter occurrences في 90 ملفًا: فصل presentation duplicates عن exports/date semantics/business calculations قبل consolidation.
- فروع CustomerWatch القديمة غير القابلة للوصول، وأي `legacy`/feature-flag fallback؛ يلزم إثبات بيئي قبل الحذف.
- `product-shell/navigation-hub` section-accent branches غير المستخدمة حاليًا.
- suspected dead exports/components الأخرى التي قد تُستهلك dynamicًا؛ يلزم dependency graph/build proof لا بحث اسم فقط.
- numeric SHA baselines التاريخية لـBatches 1–3؛ يلزم استعادتها من artifact/commit موثوق أو إنشاء baseline جديد بعد اعتماد الحالة الحالية.

## 16. Phase 7 Cleanup Manifest — غير منفذ

هذه الخطة مشروطة بإغلاق FSG-01..09 وإعادة Final Gate بنتيجة PASS أو PASS WITH DOCUMENTED EXCEPTIONS.

### 1. Safe deletion

1. أعد `rg` وbuild graph لإثبات صفر references لعناصر A.
2. احذف مجموعة صغيرة واحدة فقط.
3. شغّل build + full tests + deep-link smoke.
4. لا تضم services أو aliases في هذه المجموعة.

### 2. Component replacement

1. أغلق عوائق الرحلات وCustomer parity/phone normalization/page titles/focus restoration أولًا.
2. استبدل raw tables النشطة بـDataTable: WhatsApp log، IVR، Lamha performance، Uploads review، Webhook details.
3. استبدل StatCard/PageHeader/status/tabs المحلية.
4. استبدل dialogs الأقل خطورة، ثم الحساسة flow-by-flow مع preflight/permission/API parity.
5. استبدل DropZone wrapper دون لمس parsers أو validation.

### 3. CSS removal

1. ابدأ CSS ذات صفر references.
2. أزل page CSS بعد اكتمال component replacement الخاص بها.
3. أزل global legacy layers قاعدة/مجموعة صغيرة في كل مرة.
4. بعد كل إزالة، قلّل compatibility `!important` الذي لم يعد له خصم في cascade.
5. لا تلمس `store-360.css` أو طبقات global الكبيرة دفعة واحدة.

### 4. Route cleanup

1. أصلح metadata وreturn contracts أولًا.
2. حافظ على aliases المستخدمة؛ اجمع telemetry إن توفرت.
3. نظف dead title/route metadata فقط بعد إثبات.
4. أي إزالة alias قرار منتج مستقل مع migration للروابط المحفوظة.

### 5. Dead code

1. شغّل dependency graph على exports وlazy imports وfeature flags.
2. احذف الفروع غير القابلة للوصول بعد test يغطي الوجهة البديلة.
3. لا تعتبر صفر import النصي كافيًا للخدمات أو dynamic modules.

### 6. Final verification

بعد كل مجموعة حذف:

1. Production build.
2. Full test suite.
3. SHA-256 business locks.
4. Router/deep-link inventory.
5. الرحلات A–F.
6. Responsive matrix 375–1440.
7. Admin + limited-user live permission sessions.
8. Console/network/failure-state smoke.
9. CSS/reference recount، ثم إثبات أن footprint انخفض ولم يظهر pattern جديد.

## 17. Final verdict

**SYSTEM FAIL**

- Migration coverage: PASS — primary unmigrated = 0.
- Navigation integrity: FAIL — أربع رحلات ناقصة.
- Design System compliance: FAIL — campaign/local legacy leakage مانع.
- Visual consistency: FAIL — campaign + 3 missing page titles.
- RTL/formatting: FAIL — quoted phone values.
- Responsive: PASS WITH DEBT.
- Accessibility: FAIL — focus restoration + legacy dialog debt.
- Business Logic integrity: PASS للعقود والـ45 hash baselines المحفوظة؛ evidence gap لـBatches 1–3.
- Cross-system data parity: FAIL — Store 199 contradiction.
- Permissions: CONTRACT PASS / LIVE SESSION NOT VERIFIED.
- Failure states: CONTRACT PASS / PARTIAL LIVE VERIFICATION.
- Performance sanity: PASS WITH DOCUMENTED FOOTPRINT DEBT.
- Legacy inventory: مكتمل كـA/B/C/D؛ لم يُحذف شيء.

Phase 7 لم يبدأ، ويظل محظورًا حتى إعادة Final System Gate بعد معالجة البنود المانعة.

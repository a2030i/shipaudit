# Phase 6 — Final System Gate (Rerun)

التاريخ: 2026-09-04  
نوع المرحلة: تحقق كامل بعد Remediation Sprint  
النتيجة: **SYSTEM PASS WITH DOCUMENTED EXCEPTIONS**

هذه إعادة كاملة لنفس الـFinal System Gate؛ ليست Gate مختصرة. لم يبدأ Phase 7 ولم يُحذف أي Legacy.

## 1. Executive decision

أغلقت البنود `FSG-01..FSG-09` كلها. المراكز الثمانية تتصرف الآن كنظام واحد، والرحلات A–F اجتازت التحقق الحي، والتناقض المالي للمتجر 199 زال عبر مصدر الحقيقة الحالي لا عبر إعادة حساب في UI.

الاستثناء الوحيد المتعلق بالصلاحيات الحية هو:

> **CONTRACT PASS / LIVE SESSION NOT VERIFIED**

الجلسة المتاحة Admin فقط؛ لم يُنشأ حساب ولم تتغير permission data للاختبار. توجد أيضًا ديون موثقة وغير مانعة تخص Legacy/touch sizes واكتمال الأدلة التاريخية للـhashes، وكلها باقية للـCleanup Manifest أو تحقق مستقل.

## 2. Full migration inventory

أعيد فحص `KNOWN_PATHS` والـrouter وnavigation metadata الفعلية.

| التصنيف | العدد |
|---|---:|
| Routes الكلية المعروفة، بما فيها `/` | 70 |
| Primary workspaces | 8 |
| Migrated active user-facing surfaces | 49 |
| Canonical detail/report routes | 29 |
| Advanced/Admin/technical utilities | 13 |
| Merged legacy source routes | 16 |
| Redirect-only routes، باحتساب `/` | 17 |
| Legacy-only routes | 16 |
| Public utilities | 3 |
| Unmigrated primary user-facing routes | **0** |

الشرط `Unmigrated primary user-facing pages = 0` متحقق.

## 3. Information Architecture / Navigation Graph

**PASS**

- المداخل الرئيسية: الرئيسية، العملاء، المبيعات، الحملات، المالية، التشغيل، التقارير، الإدارة.
- لا تظهر detail routes أو admin utilities كوجهات رئيسية.
- Desktop Sidebar واحدة، وMobile Bottom Navigation بأربع وجهات و«المزيد» دون Drawer مكرر للمداخل نفسها.
- aliases الستة عشر تبقى فعالة وتحافظ على query parameters.
- لا توجد orphan user-facing route مثبتة. public utilities الثلاثة استثناء public صحيح.
- `CenterWorkspace` باقٍ في موضعين compatibility ومصنف Replace then delete، لكنه لا يصنع مدخل navigation موازيًا.

## 4. Cross-workspace journeys

| Journey | النتيجة | الدليل الحي |
|---|---|---|
| A — Customers | PASS | store 199: Customer Directory → Customer 360 → finance → collections/work → رجوع مطابق لـ`search/status/page/source`. |
| B — Sales | PASS | retargeting row → store 75 Customer 360؛ حافظ على `view=retargeting&status=all&page=0` ثم عاد مطابقًا. |
| C — Campaign | PASS | Audience `all` → Zerosouq store 1115 → Customer 360 → رجوع لنفس audience result وpreflight context. |
| D — Finance | PASS | reconciliation mismatch → store 847 → finance tab → رجوع مطابق لـ`tab/status/page/source`. |
| E — Operations | PASS | Aramex exception → Carrier 360 ledger؛ `id` وحيد، لا `carrier` مكرر، وعودة كاملة لـfilters/page. |
| F — Reports | PASS | report filters/date → Customer Money result page 2 → preview → Customer 360 → result page 2 → التقرير بنفس الفترة والفلاتر. |

النتيجة: **6/6 PASS**.

## 5. Design System compliance

**PASS WITH LEGACY REPLACEMENT DEBT**

- 65 ملف JSX يستورد `EnterpriseUI`.
- Page/PageHeader/Breadcrumbs/Tabs/DataTable/FilterBar/Stat/StatusBadge/Dialog/Drawer/Form/Empty/Loading/Error هي الأساس المشترك.
- الحملات أصبحت تستخدم primitives المركزية؛ ملف CSS المحلي لم يُحذف تنفيذًا لحظر Cleanup، ويصنف B لا leakage مانعًا.

الجرد الحالي:

| النوع | العدد | التصنيف |
|---|---:|---|
| raw `<table>` | 14 / 10 files | 2 DataTable internals، 1 public valid، 4 dead candidates، 7 active replace-then-delete |
| legacy `<Modal>` | 87 / 40 files | B — Replace then delete |
| `<DropZone>` | 11 / 6 files | B — replace wrapper فقط |
| legacy/local `<StatCard>` | 25 / 3 files | B — انخفض عدد ملفاتها بعد إزالة campaign summary المحلي |
| files rendering PageHeader | 62 | definition المركزية + legacy definition باقية |
| CSS files with `!important` | 39 files / 3,032 occurrences | B/D حسب dependency proof |
| presentation-format candidates | 91 files | D — يلزم فصل العرض عن export/business semantics |

الـraw tables النشطة المؤجلة: IvrSettingsTab (3)، WhatsAppCampaignLog، LamhaStorePerformance، UploadsHub، WebhookEvents.

## 6. Visual consistency / Semantic color

**PASS**

- Sidebar/TopHeader/PageHeader/Breadcrumbs/content width/Tabs/DataTable/FilterBar/StatStrip واحدة عبر المراكز الثمانية.
- عناوين workspaces الثلاثة الناقصة أصبحت من `PAGE_TITLES` المركزي.
- الحملات تستخدم surface/border/radius/brand/semantic tokens نفسها؛ لا section palette ظاهرة.
- Green للنجاح، Red للخطر، Amber للتحذير، وBrand للتفاعل/الاختيار.
- لا gradients أو glassmorphism أو colored icon tiles جديدة.

## 7. RTL and formatting

**PASS**

- Money/Number/Percent/Identifier/Date/Phone تستخدم isolation وLTR للأجزاء الرقمية.
- القيم السالبة، `0.00`، residuals وSAR بقيت بدقة منزلتين دون اختصار.
- apostrophe الخاص بـExcel يزال عرضيًا فقط عند تطابق هاتف سعودي مؤكد؛ لا تعديل للقيمة المخزنة أو export schema.
- تحقق حي لـ`+966550413239` في Reconciliation وCustomer 360 بلا artifact.

## 8. Responsive system gate

**PASS WITH DOCUMENTED TOUCH-SIZE DEBT**

- المراكز الثمانية × `375/390/430/768/1024/1280/1440` = **56/56** بلا document horizontal overflow وبعناوين محملة.
- Customer 360 وCarrier 360 وCustomer Money على 375 و1440 = **6/6** بلا overflow.
- Bottom Navigation موجودة على المقاسات الصغيرة ولا تغطي المحتوى.
- الجداول تستخدم compact/mobile records حيث يلزم، والـfilters/forms/dialogs قابلة للاستخدام.
- بقيت بعض controls القديمة بين 32–39px وبعض icon actions الأصغر في Operations عند 768؛ موثقة لـPhase 7/Accessibility وليست ناتجة من Remediation.

## 9. Accessibility

**PASS WITH LEGACY DEBT**

- Command Menu يعيد focus بعد Escape وزر الإغلاق والاختيار.
- DataTable rows قابلة للوحة المفاتيح وتحمل captions/names.
- focus-visible موحد في الحملات، والـcentral dialogs تعزل الخلفية وتعيدها.
- legacy local dialogs، ومنها Hatif dialog بلا `aria-modal`، تبقى B — Replace then delete ولا تُحذف في هذا Gate.

## 10. Global Business Logic integrity

**PASS**

- Full suite: **535 tests / 534 pass / 0 fail / 1 intentional skip**.
- Production build: **PASS، 2,022 modules transformed**.
- SHA-256 persisted locks: **50 assertions over 45 unique files**، كلها matched:
  - Sales/Campaigns: 18 files.
  - Reports/read models/exporters: 18 files.
  - Auth/permissions/admin/integrations/pricing: 14 files.
- ملفات finance formulas وZoho mappings وshipment/COD/settlement وeligibility لم تتغير في sprint.

استثناء دليل تاريخي: أرقام hashes لملفات Batch 3 الستة عشر لم تُحفظ في artifact قابل لإعادة الحساب، وباتش 1–2 يعتمدان parity/contracts بلا baseline map. هذا evidence gap قديم، لا اختلاف hash مكتشف.

## 11. Cross-system data parity

**PASS**

- Store 199: الدليل وCustomer 360 متفقان على غياب الحساب المالي؛ لا دين من compatibility link.
- Store 1996: القيمة المرتبطة فعليًا بقيت `1,047.90 ر.س` من core read model.
- Store 847: identity/phone/financial reconciliation تنتقل للسجل نفسه، والصياغة موحدة.
- Aramex: identity والـ12 unmatched operations والسياق المالي التشغيلي متسقة بين Operations وCarrier 360.
- لا يوجد حساب مالي جديد داخل component؛ واجهة الدليل تعرض نتيجة read model الحالي فقط.

## 12. Permissions — Live Session Gate

**CONTRACT PASS / LIVE SESSION NOT VERIFIED**

- جلسة Admin فقط كانت متاحة.
- route guards، navigation visibility، action eligibility وbackend/RPC permission contracts ضمن full suite ناجحة.
- لم تُنشأ جلسة محدودة ولم تُعدّل permissions.
- هذا الاستثناء لا يوصف Live PASS، ولا يخفي أن backend contract هو الحماية وليس إخفاء الزر فقط.

## 13. Error / Empty / Loading / Failure states

**CONTRACT PASS / PARTIAL LIVE VERIFICATION**

- loading/empty/missing entity/integration unavailable ظهرت states صريحة.
- حملة WhatsApp فشلت fail-closed عند غياب موظف Hatif ولم تسمح بتجاوز safeguard.
- store financial verification يفشل إلى `المصدر غير متاح` لا إلى صفر مضلل.
- timeout/partial/unauthorized/forbidden تغطيها العقود؛ لم تُحقن failure شبكية حية ولم تتوفر limited session.
- جولة Chrome: **0 console errors / 0 warnings**؛ السجل 66 Vite debug و34 React/Vite info فقط. لا API error ظاهر في الرحلات.

## 14. Performance sanity

**PASS WITH DOCUMENTED FOOTPRINT DEBT**

- لا render loops أو duplicate-call storm ظاهر في Chrome.
- التحقق المالي الإضافي محدود بالصفوف المرئية ذات الدين، cached، ويستخدم core RPC الحالي.
- الأحجام البارزة لم تتغير ماديًا: global CSS 373.94kB، CollectionsHub 239.88kB، MapLibre/XLSX/PDF.js lazy chunks باقية.
- لا performance refactor في هذا sprint.

## 15. Legacy dependency map

### A — Safe to delete

بعد إعادة reference proof في Phase 7 فقط:

- `src/pages/Marketers.jsx`
- `src/pages/Marketers.css`
- `src/pages/Merchants.jsx`
- `src/pages/OperationsCenter.css`
- `src/pages/legal-escalation.css`
- `src/components/operations/FigmaCommandCenter.jsx`
- `src/components/operations/figma-command-center.css`
- `src/components/operations/FigmaCustomerPortfolio.jsx`
- `src/components/operations/figma-customer-portfolio.css`

### B — Replace then delete

- primitives القديمة في `components/UI.jsx`: Card/Btn/Badge/PageHeader/StatCard/Modal/Input/Select/DropZone.
- CenterWorkspace في موضعين compatibility.
- raw tables السبعة النشطة.
- StatCard في AuditResults/CarrierProfile/CashAging.
- 87 Modal consumers و11 DropZone uses، مع تثبيت controllers/parsing/preflight أولًا.
- `smart-campaign-center.css` بعد إثبات اكتمال tokenized replacement، وStore 360/Finance/Reconciliation/Zoho/WhatsApp page CSS.
- global layers وcompatibility `!important` بعد إزالة المصدر الذي كانت تغطيه.

### C — Keep

- services/read models/parsers/migrations/business controllers.
- NAV_SECTIONS/NAV_ITEM_IA/aliases/subTabs permission metadata.
- PageSlot و`isActive` polling contract وmobile safe area.
- public utilities، Forecast SVG، export schemas وupload parsing/validation.
- marketersService/merchantsService والخدمات المستخدمة فعليًا.

### D — Investigate

- `PAGE_TITLES['/payment-requests']` بلا route معروف.
- aliases التاريخية، خصوصًا `/legal`، حتى يتوفر telemetry/product approval.
- 91 formatting candidates: فصل presentation عن export/date/business semantics.
- dynamic/feature-flag modules وdead exports المشتبه بها.
- historical numeric SHA baselines لـBatches 1–3.

## 16. Phase 7 Cleanup Manifest — غير منفذ

1. **Safe deletion:** reference graph → مجموعة صغيرة → build/full tests/deep-link smoke.
2. **Component replacement:** raw tables ثم StatCard/PageHeader/status/tabs ثم dialogs/DropZone من الأقل للأعلى خطورة.
3. **CSS removal:** zero-reference CSS أولًا، ثم page layers، ثم global layers، ثم تقليل `!important` بعد زوال خصم الـcascade.
4. **Route cleanup:** dead metadata أولًا؛ لا إزالة alias بلا telemetry وقرار منتج وحفظ الروابط.
5. **Dead code:** dependency/build proof لكل export وdynamic module؛ صفر import نصي لا يكفي للخدمات.
6. **Final verification بعد كل مجموعة:** build، full tests، hashes، route inventory، A–F، responsive matrix، Admin + limited user، console/network، وإعادة عدّ footprint.

## 17. Final verdict

**SYSTEM PASS WITH DOCUMENTED EXCEPTIONS**

- Migration coverage: PASS.
- Navigation integrity: PASS.
- Cross-workspace journeys: 6/6 PASS.
- Design System/visual/semantic color: PASS مع replacement debt موثق.
- RTL/formatting: PASS.
- Responsive: PASS مع touch-size debt موثق.
- Accessibility: PASS للـcentral system وFSG-09؛ legacy dialog debt موثق.
- Business Logic/Data parity: PASS.
- Permissions: CONTRACT PASS / LIVE SESSION NOT VERIFIED.
- Failure states: CONTRACT PASS / PARTIAL LIVE VERIFICATION.
- Performance sanity: PASS مع footprint debt.
- Legacy inventory: A/B/C/D مكتمل، ولم يُحذف شيء.

Phase 7 لم يبدأ. القرار التالي يحتاج اعتماد هذا التقرير ثم تنفيذ الـCleanup Manifest جراحيًا، مجموعة صغيرة في كل مرة.

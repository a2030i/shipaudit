# Phase 6 — Batch 5 Reports & Analytics Gate

**Status: PASS**  
**Scope:** التقارير والتحليلات فقط. لم يبدأ Batch 6 أو Phase 7.

## 1. Scope map قبل التنفيذ

| الوجهة / العرض | التصنيف | الوجهة النهائية | مصادر القراءة والاعتماد |
|---|---|---|---|
| `/workspace/reports` | Migrate | Reports Workspace الموحد | فهرس عرضي فقط؛ لا يحسب مؤشرات |
| `/reports` | Merge + Redirect | `?view=builder` | `zohoReportsService`, `monthlyReportService`, exporters |
| `/monthly-report` | Merge + Redirect | `?view=monthly` | `monthlyReportService` |
| `/internal-exports` | Merge + Redirect | `?view=exports` | `internalExportsService`, `weightBillingService` |
| `/customer-money?view=money` | Keep as detail/report view | يفتح من فهرس التقارير | read models الحالية للذمم والتحصيل |
| `/workspace/sales?view=pipeline` | Keep as detail/report view | يفتح من فهرس التقارير | `retargetingService` |
| `/workspace/sales?view=overview` | Keep as detail/report view | يفتح من فهرس التقارير | customer growth snapshot/taxonomy |
| `/pnl` | Keep as detail/report view | يفتح من فهرس التقارير | `pnlService`, Zoho reports |
| `/cash-aging` | Keep as detail/report view | يفتح من فهرس التقارير | `cashAgingService` |
| `/forecast` | Migrate report presentation + keep detail | يفتح من فهرس التقارير | `forecastService` |
| `/reconciliation` | Keep as detail/report view | يفتح من فهرس التقارير | reconciliation read model |
| `/carrier-kpi` | Migrate report presentation + keep detail | يفتح من فهرس التقارير | `carrierStatementsService`, `carrierScore` |
| `/platform-carriers` | Migrate report presentation + keep detail | يفتح من فهرس التقارير | `platformCarriersService` |
| `/whatsapp-settings?tab=impact` | Keep as detail/report view | يفتح من فهرس التقارير | WhatsApp/IVR logs |
| `/workspace/campaigns?view=results` | Keep as detail/report view | يفتح من فهرس التقارير | `smartCampaignService`, audience contracts |
| `/activity-log` | Deprecated navigation only | بقي رابطًا إداريًا مباشرًا | سجل النظام؛ لم يعد تقريرًا في الفهرس |

Dependencies المحمية شملت Zoho Books، ذمم العملاء والموردين، ledger الناقلين، audits، bank reconciliation، P&L، cash aging، forecast، sales taxonomy، audience eligibility، campaign history، وملفات Excel/PDF الحالية. لم يتغير API أو query أو read model أو مخطط export.

## 2. Coverage

- Migrated presentation/views: **7** (`ReportsWorkspace`, builder, monthly, exports, forecast, carrier KPI, platform comparison).
- Merged into workspace tabs: **3**.
- Redirected legacy routes: **3**.
- Existing detail/report destinations retained: **11**.
- Deprecated from report navigation only: **1** (`activity-log`).
- Remaining in Batch 5: **0**.

كل تحويل قديم يبدأ من `URLSearchParams` الواردة ويحفظ `month`, `carrier`, `kind`, `page`, `from`, `to`, `report`, entity identifiers و`returnTo`. تحقق المتصفح من المثال:

`/monthly-report?month=2026-08&carrier=abc&returnTo=/workspace/reports`

وأصبح:

`/workspace/reports?month=2026-08&carrier=abc&returnTo=%2Fworkspace%2Freports&view=monthly&source=monthly-report-alias`

## 3. Metric contract and parity

- Metrics mapped: **54**.
- Matched: **54**.
- Mismatched: **0**.
- Unmapped: **0**.

كل Contract يسجل الاسم، التعريف، المصدر، الفترة، الفلاتر، aggregation، null behavior، نوع القيمة، والشاشة القديمة. سجل العقود موجود في `src/lib/reportMetricContracts.js` ولا يحتوي أي حسابات.

تم تثبيت hashes لـ **18** مصدر قراءة/تصنيف/تصدير، منها الحسابات الشهرية وZoho وP&L وcash aging وforecast وأداء الناقلين والأسعار والمبيعات والحملات والجمهور. أي تغيير لاحق فيها يفشل Gate الخاص بالدفعة.

### عينات parity الحية

| المجال | العينة | النتيجة |
|---|---|---|
| Finance | AR `120,602.54` / 63 / +90 `21,102.74`، AP `478,671.39` / 13 / +90 `55,360.33`، VAT `68,600.95`، Zoho API `390` | مطابق لخط الأساس |
| Operations | أغسطس 2026: J&T billed `31,759.79`، net `-31,759.79`، delta `▼ 0.5%`، audits `1` | مطابق حرفيًا قبل/بعد |
| Customers | 73 نتيجة، مبلغ العرض والتفاصيل `161,027.69`، أقدم استحقاق 237 يومًا | المصدر نفسه وdrill-down يحفظ السياق |
| Sales | `7 / 238 / 217 / 490 / 84` لشرائح pipeline الخمس | مطابق لمرجع Batch 4 |
| Carriers | 96 حركة، صافي `-319,547.09`، استرداد `83.41`، نزاعات `0`; عينة أرامكس score `22`, coverage `24%`, mismatch `25%` | القيم ومعادلة `carrierScore` لم تتغير |
| Platform prices | لمحة `13`، أوتو `16`، طرود `9`، تكلفة مجهولة `2`; عينة Delex `9.00 / 2.00 / +2.35 / 13.35` | من نفس الصفوف والعقد |
| Campaigns | 48 حملة؛ summary `2 / 0 / 5 / 12`; audience `12 / 0 / 0 / 12` | مطابق لمرجع Batch 4 |
| Forecast | inflow `192,469.77`، outflow `84,897.67`، net `107,572.10`، bank `94,837.62`، projected `202,409.72` | من `forecastService` المجمد |

الحالات `null`, no-data, zero, partial source، custom range، combined filters وlarge result sets بقيت بعقودها السابقة، مع عرض مركزي لـLoading/Empty/Error دون تحويل الفشل إلى صفر.

## 4. Report and export parity

- Totals and row counts: **PASS**.
- Filters and date semantics: **PASS**؛ لم يوحد النظام `created_at` و`shipment_date` أو أي معنى زمني مختلف.
- Drill-down: **PASS**؛ يحفظ `returnTo` والفلاتر والمجال والحالة.
- Exports: **PASS**؛ أعمدة وترتيب Excel/PDF/CSV الحالية لم تتغير.
- Monthly Excel schema: **PASS**؛ الأعمدة العشرة نفسها وبالترتيب نفسه.
- Forecast renderer: **PASS**؛ معادلات الإحداثيات والمسار لم تتغير، وأضيف `title/desc` فقط للوصولية.

## 5. Technical gate

- Production build: **PASS** — Vite، **2017 modules transformed**.
- Test suite: **PASS** — **517 tests**, **516 passed**, **0 failed**, **1 skipped**.
- Dedicated Batch 5 gate: **PASS** — hashes، contracts، routes، DataTable، export schema، chart semantics.
- Browser console: **PASS** — لا errors أو warnings في جلسة نظيفة بعد التنقل بين index، builder، monthly، customers، sales، campaigns، forecast، carrier KPI والأسعار.
- API/network behavior: **PASS** — عينات المصادر أعادت بياناتها ولم تظهر ErrorState أو network/API failure في المسارات المختبرة.
- Broken routes: **0** في المسارات القديمة الثلاثة والوجهات التفصيلية المختبرة.

## 6. UX and accessibility gate

- AppShell/PageHeader/Tabs: **PASS**؛ لا Navigation خاص داخل صفحات التقارير.
- DataTable compliance: **PASS**؛ لا raw `<table>` في builder/monthly/exports/platform comparison.
- Responsive: **PASS** عند `375, 390, 430, 768, 1024, 1280, 1440` بدون document horizontal overflow.
- Mobile monthly record: **PASS**؛ RTL isolation للأرقام، لا cell overflow، والقيم الدقيقة غير مختصرة.
- Bottom navigation: **PASS**؛ محتوى الجوال يملك الحيز السفلي ولا تغطيه القائمة.
- Keyboard: **PASS**؛ أسهم Tabs تنقل العرض، والبحث قابل للاستخدام ويحفظ query في URL.
- Chart accessibility: **PASS**؛ الرسم SVG يملك اسمًا ووصفًا دلاليين، مع بقاء القيم النصية بجانبه.
- SAR/percent/negative/zero: **PASS**؛ `bdi/dir=ltr` و`Money` مستخدمة حيث يلزم، ولم يستخدم `K/M` لإخفاء الدقة.

لقطات التحقق:

- `docs/ux-redesign/phase-6-batch-5-reports-desktop.png`
- `docs/ux-redesign/phase-6-batch-5-monthly-mobile.png`

## 7. Legacy leakage — موثّق فقط

لم يُحذف شيء لأن الحذف مؤجل إلى Phase 7.

- `InternalExports.jsx`: ما زالت بعض مجموعات الإجراءات و`BigStat` وتنسيقات inline موجودة؛ مصادر السحب والتأكيدات بقيت كما هي.
- `CarrierKpi.jsx`: صفوف التفاصيل لكل ناقل ما زالت محلية فوق `Panel` المركزي.
- `PlatformCarriers.jsx`: تنسيقات خلايا محلية وبعض badges العرضية باقية؛ الجدول نفسه أصبح `DataTable`.
- `Forecast.jsx`: renderer الـSVG المحلي باقٍ عمدًا لأنه يحمل معنى قائمًا؛ تمت إضافة semantics وStatStrip فقط.
- `ReportsCenter.jsx`: منطق export والمعاملات بقي محليًا، لكن card grid الملون أزيل واستبدل بصفوف `Surface` كثيفة.
- `activity-log`: بقي مسارًا إداريًا تاريخيًا وليس جزءًا من Reports Workspace.

لا توجد إضافة جديدة إلى CSS القديم، ولم تُحذف أي طبقة legacy عامة.

## 8. Gate decision

**PASS — Batch 5 جاهز للإغلاق.**

تم الوصول إلى التعريف الواضح، المصدر المثبت، parity، وسياق drill-down لكل metric داخل النطاق. وفق Scope Lock، يتوقف التنفيذ هنا ولا يبدأ Batch 6 حتى الاعتماد.

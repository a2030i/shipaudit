# Reference Design Validation Gate

التاريخ: 2026-09-04
النطاق: `EnterpriseCommandCenter`، `EnterpriseCustomerDirectory`، `Store360Page`، `EnterpriseFinanceOverview` فقط.
القرار: **PASS — Design System جاهز ليكون مرجع Phase 6. لم يبدأ أي ترحيل لبقية الصفحات.**

## نتيجة الشاشات

| الشاشة | النتيجة | الدليل المختصر |
|---|---|---|
| EnterpriseCommandCenter | PASS | PageHeader وAppShell موحدان، 3 DataTables مركزية، ترتيب الأولوية واضح، لا overflow في نقاط الاختبار |
| EnterpriseCustomerDirectory | PASS | DataTable الكامل يعمل بالفرز والبحث والتصفية وإخفاء الأعمدة والتحديد والإجراءات الجماعية والحالة الفارغة والتنقل بلوحة المفاتيح |
| Store360Page | PASS | EntityPageHeader موحد، إجراء رئيسي واحد، Overflow للإجراءات النادرة، Tabs موحدة واختيار جوال واحد، Dialog مركزي يستعيد التركيز |
| EnterpriseFinanceOverview | PASS | نفس PageHeader والكثافة والـTabs والجداول، القيم المالية معزولة اتجاهيًا، تفاصيل المصدر لا تتحول إلى أصفار بديلة |

## ما عولج داخل الـGate

- أضيف Breadcrumb موحد للرئيسية بدل غيابه عن مركز القيادة.
- وحّدت مسافات الصفحة إلى `20px 24px 48px` على الحاسب و`12px 12px 96px` على الجوال؛ Customer 360 يحتفظ فقط بـ`52px` أسفل الحاسب لحاجة تخطيطية موثقة.
- أزيلت المسافات المتراكمة داخل Customer 360، وأصبحت كثافته ناتجة من gap الصفحة لا من margins متكررة.
- نقلت مكونات العرض القديمة في Customer 360 (`Card`, `Btn`, `Modal`, `Empty`, `Spinner`, Mobile Action Sheet) إلى primitives مركزية (`Surface`, `Button`, `Dialog`, `EmptyState`, `Spinner`).
- أصبحت التبويبات Tabs على الحاسب وSelect واحدًا على الجوال، بلا تكرار لنمطَي التنقل.
- أضيفت حالات `loading/error/empty` الصريحة إلى DataTable، مع caption، sticky header، `aria-sort`، اختيار الصفوف، وإخفاء الأعمدة.
- أصبحت قيم SAR والأرقام والمعرّفات تستخدم `dir="ltr"` و`unicode-bidi:isolate` و`white-space:nowrap`.
- أصبحت أزرار Pagination وإجراءات Customer 360 على الجوال أهداف لمس لا تقل عن 40px، ومعظم controls الأساسية 44px.
- أضيفت focus states عامة، وتنقل الأسهم/Home/End للتبويبات، وEnter/Space لصفوف الجداول القابلة للفتح.

## معيار DataTable المعتمد

| القدرة | الحالة |
|---|---|
| Sorting | PASS |
| Filtering | PASS عبر FilterBar + state الصفحة |
| Search | PASS |
| Pagination | PASS |
| Sticky header | PASS (`position: sticky`) |
| Column visibility | PASS |
| Row selection | PASS |
| Bulk actions | PASS |
| Empty state | PASS |
| Loading state | PASS |
| Error + retry state | PASS |
| Keyboard row open | PASS |
| Accessible caption / sort state | PASS |

يمنع إنشاء implementation جديد للجداول في Phase 6. أي نقص وظيفي يضاف إلى `DataTable` أو primitive مرتبطة به، لا إلى صفحة منفردة.

## Responsive وRTL

تم التحقق عند: `375`, `390`, `430`, `768`, `1024`, `1280`, `1440` بكسل.

- لا يوجد document horizontal overflow في الشاشات الأربع.
- Sidebar ظاهر من 1024 فما فوق، وBottom Navigation مستقل عند 768 فما دون.
- مساحة نهاية الصفحة على الجوال `96px` مقابل Bottom Navigation بارتفاع `64px`؛ لا يغطي المحتوى.
- الجداول تتحول إلى responsive record rows مع `data-label` بدل Cards منفصلة.
- فلاتر العملاء تصبح شبكة قابلة للمس، والبحث بعرض الصف، ولا تقص النص المهم.
- Header القياسي يستهلك نحو 4–6% من ارتفاع 844px؛ Entity Header في Customer 360 بقي دون ربع الشاشة.
- SAR، الهاتف، Store ID، النسب، التواريخ، أرقام الفواتير، Pagination، أسهم الفرز وBreadcrumbs بقيت مستقرة اتجاهيًا.

## Accessibility

- `lang="ar"` و`dir="rtl"` فعليان.
- H1 واحد في كل شاشة، ولا IDs مكررة في الجولة.
- لا أزرار ظاهرة بلا accessible name، ولا حقول ظاهرة بلا label.
- Dialog يستخدم `role="dialog"`, `aria-modal`, `aria-labelledby`، يغلق بـEscape، يحبس Tab، ويعيد التركيز للزر الذي فتحه.
- نسب التباين المقاسة في الثيم الفاتح: النص الأساسي/Canvas `15.15:1`، النص الثانوي/Surface `8.05:1`، muted/Surface `4.68:1`، Brand/White `12.1:1`.
- اختبار لوحة المفاتيح نجح للفرز، تبديل Tabs، تحديد الصف، وإدخال Customer 360 من الصف.

## مكونات Phase 6 الإلزامية

- `AppShell`
- `Page` + `PageHeader` أو `EntityPageHeader`
- `Breadcrumbs`
- `DataTable` + `Pagination` + `ColumnVisibilityMenu` + `BulkActionBar`
- `FilterBar` + `SearchInput`
- `StatStrip` (Primitive الـStat المعتمد)
- `StatusBadge`
- `Tabs`
- `Drawer`
- `Dialog`
- `TextInput`, `SelectInput`, `FormField`
- `EmptyState`, `LoadingState`, `ErrorState`, `Alert`
- `Money`, `NumberValue`, `Percent`, `Identifier`, `DateTime`
- `Section`, `Surface`, `Button`, `IconButton`, `SourceStamp`

أي نمط يتكرر مرتين يترقى إلى هذه الطبقة قبل دمج الدفعة.

## Legacy Leakage الموثق — لا يحذف الآن

هذه العناصر لا تمنع الـGate بصريًا أو وظيفيًا، لكنها تبقى قائمة تنظيف Phase 7:

- `Store360Page` ما زال يستورد `toast` فقط من `components/UI.jsx`؛ لم تعد أي primitive مرئية قديمة مستخدمة فيه.
- `store-360.css` ما زال يحمل تخطيطات feature-specific للنماذج والتفاصيل والتسلسل الزمني.
- `reference-screens.css` يحتوي 95 استخدامًا لـ`!important` كطبقة عزل مؤقتة بسبب historical global CSS الذي يستخدم أولوية مماثلة. لا يسمح بنسخ هذه الطبقة إلى صفحات Phase 6.
- ملفات `index.css`, `design-v5.css`, `workspace-layout.css`, `product-shell.css`, `operations-os.css`, `shipaudit-os-v2.css` ما زالت محملة لحماية الصفحات غير المرحلة.
- فروع العرض القديمة غير النشطة في wrappers مثل `Overview` و`FinanceExecutive` تبقى كـrollback مؤقت حتى اكتمال الترحيل الوظيفي.

## مقارنة المفهوم بالتنفيذ

المسارات المرجعية المقبولة:

- `concept-command-center-desktop.png`
- `concept-customers-desktop.png`
- `concept-customer-360-desktop.png`
- `concept-finance-desktop.png`
- `concept-customers-mobile.png`

التنفيذ حافظ على: الهيكل الهادئ، Sidebar أحادي اللون، Header + Breadcrumb، KPI strip محدود، الجداول الكثيفة، العمل حسب الأولوية، Tabs داخل Workspace، وBottom Navigation مستقل. الاختلافات المقصودة:

- استبدلت بيانات المفهوم الوهمية بالبيانات الحية وحالات المصدر الحقيقية.
- لم يعتمد دليل العملاء Drawer دائمًا للمعاينة؛ الضغط يفتح Customer 360 لأن هذه هي نقطة التجميع المعتمدة.
- لم تُخترع صور عملاء أو شعارات متاجر لا يوفرها المصدر.
- سجل الجوال يستخدم record rows دلالية بدل تقليد جدول مكتبي مصغر.
- النصوص التنفيذية تشرح حدود المصدر والأثر التشغيلي بدل copy تجريبي عام.

## التحقق الآلي

- Production build: PASS — 2009 modules.
- الاختبارات الكاملة: PASS — 486 اختبارًا، 485 ناجحًا، 1 skipped معروف، 0 فشل.
- Gate contract tests: PASS — 4/4.
- Browser console: لا أخطاء أو تحذيرات في الجولة النهائية.

## خطة Phase 6 — بدون تنفيذ

1. **دفعة العملاء كاملة**: Customer 360 subviews، الذمم والتحصيل، مهام التحصيل، ربط العميل، قوائم النمو والمتابعة. تنتهي فقط بعد DataTable/RTL/mobile/a11y gate.
2. **دفعة المالية كاملة**: البنوك والأرصدة، المطابقة، Zoho، Aging، المركز المالي، الربحية، VAT، التخطيط والإقفال.
3. **دفعة التشغيل كاملة**: دورة المحاسب، شركات الشحن، Carrier 360، الفواتير، COD التاريخي، العقود والأسعار والمطالبات.
4. **دفعة المبيعات والحملات**: Pipeline، today queues، activation/retention، الجمهور، المراجعة، النتائج والقنوات، مع الحفاظ على approval gates.
5. **دفعة التقارير**: المؤشرات، التقارير المالية والتشغيلية، التصدير والطباعة، مع توحيد chart/table semantics.
6. **دفعة الإدارة**: المستخدمون والصلاحيات، الإعدادات، التكاملات، الأتمتة، العقود العامة وسجلات التدقيق.
7. بعد كل دفعة: browser matrix، contract tests، source/permission audit، ثم إزالة references القديمة الخاصة بالدفعة فقط. **Phase 7** يحذف CSS والمكونات القديمة بعد `rg` + build + full test + browser smoke.

لا يبدأ أي batch تالٍ إذا احتاج إلى override محلي لمشكلة يمكن حلها في Design System.

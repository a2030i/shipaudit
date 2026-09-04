# Phase 6 — Batch 2 Gate: المالية والمطابقة والبنوك

التاريخ: 2026-09-04  
الحالة النهائية: **PASS**  
نطاق التوقف: انتهت Batch 2 فقط، ولم يبدأ التشغيل أو Batch 3.

## 1. Scope Lock قبل التنفيذ

| المسار | القرار | الوجهة/الدور | مصادر واعتمادات القراءة الحالية |
|---|---|---|---|
| `/workspace/finance` | Migrate | Overview التنفيذي | Zoho dashboards، `customer_ar` و`customer_collectible_lines` عبر read models، invoices، payments، credits، vendor bills، bank/treasury، forecast |
| `/customer-money` | Keep as detail view | Receivables + Collections drill-down | `customer_ar`، `customer_collectible_lines`، invoices، payments، credit notes، opening balances، write-offs، قواعد الأعمار الحالية |
| `/money` | Migrate + Merge target | Cash & Banks + Payables/COD views | bank data، statement summaries، internal bank matching، COD settlements، carrier payments |
| `/bank` | Redirect | `/money?tab=bank` | bank data؛ يحفظ كل query/entity identifiers |
| `/cod-settlements` | Redirect / scoped detail | `/money?tab=cod`، أو Carrier 360 عند وجود `carrier` | COD settlements التاريخية، carrier operating model، internal reconciliation |
| `/payments` | Redirect / scoped detail | `/money?tab=payments`، أو Carrier 360 عند وجود `carrier` | carrier payments وpayment operations |
| `/zoho-data` | Migrate | Financial Control / Payables | Zoho invoices، payments، credit notes، bills، vendor credits، journals، bank/treasury mirrors، Zoho bank review |
| `/reconciliation` | Migrate | Reconciliation | customer/vendor reconciliation، internal snapshots، Zoho balances/invoices، treasury، Daftra closing snapshot، COD/AP reads |
| `/pnl` | Migrate | Financial Control | Zoho P&L/VAT snapshots، invoices/collections، customer AR، sync state |
| `/cash-aging` | Migrate (read-only) | Financial Control | COD cash cycle، carrier AP، aging read model |
| `/forecast` | Migrate (read-only) | Financial Control | bank opening position، AR inflows، carrier schedules، AP/COD events |
| `/periods` | Keep as detail view | Month close control | period activity، journals/operations، COD، audits، payments، existing close/reopen safeguards |
| `/zoho-callback` | Admin/utility only | OAuth callback خارج التنقل | Zoho OAuth state فقط |

### الاعتمادات المؤجلة عمدًا

- نموذج COD ودورة الناقلين لم يُعاد تنظيمه وظيفيًا؛ هذه الدفعة غيّرت presentation فقط، ويظل عقد التشغيل الحالي هو المرجع.
- مصدر المطابقة الحالي لا يعيد `currency exception` مستقلًا ولا journal id لكل mismatch. الواجهة تعرض أن المصدر غير متاح وتفتح سجل القيود، ولا تستنتج علاقة غير موجودة.

## 2. ما تم تنفيذه

- إنشاء `FinanceWorkspaceNav` واحد بسبعة أقسام: Overview، Receivables، Collections، Cash & Banks، Reconciliation، Payables & COD، Financial Control.
- توحيد PageHeader وBreadcrumbs والتنقل المحلي في مساحات Batch 2.
- دمج البنوك وCOD التاريخي ودفعات الناقلين في `/money`، مع بقاء مساراتها القديمة redirects آمنة وحفظ query parameters والمعرّفات.
- استبدال كل `<table>` محلي في صفحات Batch 2 بـ`DataTable` الموحد: 19 جدولًا، مع sticky header وعقد mobile rows من Design System.
- نقل الأزرار والأسطح والحوارات وحالات Empty/Loading من صفحات Batch 2 إلى EnterpriseUI. بقيت وظيفتا legacy مساعدتان موثقتان أدناه.
- عرض Result Sets للمطابقة: Matched، Mismatched، Missing source، Residual differences، Currency issues، Journal exceptions. حالة العملة غير المتاحة disabled بوضوح، والقيود تفتح مصدر Journals دون correlation تخميني.
- توضيح فصل bank actual عن book balance وعن reconciliation difference داخل Cash & Banks.
- إصلاح responsive مشترك لأفعال PageHeader عند 375px، وإجراءات reconciliation عند 768px.
- لم يُعدّل أي ملف service أو engine أو migration أو schema أو API mapping في Batch 2.

## 3. Coverage

| القياس | العدد |
|---|---:|
| Routes داخل النطاق | 13 |
| Migrated workspaces/pages | 7 |
| Kept as detail views | 2 |
| Merged functional surfaces into `/money` | 3 |
| Redirected legacy aliases | 3 |
| Admin/utility only | 1 |
| Remaining داخل Batch 2 | 0 |

ملاحظة: أسطح `/bank` و`/cod-settlements` و`/payments` محسوبة ضمن Merged وRedirected معًا؛ عدد المسارات الفريد يبقى 13.

## 4. Financial Regression Gate

| الفحص | النتيجة | الدليل |
|---|---|---|
| Number parity | PASS | Overview: نفس 9 قيم حرفيًا؛ Receivables: 43/43 قيمة بنفس الترتيب؛ Cash Aging: نفس 26 قيمة؛ Reconciliation: 154 token و94 صفًا قبل/بعد |
| Aging parity | PASS | نفس 26 قيمة و17 صفًا في live comparison، مع نجاح عقود 0–15 و16–30 و31–60 و61–90 و+90 |
| Credit parity | PASS | القيم الدائنة السالبة بقيت كما هي؛ اختبارات credit coverage وunapplied credits ناجحة |
| Residual parity | PASS | اختبارات `0.00` و`0.01` و`0.50` و`0.51` وmixed residual ناجحة؛ لا tolerance بصري أو حساب جديد |
| Reconciliation parity | PASS | 94 صفًا و154 قيمة عشرية؛ فلتر Mismatched فتح 10 صفوف من المصدر نفسه؛ فرق 0.01 يبقى mismatch |
| Bank balance parity | PASS | العينة الحية الفارغة بقيت فارغة؛ اختبارات bank scope، closing، reversals، historical Zoho reconciliation ناجحة |
| Opening balance | PASS | عينة live ظاهرة + اختبارات الفصل عن invoice aging ناجحة |
| Journal impact | PASS | مسار journals محفوظ؛ لا ربط mismatch↔journal دون مصدر يثبته |

عينات Live شملت: عميل بلا مبلغ تشغيلي (`0.00`)، أرصدة موجبة، credits سالبة، opening balance، mismatch قائم `100.00 ر.س`. حالات residual الدقيقة ثبتت بعقود domain الآلية لأن dataset المرئي الحالي لا يحتوي صفًا حيًا مضمونًا بقيمة `0.01`.

## 5. Technical Gate

| الفحص | النتيجة |
|---|---|
| Production build | PASS — Vite، 2011 modules |
| Full repository test suite (`tests/*.test.mjs`) | PASS — 499 tests: 498 pass، 1 intentional skip، 0 fail |
| Batch 2 focused financial tests | PASS — 66/66 |
| Browser error states | PASS — صفر ErrorState/Error Boundary في 33 زيارة responsive نهائية |
| API-visible errors | PASS — لا رسائل فشل مصدر جديدة ولا network-derived UI errors في المسارات التسعة |
| Deep links | PASS — aliases تحفظ query/entity؛ carrier-scoped routes تبقى في Carrier 360 |

تشغيل `node --test` بلا تقييد يلتقط أدوات يدوية داخل `scripts/test-*.mjs` وملف Deno ويطلب ملفات Excel خارج المشروع؛ لذلك Gate المعتمد هو `node --test 'tests/*.test.mjs'`. اتصال Chrome المتاح لا يوفّر stream خامًا لسجل Console؛ تم التحقق من Runtime عبر Error Boundaries/alerts، التنقل التفاعلي، build الإنتاجي، والاختبارات الكاملة دون ادعاء قراءة console غير متاح.

## 6. UX / RTL / Accessibility Gate

| الفحص | النتيجة |
|---|---|
| Responsive | PASS — 33 زيارة على 375، 390، 430، 768، 1024، 1280، 1440؛ صفر document overflow وصفر عنصر مقصوص بعد الإصلاح |
| Mobile navigation | PASS — Bottom nav 64px، safe end spacer 144px، لا يغطي المحتوى |
| Headers | PASS — أعلى ارتفاع مقاس 375 كان 148px في P&L بعد التفاف الإجراءات، وأقل كثيرًا من نصف الشاشة |
| Tables | PASS — desktop tables + mobile compact rows من primitive واحدة |
| RTL/SAR | PASS — قيم overview/receivables المحفوظة حرفيًا، negative/zero/decimals لم تتفكك؛ `Money` يستخدم `dir=ltr` و`bdi` |
| Keyboard | PASS — أسهم Tabs نقلت من Overview إلى Receivables؛ Dialog الإقفال فتح دلاليًا وأُغلق بـEscape دون تنفيذ |
| Drill-down | PASS — Mismatched 94→10 ثم Customer 360 مع `returnTo`؛ Journals يفتح مسار المصدر |
| Semantics | PASS — `nav`, `tablist`, `tabpanel`, `dialog`, captions لكل الجداول، disabled source state |

## 7. مطابقة المرجع البصري

1. App shell/sidebar هادئ واحد: مطابق للاتجاه المرجعي، مع هوية لمحة الفعلية بدل شعار concept.
2. شريط مؤشرات صغير بدل KPI cards ضخمة: مطابق.
3. قائمة الأولويات DataTable كأهم result set: مطابق.
4. لون brand واحد واستخدام semantic colors للحالة فقط: مطابق.
5. كثافة enterprise وحدود خفيفة وغياب gradients/glass: مطابق.
6. الاختلاف المقصود: concept يعرض بيانات بنكية ومطابقات افتراضية أكثر؛ التطبيق لا يملأ مصدرًا غير متاح ولا يصنع أرقامًا تجميلية.
7. الاختلاف المقصود: التسميات النهائية توحد التحصيل/الدائنين وCOD وفق IA الفعلية بدل تبويبات concept المؤقتة.

اللقطات: `phase-6-batch-2-finance-desktop.png` و`phase-6-batch-2-reconciliation-mobile.png`.

## 8. Legacy Leakage المتبقي — لا حذف في Phase 6

- `DropZone` القديم مستخدم في رفع ملفات reconciliation وCOD؛ لم يُضف له اعتماد جديد خارج الاستخدام القائم.
- `StatCard` القديم باقٍ في Cash Aging؛ حساباته ومصدره لم يتغيرا.
- `Reconciliation.css` و`ZohoData.css` وتنسيقات inline قديمة ما زالت موجودة حول المحتوى، لكن PageHeader/Tabs/DataTable/Dialog/Buttons/Surface/States أصبحت من Design System.
- `store-360.css` وطبقات `!important` المؤقتة لم تُحذف وفق قفل Phase 7.
- لا توجد raw financial table implementations متبقية داخل صفحات Batch 2.

هذه العناصر cleanup/migration debt موثقة، وليست dependency جديدة. حذفها مؤجل حتى وصول الترحيل الكامل إلى 100% في Phase 7.

## 9. قرار Gate

**PASS** لكل صفحات ومسارات Batch 2. لا يوجد فرق مالي غير مفسر، بما فيه `0.01`. Design System صالح للدفعة التالية، لكن التنفيذ متوقف هنا انتظار الاعتماد، ولم يبدأ Batch 3.

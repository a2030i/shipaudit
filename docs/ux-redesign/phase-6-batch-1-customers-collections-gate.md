# Phase 6 — Batch 1 Gate: العملاء والتحصيل

التاريخ: 2026-09-04  
النتيجة النهائية: **PASS**  
القرار: الدفعة الأولى مكتملة، والتوقف إلزامي قبل دفعة المالية والمطابقة والبنوك.

## 1. نطاق الدفعة وقرار IA

| المسار | القرار | الوجهة/الدور النهائي | الحالة |
|---|---|---|---|
| `/workspace/customers` | Migrate | دليل العملاء والمتاجر داخل Workspace العملاء | PASS |
| `/customer-360` | Keep detail | ملف العميل والمتجر الموحد، بسبعة تبويبات داخلية | PASS |
| `/customer-money` | Migrate | Workspace التحصيل الموحد | PASS |
| `/collections` | Merge | Redirect إلى `/customer-money?view=queue` مع حفظ Query Parameters | PASS |
| `/receivables` | Merge | Redirect إلى `/customer-money?view=internal` مع حفظ Query Parameters | PASS |
| `/customers` | Redirect | Redirect إلى `/workspace/customers` مع حفظ Query Parameters | PASS |
| `/merchants` | Redirect | Redirect إلى `/customer-360` مع حفظ Query Parameters | PASS |

حصيلة المسارات: **2 migrated، 2 merged، 2 redirected، 1 kept detail، 0 remaining**.

الشاشات الفعلية التي اجتازت المراجعة: دليل العملاء، Customer 360، المستحقات وأعمار الدين، إجراء اليوم والوعود، والأرصدة والمطابقة.

## 2. Gate النتائج

| البند | النتيجة | دليل التحقق |
|---|---|---|
| AppShell والتنقل | PASS | جميع العروض تستخدم الـShell نفسه؛ لا يوجد Navigation خاص بصفحة التحصيل أو العملاء |
| PageHeader وBreadcrumbs | PASS | Header واحد لـWorkspace التحصيل؛ العروض المدمجة لا تكرر العنوان |
| DataTable | PASS | لا توجد `<table>` خام في صفحات الدفعة؛ الجداول تمر عبر DataTable المركزي |
| الإجراءات | PASS | فتح الصف هو الإجراء السياقي، والإجراءات الثانوية داخل OverflowMenu؛ الإلغاء يمر عبر Dialog تأكيد |
| الحالات | PASS | Loading وEmpty وError موحدة وقابلة لإعادة المحاولة حيث يلزم |
| RTL والأرقام | PASS | Money وIdentifier وDateTime تمنع تفكك SAR والأرقام والهواتف والمعرّفات |
| Keyboard وFocus | PASS | الصفوف قابلة للفتح بـEnter/Space، Drawer يغلق بـEscape ويعيد التركيز إلى الصف |
| Accessibility | PASS | أزرار معنونة، roles للتبويبات والجداول والقوائم، focus-visible، ولا توجد عناصر لمس صغيرة على الجوال |
| Responsive | PASS | لا Horizontal Overflow في أي عرض مختبر، والتبويبات/الفلاتر تتحول إلى Select عملي على الجوال |
| Business Logic Lock | PASS | لا تغيير في الحسابات أو eligibility أو sync أو Zoho/Lamha أو الصلاحيات أو قاعدة البيانات |
| Deep links | PASS | جميع الروابط القديمة تعمل عبر Redirect آمن وتحفظ الاستعلام والسياق |

## 3. Responsive Matrix

| العرض | Overflow | تنقل Workspace | أزرار لمس صغيرة | Bottom Navigation |
|---:|---|---|---:|---|
| 375px | لا | Select | 0 | 64px مع مساحة محتوى آمنة |
| 390px | لا | Select | 0 | 64px مع مساحة محتوى آمنة |
| 430px | لا | Select | 0 | 64px مع مساحة محتوى آمنة |
| 768px | لا | Select | 0 | 64px مع مساحة محتوى آمنة |
| 1024px | لا | Tabs | لا مخالفات جوال | مخفي |
| 1280px | لا | Tabs | لا مخالفات جوال | مخفي |
| 1440px | لا | Tabs | لا مخالفات جوال | مخفي |

## 4. Regression وBrowser QA

- Production build: **PASS** — 2010 modules.
- الاختبارات الكاملة: **493 total، 492 pass، 0 fail، 1 skip**. المتخطّى عقد تنقل تاريخي معلّم مسبقًا، وليس Regression من الدفعة.
- Chrome authenticated QA: **PASS**.
- البيانات العملية: 25 صفًا في دليل العملاء، 19 مهمة في قائمة التحصيل، وفتح Customer 360 للمتجر `199` بنجاح.
- Console: **0 errors، 0 warnings** في نهاية رحلة التحقق.
- Network/API UI failures: **0**؛ لم تظهر Alerts أو حالات مصدر فاشلة في المسارات المختبرة.
- التفاعلات المختبرة: تبديل تبويبات Workspace، فتح وإغلاق Drawer، استعادة التركيز، فتح OverflowMenu، فتح Customer 360 من صف العميل، وفحص Redirects القديمة.

## 5. مطابقة المرجع البصري

تمت المقارنة مع `concept-customers-desktop.png` و`concept-finance-desktop.png` ومع الشاشات المرجعية المنفذة. نقاط المطابقة:

1. Shell جانبي هادئ بلون Brand واحد، من دون ألوان أقسام أو مربعات أيقونات ملونة.
2. Header وBreadcrumbs وتسلسل Typography مطابق للغة المرجعية.
3. كثافة البيانات تعتمد الشرائط والجداول بدل KPI Cards الكبيرة.
4. الحدود خفيفة، نصف القطر منخفض، والظلال محصورة في Overlays والقوائم.
5. اللون الدلالي محصور في الحالة والخطر والنجاح والتحذير.
6. إجراءات الصف الثانوية انتقلت إلى `⋯` بدل عرض خمسة أزرار متساوية.
7. قيم SAR تظهر ككتلة واحدة مع أرقام tabular داخل RTL.

الانحراف المقصود عن Concept: صفحة التحصيل تعرض سياق «خطة اليوم» ومصدر البيانات قبل الجدول لأن هذه معلومات تشغيلية فعلية، وليست جزءًا تجميليًا جديدًا.

## 6. Legacy Leakage المؤجل إلى Phase 7

لم يُحذف أي Legacy CSS التزامًا بتعليمات Phase 6، ولم يُضف اعتماد جديد عليه. العناصر المتبقية الموثقة:

- `src/pages/store-360.css` وطبقة التوافق في `reference-screens.css`، بما فيها قواعد `!important` المؤقتة.
- `src/pages/CustomerFinanceCenter.css` لمساحة المستحقات الحالية.
- `src/components/operations/operational-result-set.css` و`aging-operations-queue.css` لتفاصيل العرض التشغيلي القديمة.
- `src/components/customer-context-drawer.css`؛ الـDrawer نفسه أصبح Primitive مركزيًا، لكن ملف التوافق ما زال موجودًا.
- الفرع القديم غير القابل للوصول داخل `CustomerWatch.jsx` واستيراده من `components/UI.jsx`؛ يبقى فقط حتى Phase 7 ولا يدخل التجربة المرئية الحالية.
- PageSlot يحتفظ بنسخ مخفية من بعض الصفحات لأسباب الأداء؛ تحقق الفحص من وجود **تنقل Customer 360 مرئي وتفاعلي واحد فقط**.

لا توجد جداول خام أو PageHeader محلي مكرر داخل عروض التحصيل الثلاثة المهاجرة. المكونات المتخصصة مثل WhatsApp review وكتابة الشطب بقيت Business dialogs ولم تُنسخ كأنماط UI عامة.

## 7. تعديلات Design System قبل PASS

- DataTable يدعم التركيب المعقد مع بقاء shell والكثافة وsticky header موحدة.
- OverflowMenu مركزي جديد لإجراءات الصف الثانوية.
- Button يستنتج `aria-label` من `title` للأزرار الأيقونية.
- Drawer/Dialog وحالات Loading/Empty/Error أصبحت المرجع الفعلي للدفعة.
- Tabs تستخدم Select مركزيًا على 768px وما دون.
- صفوف الجداول التفاعلية تملك focus واضحًا ودعم Enter/Space.

## 8. قرار الانتقال

**Batch 1: PASS.** لا توجد مشكلة مشتركة مانعة أو صفحة متبقية ضمن نطاق العملاء والتحصيل. لم تبدأ Batch 2. يلزم اعتماد صريح قبل بدء «المالية والمطابقة والبنوك».

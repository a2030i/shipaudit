# البيانات والتكاملات والأمان

> يصف هذا الملف العقود الظاهرة في المستودع. لا يثبت حالة Production أو القيم السرية أو نجاح اتصال حي.

## قاعدة البيانات وطريقة قراءتها

PostgreSQL عبر Supabase هو مخزن البيانات الرئيسي. الوصول من الواجهة يتم عبر جداول/views عامة مصرح بها أو RPCs، ومن Edge Functions عبر عميل المستخدم أو `service_role` حسب العملية.

مجلد `supabase/migrations/` تراكمي ويحتوي مئات migrations، لكنه لا يعرّف كل الجداول الأساسية من الصفر. توجد كيانات تستخدمها الشفرة، مثل `profiles` و`carriers` و`audits` و`audit_shipments` و`merchants` و`zoho_invoices` و`customer_merchant_links`، من دون أن تكون جميع تعريفاتها الابتدائية موجودة في التسلسل الحالي. لذلك:

- لا تعامل migrations الحالية كـbootstrap موثوق لقاعدة فارغة.
- افحص أحدث migrations للكائن المتأثر وراجع schema حيًا قبل DDL.
- حالة تطابق Production مع الفرع الحالي: `NEEDS_CONFIRMATION`.

## مجموعات البيانات ومصادر الحقيقة

| المجال | مصدر الحقيقة/العقد |
|---|---|
| المستخدم والجلسة | Supabase Auth؛ بيانات الدور والملف في `profiles` |
| الصلاحيات | الدور وJSONB permissions، مع RLS/grants والتحقق داخل العمليات |
| متاجر Lamha | `merchants` للمرآة التشغيلية؛ `lamha_store_profiles` للتفاصيل؛ Lamha API/exports للحقول التي يملكها المصدر |
| هوية Zoho للمتجر | معرف اتصال Zoho/جداول الربط الصريحة؛ الاسم والهاتف ليسا join ماليًا |
| فواتير العملاء | بيانات Zoho المتزامنة والعقود المجمعة للموقف المالي |
| تدقيق الناقل | `audit_shipments` لصفوف الشحنات؛ `audits` metadata وحالة المراجعة، وليس blob نتائج بديلًا |
| تشغيل الناقل المالي | `carrier_operations` ودفاتر/سجلات التدقيق المرتبطة |
| ملفات التشغيل | Supabase Storage الخاص مع metadata وسياسات وصول |
| الأتمتة والتواصل | قواعد وقوالب ومحاولات ونتائج مدققة؛ المعاينة ليست تنفيذًا |

لمصادر الحقيقة المالية الدقيقة راجع `docs/architecture/financial-position-contract.md`، ولدليل Lamha راجع `docs/architecture/lamha-data-authority.md`.

## التكاملات الخارجية

| النظام | الاستخدام المثبت | مكان التنفيذ المعتاد |
|---|---|---|
| Zoho Books | جهات الاتصال، الفواتير، المدفوعات، القراءة البنكية، والمزامنة | Edge Functions وRPCs؛ ZATCA عبر Zoho وليس تكاملًا مباشرًا |
| Lamha Employee API | دليل المتاجر، تفاصيلها، وفحص/تغيير حالة الحساب بحواجز | Edge Functions؛ token خادمي |
| Hatif/Voxa | مكالمات/قنوات اتصال وwebhooks وقوالب | Edge Functions وwebhooks |
| Hudhud | رسائل/قوالب واتصال من المسارات المعتمدة | Edge Functions ومفتاح publishable محدود في الواجهة عند الحاجة |
| Tahseel | تكامل تحصيل | Edge Functions |
| Daftra | قراءة/تكامل مالي محدد | Edge Functions |
| Google leads | استقبال leads عبر webhook محمي | Edge Function |
| Platform/carrier webhooks | استقبال ملفات/أحداث خارجية | Edge Functions مع تحقق وتدقيق |

تفاصيل endpoint والـpayload يجب أخذها من الوظيفة نفسها واختبارها، لا من هذا الملخص.

## المصادقة والصلاحيات

- `src/lib/auth.jsx` يدير جلسة البريد/كلمة المرور عبر Supabase ويقرأ profile، ويمسح الحالة الحساسة المحلية عند الخروج.
- الأدوار البرمجية الحالية في `src/lib/permissions.js` هي `admin` و`accountant`.
- `admin` يملك تجاوزًا داخل الواجهة، بينما `accountant` يحتاج permission صريحة؛ الغائب لا يُسمح به افتراضيًا.
- حماية route أو إخفاء زر لا يكفيان. يجب أن تحمي RLS/grants/RPC/Edge Function العملية نفسها.
- لا تستخدم `SUPABASE_SERVICE_ROLE_KEY` في client bundle. عند استخدام `SECURITY DEFINER` ثبّت `search_path` وقيّد `EXECUTE` وتحقق من هوية المستدعي.
- الوظيفة التي تحتاج سياق المستخدم تمرر Authorization وتتحقق منه؛ الوظائف العامة/webhooks تحتاج secret/signature أو عقد حماية بديل مثبت.

## التخزين والملفات

تظهر في migrations/الكود حاويات منها: `audit-source-files` و`internal-exports` و`carrier-statements` و`task-files` و`ivr-audio` و`weight-billing` و`webhook-uploads` و`zoho-intake`. ليست هذه ضمانًا أن كل bucket موجود أو مضبوط في كل بيئة: `NEEDS_CONFIRMATION`.

- الملفات الخاصة لا تصبح عامة لتسهيل التنزيل؛ استخدم signed URLs وسياسات ضيقة.
- حافظ على ربط metadata بالمالك/السجل وعلى سجل التدقيق.
- لا تسجل محتوى الملف أو headers/tokens سرية.
- نظام تذاكر الدعم متقاعد؛ لا تعِد bucket أو policies له دون قرار منتج جديد.

## متغيرات البيئة المستخدمة — أسماء فقط

### الواجهة

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_SUPABASE_ANON_KEY
VITE_OVERVIEW_READ_MODE
VITE_CARRIER_360_READ_MODE
VITE_RECEIVABLES_READ_MODE
VITE_STORE_360_CORE_READ_MODE
VITE_STORE_360_CORE_SHADOW_READ
VITE_SALES_CORE_READ_ENABLED
VITE_HUDHUD_PUBLISHABLE_KEY
VITE_HUDHUD_MAP_ID
```

### Supabase وZoho

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
ZOHO_CLIENT_ID
ZOHO_CLIENT_SECRET
ZOHO_WEBHOOK_SECRET
ZOHO_DAILY_API_BUDGET
```

### Lamha والاتصالات

```text
LAMHA_EMPLOYEE_TOKEN
LAMHA_EMPLOYEE_API_BASE
LAMHA_FINANCIAL_GUARD_EXECUTION_ENABLED
HATIF_CLIENT_ID
HATIF_CLIENT_SECRET
HATIF_CHANNEL_ID
HATIF_WEBHOOK_SECRET
HATIF_REQUIRE_SIGNATURE
HATIF_NEW_LEAD_STAFF_TEMPLATE
client_id
secret
hatif_channel_id
HUDHUD_SECRET_KEY
```

الأسماء lowercase الثلاثة aliases قديمة لكنها مستخدمة في الكود؛ لا تحذفها قبل خطة ترحيل مثبتة.

### تكاملات أخرى

```text
WEBHOOK_SHARED_SECRET
GOOGLE_LEADS_WEBHOOK_SECRET
PLATFORM_MERCHANTS_WEBHOOK_SECRET
TAHSEEL_API_KEY
TAHSEEL_API_SECRET
TAHSEEL_BASE_URL
DAFTRA_API_KEY
DAFTRA_BASE_URL
OPENROUTER_API_KEY
ASSISTANT_MODEL
ASSISTANT_ALLOWED_ORIGINS
```

`IVR_WEBHOOK_SECRET` مذكور في وثيقة أمان أقدم ولم يظهر له مستهلك في البحث الحالي: `NEEDS_CONFIRMATION` قبل إضافته أو حذفه من إعدادات أي بيئة.

## قيود الأسرار

- لا تطبع قيم البيئة أو Vault أو tokens أو Authorization headers في terminal أو logs أو تقارير.
- لا تنسخ قيمًا من `.env` أو dashboard إلى الوثائق أو Git.
- ملفات `supabase/.temp/` متتبعة حاليًا وتحتوي metadata للـCLI/الربط؛ سبب تتبعها وسياسة الاحتفاظ بها: `NEEDS_CONFIRMATION`. لا تعرض محتواها.
- وجود fallback عام داخل عميل الواجهة لا يجعل مفاتيح الخادم صالحة للنشر؛ راجع نوع كل مفتاح وحدود صلاحيته.

## migrations الآمنة

- فعّل RLS لكل جدول مكشوف، ثم اكتب policies صريحة لكل عملية.
- راجع grants الافتراضية، خصوصًا للدوال وviews.
- استخدم migrations أمامية قابلة للمراجعة، ويفضل خطوات expand/backfill/verify/contract للتغييرات الكبيرة.
- لا تنفذ migration مدمرة أو backfill على Production دون موافقة صريحة وخطة استرجاع.
- لا تفترض أن نجاح SQL محليًا يثبت سلامة Production؛ تحقق من الحجم والأقفال والسياسات والتبعيات.

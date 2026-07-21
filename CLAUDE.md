# CLAUDE.md — دليل التطوير لـ ShipAudit Pro (لمحة)

> **اقرأ هذا الملف بالكامل قبل أي تعديل في الكود.** المنظومة وصلت لحالة عمل مستقرة لعدة تدفّقات — أي تغيير يكسر أحد هذه التدفّقات غير مقبول.
>
> هذا ملف حيّ. كل ما تستقرّ ميزة جديدة، تضاف هنا. كل تعديل على هذا الملف يجب أن يُذكر في commit message.

---

## 1. الأشياء التي تعمل (ممنوع كسرها)

### 1.1 تدفّق DeliverNow End-to-End ✅
- إيميل من `@delivernow.net` يصل عبر InboxDone → webhook-intake v10
- يظهر في `/webhook` بشركة معرّفة + شارة XLS
- زر **"حفظ كمراجعة"** → ينقل لـ `/upload` → معالجة تلقائية → خطوة 3
- بانر أخضر "جاهزة للاعتماد بالهلله" → زر **"اعتماد المراجعة"**
- بعد الاعتماد:
  - قيد INV في `carrier_operations` (DR = 1,619.20 ر.س مع الضريبة)
  - 19 شحنة COD في `cod_settlement` direction='in' (مُستلَم)
  - `webhook_events.audit_id` يُحدَّث + `status='processed'`
- البطاقة في `/hub` تعكس الرصيد الجديد
- البروفايل في `/carrier?id=delivernow` يعرض كل شيء

**الثوابت الواجب احترامها:**
- `carriers.delivernow.file_signature.file_kind = 'audit_with_cod'`
- `carriers.delivernow.contracts[0]`: سعر ثابت 11 ر.س السعودية، ضريبة 15%
- `carriers.delivernow.file_signature.email_from = ['@delivernow.net']`
- النمط في `engine/audit.js` لـ `deliveryCharges` يلتقط `'Shipping Service / المجموع الصافي'`

### 1.2 بوابة الاعتماد (Penny-Perfect Gate) ✅
- `evaluateApprovalGate(audit)` في `src/lib/coreService.js`
- **يمنع** الاعتماد إذا:
  - `mismatch_count > 0` (أي شحنة بفرق فردي)
  - `|totalBilled - totalExpected| > 0.50` ر.س
- **يحذّر** (لا يمنع) إذا:
  - `|totalTax - totalBilled × 0.15| > 1.00` ر.س
- الثوابت المُصدَّرة:
  - `APPROVAL_DRIFT_TOLERANCE_PRE_TAX = 0.50`
  - `APPROVAL_DRIFT_TOLERANCE_TAX = 1.00`

### 1.3b ربط المراجعة بقيد RV الموجود بدل INV مكرر ✅ (2026-06-11)
- **الفخّ**: `approveAudit` كان ينشر INV دائماً. للناقلين ذوي الكشوف (أرامكس/سمسا) قيد RV يأتي من الكشف بنفس المبلغ → **ازدواج** (INV + RV = ضعف المبلغ). كشفه المستخدم عند «ربط مراجعة» (المودال يخفي المراجعة لأنها مربوطة بـINV الخاص بها).
- **الإصلاح**: قبل نشر INV، `approveAudit` يبحث عن قيد RV **غير مدقّق** بنفس الإجمالي (ضمن 0.5 ر.س) لنفس الناقل. إن وُجد **واحد بالضبط** → يربط المراجعة به (يضع `audit_id` + status='audited') بدل نشر INV. صفر أو أكثر من واحد → ينشر INV عادي (J&T/iMile/ديلفرناو بلا كشوف فلا RV → ينشرون INV دائماً).
- **القاعدة**: لا تفترض أن كل ناقل `audit_and_cod_separate` له كشف — J&T له INV شرعي (كشوف=0). المميِّز الصحيح = **وجود RV مطابق بالمبلغ** لا file_kind.

### 1.3 التسجيل التلقائي في الكشف المالي ✅
- `approveAudit` يكتب صف **INV** واحد في `carrier_operations` بإجمالي (الفاتورة + الضريبة)
- Idempotent عبر unique partial index `(audit_id) WHERE doc_type='INV'`
- `rejectAudit` / `reopenAudit` يحذفان القيد + يستدعيان `clearAuditCodOut`
- `saveSettlementUpload(direction='in')` يكتب صف **COD** (CR) إجمالي الدفعة، idempotent عبر `reference_no`
- `deleteSettlementUpload` يحذف القيد المقابل

### 1.4 استخراج COD التلقائي ✅
- **القاعدة الذهبية**: أي ملف من شركة شحن = `direction='in'` (مُستلَم). ممنوع `'out'` من أي audit.
- في `coreService.approveAudit`:
  - `file_kind === 'audit_with_cod'` → يستخرج 19 شحنة (أو أيّاً كان) كـ 'in'
  - أي قيمة أخرى → **لا يفعل شيئاً** في `cod_settlement`
- `syncAuditCodOut({ direction: 'in' })` في `codSettlementService.js`
- Source marker: `source_file = 'audit:<auditId>'`، upload_id = `audit_in_<auditId>`
- Idempotent: يمسح batches القديمة في كلا الاتجاهين قبل الإدراج

### 1.5 دورة حياة Webhook → Audit ✅
- `importToAudit` في `WebhookEvents.jsx`: يحمّل الـ blob من storage → base64 → `sessionStorage.setItem('webhookImport', payload)` → `navigate('/upload')`
- `UploadWizard` يستمع لـ `location.pathname` (ليس useEffect فارغ deps!) → يفحص sessionStorage عند كل وصول لـ `/upload`
- `CONSUMED_WEBHOOK_IMPORTS` Set على مستوى الـ module يمنع التكرار في StrictMode dev
- على نجاح الاعتماد: `markEventProcessed(eventId, auditId)` يربط الـ webhook event بالمراجعة
- الشارة في `/webhook`: **"✓ تمت مراجعتها"** + زر **"فتح المراجعة"**

### 1.5b دورة حياة Webhook → COD Remittance ✅ (J&T-style)
- للشركات تاجد `file_kind='audit_and_cod_separate'` أو `'cod_only'`، يظهر زر **"💰 حفظ كتحصيل"** بجانب أو بدل "حفظ كمراجعة"
- `importToCod` في `WebhookEvents.jsx`: stash payload في `sessionStorage.webhookCodImport` → `navigate('/cod-settlements')`
- `CodSettlements` يفحص `location.pathname === '/cod-settlements'` ويلتقط الـ payload (مع `CONSUMED_COD_IMPORTS` set)
- يفتح `UploadModal` تلقائياً بـ `direction='in'` + `preloadedFile` + `sourceEventId`
- `UploadModal` يستدعي `handleFiles([preloadedFile])` على mount → preview جاهز
- بعد save بنجاح: `markEventProcessed(eventId, auditId=null, userId)` — `processed_at` تُحدَّث
- الشارة في `/webhook`: **"تحصيل مُستلَم"** (gold) + زر **"تم استيراده كتحصيل"** → ينقل لـ `/cod-settlements`
- إشارة الفعل: `e.processed_at != null && !e.audit_id` → COD imported

### 1.6 حذف Webhook Events ✅
- RLS policy `webhook_events_delete` موجودة (FOR DELETE TO authenticated USING true)
- `deleteWebhookEvent` / `deleteWebhookEvents` يستخدمان `.select('id')` بعد الحذف
  → يرفعان خطأ إذا 0 صف انحذف (RLS silent-fail protection)

### 1.7 مفاتيح Storage ASCII-آمنة ✅
- `webhook-intake` v10 — دالة `sanitizeStorageName` تحوّل أي حرف غير `[A-Za-z0-9._-]` إلى `_`
- الاسم الأصلي (مع العربية) يبقى في `webhook_events.file_name`
- المفتاح المنظّف في `webhook_events.file_path`
- لا حذف لـ blob القديم بمفتاح عربي — Supabase Storage يرفض الـ key

### 1.8 توسعة الحجم ✅
- جدول `audit_shipments` يحفظ كل شحنة بـ row مستقل (إلى 500K+ صف لكل مراجعة)
- `saveAuditToDB` يكتب الشحنات بدفعات 1000 صف
- `audits.results` JSONB يحمل فقط الـ issues (مع حد أقصى 2000)
- `loadAuditByIdFromDB` يحمّل issues فقط افتراضياً
- `loadAuditShipments(id, { from, limit, status })` للـ pagination

### 1.9 دليل المتاجر + التنبيهات + حملة التحصيل ✅ (Phase 1–5)
- `/merchants` يستقبل رفع `stores.xlsx` من المنصّة الداخلية (1,491 متجر حالياً)
- snapshot model: كل رفع يولّد `snapshot_id` جديد؛ `loadLatestMerchants` يرجع الأحدث
- `customer_merchant_links` يربط `customer_name` (من الـ receivables) بـ `store_id`:
  - زر "ربط تلقائي" في `/merchants` يستخدم Levenshtein + تطبيع عربي (alefs/ya/ta marbouta + diacritics)
  - عتبة auto-fuzzy = 0.78. تطابق دقيق على segment بعد `splitReceivableName` → confidence 1.0
  - `match_method='manual'` يُحفظ ضد إعادة كتابة auto-link لاحقة
- `customerReceivablesService.loadLatestReceivables` يدمج بيانات المتاجر تلقائياً عبر:
  `c.merchant = { storeId, storeName, phone, billingType, platformStatus, integrationType, shipmentCount, lastShipmentAt, walletBalance }`
  والفشل صامت (try/catch + console.info) — صفحة المديونيات تشتغل بدون merchants snapshot
- في `/receivables` تبويب **🚨 تنبيهات** (red accent) يصنّف كل عميل لواحد من:
  - `prepaid_with_debt` 🚨 — دفع مسبق + عليه دين = خلل تقني
  - `postpaid_overdue` ⏰ — دفع لاحق + +60 يوم = مرشّح للإيقاف
  - `inactive_with_debt` 😴 — موقوف في المنصّة + عليه دين = تحصيل قبل الإغلاق
- زر **📞 ملف حملة تحصيل** يصدّر 13 عمود (هاتف/نوع/حالة/aging/anomaly) للعرض الحالي بعد الفلاتر
- `/merchants` يعرض: top-20 بالشحنات + top-20 churned (مُعطَّل لكن شحن سابقاً، مرتّب بأحدث آخر شحنة) + walletPilesUp (محافظ راكدة)

**الثوابت:**
- table `merchants` (snapshot rows) + `customer_merchant_links` (customer_name → store_id)
- `computeMerchantInsights(merchants)` يرجع: `total/active/prepaid/postpaid/newLast30/neverShipped/dormantActive/churned/walletPilesUp/walletPilesAmount/walletTotal/topByVolume/churnedTop/walletPilesTop`
- `findMerchantForCustomer(name, merchants)` يرجع `null` تحت 0.78 (لا تخفّض هذه القيمة دون اختبار)
- الهواتف: `toPhoneString` يحوّل number → string بـ `Math.round` لحماية 12 رقم من scientific notation
- XLSX read: `raw:true` مطلوب لقراءة الهواتف الكبيرة بدقّة

### 1.10 نظام الأدوار والصلاحيات ✅ (Phase 6)
- **دوران فقط**: `admin` (مدير، يفعل كل شيء) + `accountant` (محاسب، صلاحياته في JSONB)
- العمود `profiles.permissions JSONB` يحمل المفاتيح الممنوحة `{ "audits.approve": true, ... }`
- مفاتيح الصلاحيات معرّفة في `src/lib/permissions.js` كـ `PERMISSION_CATALOG` — ~٧٠ مفتاح موزَّعة على ١٤ قسم (overview/uploads/webhook/audits/carriers/cod/receivables/collections/merchants/money/ledger/internal_exports/reconciliation/system)
- في كل مكوّن: `const { can } = useAuth(); if (!can('audits.approve')) return null;`
- في `AuthProvider`: يصدّر `can(key)`, `canAny(keys)`, `canAll(keys)`, `isAdmin`
- إدارة الصلاحيات من `/employees` — كل محاسب له زر "صلاحيات" يفتح modal مع checkboxes مجمَّعة + presets (`بدون / قراءة فقط / محاسب قراءة وكتابة / صلاحيات كاملة`)
- إجراء "حسّاس" (`sensitive: true`): يُستبعَد من preset "قراءة وكتابة" — مثل `audits.approve`, `audits.delete`, `bank.set_balance`, `system.period_close`
- **`admin` لا يخضع للـ JSONB** — يمرّ من `can()` بـ `true` دائماً
- صفحة `/employees` متاحة فقط للـ `admin` بغض النظر عن الصلاحيات
- FKs المعدَّلة لـ ON DELETE SET NULL (تسمح بحذف موظف): `audits.created_by`, `task_actions.user_id`, `tasks.assigned_to`, `tasks.created_by` — يحتفظ بالسجلات بدون اسم منشئ
- Edge function `manage-users` v2 — يقبل `permissions` في create، يستخدم `auth.admin.deleteUser` الذي يكاسكد عبر الـ profiles cascade الآن
- Nav gating في `App.jsx` — كل `NAV_ITEM` له `permKey` يفلتر العنصر للـ accountant

**ملفات نقطة الحقيقة:**
- `src/lib/permissions.js` — الكتالوج + `can()` + presets
- `src/lib/auth.jsx` — يعرض `can` في الـ context
- `src/lib/employeeService.js` — `loadEmployees`, `updateEmployeePermissions`
- `src/pages/EmployeeManager.jsx` — UI الإدارة الكامل
- `supabase/functions/manage-users` v2 — CRUD للموظفين

**القاعدة الذهبية:** أي زر يقوم بعملية مالية/حذف/اعتماد يجب أن يكون ملفوفاً بـ `can('key')`. UI الـ gate وحده ليس أمناً — RLS / edge function policies هي الحماية الفعلية.

### 1.11 تبويبات الـ hubs مرئية في القائمة الجانبية ✅ (UX 2026-05-29)
- مشكلة سابقة: شاشات الـ hubs (CustomerHub `/customer-360`، MoneyHub `/money`، CarriersWorkspace KPI) كانت تبويبات مخفية بلا مدخل في القائمة الجانبية → معلومات مدفونة.
- الحل في `App.jsx`:
  - `NAV_ITEMS` لـ `money` و `customer-hub` تحمل الآن `subTabs: [{ tabId, label, icon, legacy }]`
  - تُرسَم كصفوف فرعية (`NavSubBtn`) تحت العنصر الأب، تنقل لـ `${path}?tab=${tabId}`
  - `أداء الناقلين` (`/carrier-kpi`) أُضيف كعنصر مسطّح مستقل في قسم carriers (بدل أن يكون تبويباً مخفياً في `/hub`)
  - `subTabOf(item)` يحدّد التبويب النشط (canonical `?tab=` أو legacy path أو افتراضي = أول تبويب)
  - `activeFor` يُخفي تمييز الأب عندما يملك subTabs نشطاً (لا تمييز مزدوج)
- **القاعدة (مُعدَّلة v4 — 2026-07-02):** أي hub جديد بتبويبات يُعرّف `subTabs` على عنصره في `NAV_ITEMS` **كبيانات** (تمييز الأب + مسارات legacy) — لكنها **لا تُرسَم صفوفاً في الجانبية** (قرار المستخدم: «القائمة موجودة داخلياً وجانبياً ليش؟») — تبويبات الصفحة الداخلية هي المبدّل الوحيد.

### 1.11b بطاقات الصحة في `/hub` ✅ (2026-06-09)
- `loadCarriersHub` يجلب بالتوازي مع `hub_rollup`: RPC `carrier_cod_net_balances` + المراجعات المعتمدة + فواتير RV المفتوحة غير المربوطة بمراجعة
- كل بطاقة ناقل تعرض `HealthStrip`: **COD معلّق** (ذهبي، ينقل لـ`/cod-settlements?carrier=`) + **N فاتورة غير مدقَّقة** (أحمر، ينقل لـ`/ledger?carrier=`) + **آخر تدقيق: <period>** (أو «لم تُدقَّق أي فاتورة بعد» بالأحمر إن كان للناقل عقد بلا أي مراجعة معتمدة)
- الإشارات الثلاث تجيب أسئلة الصباح اليومية دون جولة عبر 3 صفحات

### 1.11c توحيد معرّف أرامكس + فخّ COD-عبر-إشعارات ✅ (2026-06-09)
- **توحيد نهائي**: بيانات `carrier_id='aramex'` اليتيمة (294 صف cod_settlement + 4 قيود دفتر) رُحِّلت لـ`c_1777506662790`. لا وجود لمعرّف `aramex` في أي جدول بعد الآن (alias `canon()` في monthlyReportService بقي كحماية فقط)
- **اكتشاف محاسبي مهم**: أرامكس تحوّل تحصيل COD **كإشعارات دائنة (DG) داخل كشف الحساب** — قيود COD CR الدفترية الأربعة كانت **نفس مبالغ** إشعارات DG الأربعة (2,485 + 13,277 + 2,148 + 8,384.01 = 26,294.01) → ازدواج يخفض الرصيد غلطاً. حُذفت قيود COD الدفترية (صفوف cod_settlement التفصيلية بقيت — هي مصدر شاشة التسويات)
- **الحارس الدائم**: `file_signature.cod_remit_via_credit_note=true` على أرامكس — `saveSettlementUpload` يتخطّى قيد COD الدفتري لهؤلاء الناقلين (صفوف التسوية تُدرَج عادي). أي ناقل يحوّل COD عبر إشعارات كشفه يجب أن يحمل هذا العلم وإلا تكرّر الائتمان

### 1.11d إعادة هيكلة الواجهة — مساحة عمل الناقل + الرفع الذكي + قائمة مبسّطة ✅ (2026-06-09)
- **مساحة عمل الناقل**: `CarrierTabs` (components/) شريط chrome مشترك يربط 5 شاشات (نظرة عامة `/carrier?id=` · المراجعات `/audits?carrier=` · تحصيل COD `/cod-settlements?carrier=` · كشف الحساب `/aramex-statements?carrier=` · الدفتر `/ledger?carrier=`) — تنقّل فقط، لا تضمين صفحات. كل صفحة تقرأ `?carrier=` وتتفلتر (CodSettlements وCarrierStatements عبر effect على `location.search` — PageSlot يبقي الصفحات mounted)
- **الرفع الذكي `/drop`** (SmartDrop.jsx): نقطة رفع واحدة لأي ملف — يشمّ المحتوى: PDF كشف (sniffStatementCarrier) → stash `statementImport` → `/aramex-statements`؛ PDF فاتورة أرامكس (looksLikeAramexInvoice) → stash `webhookImport` → `/upload`؛ xlsx فيه deliveryCharges → مراجعة؛ xlsx بـ AWB/مبالغ فقط → تحصيل (يسأل عن الناقل إن لم يُكتشف). نفس نمط stash+pathname-listener (§1.5). مستمع `statementImport` في CarrierStatements بحارس module-level `CONSUMED_STATEMENT_IMPORTS`
- **القائمة الجانبية**: pinned = الرئيسية + رفع ملف + الوارد + مركز الرفع؛ الأقسام = شركات الشحن (hub/audits/ledger/statements/tasks) · **التقارير** (شهري/KPI/تنبؤ/تصدير — قسم جديد) · الأموال · العملاء · النظام (إدارة الشركات + العقود انتقلتا هنا). عنصر «مراجعة جديدة» حُذف من القائمة (`/upload` ما زال يعمل — يوصَل عبر `/drop`)

### 1.11e سلامة البيانات `/integrity` ✅ (2026-06-12)
- RPC `integrity_check()` (Postgres): 6 فحوص تناقضات صامتة — مراجعة معتمدة بلا أثر دفتري · سحبة بلا ملف · skipped رغم أوزان · اعتماد بلا تحصيل مستخرَج · قيد COD مزدوج مع إشعارات · RV قديمة (+45ي) بلا تدقيق
- الصفحة (`IntegrityCheck.jsx` + `integrityService.js`): بطاقة لكل تناقض + عينات + زر فتح، وأول إصلاح آلي `resetWronglySkipped`. **أي فخّ بيانات جديد يُضاف كفحص هنا**

### 1.11f إعادة هيكلة القائمة الجانبية (IA) ✅ (2026-06-21)
- مشكلة: أبواب الرفع مشتتة (`/drop`+`/webhook` مثبّتة أعلى · `/uploads` Zoho مدفونة في «النظام») · أزرار كثيرة · كشوف الحساب صعبة الوصول. (تصميم عبر workflow وكلاء)
- الحل في `NAV_ITEMS`/`NAV_SECTIONS` (App.jsx): **مثبّت واحد** (الرئيسية فقط). **٦ أقسام**: شركات الشحن · الأموال · العملاء · **الرفع والوارد** (قسم جديد يجمع `drop`/`webhook`/`uploads`/`weight-billing`) · التقارير والتصدير · الإعدادات والنظام (ضُمّ إليها `tasks`).
- **كشوف الحساب** (`aramex-stmt`) رُفعت للمرتبة ٢ في «شركات الشحن» + `permKey` صار `carriers.view` (كان `upload_statement` يخفيها عن المحاسب القارئ — زر الرفع داخل الصفحة يبقى مقيّداً).
- **أكورديون قسم-واحد (v4 — 2026-07-02):** فتح قسم **يقفل كل البقية** («لو فتحت قسم مفروض يقفل قسم»). الافتراضي: **كل الأقسام مقفلة** (قرار المستخدم — «حتى شركات الشحن»). المفتاح `sa-nav-collapsed-v5` يطبّق الافتراض مرة لكل مستخدم. الطيّ عبر `maxHeight:0` لا unmount.
- **المرحلة ب** (دمج الـhubs): `CarriersWorkspace` صار **3 تبويبات** (كشف الشركات `/hub` · أداء الناقلين `/carrier-kpi` · المطالبات `/claims`) — `carrier-kpi` نُقل من «التقارير» و`claims` من قائمة «شركات الشحن» المسطّحة. عنصر `hub` في NAV له `subTabs` تعرضها كصفوف فرعية. `CARRIER_WORKSPACE_PATHS` يشمل الثلاثة؛ `/claims` لم يعد PageSlot مستقلاً (يُمرَّر `carriers` للـworkspace لأن Claims يحتاجه). المسارات القديمة `/carrier-kpi` و`/claims` تهبط على تبويبها.
- **القاعدة:** أي صفحة رفع/إدخال جديدة → قسم «الرفع والوارد». لا تُثبّت عناصر جديدة (المثبّت = الرئيسية + لوحة القرارات فقط). كل أيقونة قسم لون مميّز. أي عدسة جديدة لـ«حالة الناقلين» → تبويب في `CarriersWorkspace` لا عنصر nav مسطّح.

### 1.19 درجة خطر العميل + لوحة القرارات ✅ (2026-06-21)
- `customerRisk.js`: `computeRisk(c)` يجمع أعلام الشذوذ في درجة 0–100 (دين+أعمار+شدّة الشذوذ+قابلية التحصيل) + مستوى + `shouldStop` (عميل نشط بدفع لاحق ودينه متأخّر/تجاوز الحد = أوقفه قبل التراكم). يُستخدَم في تبويب تنبيهات الديون (شارة خطر + بانر «🛑 يُوقَف الآن» + تصدير القائمة) **و** في لوحة القرارات.
- **لوحة القرارات** `/decisions` (`DecisionsBoard.jsx`، مثبّتة «شاشة الصباح»): تجمع إشارات القرار من كل التطبيق في بطاقات: يُوقَف الآن (من `loadCustomerWatch`+`computeRisk`) · COD لم يُحصَّل (`loadCarrierNetBalances` الموجب) · خزائن COD محتجزة (`loadTreasuryBalances`) · فجوة تسجيل Zoho (`loadVendorReconciliation`) · تنبيهات العملاء. كل بطاقة تنقل لصفحة الإجراء.
- **القاعدة:** أي إشارة قرار جديدة (تحتاج فعلاً اليوم) تُضاف كبطاقة في `/decisions` — لا تُدفَن في صفحتها فقط.

### 1.20 كتالوج الأزرار + معجم التسمية ✅ (2026-06-29، من تدقيق وكلاء)
**دلالة variants الـ`Btn` (في `src/components/UI.jsx`، موثّقة فوق `VARIANTS`):**
- `primary` (أسود) = الفعل الرئيسي **الواحد** للسياق (رفع/تأكيد المعالج/التالي)
- `accent` (أخضر) = تأكيد/حفظ/اعتماد/تسديد/ربط (modal confirm، اعتماد المراجعة)
- `ghost` = مساعد/ثانوي/تنقّل/**إلغاء**/تصدير ثانوي/تحديث
- `danger` (أحمر) = حذف/رفض مدمِّر فقط
- `gold` (برتقالي) = تنبيه/استثناء فقط (لا للأدوات العامة)
- `outline` = الحالة المطفأة لزر تبديل (toggle غير نشط؛ النشط = `primary`)
- **`success`/`navy` مهملان** (success ≡ accent لونياً، navy ≡ primary) — لا تستعملهما في كود جديد
- حجم `full` = عرض كامل (width:100%+توسيط) بدل style overrides · prop `title` للأزرار الأيقونية · المعطّل = لون muted دلالي (لا opacity)

**قاعدة المكان:** PageHeader actions = الفعل الرئيسي (primary) + مساعدات (ghost sm) · شريط الفلاتر = تصدير/أدوات العرض (ghost sm) · صف الجدول = إجراءات سياقية (ghost sm، الإيجابي accent، الحذف danger) · modal footer = إلغاء (ghost) + تأكيد (accent/danger). **أقصى زر بارز واحد في الـheader**.

**معجم التسمية (ممنوع «سحب»/«صدّر» المبهمة):**
- **استيراد** 📥 = ملف وافد للنظام · **تحميل** ⬇️ = ملف للجهاز · **تصدير** 📤 = لنظام خارجي · **رفع** = قناة الاستقبال
- **تحصيل لمحة** = المتوقّع من نظام لمحة الداخلي (out) · **تحصيل شركة الشحن** = المُحوَّل فعلاً (in) · الفرق = متوقّع − مُستلَم
- **مراجعة** = الكيان (السجل) · **تدقيق** = الفعل · **إلغاء** (لا «تراجع») في الـmodals

**توكنات الثيم** (`src/index.css` `:root`): `--space-1..8` (تباعد) · `--fs-xs..3xl` + `--lh-tight/snug/normal/relaxed` (طباعة) — أساس للمهاجرة التدريجية. الوضع الداكن: `--green` إيميرالد مميّز عن `--accent` التركواز. **الخط ثابت PingAR** (لا يُغيَّر).

**القاعدة:** أي زر/تسمية/لون جديد يُقاس على هذا الكتالوج. لا تُدخِل variant مهملاً ولا مصطلحاً مبهماً.

### 1.21 حزمة «الوضوح والسلاسة» — موجات تحليل الوكلاء ✅ (2026-07-02)
من workflow تحليل 6 محاور (IA/ثيم/جوال/أرقام/تقارير/CRM) — أبرز الثوابت الجديدة:
- **مركز التقارير `/reports`** (ReportsCenter.jsx): كتالوج بمعاملات (شهر/ناقل) — شهري + كشف ناقل رسمي (`carrierSoaExport.js`، رصيد جارٍ §2.4 + COD معلّق) + **مطابقة بنكية** (`bankReconReport.js`: bank_transactions × قيود PAY، ±0.5 ر.س ±3 أيام، يستبعد المرفوض §1.15، 3 أوراق). **كل توليد يمرّ عبر `persistAndDownloadExport`** (kinds: monthly/carrier_soa/bank_recon) — قاعدة §1.13 مطبَّقة.
- **درجة صحة الناقل الموحّدة** `carrierScore.js` — لا معادلات محلية (كانت Overview وCarrierKpi متناقضتين).
- **RTL لكل تصدير Excel** عبر `xlsxRtl.js` (31 نقطة) — الاستثناء الوحيد `generateCleanExcel` (§1.15).
- **شريط تنقّل سفلي للجوال** (`.bottom-nav` في App.jsx، ≤768px): الرئيسية/القرارات/رفع/الوارد/القائمة — طبقة جوال منفصلة لا تخالف §1.11f. زر المساعد مرفوع فوقه.
- **CRM قوائم المبيعات** (`/crm?tab=sales`): 3 قوائم من merchants (سجّل وما شحن · توقّف · نشط وخامل +45ي) + `PhoneLink` (tel/wa.me) + بطاقة العميل تعرض جانب المبيعات و`effectiveDebt` (زوهو + محفظة سالبة — `customerRisk.js`).
- **التقرير الشهري**: عمود التغيّر شهر-بشهر + شارة «⚠ زاد ولم يُدقَّق» (مفوتر +10% بلا مراجعة) + طباعة A4 (`@media print` عام — `.no-print` يخفي، `.print-only-title` يظهر).
- **قاعدة المودالات**: `role="dialog"` على Modal — لا تنشئ مودالاً بلا هذا الدور (قواعد الجوال تعتمد عليه).

### 1.22 ربط Zoho Books API + شاشة «الوضع المالي» /pnl ✅ (2026-07-02)
- **الربط**: تطبيق Server-based **منفصل** (Self Client القديم يشغّل النظام الداخلي — **ممنوع لمسه**). OAuth عبر `/zoho-callback` (ZohoCallback.jsx) → edge function **`zoho-sync` v6** تبادل الكود بـrefresh token دائم في `zoho_auth` (RLS بلا سياسات = service role فقط). Scopes قراءة فقط — **ممنوع أي كتابة في زوهو**.
- **أمان الدالة (من فحص وكلاء عدائي — 7 ثغرات أُغلقت)**: verify_jwt يقبل anon العام فلا يحمي → الحماية داخلية: `requireUser` (getUser) لكل action؛ الأرقام تتطلب admin أو `money.pnl`؛ `exchange_web` admin فقط + قفل `already_connected` (الاستبدال يحتاج `force:true`). TTL سيرفري 10 دقائق على `pnl_month` (حصة زوهو 100/دقيقة). CORS مقيّد بدومين التطبيق. **أي action جديد في zoho-sync يمرّ بنفس الحارس**.
- **قائمة الدخل**: `GET /books/v3/reports/profitandloss` (يعمل لكنه **غير موثّق** — computed_net البديل موجود). المحلّل `parsePnl`: «غير التشغيلي» يُطابَق **قبل** «التشغيلي» (وإلا كتبت non-operating فوق income بالمؤسسات الإنجليزية)، مطابقة عمق ≤1، أول-مطابقة-تفوز، لا نزول داخل قسم مُلتقط، الصافي من قسم «صافي» بالاسم أو محسوباً.
- **الشاشة** `/pnl` (FinancialPosition.jsx + pnlService.js): كاش `pnl_snapshots` (صف/شهر، PK كامل) أولاً؛ تحديث حي للشهر الجاري إن قدُم +6 ساعات. بانر رابحون/خاسرون + شلال بلغة غير المالي + أرباع (الجاري لا يُوسَم مكتملاً) + بطاقة في `/decisions`.
- **فحص فجوة التسجيل**: دفترنا (شامل 15%) ÷1.15 مقابل cogs زوهو (قبل الضريبة) — **لا تقارن الشامل بقبل-الضريبة مباشرة** (فجوة وهمية 15%). عتبة نسبية 5% + بطاقة للفجوة السالبة.
- **قاعدتان ثابتتان**: تحصيل COD **ليس دخلاً** (أمانة التجار). «صافي الشهر» بالرئيسية اسمه «صافي حركة النقد مع الناقلين» — **لا رقمان باسم «صافي/ربح» بدلالتين**؛ الربح من `/pnl` حصراً.
- مصدر الدالة المرجعي: `supabase/functions/zoho-sync/index.ts` — أي تعديل يُنشر عبر MCP أيضاً.

### 1.23 حزمة فواتير+زوهو (لوحة الفواتير · المطابقة الحيّة · حملة المتأخرين) ✅ (2026-07-03)
- **لوحة فواتير `/zoho-data`**: التبويب الافتراضي `invoices`. RPC `zoho_invoice_dashboard()` (خفيف — لا يحمّل 4884 صفاً): open_ar/overdue/draft + شهرياً (remaining=SUM(balance)) + أعلى 20 مديناً؛ نقرة المدين تفلتر (`onPick=setQ`). تعريب الحالات عبر `zohoStatusAr`/`ZOHO_STATUS_AR` (pnlService) — شارات `StatusPill` ملوّنة في الجدول والفلتر والتصدير. **لا تعرض حالة زوهو إنجليزية خام في UI جديد**
- **مطابقة أرصدة العملاء الحيّة**: تبويب `zoho_live` (الافتراضي) في `/reconciliation` — RPC `customer_balance_recon_zoho()`: فواتير زوهو المفتوحة (حيّة) × **استحقاق لمحة** (`store_balances source='internal'` — إشارته سالبة للمدين فتُقلَب) × دليل المتاجر. المرساة: store_id من الاستحقاق ثم `customer_merchant_links` → اسم مطبَّع → `'n:'||norm`. الحالات: `matched` (±1) / `needs_investigation` / `internal_only` / `zoho_only`. المحفظة محور مستقل لا تُطرح.
  - **تصحيح جوهري (2026-07-17)**: الجانب الداخلي كان من `customer_receivables` (ملف `invoice_details.xls`) الذي تبيّن أنه **تقرير زوهو المجدول بالإيميل وأُوقف عمداً بعد الـAPI** — فكان التبويب يقارن زوهو الحي بزوهو قديم. **`customer_receivables` صار مصدراً ميتاً** (آخر صف 10 يوليو) — لا تبنِ عليه ميزة جديدة. كذلك تبويب «مطابقة لمحة الداخلية» (`balance_reconciliation`): عمود زوهو صار من المرآة الحية لا من ميزان مراجعة مرفوع (`store_balance_snapshots source='zoho'` مصدر ميت أيضاً). **قاعدة: أي ملف كان يُستورد من زوهو قبل الـAPI = ميت؛ زوهو يُقرأ من المرآة حصراً، والداخلي الحقيقي = ملفات لمحة (استحقاق/متاجر/تحصيل متوقع).**
- **حملة المتأخرين**: RPC `zoho_overdue_campaign()` (overdue مجمَّعة بالعميل + هاتف من المتاجر + قائمة فواتير) → زر «📲 حملة واتساب» (WhatsAppSendModal/Respondly — تأكيد صريح قبل الإرسال، بوابة `collections.view`) + «📞 ملف الحملة» Excel عبر `persistAndDownloadExport` بـ `kind='zoho_campaign'`
- **بطاقة «فواتير تنتظر نظرتك»** في `/decisions`: `loadInvoicesAwaitingReview` (webhookService) = أحداث `processed_at IS NULL AND audit_id IS NULL AND status≠failed` مع عمر بالأيام — تنقل لـ`/webhook` حيث ⚡ دقّق واعتمد
- **عدّاد الاسترداد** في `/pnl`: شريط تراكمي من `audit_claims` (`summarizeClaims`) — استُرد فعلاً/قيد المطالبة/مكتشفة، ينقل لـ`/hub?tab=claims`
- **تمرير الجوال في المودالات**: أي حاوية `overflowY:auto` داخل Modal تحمل `className="m-flow"` (وإلا حبست إصبع iOS — §1.18). مودال الجوال padding=16

### 1.24 «فلوسي عند العملاء» + ملخّص الصباح + توحيد مرجع الدين ✅ (2026-07-03)
- **`/customer-money`** (CustomerMoney.jsx): شاشة التحصيل الأولى، جوال أولاً — RPC `customer_money_dashboard()` (مستحق/متأخر/أعمار 4 شرائح/تحصيل شهري بحدّين + 56 عميلاً بهواتفهم وآخر دفعة). بطاقة العميل: 📞 tel: + 💬 wa.me + فواتيره بنقرة (`loadZohoOpenInvoices`). حملة واتساب للقائمة المفلترة. في شريط الجوال السفلي («فلوسي» بدل «رفع»)
- **ملخّص الصباح**: edge function `morning-brief` v1 + pg_cron `morning-brief-daily` (7:15 KSA) بهوية X-Cron-Key (نمط zoho-sync). الإعداد في `app_settings['morning_brief']` من زر 🌅 في `/customer-money` (تفعيل/رقم/قالب/معاينة/إرسال تجريبي). 6 متغيرات قالب Respondly. معطَّل افتراضياً — الكرون آمن دائماً
- **قاعدة مرجع دين العملاء = زوهو الحي** (فحص 20 وكيلاً، 14 تناقضاً مؤكداً — التقرير في CLAUDE أدناه وtasks #40/#41):
  - `portal_lookup` (بوابة العميل) يقرأ **فواتير زوهو الحيّة** (balance>0.5) لا snapshot — كان يطالب عميلاً سدّد (79.96 حقيقي) بـ6,201.42 مجمّدة. **ممنوع إرجاعه للـ snapshot**
  - الرئيسية: «مستحق لنا (العملاء)» و«تركّز المديونيات» من `zoho_invoice_dashboard` + شارة «زوهو حي» + fallback صامت للـ snapshot؛ النقر ينقل لـ`/customer-money`
  - شاشات «المتابعة الداخلية» (Watch/receivables/CRM) تبقى على الـ snapshot المفلتر لكن **موسومة** «الكشف الداخلي» — لا رقم بلا مصدر معلن
  - `loadEffectiveBankBalance()` في bankBalanceService = نقطة الحقيقة لرصيد البنك (ختامي آخر كشف أو اليدوي — الأحدث يفوز)؛ Forecast وOverview كلاهما عليها
- **متبقٍ موثَّق**: تناقضات الناقلين (رصيد /hub شامل المسدَّد · PAY لا يكتبها أحد · صافي معكوس الإشارة · COD الشهري بمصدرين) في task #40 ✅، وازدواجية حملة /receivables في #41 ✅
- **توحيد حملة التحصيل ✅ (2026-07-03، #41)**: **الحملة الوحيدة = زوهو الحيّ** في `/customer-money` (WhatsApp + ملف `kind='zoho_campaign'`). ملف `/receivables` أُعيد تسميته من «حملة/ملف تحصيل» إلى **«الكشف الداخلي»** (قائمة فرز من الـsnapshot، لا تُسمّى حملة) ومُرِّر عبر `persistAndDownloadExport` (`kind='internal_watchlist'`، إصلاح §1.13). RPC `customer_money_dashboard` كُبِّر بحقول المتجر (billing_type/status/wallet_balance/last_shipment_at — إضافة صرفة، المفاتيح القديمة سليمة) فصار ملف الحملة الحيّ يحمل نفس سياق العميل الغني. **قاعدة: أي حملة/دنّينغ يقرأ الدين من زوهو الحيّ لا من الـsnapshot.** (ما زال في /receivables زرّا WhatsApp على الـsnapshot — مرشّحان للإزالة لاحقاً لصالح /customer-money)

### 1.25 توحيد أرقام الناقلين — نقاط الحقيقة الواحدة ✅ (2026-07-03، فحص وكلاء)
من فحص إعادة البناء (62 وكيلاً): 5 تناقضات مؤكدة لنفس المفهوم عبر صفحات مختلفة، كلها وُحِّدت ومُتحقَّقة بالـSQL الحي.
- **رصيد الناقل** = `SUM(DR−CR) FILTER (status≠'paid')` — نقطة الحقيقة `carrier_open_balance` (/ledger). `hub_rollup` يُرجِع الآن `open_balance` بنفسها (/hub و/carrier)، وcarrierProfileService يستبعد المسدَّد. **ممنوع حساب balance = totalDr−totalCr الخام** (كان أرامكس يظهر 164,003 وهو مسدَّد بالكامل). total_dr/total_cr للعرض فقط.
- **المدفوعات للناقلين** = جدول `payments` (حسب paid_at) — **لا قيود `doc_type='PAY'`** (لا يكتبها أحد؛ createPaymentRecord يكتب في payments + يقلب status فقط). مطبَّق في: monthlyReportService · bankReconReport (loadPayOps يُطبِّع حقول payments لأسماء القيد) · `monthly_financial_snapshot.carrier_paid`. أي تقرير مدفوعات جديد يقرأ payments لا PAY.
- **مستحق علينا للناقلين (AP)** = `SUM(net) per carrier HAVING net>0.5` (المدينون فقط) — نقطة الحقيقة `ap_aging_by_carrier`. وُحِّد عليها `working_capital_now.total_ap` وcashAgingService. الأرصدة الدائنة (COD محتجز: سمسا/J&T…) **تُعرَض منفصلة** لا تُطرَح (كان −558K مضلِّلاً يخلط COD بالفواتير).
- **COD المُستلَم الشهري** = `cod_settlement direction='in'` (حسب upload_date) — **لا قيود COD الدفترية** (كانت تختلف 655K مقابل 588K). monthlyReportService يقرأ cod_settlement مثل الرئيسية.
- **«صافي الحركة مع الناقلين»** = `COD − billed` (نفس `monthly_financial_snapshot`: cod_received − carrier_spend_gross). التقرير الشهري وُحِّد عليها (كان billed−crTotal معكوس الإشارة). **قاعدة §1.22: لا رقمان باسم «صافي» بدلالتين.**

### 1.26 كتابة زوهو المحدودة — تطبيق الأرصدة الدائنة + منح صلاحية داخلي ✅ (2026-07-03)
- **الكتابة الوحيدة المسموحة في زوهو**: تطبيق رصيد دائن **موجود** على فاتورة **موجودة**. **ممنوع منعاً باتاً**: إنشاء/حذف فواتير، أي POST/PUT/DELETE آخر، أي صلاحية حسّاسة (DELETE/banking/settings.UPDATE). قاعدة المستخدم الصريحة.
- **الـendpoints الصحيحة (مثبتة في مؤسسة المستخدم .com)**: `POST /invoices/{id}/credits` **يُرفَض** «not authorized» في هذه المؤسسة. المستعملان الناجحان (من كود Deluge للمستخدم): **الدفعات الزائدة → `PUT /customerpayments/{id}` مع `{invoices:[...]}`** (اجلب التطبيقات القائمة عبر GET وضمّها حتى لا يدهسها الـPUT) · **الإشعارات الدائنة → `POST /creditnotes/{id}/invoices`** (إضافي آمن). دالة `zoho-apply-credits` v3.
- **كشف الأرصدة** (قراءة): RPC `zoho_customer_unused_credits()` من `zoho_contacts` (unused_credits_receivable>0.5 + دين) — قسم في `/customer-money` + رابط زوهو مباشر لكل عميل. `loadZohoUnusedCredits`/`planZohoApplyCredits`/`applyZohoCredits` في pnlService.
- **منح الصلاحية داخل النظام**: دالة `zoho-authurl` (admin) تبني رابط موافقة بالنطاق الموسّع = قراءة كل الوحدات + كتابة محدودة: **UPDATE على invoices/creditnotes/customerpayments/contacts + `creditnotes.CREATE`** (صفر DELETE/banking/settings.UPDATE). الموافقة تعود لـ`/zoho-callback` (exchange_web force).
- **تصحيح جوهري (2026-07-06 — Tine)**: تطبيق **إشعار دائن** = `POST /creditnotes/{id}/invoices` يعتبره زوهو **CREATE** فيحتاج `creditnotes.CREATE` (بـUPDATE وحدها → «not authorized»). الدفعة الزائدة = `PUT` (UPDATE، تعمل). فالقاعدة القديمة «صفر CREATE» عُدِّلت: `creditnotes.CREATE` مضافة لتطبيق الإشعارات آلياً. **الكود يطبّق فقط (POST …/invoices)، لا يُنشئ مستنداً أبداً (لا `POST /creditnotes`)** — قرار المستخدم صراحةً «المصدر إشعار/دفعة يجب ألّا يفرّق». بعد التعديل يجب **إعادة المنح** (زر «منح الصلاحية») ليشمل التوكن الجديد النطاق. تصحيح لملاحظة سابقة: «not authorized» هنا **كان scope فعلاً** (CREATE ناقص) لا endpoint.
- **تكامل مع Deluge المستخدم**: كوده يعالج الدفعات الزائدة الجديدة (trigger عند الإنشاء). نظامنا يكمّل: **الإشعارات الدائنة + المتراكم** (ما يتخطّاه كوده). لا ازدواج (كل مصدر يُطبَّق مرة).

### 1.26b تطبيق الرصيد من المرآة + القابل للتطبيق فعلاً ✅ (2026-07-04)
من إلحاح المستخدم «احفظ الأرقام واقرأ منها بدل استدعاء زوهو كل مرة» + سلسلة رفض «أكثر من الرصيد» المتكرّر. **الجذر المكتشَف**: الأرصدة كانت **تُطبَّق فعلاً** (الفواتير تُصفَّر)، لكن الشارة تقرأ `contacts.unused_credits_receivable` (رقم مجمّع يتقادم) فتُبقي العميل ظاهراً → كل محاولة لاحقة تصطدم بفاتورة رصيدها صفر. «أكثر من الرصيد» = إعادة تطبيق على فاتورة مسدَّدة، لا فشل حقيقي.
- **حصة زوهو (~100 طلب/دقيقة للمؤسسة، مشتركة مع Deluge)**: `zoho-apply-credits` تطوّر لـ**v11**: `zfetch` إعادة محاولة 429 · كاش توكن (ساعة) + كاش خطة (90ث) · إعادة جلب طازج (getFresh) عند رفض الرصيد · **بناء الخطة من المرآة المحلية** (`buildPlanFromMirror`: `zoho_invoices`/`zoho_creditnotes`/`zoho_payments` عبر اسم العميل من `zoho_contacts`) = **صفر استدعاء زوهو** في الحالة الطبيعية، مع fallback حيّ (`buildPlanLive`) عند فراغ المرآة. `allocate()` منطق مشترك. **قاعدة: الأسماء تتطابق حرفياً بين مرايا زوهو** (contact_name = customer_name) — تحقّقنا.
- **المرآة كُبِّرت** (`zoho-sync` **v12**): جدول جديد `zoho_creditnotes` (لم يكن يُمرآ) + عمود `zoho_payments.unused_amount` (كان `amount` فقط) — أساس بناء الخطة محلياً. المزامنة صارت **كل 30 دقيقة** (cron jobid 2) لإبقاء المرآة طازجة. **أي جلب زوهو متكرّر يجب أن يقرأ من المرآة لا حيّاً؛ التطبيق (الكتابة) فقط يمسّ زوهو + getFresh عند الرفض.**
- **القابل للتطبيق فعلاً**: RPC `zoho_applicable_credits()` = `min(الرصيد المتاح, الفواتير المفتوحة)` لكل عميل من المرآة — يستبعد من له رصيد بلا فواتير مفتوحة (لا شيء يُطبَّق عليه). `loadZohoUnusedCredits` يقرأه بدل `zoho_customer_unused_credits` (contacts). **قاعدة: لا تعرض «رصيد قابل للتطبيق» دون التأكد من وجود فاتورة مفتوحة تقابله.**
- **Phase B — Webhooks ✅ (2026-07-04)**: دالة `zoho-webhook` (verify_jwt=false) تستقبل webhooks زوهو وتحدّث المرآة (`zoho_invoices`/`zoho_creditnotes`/`zoho_payments`) **فوراً بلا استدعاء زوهو**. الأمان: سرّ `zoho_auth.webhook_key` عبر `?key=` (403 لغيره). void/deleted → رصيد صفر. يرجع 200 دائماً (لا إعادة محاولة لا نهائية). المزامنة الدورية (30د) تبقى شبكة أمان. **الإعداد في زوهو خطوة المستخدم** (Workflow Rules لكل وحدة → Webhook للرابط بالسرّ). حينها تُلغى نافذة التقادم عملياً.
- **فخّ الإشعار الدائن العالق + مصالحة الحذف ✅ (2026-07-06 — `zoho-sync` v13)**: عميل ظهر برصيد دائن وهمي 1000 (CN-00029) رغم أن رصيده الحيّ في زوهو صفر. **جذران**: (١) **تطبيق إشعار على فاتورة (`POST …/invoices`) لا يُحرّك `last_modified_time` للإشعار** → مزامنة الدلتا لا تعيد جلبه (تتوقّف عند `last_modified ≤ آخر مزامنة`) فيبقى رصيده عالقاً. الحل: `creditnotes` صار **`noDelta`** (سحب كامل — الجدول عشرات الصفوف). (٢) **الحذف/الإلغاء في زوهو يُخرج الإشعار من القائمة، والمزامنة `upsert` فقط فلا تحذف الصفوف المختفية** → تبقى للأبد. الحل: **`reconcileDeletes`** على `creditnotes` — بعد سحب كامل مكتمل (`more=false`)، يحذف صفوف `synced_at < runStart` (لم تُلمَس هذه الدورة = اختفت من زوهو). **قاعدة: أي كيان مرآة قد تُحذف/تُلغى سجلاته في زوهو دون تحريك last_modified يجب أن يكون `noDelta` + `reconcileDeletes` (فقط لكيان كامل يفي بحدّ الصفحات).** التحقّق: بعد الإصلاح كل الأرصدة القابلة طابقت `zoho_contacts.unused_credits_receivable` بالهللة. **مرجع أوثق للرصيد الدائن = `zoho_contacts` (يحسبه زوهو، يُسحَب كاملاً)** — لو اختلف عن جمع الإشعارات/الدفعات فالمرآة بها صفّ عالق.

### 1.28 التصعيد القانوني `/legal` + أهداف الأعمار ✅ (2026-07-04)
- **مالان مختلفان لا رقم واحد**: العميل **دفع لاحق** دينه = فواتير زوهو المفتوحة (محاسبي). العميل **دفع مسبق** رصيده = محفظة المنصّة (سالب = دين). الرابط بينهما = `customer_merchant_links` (customer_name زوهو ↔ store_id المنصّة). «الرصيد الواحد» = زوهو للاحق + المحفظة للمسبق جنباً لجنب، لا رقم مدموج.
- **RPC `legal_escalation_dashboard()`** (مرآة محلية): (١) إجماليات الأعمار من `zoho_invoices` المفتوحة مقابل أهداف ثابتة **31–60 ≤ 50ألف · 61–90 ≤ 25ألف · 91+ = صفر**. (٢) عملاء تجاوزوا 90 يوم (زوهو) + هاتفهم عبر الربط. (٣) متاجر `billing_type='دفع مسبق'` بمحفظة `<−0.5` من أحدث snapshot للمتاجر.
- **الصفحة `/legal`** (LegalEscalation.jsx، قسم العملاء، `receivables.view`): بطاقات هدف أخضر/أحمر + قائمتا تصعيد (هاتف/واتساب لكل حالة) + «ملف القانونية» Excel (ورقتان) عبر `persistAndDownloadExport` (kind `legal`).
- **القاعدة**: أي إشارة «حوّل للقانونية» جديدة → قائمة في `/legal`. الأهداف ثابتة في الـRPC (تُعدَّل هناك).

### 1.29 حملات واتساب Hatif — قوالب متعددة + قناة آلية + تتبّع الردود/السداد ✅ (2026-07-15)
- **المزوّد Hatif/Voxa حصراً** (استُبدل Respondly كلياً §1.24). الأسرار `client_id`/`secret` في أسرار Supabase فقط. اللغة **ثابتة `ar`**.
- **فخّ التوكن (2026-07-15)**: طلب `POST api.voxa.sa/connect/token` **يجب أن يحمل `scope=VoxaAPI`** (مع grant_type/client_id/client_secret). بدونه يصدر التوكن (فـ`verify` ينجح لأنه يجلب التوكن فقط) لكنه **مرفوض 401 عند sendTemplate**. مطبَّق في الدوال الثلاث: hatif-send · morning-brief · zatca-alert. **أي دالة تجلب توكن Hatif تُضيف `scope:'VoxaAPI'`.**
- **القناة تُجلَب آلياً**: `hatif-send v2` يستدعي `GET /v1/channels/service-account` (كاش ساعة) إن لم يُمرَّر `channel_id` ولا `HATIF_CHANNEL_ID`. **حُذف حقل ChannelId من الواجهة** (الإعدادات + المودال). لتثبيت قناة بعينها: سرّ `HATIF_CHANNEL_ID`. إجراء `channels` يسرد القنوات.
- **قوالب متعددة**: `whatsapp_config.templates` = مصفوفة أسماء قوالب معتمدة (بدل `templateName` المفرد — يُرحَّل آلياً عند التحميل). `WhatsAppSettings` يديرها (إضافة/حذف/تعيين افتراضي بـradio). `WhatsAppSendModal` فيه **مُنتقي قالب `<select>`** يُختار لحظة الإطلاق (افتراضه `templateName`).
- **ربط متغيرات القالب ديناميكياً (2026-07-21)**: لوحة «متغيرات القالب» في `WhatsAppSendModal` — كل `{{i}}` يُربط بعمود من بيانات الصفحة الحالية (اسم/مديونية/آخر شحنة/محفظة/…) أو نص ثابت أو «افتراضي الصفحة» (vars القديمة — لا كسر). الربط **يُحفظ لكل قالب** في `whatsapp_config.templateVars` ويُسترجع تلقائياً، مع معاينة حية على أول مستلِم. المستلمون يحملون `fields:{...}` من صفحتهم (Retargeting/HatifLeads/CustomerMoney/LeadsTab/WaActions) والكتالوج المعرّب `FIELD_LABELS` في المودال. **فخّ**: `saveWhatsAppConfig` كان يُسقط المفاتيح غير المعروفة (drip كاد يضيع) — أي مفتاح إعداد جديد يُضاف للسيريالايزر صراحةً.
- **زر «حملة واتساب» على بطاقة العميل** (`/customer-money`): يطلق حملة قالب **لعميل واحد** (`onWa(c)` → مودال بمستلِم واحد). محادثة wa.me الحرّة بقيت كأيقونة 💬 ثانوية فقط.
- **التتبّع — جدول `whatsapp_campaign_sends`** (RLS: قراءة authenticated، كتابة service role فقط): `hatif-send` يكتب صفاً لكل إرسال ناجح (هاتف مطبَّع/قالب/`contact_id`/`conversation_id`/`message_id`/campaign/amount). **لا رقم هاتف في webhook Voxa** — لذا نخزّن `conversation_id`+`contact_id` وقت الإرسال للمطابقة لاحقاً.
- **RPC `whatsapp_campaign_status()`**: آخر حملة لكل هاتف + التسليم/القراءة + **هل ردّ** (من الـwebhook) + **هل سدّد بعدها** (أول `zoho_payments.date ≥ sent_at` بمطابقة اسم مطبَّع). `loadWhatsAppCampaignStatus()` يرجع Map بالهاتف → سطر حالة على البطاقة. **قاعدة السداد تقريبية بالاسم** (لا مفتاح مباشر عميل↔هاتف↔دفعة).
- **`hatif-webhook`** (`verify_jwt=false`، بوابة `?key=` ضد `zoho_auth.webhook_key` — نمط §1.26b): يحدّث `status/delivered_at/read_at/error_reason` + أول `replied_at`/`reply_body`، بالمطابقة على `conversation_id` ثم `contact_id` لأحدث إرسال. يرجع 200 دائماً. **إعداد Hatif خطوة المستخدم**: Settings → API Connect → Webhook URL = `…/functions/v1/hatif-webhook?key=<webhook_key>`.
- **سجل الحملات المرجعي** (2026-07-15): `hatif-send v3` يخزّن `sent_by = user.id` (لا 'admin'/'user'). RPC `whatsapp_campaign_log(p_phone, p_limit)` يُرجِع كل رسالة + اسم المُرسِل (من `profiles`) + الحالة (`loadWhatsAppLog`). المكوّن المشترك `WhatsAppCampaignLog.jsx` (`CampaignLogTable` + `CustomerCampaignHistory` + `campaignStatusBadge`). يُعرَض في: **تاب «سجل الحملات»** في `/whatsapp-settings` (فلاتر: بحث/قالب/حالة + مؤشّرات وصلت/قُرئت/ردّ/فشل) · **تاريخ العميل** داخل مودال متابعة `/retargeting`.
- **إطلاق حملة من `/retargeting`** (بوابة `crm.view`/`collections.view`): زر «إطلاق حملة للمعروضين» (المستلمون = صفحة الفرص الحالية، الاختيار داخل المودال) + زر إرسال (Send) لكل صف لعميل واحد + زر «إطلاق حملة» داخل مودال المتابعة. متغيّرات قالب إعادة الاستهداف: `{{1}}` اسم المتجر · `{{2}}` عدد الشحنات · `{{3}}` أيام آخر شحنة (تختلف عن قالب التحصيل §أعلاه — صمّم القالب في هاتف بما يطابق). شارة «📲 حملة <تاريخ> · وصلت/ردّ/سدّد» على كل صف من `loadWhatsAppCampaignStatus`. زر 💬 (wa.me الحرّة) بقي ثانوياً.
- **سياق المستلم الموحّد (2026-07-21، v2 بعد حادثة TREVU/farnearapp)**: RPC `campaign_recipient_context(p_phones)` — **صف لكل (رقم، متجر)** من أحدث كشف متاجر (شحنات/آخر شحنة/محفظة/نوع فوترة/حالة + `store_count`) + زوهو الحي **لكل متجر** عبر روابطه. المودال يجلبه عند الفتح (`loadCampaignRecipientContext` — دفعات 400، فشله صامت، Map(هاتف→مصفوفة متاجر)) و**يطابق متجر المستلم بالاسم**: متجر واحد على الرقم = يُؤخذ؛ متاجر عدة = ما يطابق `r.name` فقط؛ لا تطابق = **لا سياق متجر** (رسالة ناقصة أفضل من بيانات متجر آخر). حقول الصفحة تفوز دائماً. **الحادثة**: v1 كان يأخذ «الأعلى شحناً للرقم» — رقم يملك TREVU PRINT (متوقف من أبريل) وfarnearapp (نشط) استلم «توقف نشاطكم منذ ٢١ يوليو» (تاريخ farnearapp اليوم) باسم TREVU. **قاعدتان**: (١) لا تكرّر جلب سياق العميل في صفحة لتغذية المودال — الـRPC هي المصدر؛ (٢) **أي صفحة تبني recipients تمرّر `fields` بأعمدة صفّها** (أُصلحت Segments — كانت بلا fields فامتلأ الفراغ من متجر آخر) — السياق مكمّل لا بديل.
- **نظام الحملات الاحترافي ✅ (2026-07-21)**: في `WhatsAppSendModal`: (١) **اسم الحملة إلزامي** (حقل نصي، prefill من bucketLabel) — يُمرَّر `campaign.name` للفوري و`bucket_label` للمجدول؛ (٢) **استثناء من حملات سابقة**: multiselect من `loadCampaignNames()` (تجميع محلي لـ`whatsapp_campaign_sends`) → `loadCampaignPhones(names)` يزيل أرقامها من المستلمين؛ (٣) **«آخر رسالة: قبل N يوم»** تحت اسم كل مستلم (من `whatsapp_campaign_status`)؛ (٤) **لا حدّ لعدد المستلمين** (قرار المستخدم «افتح الحد») — الفوري يُقسَّم في المودال **دفعات 60 متتالية** (استدعاء دالة لكل دفعة) مع شريط تقدّم «لا تُغلق النافذة»؛ فشل دفعة كاملة يوقف البقية ويعرض المُنجز. الجدولة بديل خلفي: `scheduleCampaign` يقسّم **صفوف طابور 100/دفعة**؛ قائمة العرض تُقصّ على 400 صف (التحديد يشمل الكل).
- **فخّ ضياع السجل عند المهلة (2026-07-21 — حادثة حقيقية)**: `hatif-send` كان يُدرج سجل `whatsapp_campaign_sends` **دفعة واحدة بعد الحلقة** — استدعاء بـ290 مستلماً قتلته مهلة الدالة (504 بعد 151ث) بعدما خرجت ~120 رسالة فعلاً (أكّدتها إشعارات الـwebhook) **بلا أي صف سجل** (لا تتبّع، لا استثناء، خطر إعادة إرسال مزدوج). الإصلاح **v11** + `campaign-runner` **v3**: (١) **تسجيل فوري رسالة-برسالة** — الانقطاع يترك سجلاً دقيقاً والاستئناف = «استثناء من حملات سابقة» بنفس الاسم؛ (٢) **القياس الفعلي ≈ 1.1ث/رسالة** (Voxa ~500-700ms + sleep 300 + الإدراج) لا 800ms — دفعة المودال 60 (≈ دقيقة) وصف الطابور 100 (≈ 110ث) وestJobMs بالمشغّل 1100ms/رسالة. **قاعدة: أي حلقة إرسال في دالة edge تسجّل أثرها داخل الحلقة لا بعدها، وأي تقدير زمن دفعة يُقاس من سجلات execution_time الفعلية لا من الأمنيات.** **`campaign-runner` v2**: يعالج عدة صفوف بميزانية وقت (تقدير 800ms/إرسال، سقف 130ث من مهلة 150ث)، يحجز الصف بحالة `'sending'` (**القيد وُسّع بها** — كان يرفضها فيفشل الحجز صامتاً)، ويسجّل `campaign_name = bucket_label` (كان يكتب «مجدولة» حرفياً فيضيع اسم الحملة من السجل والاستثناء). زر إعادة الاستهداف صار «إطلاق حملة **لكل المطابق**» (صفحات 500 حتى الاكتمال — نفس نمط التصدير/الإسناد) لا المعروضين الخمسين.
- **تقرير الحملات (2026-07-21)**: رسائل الـAPI **لا تظهر كحملات في واجهة هاتف** (شاشة «الحملات التسويقية» عندهم للحملات المنشأة من واجهتهم فقط) — فالتقرير عندنا: RPC `whatsapp_campaign_report()` (صف لكل حملة: مستهدفون/وصلت/قُرئت/ردود/فشل) + `whatsapp_campaign_log` كُبِّرت بـ`p_campaign` (**النسخة القديمة ذات 2-arg أُسقطت** — إبقاؤها = التباس overload في PostgREST). الواجهة في تبويب «سجل الحملات»: جدول الحملات (نقرة = رسائل الحملة بحالة كل رقم) + تصدير Excel عبر `persistAndDownloadExport` (kind=`whatsapp_campaign`). **الحالات تبقى «أُرسلت» فقط ما لم يُضبط webhook هاتف** (خطوة المستخدم) — التبويب يعرض تحذيراً حين تكون كلها صفراً.
- **القاعدة**: أي حملة واتساب جديدة تمرّ عبر `WhatsAppSendModal`/`sendWhatsAppCampaign` (تُسجَّل آلياً). لا تُرسِل قالباً خارج هذا المسار (وإلا فقدت التتبّع). القناة لا تُدخَل يدوياً في كود جديد. **واسم الحملة هو مفتاح الاستثناء** — لا تكتب `campaign_name` عامّاً («مجدولة»/«تحصيل») في أي مسار إرسال جديد.

### 1.30 حارس زاتكا — الإرسال التلقائي في زوهو + تنبيه نفس اليوم ✅ (2026-07-15)
- **القاعدة الجوهرية**: الإرسال لبوابة فاتورة (زاتكا) **فعل زوهو لا فعل نظامنا**. الحل الجذري = تفعيل الدفع التلقائي في زوهو (Settings → Integrations → e-Invoicing → **Create, Push and Send**) فتُرسَل كل فاتورة لحظة إنشائها (يستحيل تجاوز مهلة منتصف الليل). **ممنوع أن يرسل نظامنا لزاتكا** (فعل امتثالي، يحتاج scope كتابة جديد، يخالف قاعدة «لا نعدّل مستندات زوهو»). نظامنا = **حارس/تنبيه فقط**.
- **الإشارة**: `zoho_invoices.einvoice_status` (تُمرآ عبر zoho-sync كل 30د) = `pushed` / `yet_to_be_pushed` / null (قديمة). RPC **`zatca_pending_today()`** (بتوقيت `Asia/Riyadh`): `today_count`/`today_total` (المهلة الليلة) + `overdue_count`/`overdue_total` (تجاوزت المهلة — خلل امتثال مستمر).
- **بطاقة في `/decisions`**: «فواتير لم تُرسَل لزاتكا» (أحمر، حسّاسة للوقت) — عدد اليوم + المتأخرة، تنقل لـ`/zoho-data?tab=invoices`. `loadZatcaPending` في pnlService.
- **تنبيه مسائي `zatca-alert`** (`verify_jwt=false`، X-Cron-Key ضد `zoho_auth.cron_key` — نمط morning-brief): cron `zatca-evening-alert` (jobid 5، `0 18 * * *` = 21:00 KSA) يرسل واتساب Hatif بعدد فواتير اليوم المعلّقة. الإعداد `app_settings['zatca_alert']` (`enabled`/`phone`/`template_name`) من صفحة «إعدادات واتساب» — **معطَّل افتراضياً** (لا يرسل بلا تفعيل، ولا يرسل إن كان عدد اليوم صفراً). متغيّرات القالب: `{{1}}` عدد اليوم · `{{2}}` إجماليها ر.س · `{{3}}` المتأخرة.
- **فخّ تقادم المرآة (2026-07-21 — إنذار كاذب مؤكَّد)**: تحويل `einvoice_status` من `yet_to_be_pushed` إلى `pushed` في زوهو **لا يحرّك `last_modified`** → مزامنة الدلتا لا تعيد جلب الفاتورة → تبقى عالقة `yet_to_be_pushed` في المرآة **للأبد** رغم إرسالها فعلاً (نفس عائلة §1.26b). النتيجة: 110 فاتورة أظهرتها المرآة «معلّقة» بينما زوهو الحيّ = صفر معلّق (أكّده المستخدم بالصورة). **الإصلاح**: (١) تصحيح البيانات — الـ110 حُوّلت لـ`pushed` (المرجع زوهو الحيّ). (٢) `zatca_pending_today()` صار **محصوراً بنافذة طزاجة يومين** (`date >= today-1`) — المرآة موثوقة للحديث فقط (30د + webhook)، والقديم يتقادم بعد الدفع فلا يُنذَر به. الإشارة الحقيقية = مهلة منتصف ليل يوم الفاتورة (يُلتقَط يوم 0 حين المرآة طازجة). **قاعدة: لا تعتمد على `einvoice_status` القديم في المرآة — يتقادم؛ الإنذار على فواتير اليوم/الأمس فقط.**
- **القاعدة**: أي إشارة امتثال/مهلة زمنية جديدة → بطاقة `/decisions` + (اختياري) تنبيه cron مسائي. لا تبنِ كتابة زاتكا في نظامنا.

### 1.31 مزامنة سياق العميل إلى جهات اتصال هاتف ✅ (2026-07-15)
- **هاتف لا يدعم وسم جهات الاتصال**: `POST /v1/tags/service-account` يُنشئ **تعريف وسم فقط**، ولا يوجد endpoint لربط وسم بجهة اتصال، ولا حقل `tags` في Create/Update Contact. لذا الوسوم تُكتب داخل **`customFields`** (الآلية الوحيدة المدعومة، وتُستبدَل صحيحاً). لا تبنِ ميزة على «وسوم جهات الاتصال» في هاتف.
- **فخّ `note`**: حقل `note` في هاتف **يُضيف ملاحظة جديدة كل مرة (لا يستبدل)** → تتراكم نسخ مكرّرة. **ممنوع استعماله في مزامنة متكرّرة** — كل السياق في `customFields`.
- **لا تدهس اسم جهة قائمة**: الفريق يُدخل أسماءً حقيقية. الاسم يُكتب **عند الإنشاء فقط** (`overwriteName:true` لتجاوزها). `company`/`position` تبقى سليمة (هاتف يطبّق غير الفارغ فقط).
- **الهاتف مُطبَّع في المصدر**: `norm_sa_phone()` (SQL) = `normalizeSaudiPhone` (JS) = `norm` (hatif-send). كشف المتاجر يعطي أرقاماً خاماً (`0558…`/`00971…`/`9660…`) — بلا تطبيع تُنشأ جهات مكرّرة **لا تطابق أرقام حملاتنا**. `hatif_contact_labels()` يطبّع + يدمج التصادمات + يستبعد المشوّه (1,461 → 1,455).
- **فخّ fan-out (مهم عام)**: `unnest(array_col)` داخل **نفس** CTE التجميع يضاعف كل `sum()` بعدد عناصر المصفوفة (كان: شحنات 18,130→54,390 · متاجر 3→9). **افصل تجميع المصفوفات في CTE مستقل ثم اضمّه.** أي RPC يجمع أرقاماً ومصفوفات معاً يُتحقَّق منه ضد المصدر الخام.
- **الآلية المرئية = Contact Properties حصراً** (مُتحقَّق بصور المستخدم + قراءة رجعية): `customFields` **تُخزَّن لكنها لا تظهر** في بروفايل هاتف · حقل `note` يظهر لكنه **يُضيف نسخة كل مرة ولا يُحذف برمجياً** → كلاهما مرفوض للمزامنة المتكرّرة. الصحيح: `POST /v1/contact-property-definitions` `{name,type,isRequired[,selectOptions]}` (**1=نص 2=رقم 3=قائمة ملوّنة 4=تاريخ**) ثم `PUT /v1/contacts/{cid}/properties/{pid}` `{value}` — هاتف يوجّهها لحقلها (`selectValue`/`numberValue`/`dateValue`/`textValue`) **ويستبدلها**.
- **بديل التاقات**: خاصية **قائمة (3)** بـ`selectOptions:[{value,color}]` = شارات ملوّنة في البروفايل. الخصائص السبع المعتمدة: `الحالة`(نشط/متوقف/جديد) · `التصنيف`(VIP/عادي) · `المديونية`(عليه مديونية/سليم) · `إجمالي المديونية` · `آخر شحنة` · `تاريخ الانضمام` · `تفاصيل المتاجر`(سرد لكل متجر).
- **الاسم = أعلى متجر شحناً** (بلا لاحقة) ويُكتب **عند الإنشاء فقط**. `fixnames` يصلح ما لوّثته مزامنة سابقة عبر البحث بالاسم (`?name=`) + نمط اللاحقة — لا يمسّ اسماً أدخله الفريق.
- **العربية عبر curl تتشوّه** على Windows (أُنشئت خاصية باسم `?????`). أي نصّ عربي يُرسَل لهاتف يجب أن يكون **داخل كود الدالة** لا عبر الطرفية.
- **نِسبة الدين لكل متجر**: `distinct on (customer_name)` تنسب رصيد كل عميل زوهو لمتجر واحد (الأعلى شحناً) فمجموع أسطر السرد = الإجمالي بالضبط.
- **الاقتصاد**: `hatif_contact_sync` يخزّن `contact_id` (يلغي البحث لاحقاً) + بصمة الحمولة (لا نستدعي هاتف إلا للمتغيّر). cron `hatif-contacts-sync` كل 3 ساعات بوضع `all` + سقف `maxWrites` (مهلة الدالة 150ث — العميل الواحد = ~7 استدعاءات). إجراء `inspect` يقرأ ما خزّنه هاتف فعلاً (تحقّق لا ادّعاء).

### 1.32 إعادة هيكلة النظام لموديولات — المرحلتان 0+1 ✅ (2026-07-15)
خطة معتمدة من المستخدم (تحليل 4 وكلاء): 7 أنظمة (الناقلين · المالية · التحصيل · المبيعات · واتساب · التقارير · الإدارة)، بمراحل 0–5 (المهام #42–47). المُنجَز:
- **توحيد واتساب (المرحلة 0)**: المكوّن `WaActions` (components/) = اتصال 📞 + **إطلاق حملة ✈️ (الفعل الرئيسي، يدير مودال WhatsAppSendModal بنفسه)**. مزروع في: `PhoneLink` بـCRM (4 مواضع) · التصعيد القانوني · طلبات السداد · درج الكشف الداخلي · Watch (زر إطلاق من صفوف ملف الحملة). **قاعدة: أي هاتف جديد في UI → `WaActions`، لا wa.me مباشرة.**
  - **تشديد (2026-07-16 — «كل شي على هاتف»)**: wa.me الحرّة 💬 **مطفأة افتراضياً** (`showChat=false`) — كانت تظهر وحدها لمن لا يملك `campaigns.send` (اكتُشف مع موظف مبيعات) فتضيع المحادثة في واتساب الموظف الشخصي خارج هاتف. زر الحملة ✈️ يظهر **للجميع** والمودال نفسه يعرض قفلاً واضحاً لمن لا يملك الصلاحية (لا إخفاء صامت يدفع للالتفاف).
- **صلاحيات v2 (المرحلة 1)**: مفاتيح جديدة `campaigns.send` (حسّاس — الإرسال الفعلي) · `whatsapp.view_log`/`whatsapp.configure` · `sales.view/manage/export` · `zoho.view` · `legal.view`. **أدوار جاهزة** في PRESETS: «موظف مبيعات» و«محصّل» (permissions.js `SALES_ROLE_KEYS`/`COLLECTOR_ROLE_KEYS`) — شاشة الفريق تعرضها تلقائياً.
- **`can(null)` صار مغلقاً** (كان `true` — أي صفحة تنسى حارسها تنكشف لكل محاسب). مواقع الاستدعاء تفحص وجود المفتاح قبل can — فُحصت قبل القلب. **قاعدة: أي صفحة جديدة لها حارس داخلي `can(...)` + permKey في NAV.**
- **الحارس المركزي للمسارات (2026-07-16)**: اكتُشف أن 31 صفحة بلا حارس داخلي — موظف بـ`sales.view` فقط هبط على غرفة العمليات ورأى كل المال (القائمة تخفي العنصر لكن الصفحة تُعرض لمن يكتب المسار). الحل في App.jsx: **`PATH_PERM`** خريطة مسار→صلاحية **تُشتق تلقائياً من NAV_ITEMS** (المسار + مسارات subTabs القديمة + 4 مسارات خارج القائمة: /carrier /upload /results /customers، و`/settings*`→system.view_settings). المسار الممنوع → `pathname='__locked__'` فلا يطابق أي PageSlot (**لا عرض ولا جلب**) ويسقط في تحويلة «مجهول» → أول صفحة مرئية للموظف (وموظف بلا صلاحيات إطلاقاً يرى رسالة قفل لا حلقة تحويل). الهبوط الافتراضي أيضاً ذكي: بلا `overview.view` → أول عنصر مرئي. إضافةً: حارس داخلي لـOverview + أرقام النقد (OperationsCommand/CashHero) خلف `overview.cash_position`، و`overview.view` أُزيلت من قوالب الأدوار المحدودة (مبيعات/محصّل/خدمة عملاء). **القاعدة: أي صفحة جديدة تُحمى تلقائياً بمجرد permKey في NAV — والمسارات خارج القائمة تُضاف لـPATH_PERM يدوياً.**
- **البوابة المركزية**: `WhatsAppSendModal` يفحص `campaigns.send` داخلياً (يغطي كل الصفحات)، و`hatif-send v4` يعيد الفحص **سيرفرياً** (الحدّ الفعلي). backfill منح المفاتيح الجديدة لأصحاب القديمة (`20260715_permissions_v2_backfill.sql`) — لا فقدان وصول.
- **سد ثغرات**: زر حملة Segments كان **بلا أي بوابة** · 4 تصديرات خام (Segments×2 وReceivables×2) حُوّلت لـ`persistAndDownloadExport` · حارس داخلي للوحة القرارات.
- **مركز التحصيل (المرحلة 2)**: `CollectionsHub.jsx` على `/customer-money` بتبويبات: تحصيل العملاء (زوهو حي — الافتراضي) · قائمة التحصيل (كانت تبويب CRM) · التصعيد القانوني (كان `/legal`) · الكشف الداخلي (كان `/receivables` داخل ملف العملاء). المسارات القديمة تهبط على تبويبها. التبويبات تُفلتَر بالصلاحية.
- **مركز المبيعات (المرحلة 3)**: `SalesHub.jsx` على `/retargeting` بتبويبات: إعادة الاستهداف · فرص من هاتف · عملاء خارج المنصّة (**`LeadsTab` مُصدَّر من CrmWorkspace** — يشارك helpers الملف، prop اسمه `active` لا `isActive`) · شرائح العملاء · متاجر المنصّة. CRM صار: متابعة · صفقات · مواعيد · أداء. «ملف العملاء» تقلّص لـ«متابعة العملاء» المسطّحة (CustomerWatch مباشرة) — **CustomerHub.jsx حُذف**.
- **القائمة الموديولية (المرحلة 4)**: `NAV_SECTIONS` = 7 أنظمة: الناقلين (+الوارد/الرفع+الإعداد/العقود+التجهيز) · المالية (+زوهو API+المطابقة+الأعمار+التنبؤ+الإقفال) · التحصيل (المركز+المتابعة) · المبيعات (المركز+CRM) · واتساب · التقارير · الإدارة. أقسام «التجهيز/الاستقبال/مصادر البيانات/العملاء والتحصيل» حُلّت. العناوين وُحِّدت مع تسميات القائمة.
- **القاعدة بعد الهيكلة**: أي صفحة تحصيل جديدة → تبويب في `CollectionsHub` · أي صفحة فرص/نمو → تبويب في `SalesHub` · أي صفحة جديدة تُسند لأحد الأنظمة السبعة (لا أقسام جديدة). المسارات القديمة **لا تُحذف** — تُضاف لمجموعة PATHS الخاصة بالهَب لتهبط على تبويبها.
- **توحيد المتابعة (تكملة 2026-07-15)**: نظام متابعة **واحد** لمركز المبيعات = `retargeting_followups` (+RPC `set_retargeting_followup` — coalesce يحفظ الموجود، ويسجّل في `retargeting_status_log`). «فرص من هاتف» تقرأ/تكتب الحالة منه (`loadFollowupsMap` في hatifLeadsService) — `hatif_unknown_contacts.status/note/owner_id` **مهجورة** (المصدر «مَن هم» فقط). المفردات في `retargetingService.STATUSES` (أُضيف: `converted` + مستبعدان `supplier`/`noise`). **قاعدة: لا تنشئ نظام حالات جديداً لأي تبويب فرص — استعمل الموحّد.**
- **ثغرة أُغلقت**: `zoho-apply-credits` كان يقبل الكتابة المالية بمفتاح **عرض** — الآن `action=apply` يتطلّب `zoho.apply_credits` (حسّاس) سيرفرياً + بوابة الأزرار. backfill لحاملي `money.pnl` فقط.
- **شريط الجوال السفلي**: الرئيسية · القرارات · **التحصيل** · **المبيعات** (بدل رفع/وارد) — `group` يشمل مسارات الهَب القديمة للتمييز النشط.

### 1.33 design-v2 — هوية «Konhub» المعتمدة ✅ (2026-07-15)
اتجاه بصري اعتمده المستخدم من معاينة تفاعلية (artifact direction-mock-v1). القواعد:
- **الفاتح هو الافتراضي**: ورق `#F5F7F4` بميل أخضر · بطاقات بيضاء · **السايدبار داكن دائماً `#101410` في الثيمين** (بصمة التصميم). الداكن: أخضر-فحمي `#131712`/`#1B211A` (لا نيلي بعد الآن).
- **فصل التعبئة عن النص**: `--brand` ليموني `#C9F24B` + `--brand-ink` **للتعبئة فقط** (زر primary، العنصر النشط في السايدبار). `--accent` زيتوني `#567C00` (فاتح) / `#B9DD3A` (داكن) للنصوص/الروابط/الأيقونات — **ممنوع استعمال `--brand` لوناً لنص** على أرضية فاتحة (تباين فاشل).
- **فخّ البلوكين**: يوجد بلوكا `[data-theme="light"]` في index.css — **اللاحق (سطر ~1090) هو الساري** (ترقية 2026-07-13 القديمة). أي تعديل ثيم يمسّ الاثنين أو اللاحق حصراً. وكذلك أنماط `.sidebar/.nav-item` معرَّفة مرتين — اللاحقة تفوز.
- **السايدبار**: العنصر النشط حبّة `border-radius:999px` بتعبئة براند وحبر داكن. المجموعات **ظاهرة دائماً** تحت تسميات خافتة (design-v2 يتجاوز أكورديون §1.11f v4). حدود الشعار/الفوتر = `--nav-divider` (أبيض شفيف) لا `--border`.
- **زر primary** (وnavy المهمل) = براند/حبر — دلالات §1.20 لم تتغيّر. الخط ثابت PingAR.
- **قاعدة**: أي لون جديد يمرّ بالتوكنات (لا hex صلب في الصفحات) — القيم الصلبة السابقة (th/td/tr:hover، درج الجوال الأبيض) أُصلحت لأنها كانت تُطبَّق على الثيمين.

### 1.34 اللغة الواضحة + معيار الهوامش ✅ (2026-07-15)
جرد شامل للمصطلحات (طلب المستخدم: «مصطلحات غير مفهومة أبداً لشخص طبيعي») — ~190 استبدالاً عبر 44 ملفاً، القائمة الجانبية أولاً ثم كل الصفحات (4 وكلاء). **نصوص العرض فقط — لا مفاتيح/enums/مسارات/permission keys.**
- **المعجم الجديد (يُقاس عليه أي نص جديد)**: مدين/دائن (بنك) → **مسحوب/مودَع** · قيد → **حركة محاسبية** · الدفتر → **حساب الشركة** (تبويب CarrierTabs) / «حسابات الشركات» (القائمة) · snapshot/لقطة → **كشف/نسخة محفوظة** · شرائح → **مجموعات العملاء** · lead → **جهة محتملة** · ضجيج → **أرقام غير مهمة** (المفتاح `noise` باقٍ) · سحب الأوزان → **تصدير الأوزان** · إشعار دائن → **إشعار خصم/إرجاع** · DSO/DPO/CCC → جمل عربية كاملة («متوسط أيام تحصيلك من العملاء»…) · «صافي الحركة» → **«COD ناقص الفواتير»** · roll-rate → «تغيّر أعمار الديون هذا الشهر» · funnel/pipeline → «مراحل التحويل»/«مسار الصفقات» · «آخر لمسة» → «آخر تواصل» · «وعود مكسورة» → «وعود لم تُوفَ». مفاتيح الصلاحيات لم تعد تُعرض خاماً في شاشة الفريق (tooltip فقط).
- **محفوظ بلا ترجمة (مفردات المستخدم)**: COD · AWB · زوهو · لمحة · واتساب · CRM · زاتكا · بلاك لست · شطب · «الكشف الداخلي» + معجم §1.20 (استيراد/تحميل/تصدير/رفع/مراجعة/تدقيق/إلغاء).
- **معيار الهوامش**: جذر كل صفحة `padding:'24px 28px 80px'` + `maxWidth:1320` + `margin:'0 auto'` (طُبّق على 31 صفحة). قاعدة جوال في index.css تقصّه لـ`18px 14px 40px`. **أي صفحة جديدة تلتزم به** — لا 1440/1400 ولا padding مخصّص.
- **فخّ PostgREST**: أي RPC يرجع صفوفاً يقفه PostgREST عند **1000 صف** سيرفرياً (`.range()` لا يرفعه) — أي جلب كامل يُصفَّح بحلقة 1000 (مثال `loadFollowupsMap`).
- **فخّ البناء**: لا تسلسل `build | grep | tail && git push` — الأنبوب يبتلع كود خروج vite (وصلت دفعة مكسورة مرة). البناء أمر مستقل ويُفحص `EXIT` قبل أي commit.

### 1.35 تذاكر خدمة العملاء `/ticket` + `/support` ✅ (2026-07-16)
المشكلة: فريق الخدمة يرد على العملاء في هاتف ومشاكلهم تضيع (لا رقم مرجعي/حالة/مسؤول). الحل = نظام تذاكر مصغّر:
- **الجداول**: `support_tickets` (ticket_no تسلسلي → `TKT-0042` · store_id/name/phone من دليل المتاجر · title/description · carrier_id/name اختياري · awb اختياري · status · created_by/assigned_to · resolved_at) + **`support_ticket_events`** (create/status/assign/comment — سجل كامل، وهو ما سيغذّي إشعارات واتساب مستقبلاً). RPC `support_ticket_stats()`. حالات: open→in_progress→waiting_customer→resolved→closed (`TICKET_STATUSES` في `supportService.js` = نقطة الحقيقة).
- **`/ticket`** (TicketForm.jsx): نموذج مستقل **بلا قائمة جانبية** — early return في AppInner **بعد بوابة الدخول** (ليس عاماً — قرار المستخدم الصريح). متجر ببحث مباشر (1,491 متجر، لا select خام؛ بلا تطابق = يُحفظ الاسم كما كُتب) + هاتف المتجر يُلتقط تلقائياً. شاشة نجاح تبرز الرقم المرجعي + نسخ. `?phone=9665...` يملأ المتجر تلقائياً (لرابط مستقبلي من هاتف).
- **`/support`** (SupportBoard.jsx، قسم «المبيعات»): بطاقات حالة تفلتر بالنقر (+«مفتوحة +3 أيام» حمراء) · فلاتر (بحث حر يلتقط TKT-N/متجر/AWB/هاتف · شركة · مسؤول) · **تغيير الحالة والإسناد من الصف مباشرة** (select مضمّن) · درج تفاصيل بسجل الأحداث + تعليقات · تصدير عبر `persistAndDownloadExport` (kind=`support_tickets`).
- **الصلاحيات**: `support.view/create` + `support.manage` (حسّاس) + `support.delete` (حسّاس) — قسم `support` في الكتالوج (أيقونة LifeBuoy مضافة لـ`SECTION_ICONS` في EmployeeManager). **دور جاهز «موظف خدمة عملاء»** (`SUPPORT_ROLE_KEYS`: overview.view + support.* عدا delete + merchants.view).
- **v2 (نفس اليوم)**: (١) **نوع التذكرة** `category` (`TICKET_CATEGORIES`: delayed/damaged/cod/billing/platform/other) — منسدلة بالنموذج + فلتر وعمود باللوحة. (٢) **الملاحظات الداخلية**: عمود `internal boolean default true` على الأحداث — التعليق افتراضياً داخلي 🔒 (checkbox «ملاحظة داخلية — لا تصل للتاجر أبداً»). **القاعدة الدائمة: أي إشعار واتساب مستقبلي يُرسَل فقط للأحداث `internal=false`** — الأمان بالافتراض. (٣) **لوحة الأرقام**: مبدّل «التذاكر | لوحة الأرقام» في `/support` — RPC `support_dashboard()` (الحالات × النوع × شركات الشحن + متوسط زمن الحل + أُنشئت/حُلّت آخر 30ي).
- **v3 (نفس اليوم — «نظام تذاكر عالمي»)**: (١) **النموذج مكوّن مشترك** `TicketCreateForm` (components/) — يُعرض في `/ticket` المستقلة **وكمودال** «تذكرة جديدة» في `/support` (مصدر واحد، لا نسختان). (٢) **إسناد لموظف من النموذج** عند الإنشاء (+حدث assign). (٣) **AWB إلزامي شرطياً**: `AWB_REQUIRED_CATEGORIES = ['delayed','damaged','cod']` — المالي/التقني/أخرى اختياري. (٤) **ذكاء نفس الشحنة في `createTicket`**: AWB يطابق (ilike) تذكرة سابقة → محلولة/مغلقة = **إعادة فتح تلقائية** + إلحاق التفاصيل (`{reopened}`) · مفتوحة = **إلحاق بلا تكرار** (`{existing}`) · وإلا `{created}` — **الدالة ترجع `{ticket, created|reopened|existing}` لا التذكرة مباشرة**، وشاشة النتيجة تميّز الثلاثة. (٥) **إغلاق تلقائي**: `support_autoclose()` + cron `support-autoclose-daily` (0 3 UTC = 6ص KSA) — «بانتظار العميل» بلا تغيير 3 أيام (من `updated_at`) → closed + حدث «أُغلقت تلقائياً» (مُختبَر: القديمة تُغلق والحديثة لا).
- **v4 (نفس اليوم)**: (١) **«عنوان المشكلة» حُذف** (قرار المستخدم — النوع + الوصف يكفيان): الوصف صار إلزامياً، وعمود `title` (not null) يتولّد من تسمية النوع؛ عمود اللوحة «المشكلة» يعرض الوصف والبحث يشمله. (٢) **المرفقات**: bucket خاص `support-attachments` + جدول `support_ticket_attachments` (اسم عربي في `file_name`، مفتاح ASCII في `file_path` — فخّ §1.7) + حدث `attach` — إرفاق من النموذج (حتى 10MB، يلتصق بالتذكرة الصحيحة حتى في إعادة الفتح/الإلحاق، وفشله لا يُفشل التذكرة) ومن الدرج، والفتح برابط موقّت ساعة (`getAttachmentUrl`). (٣) **فخّ عرض الحقول**: مكوّنا `Input`/`Select` في UI.jsx يدهسان ستايلهما الداخلي (`style: undefined` يُسبَق بالستايل ثم يدهسه) والـCSS العام بلا width — فالحقول تنكمش لعرض المحتوى. **لا تُصلح UI.jsx مباشرة** (كل صفحات النظام مضبوطة حول السلوك) — القاعدة المحصورة `.tform input/select/textarea { width:100% }` في index.css تعالج نموذج التذاكر فقط، وأي نموذج جديد يحتاج حقولاً ممتلئة يستخدم `className="tform"`.
- **واتساب مستقبلاً**: الهاتف محفوظ بالتذكرة + كل تحديث حدث مسجَّل → إشعار إنشاء/حل عبر مسار `hatif-send` القائم (قاعدة §1.29) — لم يُبنَ بعد.
- **القاعدة**: أي ميزة دعم/تذاكر جديدة تكتب حدثاً في `support_ticket_events` (لا تعدّل التذكرة صامتة) — السجل هو المرجع ومصدر الإشعارات.

### 1.36 سجل تحركات الموظفين + رسالة «ما عندك صلاحية» ✅ (2026-07-16)
طلب المستخدم: سجل تفصيلي كامل لكل موظف (دخول/تنقّل/أفعال/IP/دولة، والحسّاس خصوصاً) + رسالة صريحة عند فتح صفحة بلا صلاحية (لا تحويل صامت).
- **الجدول `user_activity_log`**: kind (`login`/`page`/`denied`/`export`/`data`/`action`) + action/detail/path/**ip/country**/user_agent. RLS: قراءة **مدير فقط** (`is_admin()`)، الكتابة عبر edge function وservice role.
- **3 مصادر تسجيل**: (١) **`activityLogger.js`** (fire-and-forget، الفشل صامت) → edge function **`track-activity`** تلتقط IP من `x-forwarded-for` والدولة من `cf-ipcountry` **سيرفرياً** — دخول مرة/جلسة (App) + كل تنقّل (`logPageView` بمنع تكرار المسار المتتالي) + كل محاولة ممنوعة (`logDenied`). (٢) **تصدير**: `persistAndDownloadExport` يسجّل (نقطة العبور الوحيدة §1.13). (٣) **trigger `log_sensitive_change()`** على الجداول الحسّاسة (payments/carrier_operations/audits/period_closes/support_tickets/app_settings + profiles-update) — يلتقط `auth.uid()` من الـDB نفسها فلا يُتجاوز من الواجهة. **لا triggers على جداول الإدراج الجماعي** (cod_settlement/audit_shipments — آلاف الصفوف/رفعة).
- **القراءة**: RPC `employee_activity_summary()` (آخر دخول من `auth.users.last_sign_in_at` + آخر حركة/IP/دولة + عدّادات 7 أيام + denied_7d) و`employee_activity_log(p_user,p_kind,...)` — كلاهما `is_admin()` داخلياً. الواجهة في **شاشة الفريق**: آخر دخول + عدّاد الحركة + شارة «⛔ N محاولة بلا صلاحية» على كل صف، وزر **«السجل»** يفتح مودالاً بفلاتر النوع وترقيم.
- **رسالة الرفض**: الحارس المركزي (§1.32) لم يعد يحوّل صامتاً — شاشة «⛔ ما عندك صلاحية على هذه الصفحة» (المسار + زر العودة + تنويه أن المحاولة سُجّلت). التحويل الذكي بقي **فقط** للمسارات المجهولة المسموحة.
- **القاعدة**: أي فعل حسّاس جديد إمّا على جدول مُصاد بالـtrigger (يكفي) أو يستدعي `logActivity()` يدوياً. جدول جديد حسّاس → أضفه لمصفوفة الـtriggers في الهجرة.
- **تفصيص تبويبات مركز المبيعات (نفس اليوم)**: «الصلاحيات لازم مفصّلة» — مفتاح لكل تبويب: `sales.view` صار **إعادة الاستهداف فقط** (كان يفتح الكل) + جديدة `sales.hatif_leads`/`sales.external_leads`/`sales.segments` + `merchants.view` للمتاجر. عنصر NAV يستخدم **`permAny`** (مصفوفة — أيّ منها يُظهر العنصر) والحارس المركزي وvisibleNav يدعمانها. حرّاس داخلية أُحكمت: Retargeting (أُزيل fallback crm.view) · HatifLeads · Segments (كان بلا حارس) · Merchants (كان بلا حارس). backfill: حاملو `sales.manage` فقط يُمنحون المفاتيح الجديدة (المحدودون عمداً لا). **قاعدة: أي تبويب جديد في هَب = مفتاح صلاحية مستقل + `permAny` على عنصر الـNAV.**

### 1.37 محرك المبيعات — المراحل الثلاث من تحليل المبيعات ✅ (2026-07-16)
من تحليل وكيل («لوحات عرض لا آلة مبيعات») — نُفّذت المراحل الثلاث دفعة واحدة:
- **«يومي»** أول تبويب بمركز المبيعات (SalesToday.jsx، بلا perm خاص): RPC **`sales_today()`** = متابعاتي المستحقة/المتأخرة (بأسماء المتاجر من `v_crm_retargeting`) + مَن ردّ آخر 48س + جهاتي الخارجية الجديدة + مهامي المستحقة — استدعاء واحد.
- **الإسناد الجماعي**: RPC **`set_retargeting_followups_bulk(phones[], owner, status, touch)`** (upsert يحفظ الموجود بـcoalesce) — أزرار «إسناد النتائج لموظف» في إعادة الاستهداف (كل المطابق للفلاتر، صفحات 500) وفرص هاتف (المعروضون). الموظف يفتح كلا التبويبين على **«المسندة لي»** افتراضياً + فلتر «⏰ مستحقة اليوم» في فرص هاتف.
- **الرد الوارد → إجراء** (`hatif-webhook` **v2**): أول رد = متابعة `needs_followup` (لا يدهس الحالات النهائية) + **مهمة `crm_task` فورية** لمالك المتابعة أو مُرسِل الحملة.
- **إرسال القالب يختم المتابعة**: `onSent` في إعادة الاستهداف → `whatsapp_sent` + touch للمستلمين (كان الإرسال الرسمي لا يلمس المتابعة بينما wa.me اليدوية تختمها). المجدولة لا تُختم وقت الجدولة.
- **الجدولة + drip** — **`campaign_queue`** (جدولة من مودال الإرسال: ⏰ checkbox + datetime) + عمود `followed_up` على السجل + edge function **`campaign-runner`** (cron كل 15د، jobid 11، X-Cron-Key): يرسل دفعة مجدولة/تشغيلة (sleep 350ms — حصة Voxa) + **متابعة غير المتجاوبين**: `whatsapp_config.drip = {enabled, template, afterDays}` (قسم في إعدادات واتساب) — من لم يرد خلال N يوم (وأقل من 30) يُرسَل له قالب المتابعة **مرة واحدة** (`followed_up=true` حتى عند الفشل — لا حلقات).
- **حماية الإفراط**: مودال الإرسال يحذّر «N أُرسل لهم خلال 7 أيام» + زر استبعادهم (من `whatsapp_campaign_status`).
- **الأداء والأهداف**: RPC **`sales_owner_stats()`** (معدل التحويل = returned/worked من `retargeting_followups`) — عمود بلوحة الأداء + بطاقة **«🎯 أرقامي»** الشخصية + هدف تواصل أسبوعي (`app_settings['sales_targets']`، يحرره الـadmin من رأس الجدول، أخضر/أحمر مقابل الفعلي).
- **جسور القوائم**: view `crm_leads_campaign` + عمود **`in_hatif`** (شارة «في فرص هاتف أيضاً») · زر **«أنشئ صفقة»** من بطاقة الجهة (entity_ref=اسمها — كانت الصفقات باسم حر منفصل).
- **⚠️ فخّ نشر MCP**: `deploy_edge_function` **يقلب `verify_jwt=true` افتراضياً** — أي webhook خارجي (Voxa/زوهو) ينكسر بصمت (401 قبل الكود). **مرِّر `verify_jwt: false` صراحةً** عند نشر دوال الـwebhooks/الكرونات (المخطط الكامل فيه البارامتر — النسخة المختصرة تخفيه). كرون hatif-contacts-sync أُصلح بإضافة Bearer anon لترويساته (jobid 7).
- **متبقٍ موثَّق من التحليل** (فجوة 5.1 كبيرة): توحيد حالات «جهات محتملة» (`crm_leads.status`) مع المفردات الموحّدة — جسر الوسم فقط نُفّذ.

### 1.38 حزمة التقوية من تقييم الوكلاء الثمانية ✅ (2026-07-21)
من workflow تقييم 8 محاور (58 finding بأدلة SQL حيّة) — نُفّذت الإصلاحات الحرجة والعالية:
- **الأمان (كان 22/100)**: (١) `reset-admin` **عُطّلت** (كانت verify_jwt=false تصفّر كلمة مرور المدير لقيمة ثابتة `Admin@2024` — استيلاء كامل من الإنترنت؛ **غيّر كلمة المرور**). (٢) جداول مالية (`payments`/`cod_settlement`/`payment_allocations`/`cod_reconciliation_action`/`dispute_notes`/`audit_awb_ledger`/`activity_log`) كانت `TO public USING true` → **`authenticated` + سحب صلاحيات anon**. (٣) trigger `guard_profile_privilege_change` يمنع الموظف من تغيير `role/permissions` على نفسه (إلا admin/service_role) + `REVOKE UPDATE(role,permissions)`. (٤) trigger `guard_campaign_queue_insert` يفحص `campaigns.send` سيرفرياً (كان أي موظف يجدول حملة). (٥) `hatif-send v13`: حُذف `explore` (بروكسي GET مفتوح على Voxa). **قاعدة: أي سياسة `TO public` على جدول مالي = ثغرة؛ أي تغيير امتياز يمرّ عبر trigger/edge لا self-UPDATE.**
- **المصدر الميت (§1.23)**: `customer_receivables` مجمّد منذ 10 يوليو ونصف مدينيه سدّدوا — أُعيد توجيه `forecastService.loadReceivablesInflow` + `working_capital_now()` (AR side) + `customer_debt_concentration` لـ`zoho_invoices` الحيّة (238K→169K، DSO 75→33). بطاقة «تنبيهات العملاء» أُزيلت من `/decisions` (الإشارة الحيّة = الإيقاف الائتماني).
- **ربح الأشهر المغلقة**: كرون pnl (jobid 3) يُنعش الآن **الشهر الجاري + الشهرين السابقين** (كان يونيو مجمّداً +246ك ربح وهمي؛ بعد الإنعاش −111ك خسارة حقيقية — COGS كان 60ك والحقيقي 412ك). **قاعدة: أي شهر مغلق في pnl_snapshots يُنعَش دورياً 3 أشهر للخلف.**
- **التدقيق**: ربط RV التلقائي يستثني `paid/partial` (كان يعيد فتح رصيد مسدَّد → دفع مزدوج، 13 فاتورة أرامكس 49,665) · فشل استخراج COD يُرفَق `codExtractError` ويُعرَض (كان يُبتلع) · زر **«أنشئ مطالبة»** في نتائج المراجعة من الفروق لصالحك (يغلق دورة الاكتشاف→الاسترداد، السجل كان فارغاً).
- **الحملات**: قيد `crm_tasks.entity_type` وُسّع بـ`retargeting`/`support` + backfill 23 مهمة (الرد الوارد كان **لا يُنشئ مهمة أبداً** — القيد يرفض والخطأ يُبتلع) · إزالة تكرار الهاتف في المودال (رقم بعدة متاجر استلم 3 رسائل/37ث → خطر حظر) · `campaign-runner v4`: استرداد طابور `'sending'` العالق (+10د، عبر `processed_at`) + drip بالعميل لا بالصف.
- **السلامة (`integrity_check`)**: 3 فحوص جديدة — `carrier_cod_no_invoice` (سمسا: 466ك COD بلا فاتورة) · `zoho_debt_no_invoices` (28 عميل، 60ك دين خفي) · `audit_no_shipments` (12 مراجعة). بطاقتا «سلامة البيانات» و«مطالبات مفتوحة» أُضيفتا لـ`/decisions`.
- **الأداء/الصلابة**: `selectAllRows` (crmLeads/crmService) يفرض `order('id')` (فخّ §6 عاد على 51K صف) · `normalizeSaudiPhone` (whatsappService) وُحِّد مع SQL (قصّ 9660 + أرقام عربية) · `loadWhatsAppCampaignStatus` يصفّح (كان يُبتَر 1000) · حذف فهرس `wcs_phone_sent_idx` المكرّر · **تقسيم الحزمة** (xlsx/supabase/pdfjs chunks، −21% gzip) · **`SlotBoundary`** حاجز أخطاء لكل PageSlot · `zoho-webhook v7` لا يمسح `einvoice_status` بـnull.
- **متبقٍ موثَّق (يتطلّب فعل المستخدم أو ملف)**: رفع كشوف سمسا للتدقيق · دفع 110 فواتير زاتكا المتأخرة + تفعيل الإرسال التلقائي في زوهو · تغيير كلمة مرور المدير · تفعيل الملخّص الصباحي/زاتكا برقم فعلي · إعادة رفع iMile مايو (4 مراجعات) · parser تحصيل أيمكن (يحتاج ملفه الفعلي) · سحب زوهو موجّه للفواتير المفتوحة (معرّف عميل ثابت) · اختبارات golden للمحرك · dynamic import لـpdfjs.

### 1.39 دمج أقسام القائمة الجانبية — 7 → 5 ✅ (2026-07-21)
قرار المستخدم («التبويبات الداخلية كثيرررة ومشتتة») — اختار **دمج الأقسام** (من AskUserQuestion). الأقسام السبعة صارت **خمسة** في `NAV_SECTIONS` (App.jsx)، والشاشات النادرة/المرجعية نُقلت لـ«الإعدادات والأدوات»:
- **شركات الشحن** (`carriers`): حالة الشركات · رفع ملف · وارد الفواتير · تدقيق · كشوف الحساب · حسابات الشركات.
- **الأموال** (`money` — دمج المالية + البنك/COD/الدفعات): الأرباح · البنك والمدفوعات(4 تبويبات) · أعمار الديون · توقّع السيولة · بيانات زوهو · مطابقة زوهو.
- **العملاء** (`customers` — دمج التحصيل + المبيعات): مركز التحصيل(4 تبويبات) · متابعة العملاء · مركز المبيعات(7 تبويبات) · CRM(4) · تذاكر الدعم.
- **الحملات والتقارير** (`outreach` — دمج واتساب + التقارير): حملات واتساب · مكتبة التقارير · التقرير الشهري · التصدير وسجل الملفات.
- **الإعدادات والأدوات** (`tools` — الإدارة + النادر): الفريق · إدارة الشركات · العقود · إقفال الشهور · المهام · حالة المصادر · فحص السلامة · سجل النظام · فواتير التجهيز · فوترة الأوزان.
- **القاعدة (تحدّث §1.32/§1.11f):** الأقسام = 5 (`carriers/money/customers/outreach/tools`). أي شاشة جديدة تُسنَد لأحدها بـ`section:` — النادرة/الإعدادية → `tools`. مفتاح الأكورديون `sa-nav-collapsed-v6` (بُمِّر ليطبّق الدمج مرة). **مربّع البحث Ctrl+K موجود** (paletteOpen) — يقفز لأي شاشة، فالبحث السريع لا يحتاج بناءً.

### 1.12 COD المستحق غير المحصَّل في Overview ✅ (UX 2026-05-29)
- `overviewService.loadOverview` يجلب `loadCarrierNetBalances()` (RPC `carrier_cod_net_balances`) ويُرجِع `codOutstanding = { total, carriersDue }` (مجموع الصافي الموجب > 0.5 لكل ناقل)
- `Overview.jsx` → `CashHero` يعرض بطاقة "COD لم يُحصَّل بعد" (تظهر فقط إن > 0.5) تنقل لـ `/money?tab=cod`
- مفتاح الشهر في Overview يُحفظ في `sessionStorage['sa-overview-period']` — يدوم خلال الجلسة (يبقى الشهر التاريخي بعد refresh) ويُصفَّر لـ current عند جلسة جديدة. لا يوجد period عام عبر الصفحات (لا مستهلك حقيقي له — Forecast يستخدم horizon بالأيام، باقي الصفحات all-time)

### 1.13 سجلّ السحبات + تخزين ملفات `/internal-exports` ✅ (UX 2026-06-01)
- مشكلة سابقة: ملفات السحب (تحصيلات/فواتير) كانت تنزل للمتصفّح فقط ولا تُخزَّن — لو ضاعت من Downloads ما فيه طريقة لإعادتها (الأوزان كانت مخزَّنة سلفاً عبر `weight_billing_exports` + bucket `weight-billing`).
- الحل (يحاكي نمط الأوزان):
  - bucket `internal-exports` (private) + جدول `internal_export_pulls` (kind/file_name/file_path/row_count/total/pulled_at/pulled_by)
  - `persistAndDownloadExport({ wb, fileName, kind, rowCount, total, userId })` في `internalExportsService.js`: يبني الـ xlsx مرة → يرفعه للـ storage + يسجّل صف + ينزّله للمتصفّح. **فشل التخزين غير قاتل** (التنزيل يكمّل) — bucket ناقص ما يوقف العملية
  - مفتاح الـ storage **ASCII فقط** (`asciiKey`) — الاسم العربي يبقى في `file_name`، المفتاح المنظّف في `file_path` (نفس فخّ §1.7)
  - `pullCodReceipts` (kind='cod') و `pullCustomerInvoicing` (kind='invoicing') يستدعيان الـ helper بدل `XLSX.writeFile`
  - `loadExportHistory()` يدمج `internal_export_pulls` + `weight_billing_exports` في قائمة موحّدة (لكل سجل `bucket`)؛ `downloadExportFile({ bucket, filePath, fileName })` يعيد التحميل من الـ storage
  - `InternalExports.jsx`: قسم "السحبات السابقة" (جدول: تاريخ/نوع/ملف/صفوف + زر تحميل). صفوف `file_path=null` (أوزان قديمة قبل التخزين) زرّها معطَّل
- **القاعدة:** أي تصدير جديد للنظام الخارجي يجب أن يمرّ عبر `persistAndDownloadExport` (تخزين + سجل) لا `XLSX.writeFile` المباشر، ليبقى قابلاً لإعادة التحميل.

### 1.14 معالجة آلية + استبدال snapshots صندوق Zoho ✅ (UX 2026-06-02)
- كل مصادر `UPLOAD_SOURCES` (zoho_customers/zoho_vendors/receivables/internal_settlement/merchants) هي **snapshots** — الأحدث يلغي الأقدم.
- مشكلة سابقة: كل إيميل Zoho يولّد `zoho_intake_events` صف `pending` يحتاج ضغط «عالج» يدوي، وتتراكم نسخ متعددة لنفس النوع (3× أرصدة عملاء…).
- الحل في `UploadsHub.jsx` + `zohoIntakeService.js`:
  - `supersedePendingIntake()` يُجمّع الـ pending حسب `detected_source` ويُبقي الأحدث فقط، ويُحوّل الأقدم لـ `dismissed` (السبب: «مُستبدَل بنسخة أحدث»). يُستدعى في `refresh()` قبل عرض الصندوق → الصندوق يتقلّص لواحد-لكل-نوع
  - **معالجة آلية**: effect في `UploadsHub` يعالج تلقائياً كل حدث `detected_source` (عبر `handleProcessAllIntake`)؛ يتتبّع المعالَج في `autoAttempted` (ref Set) فكل حدث يُعالَج مرة واحدة (الوافد الجديد يُعالَج، والفاشل لا يُعاد في حلقة). الأنواع غير المكتشفة تبقى للاختيار اليدوي
- **القاعدة:** snapshots = الأحدث يلغي الأقدم. لا تعالج نسخة قديمة من نفس النوع. المعالجة الآلية فقط للـ snapshots المكتشَفة (لا للمراجعات/COD التي تحتاج اعتماداً بشرياً)
- **استبدال server-side**: `zoho-intake` edge function **v6** — فور وصول ملف نوعه مكتشَف، يُحوّل الأحداث الأقدم pending من نفس `detected_source` لـ dismissed («مُستبدَل بنسخة أحدث») فوراً. فالصندوق يتقلّص لواحد-لكل-نوع **بدون فتح أي صفحة**. (الـ parsing/ingestion لا تزال client-side عند فتح `/uploads`)
- **معلّق (المعالجة الكاملة server-side)**: نقل الـ parsing+matching لـ Deno يكرّر منطق مطابقة مالي (`resolveStoreIds` 3-tier + RPC `bulk_match_customers`) → خطر drift يسبّب أرصدة خاطئة صامتة. الحل الآمن: مصدر واحد مشترك (RPC أو `_shared` module) لا نسخة مكرّرة. مهمة مقصودة منفصلة، تُختبَر بمقارنة ناتج السيرفر مع ناتج الـ client المعروف

### 1.15 كشف البنك المتراكم + الدمج الذكي ✅ (2026-06-20)
- صفحة `/bank` (BankStatement) كانت **في الذاكرة فقط** — كل رفع يستبدل السابق. الآن العمليات تُحفظ في جدول `bank_transactions` وتتراكم عبر الفترات.
- `saveBankTransactions` في `bankTransactionsService.js`: كل عملية لها `dedup_key` = `ref:<المرجع البنكي>` إن وُجد، وإلا `auto:<تاريخ|وصف|مدين|دائن>`. الجدول عليه **فهرس فريد كامل (لا جزئي)** على `dedup_key` → `upsert onConflict:'dedup_key'` **آمن من فخّ 42P10** (§6). فرفع فترة متداخلة **يدمج** الصفوف المشتركة (يحدّثها لآخر قيمة) ولا يضاعفها، والصفوف الجديدة تُضاف.
- النتيجة تُرجِع `{ saved, added, merged }` للعرض. تبويب «الدفتر البنكي المحفوظ» يعرض المتراكم مع بحث/فلترة فترة/تصدير/حذف.
- **القاعدة:** أي مصدر مالي يُرفَع تكراراً (بتداخل فترات) يجب أن يحمل `dedup_key` ثابتاً + فهرس فريد **كامل** ليُدمَج لا يتضاعف. المرجع البنكي هو المفتاح الطبيعي.
- **فخّ التصادم (2026-07-01)**: التحويل المرفوض يُعاد قيده بنفس الرقم المرجعي (قيد مدين + قيد دائن **بنفس المرجع**). كان `dedup_key = ref:<المرجع>` فيتصادم القيدان → يُدمَجان ويُفقَد أحدهما عند الحفظ. الإصلاح: `dedup_key = ref:<المرجع>:<D|C>` (الاتجاه من `credit>0`). **أي مصدر يمكن أن يحمل قيدين بنفس المرجع (مدين+دائن) يجب أن يضمّ الاتجاه للمفتاح**. (صفوف مايو ما قبل الإصلاح لو أُعيد رفعها تُضاف بمفاتيح جديدة — الفترات القديمة بلا أزواج رفض غير متأثرة).
- **العمليات المرفوضة/المُرجَعة (2026-07-01)**: `annotateRejected(list)` في `bankStatementProcessor.js` يعلّم كلا القيدين (`rejected=true`) حين يطابق قيدٌ دائنٌ نمطَ رفض (`تم رفض التحويل`/مرتجع/عكس قيد/reject/revers…) قيداً مديناً **بنفس المرجع**. يعمل على الصفوف المُحلَّلة والمحفوظة (نفس أسماء الحقول). الواجهة: شارة «↩︎ مرفوض» + تظليل أحمر خفيف + سطر ملخّص «N مرفوضة (صافي صفر)». **الإجماليات المعروضة تبقى شاملة للمرفوض** (تطابق إجماليات البنك المطبوعة في لوحة التحقّق — البنك يعدّها). لكن **التصدير الصافي يحذفها**: `generateCleanExcel` يفلتر `!t.rejected` (كلا القيدين، صافيهما صفر) فلا تصل النظام المحاسبي الخارجي — والتوست يذكر عدد المحذوف. مايو 2026 = 3 تحويلات KonHub دولية رُفضت ورُدّت بالكامل (6 صفوف تُحذف من التصدير).

### 1.16 سمسا فروع في مُنتقي تحصيل COD ✅ (2026-06-20)
- مُنتقي الناقلين في `/cod-settlements` يُبنى من `REMITTANCE_PARSERS` (محلّلات ملفات التحصيل) **لا** من جدول الشركات. فأي ناقل بلا parser تحصيل يختفي من الصفحة حتى لو كان شركة كاملة تُدقَّق.
- `smsa_branches` (RX8668) كان شركة جاهزة بلا parser → اختفى. أُضيف `smsaBranchesRemittanceParser` يعيد استخدام مفاتيح أعمدة سمسا المشتركة (`SMSA_AWB_KEYS`/`SMSA_AMT_KEYS`) بمعرّف `smsa_branches`.
- زر **تنزيل لكل ملف تسوية** في «الملفات المرفوعة» (`loadUploadShipments` + `handleExportUpload`): يصدّر Excel فيه رقم كل شحنة + حالتها في المطابقة (من تجميع `reconByAwb`).

### 1.17 الإقفال الشهري — مُفعَّل ومُنفَّذ بالـ DB ✅ (مُتحقَّق 2026-06-21)
- **جاهز بالكامل**: جدول `period_closes` + RPC `months_with_activity` + خدمة `periodsService.js` (`closePeriod`/`reopenPeriod`/`isClosed`/`refreshClosedSet`) + صفحة `/periods` (بوّابة `system.period_close`). لم يُقفَل أي شهر بعد (0 صفوف) — الميزة تنتظر الاستخدام لا التطوير.
- **الإنفاذ الحقيقي في الـ DB لا الواجهة**: 4 triggers على `carrier_operations`/`cod_settlement`/`audits`/`payments` تستدعي `guard_closed_period(<عمود التاريخ>)`. أي INSERT/UPDATE/DELETE بصفّ تاريخه ضمن شهر مُقفل → `RAISE EXCEPTION 'الفترة % مُقفلة — أعد فتحها قبل التعديل'` (ERRCODE **P0001**). الصفوف **بلا تاريخ معفاة** (لا تُقفَل البيانات القديمة).
- `isClosed()` متزامن من cache على مستوى module؛ مسارات التعديل في الواجهة تستدعي `refreshClosedSet()` لتمنع الـ round-trip قبل ضرب الـ trigger.
- **القاعدة:** أي جدول مالي جديد بعمود تاريخ يجب أن يُربَط بـ trigger `guard_closed_period` ليحترم الإقفال. وأي مسار تعديل جديد يجب أن يتوقّع خطأ P0001 ويعرضه للمستخدم بوضوح.

### 1.18 معالجة الجوال — استراتيجية CSS ✅ (2026-06-21)
- كل إصلاحات الجوال في `src/index.css` داخل `@media (max-width: 768px)` و`(max-width: 480px)`. الصفحات تستخدم inline styles فالقصّ يتم بمطابقة **substring** لقيمة الستايل المسلسلة من المتصفّح (بلا اقتباسات، مع تطبيع مسافات: `minmax(140px,1fr)`→`minmax(140px, 1fr)`، `0`→`0px`).
- **القاعدة:** قبل إضافة محدّد substring جديد، تحقّق من تسلسل المتصفّح الفعلي بـ`getComputedStyle` (لا تخمّن). الشبكات ذات 4+ أعمدة أو عمود px ثابت تنطوي لـ`1fr`؛ صفوف العرض `1fr auto` و`auto 1fr auto` تبقى صفوفاً (لا تُقصَّ).
- أصناف مساعدة: **`.m-cards`** يحوّل جدولاً عريضاً إلى بطاقات (كل صف بطاقة، كل خلية «label: value» من `data-label`؛ خلية `data-label=""` = عنوان البطاقة) — مطبَّق على 9 جداول كثيفة. **`.m-compact`** يُبقي أول عمودين فقط (اسم+مبلغ) للجداول ذات النقر-للتفاصيل. **`.hero-grid`** يتراصّ. **`.mobile-hide`** يُخفي. الجانبية درج `position:fixed` بعرض `min(85vw,320px)` + **`visibility:hidden` مغلقاً** (وإلا تمرير أفقي على iOS — العناصر fixed خارج الشاشة لا يقصّها iOS رغم `overflow:hidden`).
- **القاعدة:** أي جدول عريض جديد على الجوال → استخدم `.m-cards` (لا تخفِ بيانات) أو `.m-compact` (إن كان النقر يفتح تفاصيل). أي درج/عنصر `fixed` خارج الشاشة يجب أن يكون `visibility:hidden` مغلقاً.

---

## 2. المبادئ الأساسية (Non-Negotiable)

### 2.1 دورة حياة الصفحات
- `App.jsx` يلفّ كل صفحة في `<PageSlot>` الذي **يبدّل visibility فقط** — لا يفصل المكوّن
- `useEffect` بـ `[]` deps يشتغل **مرة واحدة** عند تشغيل التطبيق، لا عند التنقّل
- **القاعدة:** إذا تحتاج كود يشتغل عند الوصول لصفحة، اعتمد على `location.pathname` كـ dep

### 2.2 React StrictMode
- `main.jsx` يلفّ التطبيق في `<React.StrictMode>`
- `useEffect` setup يشتغل **مرتين** في dev (mount → cleanup → mount مرة ثانية)
- `useRef` و `useState initializer` يشتغلان مرتين أيضاً
- **القاعدة:** أي guard يجب أن يكون **على مستوى module** (متغيّر خارج المكوّن) أو في storage (لكن انتبه للحذف المبكّر)

### 2.3 دلالات COD direction
- `'out'` = ما نتوقّع استلامه (مصدره النظام الداخلي للمستخدم فقط)
- `'in'` = ما استلمناه فعلاً (ملف من الناقل، أو tehweel بنكي)
- **لا تنشئ 'out' من audit أبداً.** أي ملف من شركة شحن = 'in'
- **زر «ارفع تحويل» (in) مخفي للناقلين `audit_with_cod`** (iMile/DeliverNow) في `/cod-settlements` — لأن اعتماد المراجعة يُنشئ صفوف 'in' تلقائياً، فالرفع اليدوي يكرّر التحصيل (double-count). يُستبدَل بتلميح "التحصيل يُسجَّل تلقائياً عند اعتماد المراجعة". زر «ارفع متوقّع» (out) يبقى ظاهراً للجميع (مصدره نظام المستخدم الداخلي). الحارس: `fileKindById.get(carrier) === 'audit_with_cod'` في `CodSettlements.jsx`
- **ملاحظة المحاسبة المحايدة (`status='note'`)**: في `cod_reconciliation_action`، الحالة `'note'` تُرفِق ملاحظة لشحنة **دون تغيير حالتها المالية** (تبقى outstanding/over_remit/matched طبيعية). في `loadReconciliation`: `if (action.status !== 'note') override; else keep natural + attach notes`. زر «📝 ملاحظة للمحاسبة» في `Row` (CodSettlements). ملاحظة فارغة = حذف (تستدعي `clearReconciliationAction`). لا تجعل أي حالة قرار (approved/disputed/resolved) note-only — هي تُلغي الحالة الطبيعية عمداً

### 2.4 المحاسبة في `carrier_operations`
- DR = نحن مدينون للشركة (فاتورة شحن)
- CR = الشركة مدينة لنا / نحن دفعنا (تحصيل COD، تحويل بنكي)
- الرصيد = `SUM(DR) - SUM(CR)`. موجب = نحن مدينون، سالب = هي مدينة لنا
- **قيد واحد لكل حدث مالي.** لا قيد لكل AWB. التفاصيل في `audit_shipments` / `cod_settlement`

### 2.4b Broker / sub-carrier pricing (Boleeseh-style)
- `contract.pricingKey = 'subCarrier'` يحوّل سلوك `auditAll`:
  - بدل `pricing['Saudi Arabia']` يستخدم `pricing[row.subCarrier]`
  - لـ COD: يبحث عن `pricing[<subCarrier>_cod]` أولاً قبل الـ fallback
- الـ `subCarrier` يُستخرج من عمود "شركة الشحن" (regex `/^شركة\s*الشحن$/`)
- الـ `codPaymentMethod` يقبل أيضاً عمود "نوع الدفع"
- بوليصة هي المثال الوحيد حالياً (4 ناقلين فرعيين)

### 2.4c أعلام العقد الخاصة (contract flags)
- `posFeeOnCod: true` — رسوم POS = نسبة من **مبلغ التحصيل** (codAmount) لا من عمود POS Amount منفصل. (ويبك: 0.8%). `auditRow` يستخدم codAmount كأساس POS.
  - **الدفع المختلط (split payment) ✅ مُصلَّح (2026-07-03)**: عند دفع مختلط (بطاقة + نقد، مثل J&T `'NLCard Cash'`) النسبة (2%) تُطبَّق على **جزء البطاقة فقط** — النقد مجاني. الملف لا يفصّل جزء البطاقة، فرسم الناقل نفسه هو الحقيقة (2%×جزء البطاقة). الإصلاح في `auditRow`: `isSplitPay` يكتشف وجود رمز نقد **و** رمز بطاقة معاً في `codPaymentMethod` → `expectedPosFee = invoicedPosFee` (passthrough كالوقود/codFee). الأساس + الوزن يبقيان مدقَّقين بصرامة. **مُتحقَّق على فاتورة J&T يونيو (For Tech): 1,690 مطابق، 0 لصالحك** (كانت 8 فروق وهمية −2.20/−4.00/−6.00… كلها 2%×كامل COD مطروحاً منه رسم الناقل الفعلي). البطاقة الكاملة (NLCard بلا نقد) تبقى مدقَّقة 2%×COD (لا تُطابق isSplitPay). الملف سليم رياضياً 100% (التوصيل=16+وزن، الضريبة=15%، DETAILS=SUMMARY).
- `deliveryInclusiveVat: true` — عمود التوصيل **شامل الضريبة 15%**؛ `auditRow` يقسمه ÷1.15 للمقارنة قبل الضريبة ويُظهر فرق الضريبة كـ tax. (ويبك)
- `codFeePassthrough: true` — رسوم COD تُقبل كما هي (expected=invoiced) حين لا تتبع قاعدة. (سمسا فروع، ويبك)
- `fuelPassthrough: true` — (أرامكس) رسوم الوقود **تُقبل كما هي** (expected=invoiced): الوقود market-indexed يتغيّر شهرياً وجدول الناقل المنشور هو المعتمد (قاعدة المستخدم 2026-06-11: «المعتمد في الجدول صحيح مهما كان»). الأساس + RSS يبقيان مدقَّقين بصرامة ضد العقد — هناك يظهر الـoverbilling الحقيقي. لا تعيد تثبيت نسبة وقود لأرامكس وتطالب بفروقاتها
- `priceFromContract: true` — (ديلكس) الملف المرفوع («كشف الطلبات») **بلا أسعار إطلاقاً** (Cost=0) — المحرّك **يحسب** الفاتورة المتوقعة من العقد (التوصيل لكل مُسلَّمة + posFeePct×COD) ويجعلها الطرفين (invoiced=expected، كله ok). يتطلب `mapRows(raw, colMap, {keepUnbilled:true})` وإلا أُسقطت كل الصفوف كغير مفوترة — الـcallers (UploadWizard/CarrierLedger) يستنتجونها من `carrier.contracts.some(c=>c.priceFromContract)`. إسقاط المرتجعات (signingStatus) يبقى نشطاً — مرتجع ديلكس مجاني فلا يدخل العدّ. التقريب 4dp لكل صف (الناقل يحسب النسبة على إجمالي الفترة)
- `inboundPassthrough: true` — (أرامكس) الشحنة ذات منشأ **دولة أجنبية معروفة** (`KNOWN_FOREIGN_COUNTRIES`) ووجهة السعودية = **مرتجع وارد**: تمرّ pass-through بحالة `inbound` (لا تُدقَّق سعرياً — لا جدول وارد بالعقد) وتظهر في تقرير منفصل «وارد لفوترة التجار» (`exportInboundReturns` في export.js — يتضمن `shipperRef` = بوليصة الصادر الأصلية، مفتاح تفويت التاجر بالنظام الداخلي الذي يفوتر الصادر فقط). **الشرط على مجموعة دول معروفة لا `origin≠SA`** — أعمدة المنشأ المحلية فيها مدن (Jeddah) لا تتطبّع لـSaudi Arabia فتُصنَّف غلطاً
- `posFeePct` / `fuelPct` — نسب. `pricing` بشريحة واحدة مسطّحة `[{upTo:null,price:X}]` = سعر ثابت لكل شحنة بغض النظر عن الوزن (calcDelivery يرجعه حتى لوزن 0 — للناقلين الذين لا يفوترون بالوزن مثل ويبك)

### 2.5 file_kind القيم المسموحة
- `'audit_with_cod'` — الفاتورة تشمل COD (DeliverNow)
- `'audit_and_cod_separate'` — ملفان منفصلان (Aramex)
- `'audit_only'` — فاتورة بدون COD
- `'cod_only'` — ملف تحصيل فقط
- `null` / `unset` — غير محدد، النظام لا يستخرج COD تلقائياً

---

## 3. خريطة الملفات

| المسار | المسؤولية |
|---|---|
| `src/lib/coreService.js` | CRUD للـ audits + carriers، بوابة الاعتماد، auto-posting، loadAuditShipments |
| `src/lib/codSettlementService.js` | COD reconciliation، syncAuditCodOut، saveSettlementUpload، loadUploadShipments |
| `src/lib/bankTransactionsService.js` | حفظ/تحميل عمليات كشف البنك المتراكمة (دمج ذكي عبر `dedup_key`) |
| `src/lib/customerReceivablesService.js` | parser + snapshot upload + load latest AR rollup + merchant overlay |
| `src/lib/merchantsService.js` | merchant directory (snapshot) + Levenshtein fuzzy linker + insights |
| `src/lib/webhookService.js` | CRUD لـ webhook_events، delete (مع verify) |
| `src/lib/carriersHubService.js` | تجميع بيانات `/hub` (paginated) |
| `src/lib/carrierProfileService.js` | بيانات بروفايل شركة واحدة، updateCarrierFileSignature |
| `src/lib/carrierStatementsService.js` | رفع كشوف الشركات الخارجية، carrier_operations CRUD |
| `src/lib/contractHistoryService.js` | تتبع تغييرات العقود |
| `src/pages/UploadWizard.jsx` | معالج المراجعة 3 خطوات، استيراد Webhook |
| `src/pages/AuditResults.jsx` | شاشة المراجعة + بوابة الاعتماد UI |
| `src/pages/WebhookEvents.jsx` | صندوق الوارد، حفظ كمراجعة، حذف |
| `src/pages/CodSettlements.jsx` | تسويات COD، تبويبات، تصدير قسم حالي |
| `src/pages/CustomerReceivables.jsx` | `/receivables` — مديونيات العملاء (snapshots) + تبويب تنبيهات + حملة تحصيل |
| `src/pages/Merchants.jsx` | `/merchants` — دليل المتاجر + لوحة insights + ربط تلقائي |
| `src/pages/CarriersHub.jsx` | `/hub` — كرت لكل شركة |
| `src/pages/CarrierProfile.jsx` | `/carrier?id=X` — بروفايل شركة كامل |
| `src/pages/CarrierLedger.jsx` | `/ledger` — الكشف المحاسبي للشركات |
| `src/pages/MonthlyReport.jsx` + `src/lib/monthlyReportService.js` | `/monthly-report` — تقرير شهري لكل ناقل (مفوتر/تحصيل COD/إشعارات/مدفوعات/صافي + جودة التدقيق). يجمّع `carrier_operations` (حسب `doc_date`) + `audits`. **توحيد alias**: `aramex` → `c_1777506662790` (COD رُفع تحت slug، العمليات تحت الـ id الكامل) عبر `canon()`. تصدير Excel |
| `src/engine/audit.js` | اكتشاف الأعمدة، حساب العقد، buildSummary. **تدقيق المكوّنات**: `auditRow` يحسب مفوتر/متوقّع/فرق لكل مكوّن (delivery/rss/fuel/codFee/posFee) ويفصل RSS عن الوقود المدموج (سطر ~723: `row.rss===0 && calc.rss>0` → ينسب calc.rss من عمود الوقود). الحالة من الإجمالي فقط (لا per-component) |
| `src/engine/aramexInvoiceParser.js` | قارئ فاتورة أرامكس التفصيلية **PDF** (per-shipment): `parseAramexInvoice(buf)` → `{header, rows}`. الـ rows جاهزة للتغذية في نفس مسار rawRows+colMap بـ UploadWizard (المستخدم يستقبل PDF فقط، Excel بالطلب). `deliveryCharges` = gross لكل شحنة (شامل وقود+RSS؛ دولي VAT=0 فnet=gross). يُكتشف بامتداد `.pdf` في `handleFile` |
| `src/engine/codParsers/*.js` | parsers لملفات تحصيل COD لكل شركة |
| `src/lib/carrierScore.js` | **درجة صحة الناقل الموحّدة** (0–100) — نقطة الحقيقة الوحيدة (Overview + CarrierKpi). مكوّنات موزونة، الغائب يُستبعَد ويُعاد توزيع وزنه. عتبات: ≥85/65. لا تعيد معادلة صحة محلية في أي صفحة |
| `src/lib/xlsxRtl.js` | `rtl(wb)` — كل تصدير Excel جديد يلفّ المصنّف به قبل الكتابة (وضع RTL). استثناء وحيد: `generateCleanExcel` (بنية مثبّتة لنظام خارجي §1.15) |
| `src/App.jsx` | Routes + Sidebar + PageSlot |
| `src/components/UI.jsx` | Btn / Card / Modal / Spinner / toast |
| `supabase/functions/webhook-intake/index.ts` | Edge function، حالياً v11 (deployed v12): parsing متسامح — JSON + multipart/form-data + verification ping (جسم فارغ → 200). كان v10 يرفض أي شيء غير JSON صارم بـ `invalid_json` |

---

## 4. مخطط قاعدة البيانات (الجداول الأساسية)

| الجدول | الغرض |
|---|---|
| `carriers` | شركات الشحن (`contracts`, `file_signature` JSONB) |
| `audits` | header للمراجعات (مع `drift_pre_tax`, `mismatch_count`, `review_status`) |
| `audit_shipments` | الشحنات لكل مراجعة (إلى 500K+) |
| `audit_awb_ledger` | للكشف عن تكرار AWB عبر المراجعات |
| `webhook_events` | الإيميلات الواردة |
| `cod_settlement` | تسويات COD per-AWB (in/out) |
| `bank_transactions` | عمليات كشف البنك المتراكمة (دمج ذكي عبر `dedup_key` فريد كامل) |
| `period_closes` | الأشهر المُقفلة (`period` YYYY-MM، status) — triggers `guard_closed_period` تمنع التعديل بشهر مُقفل |
| `cod_reconciliation_action` | اعتمادات/اعتراضات على فروق COD |
| `customer_receivables` | snapshots لمديونيات العملاء (read-only AR view) |
| `customer_settings` | per-customer tag (excluded/priority) — يدوم عبر snapshots |
| `merchants` | snapshots لكشف المتاجر من المنصّة الداخلية |
| `customer_merchant_links` | الربط بين `customer_name` و `store_id` (auto/manual) |
| `carrier_operations` | الكشف المحاسبي (DR/CR لكل شركة) |
| `carrier_statements` | كشوف خارجية مرفوعة من الشركات |
| `payments` + `payment_allocations` | الدفعات وربطها بالعمليات |
| `dispute_notes` | thread للاعتراضات |
| `app_settings` | إعدادات عامة (key/value) |
| `profiles` | المستخدمون والأدوار |

---

## 5. بروتوكول التعديل الآمن

قبل تعديل أي ملف:

1. **اقرأ هذا الملف.**
2. **اقرأ الملف الذي ستعدّله بالكامل** (مش جزء فقط).
3. حدّد أي **invariant** سيتأثّر بتعديلك من القسم 1.
4. لو التعديل يتقاطع مع invariant، اشرح كيف ستحافظ عليه قبل الكتابة.
5. **أصغر تعديل ممكن** — لا تنظّف كود غير ذي علاقة في نفس التعديل.
6. تحقّق من syntax عبر `@babel/parser`:
   ```bash
   node -e "require('@babel/parser').parse(require('fs').readFileSync('PATH','utf8'), { sourceType:'module', plugins:['jsx'] })"
   ```
7. **Smoke-test** التدفّق المتأثّر:
   - عدّلت approveAudit؟ → جرّب اعتماد مراجعة DeliverNow
   - عدّلت Webhook → جرّب "حفظ كمراجعة"
   - عدّلت Hub → جرّب فتح بروفايل شركة
8. **commit واحد لكل تغيير منطقي** — رسالة واضحة تشرح "لماذا" مش "ماذا"
9. **حدّث هذا الملف** إذا التعديل أضاف invariant جديداً.

---

## 6. الفخاخ المعروفة (لا تكرّرها)

| الخطأ | السبب | الحل الصحيح |
|---|---|---|
| استخدام `useRef` كـ guard ضد StrictMode | يُعاد تهيئته بين الـ mounts | استخدم **module-level Set** أو متغيّر خارج المكوّن |
| `useEffect` بـ `[]` deps لـ navigation-triggered logic | الصفحات لا تُفصل (PageSlot) | اعتمد على `location.pathname` كـ dep |
| الاحتفاظ بأسماء عربية في storage keys | Supabase Storage يرفض non-ASCII | sanitize إلى `[A-Za-z0-9._-]` في الـ edge function |
| `setTimeout(..., 0)` لتأخير handleFile | StrictMode يفصل قبل ما الـ timeout يطلع | استدعي مباشرة، الـ FileReader أصلاً async |
| إعادة اشتقاق `reviewStatus` من `audit.isDraft` بعد تعديل `audit.isDraft` في handleApprove | يُلغي `setReviewStatus('approved')` | اعتمد فقط على `[audit.id]` في الـ useEffect |
| استخراج COD كـ 'out' من فاتورة الشركة | يكرّر مع ملف التحويل الفعلي | فقط 'in' من ملف الناقل |
| `from('table').delete()` بدون `.select()` | RLS silent-fail (0 rows affected = no error) | استخدم `.select('id')` وتحقّق من العدد |
| تجاهل `file_signature` في mapping `loadCarriers` | الـ pages تفقد القدرة على قراءة `file_kind` وإلخ — اختفاء أزرار صامت | احرص أن المابر يمرّر كل عمود يحتاجه أي مكوّن استهلاكي |
| استخدام `preview.rows.slice()` بدون فحص `preview.error` | شاشة بيضاء عند فشل الـ parser (rows = undefined) | افحص `!preview.error && Array.isArray(preview.rows)` قبل أي iteration |
| Parser keys لشركة بصيغة ملف واحدة فقط | الملفات بصيغ أخرى تفشل صامتاً (no rows extracted) | احفظ كل column synonyms المعروفة في الـ parser. لكن: `DLX` AWB = ديلكس Delex، `DNL` AWB = ديلفر ناو. لا تخلط الـ keys بينهم |
| الاعتماد على `ws['!ref']` كما هو | بعض الـ exporters (مثل J&T WestBr) يضع نطاقاً قديماً يغطّي 12 صف فقط رغم أن الملف فيه 184 → `sheet_to_json` يقرأ 12 وتُفقَد البقية صامتاً | قبل `sheet_to_json`، اسكان مفاتيح الخلايا واستخرج maxRow/maxCol الفعلي ثم أعد ضبط `ws['!ref']`. مطبَّق في UploadWizard + UploadModal/CodSettlements |
| محاولة تعديل سعر/شريحة العقد مباشرة في DB | يدمّر تاريخ العقود | استخدم `saveCarrierContractsWithHistory` |
| إعادة رفع كشف حساب يُعدّل/يعيد فتح عملية **مسدّدة** | `saveCarrierStatement` كان يقلب أي op غير-pending مبلغها تغيّر لـ `reviewing` ويكتب المبلغ الجديد — حتى لو كانت `paid`. الناقل أحياناً يعيد ترقيم/تصنيف نفس المستند بين نسخ الكشف (AB↔DG) → القيد المسدّد يتغيّر | العمليات `paid`/`partial` **مجمّدة**: عند re-import لا يُعدَّل مبلغها ولا حالتها، فقط `last_statement_id` يُحدَّث. في المعاينة تُصنَّف `frozen` (🔒 مثبّتة) لا `changed`. الحارس: `prior.status === 'paid' \|\| 'partial'` في `saveCarrierStatement` + `deltaOf` |
| تعديل `audits.results` JSONB لإضافة بيانات مهمة | حد TOAST + لن يُحمَّل للـ audits الكبيرة | استخدم `audit_shipments` بدلاً |
| نسيان `idempotency` على auto-posts | إعادة الاعتماد ينشئ قيود مكررة | استخدم unique partial indexes |
| `.upsert(op, { onConflict: 'audit_id' })` على `carrier_operations` | الـ unique index على `audit_id` **جزئي** (`WHERE doc_type='INV'`) — PostgREST لا يمرّر الـ predicate فيرفض Postgres الـ ON CONFLICT بـ `42P10`، والخطأ يُبتلَع في try/catch فلا يُكتب أي قيد INV (تسبّب باختفاء 73,952 ر.س من الدفتر — أُصلح 2026-05-29) | استخدم **delete-then-insert** على `(audit_id, doc_type='INV')` بدل الـ upsert. مطبَّق في `approveAudit` |
| `.upsert(op, { onConflict: 'reference_no' })` على `carrier_operations` في `saveSettlementUpload` (مسار COD) | **نفس فخّ الـ 42P10**: الـ index على `reference_no` جزئي (`WHERE doc_type='COD' AND reference_no IS NOT NULL`) فيُرفض الـ ON CONFLICT، والخطأ يُبتلَع في `console.warn` فلا يُكتب أي قيد COD CR (اختفت 361,280.26 ر.س من 11 رفعة تحصيل — أُصلح + back-filled 2026-05-30) | استخدم **delete-then-insert** على `(reference_no=uploadId, doc_type='COD')` + أعِد `ledgerError` في النتيجة بدل ابتلاع الخطأ (لا ترمِ throw — صفوف `cod_settlement` مُدرَجة سلفاً فالـ retry يتخطّاها كـ cross-file dups ولا يصل لكتلة القيد). مطبَّق في `saveSettlementUpload` |
| تجاهل `file_kind` عند audit approval | إنشاء قيود غير منطقية | افحص دائماً file_kind قبل الـ auto-extract |
| قراءة `stores.xlsx` بدون `raw:true` في XLSX.read | الهواتف 12-رقم تصبح `9.66502E+11` (تفقد آخر رقمين) | `sheet_to_json(ws, { raw:true })` + `toPhoneString` يحوّل `number` → `String(Math.round(v))` |
| auto-link يكتب فوق ربط يدوي | يفقد المستخدم تصنيفه | `autoLinkCustomers` يتخطّى `method='manual'` صراحةً |
| عمود COD باسم مجرّد `"COD"` لا يُكتَشف كـ `codAmount` | أنماط `codAmount` كانت تتطلّب `cod amount`/`cash on` فقط — فعمود iMile المجرّد `"COD"` ما انكشف، وعند الاعتماد (audit_with_cod) سُجّل **0 تحصيل** بدل 41,533 ر.س صامتاً | أُضيف `/^cod$/i` (مُثبَّت بـ anchors) لأنماط `codAmount` في `COL_PATTERNS` — يلتقط `"COD"` المجرّد بدون سرقة `"COD Service Fee"` (الذي يبقى لـ `codFee`). تحقّق دائماً أن `colMap.codAmount` موجود لملفات audit_with_cod قبل الاعتماد |
| استدعاء `loadLatestMerchants()` مباشرة في `loadLatestReceivables` كـ hard dep | الـ receivables تفشل لو ما رُفع snapshot للمتاجر | الاستيراد ديناميكي + `.catch(() => [])` — الـ merchant overlay اختياري |
| `.range(from, to)` للـ pagination **بدون `.order()` ثابت وفريد** | Postgres لا يضمن ترتيباً ثابتاً بين الصفحات، فبمجرد تجاوز الجدول 1000 صف **تتداخل الصفحات** ويتكرّر بعض الصفوف → **مضاعفة المبالغ** في أي aggregate. ظهر في `loadReconciliation` لسمسا (1667 صف): استلمنا = 2× → 399 فرق وهمي. والبيانات سليمة — الخلل في الجلب فقط | أضف `.order('id', { ascending: true })` (أو عمود فريد) قبل كل `.range()` يُكرّر صفحات. `upload_date` وحده لا يكفي (غير فريد) — أضف `id` كـ tiebreaker. أُصلح في **كل** الـ paginated helpers: `loadReconciliation` + `loadSettlementUploads` (codSettlementService) + `loadAllPaginated`/`loadAll` في internalExportsService/merchantsService/customerReceivablesService/carrierProfileService. (`loadAuditShipments` + `syncAuditCodOut` كانا أصلاً مرتّبين بـ id) — **القاعدة: أي `.range()` يُكرّر صفحات لازم `.order('id')` قبله** |

---

## 7. إعدادات الشركات الحالية (محدّث آخر مرة 2026-05-15)

| الشركة | ID | file_kind | عقد ساري | بصمة Webhook |
|---|---|---|---|---|
| DeliverNow | `delivernow` | `audit_with_cod` | ✅ 11 ر.س ثابتة، 15% VAT | ✅ `@delivernow.net` |
| أرامكس | `c_1777506662790` | (غير محدد) | ✅ | ❌ |
| iMile V1 | `imile` | `audit_with_cod` (الـ KSA Fee Bill الإنجليزي = فاتورة + COD معاً، مثل DeliverNow) | ✅ 17 حتى 15kg ثم +1/kg (ceil)، COD fee 1، POS 1% | ❌ |
| J&T Express | `jnt` | `audit_and_cod_separate` | ✅ 16/15kg ثم 1/kg، 2% POS | ⚠️ AWB prefix=JTE، doc-pattern=WestBr، email غير محدد |
| سمسا SMSA | `smsa` | `audit_and_cod_separate` | ✅ 2 عقود: محلي **13 ر.س حتى 15كغ + 2/كغ، وقود 10%** (صُحِّحت العتبة من 10→15كغ في 2026-06-09 بعد استخراجها من 16,606 شحنة — تطابق 100%) + دولي GCC | ❌ · حسابان: RX5251 (هذا) + RX8668 (سمسا فروع) |
| Boleeseh | `boleeseh` | `audit_and_cod_separate` (وسيط broker — فاتورة + تحصيل منفصل) | ✅ تسعير لكل ناقل فرعي (smsa/aramex/aymakan/jt cc/jt cod) | ❌ |
| Webek | `webek` | `audit_with_cod` (تحصيل + فاتورة) | ✅ توصيل ثابت 14 ر.س (Zone A، شامل ضريبة) + POS 0.8% من التحصيل | ✅ `@` (webhook) |
| Aatak | `aatak` | (غير محدد) | ❌ | ❌ |
| Delex | `delex` | `audit_and_cod_separate` | ✅ توصيل 9 ر.س ثابت (الرياض DRY24) + رجيع مجاني + 2% رسوم مدى من COD المحصَّل | ❌ · **فاتورته ملخّصة** (4 بنود) و«كشف الطلبات» تفصيلي بلا أسعار — التدقيق = إعادة حساب البنود من الكشف (عدد المُسلَّم×9 + 2%×مدى) لا شحنة-بشحنة |
| أي مكان Aymakan | `aymakan` | `audit_and_cod_separate` | ✅ توصيل **13 ر.س ثابت كل المدن** + وقود **7.5%** (fuelPct 0.075) + بلا رسم وزن/COD/POS + ضريبة 15% (مُستخرَج من فاتورة 216 شحنة) | ❌ · فاتورة تفصيلية شحنة-بشحنة (أعمدة إنجليزية: Tier Price/Fuel Cost/Bill Number) · **بادئة AWB = RP** · ترويسة الجدول في الصف 18 (ترويسة شركة متعددة الصفوف قبلها — لذا `detectHeaderRow` يمسح 30 صفاً) |
| Varnier / MyGate / سمسا فروع / ثابت | `varnier`/`mygate`/`smsa_branches`/`thabit` | (غير محدد) | ❌ (تستقبل «تحصيل لمحة» المتوقّع من الرفع المجمّع فقط) | ❌ |

> **ملاحظة:** كل تعديل على هذه الجدول يجب أن يتم عبر `/carrier?id=X` (واجهة) أو SQL مع توثيق هنا.

---

## 8. القرارات التصميمية المتّخذة

| القرار | التاريخ | السبب |
|---|---|---|
| تسامح الاعتماد ±0.50 ر.س قبل الضريبة | 2026-05-15 | يستوعب rounding في الـ tiered pricing |
| تسامح الضريبة ±1.00 ر.س (warning فقط) | 2026-05-15 | لا تمنع اعتماد بسبب fractional VAT |
| رفض المراجعة = حذف القيود (لا reversal) | 2026-05-15 | المستخدم admin، الـ audit trail بـ `rejected_at` كافي |
| لا قيد per-AWB في `carrier_operations` | 2026-05-15 | تقليل التعقيد، النظام الداخلي للمستخدم يتتبّع AWB-by-AWB |
| 500K شحنة حد أقصى لكل مراجعة (مبدئياً) | 2026-05-15 | requirement من المستخدم |
| الأقسام الأربعة في القائمة الجانبية | 2026-05-15 | workflow-driven: نظرة عامة / مراجعات / كشوف / إدارة |
| `/hub` كصفحة افتراضية (مستقبلاً) | TBD | أوضح للمستخدم admin غير المالي |

---

## 9. مهام معلّقة معروفة (لا تبدأ بدون قراءة سياقها)

- [x] back-fill قيود ledger للمراجعات السابقة — ✅ 2026-05-29: أُدرجت 8 قيود INV ناقصة (DeliverNow×3، iMile×4، J&T×1 = 73,952.59 ر.س) بعد إصلاح سبب فشل الـ auto-post
- [x] back-fill قيود COD CR الناقصة — ✅ 2026-05-30: أُدرجت 11 قيد COD ناقص (361,280.26 ر.س — aramex×3, smsa×3, jnt×2, delex×2, boleeseh×1) بعد إصلاح نفس فخّ الـ 42P10 في مسار `saveSettlementUpload`
- [ ] تعريف `file_kind` لباقي الشركات (iMile, SMSA, Aramex) — ✅ J&T انتهت
- [ ] back-fill بصمات Webhook (`email_from`) لباقي الشركات بما فيها J&T
- [ ] تطوير parser لـ COD remittance لـ iMile — ✅ J&T انتهى
- [x] إضافة دور "محاسب" / "مدير" مع صلاحيات اعتماد منفصلة — ✅ نظام الأدوار والصلاحيات (§1.10)
- [x] إغلاق فترات شهرية (period closing) — ✅ مُفعَّل ومُنفَّذ بالـ DB (§1.17): جدول `period_closes` + 4 triggers `guard_closed_period` (P0001) + `/periods`. لم يُقفَل شهر بعد، جاهز للاستخدام

---

**آخر تحديث:** 2026-06-21 — (1) §1.18 **معالجة الجوال الشاملة**: استراتيجية CSS كاملة (أصناف `.m-cards`/`.m-compact`/`.hero-grid`/`.mobile-hide`، الجانبية درج 320px مع `visibility:hidden` ضد تمرير iOS، انطواء الشبكات بمطابقة substring متحقَّقة) — 9 جداول كثيفة → بطاقات، كل العالية والمتوسطة من تدقيق وكلاء (39 مشكلة). (2) §1.17 توثيق **الإقفال الشهري** كمُفعَّل ومُنفَّذ بالـ DB (كان مظنوناً معلّقاً).

**أسبق:** 2026-06-20 — (1) §1.15 كشف البنك المتراكم: جدول `bank_transactions` + دمج ذكي عبر `dedup_key` (فهرس فريد كامل، آمن من 42P10) — الرفعات المتداخلة تُدمَج لا تتضاعف. (2) §1.16 سمسا فروع في مُنتقي COD (parser يعيد استخدام صيغة سمسا) + زر تنزيل لكل ملف تسوية مع حالة كل شحنة. (3) إصلاح مُنتقي الناقل في «مطالبة جديدة» (Select يقبل children لا `options=`) + زر «الكشف الكامل» بارز في بطاقة `/hub`.

**أسبق:** 2026-05-30 — (1) إصلاح فخّ الـ 42P10 في مسار COD (`saveSettlementUpload`) + back-fill 11 قيد COD (361,280.26 ر.س). (2) إصلاح اكتشاف عمود COD المجرّد: أُضيف `/^cod$/i` لأنماط `codAmount` — كان iMile KSA Fee Bill يُسجّل 0 تحصيل عند الاعتماد رغم 41,533 ر.س محصَّلة (مُتحقَّق عبر تشغيل المحرّك الفعلي على الملف: 316 شحنة OK، 272 شحنة COD = 41,533.49)

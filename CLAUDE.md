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
- **القاعدة:** أي hub جديد بتبويبات يجب أن يُعرّف `subTabs` على عنصره في `NAV_ITEMS` ليبقى كل تبويب مرئياً بنقرة واحدة. لا تُخفِ تبويباً خلف الـ hub فقط.

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
- التقارير + النظام **مطويان افتراضياً** (مفتاح `sa-nav-collapsed-v3` يطبّق الافتراض الجديد مرة لكل مستخدم). الطيّ عبر `maxHeight:0` لا unmount.
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
- النتيجة تُرجِع `{ saved, added, merged }` للعرض. تبويب «الدفتر البنكي المحفوظ» يعرض المتراكم مع بحث/إجماليات/حذف.
- **القاعدة:** أي مصدر مالي يُرفَع تكراراً (بتداخل فترات) يجب أن يحمل `dedup_key` ثابتاً + فهرس فريد **كامل** ليُدمَج لا يتضاعف. المرجع البنكي هو المفتاح الطبيعي.

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
  - **فخّ الدفع المختلط (split payment)**: عند `codPaymentMethod = 'NLCard Cash'` (جزء بطاقة + جزء نقد) النسبة (2% لـJ&T) تُطبَّق على **جزء البطاقة فقط** لا كامل COD — النقد مجاني. المحرّك حالياً يضرب `posFeePct × كامل codAmount` فيُبالغ في المتوقّع للشحنة المختلطة. مثال مُتحقَّق (فاتورة J&T مايو، شحنة JTE000939673892): COD 236، الجزء بالبطاقة 36 → الناقل فوتر `36×2%=0.72` (صحيح)، بينما حسابنا توقّع `236×2%=4.72` (فرق 4 ر.س وهمي). **لا تطالب بفروقات رسم POS على شحنات NLCard Cash** — الناقل محقّ. إصلاح دائم يحتاج عمود «مبلغ البطاقة» المنفصل لاستخراج أساس النسبة (غير متاح في ملف J&T الحالي)؛ حتى ذلك، الفرق على الشحنات المختلطة passthrough.
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

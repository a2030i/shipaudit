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

### 2.4 المحاسبة في `carrier_operations`
- DR = نحن مدينون للشركة (فاتورة شحن)
- CR = الشركة مدينة لنا / نحن دفعنا (تحصيل COD، تحويل بنكي)
- الرصيد = `SUM(DR) - SUM(CR)`. موجب = نحن مدينون، سالب = هي مدينة لنا
- **قيد واحد لكل حدث مالي.** لا قيد لكل AWB. التفاصيل في `audit_shipments` / `cod_settlement`

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
| `src/lib/codSettlementService.js` | COD reconciliation، syncAuditCodOut، saveSettlementUpload |
| `src/lib/customerReceivablesService.js` | parser + snapshot upload + load latest AR rollup |
| `src/lib/webhookService.js` | CRUD لـ webhook_events، delete (مع verify) |
| `src/lib/carriersHubService.js` | تجميع بيانات `/hub` (paginated) |
| `src/lib/carrierProfileService.js` | بيانات بروفايل شركة واحدة، updateCarrierFileSignature |
| `src/lib/carrierStatementsService.js` | رفع كشوف الشركات الخارجية، carrier_operations CRUD |
| `src/lib/contractHistoryService.js` | تتبع تغييرات العقود |
| `src/pages/UploadWizard.jsx` | معالج المراجعة 3 خطوات، استيراد Webhook |
| `src/pages/AuditResults.jsx` | شاشة المراجعة + بوابة الاعتماد UI |
| `src/pages/WebhookEvents.jsx` | صندوق الوارد، حفظ كمراجعة، حذف |
| `src/pages/CodSettlements.jsx` | تسويات COD، تبويبات، تصدير قسم حالي |
| `src/pages/CustomerReceivables.jsx` | `/receivables` — مديونيات العملاء (read-only snapshots) |
| `src/pages/CarriersHub.jsx` | `/hub` — كرت لكل شركة |
| `src/pages/CarrierProfile.jsx` | `/carrier?id=X` — بروفايل شركة كامل |
| `src/pages/CarrierLedger.jsx` | `/ledger` — الكشف المحاسبي للشركات |
| `src/engine/audit.js` | اكتشاف الأعمدة، حساب العقد، buildSummary |
| `src/engine/codParsers/*.js` | parsers لملفات تحصيل COD لكل شركة |
| `src/App.jsx` | Routes + Sidebar + PageSlot |
| `src/components/UI.jsx` | Btn / Card / Modal / Spinner / toast |
| `supabase/functions/webhook-intake/index.ts` | Edge function، حالياً v10 |

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
| `cod_reconciliation_action` | اعتمادات/اعتراضات على فروق COD |
| `customer_receivables` | snapshots لمديونيات العملاء (read-only AR view) |
| `customer_settings` | per-customer tag (excluded/priority) — يدوم عبر snapshots |
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
| Parser keys لشركة بصيغة ملف واحدة فقط | الملفات بصيغ أخرى تفشل صامتاً (no rows extracted) | احفظ كل column synonyms المعروفة في الـ parser. مثال: DeliverNow يدعم monthly invoice + weekly remittance |
| محاولة تعديل سعر/شريحة العقد مباشرة في DB | يدمّر تاريخ العقود | استخدم `saveCarrierContractsWithHistory` |
| تعديل `audits.results` JSONB لإضافة بيانات مهمة | حد TOAST + لن يُحمَّل للـ audits الكبيرة | استخدم `audit_shipments` بدلاً |
| نسيان `idempotency` على auto-posts | إعادة الاعتماد ينشئ قيود مكررة | استخدم unique partial indexes |
| تجاهل `file_kind` عند audit approval | إنشاء قيود غير منطقية | افحص دائماً file_kind قبل الـ auto-extract |

---

## 7. إعدادات الشركات الحالية (محدّث آخر مرة 2026-05-15)

| الشركة | ID | file_kind | عقد ساري | بصمة Webhook |
|---|---|---|---|---|
| DeliverNow | `delivernow` | `audit_with_cod` | ✅ 11 ر.س ثابتة، 15% VAT | ✅ `@delivernow.net` |
| أرامكس | `c_1777506662790` | (غير محدد) | ✅ | ❌ |
| iMile V1 | `imile` | (غير محدد) | ✅ 17/15kg ثم 1/kg | ❌ |
| J&T Express | `jnt` | `audit_and_cod_separate` | ✅ 16/15kg ثم 1/kg، 2% POS | ⚠️ AWB prefix=JTE، doc-pattern=WestBr، email غير محدد |
| سمسا SMSA | `smsa` | (غير محدد) | ✅ 2 عقود (محلي+دولي) | ❌ |
| Boleeseh | `boleeseh` | (غير محدد) | ❌ | ❌ |
| Webek | `webek` | (غير محدد) | ❌ | ❌ |
| Aatak | `aatak` | (غير محدد) | ❌ | ❌ |
| Delex | `delex` | (غير محدد) | ❌ | ❌ |

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

- [ ] back-fill قيود ledger للمراجعات الـ 12 السابقة (قبل auto-posting)
- [ ] تعريف `file_kind` لباقي الشركات (iMile, SMSA, Aramex) — ✅ J&T انتهت
- [ ] back-fill بصمات Webhook (`email_from`) لباقي الشركات بما فيها J&T
- [ ] تطوير parser لـ COD remittance لـ iMile — ✅ J&T انتهى
- [ ] إضافة دور "محاسب" / "مدير" مع صلاحيات اعتماد منفصلة
- [ ] إغلاق فترات شهرية (period closing)

---

**آخر تحديث:** 2026-05-15 — بعد إصلاح duplication في COD direction

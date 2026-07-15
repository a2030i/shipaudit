// permissions.js — single source of truth for what an accountant can do.
//
// Model:
//   • 2 roles in profiles.role:
//       'admin'      — bypasses every check (does everything)
//       'accountant' — gated by the JSONB profiles.permissions blob
//   • profiles.permissions is a plain { [key]: true } map. Missing key
//     or false = no access.
//   • Permission keys are dot-separated: "<section>.<action>".
//
// Add a new key: extend PERMISSION_CATALOG below + use `can(profile, key)`
// at the call site. The EmployeeManager UI auto-discovers everything
// here so a new key shows up as a checkbox after one refresh.

// ────────────────────────────────────────────────────────────────────
// Catalog. Grouped by feature area. Each section has:
//   id       — section key for grouping in the UI
//   label    — Arabic label shown in the UI
//   icon     — lucide-react icon name (resolved by EmployeeManager)
//   color    — accent color for the section header
//   perms[]  — array of { key, label, hint?, sensitive? }
//
// `sensitive: true` flags actions that should default OFF even when the
// admin uses the "Grant all read+write" preset (delete, approve, etc).
// The "Grant everything" preset includes them; the "Read + write"
// preset excludes them.
// ────────────────────────────────────────────────────────────────────
export const PERMISSION_CATALOG = [
  {
    id: 'overview', label: 'الرئيسية والتقارير', icon: 'LayoutDashboard', color: '#0EA5E9',
    perms: [
      { key: 'overview.view',       label: 'عرض الصفحة الرئيسية' },
      { key: 'overview.cash_position', label: 'عرض رصيد البنك وملخّص الكاش' },
      { key: 'overview.working_capital', label: 'عرض مؤشرات رأس المال العامل (DSO/DPO)' },
      { key: 'forecast.view',       label: 'عرض التوقعات والتقويم' },
    ],
  },
  {
    id: 'uploads', label: 'مصادر البيانات', icon: 'Layers', color: '#0EA5E9',
    perms: [
      { key: 'uploads.view',         label: 'فتح صحة مصادر البيانات' },
      { key: 'uploads.upload_file',  label: 'تحديث مصدر يدوي بملف' },
      { key: 'uploads.process_zoho', label: 'معالجة مرايا Zoho القديمة' },
      { key: 'uploads.dismiss_zoho', label: 'تجاهل/حذف مرايا Zoho القديمة', sensitive: true },
    ],
  },
  {
    id: 'webhook', label: 'صندوق الوارد (Webhook)', icon: 'Mail', color: '#8B5CF6',
    perms: [
      { key: 'webhook.view',         label: 'عرض الإيميلات الواردة' },
      { key: 'webhook.import_audit', label: 'استيراد ملف كمراجعة (حفظ كمراجعة)' },
      { key: 'webhook.import_cod',   label: 'استيراد ملف كتحصيل COD' },
      { key: 'webhook.assign_carrier', label: 'تعيين شركة شحن لملف غير مكتشف' },
      { key: 'webhook.delete',       label: 'حذف إيميل وارد', sensitive: true },
    ],
  },
  {
    id: 'audits', label: 'المراجعات', icon: 'FileCheck2', color: '#10B981',
    perms: [
      { key: 'audits.view',          label: 'عرض المراجعات' },
      { key: 'audits.create',        label: 'إنشاء مراجعة جديدة' },
      { key: 'audits.edit',          label: 'تعديل تفاصيل المراجعة (ملاحظات/شارات)' },
      { key: 'audits.export',        label: 'تصدير تقرير المراجعة' },
      { key: 'audits.approve',       label: 'اعتماد المراجعة', sensitive: true },
      { key: 'audits.reject',        label: 'رفض المراجعة', sensitive: true },
      { key: 'audits.reopen',        label: 'إعادة فتح مراجعة معتمدة', sensitive: true },
      { key: 'audits.delete',        label: 'حذف مراجعة', sensitive: true },
      { key: 'audits.override_drift', label: 'تجاوز بوابة الاعتماد (drift)', sensitive: true },
    ],
  },
  {
    id: 'carriers', label: 'شركات الشحن', icon: 'Truck', color: '#3B82F6',
    perms: [
      { key: 'carriers.view',          label: 'عرض شركات الشحن وبروفايلاتها' },
      { key: 'carriers.create',        label: 'إضافة شركة شحن جديدة' },
      { key: 'carriers.edit_contract', label: 'تعديل العقود والأسعار' },
      { key: 'carriers.edit_signature', label: 'تعديل بصمة الإيميل وكشف الملفات' },
      { key: 'carriers.delete',        label: 'حذف شركة شحن', sensitive: true },
      { key: 'carriers.upload_statement', label: 'رفع كشف من الشركة' },
      { key: 'carriers.delete_statement', label: 'حذف كشف مرفوع', sensitive: true },
    ],
  },
  {
    id: 'cod', label: 'تسويات COD', icon: 'Coins', color: '#F59E0B',
    perms: [
      { key: 'cod.view',             label: 'عرض تسويات COD' },
      { key: 'cod.upload_in',        label: 'رفع ملف تحصيل (مُستلَم)' },
      { key: 'cod.upload_out',       label: 'رفع ملف متوقَّع (out)' },
      { key: 'cod.delete_upload',    label: 'حذف رفعة', sensitive: true },
      { key: 'cod.approve_dispute',  label: 'اعتماد/رفض اعتراض', sensitive: true },
      { key: 'cod.export',           label: 'تصدير تسويات COD' },
    ],
  },
  {
    id: 'receivables', label: 'مديونيات العملاء', icon: 'Users', color: '#EF4444',
    perms: [
      { key: 'receivables.view',       label: 'عرض المديونيات والتقارير' },
      { key: 'receivables.export',     label: 'تصدير ملف حملة تحصيل/SOA' },
      { key: 'receivables.set_credit_limit', label: 'تعديل سقف ائتمان عميل', sensitive: true },
      { key: 'receivables.tag_customer', label: 'تصنيف عميل (مستبعد/أولوية)' },
      { key: 'receivables.request_writeoff', label: 'تقديم طلب شطب دين' },
      { key: 'receivables.approve_writeoff', label: 'اعتماد/رفض طلب شطب', sensitive: true },
      { key: 'legal.view',                   label: 'التصعيد القانوني (تجاوز 90 يوم/محافظ سالبة)' },
    ],
  },
  {
    id: 'collections', label: 'حملة التحصيل', icon: 'PhoneCall', color: '#EF4444',
    perms: [
      { key: 'collections.view',         label: 'عرض قائمة المهمات' },
      { key: 'collections.regenerate',   label: 'إعادة توليد المهمات' },
      { key: 'collections.update_stage', label: 'تحديث مرحلة المهمة' },
      { key: 'collections.record_promise', label: 'تسجيل وعد دفع (PTP)' },
      { key: 'collections.snooze',       label: 'تأجيل المهمة' },
      { key: 'collections.create_task',  label: 'إنشاء مهمة يدوية' },
      { key: 'collections.delete_task',  label: 'حذف مهمة', sensitive: true },
    ],
  },
  {
    id: 'crm', label: 'المتابعة والمبيعات (CRM)', icon: 'Headset', color: '#06B6D4',
    perms: [
      { key: 'crm.view',            label: 'عرض قائمة المتابعة والجهات والصفقات' },
      { key: 'crm.view_all',        label: 'عرض متابعات كل الموظفين (لا المُسنَدة لي فقط)', sensitive: true },
      { key: 'crm.log_activity',    label: 'تسجيل مكالمة/ملاحظة/إفادة' },
      { key: 'crm.record_promise',  label: 'تسجيل/إغلاق وعد بالدفع' },
      { key: 'crm.manage_tasks',    label: 'إنشاء/إغلاق مواعيد ومهام' },
      { key: 'crm.change_status',   label: 'تغيير حالة المتابعة' },
      { key: 'crm.manage_deals',    label: 'إنشاء/تحريك صفقات المبيعات' },
      { key: 'crm.assign',          label: 'إسناد عميل/جهة/صفقة لموظف' },
      { key: 'crm.upload_leads',    label: 'رفع متاجر/جهات خارجية' },
      { key: 'crm.convert_lead',    label: 'تحويل جهة إلى عميل' },
      { key: 'crm.manage_statuses', label: 'تخصيص حالات المتابعة ومراحل البيع', sensitive: true },
      { key: 'crm.write_off',       label: 'شطب دين (إغلاق غير قابل للتحصيل)', sensitive: true },
    ],
  },
  {
    id: 'merchants', label: 'دليل المتاجر', icon: 'Store', color: '#8B5CF6',
    perms: [
      { key: 'merchants.view',     label: 'عرض دليل المتاجر' },
      { key: 'merchants.upload',   label: 'رفع snapshot جديد' },
      { key: 'merchants.link',     label: 'ربط عميل بمتجر (تلقائي/يدوي)' },
      { key: 'merchants.unlink',   label: 'فك ربط', sensitive: true },
    ],
  },
  {
    id: 'sales', label: 'المبيعات وإعادة الاستهداف', icon: 'Target', color: '#F97316',
    perms: [
      { key: 'sales.view',   label: 'عرض إعادة الاستهداف وفرص هاتف والشرائح' },
      { key: 'sales.manage', label: 'تحديث حالة/ملاحظة/إسناد الفرص' },
      { key: 'sales.export', label: 'تصدير قوائم الفرص' },
    ],
  },
  {
    id: 'campaigns', label: 'حملات واتساب', icon: 'MessageCircle', color: '#22C55E',
    perms: [
      // الإرسال فعل خارجي يصل العميل — حسّاس عمداً (يُستثنى من preset «قراءة وكتابة»)
      { key: 'campaigns.send',      label: 'إطلاق حملة واتساب (إرسال فعلي للعملاء)', sensitive: true },
      { key: 'whatsapp.view_log',   label: 'عرض سجل الحملات' },
      { key: 'whatsapp.configure',  label: 'إعدادات واتساب (القوالب/التنبيهات)', sensitive: true },
    ],
  },
  {
    id: 'money', label: 'النقد والمدفوعات', icon: 'Wallet', color: '#F59E0B',
    perms: [
      { key: 'money.pnl',          label: 'الوضع المالي — قائمة الدخل من زوهو (أرباح/خسائر)' },
      { key: 'zoho.view',          label: 'زوهو API — تصفّح المرايا ولوحة الفواتير' },
      { key: 'bank.view',          label: 'عرض رصيد البنك وسجل التحديثات' },
      { key: 'bank.set_balance',   label: 'تحديث رصيد البنك يدوياً', sensitive: true },
      { key: 'payments.view',      label: 'عرض الدفعات' },
      { key: 'payments.create',    label: 'تسجيل دفعة جديدة' },
      { key: 'payments.allocate',  label: 'توزيع دفعة على القيود' },
      { key: 'payments.delete',    label: 'حذف دفعة', sensitive: true },
      { key: 'payment_requests.view',    label: 'عرض طلبات الدفع' },
      { key: 'payment_requests.create',  label: 'إنشاء طلب دفع' },
      { key: 'payment_requests.approve', label: 'اعتماد طلب دفع', sensitive: true },
      { key: 'payment_requests.reject',  label: 'رفض طلب دفع', sensitive: true },
    ],
  },
  {
    id: 'ledger', label: 'الكشوف المحاسبية', icon: 'BookOpenCheck', color: '#F59E0B',
    perms: [
      { key: 'ledger.view',         label: 'عرض الكشف المحاسبي للشركات' },
      { key: 'ledger.manual_entry', label: 'إضافة قيد يدوي', sensitive: true },
      { key: 'ledger.delete_entry', label: 'حذف قيد', sensitive: true },
      { key: 'ledger.export',       label: 'تصدير الكشف' },
    ],
  },
  {
    id: 'internal_exports', label: 'التصدير للأنظمة الداخلية', icon: 'Send', color: '#0EA5E9',
    perms: [
      { key: 'internal_exports.view', label: 'عرض الصفحة' },
      { key: 'internal_exports.pull', label: 'سحب دفعة جديدة للتصدير' },
    ],
  },
  {
    id: 'reconciliation', label: 'المطابقة (Zoho/لمحه)', icon: 'GitMerge', color: '#8B5CF6',
    perms: [
      { key: 'reconciliation.view',   label: 'عرض شاشة المطابقة' },
      { key: 'reconciliation.link',   label: 'ربط/تعيين سجل' },
      { key: 'reconciliation.unlink', label: 'فك ربط', sensitive: true },
      { key: 'reconciliation.export', label: 'تصدير ملف الفروقات' },
    ],
  },
  {
    id: 'system', label: 'إعدادات النظام', icon: 'Settings', color: '#6B7280',
    perms: [
      { key: 'system.view_settings',      label: 'عرض الإعدادات' },
      { key: 'system.edit_settings',      label: 'تعديل الإعدادات العامة', sensitive: true },
      { key: 'system.manage_employees',   label: 'إدارة الموظفين (إضافة/حذف/تعديل)', sensitive: true },
      { key: 'system.manage_permissions', label: 'إدارة صلاحيات الموظفين', sensitive: true },
      { key: 'system.period_close',       label: 'إغلاق/فتح الفترات المحاسبية', sensitive: true },
      { key: 'system.view_audit_log',     label: 'عرض سجل النشاط' },
    ],
  },
];

// Flat array of every permission key — convenience for the UI.
export const ALL_PERMISSION_KEYS = PERMISSION_CATALOG.flatMap(s => s.perms.map(p => p.key));

// Read-only preset: every "view" + "export" key. Useful for read-only
// observers (the admin's manager, an external auditor).
export const READ_ONLY_KEYS = ALL_PERMISSION_KEYS.filter(k =>
  /\.(view|export)$/.test(k),
);

// Read + write preset: everything except sensitive actions (delete,
// approve, reopen, set_credit_limit, ...). Good default for a typical
// accountant who collects data and prepares files but isn't authorized
// to commit money/close periods.
const SENSITIVE_KEYS = new Set(
  PERMISSION_CATALOG.flatMap(s => s.perms.filter(p => p.sensitive).map(p => p.key)),
);
export const READ_WRITE_KEYS = ALL_PERMISSION_KEYS.filter(k => !SENSITIVE_KEYS.has(k));

// Everything-on preset (for trusted senior accountants — equivalent to
// admin minus employee management). Excludes only the system-level
// sensitive keys that should always stay admin-only.
const ADMIN_ONLY_KEYS = new Set([
  'system.manage_employees',
  'system.manage_permissions',
]);
export const FULL_ACCOUNTANT_KEYS = ALL_PERMISSION_KEYS.filter(k => !ADMIN_ONLY_KEYS.has(k));

// ── أدوار وظيفية جاهزة (v2 — 2026-07-15) ─────────────────────────────
// «موظف مبيعات»: الفرص والحملات فقط — صفر مالية/تدقيق/تحصيل ديون.
export const SALES_ROLE_KEYS = [
  'overview.view',
  'sales.view', 'sales.manage', 'sales.export',
  'campaigns.send', 'whatsapp.view_log',
  'crm.view', 'crm.log_activity', 'crm.change_status', 'crm.manage_tasks', 'crm.manage_deals',
  'merchants.view',
];

// «محصّل ديون»: المديونيات والتصعيد والحملات — صفر مبيعات/مالية عامة.
export const COLLECTOR_ROLE_KEYS = [
  'overview.view',
  'receivables.view', 'receivables.export', 'receivables.tag_customer', 'receivables.request_writeoff',
  'legal.view',
  'collections.view', 'collections.regenerate', 'collections.update_stage',
  'collections.record_promise', 'collections.snooze', 'collections.create_task',
  'campaigns.send', 'whatsapp.view_log',
  'crm.view', 'crm.log_activity', 'crm.record_promise', 'crm.change_status', 'crm.manage_tasks',
  'merchants.view',
];

// Preset list shown in the UI as quick toggles.
export const PRESETS = [
  { id: 'none',      label: 'بدون صلاحيات',  keys: []                       },
  { id: 'readonly',  label: 'قراءة فقط',     keys: READ_ONLY_KEYS           },
  { id: 'sales',     label: 'موظف مبيعات — فرص وحملات', keys: SALES_ROLE_KEYS },
  { id: 'collector', label: 'محصّل — مديونيات وحملات',  keys: COLLECTOR_ROLE_KEYS },
  { id: 'standard',  label: 'محاسب — قراءة وكتابة', keys: READ_WRITE_KEYS    },
  { id: 'full',      label: 'محاسب — صلاحيات كاملة (عدا الموظفين)', keys: FULL_ACCOUNTANT_KEYS },
];

// ────────────────────────────────────────────────────────────────────
// The single check used everywhere in the UI.
// ────────────────────────────────────────────────────────────────────
export function can(profile, key) {
  if (!profile) return false;
  if (profile.role === 'admin') return true;
  // v2: مفتاح مفقود = مغلق. الافتراض القديم (مفتوح) كان يجعل أي صفحة تنسى
  // حارسها مكشوفة لكل محاسب — فُحصت كل مواقع الاستدعاء قبل هذا القلب.
  if (!key) return false;
  return profile.permissions?.[key] === true;
}

// Sugar: check several keys at once. "all" = all granted; "any" = at
// least one granted. Useful for page-level guards (any of view OR a
// specific action lets you in).
export function canAll(profile, keys) {
  return keys.every(k => can(profile, k));
}
export function canAny(profile, keys) {
  return keys.some(k => can(profile, k));
}

// Helper: lookup a permission's display label by key (for tooltips /
// "you don't have permission to do X" messages).
const LABEL_BY_KEY = Object.fromEntries(
  PERMISSION_CATALOG.flatMap(s => s.perms.map(p => [p.key, p.label])),
);
export function permLabel(key) {
  return LABEL_BY_KEY[key] || key;
}

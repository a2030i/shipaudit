// نقطة الحقيقة لهندسة المعلومات الظاهرة للمستخدم.
// تعريف المسار والصلاحية يبقى في App لأنه مرتبط بتركيب الصفحات، أما قرار
// الظهور والقسم والترتيب والمسمى فيؤخذ حصراً من هذا الملف.
export const NAV_SECTIONS = [
  { id: 'customers', path: '/workspace/customers',  label: 'العملاء',  icon: 'Users',      accent: '#EF4444', hint: 'الملف الموحد · الخدمة · حالة العميل' },
  { id: 'sales',     path: '/workspace/sales',      label: 'المبيعات', icon: 'Target',     accent: '#8B5CF6', hint: 'الفرص · الصفقات · الحملات' },
  { id: 'finance',   path: '/workspace/finance',    label: 'المالية',  icon: 'DollarSign', accent: '#F59E0B', hint: 'التحصيل · البنوك · زوهو · الربحية' },
  { id: 'shipping',  path: '/workspace/operations', label: 'التشغيل',  icon: 'Truck',      accent: '#2B68DE', hint: 'الشحن · الفوترة · الدورة الشهرية' },
  { id: 'reports',   path: '/workspace/reports',    label: 'التقارير', icon: 'FileCheck',  accent: '#22C55E', hint: 'المؤشرات · الرقابة · الأتمتة' },
  { id: 'settings',  path: '/workspace/admin',      label: 'الإدارة',  icon: 'Settings',   accent: '#31D5E1', hint: 'الفريق · العقود · التكاملات' },
];

export const CENTER_PATHS = Object.fromEntries(NAV_SECTIONS.map(section => [section.id, section.path]));

// المستوى الثاني داخل كل مركز. المجموعات عناوين تنظيمية وليست طبقة تنقل
// إضافية؛ جميع الصفحات والتبويبات التابعة لها تبقى ظاهرة داخل قائمة المركز.
export const NAV_GROUPS = {
  shipping: [
    { id: 'carrier_ops', label: 'شركات الشحن' },
    { id: 'monthly_cycle', label: 'الدورة المحاسبية الشهرية' },
    { id: 'invoice_ops', label: 'ملفات وفواتير الناقلين' },
    { id: 'service_ops', label: 'فوترة الخدمات والأوزان' },
  ],
  customers: [
    { id: 'customer_ops', label: 'ملفات وخدمة العملاء' },
  ],
  sales: [
    { id: 'sales_ops', label: 'الفرص والصفقات' },
    { id: 'outreach_ops', label: 'التواصل والنمو' },
  ],
  finance: [
    { id: 'receivables_ops', label: 'تحصيل العملاء' },
    { id: 'cash_ops', label: 'البنوك والسيولة' },
    { id: 'zoho_ops', label: 'المحاسبة وزوهو' },
    { id: 'profit_ops', label: 'الربحية والإقفال' },
  ],
  reports: [
    { id: 'report_ops', label: 'التقارير' },
    { id: 'automation_ops', label: 'الرقابة والأتمتة' },
  ],
  settings: [
    { id: 'team_ops', label: 'الفريق والصلاحيات' },
    { id: 'shipping_settings', label: 'شركات الشحن والعقود' },
    { id: 'integration_settings', label: 'التكاملات والقنوات' },
    { id: 'system_settings', label: 'إعدادات النظام' },
  ],
};

// هذه القائمة تعيد خريطة التنقل المستقرة مع الاحتفاظ بمراكز التكامل الجديدة.
// المسارات التاريخية لا تُحذف؛ الاختلاف هنا فقط في سهولة الوصول إليها.
export const NAV_ITEM_IA = {
  overview:            { label: 'الرئيسية', visible: true },
  // تبقى لوحة القرارات فعالة بالرابط المباشر والبحث، ولا تُنشئ مدخلًا
  // ثامنًا بجانب المراكز السبعة الثابتة.
  decisions:           { label: 'مهام وقرارات اليوم', visible: false },

  hub:                 { label: 'مركز شركات الشحن', section: 'shipping', group: 'carrier_ops', order: 10, visible: true },
  'platform-carriers': { label: 'مقارنة أسعار المنصات', section: 'shipping', group: 'carrier_ops', order: 20, visible: true },
  tasks:               { label: 'مهام شركات الشحن', section: 'shipping', group: 'carrier_ops', order: 30, visible: true },
  'accounting-cycle':  { label: 'الدورة المحاسبية الشهرية', section: 'shipping', group: 'monthly_cycle', order: 40, visible: true },
  drop:                { label: 'رفع ملفات الناقلين', section: 'shipping', group: 'invoice_ops', order: 50, visible: true },
  audits:              { label: 'مراجعات فواتير الناقلين', section: 'shipping', group: 'invoice_ops', order: 60, visible: true },
  'aramex-stmt':       { label: 'كشوف الناقلين', section: 'shipping', group: 'invoice_ops', order: 70, visible: true },
  ledger:              { label: 'دفتر حساب الناقلين', section: 'shipping', group: 'invoice_ops', order: 80, visible: true },
  fulfillment:         { label: 'فوترة خدمات العملاء', section: 'shipping', group: 'service_ops', order: 90, visible: true },
  'weight-billing':    { label: 'فوترة الأوزان الزائدة', section: 'shipping', group: 'service_ops', order: 100, visible: true },

  'customer-watch':    { label: 'ملف العميل الموحد', section: 'customers', group: 'customer_ops', order: 10, visible: true },
  support:             { label: 'خدمة العملاء', section: 'customers', group: 'customer_ops', order: 20, visible: true },

  'sales-hub':         { label: 'فرص البيع من بيانات المنصة', section: 'sales', group: 'sales_ops', order: 10, visible: true },
  crm:                 { label: 'إدارة المبيعات', section: 'sales', group: 'sales_ops', order: 20, visible: true },
  'campaign-center':   { label: 'مركز الحملات الذكي', section: 'sales', group: 'outreach_ops', order: 25, visible: true },
  'whatsapp-settings': { label: 'الحملات والاتصالات', section: 'sales', group: 'outreach_ops', order: 30, visible: true },
  marketers:           { label: 'المسوّقون والعمولات', section: 'sales', group: 'outreach_ops', order: 40, visible: true },

  'collections-hub':   { label: 'تحصيل العملاء', section: 'finance', group: 'receivables_ops', order: 10, visible: true },
  money:               { label: 'تسويات الناقلين والدفع عند الاستلام', section: 'finance', group: 'cash_ops', order: 20, visible: true },
  bank:                { label: 'الحسابات البنكية', section: 'finance', group: 'cash_ops', order: 30, visible: true },
  'cash-aging':        { label: 'أعمار التحصيل والسداد', section: 'finance', group: 'cash_ops', order: 40, visible: true },
  forecast:            { label: 'توقع السيولة', section: 'finance', group: 'cash_ops', order: 50, visible: true },
  'zoho-data':         { label: 'زوهو والحسابات', section: 'finance', group: 'zoho_ops', order: 60, visible: true },
  reconciliation:     { label: 'مطابقة الحسابات مع زوهو', section: 'finance', group: 'zoho_ops', order: 70, visible: true },
  pnl:                 { label: 'قائمة الدخل والربحية', section: 'finance', group: 'profit_ops', order: 80, visible: true },
  periods:             { label: 'إقفال الشهور', section: 'finance', group: 'profit_ops', order: 90, visible: true },

  reports:             { label: 'مكتبة التقارير', section: 'reports', group: 'report_ops', order: 10, visible: true },
  'monthly-report':    { label: 'التقرير الشهري', section: 'reports', group: 'report_ops', order: 20, visible: true },
  'internal-exports':  { label: 'الملفات المصدرة', section: 'reports', group: 'report_ops', order: 30, visible: true },
  'work-agents':       { label: 'وكلاء العمل', section: 'reports', group: 'automation_ops', order: 40, visible: true },

  employees:           { label: 'الفريق والصلاحيات', section: 'settings', group: 'team_ops', order: 10, visible: true },
  carriers:            { label: 'شركات الشحن', section: 'settings', group: 'shipping_settings', order: 20, visible: true },
  contracts:           { label: 'العقود والأسعار', section: 'settings', group: 'shipping_settings', order: 30, visible: true },
  operations:          { label: 'مركز التكاملات', section: 'settings', group: 'integration_settings', order: 40, visible: true },
  uploads:             { label: 'رفع ومزامنة ملفات لمحة', section: 'settings', group: 'integration_settings', order: 50, visible: true },
  webhook:             { label: 'وارد التكاملات', section: 'settings', group: 'integration_settings', order: 60, visible: true },
  'hatif-settings':    { label: 'إعدادات هاتف وIVR', section: 'settings', group: 'integration_settings', order: 70, visible: true },
  integrity:           { label: 'سلامة البيانات', section: 'settings', group: 'integration_settings', order: 80, visible: true },
  'activity-log':      { label: 'سجل النظام', section: 'settings', group: 'integration_settings', order: 90, visible: true },
  'app-settings':      { label: 'إعدادات النظام', section: 'settings', group: 'system_settings', order: 100, visible: true },
};

export function applyNavigationIA(items) {
  return items.map(item => {
    const ia = NAV_ITEM_IA[item.id];
    return {
      ...item,
      ...(ia?.label ? { label: ia.label } : {}),
      ...(ia?.section ? { section: ia.section } : {}),
      ...(ia?.group ? { navGroup: ia.group } : {}),
      ...(ia?.order != null ? { navOrder: ia.order } : {}),
      navHidden: ia?.visible !== true,
    };
  });
}

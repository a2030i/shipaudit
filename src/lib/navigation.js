// نقطة الحقيقة لهندسة المعلومات الظاهرة للمستخدم.
// تعريف المسار والصلاحية يبقى في App لأنه مرتبط بتركيب الصفحات، أما قرار
// الظهور والقسم والترتيب والمسمى فيؤخذ حصراً من هذا الملف.
export const NAV_SECTIONS = [
  { id: 'customers', path: '/workspace/customers', label: 'العملاء', icon: 'Users',      accent: '#EF4444', hint: 'الملف الموحد · الخدمة · حالة العميل' },
  { id: 'sales',     path: '/workspace/sales',     label: 'المبيعات', icon: 'Target',    accent: '#8B5CF6', hint: 'الفرص · الصفقات · الحملات' },
  { id: 'finance',   path: '/workspace/finance',   label: 'المالية', icon: 'DollarSign', accent: '#F59E0B', hint: 'التحصيل · البنوك · زوهو · الربحية' },
  { id: 'shipping',  path: '/workspace/operations',label: 'التشغيل', icon: 'Truck',      accent: '#2B68DE', hint: 'الشحن · الفوترة · الدورة الشهرية' },
  { id: 'reports',   path: '/workspace/reports',   label: 'التقارير', icon: 'FileCheck', accent: '#22C55E', hint: 'مؤشرات وتقارير الإدارة' },
  { id: 'settings',  path: '/workspace/admin',     label: 'الإدارة', icon: 'Settings',   accent: '#31D5E1', hint: 'الفريق · العقود · التكاملات' },
];

export const CENTER_PATHS = Object.fromEntries(NAV_SECTIONS.map(section => [section.id, section.path]));

// المستوى الثاني داخل كل قسم رئيسي. هذه المجموعات عناوين تنظيمية ثابتة
// وليست أكورديوناً إضافياً؛ فتح القسم الرئيسي يكشف المجموعات وصفحاتها معاً
// حتى تبقى الجانبية شاملة من دون مضاعفة عدد النقرات على الجوال.
export const NAV_GROUPS = {
  shipping: [
    { id: 'carrier_ops', label: 'شركات الشحن' },
    { id: 'monthly_cycle', label: 'الدورة المحاسبية الشهرية' },
    { id: 'invoice_ops', label: 'ملفات وفواتير الناقلين' },
    { id: 'service_ops', label: 'فوترة الخدمات' },
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
    { id: 'carrier_cash_ops', label: 'تسويات شركات الشحن' },
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

// العناصر غير المذكورة تبقى مسارات محمية لكنها لا تظهر كخيارات متساوية
// في القائمة. الوصول إليها يكون من مركز العمل أو من رابط قديم محفوظ.
export const NAV_ITEM_IA = {
  overview:          { label: 'الرئيسية', visible: true },
  decisions:         { label: 'مهام وقرارات اليوم', visible: true },
  'accounting-cycle': { label: 'الدورة المحاسبية الشهرية', section: 'shipping', group: 'monthly_cycle', order: 20, visible: true },
  hub:               { label: 'مركز شركات الشحن', section: 'shipping', group: 'carrier_ops', order: 10, visible: true },
  drop:              { label: 'صندوق ملفات الناقلين', section: 'shipping', group: 'invoice_ops', order: 30, visible: true },
  audits:            { label: 'مراجعات فواتير الناقلين', section: 'shipping', group: 'invoice_ops', order: 40, visible: true },
  fulfillment:       { label: 'فوترة خدمات العملاء', section: 'shipping', group: 'service_ops', order: 50, visible: true },
  'customer-watch':  { label: 'ملف العميل', section: 'customers', group: 'customer_ops', order: 10, visible: true },
  support:           { label: 'خدمة العملاء', section: 'customers', group: 'customer_ops', order: 20, visible: true },
  'collections-hub': { label: 'تحصيل العملاء', description: 'مديونيات العملاء والحملات ومتابعة السداد', section: 'finance', group: 'receivables_ops', order: 10, visible: true },
  'sales-hub':       { label: 'فرص البيع من بيانات المنصة', section: 'sales', group: 'sales_ops', order: 10, visible: true },
  crm:                { label: 'إدارة المبيعات', section: 'sales', group: 'sales_ops', order: 20, visible: true },
  'whatsapp-settings': { label: 'الحملات والاتصالات', section: 'sales', group: 'outreach_ops', order: 30, visible: true },
  marketers:          { label: 'المسوّقون والعمولات', section: 'sales', group: 'outreach_ops', order: 40, visible: true },
  bank:               { label: 'الحسابات البنكية', description: 'كشوف الحساب والأرصدة والعمليات غير المصنفة', section: 'finance', group: 'cash_ops', order: 20, visible: true },
  money:              { label: 'تحصيل شركات الشحن ومدفوعات الناقلين', description: 'تسويات COD ودفعات شركات الشحن', section: 'finance', group: 'carrier_cash_ops', order: 30, visible: true },
  'zoho-data':        { label: 'زوهو والحسابات', description: 'الفواتير والدفعات ودليل الحسابات من زوهو', section: 'finance', group: 'zoho_ops', order: 40, visible: true },
  reconciliation:     { label: 'مطابقة الحسابات مع زوهو', description: 'فروق أرصدة العملاء ومصادرها', section: 'finance', group: 'zoho_ops', order: 50, visible: true },
  pnl:                { label: 'قائمة الدخل والربحية', description: 'الإيرادات والتكاليف وصافي الربح', section: 'finance', group: 'profit_ops', order: 60, visible: true },
  reports:            { label: 'التقارير', section: 'reports', group: 'report_ops', order: 10, visible: true },
  operations:         { label: 'التكاملات ومراقبة الربط', section: 'settings', group: 'integration_settings', order: 20, visible: true },
  'work-agents':      { label: 'وكلاء العمل', section: 'reports', group: 'automation_ops', order: 20, visible: true },
  uploads:            { label: 'مزامنة مصادر البيانات', section: 'reports', group: 'automation_ops', order: 30, visible: true },
  employees:          { label: 'الفريق والصلاحيات', section: 'settings', group: 'team_ops', order: 10, visible: true },
  carriers:           { label: 'شركات الشحن', section: 'settings', group: 'shipping_settings', order: 20, visible: true },
  contracts:          { label: 'العقود والأسعار', section: 'settings', group: 'shipping_settings', order: 30, visible: true },
  'hatif-settings':   { label: 'إعدادات هاتف', section: 'settings', group: 'integration_settings', order: 10, visible: true },
  'app-settings':     { label: 'إعدادات النظام', section: 'settings', group: 'system_settings', order: 10, visible: true },
};

export function applyNavigationIA(items) {
  return items.map(item => {
    const ia = NAV_ITEM_IA[item.id];
    return {
      ...item,
      ...(ia?.label ? { label: ia.label } : {}),
      ...(ia?.description ? { description: ia.description } : {}),
      ...(ia?.section ? { section: ia.section } : {}),
      ...(ia?.group ? { navGroup: ia.group } : {}),
      ...(ia?.order != null ? { navOrder: ia.order } : {}),
      navHidden: ia?.visible !== true,
    };
  });
}

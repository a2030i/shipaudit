// نقطة الحقيقة لهندسة المعلومات الظاهرة للمستخدم.
// تعريف المسار والصلاحية يبقى في App لأنه مرتبط بتركيب الصفحات، أما قرار
// الظهور والقسم والترتيب والمسمى فيؤخذ حصراً من هذا الملف.
export const NAV_SECTIONS = [
  { id: 'shipping',  label: 'الشحن والفوترة',      icon: 'Truck',      accent: '#2B68DE', hint: 'رفع · تدقيق · تسويات · فوترة' },
  { id: 'customers', label: 'العملاء والتحصيل',    icon: 'Users',      accent: '#EF4444', hint: 'ملف العميل · تحصيل · خدمة' },
  { id: 'sales',     label: 'المبيعات والتواصل',   icon: 'Target',     accent: '#8B5CF6', hint: 'فرص · مبيعات · حملات · عمولات' },
  { id: 'finance',   label: 'المالية وزوهو',       icon: 'DollarSign', accent: '#F59E0B', hint: 'ربحية · بنوك · زوهو · مطابقة' },
  { id: 'reports',   label: 'التقارير والرقابة',   icon: 'FileCheck',  accent: '#22C55E', hint: 'تقارير · مزامنة · سلامة' },
  { id: 'settings',  label: 'الإعدادات',           icon: 'Settings',   accent: '#31D5E1', hint: 'فريق · شركات · عقود · تكاملات' },
];

// المستوى الثاني داخل كل قسم رئيسي. هذه المجموعات عناوين تنظيمية ثابتة
// وليست أكورديوناً إضافياً؛ فتح القسم الرئيسي يكشف المجموعات وصفحاتها معاً
// حتى تبقى الجانبية شاملة من دون مضاعفة عدد النقرات على الجوال.
export const NAV_GROUPS = {
  shipping: [
    { id: 'carrier_ops', label: 'إدارة الشحن' },
    { id: 'invoice_ops', label: 'الرفع والفوترة' },
  ],
  customers: [
    { id: 'customer_ops', label: 'ملفات وخدمة العملاء' },
    { id: 'collection_ops', label: 'المديونيات والتحصيل' },
  ],
  sales: [
    { id: 'sales_ops', label: 'الفرص والصفقات' },
    { id: 'outreach_ops', label: 'التواصل والنمو' },
  ],
  finance: [
    { id: 'cash_ops', label: 'النقد والبنوك' },
    { id: 'zoho_ops', label: 'المحاسبة وزوهو' },
  ],
  reports: [
    { id: 'report_ops', label: 'التقارير' },
    { id: 'automation_ops', label: 'الرقابة والأتمتة' },
  ],
  settings: [
    { id: 'team_ops', label: 'الفريق والإدارة' },
    { id: 'shipping_settings', label: 'إعدادات الشحن' },
    { id: 'system_settings', label: 'النظام والتكاملات' },
  ],
};

// العناصر غير المذكورة تبقى مسارات محمية لكنها لا تظهر كخيارات متساوية
// في القائمة. الوصول إليها يكون من مركز العمل أو من رابط قديم محفوظ.
export const NAV_ITEM_IA = {
  overview:          { label: 'الرئيسية', visible: true },
  decisions:         { label: 'مهام وقرارات اليوم', visible: true },
  'accounting-cycle': { label: 'دورة تشغيل المحاسب', section: 'finance', group: 'cash_ops', order: 5, visible: true },
  hub:               { label: 'مركز شركات الشحن', section: 'shipping', group: 'carrier_ops', order: 10, visible: true },
  drop:              { label: 'الرفع والوارد', section: 'shipping', group: 'invoice_ops', order: 20, visible: true },
  audits:            { label: 'تدقيق الفواتير', section: 'shipping', group: 'invoice_ops', order: 30, visible: true },
  fulfillment:       { label: 'فوترة الخدمات', section: 'shipping', group: 'invoice_ops', order: 40, visible: true },
  'customer-watch':  { label: 'ملف العميل', section: 'customers', group: 'customer_ops', order: 10, visible: true },
  'collections-hub': { label: 'تحصيل العملاء', section: 'customers', group: 'collection_ops', order: 20, visible: true },
  support:           { label: 'خدمة العملاء', section: 'customers', group: 'customer_ops', order: 30, visible: true },
  'sales-hub':       { label: 'فرص البيع من بيانات المنصة', section: 'sales', group: 'sales_ops', order: 10, visible: true },
  crm:                { label: 'إدارة المبيعات', section: 'sales', group: 'sales_ops', order: 20, visible: true },
  'whatsapp-settings': { label: 'الحملات والاتصالات', section: 'sales', group: 'outreach_ops', order: 30, visible: true },
  marketers:          { label: 'المسوّقون والعمولات', section: 'sales', group: 'outreach_ops', order: 40, visible: true },
  money:              { label: 'تحويلات الناقلين والبنوك', section: 'finance', group: 'cash_ops', order: 10, visible: true },
  pnl:                { label: 'قائمة الدخل والربحية', section: 'finance', group: 'zoho_ops', order: 20, visible: true },
  'zoho-data':        { label: 'زوهو والحسابات', section: 'finance', group: 'zoho_ops', order: 30, visible: true },
  reconciliation:     { label: 'مطابقة الحسابات مع زوهو', section: 'finance', group: 'zoho_ops', order: 40, visible: true },
  reports:            { label: 'التقارير', section: 'reports', group: 'report_ops', order: 10, visible: true },
  'work-agents':      { label: 'وكلاء العمل', section: 'reports', group: 'automation_ops', order: 20, visible: true },
  uploads:            { label: 'مزامنة مصادر البيانات', section: 'reports', order: 20, visible: false },
  employees:          { label: 'الفريق والصلاحيات', section: 'settings', group: 'team_ops', order: 10, visible: true },
  carriers:           { label: 'شركات الشحن', section: 'settings', group: 'shipping_settings', order: 20, visible: true },
  contracts:          { label: 'العقود والأسعار', section: 'settings', group: 'shipping_settings', order: 30, visible: true },
  'app-settings':     { label: 'التكاملات والذكاء الاصطناعي', section: 'settings', group: 'system_settings', order: 40, visible: true },
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

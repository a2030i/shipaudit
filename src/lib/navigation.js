// المصدر المركزي لهندسة المعلومات الظاهرة للمستخدم.
// المسارات والصلاحيات تبقى في App.jsx، أما ما يظهر في التنقل وترتيبه ومسماه
// فيُحسم هنا حتى لا تتحول القائمة إلى نسخة من كل مسار تاريخي في النظام.

export const NAV_SECTIONS = [
  {
    id: 'finance',
    path: '/workspace/finance',
    label: 'العمليات المالية',
    icon: 'Landmark',
    accent: '#2563EB',
    hint: 'العملاء · الفوترة · التحصيل · البنوك · الإقفال',
  },
  {
    id: 'sales',
    path: '/workspace/sales',
    label: 'المبيعات',
    icon: 'Target',
    accent: '#7C3AED',
    hint: 'الفرص · الصفقات · الحملات · العمولات',
  },
  {
    id: 'support',
    path: '/workspace/support',
    label: 'خدمة العملاء',
    icon: 'LifeBuoy',
    accent: '#0F9F8F',
    hint: 'التذاكر · الشحنات · الشكاوى · التعويضات',
  },
  {
    id: 'admin',
    path: '/workspace/admin',
    label: 'إدارة النظام',
    icon: 'Settings',
    accent: '#64748B',
    hint: 'الفريق · الصلاحيات · التكاملات · القنوات',
  },
];

export const CENTER_PATHS = Object.fromEntries(
  NAV_SECTIONS.map(section => [section.id, section.path]),
);

// لا نضيف طبقة تصنيف أخرى داخل القائمة السياقية. كل مساحة عمل تعرض قائمة
// واحدة قصيرة ومباشرة؛ التفاصيل الدقيقة تبقى داخل مسار العمل نفسه.
export const NAV_GROUPS = {
  finance: [{ id: 'finance_work', label: '' }],
  sales: [{ id: 'sales_work', label: '' }],
  support: [{ id: 'support_work', label: '' }],
  admin: [{ id: 'admin_work', label: '' }],
};

// المسارات غير المذكورة تظل عاملة ومحميّة للتوافق والوصول من الإجراءات
// السياقية، لكنها لا تظهر كصفحات متساوية الأهمية في القائمة.
export const NAV_ITEM_IA = {
  overview: {
    label: 'الرئيسية',
    description: 'ما يحتاج إلى قرار أو إجراء الآن',
    section: 'finance', group: 'finance_work', order: 10, visible: true, pinned: false,
  },
  'collections-hub': {
    label: 'العملاء والذمم',
    description: 'ملف العميل والرصيد والتحصيل والحد الائتماني',
    section: 'finance', group: 'finance_work', order: 20, visible: true,
  },
  'customer-watch': {
    label: 'ملف العميل الموحد',
    description: 'كل بيانات العميل المالية والتشغيلية والتجارية في سياق واحد',
    section: 'finance', group: 'finance_work', order: 21, visible: false,
  },
  fulfillment: {
    label: 'فواتير العملاء',
    description: 'الشحنات الجاهزة للفوترة وحالة فواتير العملاء',
    section: 'finance', group: 'finance_work', order: 30, visible: true,
  },
  hub: {
    label: 'الناقلون والتكاليف',
    description: 'ملف الناقل وعقوده وفواتيره وفروق التكلفة',
    section: 'finance', group: 'finance_work', order: 40, visible: true,
  },
  money: {
    label: 'الدفع عند الاستلام والتسويات',
    description: 'COD لدى الناقلين ومستحقاتهم والتسويات والتحويلات',
    section: 'finance', group: 'finance_work', order: 50, visible: true,
  },
  bank: {
    label: 'البنوك والمطابقات',
    description: 'الأرصدة والكشوف والعمليات غير المطابقة',
    section: 'finance', group: 'finance_work', order: 60, visible: true,
  },
  'accounting-cycle': {
    label: 'الإقفال المحاسبي',
    description: 'مسار الإقفال الشهري ومراجعة Zoho والعوائق',
    section: 'finance', group: 'finance_work', order: 70, visible: true,
  },
  reports: {
    label: 'التقارير والرقابة',
    description: 'الربحية وقائمة الدخل وجودة البيانات',
    section: 'finance', group: 'finance_work', order: 80, visible: true,
  },

  'sales-hub': {
    label: 'الفرص من بيانات المنصة',
    section: 'sales', group: 'sales_work', order: 10, visible: true,
  },
  crm: {
    label: 'مسار المبيعات والصفقات',
    section: 'sales', group: 'sales_work', order: 20, visible: true,
  },
  'whatsapp-settings': {
    label: 'الحملات والاتصالات',
    section: 'sales', group: 'sales_work', order: 30, visible: true,
  },
  marketers: {
    label: 'المسوّقون والعمولات',
    section: 'sales', group: 'sales_work', order: 40, visible: true,
  },

  support: {
    label: 'التذاكر وخدمة العملاء',
    section: 'support', group: 'support_work', order: 10, visible: true,
  },

  employees: {
    label: 'الفريق والصلاحيات',
    section: 'admin', group: 'admin_work', order: 10, visible: true,
  },
  operations: {
    label: 'التكاملات',
    description: 'Zoho ولمحة وتحصيل وهاتف وIVR من مركز تشغيل واحد',
    section: 'admin', group: 'admin_work', order: 20, visible: true,
  },
  'hatif-settings': {
    label: 'القنوات وهاتف',
    section: 'admin', group: 'admin_work', order: 30, visible: true,
  },
  'work-agents': {
    label: 'وكلاء العمل والأتمتة',
    section: 'admin', group: 'admin_work', order: 40, visible: true,
  },
  'app-settings': {
    label: 'إعدادات النظام',
    section: 'admin', group: 'admin_work', order: 50, visible: true,
  },
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
      ...(ia?.pinned != null ? { pinned: ia.pinned } : {}),
      navHidden: ia?.visible !== true,
    };
  });
}

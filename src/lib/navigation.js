// نقطة الحقيقة لهندسة المعلومات الظاهرة للمستخدم.
// تعريف المسار والصلاحية يبقى في App لأنه مرتبط بتركيب الصفحات، أما قرار
// الظهور والقسم والترتيب والمسمى فيؤخذ حصراً من هذا الملف.
export const NAV_SECTIONS = [
  { id: 'customers', path: '/workspace/customers',  label: 'العملاء',  icon: 'Users',      hint: 'الملف الموحد والمخاطر' },
  { id: 'sales',     path: '/workspace/sales',      label: 'المبيعات', icon: 'Target',     hint: 'الفرص والمتابعة والنمو' },
  { id: 'campaigns', path: '/workspace/campaigns',  label: 'الحملات',  icon: 'MessageCircle', hint: 'الجمهور والإطلاق والنتائج' },
  { id: 'finance',   path: '/workspace/finance',    label: 'المالية',  icon: 'DollarSign', hint: 'الذمم والتحصيل والبنوك' },
  { id: 'shipping',  path: '/workspace/operations', label: 'التشغيل',  icon: 'Truck',      hint: 'الشحن والفوترة والدورة' },
  { id: 'reports',   path: '/workspace/reports',    label: 'التقارير', icon: 'FileCheck',  hint: 'المؤشرات والتحليلات' },
  { id: 'settings',  path: '/workspace/admin',      label: 'الإدارة',  icon: 'Settings',   hint: 'الفريق والعقود والتكاملات' },
];

export const CENTER_PATHS = Object.fromEntries(NAV_SECTIONS.map(section => [section.id, section.path]));

const normalizeWorkspacePath = route => {
  const raw = String(route || '/').split(/[?#]/, 1)[0];
  return raw.replace(/\/+$/, '') || '/';
};

/**
 * Canonical workspace ownership for a route. Query parameters never influence
 * ownership; they only preserve the caller's result-set context.
 */
export function resolveWorkspace(route, navigationItems = []) {
  const pathname = normalizeWorkspacePath(route);
  const center = NAV_SECTIONS.find(section => normalizeWorkspacePath(section.path) === pathname);
  if (center) return center.id;

  const item = navigationItems.find(entry => (
    normalizeWorkspacePath(entry.path) === pathname
    || entry.subTabs?.some(tab => normalizeWorkspacePath(tab.legacy) === pathname)
  ));
  return item?.section || null;
}

export function resolveSavedWorkspaceRoute({ requestedWorkspace, fallbackPath, savedRoute, navigationItems = [] }) {
  if (typeof savedRoute !== 'string' || !savedRoute.startsWith('/')) return fallbackPath;
  const savedUrl = new URL(savedRoute, 'https://shipaudit.local');
  return resolveWorkspace(savedUrl.pathname, navigationItems) === requestedWorkspace
    ? `${savedUrl.pathname}${savedUrl.search}${savedUrl.hash}`
    : fallbackPath;
}

// بطاقات صفحات المراكز. كل بطاقة تمثل مساحة عمل كاملة، لا
// تبويباً داخلياً. memberIds تُستخدم فقط لاشتقاق الصلاحية والأيقونة ومسار
// الدخول الآمن؛ المسارات الأصلية تظل فعالة ولا يعاد تعريفها هنا.
export const CENTER_WORKSPACES = {
  customers: [
    {
      id: 'directory', label: 'العملاء والمتاجر', entryId: 'customer-watch', memberIds: ['customer-watch'],
      path: '/workspace/customers',
      description: 'راقب قاعدة العملاء والحالات المهمة، ثم افتح Customer 360 عند الحاجة.',
    },
  ],
  sales: [
    {
      id: 'lamha-growth', label: 'مركز المبيعات', entryId: 'sales-hub', memberIds: ['sales-hub'], path: '/workspace/sales',
      subTabIds: ['overview', 'pipeline', 'external', 'today', 'retargeting', 'segments'],
      description: 'مسار واحد للنمو والفرص والمتابعة والشرائح؛ تفاصيل العميل تعود دائمًا إلى Customer 360.',
    },
  ],
  campaigns: [
    {
      id: 'campaigns', label: 'مساحة الحملات', entryId: 'campaign-center', memberIds: ['campaign-center'], path: '/workspace/campaigns',
      description: 'ابنِ الجمهور وراجع الحماية ثم أطلق القناة وتابع النتيجة من مسار واحد.',
    },
    {
      id: 'performance', label: 'النتائج والقنوات', entryId: 'whatsapp-settings', memberIds: ['whatsapp-settings'], path: '/whatsapp-settings?tab=campaigns&source=campaigns-workspace',
      description: 'نتائج الرسائل والمكالمات وجودة القنوات وأثر التواصل من سجل واحد.',
    },
  ],
  finance: [
    {
      id: 'customer-finance', label: 'مركز العملاء المالي', entryId: 'collections-hub', memberIds: ['collections-hub'],
      description: 'مال العملاء ونشاطهم ومطابقة أرصدتهم وإجراءات التحصيل والتواصل من مكان واحد.',
    },
    {
      id: 'cash-settlements', label: 'النقد والتسويات', entryId: 'money', memberIds: ['money'],
      description: 'البنوك والمدفوعات والعمليات غير المصنفة، مع تصفية COD التاريخية حتى الصفر.',
    },
    {
      id: 'accounting', label: 'الحسابات والمطابقة', entryId: 'reconciliation', memberIds: ['reconciliation', 'zoho-data'], path: '/reconciliation?tab=customers',
      description: 'طابق أرصدة العملاء بين فواتير Zoho المفتوحة وآخر استحقاق لمحة، ثم راجع الفروقات.',
    },
    {
      id: 'planning', label: 'الربحية والسيولة', entryId: 'pnl', memberIds: ['pnl', 'cash-aging', 'forecast', 'periods'],
      description: 'قائمة الدخل وأعمار النقد والتوقعات، مع الإقفال كإجراء مستقل.',
    },
  ],
  shipping: [
    {
      id: 'carrier-control', label: 'شركات الشحن', entryId: 'hub', memberIds: ['hub'],
      description: 'اختر شركة الشحن وافتح ملفها الموحد للفواتير والشحنات والمطالبات والحساب والعقد والأداء.',
    },
    {
      id: 'exceptions', label: 'المهام والاستثناءات', entryId: 'tasks', memberIds: ['tasks', 'audits'],
      description: 'المهام المتأخرة والاستثناءات التي تحتاج قرارًا أو متابعة.',
    },
    {
      id: 'accounting-cycle', label: 'دورة الشهر', entryId: 'accounting-cycle', memberIds: ['accounting-cycle'],
      description: 'نفّذ مراحل الشهر من المراجعات حتى اكتمال المصادر والإقفال التشغيلي.',
    },
    {
      id: 'service-billing', label: 'فوترة الخدمات والأوزان', entryId: 'fulfillment', memberIds: ['fulfillment', 'weight-billing'], path: '/fulfillment',
      description: 'راجع فوترة خدمات التجهيز والأوزان الزائدة في عروض مستقلة.',
    },
  ],
  reports: [
    {
      id: 'reports-workspace', label: 'مركز التقارير والتحليلات', entryId: 'reports',
      memberIds: ['reports', 'monthly-report', 'internal-exports'], path: '/workspace/reports',
      subTabIds: ['index', 'builder', 'monthly', 'exports'],
      description: 'اكتشف التقارير حسب المجال ثم افتح التحليل أو التصدير مع بقاء الفلاتر والسياق.',
    },
  ],
  settings: [
    {
      id: 'admin-workspace', label: 'مركز الإدارة والإعدادات', entryId: 'admin-workspace', memberIds: ['admin-workspace'], path: '/workspace/admin',
      description: 'المستخدمون والوصول والتكاملات والعقود وصحة النظام، مع عزل الأدوات المتقدمة عن العمل اليومي.',
    },
  ],
};

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
    { id: 'customer_ops', label: 'ملفات العملاء' },
  ],
  sales: [
    { id: 'sales_ops', label: 'الفرص والصفقات' },
    { id: 'outreach_ops', label: 'التواصل والنمو' },
  ],
  campaigns: [
    { id: 'campaign_ops', label: 'الجمهور والتشغيل' },
    { id: 'campaign_insights', label: 'النتائج والقنوات' },
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

  hub:                 { label: 'شركات الشحن', section: 'shipping', group: 'carrier_ops', order: 10, visible: true },
  'platform-carriers': { label: 'مقارنة أسعار المنصات', section: 'reports', group: 'report_ops', order: 25, visible: true },
  tasks:               { label: 'مهام شركات الشحن', section: 'shipping', group: 'carrier_ops', order: 30, visible: true },
  'accounting-cycle':  { label: 'الدورة المحاسبية الشهرية', section: 'shipping', group: 'monthly_cycle', order: 40, visible: true },
  drop:                { label: 'رفع ملفات الناقلين', section: 'shipping', group: 'invoice_ops', order: 50, visible: true },
  audits:              { label: 'مراجعات فواتير الناقلين', section: 'shipping', group: 'invoice_ops', order: 60, visible: true },
  'aramex-stmt':       { label: 'كشوف الناقلين', section: 'shipping', group: 'invoice_ops', order: 70, visible: true },
  ledger:              { label: 'دفتر حساب الناقلين', section: 'shipping', group: 'invoice_ops', order: 80, visible: true },
  fulfillment:         { label: 'فوترة خدمات العملاء', section: 'shipping', group: 'service_ops', order: 90, visible: true },
  'weight-billing':    { label: 'فوترة الأوزان الزائدة', section: 'shipping', group: 'service_ops', order: 100, visible: true },

  'customer-watch':    { label: 'العملاء والمتاجر', section: 'customers', group: 'customer_ops', order: 10, visible: true },

  'sales-hub':         { label: 'فرص البيع من بيانات المنصة', section: 'sales', group: 'sales_ops', order: 10, visible: true },
  // مسارات متقاعدة: تبقى Redirects للتوافق ولا تظهر كبطاقات أو وجهات.
  crm:                 { label: 'إدارة المبيعات', section: 'sales', group: 'sales_ops', order: 20, visible: false },
  'campaign-center':   { label: 'مركز الحملات', section: 'campaigns', group: 'campaign_ops', order: 10, visible: true },
  'whatsapp-settings': { label: 'أداء القنوات والاتصالات', section: 'campaigns', group: 'campaign_insights', order: 20, visible: true },
  marketers:           { label: 'المسوّقون والعمولات', section: 'sales', group: 'outreach_ops', order: 40, visible: false },

  'collections-hub':   { label: 'تحصيل العملاء', section: 'finance', group: 'receivables_ops', order: 10, visible: true },
  money:               { label: 'النقد والتسويات', section: 'finance', group: 'cash_ops', order: 20, visible: true },
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
  'admin-workspace':   { label: 'مركز الإدارة والإعدادات', section: 'settings', group: 'team_ops', order: 10, visible: true },
  employees:           { label: 'الفريق والصلاحيات', section: 'settings', group: 'team_ops', order: 20, visible: false },
  carriers:            { label: 'شركات الشحن', section: 'settings', group: 'shipping_settings', order: 30, visible: false },
  contracts:           { label: 'العقود والأسعار', section: 'settings', group: 'shipping_settings', order: 40, visible: false },
  operations:          { label: 'مركز التكاملات', section: 'settings', group: 'integration_settings', order: 50, visible: false },
  uploads:             { label: 'رفع ومزامنة ملفات لمحة', section: 'settings', group: 'integration_settings', order: 60, visible: false },
  webhook:             { label: 'وارد التكاملات', section: 'settings', group: 'integration_settings', order: 70, visible: false },
  integrity:           { label: 'سلامة البيانات', section: 'settings', group: 'integration_settings', order: 80, visible: false },
  'work-agents':       { label: 'مركز الأتمتة', section: 'settings', group: 'integration_settings', order: 90, visible: false },
  'hatif-settings':    { label: 'إعدادات هاتف وIVR', section: 'settings', group: 'integration_settings', order: 100, visible: false },
  'activity-log':      { label: 'سجل النظام', section: 'settings', group: 'system_settings', order: 110, visible: false },
  'app-settings':      { label: 'إعدادات النظام', section: 'settings', group: 'system_settings', order: 120, visible: false },
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

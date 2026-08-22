// نقطة الحقيقة لهندسة المعلومات الظاهرة للمستخدم.
// تعريف المسار والصلاحية يبقى في App لأنه مرتبط بتركيب الصفحات، أما قرار
// الظهور والقسم والترتيب والمسمى فيؤخذ حصراً من هذا الملف.
export const NAV_SECTIONS = [
  { id: 'finance',   path: '/workspace/finance',    label: 'المالية',  icon: 'DollarSign', accent: '#F59E0B', hint: 'مال العملاء · التحصيل · المطابقة' },
  { id: 'customers', path: '/workspace/customers',  label: 'العملاء',  icon: 'Users',      accent: '#EF4444', hint: 'الملف الموحد · الخدمة · حالة العميل' },
  { id: 'sales',     path: '/workspace/sales',      label: 'المبيعات', icon: 'Target',     accent: '#8B5CF6', hint: 'نمو عملاء لمحة · العملاء المحتملون · التواصل' },
  { id: 'shipping',  path: '/workspace/operations', label: 'التشغيل',  icon: 'Truck',      accent: '#2B68DE', hint: 'الشحن · الفوترة · الدورة الشهرية' },
  { id: 'reports',   path: '/workspace/reports',    label: 'التقارير', icon: 'FileCheck',  accent: '#22C55E', hint: 'المؤشرات · الرقابة · الأتمتة' },
  { id: 'settings',  path: '/workspace/admin',      label: 'الإدارة',  icon: 'Settings',   accent: '#31D5E1', hint: 'الفريق · العقود · التكاملات' },
];

export const CENTER_PATHS = Object.fromEntries(NAV_SECTIONS.map(section => [section.id, section.path]));

// بطاقات صفحات المراكز. كل بطاقة تمثل مساحة عمل كاملة، لا
// تبويباً داخلياً. memberIds تُستخدم فقط لاشتقاق الصلاحية والأيقونة ومسار
// الدخول الآمن؛ المسارات الأصلية تظل فعالة ولا يعاد تعريفها هنا.
export const CENTER_WORKSPACES = {
  customers: [
    {
      id: 'directory', label: 'دليل العملاء والمتاجر', entryId: 'customer-watch', memberIds: ['customer-watch'],
      description: 'ابحث عن العميل أو المتجر، ثم افتح صفحة Customer 360 الموحدة.',
    },
  ],
  sales: [
    {
      id: 'lamha-growth', label: 'نمو عملاء لمحة', entryId: 'sales-hub', memberIds: ['sales-hub'], path: '/retargeting?view=activation',
      subTabIds: ['today', 'activation', 'pipeline', 'retargeting', 'hatif', 'segments'],
      description: 'النشطون والداخلون والخارجون والشرائح، مع انتقال مباشر إلى عمل اليوم.',
    },
    {
      id: 'external', label: 'العملاء خارج المنصة', entryId: 'sales-hub', memberIds: ['sales-hub'], path: '/retargeting?view=external',
      subTabIds: ['external'],
      description: 'العملاء المحتملون والحملات التسويقية قبل دخولهم إلى لمحة.',
    },
    {
      id: 'communications', label: 'التواصل', entryId: 'whatsapp-settings', memberIds: ['whatsapp-settings'], path: '/whatsapp-settings?tab=overview',
      description: 'راقب الرسائل والمكالمات وIVR وجودة التواصل ونتائجه.',
    },
    {
      id: 'campaigns', label: 'مركز الحملات الذكي', entryId: 'campaign-center', memberIds: ['campaign-center'], path: '/campaigns',
      description: 'أنشئ الجمهور وراجع الحماية واختر القناة قبل إطلاق الحملة.',
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
      id: 'accounting', label: 'الحسابات والمطابقة', entryId: 'zoho-data', memberIds: ['zoho-data', 'reconciliation'], path: '/zoho-data?tab=customers',
      description: 'بيانات Zoho وربط الحسابات ومطابقة أرصدة العملاء والناقلين.',
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
      id: 'library', label: 'مكتبة التقارير', entryId: 'reports', memberIds: ['reports'], path: '/reports',
      description: 'التقارير الرسمية والشهرية ومعاملات التصدير.',
    },
    {
      id: 'carrier-performance', label: 'أداء شركات الشحن', entryId: 'hub', memberIds: ['hub', 'platform-carriers'], path: '/carrier-kpi?source=reports',
      skipSubTabs: true,
      description: 'مقارنة أداء الناقلين والأسعار على مستوى جميع الشركات.',
    },
    {
      id: 'communications-performance', label: 'التواصل والحملات', entryId: 'whatsapp-settings', memberIds: ['whatsapp-settings'], path: '/whatsapp-settings?tab=impact&source=reports',
      skipSubTabs: true,
      description: 'أثر الحملات ونشاط الفريق وجودة التواصل.',
    },
    {
      id: 'exports', label: 'الملفات المصدّرة', entryId: 'internal-exports', memberIds: ['internal-exports'], path: '/internal-exports',
      description: 'أرشيف الملفات الناتجة وإعادة تنزيلها من مصدرها.',
    },
  ],
  settings: [
    {
      id: 'team', label: 'الفريق والصلاحيات', entryId: 'employees', memberIds: ['employees'],
      description: 'أدر الموظفين وأدوارهم وصلاحياتهم من المسار الإداري المعتمد.',
    },
    {
      id: 'carrier-config', label: 'شركات الشحن والعقود', entryId: 'carriers', memberIds: ['carriers', 'contracts'], path: '/carriers',
      description: 'إعداد شركات الشحن والعقود والأسعار مع إبقاء كل سجل في عرضه.',
    },
    {
      id: 'integrations', label: 'التكاملات ومصادر البيانات', entryId: 'operations', memberIds: ['operations'], path: '/operations',
      description: 'راقب التكاملات والمصادر وWebhooks من مساحة إدارية واحدة.',
    },
    {
      id: 'automation', label: 'الأتمتة ووكلاء العمل', entryId: 'work-agents', memberIds: ['work-agents'], path: '/work-agents',
      description: 'حالة الوكلاء وتشغيلاتهم وآخر نتائج الأتمتة.',
    },
    {
      id: 'channels', label: 'القنوات والاتصال', entryId: 'hatif-settings', memberIds: ['hatif-settings'], path: '/settings/hatif',
      description: 'إعدادات هاتف وIVR والقنوات المصرح بها.',
    },
    {
      id: 'system-config', label: 'إعدادات النظام', entryId: 'app-settings', memberIds: ['app-settings'], path: '/settings/ai',
      subTabIds: ['ai', 'data'],
      description: 'إعدادات النظام والذكاء الاصطناعي والبيانات العامة.',
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

  'customer-watch':    { label: 'دليل العملاء والمتاجر', section: 'customers', group: 'customer_ops', order: 10, visible: true },

  'sales-hub':         { label: 'فرص البيع من بيانات المنصة', section: 'sales', group: 'sales_ops', order: 10, visible: true },
  // مسارات متقاعدة: تبقى Redirects للتوافق ولا تظهر كبطاقات أو وجهات.
  crm:                 { label: 'إدارة المبيعات', section: 'sales', group: 'sales_ops', order: 20, visible: false },
  'campaign-center':   { label: 'مركز الحملات الذكي', section: 'sales', group: 'outreach_ops', order: 25, visible: true },
  'whatsapp-settings': { label: 'الحملات والاتصالات', section: 'sales', group: 'outreach_ops', order: 30, visible: true },
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
  integrity:           { label: 'سلامة البيانات', section: 'settings', group: 'integration_settings', order: 65, visible: true },
  'activity-log':      { label: 'سجل النظام', section: 'settings', group: 'system_settings', order: 95, visible: true },

  employees:           { label: 'الفريق والصلاحيات', section: 'settings', group: 'team_ops', order: 10, visible: true },
  carriers:            { label: 'شركات الشحن', section: 'settings', group: 'shipping_settings', order: 20, visible: true },
  contracts:           { label: 'العقود والأسعار', section: 'settings', group: 'shipping_settings', order: 30, visible: true },
  operations:          { label: 'مركز التكاملات', section: 'settings', group: 'integration_settings', order: 40, visible: true },
  uploads:             { label: 'رفع ومزامنة ملفات لمحة', section: 'settings', group: 'integration_settings', order: 50, visible: true },
  webhook:             { label: 'وارد التكاملات', section: 'settings', group: 'integration_settings', order: 60, visible: true },
  'work-agents':       { label: 'وكلاء العمل', section: 'settings', group: 'integration_settings', order: 70, visible: true },
  'hatif-settings':    { label: 'إعدادات هاتف وIVR', section: 'settings', group: 'integration_settings', order: 80, visible: true },
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

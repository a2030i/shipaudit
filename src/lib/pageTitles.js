// pageTitles — خريطة «مسار → اسم الصفحة» الواحدة (كانت داخل App.jsx).
// تُستخدم في: عنوان الشريط العلوي (App) + سجل تحركات الموظفين (EmployeeManager).
// أي صفحة جديدة تُضاف هنا مرة واحدة فيظهر اسمها في كل المواضع.
export const PAGE_TITLES = {
  '/overview':          'الرئيسية',
  '/decisions':         'لوحة القرارات',
  '/crm':               'الصفقات والمتابعات',
  '/next-actions':      'خطة المبيعات اليوم',
  '/fulfillment':       'فواتير التجهيز',
  '/monthly-report':    'التقرير الشهري',
  '/reports':           'مكتبة التقارير',
  '/zoho-callback':     'ربط زوهو',
  '/pnl':               'الأرباح والخسائر',
  '/zoho-data':         'بيانات زوهو',
  '/customer-money':    'الديون والتحصيل',
  '/legal':             'التصعيد القانوني',
  '/retargeting':       'فرص البيع',
  '/whatsapp-settings': 'حملات واتساب',
  '/hatif-leads':       'مرجع طلبات هاتف',
  '/support':           'خدمة العملاء',
  '/ticket':            'تذكرة دعم جديدة',
  '/uploads':           'حالة مصادر البيانات',
  '/hub':               'حالة الشركات',
  '/carrier':           'بروفايل الشركة',
  '/webhook':           'وارد الفواتير',
  '/customers':         'ملفات العملاء',
  '/payment-requests':  'طلبات السداد',
  '/internal-exports':  'التصدير وسجل الملفات',
  '/upload':            'مراجعة جديدة',
  '/drop':              'رفع ملف',
  '/cash-aging':        'أعمار الديون',
  '/integrity':         'سلامة البيانات',
  '/claims':            'المطالبات',
  '/audits':            'تدقيق الفواتير',
  '/weight-billing':    'فوترة الأوزان الزائدة',
  '/ledger':            'حسابات الشركات',
  '/cod-settlements':   'تسويات الدفع عند الاستلام',
  '/money':             'البنك والمدفوعات',
  '/payments':          'الدفعات',
  '/aramex-statements': 'كشوف حساب الشركات',
  '/bank':              'كشف البنك',
  '/receivables':       'مديونيات العملاء',
  '/customer-360':      'ملفات العملاء',
  '/collections':       'مهام التحصيل',
  '/merchants':         'متاجر المنصّة',
  '/reconciliation':    'مطابقة زوهو مع لمحة',
  '/segments':          'مجموعات العملاء',
  '/carriers':          'إدارة الشركات',
  '/contracts':         'جدول العقود',
  '/carrier-kpi':       'أداء الشركات',
  '/activity-log':      'سجل النشاط',
  '/tasks':             'المهام',
  '/periods':           'إقفال الشهور',
  '/forecast':          'توقّع السيولة',
  '/employees':         'الموظفون',
  '/settings/ai':       'الإعدادات — الذكاء الاصطناعي',
  '/settings/data':     'الإعدادات — البيانات',
  '/results':           'نتائج التدقيق',
};

// اسم الصفحة من المسار (يتجاهل query string) — الغريب يُعاد كما هو
export function pageTitle(path) {
  if (!path) return '';
  const clean = String(path).split('?')[0];
  if (PAGE_TITLES[clean]) return PAGE_TITLES[clean];
  if (clean.startsWith('/settings')) return 'الإعدادات';
  if (clean === '/') return 'الرئيسية';
  return clean;
}

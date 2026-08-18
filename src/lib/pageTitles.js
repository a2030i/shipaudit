// pageTitles — خريطة «مسار → اسم الصفحة» الواحدة (كانت داخل App.jsx).
// تُستخدم في: عنوان الشريط العلوي (App) + سجل تحركات الموظفين (EmployeeManager).
// أي صفحة جديدة تُضاف هنا مرة واحدة فيظهر اسمها في كل المواضع.
export const PAGE_TITLES = {
  '/overview':          'الرئيسية',
  '/decisions':         'مهام وقرارات اليوم',
  '/work-agents':       'وكلاء العمل',
  '/operations':        'التكاملات',
  '/accounting-cycle':  'دورة تشغيل المحاسب',
  '/crm':               'إدارة المبيعات',
  '/next-actions':      'خطة المبيعات اليوم',
  '/fulfillment':       'فوترة الخدمات',
  '/monthly-report':    'التقرير الشهري',
  '/reports':           'التقارير',
  '/zoho-callback':     'ربط زوهو',
  '/pnl':               'قائمة الدخل والربحية',
  '/zoho-data':         'زوهو والحسابات',
  '/customer-money':    'تحصيل العملاء',
  '/legal':             'التصعيد القانوني',
  '/retargeting':       'فرص البيع من بيانات المنصة',
  '/campaigns':         'مركز الحملات الذكي',
  '/whatsapp-settings': 'الحملات والاتصالات',
  '/hatif-leads':       'مرجع طلبات هاتف',
  '/support':           'خدمة العملاء',
  '/marketers':         'المسوّقون والعمولات',
  '/ticket':            'تذكرة دعم جديدة',
  '/uploads':           'مزامنة مصادر البيانات',
  '/hub':               'مركز شركات الشحن',
  '/carrier':           'بروفايل الشركة',
  '/webhook':           'وارد التكاملات',
  '/customers':         'ملفات العملاء',
  '/payment-requests':  'طلبات السداد',
  '/internal-exports':  'التصدير وسجل الملفات',
  '/upload':            'مراجعة جديدة',
  '/drop':              'الرفع والوارد',
  '/cash-aging':        'أعمار التحصيل والسداد',
  '/integrity':         'سلامة البيانات',
  '/claims':            'المطالبات',
  '/audits':            'تدقيق الفواتير',
  '/weight-billing':    'فوترة الأوزان الزائدة',
  '/ledger':            'حسابات الشركات',
  '/cod-settlements':   'تسويات الدفع عند الاستلام',
  '/money':             'النقد والتسويات',
  '/payments':          'الدفعات',
  '/aramex-statements': 'كشوف حساب الشركات',
  '/bank':              'كشف البنك',
  '/receivables':       'مديونيات العملاء',
  '/customer-360':      'دليل العملاء والمتاجر',
  '/collections':       'مهام التحصيل',
  '/merchants':         'متاجر المنصّة',
  '/reconciliation':    'مطابقة الحسابات مع زوهو',
  '/segments':          'مجموعات العملاء',
  '/carriers':          'شركات الشحن',
  '/contracts':         'العقود والأسعار',
  '/carrier-kpi':       'أداء الشركات',
  '/activity-log':      'سجل النشاط',
  '/tasks':             'المهام',
  '/periods':           'إقفال الشهور',
  '/forecast':          'توقّع السيولة',
  '/employees':         'الفريق والصلاحيات',
  '/settings/ai':       'التكاملات والذكاء الاصطناعي',
  '/settings/data':     'البيانات والتكاملات',
  '/settings/hatif':    'إعدادات هاتف',
  '/platform-carriers': 'مقارنة أسعار المنصّات',
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

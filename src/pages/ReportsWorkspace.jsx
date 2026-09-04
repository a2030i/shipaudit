import { lazy, Suspense, useMemo } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowUpLeft, FileBarChart } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import {
  Button, DataTable, FilterBar, LoadingState, Page, PageHeader, SearchInput, SelectInput, StatusBadge,
} from '../design-system/EnterpriseUI.jsx';
import ReportsWorkspaceNav, { REPORT_WORKSPACE_VIEWS } from '../components/enterprise/ReportsWorkspaceNav.jsx';
import './ReportsWorkspace.css';

const ReportsCenter = lazy(() => import('./ReportsCenter.jsx'));
const MonthlyReport = lazy(() => import('./MonthlyReport.jsx'));
const InternalExports = lazy(() => import('./InternalExports.jsx'));

const DOMAIN_LABELS = {
  executive: 'تنفيذي', customers: 'العملاء', sales: 'المبيعات', finance: 'المالية',
  operations: 'التشغيل', carriers: 'الناقلون', campaigns: 'الحملات', archive: 'الأرشيف',
};

const REPORT_CATALOG = [
  { id: 'official', title: 'مولّد التقارير الرسمية', description: 'التقارير التشغيلية والمالية المصرح بها، ومنها VAT وقائمة الدخل وكشف الناقل والمطابقة.', domain: 'finance', source: 'Zoho Books + report exporters', internalView: 'builder', any: ['reports.view_financial', 'reports.view_bank_reconciliation', 'reports.view_operational'] },
  { id: 'monthly', title: 'التقرير الشهري للناقلين', description: 'المفوتر والتحصيل والمدفوعات وصافي الحركة وجودة التدقيق حسب الشهر.', domain: 'operations', source: 'monthlyReportService', internalView: 'monthly', any: ['reports.view_operational'] },
  { id: 'customer-receivables', title: 'ذمم العملاء والتحصيل', description: 'الأرصدة المحاسبية والتشغيلية والأعمار والـdrill-down إلى العميل والفاتورة.', domain: 'customers', source: 'customer money read models', path: '/customer-money?view=money&source=reports', any: ['receivables.view'] },
  { id: 'sales-pipeline', title: 'مسار المبيعات', description: 'الحالات والشرائح والإسناد وآخر نشاط وشحنة من نفس Pipeline.', domain: 'sales', source: 'retargetingService', path: '/workspace/sales?view=pipeline&source=reports', any: ['sales.view'] },
  { id: 'sales-activation', title: 'تفعيل ونمو المتاجر', description: 'الدخول والخروج والحركة الصافية من مصدر نمو العملاء الحالي.', domain: 'sales', source: 'customer growth snapshot', path: '/workspace/sales?view=overview&source=reports', any: ['sales.view', 'merchants.view'] },
  { id: 'pnl', title: 'قائمة الدخل والربحية', description: 'الربح الفعلي وVAT حسب فترة Zoho المحددة.', domain: 'finance', source: 'zohoReportsService', path: '/pnl?source=reports', any: ['money.pnl'] },
  { id: 'cash-aging', title: 'أعمار التحصيل والسداد', description: 'فصل أعمار العملاء والناقلين مع القيم والفئات الحالية.', domain: 'finance', source: 'cashAgingService', path: '/cash-aging?source=reports', any: ['ledger.view'] },
  { id: 'forecast', title: 'توقع السيولة', description: 'الداخل والخارج والرصيد المتوقع ضمن الأفق المختار.', domain: 'finance', source: 'forecastService', path: '/forecast?source=reports', any: ['forecast.view'] },
  { id: 'reconciliation', title: 'مطابقة الحسابات مع Zoho', description: 'الفروق والحالات وResult Sets من منطق المطابقة الحالي.', domain: 'finance', source: 'reconciliation read model', path: '/reconciliation?source=reports', any: ['reconciliation.view'] },
  { id: 'carrier-performance', title: 'أداء شركات الشحن', description: 'التغطية والفروقات والنزاعات والسداد والتقييم الموحد لكل ناقل.', domain: 'carriers', source: 'carrierStatementsService + carrierScore', path: '/carrier-kpi?source=reports', any: ['carriers.view'] },
  { id: 'platform-prices', title: 'مقارنة أسعار المنصات', description: 'أسعار لمحة وأوتو وطرود والتكلفة والربح دون إعادة تعريف المقارنة.', domain: 'carriers', source: 'platformCarriersService', path: '/platform-carriers?source=reports', any: ['carriers.view'] },
  { id: 'campaign-impact', title: 'أثر الحملات والقنوات', description: 'سجل الإرسال والردود والنتائج من مصدر القنوات الحالي.', domain: 'campaigns', source: 'WhatsApp / IVR logs', path: '/whatsapp-settings?tab=impact&source=reports', any: ['whatsapp.view_log', 'campaigns.ivr'] },
  { id: 'campaign-history', title: 'نتائج وسجل الحملات', description: 'الحملات التاريخية وحالاتها وجمهورها ونتائجها المخزنة.', domain: 'campaigns', source: 'smartCampaignService', path: '/workspace/campaigns?view=results&source=reports', any: ['campaigns.send', 'campaigns.ivr', 'whatsapp.view_log'] },
  { id: 'exports', title: 'أرشيف الملفات المصدّرة', description: 'إعادة تنزيل الملف المحفوظ نفسه وتتبع النوع والتاريخ وعدد الصفوف.', domain: 'archive', source: 'internalExportsService', internalView: 'exports', any: ['internal_exports.view'] },
];

const viewFor = value => REPORT_WORKSPACE_VIEWS.some(item => item.id === value) ? value : 'index';

export default function ReportsWorkspace({ carriers = [], isActive = true }) {
  const { profile, can } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isAdmin = profile?.role === 'admin';
  const activeView = viewFor(searchParams.get('view') || 'index');
  const query = searchParams.get('q') || '';
  const domain = searchParams.get('domain') || 'all';
  const allowed = item => isAdmin || item.any?.some(permission => can(permission));
  const visibleCatalog = useMemo(() => REPORT_CATALOG.filter(allowed), [isAdmin, can]);
  const domains = useMemo(() => [...new Set(visibleCatalog.map(report => report.domain))], [visibleCatalog]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ar');
    return visibleCatalog.filter(report => (domain === 'all' || report.domain === domain)
      && (!needle || `${report.title} ${report.description} ${report.source} ${DOMAIN_LABELS[report.domain]}`.toLocaleLowerCase('ar').includes(needle)));
  }, [visibleCatalog, domain, query]);
  const navItems = REPORT_WORKSPACE_VIEWS.filter(item => item.id === 'index'
    || (item.id === 'builder' && visibleCatalog.some(report => report.internalView === 'builder'))
    || (item.id === 'monthly' && visibleCatalog.some(report => report.internalView === 'monthly'))
    || (item.id === 'exports' && visibleCatalog.some(report => report.internalView === 'exports')));
  const canBuildReport = visibleCatalog.some(report => report.internalView === 'builder');

  const updateParam = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (!value || value === 'all') next.delete(key); else next.set(key, value);
    setSearchParams(next, { replace: true });
  };
  const changeView = view => {
    const next = new URLSearchParams(searchParams);
    next.set('view', view);
    setSearchParams(next, { replace: false });
  };
  const openReport = report => {
    if (report.internalView) return changeView(report.internalView);
    const target = new URL(report.path, window.location.origin);
    target.searchParams.set('source', 'reports');
    target.searchParams.set('returnTo', `${location.pathname}${location.search}`);
    navigate(`${target.pathname}?${target.searchParams.toString()}`);
  };

  const columns = [
    { key: 'title', label: 'التقرير', className: 'mobile-identity', render: report => <div className="reports-index__identity"><strong>{report.title}</strong><small>{report.description}</small></div> },
    { key: 'domain', label: 'المجال', render: report => <StatusBadge tone="neutral" dot={false}>{DOMAIN_LABELS[report.domain]}</StatusBadge> },
    { key: 'source', label: 'المصدر', className: 'mobile-wide', render: report => <span className="reports-index__source">{report.source}</span> },
    { key: 'action', label: 'الوصول', render: report => <Button size="sm" icon={<ArrowUpLeft size={14}/>} onClick={() => openReport(report)}>فتح</Button> },
  ];

  return (
    <Page className="reports-workspace enterprise-workspace" aria-busy={!isActive || undefined}>
      {activeView === 'index' ? (
        <PageHeader
          title="التقارير والتحليلات"
          description="ابحث عن التقرير حسب القرار أو المجال، ثم افتحه في عرضه المخصص مع بقاء المصدر والفلاتر كما هي."
          actions={canBuildReport ? <Button variant="primary" icon={<FileBarChart size={15}/>} onClick={() => changeView('builder')}>تقرير رسمي</Button> : null}
        />
      ) : null}
      <ReportsWorkspaceNav active={activeView} items={navItems} onChange={changeView}/>

      {activeView === 'index' ? (
        <section className="reports-index" aria-label="دليل التقارير">
          <FilterBar>
            <SearchInput aria-label="البحث في التقارير" placeholder="اسم التقرير، المجال أو المصدر" value={query} onChange={event => updateParam('q', event.target.value)}/>
            <SelectInput aria-label="مجال التقرير" value={domain} onChange={event => updateParam('domain', event.target.value)}>
              <option value="all">كل المجالات ({visibleCatalog.length})</option>
              {domains.map(id => <option value={id} key={id}>{DOMAIN_LABELS[id]} ({visibleCatalog.filter(report => report.domain === id).length})</option>)}
            </SelectInput>
          </FilterBar>
          <DataTable
            caption="دليل التقارير المتاحة"
            columns={columns}
            rows={filtered}
            getRowKey={report => report.id}
            getRowLabel={report => `فتح تقرير ${report.title}`}
            onRowClick={openReport}
            empty="لا توجد تقارير تطابق البحث والفلاتر"
          />
        </section>
      ) : (
        <Suspense fallback={<LoadingState title="جارٍ تحميل التقرير…" description="تظل معادلات ومصادر التقرير في الوحدة المالكة له."/>}>
          <div className="reports-workspace__report" role="tabpanel" aria-label={navItems.find(item => item.id === activeView)?.label}>
            {activeView === 'builder' ? <ReportsCenter isActive={isActive}/> : null}
            {activeView === 'monthly' ? <MonthlyReport isActive={isActive}/> : null}
            {activeView === 'exports' ? <InternalExports carriers={carriers} isActive={isActive}/> : null}
          </div>
        </Suspense>
      )}
    </Page>
  );
}

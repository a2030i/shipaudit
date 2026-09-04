import { lazy, Suspense, useMemo } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowUpLeft, RefreshCw, ShieldCheck } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import {
  Alert, Button, DataTable, EmptyState, Page, PageHeader, StatStrip, StatusBadge, LoadingState,
} from '../design-system/EnterpriseUI.jsx';
import AdminWorkspaceNav, { ADMIN_WORKSPACE_VIEWS } from '../components/enterprise/AdminWorkspaceNav.jsx';
import './AdminWorkspace.css';

const EmployeeManager = lazy(() => import('./EmployeeManager.jsx'));
const OperationsCenter = lazy(() => import('./OperationsCenter.jsx'));

const ADMIN_AREAS = [
  {
    id: 'access', title: 'المستخدمون والصلاحيات', description: 'إدارة الفريق والأدوار والصلاحيات وسجل النشاط.',
    path: '/employees', any: ['system.manage_employees', 'system.manage_permissions'], adminOnly: true,
  },
  {
    id: 'integrations', title: 'التكاملات', description: 'حالة Zoho ولمحة وهاتف وWebhooks وإجراءات الاتصال المصرح بها.',
    path: '/operations', any: ['agents.view', 'system.view_audit_log', 'system.view_settings', 'uploads.view', 'zoho.view', 'whatsapp.view_log', 'whatsapp.configure', 'campaigns.ivr', 'webhook.view'],
  },
  {
    id: 'records', title: 'العقود والملفات', description: 'تعريف شركات الشحن والعقود والأسعار والمستندات.',
    path: '/contracts', any: ['carriers.view', 'carriers.edit_contract'],
  },
  {
    id: 'health', title: 'صحة النظام', description: 'سلامة المصادر والمهام المجدولة وسجل التدقيق.',
    path: '/integrity', any: ['system.view_audit_log'],
  },
  {
    id: 'advanced', title: 'أدوات متقدمة', description: 'المستكشفات الخام، الوكلاء، الوارد والأدوات الداخلية.',
    path: '/workspace/admin?view=advanced', any: ['agents.view', 'system.view_audit_log', 'system.view_settings', 'uploads.view', 'webhook.view'],
  },
];

const RECORD_ROWS = [
  { id: 'carriers', title: 'تعريف شركات الشحن', description: 'هوية الناقل وخصائصه التشغيلية وملف العقد.', path: '/carriers', any: ['carriers.view'], type: 'إعداد تشغيلي' },
  { id: 'contracts', title: 'العقود والأسعار', description: 'فترات السريان وقواعد التسعير ومستندات العقود.', path: '/contracts', any: ['carriers.edit_contract'], type: 'مرجع تعاقدي' },
  { id: 'uploads', title: 'مصادر وملفات البيانات', description: 'حداثة المصادر اليدوية والاستيرادات المسجلة.', path: '/uploads', any: ['uploads.view'], type: 'ملفات ومصادر' },
];

const HEALTH_ROWS = [
  { id: 'integrations', title: 'صحة التكاملات', description: 'حالة الاتصال وآخر أثر فعلي لكل مصدر.', path: '/operations', any: ['zoho.view', 'uploads.view', 'whatsapp.view_log', 'webhook.view'], state: 'يُقرأ حيًا', tone: 'info' },
  { id: 'integrity', title: 'سلامة البيانات والجدولة', description: 'المهام المجدولة وحداثة نتائجها والإصلاحات المتاحة.', path: '/integrity', any: ['system.view_audit_log'], state: 'تشخيص', tone: 'neutral' },
  { id: 'activity', title: 'سجل النظام', description: 'الدخول والتنقل والمحاولات الممنوعة والتغييرات المسجلة.', path: '/activity-log', any: ['system.view_audit_log'], state: 'للقراءة', tone: 'neutral' },
];

const ADVANCED_ROWS = [
  { id: 'uploads', title: 'مصادر البيانات والاستيراد', description: 'ملفات المصادر اليدوية وحالتها وتحققها.', path: '/uploads', any: ['uploads.view'], type: 'استيراد' },
  { id: 'webhook', title: 'وارد Webhooks', description: 'الأحداث الخام والملفات الواردة وحالات المعالجة.', path: '/webhook', any: ['webhook.view'], type: 'تشخيص تكامل' },
  { id: 'agents', title: 'مركز الأتمتة', description: 'تهيئة الوكلاء والمعاينات والتشغيلات المسجلة.', path: '/work-agents', any: ['agents.view'], type: 'أتمتة' },
  { id: 'activity', title: 'سجل النظام', description: 'أثر الاستخدام ومحاولات الوصول والتدقيق.', path: '/activity-log', any: ['system.view_audit_log'], type: 'تدقيق' },
  { id: 'settings', title: 'إعدادات النظام والبيانات', description: 'إعدادات الذكاء الاصطناعي والبيانات والتكاملات العامة.', path: '/settings/ai', any: ['system.view_settings'], type: 'إعداد متقدم' },
  { id: 'hatif', title: 'إعدادات هاتف وIVR', description: 'حالة الاتصال والقوالب والإعدادات المصرح بها.', path: '/settings/hatif', any: ['whatsapp.configure'], type: 'قناة خارجية' },
];

function viewAllowed(view, isAdmin, can) {
  if (view === 'access') return isAdmin;
  const area = ADMIN_AREAS.find(item => item.id === view);
  return view === 'overview' || isAdmin || area?.any?.some(permission => can(permission));
}

export default function AdminWorkspace({ isActive = true }) {
  const { profile, can } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isAdmin = profile?.role === 'admin';
  const requestedView = searchParams.get('view') || 'overview';
  const activeView = ADMIN_WORKSPACE_VIEWS.some(item => item.id === requestedView) && viewAllowed(requestedView, isAdmin, can)
    ? requestedView
    : 'overview';
  const visibleViews = ADMIN_WORKSPACE_VIEWS.filter(item => viewAllowed(item.id, isAdmin, can));
  const allowed = item => isAdmin || item.any?.some(permission => can(permission));
  const areas = useMemo(() => ADMIN_AREAS.filter(allowed), [isAdmin, can]);
  const records = useMemo(() => RECORD_ROWS.filter(allowed), [isAdmin, can]);
  const health = useMemo(() => HEALTH_ROWS.filter(allowed), [isAdmin, can]);
  const advanced = useMemo(() => ADVANCED_ROWS.filter(allowed), [isAdmin, can]);

  const changeView = view => {
    const next = new URLSearchParams(searchParams);
    if (view === 'overview') next.delete('view'); else next.set('view', view);
    setSearchParams(next, { replace: false });
  };
  const open = item => {
    const target = new URL(item.path, window.location.origin);
    target.searchParams.set('returnTo', `${location.pathname}${location.search}`);
    navigate(`${target.pathname}${target.search ? target.search : ''}${target.hash}`);
  };
  const commonColumns = [
    { key: 'title', label: 'الوجهة', className: 'mobile-identity', render: item => <div className="admin-workspace__identity"><strong>{item.title}</strong><small>{item.description}</small></div> },
    { key: 'type', label: 'النوع', render: item => <StatusBadge dot={false} tone="neutral">{item.type || 'مساحة إدارة'}</StatusBadge> },
    { key: 'access', label: 'الوصول', render: item => <Button size="sm" icon={<ArrowUpLeft size={14}/>} onClick={() => open(item)}>فتح</Button> },
  ];

  return (
    <Page className="admin-workspace enterprise-workspace" aria-busy={!isActive || undefined}>
      {activeView === 'overview' ? (
        <PageHeader
          title="الإدارة والإعدادات"
          description="المستخدمون والتكاملات والعقود وصحة النظام ضمن حدود واضحة، بينما تبقى الأدوات الخام في المستوى المتقدم."
          actions={areas.some(item => item.id === 'integrations') ? <Button variant="primary" icon={<RefreshCw size={15}/>} onClick={() => changeView('integrations')}>حالة التكاملات</Button> : null}
        />
      ) : null}
      <AdminWorkspaceNav active={activeView} items={visibleViews} onChange={changeView}/>

      {activeView === 'overview' ? <>
        <StatStrip items={[
          { label: 'المساحات المتاحة', value: areas.length, note: 'حسب صلاحيات الحساب' },
          { label: 'إعدادات يومية', value: areas.filter(item => ['access', 'integrations', 'records'].includes(item.id)).length, note: 'وصول وتشغيل وعقود' },
          { label: 'أدوات متقدمة', value: advanced.length, note: 'لا تظهر كتصفح يومي' },
          { label: 'نموذج الصلاحيات', value: 'ثابت', note: 'العرض لا يمنح صلاحية' },
        ]}/>
        <Alert tone="info" title="حدود هذه المساحة">
          حالة الاتصال لا تمنح صلاحية تنفيذ، والمعاينة لا تشغّل تكاملًا، وكل إجراء كتابة أو فصل أو حذف يبقى داخل فحصه وتأكيده الحاليين.
        </Alert>
        <DataTable caption="مساحات الإدارة المتاحة" columns={commonColumns} rows={areas.map(item => ({ ...item, type: item.id === 'advanced' ? 'مستوى ثانوي' : 'إدارة يومية' }))} getRowKey={item => item.id} onRowClick={item => item.id === 'advanced' ? changeView('advanced') : item.id === 'access' || item.id === 'integrations' || item.id === 'records' || item.id === 'health' ? changeView(item.id) : open(item)} empty="لا توجد مساحات إدارية متاحة لهذا الحساب"/>
      </> : null}

      {activeView === 'access' ? (
        <Suspense fallback={<LoadingState title="جارٍ تحميل المستخدمين والصلاحيات…"/>}>
          <div className="admin-workspace__embedded" role="tabpanel" aria-label="المستخدمون والوصول"><EmployeeManager embedded/></div>
        </Suspense>
      ) : null}

      {activeView === 'integrations' ? (
        <Suspense fallback={<LoadingState title="جارٍ تحميل حالة التكاملات…"/>}>
          <div className="admin-workspace__embedded" role="tabpanel" aria-label="التكاملات"><OperationsCenter isActive={isActive} embedded/></div>
        </Suspense>
      ) : null}

      {activeView === 'records' ? <>
        <PageHeader title="العقود والملفات" description="سجلات التهيئة والاتفاقيات والملفات، مع إبقاء كل إجراء كتابة داخل شاشته وصلاحيته الحالية."/>
        <DataTable caption="العقود والملفات" columns={commonColumns} rows={records} getRowKey={item => item.id} onRowClick={open} empty="لا توجد سجلات متاحة لهذه الصلاحية"/>
      </> : null}

      {activeView === 'health' ? <>
        <PageHeader title="صحة النظام" description="حالة واضحة: سليم، تحذير، فشل، غير معروف أو لم تتم مزامنته — بلا تحويل غياب المصدر إلى نجاح."/>
        <DataTable caption="وجهات صحة النظام" columns={[
          commonColumns[0],
          { key: 'state', label: 'نوع القراءة', render: item => <StatusBadge tone={item.tone} dot={false}>{item.state}</StatusBadge> },
          commonColumns[2],
        ]} rows={health} getRowKey={item => item.id} onRowClick={open} empty="لا توجد أدوات صحة نظام متاحة لهذه الصلاحية"/>
      </> : null}

      {activeView === 'advanced' ? <>
        <PageHeader title="أدوات النظام المتقدمة" description="مستكشفات وتشخيصات وأدوات داخلية محفوظة للروابط والصلاحيات، وليست وجهات يومية في القائمة الأساسية."/>
        {advanced.length ? <DataTable caption="أدوات النظام المتقدمة" columns={commonColumns} rows={advanced} getRowKey={item => item.id} onRowClick={open}/> : <EmptyState icon={<ShieldCheck size={20}/>} title="لا توجد أدوات متقدمة متاحة" description="لا يملك هذا الحساب صلاحية أي أداة في هذا المستوى."/>}
      </> : null}
    </Page>
  );
}

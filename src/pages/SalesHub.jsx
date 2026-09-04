// مساحة المبيعات الموحدة. الصفحات التاريخية تبقى مصادر الوظائف، بينما هذا
// الغلاف هو مصدر IA والعناوين والتنقل. لا توجد هوية عميل خاصة بالمبيعات؛
// كل انتقال تفصيلي ينتهي في Customer 360 أو في Drawer إجراء سياقي.
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Megaphone, Users } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import { Alert, Button, LoadingState, Page, PageHeader, Tabs } from '../design-system/EnterpriseUI.jsx';
import SalesWorkspaceNav, { VIEW_TO_AREA } from '../components/enterprise/SalesWorkspaceNav.jsx';
import '../components/enterprise/batch4-workspaces.css';

const PlatformSalesCrm = lazy(() => import('./PlatformSalesCrm.jsx'));
const NextActions = lazy(() => import('./NextActions.jsx'));
const StoreActivation = lazy(() => import('./StoreActivation.jsx'));
const Retargeting = lazy(() => import('./Retargeting.jsx'));
const HatifLeads = lazy(() => import('./HatifLeads.jsx'));
const LeadsTab = lazy(() => import('./CrmWorkspace.jsx').then(module => ({ default: module.LeadsTab })));
const Segments = lazy(() => import('./Segments.jsx'));

const VIEWS = [
  { id: 'overview', label: 'نظرة المبيعات', component: StoreActivation },
  { id: 'activation', label: 'نمو عملاء لمحة', component: StoreActivation },
  { id: 'pipeline', label: 'مسار المبيعات', component: PlatformSalesCrm, perm: 'sales.view' },
  { id: 'today', label: 'المتابعة اليومية', component: NextActions },
  { id: 'retargeting', label: 'مهام الاستعادة', component: Retargeting, perm: 'sales.view' },
  { id: 'external', label: 'عملاء محتملون خارج المنصة', component: LeadsTab, perm: 'sales.external_leads', activeProp: true },
  { id: 'hatif', label: 'مرجع طلبات هاتف', component: HatifLeads, perm: 'sales.hatif_leads' },
  { id: 'segments', label: 'الشرائح والعروض المحفوظة', component: Segments, perm: 'sales.segments' },
];

const LEGACY_PATH_TO_VIEW = {
  '/retargeting': 'pipeline', '/hatif-leads': 'hatif', '/segments': 'segments', '/next-actions': 'today',
};

const AREA_META = {
  overview: ['المبيعات', 'صورة تشغيلية موحدة للنمو والنشاط دون إنشاء تعريف جديد لحالة العميل.'],
  pipeline: ['مسار المبيعات', 'الحالة والمسؤول والمتابعة من المصادر الحالية، مع فتح Customer 360 للتفاصيل.'],
  prospects: ['العملاء والفرص', 'العملاء المحتملون قبل دخولهم المنصة، ومرجع هاتف كسياق لا كيان عميل مكرر.'],
  followup: ['المتابعة', 'قائمة التنفيذ اليومية المرتبة حسب الإجراء التالي القائم.'],
  tasks: ['مهام الاستعادة', 'نتائج قابلة للعمل للعملاء المتوقفين وفرص إعادة التنشيط.'],
  segments: ['الشرائح والعروض المحفوظة', 'بناء شرائح من بيانات العميل نفسها ثم تسليمها لمساحة الحملات للمراجعة.'],
};

export default function SalesHub({ isActive = true }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { can } = useAuth();
  const visibleViews = useMemo(() => VIEWS.filter(item => !item.perm || can(item.perm)), [can]);
  const requestedView = () => {
    const params = new URLSearchParams(location.search);
    const queryView = params.get('view') || params.get('tab');
    if (queryView && visibleViews.some(item => item.id === queryView)) return queryView;
    const legacy = LEGACY_PATH_TO_VIEW[location.pathname];
    if (legacy && visibleViews.some(item => item.id === legacy)) return legacy;
    return visibleViews.some(item => item.id === 'overview') ? 'overview' : visibleViews[0]?.id;
  };
  const [view, setView] = useState(requestedView);

  useEffect(() => {
    if (!isActive) return;
    const next = requestedView();
    if (next && next !== view) setView(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, location.pathname, location.search, visibleViews]);

  if (!isActive) return null;
  const activeView = visibleViews.find(item => item.id === view) || visibleViews[0];
  if (!activeView) return <Page><Alert tone="warning" title="لا توجد صلاحية">لا تملك صلاحية لعرض أي جزء من مركز المبيعات.</Alert></Page>;
  const activeArea = VIEW_TO_AREA[activeView.id] || 'overview';
  const [title, description] = AREA_META[activeArea] || AREA_META.overview;
  const prospectItems = [
    visibleViews.some(item => item.id === 'external') && { id: 'external', label: 'العملاء المحتملون' },
    visibleViews.some(item => item.id === 'hatif') && { id: 'hatif', label: 'مرجع هاتف' },
  ].filter(Boolean);
  const Cmp = activeView.component;
  const changeContext = nextView => {
    const params = new URLSearchParams(location.search);
    params.set('view', nextView);
    navigate(`/workspace/sales?${params.toString()}`);
  };

  return (
    <Page className="sales-workspace">
      <PageHeader eyebrow="مركز عمل" title={title} description={description} actions={<>
        <Button icon={<Users size={15}/>} onClick={() => navigate('/workspace/customers')}>دليل العملاء</Button>
        <Button variant="primary" icon={<Megaphone size={15}/>} onClick={() => navigate('/workspace/campaigns?view=audiences')}>إنشاء حملة</Button>
      </>}/>
      <SalesWorkspaceNav active={activeArea}/>
      {activeArea === 'prospects' && prospectItems.length > 1 ? <div className="sales-workspace__context">
        <span>طريقة عرض العملاء المحتملين</span>
        <Tabs items={prospectItems} active={activeView.id} onChange={changeContext} label="مصدر العملاء المحتملين"/>
      </div> : null}
      <section className="sales-workspace__panel" aria-label={activeView.label}>
        <Suspense fallback={<LoadingState title="جارٍ تحميل عرض المبيعات…" compact/>}>
          {activeView.activeProp ? <Cmp active={isActive}/> : <Cmp isActive={isActive}/>}
        </Suspense>
      </section>
      <Alert tone="info" title="هوية عميل واحدة">تفاصيل أي عميل أو متجر تُفتح في Customer 360؛ هذه المساحة تضيف سياق المبيعات فقط ولا تنشئ ملف عميل موازيًا.</Alert>
    </Page>
  );
}

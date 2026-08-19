// «مركز المبيعات» — دمج المرحلة 3 من خطة الموديولات (§1.32):
// كل «فرص النمو» في مكان واحد بدل 4 صفحات متفرّقة:
//   /retargeting  → إعادة الاستهداف (متاجرنا الخاملة — الافتراضي)
//   /hatif-leads  → مرجع طلبات التواصل في هاتف (لا يفتح Lead من مجرد رد)
//   (من /crm)     → عملاء خارج المنصّة (قوائم خارجية — LeadsTab المُصدَّر من CRM)
//   /segments     → شرائح العملاء (كان داخل ملف العملاء)
//   /merchants    → متاجر المنصّة (الدليل — كان داخل ملف العملاء)
// نفس نمط CollectionsHub: الأبناء mounted، كلٌّ يجلب عند تفعيله فقط،
// والمسارات القديمة تهبط على تبويبها. الرابط القانوني /retargeting?view=<id>
// مع قبول tab للروابط التاريخية.
import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Target, UserPlus, Store, Layers, ShoppingBag, Sunrise, TrendingUp, Workflow } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';

import PlatformSalesCrm from './PlatformSalesCrm.jsx';
import NextActions from './NextActions.jsx';
import StoreActivation from './StoreActivation.jsx';
import Retargeting from './Retargeting.jsx';
import HatifLeads  from './HatifLeads.jsx';
import { LeadsTab } from './CrmWorkspace.jsx';
import Segments    from './Segments.jsx';
import Merchants   from './Merchants.jsx';
import WorkspaceTabs from '../components/WorkspaceTabs.jsx';

// تفصيص الصلاحيات (قرار المستخدم 2026-07-16): مفتاح مستقل لكل تبويب —
// sales.view لم يعد يفتح إلا إعادة الاستهداف.
const TABS = [
  {
    id: 'pipeline', label: 'مسار عملاء المنصّة', icon: Workflow, component: PlatformSalesCrm, perm: 'sales.view',
    eyebrow: 'CRM المبيعات', purpose: 'تابع العميل من التسجيل إلى الاستمرار أو الخسارة',
    description: 'قاعدة العمل اليومية للفريق: مرحلة بيع، مسؤول، ملاحظة، موعد تواصل، وسجل موضوعي لما فعله المتجر داخل المنصّة.',
    outcome: 'عميل واضح وخطوة تالية محددة', tone: 'var(--brand)',
  },
  // «خطة اليوم» (§1.37): بوصلة الموظف — بلا perm خاص (يظهر لكل من دخل المركز)
  {
    id: 'today', label: 'قائمة العمل اليوم', icon: Sunrise, component: NextActions,
    eyebrow: 'بوصلة الموظف', purpose: 'ابدأ بأعلى الفرص قيمة اليوم',
    description: 'تلخّص ما يستحق الاتصال الآن وتمنع تشتيت الفريق بين القوائم. هذه هي نقطة البداية اليومية وليست قاعدة بيانات جديدة.',
    outcome: 'أولوية واتصال ونتيجة', tone: 'var(--brand)',
  },
  {
    id: 'activation', label: 'تحليل التفعيل', icon: TrendingUp, component: StoreActivation,
    secondary: true,
    eyebrow: 'نمو مبكر', purpose: 'حوّل التسجيل الجديد إلى أول شحنة',
    description: 'لوحة قياس لفهم سرعة الوصول لأول شحنة؛ المتابعة الفردية وتسجيل الملاحظات تتم من «مسار عملاء المنصّة».',
    outcome: 'أول شحنة ناجحة', tone: 'var(--green)',
  },
  {
    id: 'retargeting', label: 'حملات الاستعادة', icon: Target, component: Retargeting, perm: 'sales.view',
    secondary: true,
    eyebrow: 'استعادة الإيراد', purpose: 'أعد العملاء الذين شحنوا ثم توقفوا',
    description: 'مساحة تقسيم وتنفيذ حملات عودة جماعية. متابعة العميل الفردية ومواعيده تبقى في مسار العملاء.',
    outcome: 'عودة عميل ذي قيمة', tone: 'var(--gold)',
  },
  {
    id: 'hatif', label: 'مرجع طلبات هاتف', icon: UserPlus, component: HatifLeads, perm: 'sales.hatif_leads',
    secondary: true,
    eyebrow: 'مرجع قناة التواصل', purpose: 'راجع الطلبات الواردة عند الحاجة',
    description: 'مرجع لما ظهر في هاتف، وليس مولّد Leads تلقائياً. رد العميل يبقى لدى فريق هاتف ولا يفتح فرصة بيع في نظامنا.',
    outcome: 'سياق إضافي بلا ازدواج متابعة', tone: 'var(--accent3)',
  },
  {
    id: 'external', label: 'العملاء المحتملون', icon: Store, component: LeadsTab, perm: 'sales.external_leads', activeProp: true,
    eyebrow: 'استحواذ جديد', purpose: 'أدر القوائم الخارجية قبل دخول العميل للمنصة',
    description: 'للعملاء الذين لم يسجلوا ولم يطلبوا التواصل بعد. تبقى منفصلة عن العملاء المهتمين حتى لا تختلط حرارة الفرص.',
    outcome: 'عميل مؤهل وجاهز للتواصل', tone: 'var(--red)',
  },
  {
    id: 'segments', label: 'شرائح الجمهور', icon: Layers, component: Segments, perm: 'sales.segments',
    secondary: true,
    eyebrow: 'رسائل أدق', purpose: 'قسّم العملاء حسب القيمة والسلوك',
    description: 'أداة تخطيط للحملات وليست قائمة اتصال مستقلة. استخدم الشريحة لاختيار الرسالة، ثم نفّذ من مسار الحملة المناسب.',
    outcome: 'جمهور واضح ورسالة مناسبة', tone: 'var(--accent)',
  },
  {
    id: 'merchants', label: 'دليل المتاجر', icon: ShoppingBag, component: Merchants, perm: 'merchants.view',
    secondary: true,
    eyebrow: 'مرجع العملاء', purpose: 'ابحث في بيانات المتاجر وحالتها التشغيلية',
    description: 'مرجع معلومات المتجر وربطه، وليس مسار متابعة مبيعات. لا تسجّل نشاطاً بيعياً هنا حتى تبقى المسؤوليات واضحة.',
    outcome: 'بيانات متجر موثوقة', tone: 'var(--muted)',
  },
];

const LEGACY_PATH_TO_TAB = {
  '/retargeting': 'pipeline',
  '/hatif-leads': 'hatif',
  '/segments':    'segments',
  '/merchants':   'merchants',
};

export default function SalesHub({ isActive = true }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { can } = useAuth();
  const visibleTabs = TABS.filter(t => !t.perm || can(t.perm));
  const primaryTabs = visibleTabs.filter(t => !t.secondary);
  const secondaryTabs = visibleTabs.filter(t => t.secondary && t.id !== 'merchants' && t.id !== 'segments');

  const getInitialTab = () => {
    const params = new URLSearchParams(location.search);
    const fromQuery = params.get('view') || params.get('tab');
    if (fromQuery && visibleTabs.some(t => t.id === fromQuery)) return fromQuery;
    const fromPath = LEGACY_PATH_TO_TAB[location.pathname];
    if (fromPath && visibleTabs.some(t => t.id === fromPath)) return fromPath;
    return visibleTabs[0]?.id || 'retargeting';
  };
  const [tab, setTab] = useState(getInitialTab);

  useEffect(() => {
    if (!isActive) return;
    const expected = getInitialTab();
    if (expected !== tab) setTab(expected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search]);

  const changeView = (next) => {
    if (!visibleTabs.some(item => item.id === next)) return;
    const params = new URLSearchParams(location.search);
    params.set('view', next);
    params.delete('tab');
    setTab(next);
    navigate(`/retargeting?${params.toString()}`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      {primaryTabs.some(item => item.id === tab) ? (
        <WorkspaceTabs
          scope="sales-execution"
          title="عمل اليوم والفرص"
          subtitle="الأولوية والمرحلة والمتابعة دون خلط الفلاتر بالمسارات الرئيسية"
          tone="#8B5CF6"
          tabs={primaryTabs}
          activeId={tab}
          onChange={changeView}
          selectorLabel="مسار العمل"
        />
      ) : (
        <div className="workspace-secondary-context" role="status">
          <span>قائمة محفوظة</span><strong>{visibleTabs.find(item => item.id === tab)?.label}</strong>
          <button type="button" onClick={() => changeView('today')}>العودة إلى عمل اليوم</button>
        </div>
      )}
      <nav className="workspace-filter-bar workspace-saved-views" aria-label="قوائم المبيعات المحفوظة">
        <span>قوائم محفوظة:</span>
        {secondaryTabs.map(item => (
          <button type="button" key={item.id} aria-pressed={tab === item.id} onClick={() => changeView(item.id)}>{item.label}</button>
        ))}
        {visibleTabs.some(item => item.id === 'segments') ? <button type="button" onClick={() => navigate('/campaigns?source=segments')}>شرائح الجمهور</button> : null}
        {visibleTabs.some(item => item.id === 'merchants') ? <button type="button" onClick={() => navigate('/customer-360?source=sales')}>فتح دليل المتاجر</button> : null}
      </nav>
      <div className="ws-tab-body" style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {visibleTabs.map(t => {
          const Cmp = t.component;
          const active = tab === t.id;
          const activeVal = isActive && active;
          return (
            <div
              key={t.id}
              aria-label={t.label}
              role="tabpanel"
              className="ws-tab-panel"
              style={{ display: active ? 'block' : 'none', height: '100%' }}
            >
              {/* LeadsTab يستقبل prop باسم active (لا isActive) — إرث CRM */}
              {t.activeProp ? <Cmp active={activeVal}/> : <Cmp isActive={activeVal}/>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

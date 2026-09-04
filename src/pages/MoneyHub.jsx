// "النقد والمدفوعات" — workspace consolidating the four cash-movement
// surfaces that used to be separate routes:
//   /cod-settlements   → tab: تسويات COD     (CodSettlements)
//   /payments          → tab: الدفعات         (Payments)
//   /bank              → tab: كشف بنكي        (BankStatement)
//
// Same pattern as CustomerHub / CarriersWorkspace: each tab renders
// the existing page component with isActive guarding. Legacy routes
// still resolve and land on the right tab.

import { useState, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Banknote, CreditCard, ListFilter, Wallet } from 'lucide-react';

import CodSettlements   from './CodSettlements.jsx';
import Payments         from './Payments.jsx';
import BankStatement    from './BankStatement.jsx';
import { Alert, Breadcrumbs, EmptyState, Page, PageHeader, Tabs } from '../design-system/EnterpriseUI.jsx';
import FinanceWorkspaceNav from '../components/enterprise/FinanceWorkspaceNav.jsx';
import { useAuth } from '../lib/auth.jsx';

const TABS = [
  {
    id: 'bank', label: 'البنوك', icon: Wallet, component: BankStatement,
    perm: 'bank.view',
    eyebrow: 'الرصيد والحركة', purpose: 'راجع كل حساب بنكي ضمن فترته المحددة',
    description: 'يبقى رصيد كل بنك وحركاته في عرضه الخاص، دون خلطها بتحصيل COD أو دفعات الناقلين.',
    outcome: 'رصيد وإقفال قابلان للتتبع', tone: 'var(--brand)',
  },
  {
    id: 'cod', label: 'تصفية COD القديمة', icon: Banknote, component: CodSettlements,
    perm: 'cod.view',
    eyebrow: 'مسار مؤقت', purpose: 'صفّر الأرصدة التاريخية المتبقية ثم أغلق المسار',
    description: 'لا تُنشأ التزامات جديدة؛ تظهر الشركات ذات الرصيد المتبقي فقط حتى تصفيرها.',
    outcome: 'رصيد تاريخي مصفّر', tone: 'var(--gold)',
  },
  {
    id: 'payments', label: 'دفعات الناقلين', icon: CreditCard, component: Payments,
    perm: 'payments.view',
    eyebrow: 'تسوية الالتزامات', purpose: 'سجّل ما دُفع للشركات واربطه بقيوده الصحيحة',
    description: 'استخدمها للدفعات الخارجة والتوزيعات، مع إبقاء التحصيل الوارد منفصلاً حتى لا تختلط حركة النقد.',
    outcome: 'دفعة موزعة بلا ازدواج', tone: 'var(--red)',
  },
  {
    id: 'unclassified', label: 'العمليات غير المصنفة', icon: ListFilter, component: BankStatement,
    perm: 'bank.view',
    secondary: true,
    componentProps: { defaultSavedClass: 'unclassified' },
    eyebrow: 'استثناءات البنك', purpose: 'صنّف العمليات التي لم ترتبط بوجهتها بعد',
    description: 'هذا عرض مستقل لنفس مصدر البنك، ولا يدمج عملياته مع COD أو دفعات الناقلين.',
    outcome: 'عملية مصنفة وسبب واضح', tone: 'var(--gold)',
  },
];

const LEGACY_PATH_TO_TAB = {
  '/cod-settlements':  'cod',
  '/payments':         'payments',
  '/bank':             'bank',
};

export default function MoneyHub({ isActive = true }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { can } = useAuth();
  const visibleTabs = useMemo(() => TABS.filter(item => can(item.perm)), [can]);

  const getInitialTab = () => {
    const params = new URLSearchParams(location.search);
    const fromQuery = params.get('tab');
    if (fromQuery && TABS.some(t => t.id === fromQuery)) return fromQuery;
    return LEGACY_PATH_TO_TAB[location.pathname] || 'bank';
  };
  const [tab, setTab] = useState(getInitialTab);

  useEffect(() => {
    if (!isActive) return;
    const expected = getInitialTab();
    const allowed = visibleTabs.some(item => item.id === expected)
      ? expected
      : visibleTabs[0]?.id;
    if (allowed && allowed !== tab) {
      setTab(allowed);
      const params = new URLSearchParams(location.search);
      params.set('tab', allowed);
      navigate(`/money?${params.toString()}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search, visibleTabs, isActive]);

  if (visibleTabs.length === 0) {
    return <Page><EmptyState icon="🔒" title="لا تملك صلاحية حركة الأموال" description="اطلب من المدير منح صلاحية التحصيل أو الدفعات أو الحسابات البنكية."/></Page>;
  }

  const changeTab = nextTab => {
    if (!visibleTabs.some(item => item.id === nextTab)) return;
    const params = new URLSearchParams(location.search);
    params.set('tab', nextTab);
    navigate(`/money?${params.toString()}`);
    setTab(nextTab);
  };

  return (
    <Page className="money-workspace">
      <Breadcrumbs items={[{ label: 'المالية' }, { label: 'النقد والبنوك' }]}/>
      <PageHeader
        eyebrow="مساحة عمل"
        title="النقد والبنوك"
        description="الحركة البنكية، الأرصدة الفعلية، وتسويات النقد الخارجة في عروض منفصلة قابلة للتتبع."
      />
      <FinanceWorkspaceNav active={['cod', 'payments'].includes(tab) ? 'payables' : 'cash'}/>
      <Alert title="فصل مصادر الرصيد">
        الرصيد البنكي الفعلي، الرصيد الدفتري، والفروقات لا تُدمج في رقم واحد. كل عرض يحتفظ بمصدره وبمنطق المطابقة الحالي.
      </Alert>
      <Tabs items={visibleTabs} active={tab} onChange={changeTab} label="عروض النقد والبنوك"/>
      <div className="money-workspace__body">
        {visibleTabs.map(t => {
          const Cmp = t.component;
          const active = tab === t.id;
          return (
            <div
              key={t.id}
              aria-label={t.label}
              role="tabpanel"
              className="money-workspace__panel"
              hidden={!active}
            >
              <Cmp isActive={isActive && active} embedded {...(t.componentProps || {})}/>
            </div>
          );
        })}
      </div>
    </Page>
  );
}

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
import { Banknote, CreditCard, Wallet } from 'lucide-react';

import CodSettlements   from './CodSettlements.jsx';
import Payments         from './Payments.jsx';
import BankStatement    from './BankStatement.jsx';
import WorkspaceTabs, { workspacePanelId, workspaceTabId } from '../components/WorkspaceTabs.jsx';
import { Empty } from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';

const TABS = [
  {
    id: 'cod', label: 'تحصيل شركات الشحن', icon: Banknote, component: CodSettlements,
    perm: 'cod.view',
    eyebrow: 'أمانات العملاء', purpose: 'قارن المتوقع بما حوّلته شركة الشحن فعلاً',
    description: 'هذه الأموال ليست دخلاً. الشاشة تتابع شحنات COD من الاستحقاق إلى الاستلام وتظهر الفرق بوضوح.',
    outcome: 'تحصيل مستلم وفروقات معروفة', tone: 'var(--gold)',
  },
  {
    id: 'payments', label: 'دفعات الناقلين', icon: CreditCard, component: Payments,
    perm: 'payments.view',
    eyebrow: 'تسوية الالتزامات', purpose: 'سجّل ما دُفع للشركات واربطه بقيوده الصحيحة',
    description: 'استخدمها للدفعات الخارجة والتوزيعات، مع إبقاء التحصيل الوارد منفصلاً حتى لا تختلط حركة النقد.',
    outcome: 'دفعة موزعة بلا ازدواج', tone: 'var(--red)',
  },
  {
    id: 'bank', label: 'الحسابات البنكية', icon: Wallet, component: BankStatement,
    perm: 'bank.view',
    eyebrow: 'مصدر الرصيد', purpose: 'راجع أرصدة البنوك وحركتها من الكشوف',
    description: 'يعرض كل حساب بنكي على حدة ويجعل الرصيد الإجمالي نتيجة مجموع الحسابات، لا رصيد كشف واحد.',
    outcome: 'رصيد بنكي قابل للتتبع', tone: 'var(--brand)',
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
    return LEGACY_PATH_TO_TAB[location.pathname] || 'cod';
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

  const handleTabChange = (newTab) => {
    if (!visibleTabs.some(item => item.id === newTab)) return;
    setTab(newTab);
    const params = new URLSearchParams(location.search);
    if (location.pathname !== '/money' || params.get('tab') !== newTab) {
      params.set('tab', newTab);
      navigate(`/money?${params.toString()}`, { replace: true });
    }
  };

  if (visibleTabs.length === 0) {
    return <Empty icon="🔒" title="لا تملك صلاحية حركة الأموال" sub="اطلب من المدير منح صلاحية التحصيل أو الدفعات أو الحسابات البنكية."/>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <WorkspaceTabs
        scope="money"
        title="حركة الأموال"
        subtitle="التحصيل الوارد، الدفعات الخارجة، ثم مصدر الرصيد"
        tabs={visibleTabs}
        activeId={tab}
        onChange={handleTabChange}
        tone="var(--green)"
      />

      <div className="ws-tab-body" style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {visibleTabs.map(t => {
          const Cmp = t.component;
          const active = tab === t.id;
          return (
            <div
              key={t.id}
              id={workspacePanelId('money', t.id)}
              aria-labelledby={workspaceTabId('money', t.id)}
              role="tabpanel"
              className="ws-tab-panel"
              style={{ display: active ? 'block' : 'none', height: '100%' }}
            >
              <Cmp isActive={isActive && active}/>
            </div>
          );
        })}
      </div>
    </div>
  );
}

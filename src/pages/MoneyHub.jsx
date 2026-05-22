// "حركة الأموال" — workspace consolidating the four cash-movement
// surfaces that used to be separate routes:
//   /cod-settlements   → tab: تسويات COD     (CodSettlements)
//   /payments          → tab: الدفعات         (Payments)
//   /bank              → tab: كشف بنكي        (BankStatement)
//   /payment-requests  → tab: طلبات السداد    (PaymentRequests)
//
// Same pattern as CustomerHub / CarriersWorkspace: each tab renders
// the existing page component with isActive guarding. Legacy routes
// still resolve and land on the right tab.

import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Banknote, CreditCard, Wallet, Inbox } from 'lucide-react';

import CodSettlements   from './CodSettlements.jsx';
import Payments         from './Payments.jsx';
import BankStatement    from './BankStatement.jsx';
import PaymentRequests  from './PaymentRequests.jsx';

const TABS = [
  { id: 'cod',      label: 'تسويات COD',  icon: Banknote,   component: CodSettlements   },
  { id: 'payments', label: 'الدفعات',      icon: CreditCard, component: Payments         },
  { id: 'bank',     label: 'كشف بنكي',     icon: Wallet,     component: BankStatement    },
  { id: 'requests', label: 'طلبات السداد', icon: Inbox,      component: PaymentRequests  },
];

const LEGACY_PATH_TO_TAB = {
  '/cod-settlements':  'cod',
  '/payments':         'payments',
  '/bank':             'bank',
  '/payment-requests': 'requests',
};

export default function MoneyHub({ isActive = true }) {
  const location = useLocation();
  const navigate = useNavigate();

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
    if (expected !== tab) setTab(expected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search]);

  const handleTabChange = (newTab) => {
    setTab(newTab);
    if (location.pathname !== '/money' || new URLSearchParams(location.search).get('tab') !== newTab) {
      navigate(`/money?tab=${newTab}`, { replace: true });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <div style={{
        display: 'flex', gap: 4,
        padding: '12px 24px 0',
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)',
        position: 'sticky', top: 0, zIndex: 5,
      }}>
        {TABS.map(t => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => handleTabChange(t.id)}
              style={{
                padding: '10px 18px',
                border: 'none', background: 'transparent',
                borderBottom: `2.5px solid ${active ? '#10B981' : 'transparent'}`,
                color: active ? 'var(--text)' : 'var(--muted)',
                fontSize: 13, fontWeight: active ? 700 : 500,
                fontFamily: 'var(--font-sans)', cursor: 'pointer',
                transition: 'all .15s', marginBottom: -1,
                display: 'inline-flex', alignItems: 'center', gap: 7,
              }}
            >
              <Icon size={14}/>
              {t.label}
            </button>
          );
        })}
      </div>

      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {TABS.map(t => {
          const Cmp = t.component;
          const active = tab === t.id;
          return (
            <div key={t.id} style={{ display: active ? 'block' : 'none', height: '100%' }}>
              <Cmp isActive={isActive && active}/>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// "العملاء" — unified hub for the 4 customer-related screens that
// used to live as separate routes:
//   /customers        → tab: متابعة (CustomerWatch — 360 KPIs)
//   /receivables      → tab: مديونيات (CustomerReceivables)
//   /segments         → tab: شرائح (Segments)
//   /merchants        → tab: متاجر (Merchants directory)
//
// All four are about the same entity (the merchant/customer), just
// different lenses. Merging them eliminates the "I'm not sure where
// this thing lives" problem the operator had.
//
// Each child renders only when its tab is active (isActive prop) so
// fetching is lazy — switching tabs is the only fetch trigger.
//
// Old routes still resolve via App.jsx; the canonical URL is
// /customer-360?tab=<id>.

import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Users, DollarSign, Layers, ShoppingBag } from 'lucide-react';
import { PageHeader } from '../components/UI.jsx';

import CustomerWatch       from './CustomerWatch.jsx';
import Segments            from './Segments.jsx';
import Merchants           from './Merchants.jsx';

const TABS = [
  { id: 'watch',       label: 'متابعة',     icon: Users,       component: CustomerWatch },
  { id: 'segments',    label: 'شرائح',      icon: Layers,      component: Segments },
  { id: 'merchants',   label: 'متاجر المنصّة', icon: ShoppingBag, component: Merchants },
];

// Map legacy paths → tab id. Lets `/customers`, `/receivables`, etc.
// land on the right tab without a full URL rewrite.
const LEGACY_PATH_TO_TAB = {
  '/customers':    'watch',
  '/segments':     'segments',
  '/merchants':    'merchants',
};

export default function CustomerHub({ isActive = true }) {
  const location = useLocation();
  const navigate = useNavigate();

  // Read initial tab from ?tab= or from a legacy path. Default
  // to "watch" if neither is set.
  const getInitialTab = () => {
    const params = new URLSearchParams(location.search);
    const fromQuery = params.get('tab');
    if (fromQuery && TABS.some(t => t.id === fromQuery)) return fromQuery;
    return LEGACY_PATH_TO_TAB[location.pathname] || 'watch';
  };
  const [tab, setTab] = useState(getInitialTab);

  // Keep URL in sync when the user clicks a tab — makes deep linking
  // possible ("send me /customer-360?tab=receivables").
  useEffect(() => {
    if (!isActive) return;
    const expectedTab = getInitialTab();
    if (expectedTab !== tab) setTab(expectedTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search]);

  const handleTabChange = (newTab) => {
    setTab(newTab);
    // Always canonicalize to /customer-360 — legacy paths get
    // rewritten as soon as the operator touches the tabs.
    if (location.pathname !== '/customer-360' || new URLSearchParams(location.search).get('tab') !== newTab) {
      const params = new URLSearchParams(location.search);
      params.set('tab', newTab);
      navigate(`/customer-360?${params.toString()}`, { replace: true });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      {/* Tab strip — sticky-ish, sits right under the topbar */}
      <div style={{
        display: 'flex', gap: 4, flexWrap: 'wrap', rowGap: 6,
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
                borderBottom: `2.5px solid ${active ? '#0EA5E9' : 'transparent'}`,
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

      {/* The 4 children are kept mounted (via display:none) so tab
          switching is instant and any in-progress edits / scroll
          positions survive. Only the active one fetches because each
          child guards on isActive. */}
      <div className="ws-tab-body" style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {TABS.map(t => {
          const Cmp = t.component;
          const active = tab === t.id;
          return (
            <div key={t.id} className="ws-tab-panel" style={{
              display: active ? 'block' : 'none',
              height: '100%',
            }}>
              <Cmp isActive={isActive && active}/>
            </div>
          );
        })}
      </div>
    </div>
  );
}

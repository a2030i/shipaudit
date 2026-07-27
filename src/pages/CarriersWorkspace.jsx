// "شركات الشحن" — workspace that hosts the two carrier-overview
// surfaces that used to be separate routes:
//   /hub          → tab: كشف الشركات (CarriersHub cards)
//   /carrier-kpi  → tab: أداء الناقلين (CarrierKpi metrics)
//
// Same merchant-vs-carrier reasoning as the customer hub: both are
// "what's the state of the carriers", just different lenses (cards
// vs. KPIs). One tabbed page reduces nav noise without rewriting
// either component.

import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Building2, BarChart3, Scale } from 'lucide-react';

import CarriersHub from './CarriersHub.jsx';
import CarrierKpi  from './CarrierKpi.jsx';
import Claims      from './Claims.jsx';

const TABS = [
  { id: 'hub',    label: 'كشف الشركات',  icon: Building2, component: CarriersHub },
  { id: 'kpi',    label: 'أداء الناقلين', icon: BarChart3, component: CarrierKpi },
  { id: 'claims', label: 'المطالبات',     icon: Scale,     component: Claims },
];

const LEGACY_PATH_TO_TAB = {
  '/hub':         'hub',
  '/carrier-kpi': 'kpi',
  '/claims':      'claims',
};

export default function CarriersWorkspace({ isActive = true, carriers = [] }) {
  const location = useLocation();
  const navigate = useNavigate();

  const getInitialTab = () => {
    const params = new URLSearchParams(location.search);
    const fromQuery = params.get('tab');
    if (fromQuery && TABS.some(t => t.id === fromQuery)) return fromQuery;
    return LEGACY_PATH_TO_TAB[location.pathname] || 'hub';
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
    if (location.pathname !== '/hub' || new URLSearchParams(location.search).get('tab') !== newTab) {
      navigate(`/hub?tab=${newTab}`, { replace: true });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
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
                borderBottom: `2.5px solid ${active ? 'var(--brand)' : 'transparent'}`,
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

      <div className="ws-tab-body" style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {TABS.map(t => {
          const Cmp = t.component;
          const active = tab === t.id;
          return (
            <div key={t.id} className="ws-tab-panel" style={{ display: active ? 'block' : 'none', height: '100%' }}>
              <Cmp isActive={isActive && active} carriers={carriers}/>
            </div>
          );
        })}
      </div>
    </div>
  );
}

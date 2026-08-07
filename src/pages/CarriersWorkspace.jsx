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
import { useLocation } from 'react-router-dom';
import { Building2, BarChart3, Scale } from 'lucide-react';

import CarriersHub from './CarriersHub.jsx';
import CarrierKpi  from './CarrierKpi.jsx';
import Claims      from './Claims.jsx';

const TABS = [
  {
    id: 'hub', label: 'حالة الشركات', icon: Building2, component: CarriersHub,
    eyebrow: 'صورة تشغيلية', purpose: 'اعرف ما لدى كل شركة وما يحتاج متابعة الآن',
    description: 'تجمع الرصيد والتحصيل والفواتير غير المدققة وآخر مراجعة في مكان واحد، لتبدأ يومك من الاستثناء لا من البحث.',
    outcome: 'شركة واضحة وخطوة تالية', tone: 'var(--brand)',
  },
  {
    id: 'kpi', label: 'مقارنة الأداء', icon: BarChart3, component: CarrierKpi,
    eyebrow: 'قرار تشغيلي', purpose: 'قارن الجودة والتكلفة والالتزام بين الشركات',
    description: 'استخدمها عند تقييم الأداء أو توزيع الشحنات، لا لمتابعة معاملة يومية بعينها.',
    outcome: 'مقارنة عادلة قابلة للقرار', tone: 'var(--accent3)',
  },
  {
    id: 'claims', label: 'المطالبات والاسترداد', icon: Scale, component: Claims,
    eyebrow: 'حماية الهامش', purpose: 'تابع الفروقات من الاكتشاف حتى استردادها',
    description: 'تحوّل أخطاء التدقيق إلى مطالبة قابلة للمتابعة وتفصل المبلغ المكتشف عن المبلغ المسترد فعلاً.',
    outcome: 'مطالبة موثقة وحالة تحصيل', tone: 'var(--gold)',
  },
];

const LEGACY_PATH_TO_TAB = {
  '/hub':         'hub',
  '/carrier-kpi': 'kpi',
  '/claims':      'claims',
};

export default function CarriersWorkspace({ isActive = true, carriers = [] }) {
  const location = useLocation();

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <div className="ws-tab-body" style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {TABS.map(t => {
          const Cmp = t.component;
          const active = tab === t.id;
          return (
            <div
              key={t.id}
              aria-label={t.label}
              role="tabpanel"
              className="ws-tab-panel"
              style={{ display: active ? 'block' : 'none', height: '100%' }}
            >
              <Cmp isActive={isActive && active} carriers={carriers}/>
            </div>
          );
        })}
      </div>
    </div>
  );
}

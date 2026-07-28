// «مركز التحصيل» — دمج المرحلة 2 من خطة الموديولات (§1.32، معتمدة 2026-07-15):
// 4 شاشات كانت مبعثرة على مسارات منفصلة صارت تبويبات مكان واحد:
//   /customer-money → تحصيل العملاء (زوهو حي — الرئيسي)
//   /collections    → قائمة التحصيل (المهمات والوعود)
//   /legal          → التصعيد القانوني
//   /receivables    → الكشف الداخلي (snapshot — كان داخل ملف العملاء)
// نفس نمط CustomerHub المجرَّب: الأبناء يبقون mounted (display:none)، كلٌّ
// يجلب فقط عند تفعيله (isActive). المسارات القديمة تهبط على تبويبها،
// والرابط القانوني /customer-money?tab=<id>.
import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { HandCoins, PhoneCall, Scale, FileText } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';

import CustomerMoney       from './CustomerMoney.jsx';
import Collections         from './Collections.jsx';
import LegalEscalation     from './LegalEscalation.jsx';
import CustomerReceivables from './CustomerReceivables.jsx';

const TABS = [
  { id: 'money',    label: 'أرصدة العملاء',   icon: HandCoins, component: CustomerMoney,       perm: 'receivables.view' },
  { id: 'queue',    label: 'قائمة التحصيل',   icon: PhoneCall, component: Collections,          perm: 'collections.view' },
  { id: 'legal',    label: 'التصعيد القانوني', icon: Scale,     component: LegalEscalation,      perm: 'legal.view' },
  { id: 'internal', label: 'الكشف الداخلي',   icon: FileText,  component: CustomerReceivables,  perm: 'receivables.view' },
];

const LEGACY_PATH_TO_TAB = {
  '/customer-money': 'money',
  '/collections':    'queue',
  '/legal':          'legal',
  '/receivables':    'internal',
};

export default function CollectionsHub({ isActive = true }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { can } = useAuth();
  const visibleTabs = TABS.filter(t => !t.perm || can(t.perm));

  const getInitialTab = () => {
    const params = new URLSearchParams(location.search);
    const fromQuery = params.get('tab');
    if (fromQuery && visibleTabs.some(t => t.id === fromQuery)) return fromQuery;
    const fromPath = LEGACY_PATH_TO_TAB[location.pathname];
    if (fromPath && visibleTabs.some(t => t.id === fromPath)) return fromPath;
    return visibleTabs[0]?.id || 'money';
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
    if (location.pathname !== '/customer-money' || new URLSearchParams(location.search).get('tab') !== newTab) {
      const params = new URLSearchParams(location.search);
      params.set('tab', newTab);
      navigate(`/customer-money?${params.toString()}`, { replace: true });
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
        {visibleTabs.map(t => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => handleTabChange(t.id)}
              style={{
                padding: '10px 18px', border: 'none', background: 'transparent',
                borderBottom: `2.5px solid ${active ? 'var(--red)' : 'transparent'}`,
                color: active ? 'var(--text)' : 'var(--muted)',
                fontSize: 13, fontWeight: active ? 700 : 500,
                fontFamily: 'var(--font-sans)', cursor: 'pointer',
                transition: 'all .15s', marginBottom: -1,
                display: 'inline-flex', alignItems: 'center', gap: 7,
              }}>
              <Icon size={14}/>
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="ws-tab-body" style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {visibleTabs.map(t => {
          const Cmp = t.component;
          const active = tab === t.id;
          return (
            <div key={t.id} className="ws-tab-panel" style={{ display: active ? 'block' : 'none', height: '100%' }}>
              <Cmp isActive={isActive && active}/>
            </div>
          );
        })}
      </div>
    </div>
  );
}

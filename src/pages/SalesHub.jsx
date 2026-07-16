// «مركز المبيعات» — دمج المرحلة 3 من خطة الموديولات (§1.32):
// كل «فرص النمو» في مكان واحد بدل 4 صفحات متفرّقة:
//   /retargeting  → إعادة الاستهداف (متاجرنا الخاملة — الافتراضي)
//   /hatif-leads  → فرص من هاتف (كلّمونا ولم يسجّلوا)
//   (من /crm)     → عملاء خارج المنصّة (قوائم خارجية — LeadsTab المُصدَّر من CRM)
//   /segments     → شرائح العملاء (كان داخل ملف العملاء)
//   /merchants    → متاجر المنصّة (الدليل — كان داخل ملف العملاء)
// نفس نمط CollectionsHub: الأبناء mounted، كلٌّ يجلب عند تفعيله فقط،
// والمسارات القديمة تهبط على تبويبها. الرابط القانوني /retargeting?tab=<id>.
import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Target, UserPlus, Store, Layers, ShoppingBag } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';

import Retargeting from './Retargeting.jsx';
import HatifLeads  from './HatifLeads.jsx';
import { LeadsTab } from './CrmWorkspace.jsx';
import Segments    from './Segments.jsx';
import Merchants   from './Merchants.jsx';

// تفصيص الصلاحيات (قرار المستخدم 2026-07-16): مفتاح مستقل لكل تبويب —
// sales.view لم يعد يفتح إلا إعادة الاستهداف.
const TABS = [
  { id: 'retargeting', label: 'إعادة الاستهداف',    icon: Target,      component: Retargeting, perm: 'sales.view' },
  { id: 'hatif',       label: 'فرص من هاتف',        icon: UserPlus,    component: HatifLeads,  perm: 'sales.hatif_leads' },
  { id: 'external',    label: 'عملاء خارج المنصّة', icon: Store,       component: LeadsTab,    perm: 'sales.external_leads', activeProp: true },
  { id: 'segments',    label: 'مجموعات العملاء',    icon: Layers,      component: Segments,    perm: 'sales.segments' },
  { id: 'merchants',   label: 'متاجر المنصّة',      icon: ShoppingBag, component: Merchants,   perm: 'merchants.view' },
];

const LEGACY_PATH_TO_TAB = {
  '/retargeting': 'retargeting',
  '/hatif-leads': 'hatif',
  '/segments':    'segments',
  '/merchants':   'merchants',
};

export default function SalesHub({ isActive = true }) {
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
    return visibleTabs[0]?.id || 'retargeting';
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
    if (location.pathname !== '/retargeting' || new URLSearchParams(location.search).get('tab') !== newTab) {
      const params = new URLSearchParams(location.search);
      params.set('tab', newTab);
      navigate(`/retargeting?${params.toString()}`, { replace: true });
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
                borderBottom: `2.5px solid ${active ? '#F97316' : 'transparent'}`,
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
          const activeVal = isActive && active;
          return (
            <div key={t.id} className="ws-tab-panel" style={{ display: active ? 'block' : 'none', height: '100%' }}>
              {/* LeadsTab يستقبل prop باسم active (لا isActive) — إرث CRM */}
              {t.activeProp ? <Cmp active={activeVal}/> : <Cmp isActive={activeVal}/>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

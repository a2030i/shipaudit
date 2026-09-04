// «مركز التحصيل» — دمج المرحلة 2 من خطة الموديولات (§1.32، معتمدة 2026-07-15):
// ثلاث شاشات تشغيلية من مصادرها الحالية في مكان واحد:
//   /customer-money → تحصيل العملاء (زوهو حي — الرئيسي)
//   /collections    → قائمة التحصيل (المهمات والوعود)
//   /receivables    → الكشف الداخلي (snapshot — كان داخل ملف العملاء)
// نفس نمط CustomerHub المجرَّب: الأبناء يبقون mounted (display:none)، كلٌّ
// يجلب فقط عند تفعيله (isActive). المسارات القديمة تهبط على تبويبها،
// والرابط القانوني /customer-money?view=<id> مع قبول tab للروابط التاريخية.
import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { Breadcrumbs, Page, PageHeader, Tabs, Button } from '../design-system/EnterpriseUI.jsx';
import FinanceWorkspaceNav from '../components/enterprise/FinanceWorkspaceNav.jsx';
import { reportReturnPath } from '../lib/workspaceJourneyNavigation.js';

import CustomerMoney       from './CustomerMoney.jsx';
import Collections         from './Collections.jsx';
import CustomerReceivables from './CustomerReceivables.jsx';

const TABS = [
  {
    id: 'money', label: 'المستحقات وأعمار الدين', component: CustomerMoney, perm: 'receivables.view',
  },
  {
    id: 'queue', label: 'إجراء اليوم والوعود', component: Collections, perm: 'collections.view',
  },
  {
    id: 'internal', label: 'الأرصدة والمطابقة', component: CustomerReceivables, perm: 'receivables.view',
  },
];

const LEGACY_PATH_TO_TAB = {
  '/customer-money': 'money',
  '/collections':    'queue',
  '/receivables':    'internal',
};

export default function CollectionsHub({ isActive = true }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { can } = useAuth();
  const visibleTabs = TABS.filter(t => !t.perm || can(t.perm));

  const getInitialTab = () => {
    const params = new URLSearchParams(location.search);
    const fromQuery = params.get('view') || params.get('tab');
    if (fromQuery && visibleTabs.some(t => t.id === fromQuery)) return fromQuery;
    const fromPath = LEGACY_PATH_TO_TAB[location.pathname];
    if (fromPath && visibleTabs.some(t => t.id === fromPath)) return fromPath;
    return visibleTabs[0]?.id || 'money';
  };
  const [tab, setTab] = useState(getInitialTab);
  const routeParams = new URLSearchParams(location.search);
  const reportReturnTo = reportReturnPath(routeParams.get('source'), routeParams.get('returnTo'));

  const changeTab = nextTab => {
    if (!visibleTabs.some(item => item.id === nextTab)) return;
    const params = new URLSearchParams(location.search);
    params.set('view', nextTab);
    params.delete('tab');
    navigate(`/customer-money?${params.toString()}`);
    setTab(nextTab);
  };

  useEffect(() => {
    if (!isActive) return;
    const expected = getInitialTab();
    if (expected !== tab) setTab(expected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search]);

  return (
    <Page className="collections-workspace">
      <Breadcrumbs items={[{ label: 'المالية' }, { label: 'تحصيل العملاء' }]}/>
      <PageHeader
        eyebrow="مساحة عمل"
        title="تحصيل العملاء"
        description="موقف المديونية، قائمة تنفيذ الفريق، والمطابقة الداخلية في مسار واحد."
        actions={reportReturnTo ? <Button size="sm" onClick={() => navigate(reportReturnTo)}>العودة إلى التقرير</Button> : null}
      />
      <FinanceWorkspaceNav active={tab === 'queue' ? 'collections' : 'receivables'}/>
      <Tabs items={visibleTabs} active={tab} onChange={changeTab} label="أقسام تحصيل العملاء"/>
      <div className="collections-workspace__body">
        {visibleTabs.map(t => {
          const Cmp = t.component;
          const active = tab === t.id;
          return (
            <div
              key={t.id}
              aria-label={t.label}
              role="tabpanel"
              className="collections-workspace__panel"
              hidden={!active}
            >
              <Cmp isActive={isActive && active} embedded/>
            </div>
          );
        })}
      </div>
    </Page>
  );
}

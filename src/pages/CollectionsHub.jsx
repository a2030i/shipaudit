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
import { useLocation } from 'react-router-dom';
import { HandCoins, PhoneCall, Scale, FileText, BarChart3 } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';

import CustomerMoney       from './CustomerMoney.jsx';
import Collections         from './Collections.jsx';
import LegalEscalation     from './LegalEscalation.jsx';
import CustomerReceivables from './CustomerReceivables.jsx';
import CollectionTeamPerformance from './CollectionTeamPerformance.jsx';

const TABS = [
  {
    id: 'money', label: 'نظرة عامة وأعمار الدين', icon: HandCoins, component: CustomerMoney, perm: 'receivables.view',
    eyebrow: 'مرجع الدين', purpose: 'اعرف المبلغ الحقيقي المستحق من كل عميل',
    description: 'يعرض فواتير زوهو المفتوحة ويقودك مباشرة إلى العميل والفواتير المتأخرة. هذه الشاشة للقرار المالي، وليست سجل اتصالات.',
    outcome: 'عميل ومبلغ وفواتير واضحة', tone: 'var(--green)',
  },
  {
    id: 'queue', label: 'إجراء اليوم ووعود السداد', icon: PhoneCall, component: Collections, perm: 'collections.view',
    eyebrow: 'تنفيذ يومي', purpose: 'اتصل، سجّل الوعد، وحدّد المتابعة التالية',
    description: 'قائمة عمل فريق التحصيل. استخدمها بعد معرفة الدين لتوثيق المحاولات والوعود ومنع تكرار الاتصال من أكثر من موظف.',
    outcome: 'مالك واضح وخطوة تالية', tone: 'var(--red)',
  },
  {
    id: 'performance', label: 'أداء فريق التحصيل', icon: BarChart3, component: CollectionTeamPerformance, perm: 'collections.view_all',
    eyebrow: 'إشراف الفريق', purpose: 'قِس التحصيل المتحقق والوفاء بالوعود حسب الموظف',
    description: 'تقرير إشرافي يربط وعود السداد بدفعات Zoho الفعلية، ويكشف المهام غير المسندة والوعود المتأخرة دون تقييم الموظف بعدد المكالمات فقط.',
    outcome: 'مسؤولية ونتيجة مالية قابلة للقياس', tone: 'var(--accent3)',
  },
  {
    id: 'legal', label: 'الحالات القانونية', icon: Scale, component: LegalEscalation, perm: 'legal.view',
    eyebrow: 'تصعيد مضبوط', purpose: 'انقل فقط الحالات التي استنفدت التحصيل المعتاد',
    description: 'لا تبدأ الحالة من هنا. تصل بعد محاولات موثقة، ثم تُدار المستندات والإجراءات القانونية دون خلطها بقائمة الاتصالات اليومية.',
    outcome: 'ملف قانوني مكتمل المسار', tone: 'var(--gold)',
  },
  {
    id: 'internal', label: 'الأرصدة والمطابقة', icon: FileText, component: CustomerReceivables, perm: 'receivables.view',
    eyebrow: 'تدقيق ومطابقة', purpose: 'قارن كشف النظام الداخلي مع المرجع المالي',
    description: 'هذه شاشة فحص فروقات وربط بيانات، وليست المصدر الذي يُطالب العميل بناءً عليه. المطالبة تبدأ من «من يدين لك؟».',
    outcome: 'فروقات معروفة بلا تضارب', tone: 'var(--accent3)',
  },
];

const LEGACY_PATH_TO_TAB = {
  '/customer-money': 'money',
  '/collections':    'queue',
  '/legal':          'legal',
  '/receivables':    'internal',
};

export default function CollectionsHub({ isActive = true }) {
  const location = useLocation();
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <div className="ws-tab-body" style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {visibleTabs.map(t => {
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
              <Cmp isActive={isActive && active}/>
            </div>
          );
        })}
      </div>
    </div>
  );
}

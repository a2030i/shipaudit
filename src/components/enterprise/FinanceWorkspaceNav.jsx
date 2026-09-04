import { useLocation, useNavigate } from 'react-router-dom';
import { Tabs } from '../../design-system/EnterpriseUI.jsx';

const FINANCE_AREAS = [
  { id: 'overview', label: 'نظرة عامة', path: '/workspace/finance' },
  { id: 'receivables', label: 'الذمم', path: '/customer-money?view=money' },
  { id: 'collections', label: 'التحصيل', path: '/customer-money?view=queue' },
  { id: 'cash', label: 'النقد والبنوك', path: '/money?tab=bank' },
  { id: 'reconciliation', label: 'المطابقة', path: '/reconciliation?tab=customers' },
  { id: 'payables', label: 'الدائنون وCOD', path: '/zoho-data?tab=vendors&type=bills' },
  { id: 'control', label: 'الرقابة المالية', path: '/pnl' },
];

function activeArea(pathname, search) {
  const params = new URLSearchParams(search);
  if (pathname === '/workspace/finance') return 'overview';
  if (pathname === '/customer-money' || pathname === '/collections' || pathname === '/receivables') {
    return (params.get('view') || params.get('tab')) === 'queue' ? 'collections' : 'receivables';
  }
  if (pathname === '/money' || pathname === '/bank' || pathname === '/cod-settlements' || pathname === '/payments') {
    const tab = params.get('tab') || (pathname === '/cod-settlements' ? 'cod' : pathname === '/payments' ? 'payments' : 'bank');
    return ['cod', 'payments'].includes(tab) ? 'payables' : 'cash';
  }
  if (pathname === '/reconciliation') return 'reconciliation';
  if (pathname === '/zoho-data' && params.get('tab') === 'vendors') return 'payables';
  return 'control';
}

export default function FinanceWorkspaceNav({ active, onNavigate, className = '' }) {
  const location = useLocation();
  const navigate = useNavigate();
  const current = active || activeArea(location.pathname, location.search);
  const changeArea = id => {
    const area = FINANCE_AREAS.find(item => item.id === id);
    if (!area) return;
    (onNavigate || navigate)(area.path);
  };

  return (
    <nav className={`finance-workspace-nav ${className}`.trim()} aria-label="أقسام مركز المالية">
      <Tabs items={FINANCE_AREAS} active={current} onChange={changeArea} label="قسم مركز المالية"/>
    </nav>
  );
}

export { FINANCE_AREAS, activeArea };

import { useLocation, useNavigate } from 'react-router-dom';
import { Tabs } from '../../design-system/EnterpriseUI.jsx';

const OPERATIONS_AREAS = [
  { id: 'overview', label: 'نظرة عامة', path: '/workspace/operations' },
  { id: 'carriers', label: 'شركات الشحن', path: '/hub' },
  { id: 'exceptions', label: 'الاستثناءات', path: '/tasks' },
  { id: 'cycle', label: 'دورة المحاسب', path: '/accounting-cycle' },
  { id: 'invoices', label: 'الفواتير والملفات', path: '/audits' },
  { id: 'billing', label: 'فوترة الخدمات', path: '/fulfillment' },
  { id: 'settlements', label: 'COD والتسويات', path: '/money?tab=cod' },
];

function activeArea(pathname) {
  if (pathname === '/workspace/operations') return 'overview';
  if (['/hub', '/carrier', '/claims', '/carrier-kpi'].includes(pathname)) return 'carriers';
  if (pathname === '/tasks') return 'exceptions';
  if (pathname === '/accounting-cycle') return 'cycle';
  if (['/drop', '/audits', '/upload', '/results', '/aramex-statements', '/ledger'].includes(pathname)) return 'invoices';
  if (['/fulfillment', '/weight-billing'].includes(pathname)) return 'billing';
  return 'settlements';
}

export default function OperationsWorkspaceNav({ active, onNavigate, className = '' }) {
  const location = useLocation();
  const navigate = useNavigate();
  const current = active || activeArea(location.pathname);
  const changeArea = id => {
    const area = OPERATIONS_AREAS.find(item => item.id === id);
    if (!area) return;
    (onNavigate || navigate)(area.path);
  };

  return (
    <nav className={`operations-workspace-nav ${className}`.trim()} aria-label="أقسام مركز التشغيل">
      <Tabs items={OPERATIONS_AREAS} active={current} onChange={changeArea} label="قسم مركز التشغيل"/>
    </nav>
  );
}

export { OPERATIONS_AREAS, activeArea };

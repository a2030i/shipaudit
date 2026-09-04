import { useLocation, useNavigate } from 'react-router-dom';
import { Tabs } from '../../design-system/EnterpriseUI.jsx';

const SALES_AREAS = [
  { id: 'overview', label: 'نظرة عامة', path: '/workspace/sales?view=overview' },
  { id: 'pipeline', label: 'مسار المبيعات', path: '/workspace/sales?view=pipeline' },
  { id: 'prospects', label: 'العملاء والفرص', path: '/workspace/sales?view=external' },
  { id: 'followup', label: 'المتابعة', path: '/workspace/sales?view=today' },
  { id: 'tasks', label: 'مهام الاستعادة', path: '/workspace/sales?view=retargeting' },
  { id: 'segments', label: 'الشرائح والعروض', path: '/workspace/sales?view=segments' },
];

const VIEW_TO_AREA = {
  activation: 'overview', overview: 'overview',
  pipeline: 'pipeline',
  external: 'prospects', hatif: 'prospects',
  today: 'followup',
  retargeting: 'tasks',
  segments: 'segments',
};

function activeArea(pathname, search) {
  const params = new URLSearchParams(search);
  const view = params.get('view') || params.get('tab');
  if (VIEW_TO_AREA[view]) return VIEW_TO_AREA[view];
  if (pathname === '/hatif-leads') return 'prospects';
  if (pathname === '/segments') return 'segments';
  if (pathname === '/next-actions') return 'followup';
  if (pathname === '/retargeting') return 'pipeline';
  return 'overview';
}

export default function SalesWorkspaceNav({ active, onNavigate, items = SALES_AREAS, className = '' }) {
  const location = useLocation();
  const navigate = useNavigate();
  const current = active || activeArea(location.pathname, location.search);
  const changeArea = id => {
    const area = items.find(item => item.id === id);
    if (!area) return;
    (onNavigate || navigate)(area.path);
  };

  return (
    <nav className={`sales-workspace-nav ${className}`.trim()} aria-label="أقسام مركز المبيعات">
      <Tabs items={items} active={current} onChange={changeArea} label="قسم مركز المبيعات"/>
    </nav>
  );
}

export { SALES_AREAS, activeArea, VIEW_TO_AREA };

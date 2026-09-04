import { useLocation, useNavigate } from 'react-router-dom';
import { Tabs } from '../../design-system/EnterpriseUI.jsx';

const ADMIN_WORKSPACE_VIEWS = [
  { id: 'overview', label: 'نظرة عامة' },
  { id: 'access', label: 'المستخدمون والوصول' },
  { id: 'integrations', label: 'التكاملات' },
  { id: 'records', label: 'العقود والملفات' },
  { id: 'health', label: 'صحة النظام' },
  { id: 'advanced', label: 'أدوات متقدمة' },
];

function adminArea(pathname, search = '') {
  if (pathname === '/workspace/admin') {
    const view = new URLSearchParams(search).get('view');
    return ADMIN_WORKSPACE_VIEWS.some(item => item.id === view) ? view : 'overview';
  }
  if (pathname === '/employees') return 'access';
  if (pathname === '/operations' || pathname === '/settings/hatif') return 'integrations';
  if (pathname === '/carriers' || pathname === '/contracts') return 'records';
  if (pathname === '/integrity') return 'health';
  return 'advanced';
}

export default function AdminWorkspaceNav({ active, items = ADMIN_WORKSPACE_VIEWS, onChange }) {
  const location = useLocation();
  const navigate = useNavigate();
  const current = active || adminArea(location.pathname, location.search);
  const change = id => {
    if (onChange) return onChange(id);
    const next = new URLSearchParams();
    if (id !== 'overview') next.set('view', id);
    navigate(`/workspace/admin${next.size ? `?${next.toString()}` : ''}`);
  };
  return (
    <nav className="admin-workspace-nav" aria-label="أقسام مركز الإدارة">
      <Tabs items={items} active={current} onChange={change} label="قسم مركز الإدارة"/>
    </nav>
  );
}

export { ADMIN_WORKSPACE_VIEWS, adminArea };

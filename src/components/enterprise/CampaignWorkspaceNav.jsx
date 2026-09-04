import { useLocation, useNavigate } from 'react-router-dom';
import { Tabs } from '../../design-system/EnterpriseUI.jsx';

const CAMPAIGN_AREAS = [
  { id: 'overview', label: 'نظرة عامة', path: '/workspace/campaigns?view=overview' },
  { id: 'audiences', label: 'الجمهور', path: '/workspace/campaigns?view=audiences' },
  { id: 'draft', label: 'الإعداد والمسودات', path: '/workspace/campaigns?view=draft' },
  { id: 'launch', label: 'المراجعة والإطلاق', path: '/workspace/campaigns?view=launch' },
  { id: 'active', label: 'الحملات النشطة', path: '/workspace/campaigns?view=active' },
  { id: 'results', label: 'النتائج والسجل', path: '/whatsapp-settings?tab=campaigns&source=campaigns-workspace' },
];

function activeArea(pathname, search) {
  const params = new URLSearchParams(search);
  if (pathname === '/whatsapp-settings') return 'results';
  const view = params.get('view');
  return CAMPAIGN_AREAS.some(item => item.id === view) ? view : 'overview';
}

export default function CampaignWorkspaceNav({ active, onNavigate, className = '' }) {
  const location = useLocation();
  const navigate = useNavigate();
  const current = active || activeArea(location.pathname, location.search);
  const changeArea = id => {
    const area = CAMPAIGN_AREAS.find(item => item.id === id);
    if (!area) return;
    (onNavigate || navigate)(area.path);
  };

  return (
    <nav className={`campaign-workspace-nav ${className}`.trim()} aria-label="أقسام مركز الحملات">
      <Tabs items={CAMPAIGN_AREAS} active={current} onChange={changeArea} label="قسم مركز الحملات"/>
    </nav>
  );
}

export { CAMPAIGN_AREAS, activeArea };

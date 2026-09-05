import { Tabs } from '../../design-system/EnterpriseUI.jsx';

export const REPORT_WORKSPACE_VIEWS = [
  { id: 'index', label: 'دليل التقارير' },
  { id: 'builder', label: 'التقارير الرسمية' },
  { id: 'monthly', label: 'التقرير الشهري' },
  { id: 'exports', label: 'الملفات المصدّرة' },
];

export default function ReportsWorkspaceNav({ active = 'index', items = REPORT_WORKSPACE_VIEWS, onChange }) {
  return (
    <nav className="reports-workspace-nav" aria-label="أقسام مركز التقارير">
      <Tabs items={items} active={active} onChange={onChange} label="قسم مركز التقارير"/>
    </nav>
  );
}

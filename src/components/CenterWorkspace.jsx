import WorkspaceTabs from './WorkspaceTabs.jsx';
import { useLocation } from 'react-router-dom';

// غلاف خفيف لدمج صفحات قائمة كاملة داخل مركز واحد. يحتفظ كل تبويب بمساره
// القديم، لذلك الروابط المحفوظة والصلاحيات لا تتغير أثناء إعادة الهيكلة.
export default function CenterWorkspace({ scope, title, subtitle, tone, tabs, activePath, onNavigate, showSwitcher = false }) {
  const location = useLocation();
  const active = tabs.find(tab => tab.path === activePath) || tabs[0];
  if (!active) return null;

  const changeView = (tabId) => {
    const next = tabs.find(tab => tab.id === tabId);
    if (!next || next.path === activePath) return;
    // احتفظ بفلاتر الفترة/الناقل/البحث عند الانتقال بين Views. `tab`
    // يخص الصفحة السابقة غالبًا، لذلك لا ننقله إلى صفحة أخرى بمعنى مختلف.
    const params = new URLSearchParams(location.search);
    params.delete('tab');
    const query = params.toString();
    onNavigate(`${next.path}${query ? `?${query}` : ''}`);
  };

  return (
    <div className="center-workspace">
      {showSwitcher ? (
        <WorkspaceTabs
          scope={scope}
          title={title}
          subtitle={subtitle}
          tone={tone}
          tabs={tabs}
          activeId={active.id}
          onChange={changeView}
        />
      ) : null}
      <section
        id={`${scope}-panel-${active.id}`}
        className="center-workspace__panel"
        role="tabpanel"
        aria-label={active.label}
      >
        {active.render()}
      </section>
    </div>
  );
}

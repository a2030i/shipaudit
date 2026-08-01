import WorkspaceTabs, { workspacePanelId, workspaceTabId } from './WorkspaceTabs.jsx';

// غلاف خفيف لدمج صفحات قائمة كاملة داخل مركز واحد. يحتفظ كل تبويب بمساره
// القديم، لذلك الروابط المحفوظة والصلاحيات لا تتغير أثناء إعادة الهيكلة.
export default function CenterWorkspace({ scope, title, subtitle, tone, tabs, activePath, onNavigate }) {
  const active = tabs.find(tab => tab.path === activePath) || tabs[0];
  if (!active) return null;
  return (
    <div className="center-workspace">
      <WorkspaceTabs
        scope={scope}
        title={title}
        subtitle={subtitle}
        tone={tone}
        tabs={tabs}
        activeId={active.id}
        onChange={(id) => {
          const next = tabs.find(tab => tab.id === id);
          if (next) onNavigate(next.path);
        }}
      />
      <section
        className="center-workspace__panel"
        role="tabpanel"
        id={workspacePanelId(scope, active.id)}
        aria-labelledby={workspaceTabId(scope, active.id)}
      >
        {active.render()}
      </section>
    </div>
  );
}

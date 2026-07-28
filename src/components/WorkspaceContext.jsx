export default function WorkspaceContext({ tab }) {
  if (!tab) return null;
  const Icon = tab.icon;

  return (
    <section className="workspace-context" style={{ '--workspace-tone': tab.tone || 'var(--brand)' }}>
      <span className="workspace-context-icon"><Icon size={19}/></span>
      <div className="workspace-context-copy">
        <span>{tab.eyebrow}</span>
        <strong>{tab.purpose}</strong>
        <p>{tab.description}</p>
      </div>
      <div className="workspace-context-outcome">
        <small>النتيجة هنا</small>
        <strong>{tab.outcome}</strong>
      </div>
    </section>
  );
}

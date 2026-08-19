// غلاف خفيف لدمج صفحات قائمة كاملة داخل مركز واحد. يحتفظ كل تبويب بمساره
// القديم، لذلك الروابط المحفوظة والصلاحيات لا تتغير أثناء إعادة الهيكلة.
export default function CenterWorkspace({ scope, tabs, activePath }) {
  const active = tabs.find(tab => tab.path === activePath) || tabs[0];
  if (!active) return null;

  return (
    <div className="center-workspace">
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

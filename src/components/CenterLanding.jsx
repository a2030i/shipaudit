import { ArrowLeft, Sparkles } from 'lucide-react';

const OUTCOMES = {
  customers: 'ابدأ من العميل، ثم انتقل إلى خدمته وحالته دون البحث في أقسام أخرى.',
  sales: 'تابع الفرصة من دخولها حتى الإغلاق والحملة والمسؤول عنها.',
  finance: 'اعرف ما لك وما عليك، ثم انتقل للتحصيل والبنك وزوهو والربحية.',
  shipping: 'شغّل دورة الشحن والفوترة الشهرية من نقطة واحدة واضحة.',
  reports: 'اقرأ المؤشرات والتقارير والمصادر التي تحتاج مراجعة.',
  settings: 'أدر الفريق والصلاحيات والعقود والتكاملات من مركز واحد.',
};

function destinationsFor(group, visibleSubTabsFor, subTabPath) {
  return group.items.flatMap(item => {
    const tabs = visibleSubTabsFor?.(item) || [];
    if (tabs.length === 0) return [{
      id: item.id, label: item.label, description: item.description || 'فتح مساحة العمل',
      icon: item.icon, path: item.path,
    }];
    if (tabs.length === 1) return [{
      id: `${item.id}-${tabs[0].tabId}`,
      label: item.label,
      description: tabs[0].label,
      icon: item.icon,
      path: subTabPath(item, tabs[0]),
    }];
    return tabs.map(tab => ({
      id: `${item.id}-${tab.tabId}`,
      label: tab.label,
      description: item.label,
      icon: tab.icon || item.icon,
      path: subTabPath(item, tab),
    }));
  });
}

function workspaceDestinationsFor(groups, workspaces) {
  const itemById = new Map(groups.flatMap(group => group.items).map(item => [item.id, item]));
  return workspaces.flatMap(workspace => {
    const members = workspace.memberIds.map(id => itemById.get(id)).filter(Boolean);
    if (!members.length) return [];
    const entry = itemById.get(workspace.entryId) || members[0];
    return [{
      id: workspace.id,
      label: workspace.label,
      description: workspace.description,
      icon: entry.icon,
      path: entry.path,
    }];
  });
}

export default function CenterLanding({ section, groups, workspaces, visibleSubTabsFor, subTabPath, onNavigate, onQuickAction }) {
  if (!section) return null;
  const Icon = section.icon;
  const destinationGroups = workspaces?.length
    ? [{ id: `${section.id}-workspaces`, label: 'مساحات العمل', destinations: workspaceDestinationsFor(groups, workspaces) }]
    : groups.map(group => ({
      ...group,
      destinations: destinationsFor(group, visibleSubTabsFor, subTabPath),
    }));
  const itemCount = destinationGroups.reduce((sum, group) => sum + group.destinations.length, 0);

  return (
    <div className="center-landing" style={{ '--center-accent': section.accent }}>
      <header className="center-landing__hero">
        <div className="center-landing__icon"><Icon size={26}/></div>
        <div>
          <span className="center-landing__eyebrow">مركز عمل</span>
          <h1>{section.label}</h1>
          <p>{OUTCOMES[section.id] || section.hint}</p>
        </div>
        <button type="button" className="center-landing__action" onClick={onQuickAction}>
          <Sparkles size={17}/><span>إجراء جديد</span>
        </button>
      </header>

      <div className="center-landing__summary">
        <strong>{itemCount}</strong>
        <span>مساحات عمل متاحة حسب صلاحياتك</span>
      </div>

      <div className="center-landing__groups">
        {destinationGroups.map(group => (
          <section className="center-landing__group" key={group.id}>
            {group.label && <h2>{group.label}</h2>}
            <div className="center-landing__grid">
              {group.destinations.map(destination => {
                const ItemIcon = destination.icon;
                return (
                  <button type="button" className="center-landing__card" key={destination.id} onClick={() => onNavigate(destination.path)}>
                    <span className="center-landing__card-icon"><ItemIcon size={19}/></span>
                    <span>
                      <strong>{destination.label}</strong>
                      <small>{destination.description}</small>
                    </span>
                    <ArrowLeft size={17}/>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

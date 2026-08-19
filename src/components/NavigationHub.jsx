import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, LayoutDashboard, LogOut, Plus, X,
} from 'lucide-react';

const CENTER_ORDER = ['customers', 'sales', 'finance', 'shipping', 'reports', 'settings'];

export function sectionDestinations(sectionId, workspaces, navItems) {
  const itemsById = new Map(navItems.map(item => [item.id, item]));
  return (workspaces?.[sectionId] || []).flatMap(workspace => {
    const members = workspace.memberIds.map(id => itemsById.get(id)).filter(Boolean);
    if (!members.length) return [];
    const entry = itemsById.get(workspace.entryId) || members[0];
    return [{
      id: workspace.id,
      label: workspace.label,
      description: workspace.description,
      icon: entry.icon,
      path: workspace.pathsByMemberId?.[entry.id] || workspace.path || entry.path,
    }];
  });
}

export function firstSectionDestination(sectionId, workspaces, navItems) {
  return sectionDestinations(sectionId, workspaces, navItems)[0]?.path || '/overview';
}

export default function NavigationHub({
  open,
  initialSectionId,
  sections,
  workspaces,
  navItems,
  canOpenHome,
  currentSectionId,
  profile,
  roleLabel,
  onClose,
  onNavigate,
  onQuickAction,
  onSignOut,
}) {
  const [sectionId, setSectionId] = useState(null);
  const panelRef = useRef(null);
  const closeRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    setSectionId(initialSectionId || null);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => closeRef.current?.focus());
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open, initialSectionId]);

  const orderedSections = useMemo(() => CENTER_ORDER
    .map(id => sections.find(section => section.id === id))
    .filter(Boolean)
    .map(section => ({
      ...section,
      destinations: sectionDestinations(section.id, workspaces, navItems),
    }))
    .filter(section => section.destinations.length > 0), [sections, workspaces, navItems]);

  const activeSection = orderedSections.find(section => section.id === sectionId) || null;
  const destinations = activeSection?.destinations || [];

  if (!open) return null;

  const activate = (path) => {
    onNavigate(path);
    onClose();
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = panelRef.current?.querySelectorAll(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="navigation-hub" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        ref={panelRef}
        className="navigation-hub__sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="navigation-hub-title"
        dir="rtl"
        onKeyDown={handleKeyDown}
      >
        <div className="navigation-hub__grabber" aria-hidden="true"/>

        <header className="navigation-hub__header">
          <div className="navigation-hub__identity" aria-label={`المستخدم ${profile?.name || ''}`}>
            <span className="navigation-hub__avatar" style={{ '--avatar-color': profile?.avatar_color || '#10b981' }}>
              {profile?.name?.[0] || 'ل'}
            </span>
            <span>
              <strong>{profile?.name || 'لمحة'}</strong>
              <small>{roleLabel || profile?.role || ''}</small>
            </span>
          </div>
          <div className="navigation-hub__header-actions">
            <button type="button" className="navigation-hub__logout" onClick={onSignOut} aria-label="تسجيل الخروج">
              <LogOut size={18}/><span>خروج</span>
            </button>
            <button ref={closeRef} type="button" className="navigation-hub__close" onClick={onClose} aria-label="إغلاق قائمة التنقل">
              <X size={21}/>
            </button>
          </div>
        </header>

        {activeSection ? (
          <>
            <div className="navigation-hub__section-heading">
              <span className="navigation-hub__section-icon" style={{ '--section-accent': activeSection.accent }}>
                <activeSection.icon size={25}/>
              </span>
              <span>
                <h2 id="navigation-hub-title">{activeSection.label}</h2>
                <p>اختر القسم الذي تريد فتحه</p>
              </span>
              <button type="button" className="navigation-hub__back" onClick={() => setSectionId(null)} aria-label="كل المراكز">
                <ArrowRight size={17}/><span>كل المراكز</span>
              </button>
            </div>

            <button type="button" className="navigation-hub__quick-action" onClick={() => { onClose(); onQuickAction(); }}>
              <Plus size={20}/><span>إجراء جديد</span>
            </button>

            <div className="navigation-hub__destinations" aria-label={`أقسام ${activeSection.label}`}>
              {destinations.map(destination => {
                const Icon = destination.icon;
                return (
                  <button type="button" key={destination.id} className="navigation-hub__destination" onClick={() => activate(destination.path)}>
                    <span className="navigation-hub__destination-icon"><Icon size={25}/></span>
                    <strong>{destination.label}</strong>
                    <small>{destination.description}</small>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <div className="navigation-hub__title-row">
              <span>
                <h2 id="navigation-hub-title">أين تريد أن تذهب؟</h2>
                <p>اختر المركز، ثم القسم المطلوب</p>
              </span>
              <button type="button" className="navigation-hub__quick-action navigation-hub__quick-action--compact" onClick={() => { onClose(); onQuickAction(); }}>
                <Plus size={18}/><span>إجراء جديد</span>
              </button>
            </div>

            <div className="navigation-hub__centers" aria-label="مراكز النظام">
              {canOpenHome ? (
                <button type="button" className={`navigation-hub__center${!currentSectionId ? ' is-active' : ''}`} onClick={() => activate('/overview')}>
                  <span className="navigation-hub__center-icon"><LayoutDashboard size={25}/></span>
                  <strong>الرئيسية</strong>
                </button>
              ) : null}
              {orderedSections.map(section => {
                const Icon = section.icon;
                return (
                  <button
                    type="button"
                    key={section.id}
                    className={`navigation-hub__center${currentSectionId === section.id ? ' is-active' : ''}`}
                    style={{ '--section-accent': section.accent }}
                    onClick={() => setSectionId(section.id)}
                  >
                    <span className="navigation-hub__center-icon"><Icon size={25}/></span>
                    <strong>{section.label}</strong>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

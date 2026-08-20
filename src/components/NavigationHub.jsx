import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, ChevronLeft, LayoutDashboard, LogOut, Plus, X,
} from 'lucide-react';

const CENTER_ORDER = ['customers', 'sales', 'finance', 'shipping', 'reports', 'settings'];

function queryPath(path, key, value, currentSearch = '', preserveCurrentQuery = false) {
  const [pathname, ownSearch = ''] = String(path || '/overview').split('?');
  const params = new URLSearchParams(preserveCurrentQuery ? currentSearch : ownSearch);
  params.set(key, value);
  return `${pathname}?${params.toString()}`;
}

function subTabPath(item, subTab) {
  if (subTab.legacy) return subTab.legacy;
  return queryPath(item.path, subTab.queryKey || item.queryKey || 'tab', subTab.tabId);
}

function subTabNodes(item, canOpenSubTab, allowedIds) {
  return (item.subTabs || [])
    .filter(tab => !allowedIds || allowedIds.includes(tab.tabId))
    .filter(tab => !canOpenSubTab || canOpenSubTab(tab))
    .map(tab => ({
      id: `${item.id}:${tab.tabId}`,
      label: tab.label,
      description: tab.description,
      icon: tab.icon || item.icon,
      path: subTabPath(item, tab),
      children: (tab.children || [])
        .filter(child => !canOpenSubTab || canOpenSubTab(child))
        .map(child => {
          const params = new URLSearchParams();
          params.set('tab', tab.tabId);
          params.set(child.queryKey || 'type', child.tabId);
          return {
            id: `${item.id}:${tab.tabId}:${child.tabId}`,
            label: child.label,
            description: child.description,
            icon: child.icon || tab.icon || item.icon,
            path: child.legacy || `${item.path}?${params.toString()}`,
          };
        }),
    }));
}

function currentEntityNodes(workspace, entry, currentPath, currentSearch) {
  const params = new URLSearchParams(currentSearch);
  if (workspace.id === 'directory') {
    const base = [
      ['overview', 'دليل العملاء والمتاجر', 'البحث وفتح ملف المتجر'],
      ['risks', 'الحالات التي تحتاج متابعة', 'المتاجر ذات المخاطر والتنبيهات'],
      ['lists', 'القوائم المحفوظة', 'قوائم العمل المصنفة'],
    ].map(([id, label, description]) => ({
      id: `directory:${id}`, label, description, icon: entry.icon,
      path: `/customer-360?view=${id}`,
    }));
    const hasEntity = currentPath === '/customer-360' && (params.get('customer') || params.get('open') === '1');
    if (!hasEntity) return base;
    return [...base, {
      id: 'directory:current', label: 'ملف المتجر الحالي', description: 'كل ما يخص المتجر المفتوح', icon: entry.icon,
      children: [
        ['overview', 'نظرة عامة'], ['finance', 'المالية والفواتير'], ['work', 'المبيعات والتحصيل'],
        ['shipments', 'الشحنات والناقلون'], ['communications', 'التواصل'], ['timeline', 'النشاط الكامل'],
      ].map(([id, label]) => ({
        id: `store:${id}`, label, icon: entry.icon,
        path: queryPath('/customer-360', 'view', id, currentSearch, true),
      })),
    }];
  }

  if (workspace.id === 'carrier-control') {
    const base = [
      { id: 'carrier:all', label: 'كل شركات الشحن', description: 'اختر الشركة التي تريد العمل عليها', icon: entry.icon, path: '/hub' },
      ...(entry.subTabs || []).slice(1).map(tab => ({
        id: `carrier-list:${tab.tabId}`, label: tab.label, icon: tab.icon || entry.icon, path: subTabPath(entry, tab),
      })),
    ];
    if (currentPath !== '/carrier' || !params.get('id')) return base;
    return [...base, {
      id: 'carrier:current', label: 'ملف شركة الشحن الحالية', description: 'كل أعمال الشركة المفتوحة', icon: entry.icon,
      children: [
        ['overview', 'نظرة عامة'], ['invoices', 'الفواتير والمراجعة'], ['shipments', 'الشحنات'],
        ['claims', 'المطالبات'], ['account', 'الحساب والمدفوعات'], ['contract', 'العقد والأسعار'], ['performance', 'الأداء'],
      ].map(([id, label]) => ({
        id: `carrier:${id}`, label, icon: entry.icon,
        path: queryPath('/carrier', 'view', id, currentSearch, true),
      })),
    }];
  }
  return null;
}

export function sectionDestinations(sectionId, workspaces, navItems, options = {}) {
  const itemsById = new Map(navItems.map(item => [item.id, item]));
  return (workspaces?.[sectionId] || []).flatMap(workspace => {
    const members = workspace.memberIds.map(id => itemsById.get(id)).filter(Boolean);
    if (!members.length) return [];
    const entry = itemsById.get(workspace.entryId) || members[0];
    const entityChildren = currentEntityNodes(
      workspace, entry, options.currentPath || '', options.currentSearch || '',
    );
    const memberNodes = members.map(member => {
      const children = workspace.skipSubTabs
        ? []
        : subTabNodes(member, options.canOpenSubTab, workspace.subTabIds);
      const path = workspace.pathsByMemberId?.[member.id] || (member.id === entry.id ? workspace.path : null) || member.path;
      if (children.length) {
        return {
          id: `${workspace.id}:${member.id}`,
          label: member.label,
          description: member.description,
          icon: member.icon,
          path,
          children,
        };
      }
      return { id: `${workspace.id}:${member.id}`, label: member.label, icon: member.icon, path };
    });
    const children = entityChildren || (workspace.skipSubTabs
      ? []
      : (members.length === 1 ? memberNodes[0]?.children : memberNodes));
    return [{
      id: workspace.id,
      label: workspace.label,
      description: workspace.description,
      icon: entry.icon,
      path: workspace.pathsByMemberId?.[entry.id] || workspace.path || entry.path,
      children: children?.length ? children : undefined,
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
  canOpenSubTab,
  currentSectionId,
  currentPath,
  currentSearch,
  profile,
  roleLabel,
  onClose,
  onNavigate,
  onQuickAction,
  onSignOut,
}) {
  const [sectionId, setSectionId] = useState(null);
  const [trail, setTrail] = useState([]);
  const panelRef = useRef(null);
  const closeRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    setSectionId(initialSectionId || null);
    setTrail([]);
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
      destinations: sectionDestinations(section.id, workspaces, navItems, {
        canOpenSubTab, currentPath, currentSearch,
      }),
    }))
    .filter(section => section.destinations.length > 0), [
      sections, workspaces, navItems, canOpenSubTab, currentPath, currentSearch,
    ]);

  const activeSection = orderedSections.find(section => section.id === sectionId) || null;
  const activeNode = trail.at(-1) || null;
  const destinations = activeNode?.children || activeSection?.destinations || [];
  const heading = activeNode?.label || activeSection?.label;

  if (!open) return null;

  const activate = (node) => {
    if (node.children?.length) {
      setTrail(previous => [...previous, node]);
      return;
    }
    onNavigate(node.path);
    onClose();
  };

  const goBack = () => {
    if (trail.length) {
      setTrail(previous => previous.slice(0, -1));
      return;
    }
    setSectionId(null);
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
                <h2 id="navigation-hub-title">{heading}</h2>
                <p>{activeNode ? activeSection.label : 'اختر القسم الذي تريد فتحه'}</p>
              </span>
              <button type="button" className="navigation-hub__back" onClick={goBack} aria-label={trail.length ? 'المستوى السابق' : 'كل المراكز'}>
                <ArrowRight size={17}/><span>{trail.length ? 'رجوع' : 'كل المراكز'}</span>
              </button>
            </div>

            {trail.length ? (
              <div className="navigation-hub__trail" aria-label="مسار الأقسام">
                <span>{activeSection.label}</span>{trail.map(node => <span key={node.id}>{node.label}</span>)}
              </div>
            ) : (
              <button type="button" className="navigation-hub__quick-action" onClick={() => { onClose(); onQuickAction(); }}>
                <Plus size={20}/><span>إجراء جديد</span>
              </button>
            )}

            <div className="navigation-hub__destinations" aria-label={`أقسام ${heading}`}>
              {destinations.map(destination => {
                const Icon = destination.icon || activeSection.icon;
                return (
                  <button type="button" key={destination.id} className="navigation-hub__destination" onClick={() => activate(destination)}>
                    <span className="navigation-hub__destination-icon"><Icon size={25}/></span>
                    <strong>{destination.label}</strong>
                    <small>{destination.description || (destination.children?.length ? `${destination.children.length} أقسام` : 'فتح القسم')}</small>
                    {destination.children?.length ? <ChevronLeft className="navigation-hub__destination-arrow" size={18} aria-hidden="true"/> : null}
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
                <button type="button" className={`navigation-hub__center${!currentSectionId ? ' is-active' : ''}`} onClick={() => activate({ path: '/overview' })}>
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
                    onClick={() => { setSectionId(section.id); setTrail([]); }}
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

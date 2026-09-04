import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, LogOut, Plus, X,
} from 'lucide-react';

const CENTER_ORDER = ['customers', 'sales', 'campaigns', 'finance', 'shipping', 'reports', 'settings'];
const MOBILE_OVERFLOW_CENTERS = new Set(['campaigns', 'shipping', 'reports', 'settings']);

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
        ['overview', 'نظرة عامة'], ['finance', 'المالية'], ['shipments', 'الشحن'],
        ['work', 'التحصيل'], ['communications', 'التواصل'], ['timeline', 'النشاط'], ['alerts', 'المشاكل والتنبيهات'],
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
  const overlayRef = useRef(null);
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

  useEffect(() => {
    if (!open) return undefined;

    const viewport = window.visualViewport;
    const syncVisibleViewport = () => {
      const overlay = overlayRef.current;
      if (!overlay) return;
      overlay.style.setProperty(
        '--navigation-viewport-height',
        `${Math.round(viewport?.height || window.innerHeight)}px`,
      );
      overlay.style.setProperty(
        '--navigation-viewport-top',
        `${Math.round(viewport?.offsetTop || 0)}px`,
      );
    };

    syncVisibleViewport();
    viewport?.addEventListener('resize', syncVisibleViewport);
    viewport?.addEventListener('scroll', syncVisibleViewport, { passive: true });
    window.addEventListener('orientationchange', syncVisibleViewport);
    return () => {
      viewport?.removeEventListener('resize', syncVisibleViewport);
      viewport?.removeEventListener('scroll', syncVisibleViewport);
      window.removeEventListener('orientationchange', syncVisibleViewport);
    };
  }, [open]);

  const orderedSections = useMemo(() => CENTER_ORDER
    .map(id => sections.find(section => section.id === id))
    .filter(Boolean)
    .map(section => ({
      ...section,
      // القائمة تعرض مساحة العمل الأساسية فقط. تفاصيل مثل سجل الرسائل،
      // القيود اليومية أو سجل النظام تبقى داخل مركزها ولا تتحول إلى زر
      // مستقل يزاحم المهمة اليومية.
      destinations: sectionDestinations(section.id, workspaces, navItems, {
        canOpenSubTab, currentPath, currentSearch,
      }),
    }))
    .filter(section => section.destinations.length > 0), [
      sections, workspaces, navItems, canOpenSubTab, currentPath, currentSearch,
    ]);

  const activeSection = orderedSections.find(section => section.id === sectionId) || null;
  const centerRows = orderedSections
    .filter(section => MOBILE_OVERFLOW_CENTERS.has(section.id))
    .map(section => ({
      id: `center:${section.id}`,
      label: section.label,
      description: section.hint || 'فتح مركز العمل',
      icon: section.icon,
      path: section.path,
      sectionId: section.id,
    }));

  if (!open) return null;

  const activate = (node) => {
    onNavigate(node.path);
    onClose();
  };

  const goBack = () => setSectionId(null);

  const renderDestinations = (section, destinations = section.destinations) => (
    <div className="navigation-hub__destinations" aria-label={`أقسام ${section.label}`}>
      {destinations.map(destination => {
        const Icon = destination.icon || section.icon;
        return (
          <button type="button" key={destination.id} className="navigation-hub__destination" onClick={() => activate(destination)}>
            <span className="navigation-hub__destination-icon"><Icon size={25}/></span>
            <strong>{destination.label}</strong>
            <small>{destination.description || destination.navigationContext || 'فتح القسم'}</small>
          </button>
        );
      })}
    </div>
  );

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
    <div ref={overlayRef} className="navigation-hub" role="presentation" onMouseDown={event => {
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
                <p>الوجهات الأساسية فقط؛ التفاصيل داخل كل مركز</p>
              </span>
              <button type="button" className="navigation-hub__back" onClick={goBack} aria-label="كل أقسام النظام">
                <ArrowRight size={17}/><span>كل الأقسام</span>
              </button>
            </div>

            <button type="button" className="navigation-hub__quick-action" onClick={() => { onClose(); onQuickAction(); }}>
              <Plus size={20}/><span>إجراء جديد</span>
            </button>

            {renderDestinations(activeSection)}
          </>
        ) : (
          <>
            <div className="navigation-hub__title-row">
              <span>
                <h2 id="navigation-hub-title">المزيد</h2>
                <p>الحملات والتشغيل والتقارير والإدارة</p>
              </span>
              <button type="button" className="navigation-hub__quick-action navigation-hub__quick-action--compact" onClick={() => { onClose(); onQuickAction(); }}>
                <Plus size={18}/><span>إجراء جديد</span>
              </button>
            </div>

            <div className="navigation-hub__catalog navigation-hub__center-list" aria-label="أقسام النظام">
              {centerRows.map(row => {
                const Icon = row.icon;
                const active = currentSectionId === row.sectionId;
                return (
                  <button
                    type="button"
                    key={row.id}
                    className={`navigation-hub__center-row${active ? ' is-active' : ''}`}
                    style={{ '--section-accent': row.accent }}
                    onClick={() => activate(row)}
                  >
                    <span className="navigation-hub__destination-icon"><Icon size={21}/></span>
                    <span><strong>{row.label}</strong><small>{row.description}</small></span>
                    <ArrowRight size={17}/>
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

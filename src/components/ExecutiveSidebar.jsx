import { ChevronLeft, LayoutDashboard, LogOut } from 'lucide-react';
import { LamhaLogo } from './BrandLogo.jsx';

const HOME_PATHS = new Set(['/overview', '/decisions']);
const SECTION_ORDER = ['customers', 'sales', 'campaigns', 'finance', 'shipping', 'reports', 'settings'];

export default function ExecutiveSidebar({
  sections,
  navItems,
  currentSectionId,
  pathname,
  profile,
  roleLabel,
  canOpenHome,
  onNavigate,
  onSignOut,
}) {
  const visibleSections = SECTION_ORDER
    .map(id => sections.find(section => section.id === id))
    .filter(section => section && navItems.some(item => item.section === section.id));

  return (
    <aside className="sidebar" aria-label="التنقل الرئيسي">
      <header className="sidebar-logo">
        <div className="sidebar-brand-lockup">
          <span className="sidebar-brand-logo sidebar-brand-logo--desktop"><LamhaLogo height={29} variant="color"/></span>
          <span className="sidebar-brand-logo sidebar-brand-logo--mobile"><LamhaLogo height={29} variant="color"/></span>
          <span className="sidebar-product-label"><i className="live-dot"/> نظام تشغيل الشركة</span>
        </div>
      </header>

      <nav className="sidebar-nav" aria-label="مجالات العمل">
        <div className="primary-center-nav">
          {canOpenHome ? (
            <button
              type="button"
              className={`primary-center-item${HOME_PATHS.has(pathname) ? ' active' : ''}`}
              aria-current={HOME_PATHS.has(pathname) ? 'page' : undefined}
              onClick={() => onNavigate('/overview')}
            >
              <span className="primary-center-item__icon"><LayoutDashboard size={19}/></span>
              <span><strong>الرئيسية</strong><small>القرارات والاستثناءات</small></span>
              <ChevronLeft size={15}/>
            </button>
          ) : null}

          {visibleSections.map(section => {
            const Icon = section.icon;
            const active = currentSectionId === section.id;
            return (
              <button
                type="button"
                className={`primary-center-item${active ? ' active' : ''}`}
                aria-current={active ? 'page' : undefined}
                onClick={() => onNavigate(section.path)}
                key={section.id}
              >
                <span className="primary-center-item__icon"><Icon size={18}/></span>
                <span><strong>{section.label}</strong></span>
                <ChevronLeft size={14}/>
              </button>
            );
          })}
        </div>
      </nav>

      <footer className="sidebar-footer">
        <div className="sidebar-account">
          <div className="sidebar-account__identity">
            <span className="navigation-hub__avatar" style={{ '--avatar-color': profile?.avatar_color || '#10b981' }}>
              {profile?.name?.[0] || 'ل'}
            </span>
            <span className="sidebar-account__copy">
              <strong>{profile?.name || 'لمحة'}</strong>
              <span>{roleLabel || profile?.role || ''}</span>
            </span>
          </div>
          <button type="button" className="sidebar-logout-action" onClick={onSignOut}>
            <LogOut size={14}/><span>تسجيل الخروج</span>
          </button>
        </div>
      </footer>
    </aside>
  );
}

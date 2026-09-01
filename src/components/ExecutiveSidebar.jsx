import { ChevronLeft, LayoutDashboard, LogOut } from 'lucide-react';
import { LamhaLogo } from './BrandLogo.jsx';

const HOME_PATHS = new Set(['/overview', '/decisions']);
const SECTION_ORDER = ['sales', 'customers', 'finance', 'shipping', 'reports', 'settings'];

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
  const campaignItem = navItems.find(item => item.id === 'campaign-center');
  const campaignActive = pathname === campaignItem?.path;

  return (
    <aside className="sidebar" aria-label="التنقل الرئيسي">
      <header className="sidebar-logo">
        <div className="sidebar-brand-lockup">
          <span className="sidebar-brand-logo sidebar-brand-logo--desktop"><LamhaLogo height={29} variant="white"/></span>
          <span className="sidebar-brand-logo sidebar-brand-logo--mobile"><LamhaLogo height={29} variant="white"/></span>
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
            const active = currentSectionId === section.id && !(section.id === 'sales' && campaignActive);
            return (
              <div className="primary-center-entry" key={section.id}>
                <button
                  type="button"
                  className={`primary-center-item${active ? ' active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => onNavigate(section.path)}
                >
                  <span className="primary-center-item__icon"><Icon size={19}/></span>
                  <span><strong>{section.label}</strong><small>{section.hint}</small></span>
                  <ChevronLeft size={15}/>
                </button>
                {section.id === 'sales' && campaignItem ? (
                  <button
                    type="button"
                    className={`primary-center-item primary-center-item--shortcut${campaignActive ? ' active' : ''}`}
                    aria-current={campaignActive ? 'page' : undefined}
                    onClick={() => onNavigate(campaignItem.path)}
                  >
                    <span className="primary-center-item__icon"><campaignItem.icon size={18}/></span>
                    <span><strong>الحملات</strong><small>الجمهور · الإطلاق · النتائج</small></span>
                    <ChevronLeft size={15}/>
                  </button>
                ) : null}
              </div>
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

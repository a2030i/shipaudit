import { useState, useEffect, useCallback } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Truck, Upload, History, Settings,
  ChevronLeft, ChevronRight, ChevronDown, Menu, X, Users, Sun, Moon, Wallet, FileText, BookOpen, Banknote, CreditCard, BarChart3, Activity, LogOut, Scale, Webhook, ClipboardList, Building2, Inbox, ShoppingBag,
} from 'lucide-react';
import { ToastContainer, Spinner } from './components/UI.jsx';
import { LamhaLogo, LamhaMark } from './components/BrandLogo.jsx';
import AIChat from './components/AIChat.jsx';
import { AuthProvider, useAuth } from './lib/auth.jsx';
import { loadCarriers } from './lib/coreService.js';
import { getNavPermissions } from './lib/permissionsService.js';
import Dashboard      from './pages/Dashboard.jsx';
import CarriersHub    from './pages/CarriersHub.jsx';
import CarrierProfile from './pages/CarrierProfile.jsx';
import CustomerReceivables from './pages/CustomerReceivables.jsx';
import Merchants from './pages/Merchants.jsx';
import CarrierManager from './pages/CarrierManager.jsx';
import UploadWizard   from './pages/UploadWizard.jsx';
import AuditResults   from './pages/AuditResults.jsx';
import { SettingsPage, AuditsHistory } from './pages/Settings.jsx';
import LoginPage      from './pages/LoginPage.jsx';
import EmployeeManager from './pages/EmployeeManager.jsx';
import BankStatement   from './pages/BankStatement.jsx';
import CarrierStatements from './pages/CarrierStatements.jsx';
import CarrierLedger     from './pages/CarrierLedger.jsx';
import CodSettlements    from './pages/CodSettlements.jsx';
import Payments          from './pages/Payments.jsx';
import CarrierKpi        from './pages/CarrierKpi.jsx';
import ActivityLog       from './pages/ActivityLog.jsx';
import WeightBilling     from './pages/WeightBilling.jsx';
import WebhookEvents     from './pages/WebhookEvents.jsx';
import ContractsOverview from './pages/ContractsOverview.jsx';

// ── Route map ─────────────────────────────────────────────────────────────────
// Sidebar IA — 4 sections, ordered by daily workflow:
//   1) overview  — landing screens (dashboard + per-carrier hub)
//   2) audits    — handle inbound files end-to-end (inbox → audit → history)
//   3) ledger    — financial sub-ledger + reconciliation
//   4) admin     — config + reports + logs
//
// Each item belongs to a section. Sections render as headers; items beneath them.
const NAV_ITEMS = [
  // ── Overview ───────────────────────────────────────────────────
  { id: 'dashboard', path: '/dashboard', label: 'الرئيسية',      icon: LayoutDashboard, section: 'overview' },
  { id: 'hub',       path: '/hub',       label: 'كشف الشركات',   icon: Building2,       section: 'overview' },

  // ── Audits (inbound + processing workflow) ─────────────────────
  { id: 'webhook',         path: '/webhook',           label: 'الوارد',          icon: Inbox,    section: 'audits' },
  { id: 'upload',          path: '/upload',            label: 'مراجعة جديدة',    icon: Upload,   section: 'audits' },
  { id: 'audits',          path: '/audits',            label: 'سجل المراجعات',   icon: History,  section: 'audits' },
  { id: 'weight-billing',  path: '/weight-billing',    label: 'فوترة الأوزان',   icon: Scale,    section: 'audits' },

  // ── Financial ledger + settlements ─────────────────────────────
  { id: 'ledger',          path: '/ledger',            label: 'دفتر الشركات',    icon: BookOpen, section: 'ledger' },
  { id: 'cod-settlements', path: '/cod-settlements',   label: 'تسويات COD',      icon: Banknote, section: 'ledger' },
  { id: 'payments',        path: '/payments',          label: 'الدفعات',         icon: CreditCard, section: 'ledger' },
  { id: 'aramex-stmt',     path: '/aramex-statements', label: 'كشوف خارجية',     icon: FileText, section: 'ledger' },
  { id: 'bank',            path: '/bank',              label: 'كشف بنكي',        icon: Wallet,   section: 'ledger' },
  { id: 'receivables',     path: '/receivables',       label: 'مديونيات العملاء', icon: Users,    section: 'ledger' },
  { id: 'merchants',       path: '/merchants',         label: 'متاجر المنصّة',    icon: ShoppingBag, section: 'ledger' },

  // ── Admin (config + reports + audit-trail) ─────────────────────
  { id: 'carriers',        path: '/carriers',          label: 'إدارة الشركات',   icon: Truck,         section: 'admin' },
  { id: 'contracts',       path: '/contracts',         label: 'جدول العقود',     icon: ClipboardList, section: 'admin' },
  { id: 'carrier-kpi',     path: '/carrier-kpi',       label: 'أداء الناقلين',   icon: BarChart3,     section: 'admin' },
  { id: 'activity-log',    path: '/activity-log',      label: 'سجل النشاط',      icon: Activity,      section: 'admin' },
  { id: 'employees',       path: '/employees',         label: 'الموظفون',        icon: Users,         section: 'admin', adminOnly: true },
];
const NAV_SECTIONS = [
  { id: 'overview', label: 'نظرة عامة' },
  { id: 'audits',   label: 'المراجعات' },
  { id: 'ledger',   label: 'الكشوف المالية' },
  { id: 'admin',    label: 'الإدارة والإعداد' },
];
const PAGE_TITLES = {
  '/dashboard':         'الرئيسية',
  '/hub':               'كشف الشركات',
  '/carrier':           'بروفايل الشركة',
  '/webhook':           'الوارد',
  '/upload':            'مراجعة جديدة',
  '/audits':            'سجل المراجعات',
  '/weight-billing':    'فوترة الأوزان',
  '/ledger':            'دفتر الشركات',
  '/cod-settlements':   'تسويات الدفع عند الاستلام',
  '/payments':          'الدفعات',
  '/aramex-statements': 'كشوف خارجية',
  '/bank':              'كشف بنكي',
  '/receivables':       'مديونيات العملاء',
  '/merchants':         'متاجر المنصّة',
  '/carriers':          'إدارة الشركات',
  '/contracts':         'جدول العقود',
  '/carrier-kpi':       'أداء الناقلين',
  '/activity-log':      'سجل النشاط',
  '/employees':         'الموظفون',
  '/settings/ai':            'الإعدادات — الذكاء الاصطناعي',
  '/settings/permissions':   'الإعدادات — الصلاحيات',
  '/settings/data':          'الإعدادات — البيانات',
  '/results':                'نتائج التدقيق',
};
const ROLE_LABEL = { admin: 'مدير', accountant1: 'محاسب أول', accountant2: 'محاسب ثانٍ' };

// ── Root ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('sa-theme') || 'light');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('sa-theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

  return (
    <AuthProvider>
      <AppInner theme={theme} toggleTheme={toggleTheme}/>
      <ToastContainer/>
    </AuthProvider>
  );
}

// ── Inner ─────────────────────────────────────────────────────────────────────
function AppInner({ theme, toggleTheme }) {
  const { user, profile, loading: authLoading, signOut } = useAuth();
  const navigate  = useNavigate();
  const location  = useLocation();
  const isAdmin   = profile?.role === 'admin';
  const pathname  = location.pathname;
  const isSettingsPath = pathname.startsWith('/settings');
  const KNOWN_PATHS = ['/dashboard','/hub','/carrier','/carriers','/contracts','/upload','/results','/audits','/bank','/aramex-statements','/ledger','/cod-settlements','/payments','/receivables','/merchants','/weight-billing','/carrier-kpi','/activity-log','/webhook','/employees'];
  const isKnownPath = KNOWN_PATHS.includes(pathname) || isSettingsPath;

  const [carriers,        setCarriers]        = useState([]);
  const [carriersLoading, setCarriersLoading] = useState(false);
  const [navPerms,        setNavPerms]        = useState(null);
  const [collapsed,       setCollapsed]       = useState(false);
  const [mobileOpen,      setMobileOpen]      = useState(false);
  // Per-section open/closed state for the sidebar accordion. Persists in
  // localStorage so the user's preferred layout survives reloads. Default:
  // every section starts collapsed except the one containing the active
  // route — keeps the sidebar quiet until the user opens what they need.
  const [openSections, setOpenSections] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('sa-nav-sections') || 'null');
      if (saved && typeof saved === 'object') {
        // Drop stale section IDs from a previous IA — keep only keys that
        // still exist in NAV_SECTIONS so the menu doesn't render empty
        // headers from a previous build.
        const validIds = new Set(NAV_SECTIONS.map(s => s.id));
        const cleaned = {};
        for (const [k, v] of Object.entries(saved)) {
          if (validIds.has(k)) cleaned[k] = v;
        }
        // Make sure the most-used section is open on first land after
        // an IA migration. Auto-open useEffect below will also kick in
        // based on the current route.
        if (Object.keys(cleaned).length === 0) cleaned.overview = true;
        return cleaned;
      }
    } catch { /* fall through to defaults */ }
    return { overview: true };
  });
  const toggleSection = (id) => {
    setOpenSections(prev => {
      const next = { ...prev, [id]: !prev[id] };
      try { localStorage.setItem('sa-nav-sections', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  // ── Default redirect after login: always go to dashboard ──
  useEffect(() => {
    if (!profile) return;
    if (location.pathname === '/' || location.pathname === '') {
      navigate('/dashboard', { replace: true });
    }
  }, [profile]);

  // ── Load carriers ──
  const reloadCarriers = useCallback(async () => {
    if (!user) return;
    setCarriersLoading(true);
    try { setCarriers(await loadCarriers()); } catch { /* silent */ }
    setCarriersLoading(false);
  }, [user]);

  useEffect(() => { reloadCarriers(); }, [reloadCarriers]);

  // Auto-open the section that contains the currently active route, so the
  // user never lands on a page whose sidebar entry is hidden behind a
  // collapsed section. We *only* open — never auto-close — so the user's
  // manual choices stick.
  useEffect(() => {
    const item = NAV_ITEMS.find(n => n.path === location.pathname);
    if (!item) return;
    setOpenSections(prev => {
      if (prev[item.section]) return prev;
      const next = { ...prev, [item.section]: true };
      try { localStorage.setItem('sa-nav-sections', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [location.pathname]);

  // ── Nav permissions ──
  useEffect(() => {
    if (!user) return;
    getNavPermissions().then(setNavPerms).catch(() => setNavPerms({}));
  }, [user]);

  const goto = (path) => {
    navigate(path);
    setMobileOpen(false);
  };

  // ── Audit results: use sessionStorage so data survives navigation ──
  const handleAuditComplete = (audit) => {
    sessionStorage.setItem('lastAudit', JSON.stringify(audit));
    navigate('/results');
  };
  const handleOpenAudit = (audit) => {
    sessionStorage.setItem('lastAudit', JSON.stringify(audit));
    navigate('/results');
  };

  const activeFor = (item) => {
    if (location.pathname === item.path) return true;
    if (item.path === '/upload' && location.pathname === '/results') return true;
    return false;
  };

  // ── Auth loading ──
  if (authLoading) return (
    <div style={{ height:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--bg)' }}>
      <Spinner size={28}/>
    </div>
  );

  if (!user || !profile) return <LoginPage/>;

  // Filter nav items by role.
  //   • admin → everything
  //   • non-admin with explicit allowlist → only those items
  //   • non-admin without any permission row yet → everything except admin-only
  //     (default-open: better than an empty sidebar before someone configures perms)
  const visibleNav = isAdmin
    ? NAV_ITEMS
    : NAV_ITEMS.filter(n => {
        if (n.adminOnly) return false;
        const allowed = navPerms?.[profile.role];
        if (!allowed || allowed.length === 0) return true;
        return allowed.includes(n.id);
      });

  const currentTitle = PAGE_TITLES[location.pathname]
    ?? (location.pathname.startsWith('/settings') ? 'الإعدادات' : 'ShipAudit');

  return (
    <>
      {mobileOpen && <div className="sidebar-backdrop" onClick={() => setMobileOpen(false)}/>}

      <div className="app-layout">

        {/* ═══════════════ SIDEBAR ═══════════════ */}
        <aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>

          {/* Logo — Lamha brand */}
          <div className="sidebar-logo">
            {collapsed ? (
              <LamhaMark size={36}/>
            ) : (
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', width:'100%' }}>
                <LamhaLogo height={26} color="#fff" accent="#2DD4BF"/>
                <div style={{
                  fontSize:8.5, color:'rgba(255,255,255,.45)',
                  fontFamily:'var(--font-mono)', letterSpacing:1.5,
                  textTransform:'uppercase', fontWeight:600,
                  padding:'2px 6px', border:'1px solid rgba(45,212,191,.3)',
                  borderRadius:4, marginInlineStart:8,
                }}>
                  v2.0
                </div>
              </div>
            )}
            {mobileOpen && (
              <button onClick={() => setMobileOpen(false)} style={{ background:'none', border:'none', color:'rgba(255,255,255,.6)', cursor:'pointer', marginRight:'auto', padding:4 }}>
                <X size={16}/>
              </button>
            )}
          </div>

          {/* Nav — grouped by section */}
          <nav className="sidebar-nav">
            {visibleNav.length === 0 && (
              <div style={{
                padding: '20px 14px', fontSize: 12, color: 'var(--nav-text)',
                textAlign: 'center', lineHeight: 1.7,
              }}>
                <div style={{ marginBottom: 8, fontSize: 22 }}>🔒</div>
                لم يتم تفعيل أي صلاحية لهذا الحساب.
                <br/>
                تواصل مع المدير لإضافة الصفحات.
              </div>
            )}
            {NAV_SECTIONS.map((sec, idx) => {
              const items = visibleNav.filter(n => n.section === sec.id);
              if (!items.length) return null;
              // Collapsed sidebar → always render items (the section header
              // becomes a thin divider). Expanded sidebar → accordion.
              const isOpen = collapsed ? true : !!openSections[sec.id];
              const sectionHasActive = items.some(n => activeFor(n));
              return (
                <div key={sec.id} style={{ marginBottom: idx === NAV_SECTIONS.length - 1 ? 0 : 4 }}>
                  {idx > 0 && <div className="nav-divider"/>}
                  {collapsed ? (
                    <div className="section-label" style={{ height: 0, padding: 0 }}/>
                  ) : (
                    <button
                      onClick={() => toggleSection(sec.id)}
                      className="section-header"
                      aria-expanded={isOpen}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        width: '100%', background: 'transparent', border: 'none',
                        padding: '14px 14px 8px', cursor: 'pointer',
                        fontFamily: 'var(--font-mono)', fontSize: 10,
                        letterSpacing: 1.8, textTransform: 'uppercase',
                        color: sectionHasActive ? 'var(--accent)' : 'var(--nav-label-color)',
                        fontWeight: 700, textAlign: 'right',
                        transition: 'color .15s',
                      }}
                    >
                      <span>{sec.label}</span>
                      <ChevronDown
                        size={12}
                        style={{
                          transition: 'transform .2s',
                          transform: isOpen ? 'rotate(0)' : 'rotate(-90deg)',
                          opacity: .6,
                        }}
                      />
                    </button>
                  )}
                  <div style={{
                    overflow: 'hidden',
                    maxHeight: isOpen ? items.length * 44 + 8 : 0,
                    transition: 'max-height .25s cubic-bezier(.4,0,.2,1)',
                  }}>
                    {items.map(n => (
                      <NavBtn key={n.id} n={n} active={activeFor(n)} collapsed={collapsed} onClick={() => goto(n.path)}/>
                    ))}
                  </div>
                </div>
              );
            })}
          </nav>

          {/* Footer */}
          <div className="sidebar-footer">
            <NavBtn
              n={{ id:'settings', path:'/settings/ai', label:'الإعدادات', icon:Settings }}
              active={location.pathname.startsWith('/settings')}
              collapsed={collapsed}
              onClick={() => goto('/settings/ai')}
            />

            {!collapsed && (
              <div style={{
                marginTop:10, display:'flex', alignItems:'center', gap:10,
                padding:'10px 12px', borderRadius:10,
                background:'rgba(255,255,255,.04)',
                border:'1px solid rgba(255,255,255,.08)',
              }}>
                <div style={{
                  width:32, height:32, borderRadius:'50%', flexShrink:0,
                  background: profile.avatar_color || 'linear-gradient(135deg,#1B1E54,#2DD4BF)',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize:13, fontWeight:700, color:'#fff',
                  boxShadow:'0 2px 8px rgba(45,212,191,.22)',
                }}>
                  {profile.name?.[0] ?? '?'}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:12, fontWeight:600, color:'#fff', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{profile.name}</div>
                  <div style={{ fontSize:10, color:'rgba(255,255,255,.5)', marginTop:1 }}>{ROLE_LABEL[profile.role] ?? profile.role}</div>
                </div>
                <button onClick={signOut} title="تسجيل خروج" style={{
                  background:'rgba(255,255,255,.05)', border:'1px solid rgba(255,255,255,.08)',
                  color:'rgba(255,255,255,.55)',
                  cursor:'pointer', padding:'5px 6px', borderRadius:6,
                  display:'flex', alignItems:'center',
                }}>
                  <LogOut size={12}/>
                </button>
              </div>
            )}
          </div>

          <button className="sidebar-toggle" onClick={() => setCollapsed(c => !c)}>
            {collapsed ? <ChevronLeft size={12}/> : <ChevronRight size={12}/>}
          </button>
        </aside>

        {/* ═══════════════ MAIN ═══════════════ */}
        <main className="app-main">

          {/* Topbar */}
          <div className="topbar">
            <button className="hamburger-btn" onClick={() => setMobileOpen(true)}>
              <Menu size={16}/>
            </button>

            <div style={{ flex:1, display:'flex', alignItems:'center', gap:10, minWidth:0 }}>
              <span style={{
                fontFamily:'var(--font-sans)', fontSize:15, fontWeight:800,
                color:'var(--text)', whiteSpace:'nowrap', letterSpacing:-0.2,
              }}>
                {currentTitle}
              </span>
              {location.pathname !== '/dashboard' && (
                <span style={{
                  color:'var(--muted)', fontSize:11, fontFamily:'var(--font-mono)',
                  letterSpacing:1.5, textTransform:'uppercase', fontWeight:600,
                  marginInlineStart:6,
                }}>
                  Lamha
                </span>
              )}
            </div>

            {/* Theme toggle */}
            <button onClick={toggleTheme} title={theme === 'dark' ? 'الوضع النهاري' : 'الوضع الليلي'} style={{
              background:'transparent', border:'1px solid var(--border2)',
              color:'var(--muted)', cursor:'pointer', padding:'7px 9px',
              borderRadius:8, display:'flex', alignItems:'center',
              transition:'all .15s',
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor='var(--text2)'; e.currentTarget.style.color='var(--text)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border2)'; e.currentTarget.style.color='var(--muted)'; }}
            >
              {theme === 'dark' ? <Sun size={15}/> : <Moon size={15}/>}
            </button>
          </div>

          {/* ── Pages ── */}
          {/* All pages permanently mounted — visibility:hidden instead of display:none
              prevents CSS animations from replaying on every navigation */}
          <div className="page-content">

            <PageSlot active={pathname==='/dashboard'} scroll>
              <Dashboard carriers={carriers} onNavigate={(p) => navigate(`/${p}`)}/>
            </PageSlot>
            <PageSlot active={pathname==='/hub'} scroll>
              <CarriersHub isActive={pathname==='/hub'}/>
            </PageSlot>
            <PageSlot active={pathname==='/carrier'} scroll>
              <CarrierProfile/>
            </PageSlot>
            <PageSlot active={pathname==='/carriers'}>
              <CarrierManager carriers={carriers} setCarriers={setCarriers} onCarriersChange={reloadCarriers}/>
            </PageSlot>
            <PageSlot active={pathname==='/contracts'} scroll>
              <ContractsOverview isActive={pathname==='/contracts'}/>
            </PageSlot>
            <PageSlot active={pathname==='/upload'} scroll>
              <UploadWizard carriers={carriers} onComplete={handleAuditComplete}/>
            </PageSlot>
            <PageSlot active={pathname==='/results'}>
              <AuditResultsPage carriers={carriers} onNewAudit={() => navigate('/upload')} isActive={pathname==='/results'}/>
            </PageSlot>
            <PageSlot active={pathname==='/audits'} scroll>
              <AuditsHistory onOpen={handleOpenAudit} isActive={pathname==='/audits'}/>
            </PageSlot>
            <PageSlot active={pathname==='/bank'} scroll>
              <BankStatement/>
            </PageSlot>
            <PageSlot active={pathname==='/aramex-statements'} scroll>
              <CarrierStatements carriers={carriers}/>
            </PageSlot>
            <PageSlot active={pathname==='/ledger'} scroll>
              <CarrierLedger isActive={pathname==='/ledger'}/>
            </PageSlot>
            <PageSlot active={pathname==='/cod-settlements'} scroll>
              <CodSettlements isActive={pathname==='/cod-settlements'}/>
            </PageSlot>
            <PageSlot active={pathname==='/payments'} scroll>
              <Payments isActive={pathname==='/payments'}/>
            </PageSlot>
            <PageSlot active={pathname==='/receivables'} scroll>
              <CustomerReceivables isActive={pathname==='/receivables'}/>
            </PageSlot>
            <PageSlot active={pathname==='/merchants'} scroll>
              <Merchants isActive={pathname==='/merchants'}/>
            </PageSlot>
            <PageSlot active={pathname==='/weight-billing'} scroll>
              <WeightBilling carriers={carriers} isActive={pathname==='/weight-billing'}/>
            </PageSlot>
            <PageSlot active={pathname==='/carrier-kpi'} scroll>
              <CarrierKpi isActive={pathname==='/carrier-kpi'}/>
            </PageSlot>
            <PageSlot active={pathname==='/activity-log'} scroll>
              <ActivityLog isActive={pathname==='/activity-log'}/>
            </PageSlot>
            <PageSlot active={pathname==='/webhook'} scroll>
              <WebhookEvents carriers={carriers} isActive={pathname==='/webhook'}/>
            </PageSlot>
            {isAdmin && (
              <PageSlot active={pathname==='/employees'} scroll>
                <EmployeeManager/>
              </PageSlot>
            )}

            <PageSlot active={isSettingsPath} scroll>
              <SettingsPage
                carriers={carriers}
                tab={pathname.startsWith('/settings/') ? pathname.replace('/settings/','') : 'ai'}
              />
            </PageSlot>

            {/* Unknown paths → redirect */}
            {!isKnownPath && !isSettingsPath && (
              <Routes>
                <Route path="*" element={<Navigate to="/dashboard" replace/>}/>
              </Routes>
            )}

          </div>
        </main>
      </div>

      {/* Floating AI assistant — always available once logged in */}
      <AIChat/>
    </>
  );
}

// ── AuditResults wrapper (reads from sessionStorage when activated) ──────────
function AuditResultsPage({ carriers, onNewAudit, isActive }) {
  const [audit, setAudit] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!isActive) return;
    try {
      const data = JSON.parse(sessionStorage.getItem('lastAudit') || 'null');
      if (data) { setAudit(data); }
      else { navigate('/upload', { replace: true }); }
    } catch { navigate('/upload', { replace: true }); }
  }, [isActive]);

  if (!audit) return null;
  return <AuditResults audit={audit} carriers={carriers} onNewAudit={onNewAudit}/>;
}

// ── PageSlot: keeps page mounted, hides without triggering CSS animations ─────
function PageSlot({ active, scroll = false, children }) {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      overflow: scroll ? 'auto' : 'hidden',
      visibility: active ? 'visible' : 'hidden',
      pointerEvents: active ? 'auto' : 'none',
      display: 'flex', flexDirection: 'column',
    }}>
      {children}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function NavBtn({ n, active, collapsed, onClick }) {
  const Icon = n.icon;
  return (
    <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick} title={collapsed ? n.label : undefined}>
      <Icon size={16} strokeWidth={active ? 2.2 : 1.8} style={{ flexShrink:0 }}/>
      <span className="nav-label" style={{ flex:1 }}>{n.label}</span>
      {active && <span className="nav-dot"/>}
    </button>
  );
}

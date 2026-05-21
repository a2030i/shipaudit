import { useState, useEffect, useCallback } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Truck, Upload, History, Settings,
  ChevronLeft, ChevronRight, ChevronDown, Menu, X, Users, Sun, Moon, Wallet, FileText, BookOpen, Banknote, CreditCard, BarChart3, Activity, LogOut, Scale, Webhook, ClipboardList, Building2, Inbox, ShoppingBag, Briefcase, FileCheck, DollarSign, UserCog, ListTodo, Layers, Lock,
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
import CustomerWatch from './pages/CustomerWatch.jsx';
import CustomerPortal from './pages/CustomerPortal.jsx';
import PaymentRequests from './pages/PaymentRequests.jsx';
import InternalExports from './pages/InternalExports.jsx';
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
import Tasks            from './pages/Tasks.jsx';
import Segments         from './pages/Segments.jsx';
import Periods          from './pages/Periods.jsx';

// ── Route map ─────────────────────────────────────────────────────────────────
// Sidebar IA — collapsible sections grouped by domain.
//
// "الرئيسية" sits alone above the sections as a top-level shortcut so
// the operator can always one-click home. Everything else falls into
// one of five sections that collapse/expand on click:
//
//   1) carriers   — anything carrier-facing (AP side)
//   2) audits     — the inbound + audit pipeline
//   3) finance    — money in / money out
//   4) customers  — customer / merchant directory (AR side)
//   5) system     — config + reports + admin
//
// `pinned: true` on a NAV_ITEM means it renders above sections (no
// section header). Currently only the dashboard is pinned.
const NAV_ITEMS = [
  // ── Pinned top-level ───────────────────────────────────────────
  { id: 'dashboard', path: '/dashboard', label: 'الرئيسية',      icon: LayoutDashboard, pinned: true },

  // ── Carriers (AP side) ────────────────────────────────────────
  { id: 'hub',          path: '/hub',               label: 'كشف الشركات',    icon: Building2,     section: 'carriers' },
  { id: 'ledger',       path: '/ledger',            label: 'دفتر الشركات',    icon: BookOpen,      section: 'carriers' },
  { id: 'aramex-stmt',  path: '/aramex-statements', label: 'كشوف خارجية',     icon: FileText,      section: 'carriers' },
  { id: 'carriers',     path: '/carriers',          label: 'إدارة الشركات',   icon: Truck,         section: 'carriers' },
  { id: 'contracts',    path: '/contracts',         label: 'جدول العقود',     icon: ClipboardList, section: 'carriers' },
  { id: 'carrier-kpi',  path: '/carrier-kpi',       label: 'أداء الناقلين',   icon: BarChart3,     section: 'carriers' },

  // ── Audits pipeline ───────────────────────────────────────────
  { id: 'webhook',         path: '/webhook',        label: 'الوارد',         icon: Inbox,    section: 'audits' },
  { id: 'tasks',           path: '/tasks',          label: 'مهام الأسبوع',   icon: ListTodo, section: 'audits' },
  { id: 'upload',          path: '/upload',         label: 'مراجعة جديدة',   icon: Upload,   section: 'audits' },
  { id: 'audits',          path: '/audits',         label: 'سجل المراجعات',  icon: History,  section: 'audits' },
  // Note: /weight-billing is reachable from /internal-exports (link
  // in the weights card footer) — removed from sidebar to reduce
  // duplication. The pull workflow lives on /internal-exports.
  { id: 'internal-exports', path: '/internal-exports', label: 'تصدير الإكسلات', icon: FileText, section: 'audits' },

  // ── Finance ────────────────────────────────────────────────────
  { id: 'cod-settlements',   path: '/cod-settlements',   label: 'تسويات COD',   icon: Banknote,   section: 'finance' },
  { id: 'payments',          path: '/payments',          label: 'الدفعات',       icon: CreditCard, section: 'finance' },
  { id: 'bank',              path: '/bank',              label: 'كشف بنكي',      icon: Wallet,     section: 'finance' },
  { id: 'payment-requests',  path: '/payment-requests',  label: 'طلبات السداد',  icon: Inbox,      section: 'finance' },

  // ── Customers (AR side) ───────────────────────────────────────
  { id: 'customers',       path: '/customers',       label: 'متابعة العملاء',   icon: Users,       section: 'customers' },
  { id: 'receivables',     path: '/receivables',     label: 'مديونيات العملاء', icon: DollarSign,  section: 'customers' },
  { id: 'merchants',       path: '/merchants',       label: 'متاجر المنصّة',    icon: ShoppingBag, section: 'customers' },
  { id: 'segments',        path: '/segments',        label: 'شرائح العملاء',    icon: Layers,      section: 'customers' },

  // ── System (config + reports — least-touched) ─────────────────
  { id: 'periods',      path: '/periods',      label: 'إقفال الفترات', icon: Lock,     section: 'system' },
  { id: 'activity-log', path: '/activity-log', label: 'سجل النشاط', icon: Activity, section: 'system' },
  { id: 'employees',    path: '/employees',    label: 'الموظفون',    icon: UserCog,  section: 'system', adminOnly: true },
];
const NAV_SECTIONS = [
  { id: 'carriers',  label: 'شركات الشحن',  icon: Building2, hint: 'الكشوف والعقود' },
  { id: 'audits',    label: 'المراجعات',     icon: FileCheck, hint: 'دورة الفواتير' },
  { id: 'finance',   label: 'الحركات المالية', icon: DollarSign, hint: 'COD والدفعات' },
  { id: 'customers', label: 'العملاء والمتاجر', icon: Users,    hint: 'AR والمتابعة' },
  { id: 'system',    label: 'إعدادات النظام', icon: Briefcase, hint: 'الإدارة والسجلات' },
];
const PAGE_TITLES = {
  '/dashboard':         'الرئيسية',
  '/hub':               'كشف الشركات',
  '/carrier':           'بروفايل الشركة',
  '/webhook':           'الوارد',
  '/customers':         'متابعة العملاء',
  '/payment-requests':  'طلبات السداد',
  '/internal-exports':  'سحب للنظام الداخلي',
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
  '/segments':          'شرائح العملاء',
  '/carriers':          'إدارة الشركات',
  '/contracts':         'جدول العقود',
  '/carrier-kpi':       'أداء الناقلين',
  '/activity-log':      'سجل النشاط',
  '/tasks':             'مهام الأسبوع',
  '/periods':           'إقفال الفترات',
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
      <AppShell theme={theme} toggleTheme={toggleTheme}/>
      <ToastContainer/>
    </AuthProvider>
  );
}

// Routes that should render standalone, OUTSIDE the authenticated app
// shell (sidebar / topbar / auth check). Customer-facing surfaces live
// here. Add public paths to this list as they appear.
const PUBLIC_PATHS = ['/portal'];

function AppShell(props) {
  const location = useLocation();
  // Public surfaces bypass auth and the sidebar/topbar layout entirely.
  if (PUBLIC_PATHS.some(p => location.pathname === p || location.pathname.startsWith(p + '/'))) {
    if (location.pathname.startsWith('/portal')) return <CustomerPortal/>;
  }
  return <AppInner {...props}/>;
}

// ── Inner ─────────────────────────────────────────────────────────────────────
function AppInner({ theme, toggleTheme }) {
  const { user, profile, loading: authLoading, signOut } = useAuth();
  const navigate  = useNavigate();
  const location  = useLocation();
  const isAdmin   = profile?.role === 'admin';
  const pathname  = location.pathname;
  const isSettingsPath = pathname.startsWith('/settings');
  const KNOWN_PATHS = ['/dashboard','/hub','/carrier','/carriers','/contracts','/upload','/results','/audits','/bank','/aramex-statements','/ledger','/cod-settlements','/payments','/payment-requests','/receivables','/merchants','/customers','/weight-billing','/internal-exports','/carrier-kpi','/activity-log','/webhook','/employees','/tasks','/segments','/periods'];
  const isKnownPath = KNOWN_PATHS.includes(pathname) || isSettingsPath;

  const [carriers,        setCarriers]        = useState([]);
  const [carriersLoading, setCarriersLoading] = useState(false);
  const [navPerms,        setNavPerms]        = useState(null);
  const [collapsed,       setCollapsed]       = useState(false);
  const [mobileOpen,      setMobileOpen]      = useState(false);
  // Per-section open/closed state for the accordion. Persists in
  // localStorage so the operator's preferred layout survives reloads.
  // Default on first visit: open the carriers section (most-trafficked
  // group) and the section containing the current route.
  const [openSections, setOpenSections] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('sa-nav-sections-v2') || 'null');
      if (saved && typeof saved === 'object') {
        const validIds = new Set(NAV_SECTIONS.map(s => s.id));
        const cleaned = {};
        for (const [k, v] of Object.entries(saved)) {
          if (validIds.has(k)) cleaned[k] = v;
        }
        return cleaned;
      }
    } catch { /* fall through */ }
    return { carriers: true };
  });
  const toggleSection = (id) => {
    setOpenSections(prev => {
      const next = { ...prev, [id]: !prev[id] };
      try { localStorage.setItem('sa-nav-sections-v2', JSON.stringify(next)); } catch { /* ignore */ }
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

  // Auto-open the section that contains the active route. We only
  // open — never auto-close — so manual choices stick.
  useEffect(() => {
    const item = NAV_ITEMS.find(n => n.path === location.pathname);
    if (!item || !item.section) return;
    setOpenSections(prev => {
      if (prev[item.section]) return prev;
      const next = { ...prev, [item.section]: true };
      try { localStorage.setItem('sa-nav-sections-v2', JSON.stringify(next)); } catch { /* ignore */ }
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
              <LamhaMark size={32}/>
            ) : (
              <div style={{ display:'flex', alignItems:'center', width:'100%' }}>
                <LamhaLogo height={24} color="#fff" accent="#10B981"/>
              </div>
            )}
            {mobileOpen && (
              <button onClick={() => setMobileOpen(false)} style={{ background:'none', border:'none', color:'rgba(255,255,255,.55)', cursor:'pointer', marginRight:'auto', padding:4 }}>
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
            {/* Pinned top-level items (no section header) */}
            {visibleNav.filter(n => n.pinned).map(n => (
              <NavBtn key={n.id} n={n} active={activeFor(n)} collapsed={collapsed} onClick={() => goto(n.path)}/>
            ))}

            {/* Accordion sections */}
            {NAV_SECTIONS.map((sec) => {
              const items = visibleNav.filter(n => n.section === sec.id);
              if (!items.length) return null;
              const isOpen = collapsed ? true : !!openSections[sec.id];
              const sectionHasActive = items.some(n => activeFor(n));
              const SecIcon = sec.icon;
              return (
                <div key={sec.id} style={{ marginTop: 8 }}>
                  {collapsed ? (
                    <div style={{
                      height: 1, margin: '8px 14px',
                      background: 'rgba(255,255,255,.04)',
                    }}/>
                  ) : (
                    <button
                      onClick={() => toggleSection(sec.id)}
                      aria-expanded={isOpen}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        width: '100%', padding: '9px 12px',
                        background: 'transparent', border: 'none',
                        borderRadius: 10, cursor: 'pointer',
                        fontFamily: 'var(--font-sans)',
                        color: sectionHasActive
                          ? 'var(--nav-text-hover)'
                          : 'var(--nav-text)',
                        textAlign: 'right',
                        transition: 'background .15s, color .15s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--nav-hover-bg)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <SecIcon size={15} strokeWidth={sectionHasActive ? 2.2 : 1.8} style={{ opacity: sectionHasActive ? 1 : .72, color: sectionHasActive ? 'var(--accent)' : undefined }}/>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {sec.label}
                      </span>
                      {sectionHasActive && !isOpen && (
                        <span style={{
                          width: 6, height: 6, borderRadius: '50%',
                          background: 'var(--accent)',
                          boxShadow: '0 0 8px var(--accent-glow)',
                          flexShrink: 0,
                        }}/>
                      )}
                      <ChevronDown
                        size={14}
                        style={{
                          transition: 'transform .22s cubic-bezier(.4,0,.2,1)',
                          transform: isOpen ? 'rotate(0)' : 'rotate(-90deg)',
                          opacity: .55, flexShrink: 0,
                        }}
                      />
                    </button>
                  )}
                  <div style={{
                    overflow: 'hidden',
                    maxHeight: isOpen ? items.length * 44 + 12 : 0,
                    transition: 'max-height .25s cubic-bezier(.4,0,.2,1)',
                    paddingInlineEnd: collapsed ? 0 : 8,
                  }}>
                    {items.map(n => (
                      <NavBtn key={n.id} n={n} active={activeFor(n)} collapsed={collapsed} onClick={() => goto(n.path)} nested/>
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
                marginTop:10, display:'flex', alignItems:'center', gap:11,
                padding:'12px 14px', borderRadius:14,
                background:'rgba(255,255,255,.03)',
                border:'1px solid rgba(255,255,255,.06)',
              }}>
                <div style={{
                  width:36, height:36, borderRadius:'50%', flexShrink:0,
                  background: profile.avatar_color || 'linear-gradient(135deg,#10B981,#059669)',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize:14, fontWeight:700, color:'#fff',
                  boxShadow:'0 4px 12px rgba(16,185,129,.22)',
                }}>
                  {profile.name?.[0] ?? '?'}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:600, color:'#fff', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{profile.name}</div>
                  <div style={{ fontSize:11, color:'rgba(255,255,255,.45)', marginTop:2 }}>{ROLE_LABEL[profile.role] ?? profile.role}</div>
                </div>
                <button onClick={signOut} title="تسجيل خروج" style={{
                  background:'transparent', border:'1px solid rgba(255,255,255,.08)',
                  color:'rgba(255,255,255,.5)',
                  cursor:'pointer', padding:'6px 7px', borderRadius:8,
                  display:'flex', alignItems:'center', transition:'all .15s',
                }}
                  onMouseEnter={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = 'rgba(255,255,255,.18)'; }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,.5)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,.08)'; }}
                >
                  <LogOut size={13}/>
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
            <PageSlot active={pathname==='/segments'} scroll>
              <Segments isActive={pathname==='/segments'}/>
            </PageSlot>
            <PageSlot active={pathname==='/periods'} scroll>
              <Periods isActive={pathname==='/periods'}/>
            </PageSlot>
            <PageSlot active={pathname==='/customers'} scroll>
              <CustomerWatch isActive={pathname==='/customers'}/>
            </PageSlot>
            <PageSlot active={pathname==='/payment-requests'} scroll>
              <PaymentRequests isActive={pathname==='/payment-requests'}/>
            </PageSlot>
            <PageSlot active={pathname==='/weight-billing'} scroll>
              <WeightBilling carriers={carriers} isActive={pathname==='/weight-billing'}/>
            </PageSlot>
            <PageSlot active={pathname==='/internal-exports'} scroll>
              <InternalExports carriers={carriers} isActive={pathname==='/internal-exports'}/>
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
            <PageSlot active={pathname==='/tasks'} scroll>
              <Tasks carriers={carriers} isActive={pathname==='/tasks'}/>
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
function NavBtn({ n, active, collapsed, onClick, nested }) {
  const Icon = n.icon;
  return (
    <button
      className={`nav-item ${active ? 'active' : ''}`}
      onClick={onClick}
      title={collapsed ? n.label : undefined}
      style={nested && !collapsed ? { paddingInlineStart: 28 } : undefined}
    >
      <Icon size={15} strokeWidth={active ? 2.2 : 1.8} style={{ flexShrink:0 }}/>
      <span className="nav-label" style={{ flex:1 }}>{n.label}</span>
      {active && <span className="nav-dot"/>}
    </button>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Truck, Upload, History, Settings,
  Package, ChevronLeft, ChevronRight, Menu, X, Users, Sun, Moon, Wallet, FileText,
} from 'lucide-react';
import { ToastContainer, Spinner } from './components/UI.jsx';
import { AuthProvider, useAuth } from './lib/auth.jsx';
import { loadCarriers } from './lib/coreService.js';
import { getNavPermissions } from './lib/permissionsService.js';
import Dashboard      from './pages/Dashboard.jsx';
import CarrierManager from './pages/CarrierManager.jsx';
import UploadWizard   from './pages/UploadWizard.jsx';
import AuditResults   from './pages/AuditResults.jsx';
import { SettingsPage, AuditsHistory } from './pages/Settings.jsx';
import LoginPage      from './pages/LoginPage.jsx';
import EmployeeManager from './pages/EmployeeManager.jsx';
import BankStatement   from './pages/BankStatement.jsx';
import CarrierStatements from './pages/CarrierStatements.jsx';

// ── Route map ─────────────────────────────────────────────────────────────────
// Each item belongs to a section. Sections render as headers; items beneath them.
const NAV_ITEMS = [
  { id: 'dashboard', path: '/dashboard', label: 'الرئيسية',      icon: LayoutDashboard, section: 'audit' },
  { id: 'carriers',  path: '/carriers',  label: 'شركات الشحن',   icon: Truck,           section: 'audit' },
  { id: 'upload',    path: '/upload',    label: 'مراجعة جديدة',  icon: Upload,          section: 'audit' },
  { id: 'audits',    path: '/audits',    label: 'السجل',         icon: History,         section: 'audit' },
  { id: 'aramex-stmt', path: '/aramex-statements', label: 'كشف أرامكس', icon: FileText, section: 'carrier_acct' },
  { id: 'bank',      path: '/bank',      label: 'كشف بنكي',      icon: Wallet,          section: 'bank' },
  { id: 'employees', path: '/employees', label: 'الموظفون',      icon: Users,           section: 'admin', adminOnly: true },
];
const NAV_SECTIONS = [
  { id: 'audit',         label: 'مراجعة فواتير الشحن' },
  { id: 'carrier_acct',  label: 'كشوف حسابات شركات الشحن' },
  { id: 'bank',          label: 'كشوف بنكية' },
  { id: 'admin',         label: 'الإدارة' },
];
const PAGE_TITLES = {
  '/dashboard':       'الرئيسية',
  '/carriers':        'شركات الشحن',
  '/upload':          'مراجعة جديدة',
  '/audits':          'سجل المراجعات',
  '/bank':            'كشف بنكي',
  '/aramex-statements': 'كشف حساب أرامكس',
  '/employees':       'الموظفون',
  '/settings/ai':     'الإعدادات — الذكاء الاصطناعي',
  '/settings/permissions': 'الإعدادات — الصلاحيات',
  '/settings/data':   'الإعدادات — البيانات',
  '/results':         'نتائج التدقيق',
};
const ROLE_LABEL = { admin: 'مدير', accountant1: 'محاسب أول', accountant2: 'محاسب ثانٍ' };

// ── Root ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('sa-theme') || 'dark');

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
  const KNOWN_PATHS = ['/dashboard','/carriers','/upload','/results','/audits','/bank','/aramex-statements','/employees'];
  const isKnownPath = KNOWN_PATHS.includes(pathname) || isSettingsPath;

  const [carriers,        setCarriers]        = useState([]);
  const [carriersLoading, setCarriersLoading] = useState(false);
  const [navPerms,        setNavPerms]        = useState(null);
  const [collapsed,       setCollapsed]       = useState(false);
  const [mobileOpen,      setMobileOpen]      = useState(false);

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

  // Filter nav items by role: admin sees all; others see only what permissions allow.
  const visibleNav = isAdmin
    ? NAV_ITEMS
    : NAV_ITEMS.filter(n =>
        !n.adminOnly && (navPerms?.[profile.role] ?? []).includes(n.id)
      );

  const currentTitle = PAGE_TITLES[location.pathname]
    ?? (location.pathname.startsWith('/settings') ? 'الإعدادات' : 'ShipAudit');

  return (
    <>
      {mobileOpen && <div className="sidebar-backdrop" onClick={() => setMobileOpen(false)}/>}

      <div className="app-layout">

        {/* ═══════════════ SIDEBAR ═══════════════ */}
        <aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>

          {/* Logo */}
          <div className="sidebar-logo">
            <div style={{
              width:34, height:34, flexShrink:0, borderRadius:9,
              background:'linear-gradient(135deg,var(--accent3),var(--accent))',
              display:'flex', alignItems:'center', justifyContent:'center',
              boxShadow:'0 4px 16px rgba(56,189,248,.25)',
            }}>
              <Package size={16} color="#fff" strokeWidth={2.5}/>
            </div>
            {!collapsed && (
              <div style={{ overflow:'hidden', flex:1 }}>
                <div style={{ fontFamily:'var(--font-mono)', fontWeight:700, fontSize:14, color:'var(--text)', lineHeight:1, whiteSpace:'nowrap' }}>
                  Ship<span style={{ color:'var(--accent)' }}>Audit</span>
                </div>
                <div style={{ fontSize:9, color:'var(--muted)', fontFamily:'var(--font-mono)', marginTop:3, letterSpacing:1.5, textTransform:'uppercase' }}>
                  Pro · v1.0
                </div>
              </div>
            )}
            {mobileOpen && (
              <button onClick={() => setMobileOpen(false)} style={{ background:'none', border:'none', color:'var(--muted)', cursor:'pointer', marginRight:'auto', padding:4 }}>
                <X size={16}/>
              </button>
            )}
          </div>

          {/* Nav — grouped by section */}
          <nav className="sidebar-nav">
            {NAV_SECTIONS.map((sec, idx) => {
              const items = visibleNav.filter(n => n.section === sec.id);
              if (!items.length) return null;
              return (
                <div key={sec.id}>
                  {idx > 0 && <div className="nav-divider"/>}
                  <div className="section-label">{sec.label}</div>
                  {items.map(n => (
                    <NavBtn key={n.id} n={n} active={activeFor(n)} collapsed={collapsed} onClick={() => goto(n.path)}/>
                  ))}
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

            {isAdmin && !collapsed && (
              <div style={{
                marginTop:8, padding:'8px 11px',
                background:'var(--surface)', border:'1px solid var(--border2)', borderRadius:8,
              }}>
                <div style={{ color:'var(--muted)', fontSize:9, fontFamily:'var(--font-mono)', marginBottom:3 }}>شركات مُعرَّفة</div>
                <span style={{ color:'var(--accent)', fontSize:18, fontFamily:'var(--font-mono)', fontWeight:700 }}>
                  {carriersLoading ? '…' : carriers.length}
                </span>
              </div>
            )}

            {!collapsed && (
              <div style={{
                marginTop:8, display:'flex', alignItems:'center', gap:8,
                padding:'8px 10px', borderRadius:8,
                background:'var(--surface)', border:'1px solid var(--border2)',
              }}>
                <div style={{
                  width:28, height:28, borderRadius:'50%', flexShrink:0,
                  background: profile.avatar_color || '#38bdf8',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize:11, fontWeight:700, color:'#000',
                }}>
                  {profile.name?.[0] ?? '?'}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:12, fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{profile.name}</div>
                  <div style={{ fontSize:10, color:'var(--muted)' }}>{ROLE_LABEL[profile.role] ?? profile.role}</div>
                </div>
                <button onClick={signOut} title="تسجيل خروج" style={{
                  background:'none', border:'none', color:'var(--muted)',
                  cursor:'pointer', fontSize:14, padding:'2px 3px', lineHeight:1,
                }}>⏻</button>
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

            <div style={{ flex:1, display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontFamily:'var(--font-mono)', fontSize:13, fontWeight:600, color:'var(--text)' }}>
                {currentTitle}
              </span>
              {location.pathname !== '/dashboard' && (
                <span style={{ color:'var(--muted)', fontSize:11, fontFamily:'var(--font-mono)' }}>
                  · ShipAudit Pro
                </span>
              )}
            </div>

            {/* Theme toggle */}
            <button onClick={toggleTheme} title={theme === 'dark' ? 'الوضع النهاري' : 'الوضع الليلي'} style={{
              background:'none', border:'1px solid var(--border2)',
              color:'var(--muted)', cursor:'pointer', padding:'6px 8px',
              borderRadius:8, display:'flex', alignItems:'center',
              transition:'all .15s',
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor='var(--accent)'; e.currentTarget.style.color='var(--accent)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border2)'; e.currentTarget.style.color='var(--muted)'; }}
            >
              {theme === 'dark' ? <Sun size={15}/> : <Moon size={15}/>}
            </button>

            <div style={{ display:'flex', alignItems:'center', gap:5 }}>
              <div style={{ width:6, height:6, borderRadius:'50%', background:'var(--green)', boxShadow:'0 0 6px var(--green)', flexShrink:0 }}/>
              <span style={{ color:'var(--muted)', fontSize:11, fontFamily:'var(--font-mono)' }}>جاهز</span>
            </div>
          </div>

          {/* ── Pages ── */}
          {/* All pages permanently mounted — visibility:hidden instead of display:none
              prevents CSS animations from replaying on every navigation */}
          <div className="page-content">

            <PageSlot active={pathname==='/dashboard'} scroll>
              <Dashboard carriers={carriers} onNavigate={(p) => navigate(`/${p}`)}/>
            </PageSlot>
            <PageSlot active={pathname==='/carriers'}>
              <CarrierManager carriers={carriers} setCarriers={setCarriers} onCarriersChange={reloadCarriers}/>
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
              <CarrierStatements/>
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

import { useState, useEffect, useCallback, useRef } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Truck, Upload, History, Settings,
  Package, ChevronLeft, ChevronRight, Mail, Menu, X, Bell, Users, Sun, Moon,
} from 'lucide-react';
import { ToastContainer, Spinner } from './components/UI.jsx';
import { AuthProvider, useAuth } from './lib/auth.jsx';
import { supabase } from './lib/supabase.js';
import { loadCarriers } from './lib/coreService.js';
import { getUnreadCount, getNotifications, markAllRead, getNavPermissions } from './lib/mailService.js';
import Dashboard      from './pages/Dashboard.jsx';
import CarrierManager from './pages/CarrierManager.jsx';
import UploadWizard   from './pages/UploadWizard.jsx';
import AuditResults   from './pages/AuditResults.jsx';
import { SettingsPage, AuditsHistory } from './pages/Settings.jsx';
import MailApp         from './pages/mail/MailApp.jsx';
import LoginPage       from './pages/mail/LoginPage.jsx';
import EmployeeManager from './pages/EmployeeManager.jsx';

// ── Route map ─────────────────────────────────────────────────────────────────
const AUDIT_ITEMS = [
  { id: 'dashboard',  path: '/dashboard',  label: 'الرئيسية',     icon: LayoutDashboard },
  { id: 'carriers',   path: '/carriers',   label: 'شركات الشحن',  icon: Truck },
  { id: 'upload',     path: '/upload',     label: 'مراجعة جديدة', icon: Upload },
  { id: 'audits',     path: '/audits',     label: 'السجل',        icon: History },
  { id: 'employees',  path: '/employees',  label: 'الموظفون',     icon: Users },
];
const MAIL_ITEMS = [
  { id: 'mail', path: '/mail', label: 'البريد المالي', icon: Mail },
];
const PAGE_TITLES = {
  '/dashboard':      'الرئيسية',
  '/carriers':       'شركات الشحن',
  '/upload':         'مراجعة جديدة',
  '/audits':         'سجل المراجعات',
  '/mail':           'البريد المالي',
  '/employees':      'الموظفون',
  '/settings/ai':    'الإعدادات — الذكاء الاصطناعي',
  '/settings/gmail': 'الإعدادات — Gmail',
  '/settings/rules': 'الإعدادات — قواعد المزامنة',
  '/settings/data':  'الإعدادات — البيانات',
  '/results':        'نتائج التدقيق',
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
  const KNOWN_PATHS = ['/dashboard','/carriers','/upload','/results','/audits','/mail','/employees'];
  const isKnownPath = KNOWN_PATHS.includes(pathname) || isSettingsPath;

  const [carriers,        setCarriers]        = useState([]);
  const [carriersLoading, setCarriersLoading] = useState(false);
  const [navPerms,        setNavPerms]        = useState(null);
  const [collapsed,       setCollapsed]       = useState(false);
  const [mobileOpen,      setMobileOpen]      = useState(false);
  const [unread,          setUnread]          = useState(0);
  const [notifOpen,       setNotifOpen]       = useState(false);
  const [notifs,          setNotifs]          = useState([]);
  const notifChannelRef = useRef(null);

  // ── Default redirect after login ──
  useEffect(() => {
    if (!profile) return;
    if (location.pathname === '/' || location.pathname === '') {
      navigate(profile.role === 'admin' ? '/dashboard' : '/mail', { replace: true });
    }
  }, [profile]);

  // ── Load carriers ──
  const reloadCarriers = useCallback(async () => {
    if (!user || !isAdmin) return;
    setCarriersLoading(true);
    try { setCarriers(await loadCarriers()); } catch { /* silent */ }
    setCarriersLoading(false);
  }, [user, isAdmin]);

  useEffect(() => { reloadCarriers(); }, [reloadCarriers]);

  // ── Nav permissions ──
  useEffect(() => {
    if (!user) return;
    getNavPermissions().then(setNavPerms).catch(() => setNavPerms({}));
  }, [user]);

  // ── Notifications ──
  const loadUnread = useCallback(async () => {
    if (!user) return;
    setUnread(await getUnreadCount(user.id));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    loadUnread();
    const ch = supabase.channel(`app_notifs_${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'notifications',
        filter: `user_id=eq.${user.id}`,
      }, loadUnread)
      .subscribe();
    notifChannelRef.current = ch;
    return () => { supabase.removeChannel(ch); };
  }, [user, loadUnread]);

  const openNotifs = async () => {
    if (!user) return;
    setNotifOpen(true);
    const data = await getNotifications(user.id);
    setNotifs(data);
    await markAllRead(user.id);
    setUnread(0);
  };

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

          {/* Nav */}
          <nav className="sidebar-nav">
            {(() => {
              const allowed = isAdmin
                ? AUDIT_ITEMS
                : AUDIT_ITEMS.filter(n => (navPerms?.[profile?.role] ?? []).includes(n.id));
              if (!allowed.length) return null;
              return (
                <>
                  <div className="section-label">المراجعة المالية</div>
                  {allowed.map(n => (
                    <NavBtn key={n.id} n={n} active={activeFor(n)} collapsed={collapsed} onClick={() => goto(n.path)}/>
                  ))}
                  <div className="nav-divider"/>
                </>
              );
            })()}
            <div className="section-label">البريد المالي</div>
            {MAIL_ITEMS.map(n => (
              <NavBtn key={n.id} n={n} active={activeFor(n)} collapsed={collapsed} onClick={() => goto(n.path)}/>
            ))}
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

            <button onClick={openNotifs} style={{
              position:'relative', background:'none', border:'none',
              color:'var(--muted)', cursor:'pointer', padding:'6px 8px',
              borderRadius:8, display:'flex', alignItems:'center',
            }}>
              <Bell size={16}/>
              {unread > 0 && (
                <span style={{
                  position:'absolute', top:2, left:2,
                  background:'var(--red)', color:'#fff',
                  fontSize:9, borderRadius:9, padding:'1px 4px',
                  lineHeight:1.4, minWidth:14, textAlign:'center', fontWeight:700,
                }}>{unread > 9 ? '9+' : unread}</span>
              )}
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

            {isAdmin && <>
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
                <AuditsHistory onOpen={handleOpenAudit}/>
              </PageSlot>
              <PageSlot active={pathname==='/employees'} scroll>
                <EmployeeManager/>
              </PageSlot>
            </>}

            <PageSlot active={pathname==='/mail'}>
              <MailApp onNotification={loadUnread}/>
            </PageSlot>

            <PageSlot active={isSettingsPath} scroll>
              <SettingsPage
                carriers={carriers}
                tab={pathname.startsWith('/settings/') ? pathname.replace('/settings/','') : 'ai'}
              />
            </PageSlot>

            {/* Unknown paths → redirect */}
            {!isKnownPath && !isSettingsPath && (
              <Routes>
                <Route path="*" element={<Navigate to={isAdmin ? '/dashboard' : '/mail'} replace/>}/>
              </Routes>
            )}

          </div>
        </main>
      </div>

      {notifOpen && (
        <NotifDrawer
          notifs={notifs}
          onClose={() => setNotifOpen(false)}
          onSelectTask={() => { navigate('/mail'); setNotifOpen(false); }}
        />
      )}
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

function NotifDrawer({ notifs, onClose, onSelectTask }) {
  return (
    <>
      <div onClick={onClose} style={{ position:'fixed', inset:0, zIndex:900, background:'rgba(0,0,0,.4)' }}/>
      <div style={{
        position:'fixed', top:0, left:0, bottom:0, zIndex:901,
        width:300, background:'var(--card)', borderRight:'1px solid var(--border)',
        display:'flex', flexDirection:'column', overflow:'hidden',
        boxShadow:'var(--shadow-lg)',
        animation:'slideInRight .25s ease forwards',
      }}>
        <div style={{ padding:'14px 16px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
          <span style={{ fontWeight:700, fontSize:14 }}>🔔 الإشعارات</span>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'var(--muted)', cursor:'pointer', fontSize:18 }}>✕</button>
        </div>
        <div style={{ flex:1, overflowY:'auto' }}>
          {notifs.length === 0 && (
            <div style={{ padding:30, textAlign:'center', color:'var(--muted)', fontSize:12 }}>لا توجد إشعارات</div>
          )}
          {notifs.map(n => (
            <div key={n.id}
              onClick={() => n.task_id && onSelectTask(n.task_id)}
              style={{
                padding:'12px 16px', borderBottom:'1px solid var(--border)',
                cursor: n.task_id ? 'pointer' : 'default',
                background: n.read ? 'transparent' : 'rgba(56,189,248,.05)',
                transition:'background .15s',
              }}
              onMouseEnter={e => { if(n.task_id) e.currentTarget.style.background='var(--surface)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = n.read ? 'transparent' : 'rgba(56,189,248,.05)'; }}
            >
              <div style={{ fontWeight:600, fontSize:12, marginBottom:3 }}>{n.title}</div>
              {n.message && <div style={{ fontSize:11, color:'var(--muted)' }}>{n.message}</div>}
              <div style={{ fontSize:10, color:'var(--muted)', marginTop:4 }}>
                {new Date(n.created_at).toLocaleString('ar-SA')}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

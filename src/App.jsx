import { useState, useEffect, useCallback } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Truck, Upload, History, Settings,
  ChevronLeft, ChevronRight, ChevronDown, Menu, X, Users, Sun, Moon, Wallet, FileText, BookOpen, Banknote, CreditCard, BarChart3, Activity, LogOut, Scale, Webhook, ClipboardList, Building2, Inbox, ShoppingBag, Briefcase, FileCheck, DollarSign, UserCog, ListTodo, Layers, Lock, TrendingUp, GitCompare, Phone, CalendarRange, Search,
} from 'lucide-react';
import { ToastContainer, Spinner } from './components/UI.jsx';
import { LamhaLogo, LamhaMark } from './components/BrandLogo.jsx';
import AIChat from './components/AIChat.jsx';
import { AuthProvider, useAuth } from './lib/auth.jsx';
import { loadCarriers } from './lib/coreService.js';
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
import CustomerHub      from './pages/CustomerHub.jsx';
import CarriersWorkspace from './pages/CarriersWorkspace.jsx';
import MoneyHub          from './pages/MoneyHub.jsx';
import Collections       from './pages/Collections.jsx';
import Periods          from './pages/Periods.jsx';
import Forecast         from './pages/Forecast.jsx';
import MonthlyReport     from './pages/MonthlyReport.jsx';
import SmartDrop         from './pages/SmartDrop.jsx';
import CashAging         from './pages/CashAging.jsx';
import IntegrityCheck    from './pages/IntegrityCheck.jsx';
import Claims            from './pages/Claims.jsx';
import CommandPalette    from './components/CommandPalette.jsx';
import Overview         from './pages/Overview.jsx';
import Reconciliation   from './pages/Reconciliation.jsx';
import UploadsHub       from './pages/UploadsHub.jsx';

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
// Each item carries a `permKey` linking it to the per-user
// permission catalog (src/lib/permissions.js). Admin sees everything;
// accountants see only items whose `permKey` is granted. `adminOnly`
// items never appear for accountants regardless of permissions —
// reserved for the meta-admin actions (manage employees themselves).
const NAV_ITEMS = [
  // ── Pinned top-level ───────────────────────────────────────────
  // /overview is the canonical home as of 2026-05-22 — /dashboard
  // was the legacy snapshot view that overlapped 100% with overview.
  // The /dashboard route still resolves so any deep links keep
  // working, but it's removed from the nav and the default landing
  // redirect now goes to /overview.
  { id: 'overview',  path: '/overview',  label: 'الرئيسية',      icon: LayoutDashboard, pinned: true, permKey: 'overview.view' },
  // الرفع الذكي — ONE drop target for every carrier file (invoice / COD /
  // statement). Sniffs the content and routes to the right screen, so the
  // old per-type entry points (/upload etc.) no longer need nav rows.
  { id: 'tasks',     path: '/tasks',     label: 'المهام',         icon: ListTodo,        pinned: true, permKey: 'audits.view' },
  { id: 'drop',      path: '/drop',      label: 'رفع ملف',        icon: Upload,          pinned: true, permKey: 'audits.create' },
  { id: 'webhook',   path: '/webhook',   label: 'الوارد',         icon: Inbox,           pinned: true, permKey: 'webhook.view' },

  // ── Carriers — العمل اليومي مع الناقلين ─────────────────────────
  // (workspace screens; rarely-touched admin moved to system)
  { id: 'hub',          path: '/hub',               label: 'الشركات',         icon: Building2,     section: 'carriers', permKey: 'carriers.view' },
  { id: 'audits',       path: '/audits',            label: 'سجل المراجعات',  icon: History,       section: 'carriers', permKey: 'audits.view' },
  { id: 'ledger',       path: '/ledger',            label: 'الدفتر',           icon: BookOpen,      section: 'carriers', permKey: 'ledger.view' },
  { id: 'aramex-stmt',  path: '/aramex-statements', label: 'كشوف الحساب',     icon: FileText,      section: 'carriers', permKey: 'carriers.upload_statement' },
  { id: 'claims',       path: '/claims',            label: 'المطالبات',        icon: Scale,         section: 'carriers', permKey: 'ledger.view' },

  // ── Reports — قراءة فقط ─────────────────────────────────────────
  { id: 'cash-aging',       path: '/cash-aging',       label: 'النقد والأعمار',  icon: Wallet,        section: 'reports', permKey: 'ledger.view' },
  { id: 'monthly-report',   path: '/monthly-report',   label: 'التقرير الشهري',  icon: CalendarRange, section: 'reports', permKey: 'carriers.view' },
  { id: 'carrier-kpi',      path: '/carrier-kpi',      label: 'أداء الناقلين',   icon: BarChart3,     section: 'reports', permKey: 'carriers.view' },
  { id: 'forecast',         path: '/forecast',         label: 'تنبؤ التدفّق',    icon: TrendingUp,    section: 'reports', permKey: 'forecast.view' },
  { id: 'internal-exports', path: '/internal-exports', label: 'ملفات النظام الداخلي', icon: FileText, section: 'reports', permKey: 'internal_exports.view' },

  // ── Finance ────────────────────────────────────────────────────
  // cod / payments / bank / payment-requests merged into /money
  // with 4 tabs. Legacy routes still resolve to the matching tab.
  // /money hosts 4 tabs. Listing them as `subTabs` makes each lens
  // visible & one-click in the sidebar (they used to be discoverable
  // only by opening /money first). Each navigates to the canonical
  // ?tab= URL the in-page tab strip also produces.
  { id: 'money',     path: '/money',    label: 'الأموال',  icon: Banknote,   section: 'finance', permKey: 'payments.view',
    subTabs: [
      { tabId: 'cod',      label: 'تسويات COD',  icon: Banknote,   legacy: '/cod-settlements' },
      { tabId: 'payments', label: 'الدفعات',      icon: CreditCard, legacy: '/payments' },
      { tabId: 'bank',     label: 'كشف بنكي',     icon: Wallet,     legacy: '/bank' },
      { tabId: 'requests', label: 'طلبات السداد', icon: Inbox,      legacy: '/payment-requests' },
    ] },

  // ── Customers (AR side) ───────────────────────────────────────
  // Customers + receivables + segments + merchants merged into
  // /customer-360 — kept the legacy routes alive in App so any
  // existing deep links still land on the right tab.
  { id: 'customer-hub',    path: '/customer-360',    label: 'العملاء',   icon: Users,       section: 'customers', permKey: 'receivables.view',
    subTabs: [
      { tabId: 'watch',       label: 'متابعة',        icon: Users,      legacy: '/customers' },
      { tabId: 'receivables', label: 'مديونيات',      icon: DollarSign, legacy: '/receivables' },
      { tabId: 'segments',    label: 'شرائح',         icon: Layers,     legacy: '/segments' },
      { tabId: 'merchants',   label: 'متاجر المنصّة', icon: ShoppingBag, legacy: '/merchants' },
    ] },
  { id: 'collections',     path: '/collections',     label: 'قائمة التحصيل',    icon: Phone,       section: 'customers', permKey: 'collections.view' },
  { id: 'reconciliation',  path: '/reconciliation',  label: 'مطابقة الأرصدة',   icon: GitCompare,  section: 'customers', permKey: 'reconciliation.view' },

  // ── System (config — least-touched) ───────────────────────────
  { id: 'carriers',     path: '/carriers',     label: 'إدارة الشركات',  icon: Truck,         section: 'system', permKey: 'carriers.view' },
  { id: 'contracts',    path: '/contracts',    label: 'جدول العقود',    icon: ClipboardList, section: 'system', permKey: 'carriers.edit_contract' },
  // Zoho snapshots are auto-processed on arrival (§1.14) — the inbox is now
  // a passive log, so it lives with the rarely-touched admin screens.
  { id: 'uploads',      path: '/uploads',      label: 'ملفات Zoho',     icon: Inbox,         section: 'system', permKey: 'uploads.view' },
  { id: 'integrity',    path: '/integrity',    label: 'سلامة البيانات', icon: FileCheck, section: 'system', permKey: 'system.view_audit_log' },
  { id: 'periods',      path: '/periods',      label: 'إقفال الفترات', icon: Lock,     section: 'system', permKey: 'system.period_close' },
  { id: 'activity-log', path: '/activity-log', label: 'سجل النشاط', icon: Activity, section: 'system', permKey: 'system.view_audit_log' },
  { id: 'employees',    path: '/employees',    label: 'الموظفون',    icon: UserCog,  section: 'system', adminOnly: true },
];
// Each section carries an accent color so the sidebar reads as
// five visually-distinct zones instead of one flat list. The color
// shows up on:
//   1. The section icon (always)
//   2. The active indicator on items in that section
//   3. The subtle left-edge bar on the active item
const NAV_SECTIONS = [
  { id: 'carriers',  label: 'شركات الشحن', icon: Building2, accent: '#3B82F6', hint: 'المراجعات والكشوف والدفتر' },
  { id: 'finance',   label: 'الأموال',      icon: DollarSign, accent: '#F59E0B', hint: 'COD والدفعات' },
  { id: 'customers', label: 'العملاء',      icon: Users,     accent: '#EF4444', hint: 'AR والمتابعة' },
  { id: 'reports',   label: 'التقارير',     icon: BarChart3, accent: '#10B981', hint: 'شهري · أداء · تنبؤ' },
  { id: 'system',    label: 'الإعدادات',    icon: Briefcase, accent: '#8B5CF6', hint: 'الإدارة والسجلات' },
];
// Paths that all render the CustomerHub page (which selects the
// right tab based on which path was used). Used to scope the
// PageSlot active check.
const CUSTOMER_HUB_PATHS = ['/customer-360', '/customers', '/receivables', '/merchants', '/segments'];
// /hub and /carrier-kpi share the same workspace component.
const CARRIER_WORKSPACE_PATHS = ['/hub', '/carrier-kpi'];
// /money hosts cod-settlements / payments / bank / payment-requests
// as four tabs. Legacy paths land on the right tab automatically.
const MONEY_HUB_PATHS = ['/money', '/cod-settlements', '/payments', '/bank', '/payment-requests'];

const PAGE_TITLES = {
  '/overview':          'الرئيسية',
  '/dashboard':         'الرئيسية (الإصدار القديم)',
  '/uploads':           'مركز الرفع',
  '/hub':               'كشف الشركات',
  '/carrier':           'بروفايل الشركة',
  '/webhook':           'الوارد',
  '/customers':         'متابعة العملاء',
  '/payment-requests':  'طلبات السداد',
  '/internal-exports':  'سحب للنظام الداخلي',
  '/upload':            'مراجعة جديدة',
  '/drop':              'رفع ملف',
  '/cash-aging':        'النقد والأعمار',
  '/integrity':         'سلامة البيانات',
  '/claims':            'المطالبات',
  '/audits':            'سجل المراجعات',
  '/weight-billing':    'فوترة الأوزان',
  '/ledger':            'دفتر الشركات',
  '/cod-settlements':   'تسويات الدفع عند الاستلام',
  '/money':             'حركة الأموال',
  '/payments':          'الدفعات',
  '/aramex-statements': 'كشوف خارجية',
  '/bank':              'كشف بنكي',
  '/receivables':       'مديونيات العملاء',
  '/customer-360':      'العملاء',
  '/collections':       'قائمة التحصيل',
  '/merchants':         'متاجر المنصّة',
  '/reconciliation':    'مطابقة أرصدة المتاجر',
  '/segments':          'شرائح العملاء',
  '/carriers':          'إدارة الشركات',
  '/contracts':         'جدول العقود',
  '/carrier-kpi':       'أداء الناقلين',
  '/activity-log':      'سجل النشاط',
  '/tasks':             'مهام الأسبوع',
  '/periods':           'إقفال الفترات',
  '/forecast':          'تنبؤ التدفّق النقدي',
  '/employees':         'الموظفون',
  '/settings/ai':            'الإعدادات — الذكاء الاصطناعي',
  '/settings/permissions':   'الإعدادات — الصلاحيات',
  '/settings/data':          'الإعدادات — البيانات',
  '/results':                'نتائج التدقيق',
};
const ROLE_LABEL = { admin: 'مدير', accountant: 'محاسب' };

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
  const { user, profile, loading: authLoading, signOut, can } = useAuth();
  const navigate  = useNavigate();
  const location  = useLocation();
  const isAdmin   = profile?.role === 'admin';
  const pathname  = location.pathname;
  const isSettingsPath = pathname.startsWith('/settings');
  const KNOWN_PATHS = ['/dashboard','/hub','/carrier','/carriers','/contracts','/upload','/results','/audits','/bank','/aramex-statements','/ledger','/cod-settlements','/payments','/payment-requests','/receivables','/merchants','/customers','/customer-360','/weight-billing','/internal-exports','/carrier-kpi','/activity-log','/webhook','/employees','/tasks','/segments','/periods','/forecast','/overview','/reconciliation','/uploads','/money','/collections','/monthly-report','/drop','/cash-aging','/integrity','/claims'];
  const isKnownPath = KNOWN_PATHS.includes(pathname) || isSettingsPath;

  const [carriers,        setCarriers]        = useState([]);
  const [carriersLoading, setCarriersLoading] = useState(false);
  const [collapsed,       setCollapsed]       = useState(false);
  const [mobileOpen,      setMobileOpen]      = useState(false);
  // Per-section open/closed state for the accordion. Persists in
  // localStorage so the operator's preferred layout survives reloads.
  // Default on first visit: open the carriers section (most-trafficked
  // group) and the section containing the current route.
  // Auto-accordion (v3): a section is open when it CONTAINS the active
  // route, or when the user explicitly peeked it (not persisted — the
  // sidebar should always come back short). This keeps the visible list
  // at ~8 doors + the active door's children, instead of every section
  // dumped open (the old v2 persisted-map behaviour).
  const [peekedSection, setPeekedSection] = useState(null);
  // Command palette (Ctrl/Cmd+K) — instant jump to any page or carrier
  // screen, so buried sections and carrier-page hopping aren't a chore.
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen(o => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // New-version detection: the SPA shell caches hard, and users repeatedly
  // hit stale bundles after a deploy (white pages, half-fixed bugs). Poll
  // index.html and compare the built bundle hash against the one this tab
  // loaded; on mismatch show a refresh banner. In dev there is no hashed
  // bundle script, so the effect is a no-op.
  const [updateAvailable, setUpdateAvailable] = useState(false);
  useEffect(() => {
    const current = [...document.querySelectorAll('script[src]')]
      .map(s => s.src.match(/assets\/index-([\w-]+)\.js/)?.[1])
      .find(Boolean);
    if (!current) return;
    let stop = false;
    const check = async () => {
      try {
        const html = await fetch(`/index.html?nv=${Date.now()}`, { cache: 'no-store' }).then(r => r.text());
        const latest = html.match(/assets\/index-([\w-]+)\.js/)?.[1];
        if (!stop && latest && latest !== current) setUpdateAvailable(true);
      } catch { /* offline / transient — try again next tick */ }
    };
    const t = setInterval(check, 90_000);
    check();
    return () => { stop = true; clearInterval(t); };
  }, []);
  const toggleSection = (id) => setPeekedSection(prev => (prev === id ? null : id));

  // ── Default redirect after login: always go to /overview ──
  // /overview was promoted to be the home page; /dashboard is kept
  // as a still-reachable legacy alias but no longer the landing.
  useEffect(() => {
    if (!profile) return;
    if (location.pathname === '/' || location.pathname === '' || location.pathname === '/dashboard') {
      navigate('/overview', { replace: true });
    }
  }, [profile, location.pathname]);

  // ── Load carriers ──
  const reloadCarriers = useCallback(async () => {
    if (!user) return;
    setCarriersLoading(true);
    try { setCarriers(await loadCarriers()); } catch { /* silent */ }
    setCarriersLoading(false);
  }, [user]);

  useEffect(() => { reloadCarriers(); }, [reloadCarriers]);

  // (The old "auto-open active section" effect is gone — the v3 accordion
  // derives the open section from the active route on every render, so
  // there is no state to sync and nothing to persist.)

  // Nav permissions used to live in a separate JSONB keyed by role
  // (NAV_PERMISSIONS in app_settings). That model is superseded by
  // the per-user permissions JSONB on profiles — see
  // src/lib/permissions.js. The legacy /settings/permissions page is
  // kept reachable but its nav filter no longer drives anything.

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
    // A hub item with subTabs never highlights itself — the matching
    // child sub-row carries the active state instead, so we avoid a
    // double highlight (parent + child) while inside the hub.
    if (item.subTabs && subTabOf(item)) return false;
    if (location.pathname === item.path) return true;
    if (item.path === '/upload' && location.pathname === '/results') return true;
    return false;
  };

  // Which subTab of a hub item is currently active, if any. A subTab
  // is active when we're on the canonical hub path with a matching
  // ?tab=, on the hub path with no ?tab= (→ first subTab is the
  // default), or on the subTab's legacy path.
  const subTabOf = (item) => {
    if (!item.subTabs) return null;
    if (location.pathname === item.path) {
      const cur = new URLSearchParams(location.search).get('tab');
      const effective = cur || item.subTabs[0].tabId;
      return item.subTabs.find(s => s.tabId === effective) || null;
    }
    return item.subTabs.find(s => s.legacy === location.pathname) || null;
  };
  const subTabActive = (item, sub) => subTabOf(item)?.tabId === sub.tabId;

  // ── Auth loading ──
  if (authLoading) return (
    <div style={{ height:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--bg)' }}>
      <Spinner size={28}/>
    </div>
  );

  if (!user || !profile) return <LoginPage/>;

  // Filter nav items by per-user permissions (src/lib/permissions.js).
  //   • admin → everything
  //   • accountant → items whose `permKey` is granted in profile.permissions
  //   • `adminOnly` items are hidden for accountants regardless of perms
  // Items without a `permKey` fall through as visible (legacy / global
  // items like the topbar shortcuts — add a permKey when gating them).
  const visibleNav = isAdmin
    ? NAV_ITEMS
    : NAV_ITEMS.filter(n => {
        if (n.adminOnly) return false;
        if (!n.permKey)  return true;
        return can(n.permKey);
      });

  const currentTitle = PAGE_TITLES[location.pathname]
    ?? (location.pathname.startsWith('/settings') ? 'الإعدادات' : 'ShipAudit');

  return (
    <>
      {mobileOpen && <div className="sidebar-backdrop" onClick={() => setMobileOpen(false)}/>}

      {/* New-version banner — one click replaces the stale bundle. */}
      {updateAvailable && (
        <button
          onClick={() => window.location.reload()}
          style={{
            position: 'fixed', bottom: 18, insetInlineStart: '50%',
            transform: 'translateX(50%)', zIndex: 9999,
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 18px', borderRadius: 999, border: 'none', cursor: 'pointer',
            background: 'var(--accent)', color: '#04342C',
            fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 700,
            boxShadow: '0 8px 24px rgba(0,0,0,.35)',
          }}
        >
          ↻ نسخة جديدة من النظام متاحة — اضغط للتحديث
        </button>
      )}

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        navItems={visibleNav}
        carriers={carriers}
      />

      <div className="app-layout">

        {/* ═══════════════ SIDEBAR ═══════════════ */}
        <aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>

          {/* Logo — Lamha brand */}
          <div className="sidebar-logo">
            {collapsed ? (
              <LamhaMark size={32}/>
            ) : (
              <div style={{ display:'flex', alignItems:'center', justifyContent:'center', width:'100%', background:'#f4f4f4', borderRadius:10 }}>
                <LamhaLogo height={102}/>
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
            {NAV_SECTIONS.map((sec, idx) => {
              const items = visibleNav.filter(n => n.section === sec.id);
              if (!items.length) return null;
              // Active = the item itself OR one of its hub subTabs (activeFor
              // deliberately returns false on the parent when a subTab matches,
              // so checking it alone would COLLAPSE the section you're inside).
              const sectionHasActive = items.some(n => activeFor(n) || (n.subTabs && subTabOf(n)));
              const isOpen = collapsed ? true : (sectionHasActive || peekedSection === sec.id);
              const SecIcon = sec.icon;
              return (
                <div key={sec.id} style={{ marginTop: idx === 0 ? 14 : 18 }}>
                  {collapsed ? (
                    // Collapsed mode: just a thin divider tinted with
                    // the section accent — gives a sense of grouping
                    // even when labels are hidden.
                    <div style={{
                      height: 2, margin: '10px 12px 8px',
                      borderRadius: 1,
                      background: `color-mix(in srgb, ${sec.accent} 30%, transparent)`,
                    }}/>
                  ) : (
                    <>
                      {/* Thin top divider — except above the very first
                          section since the pinned items above already
                          provide visual separation. */}
                      {idx > 0 && (
                        <div style={{
                          height: 1, margin: '0 8px 12px',
                          background: 'var(--border)',
                        }}/>
                      )}
                      <button
                        onClick={() => toggleSection(sec.id)}
                        aria-expanded={isOpen}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 9,
                          width: '100%', padding: '4px 14px 8px',
                          background: 'transparent', border: 'none',
                          cursor: 'pointer', fontFamily: 'var(--font-sans)',
                          textAlign: 'right',
                        }}
                      >
                        <SecIcon
                          size={13}
                          strokeWidth={2}
                          style={{
                            color: sec.accent,
                            opacity: sectionHasActive ? 1 : 0.7,
                            flexShrink: 0,
                          }}
                        />
                        <span style={{
                          flex: 1,
                          // Smaller, uppercase-style — clearly NOT a
                          // clickable item, more like a header label.
                          fontSize: 10.5,
                          fontWeight: 700,
                          letterSpacing: 1.2,
                          // Theme-aware: section color when active, muted
                          // label color otherwise. The old rgba(white) was
                          // invisible on the new white sidebar.
                          color: sectionHasActive ? sec.accent : 'var(--nav-label-color)',
                          textTransform: 'uppercase',
                          minWidth: 0,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {sec.label}
                        </span>
                        {sectionHasActive && !isOpen && (
                          <span style={{
                            width: 5, height: 5, borderRadius: '50%',
                            background: sec.accent,
                            boxShadow: `0 0 8px ${sec.accent}`,
                            flexShrink: 0,
                          }}/>
                        )}
                        <ChevronDown
                          size={11}
                          style={{
                            transition: 'transform .22s cubic-bezier(.4,0,.2,1)',
                            transform: isOpen ? 'rotate(0)' : 'rotate(-90deg)',
                            opacity: .55,
                            color: 'var(--muted)',
                            flexShrink: 0,
                          }}
                        />
                      </button>
                    </>
                  )}
                  <div style={{
                    overflow: 'hidden',
                    // Include any expanded subTab rows in the height so
                    // the accordion animation doesn't clip them.
                    maxHeight: isOpen
                      ? (items.reduce((acc, n) => acc + 1 + ((n.subTabs && !collapsed) ? n.subTabs.length : 0), 0)) * 42 + 12
                      : 0,
                    transition: 'max-height .25s cubic-bezier(.4,0,.2,1)',
                    paddingInlineEnd: collapsed ? 0 : 6,
                  }}>
                    {items.map(n => (
                      <div key={n.id}>
                        <NavBtn
                          n={n}
                          active={activeFor(n)}
                          accent={sec.accent}
                          collapsed={collapsed}
                          onClick={() => goto(n.path)}
                          nested
                        />
                        {/* Hub sub-tabs — surfaced as one-click rows so
                            each lens is visible without opening the hub
                            first. Hidden in collapsed mode (too narrow). */}
                        {n.subTabs && !collapsed && n.subTabs.map(sub => (
                          <NavSubBtn
                            key={sub.tabId}
                            sub={sub}
                            accent={sec.accent}
                            active={subTabActive(n, sub)}
                            onClick={() => goto(`${n.path}?tab=${sub.tabId}`)}
                          />
                        ))}
                      </div>
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
                background:'var(--surface)',
                border:'1px solid var(--border2)',
              }}>
                <div style={{
                  width:36, height:36, borderRadius:'50%', flexShrink:0,
                  background: profile.avatar_color || 'var(--brand-gradient)',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize:14, fontWeight:700, color:'#fff',
                  boxShadow:'0 4px 12px var(--accent-glow)',
                }}>
                  {profile.name?.[0] ?? '?'}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:600, color:'var(--text)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{profile.name}</div>
                  <div style={{ fontSize:11, color:'var(--muted)', marginTop:2 }}>{ROLE_LABEL[profile.role] ?? profile.role}</div>
                </div>
                <button onClick={signOut} title="تسجيل خروج" style={{
                  background:'transparent', border:'1px solid var(--border2)',
                  color:'var(--muted)',
                  cursor:'pointer', padding:'6px 7px', borderRadius:8,
                  display:'flex', alignItems:'center', transition:'all .15s',
                }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--red)'; e.currentTarget.style.borderColor = 'var(--red)'; }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--muted)'; e.currentTarget.style.borderColor = 'var(--border2)'; }}
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
              {/* Quick search / command palette trigger */}
              <button
                onClick={() => setPaletteOpen(true)}
                title="بحث سريع (Ctrl+K)"
                style={{
                  marginInlineStart: 'auto', display: 'flex', alignItems: 'center', gap: 8,
                  padding: '7px 12px', borderRadius: 999, cursor: 'pointer',
                  background: 'var(--surface)', border: '1px solid var(--border2)',
                  color: 'var(--muted)', fontFamily: 'var(--font-sans)', fontSize: 12.5,
                  maxWidth: 260, minWidth: 0,
                }}
              >
                <Search size={14}/>
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>بحث سريع…</span>
                <kbd style={{ fontSize: 10, border: '1px solid var(--border2)', borderRadius: 5, padding: '1px 5px', marginInlineStart: 'auto' }}>Ctrl K</kbd>
              </button>
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
            {/* /hub + /carrier-kpi share the same workspace now,
                CarriersWorkspace reads ?tab= or the legacy path to
                pick the right inner tab. */}
            <PageSlot active={CARRIER_WORKSPACE_PATHS.includes(pathname)} scroll>
              <CarriersWorkspace isActive={CARRIER_WORKSPACE_PATHS.includes(pathname)}/>
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
            <PageSlot active={pathname==='/aramex-statements'} scroll>
              <CarrierStatements carriers={carriers}/>
            </PageSlot>
            <PageSlot active={pathname==='/monthly-report'} scroll>
              <MonthlyReport isActive={pathname==='/monthly-report'}/>
            </PageSlot>
            <PageSlot active={pathname==='/drop'} scroll>
              <SmartDrop carriers={carriers}/>
            </PageSlot>
            <PageSlot active={pathname==='/cash-aging'} scroll>
              <CashAging isActive={pathname==='/cash-aging'}/>
            </PageSlot>
            <PageSlot active={pathname==='/integrity'} scroll>
              <IntegrityCheck isActive={pathname==='/integrity'}/>
            </PageSlot>
            <PageSlot active={pathname==='/claims'} scroll>
              <Claims carriers={carriers} isActive={pathname==='/claims'}/>
            </PageSlot>
            <PageSlot active={pathname==='/ledger'} scroll>
              <CarrierLedger isActive={pathname==='/ledger'}/>
            </PageSlot>
            {/* /cod-settlements + /payments + /bank + /payment-requests
                all funnel through MoneyHub which selects the right tab
                based on the path. */}
            <PageSlot active={MONEY_HUB_PATHS.includes(pathname)} scroll>
              <MoneyHub isActive={MONEY_HUB_PATHS.includes(pathname)}/>
            </PageSlot>
            {/* The 4 legacy customer routes (/receivables, /merchants,
                /segments, /customers) all funnel into the same hub
                page. CustomerHub reads the path on mount and selects
                the matching tab so deep links keep working. */}
            <PageSlot active={CUSTOMER_HUB_PATHS.includes(pathname)} scroll>
              <CustomerHub isActive={CUSTOMER_HUB_PATHS.includes(pathname)}/>
            </PageSlot>
            <PageSlot active={pathname==='/periods'} scroll>
              <Periods isActive={pathname==='/periods'}/>
            </PageSlot>
            <PageSlot active={pathname==='/forecast'} scroll>
              <Forecast carriers={carriers} isActive={pathname==='/forecast'}/>
            </PageSlot>
            <PageSlot active={pathname==='/overview'} scroll>
              <Overview carriers={carriers} isActive={pathname==='/overview'}/>
            </PageSlot>
            <PageSlot active={pathname==='/collections'} scroll>
              <Collections isActive={pathname==='/collections'}/>
            </PageSlot>
            <PageSlot active={pathname==='/reconciliation'} scroll>
              <Reconciliation isActive={pathname==='/reconciliation'}/>
            </PageSlot>
            <PageSlot active={pathname==='/uploads'} scroll>
              <UploadsHub isActive={pathname==='/uploads'}/>
            </PageSlot>
            <PageSlot active={pathname==='/weight-billing'} scroll>
              <WeightBilling carriers={carriers} isActive={pathname==='/weight-billing'}/>
            </PageSlot>
            <PageSlot active={pathname==='/internal-exports'} scroll>
              <InternalExports carriers={carriers} isActive={pathname==='/internal-exports'}/>
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
            {/* Employees page is the one truly admin-only page —
                gated even from accountants who hold every other
                permission. EmployeeManager itself further checks
                can('system.manage_employees') / .manage_permissions
                so wider read access could be granted later. */}
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
function NavBtn({ n, active, accent, collapsed, onClick, nested }) {
  const Icon = n.icon;
  // Section-tinted active state — when an `accent` prop is passed
  // (from a sectioned item) the active background, icon and dot all
  // take the section color. Pinned items (no accent) fall back to
  // the default green-accent CSS class.
  const inlineStyle = {
    ...(nested && !collapsed ? { paddingInlineStart: 22 } : {}),
  };
  if (active && accent) {
    inlineStyle.background    = `color-mix(in srgb, ${accent} 14%, transparent)`;
    inlineStyle.borderInlineEndColor = accent;  // RTL: shows on the right edge
    inlineStyle.borderInlineEndWidth = '2.5px';
    inlineStyle.borderInlineEndStyle = 'solid';
    inlineStyle.color         = '#fff';
    inlineStyle.fontWeight    = 600;
  }
  const iconColor = active && accent ? accent : undefined;
  return (
    <button
      className={`nav-item ${active && !accent ? 'active' : ''}`}
      onClick={onClick}
      title={collapsed ? n.label : undefined}
      style={inlineStyle}
    >
      <Icon
        size={15}
        strokeWidth={active ? 2.2 : 1.8}
        style={{ flexShrink: 0, color: iconColor }}
      />
      <span className="nav-label" style={{ flex: 1 }}>{n.label}</span>
      {active && (
        <span
          className={accent ? '' : 'nav-dot'}
          style={accent ? {
            width: 6, height: 6, borderRadius: '50%',
            background: accent, boxShadow: `0 0 8px ${accent}`,
            flexShrink: 0,
          } : undefined}
        />
      )}
    </button>
  );
}

// Sub-row under a hub NavBtn — smaller, deeper-indented, with a thin
// connector tick. Highlights with the section accent when its tab is
// the active one. Purely a navigation shortcut into the hub's tab.
function NavSubBtn({ sub, accent, active, onClick }) {
  const Icon = sub.icon;
  return (
    <button
      className="nav-item"
      onClick={onClick}
      style={{
        paddingInlineStart: 38,
        paddingTop: 5, paddingBottom: 5,
        minHeight: 0,
        ...(active ? {
          background: `color-mix(in srgb, ${accent} 12%, transparent)`,
          color: '#fff', fontWeight: 600,
        } : {}),
      }}
    >
      {Icon && (
        <Icon
          size={13}
          strokeWidth={active ? 2.2 : 1.7}
          style={{ flexShrink: 0, color: active ? accent : undefined, opacity: active ? 1 : 0.75 }}
        />
      )}
      <span className="nav-label" style={{ flex: 1, fontSize: 12.5 }}>{sub.label}</span>
      {active && (
        <span style={{
          width: 5, height: 5, borderRadius: '50%',
          background: accent, boxShadow: `0 0 8px ${accent}`,
          flexShrink: 0,
        }}/>
      )}
    </button>
  );
}

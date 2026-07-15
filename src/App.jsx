import { useState, useEffect, useCallback } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Truck, Upload, History, Settings,
  ChevronLeft, ChevronRight, ChevronDown, Menu, X, Users, Sun, Moon, Wallet, FileText, BookOpen, Banknote, CreditCard, BarChart3, Activity, LogOut, Scale, Webhook, ClipboardList, Building2, Inbox, ShoppingBag, Briefcase, FileCheck, DollarSign, UserCog, ListTodo, Layers, Lock, TrendingUp, GitCompare, Phone, CalendarRange, Search, Gauge, Headset, Boxes, HandCoins, Target, MessageCircle, UserPlus,
} from 'lucide-react';
import { ToastContainer, Spinner } from './components/UI.jsx';
import { LamhaMark } from './components/BrandLogo.jsx';
import AIChat from './components/AIChat.jsx';
import { AuthProvider, useAuth } from './lib/auth.jsx';
import { loadCarriers, loadAuditByIdFromDB } from './lib/coreService.js';
import CarrierProfile from './pages/CarrierProfile.jsx';
import CustomerPortal from './pages/CustomerPortal.jsx';
import InternalExports from './pages/InternalExports.jsx';
import CarrierManager from './pages/CarrierManager.jsx';
import UploadWizard   from './pages/UploadWizard.jsx';
import AuditResults   from './pages/AuditResults.jsx';
import { SettingsPage, AuditsHistory } from './pages/Settings.jsx';
import LoginPage      from './pages/LoginPage.jsx';
import EmployeeManager from './pages/EmployeeManager.jsx';
import CarrierStatements from './pages/CarrierStatements.jsx';
import CarrierLedger     from './pages/CarrierLedger.jsx';
import ActivityLog       from './pages/ActivityLog.jsx';
import WeightBilling     from './pages/WeightBilling.jsx';
import WebhookEvents     from './pages/WebhookEvents.jsx';
import ContractsOverview from './pages/ContractsOverview.jsx';
import Tasks            from './pages/Tasks.jsx';
import CustomerWatch    from './pages/CustomerWatch.jsx';
import CarriersWorkspace from './pages/CarriersWorkspace.jsx';
import CrmWorkspace      from './pages/CrmWorkspace.jsx';
import FulfillmentAudit  from './pages/FulfillmentAudit.jsx';
import MoneyHub          from './pages/MoneyHub.jsx';
import Periods          from './pages/Periods.jsx';
import Forecast         from './pages/Forecast.jsx';
import MonthlyReport     from './pages/MonthlyReport.jsx';
import ReportsCenter     from './pages/ReportsCenter.jsx';
import ZohoCallback      from './pages/ZohoCallback.jsx';
import FinancialPosition from './pages/FinancialPosition.jsx';
import ZohoData          from './pages/ZohoData.jsx';
import CollectionsHub    from './pages/CollectionsHub.jsx';
import SalesHub          from './pages/SalesHub.jsx';
import WhatsAppSettings   from './pages/WhatsAppSettings.jsx';
import SmartDrop         from './pages/SmartDrop.jsx';
import CashAging         from './pages/CashAging.jsx';
import IntegrityCheck    from './pages/IntegrityCheck.jsx';
// Claims now renders inside CarriersWorkspace (claims tab), not a top-level route.
import DecisionsBoard   from './pages/DecisionsBoard.jsx';
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
  // Only the home screen is pinned — every other entry lives under a
  // labelled section, so the always-visible block stays tiny (was 4 rows).
  { id: 'overview',  path: '/overview',  label: 'الرئيسية',      icon: LayoutDashboard, pinned: true, permKey: 'overview.view' },
  // "شاشة الصباح" — every decision signal across the app in one screen.
  { id: 'decisions', path: '/decisions', label: 'لوحة القرارات', icon: Gauge,          pinned: true, permKey: 'overview.view' },

  // ── Carriers — العمل اليومي مع الناقلين ─────────────────────────
  // الشركات hub now hosts 3 lenses as sub-tabs (CarriersWorkspace): cards,
  // carrier KPIs (was /carrier-kpi in reports), claims (was a flat item).
  { id: 'hub',          path: '/hub',               label: 'حالة الناقلين',   icon: Building2,  section: 'carriers', permKey: 'carriers.view',
    subTabs: [
      { tabId: 'hub',    label: 'البطاقات',      icon: Building2 },
      { tabId: 'kpi',    label: 'أداء الناقلين', icon: BarChart3, legacy: '/carrier-kpi' },
      { tabId: 'claims', label: 'المطالبات',     icon: Scale,     legacy: '/claims' },
    ] },
  // كشوف الحساب raised to position #2 + a VIEW permission (was upload-only,
  // which hid it from view-only accountants) so it's reachable in ≤2 clicks.
  // The upload button inside the page stays gated by carriers.upload_statement.
  { id: 'aramex-stmt',  path: '/aramex-statements', label: 'كشوف ومطابقات',   icon: FileText,   section: 'carriers', permKey: 'carriers.view' },
  { id: 'fulfillment',  path: '/fulfillment',    label: 'تدقيق فواتير التجهيز', icon: Briefcase, section: 'carriers', permKey: 'audits.view' },
  { id: 'audits',       path: '/audits',            label: 'مراجعات الفواتير', icon: History,   section: 'carriers', permKey: 'audits.view' },
  { id: 'ledger',       path: '/ledger',            label: 'دفتر الناقلين',    icon: BookOpen,   section: 'carriers', permKey: 'ledger.view' },

  // ── Reports — قراءة فقط ─────────────────────────────────────────
  { id: 'reports',          path: '/reports',          label: 'مكتبة التقارير',  icon: FileText,      section: 'reports', permKey: 'carriers.view' },
  { id: 'cash-aging',       path: '/cash-aging',       label: 'أعمار النقد',     icon: Wallet,        section: 'finance', permKey: 'ledger.view' },
  { id: 'monthly-report',   path: '/monthly-report',   label: 'التقرير الشهري',  icon: CalendarRange, section: 'reports', permKey: 'carriers.view' },
  // (carrier-kpi moved into the الشركات hub as the «أداء الناقلين» sub-tab)
  { id: 'forecast',         path: '/forecast',         label: 'تنبؤ التدفّق',    icon: TrendingUp,    section: 'finance', permKey: 'forecast.view' },
  { id: 'weight-billing',   path: '/weight-billing',   label: 'الأوزان الزائدة', icon: Scale,         section: 'reports', permKey: 'internal_exports.view' },
  { id: 'internal-exports', path: '/internal-exports', label: 'التصدير الداخلي', icon: FileText,      section: 'reports', permKey: 'internal_exports.view' },

  // ── Finance ────────────────────────────────────────────────────
  // cod / payments / bank / payment-requests merged into /money
  // with 4 tabs. Legacy routes still resolve to the matching tab.
  // /money hosts 4 tabs. Listing them as `subTabs` makes each lens
  // visible & one-click in the sidebar (they used to be discoverable
  // only by opening /money first). Each navigates to the canonical
  // ?tab= URL the in-page tab strip also produces.
  // «هل نربح؟» — قائمة الدخل الرسمية من Zoho Books مترجمة لغير المالي
  { id: 'pnl',       path: '/pnl',      label: 'الربحية',        icon: TrendingUp, section: 'finance', permKey: 'money.pnl' },
  { id: 'money',     path: '/money',    label: 'النقد والمدفوعات', icon: Banknote, section: 'finance', permKey: 'payments.view',
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
  // «تحصيل العملاء» — شاشة التحصيل الأولى (زوهو API المرجع)، أول عنصر بالقسم
  // §1.32 مرحلة 2: مركز التحصيل = تحصيل العملاء + قائمة التحصيل + القانوني + الكشف الداخلي
  { id: 'collections-hub', path: '/customer-money',  label: 'مركز التحصيل',  icon: HandCoins, section: 'collections', permKey: 'receivables.view',
    subTabs: [
      { tabId: 'money',    label: 'تحصيل العملاء',   icon: HandCoins },
      { tabId: 'queue',    label: 'قائمة التحصيل',   icon: Phone,  legacy: '/collections' },
      { tabId: 'legal',    label: 'التصعيد القانوني', icon: Scale,  legacy: '/legal' },
      { tabId: 'internal', label: 'الكشف الداخلي',   icon: FileText, legacy: '/receivables' },
    ] },
  // §1.32 مرحلة 3: مركز المبيعات = إعادة الاستهداف + فرص هاتف + خارج المنصّة + الشرائح + المتاجر
  { id: 'sales-hub',       path: '/retargeting',     label: 'مركز المبيعات',  icon: Target,    section: 'sales', permKey: 'sales.view',
    subTabs: [
      { tabId: 'retargeting', label: 'إعادة الاستهداف',    icon: Target },
      { tabId: 'hatif',       label: 'فرص من هاتف',        icon: UserPlus,    legacy: '/hatif-leads' },
      { tabId: 'external',    label: 'عملاء خارج المنصّة', icon: ShoppingBag },
      { tabId: 'segments',    label: 'شرائح العملاء',      icon: Layers,      legacy: '/segments' },
      { tabId: 'merchants',   label: 'متاجر المنصّة',      icon: ShoppingBag, legacy: '/merchants' },
    ] },
  { id: 'customer-watch',  path: '/customer-360',    label: 'متابعة العملاء', icon: Users,     section: 'collections', permKey: 'receivables.view' },
  // قائمة التحصيل دُمجت تبويباً أول داخل CRM (موافقة المستخدم 2026-07-02) —
  // /collections القديم يهبط على تبويبها داخل CrmWorkspace.
  { id: 'crm',             path: '/crm',             label: 'CRM العملاء', icon: Headset,   section: 'sales', permKey: 'crm.view',
    subTabs: [
      { tabId: 'queue', label: 'قائمة المتابعة',  icon: Headset },
      { tabId: 'leads', label: 'ليسوا عملاء لنا', icon: ShoppingBag },
      { tabId: 'deals', label: 'صفقات المبيعات',  icon: TrendingUp },
      { tabId: 'tasks', label: 'المواعيد',         icon: CalendarRange },
      { tabId: 'board', label: 'الأداء',           icon: BarChart3 },
    ] },
  { id: 'reconciliation',  path: '/reconciliation',  label: 'مطابقة زوهو ولمحة', icon: GitCompare, section: 'finance', permKey: 'reconciliation.view' },

  // ── الاستقبال والرفع — أبواب دخول الملفات اليدوية فقط ──────────
  // Zoho moved out of this section: it is API-synced data now, not an inbox file.
  { id: 'drop',           path: '/drop',           label: 'رفع ذكي',      icon: Upload, section: 'carriers', permKey: 'audits.create' },
  { id: 'webhook',        path: '/webhook',        label: 'وارد الإيميل', icon: Inbox,  section: 'carriers', permKey: 'webhook.view' },

  // ── مصادر البيانات — صحة الربط والمرايا التي تغذي الأرقام ───────
  { id: 'zoho-data',      path: '/zoho-data',      label: 'زوهو API',     icon: BookOpen, section: 'finance', permKey: 'zoho.view' },
  { id: 'uploads',        path: '/uploads',        label: 'صحة المصادر',  icon: Layers,   section: 'system', permKey: 'uploads.view' },

  // ── الإعدادات والنظام (الأقل استخداماً) ─────────────────────────
  { id: 'tasks',        path: '/tasks',        label: 'مهام التشغيل',     icon: ListTodo,      section: 'system', permKey: 'audits.view' },
  { id: 'carriers',     path: '/carriers',     label: 'إعداد الناقلين',   icon: Truck, section: 'carriers', permKey: 'carriers.view' },
  { id: 'contracts',    path: '/contracts',    label: 'العقود والأسعار',  icon: ClipboardList, section: 'carriers', permKey: 'carriers.edit_contract' },
  { id: 'integrity',    path: '/integrity',    label: 'فحص سلامة البيانات', icon: FileCheck, section: 'system', permKey: 'system.view_audit_log' },
  { id: 'periods',      path: '/periods',      label: 'إقفال مالي',       icon: Lock,     section: 'finance', permKey: 'system.period_close' },
  { id: 'activity-log', path: '/activity-log', label: 'سجل النظام',       icon: Activity, section: 'system', permKey: 'system.view_audit_log' },
  { id: 'whatsapp-settings', path: '/whatsapp-settings', label: 'واتساب', icon: MessageCircle, section: 'whatsapp', permKey: 'whatsapp.view_log' },
  { id: 'employees',    path: '/employees',    label: 'الفريق والصلاحيات', icon: UserCog,  section: 'system', adminOnly: true },
];
// Each section carries an accent color so the sidebar reads as
// five visually-distinct zones instead of one flat list. The color
// shows up on:
//   1. The section icon (always)
//   2. The active indicator on items in that section
//   3. The subtle left-edge bar on the active item
const NAV_SECTIONS = [
  // §1.32 المرحلة 4: 7 أنظمة (موديولات) بدل 8 أقسام مبعثرة — قرار المستخدم 2026-07-15
  { id: 'carriers',    label: 'نظام الناقلين', icon: Truck,         accent: '#3B82F6', hint: 'فواتير · تدقيق · وارد' },
  { id: 'finance',     label: 'نظام المالية',  icon: DollarSign,    accent: '#F59E0B', hint: 'ربح · بنك · زوهو' },
  { id: 'collections', label: 'نظام التحصيل',  icon: HandCoins,     accent: '#EF4444', hint: 'مديونيات · قانوني' },
  { id: 'sales',       label: 'نظام المبيعات', icon: Target,        accent: '#F97316', hint: 'فرص · CRM' },
  { id: 'whatsapp',    label: 'نظام واتساب',   icon: MessageCircle, accent: '#22C55E', hint: 'حملات · قوالب · تنبيهات' },
  { id: 'reports',     label: 'التقارير',      icon: BarChart3,     accent: '#10B981', hint: 'شهري · أوزان · تصدير' },
  { id: 'system',      label: 'الإدارة',       icon: Briefcase,     accent: '#8B5CF6', hint: 'فريق · سلامة · سجل' },
];
// Paths that all render the CustomerHub page (which selects the
// right tab based on which path was used). Used to scope the
// PageSlot active check.
const CUSTOMER_HUB_PATHS = ['/customer-360', '/customers'];
// مركز المبيعات (§1.32 المرحلة 3): الفرص الثلاث + الشرائح + دليل المتاجر
const SALES_HUB_PATHS = ['/retargeting', '/hatif-leads', '/segments', '/merchants'];
// مركز التحصيل (§1.32 المرحلة 2): 4 شاشات كانت متفرّقة — المسارات القديمة تهبط على تبويبها
const COLLECTIONS_HUB_PATHS = ['/customer-money', '/collections', '/legal', '/receivables'];
// /hub, /carrier-kpi, /claims all render the CarriersWorkspace (3 tabs).
const CARRIER_WORKSPACE_PATHS = ['/hub', '/carrier-kpi', '/claims'];
// /money hosts cod-settlements / payments / bank / payment-requests
// as four tabs. Legacy paths land on the right tab automatically.
const MONEY_HUB_PATHS = ['/money', '/cod-settlements', '/payments', '/bank', '/payment-requests'];

const PAGE_TITLES = {
  '/overview':          'الرئيسية',
  '/decisions':         'لوحة القرارات',
  '/crm':               'CRM العملاء',
  '/fulfillment':       'تدقيق فواتير التجهيز',
  '/monthly-report':    'التقرير الشهري',
  '/reports':           'مكتبة التقارير',
  '/zoho-callback':     'ربط زوهو',
  '/pnl':               'الربحية',
  '/zoho-data':         'زوهو API',
  '/customer-money':    'مركز التحصيل',
  '/legal':             'التصعيد القانوني',
  '/retargeting':       'مركز المبيعات',
  '/whatsapp-settings': 'إعدادات واتساب',
  '/hatif-leads':       'فرص من هاتف',
  '/uploads':           'صحة مصادر البيانات',
  '/hub':               'حالة الناقلين',
  '/carrier':           'بروفايل الشركة',
  '/webhook':           'وارد الإيميل',
  '/customers':         'متابعة العملاء',
  '/payment-requests':  'طلبات السداد',
  '/internal-exports':  'تصدير للأنظمة الداخلية',
  '/upload':            'مراجعة جديدة',
  '/drop':              'رفع ذكي',
  '/cash-aging':        'أعمار النقد',
  '/integrity':         'سلامة البيانات',
  '/claims':            'المطالبات',
  '/audits':            'سجل المراجعات',
  '/weight-billing':    'تصدير الأوزان الزائدة',
  '/ledger':            'دفتر الشركات',
  '/cod-settlements':   'تسويات الدفع عند الاستلام',
  '/money':             'النقد والمدفوعات',
  '/payments':          'الدفعات',
  '/aramex-statements': 'كشوف الحساب',
  '/bank':              'كشف بنكي',
  '/receivables':       'مديونيات العملاء',
  '/customer-360':      'متابعة العملاء',
  '/collections':       'قائمة التحصيل',
  '/merchants':         'متاجر المنصّة',
  '/reconciliation':    'مطابقة زوهو ولمحة',
  '/segments':          'شرائح العملاء',
  '/carriers':          'إعداد الناقلين',
  '/contracts':         'جدول العقود',
  '/carrier-kpi':       'أداء الناقلين',
  '/activity-log':      'سجل النشاط',
  '/tasks':             'مهام الأسبوع',
  '/periods':           'إقفال الفترات',
  '/forecast':          'تنبؤ التدفّق النقدي',
  '/employees':         'الموظفون',
  '/settings/ai':            'الإعدادات — الذكاء الاصطناعي',
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
  const KNOWN_PATHS = ['/hub','/carrier','/carriers','/contracts','/upload','/results','/audits','/bank','/aramex-statements','/ledger','/cod-settlements','/payments','/payment-requests','/receivables','/merchants','/customers','/customer-360','/weight-billing','/internal-exports','/carrier-kpi','/activity-log','/webhook','/employees','/tasks','/segments','/periods','/forecast','/overview','/reconciliation','/uploads','/money','/collections','/monthly-report','/drop','/cash-aging','/integrity','/claims','/decisions','/crm','/fulfillment','/reports','/zoho-callback','/pnl','/zoho-data','/customer-money','/legal','/retargeting','/whatsapp-settings','/hatif-leads'];
  const isKnownPath = KNOWN_PATHS.includes(pathname) || isSettingsPath;

  const [carriers,        setCarriers]        = useState([]);
  const [carriersLoading, setCarriersLoading] = useState(false);
  const [collapsed,       setCollapsed]       = useState(false);
  const [mobileOpen,      setMobileOpen]      = useState(false);
  const [pendingAudit,    setPendingAudit]    = useState(null);
  // Per-section open/closed state for the accordion. Persists in
  // localStorage so the operator's preferred layout survives reloads.
  // Default on first visit: open the carriers section (most-trafficked
  // group) and the section containing the current route.
  // Auto-accordion (v3): a section is open when it CONTAINS the active
  // route, or when the user explicitly peeked it (not persisted — the
  // sidebar should always come back short). This keeps the visible list
  // at ~8 doors + the active door's children, instead of every section
  // dumped open (the old v2 persisted-map behaviour).
  // Sidebar sections are OPEN by default (nothing buried — the #1 nav
  // complaint). The user may collapse the ones they don't want; that
  // preference is remembered. Stored as the SET of collapsed section ids.
  // v3 key: the reorg made التقارير + الإعدادات/النظام collapsed-by-default
  // (all occasional/rare) so the resting sidebar is short. Bumping the key
  // means every user gets the new default once, then their own toggles win.
  // v5 (2026-07-02، قرار المستخدم): أكورديون قسم-واحد — فتح قسم يقفل البقية
  // («لو فتحت قسم مفروض يقفل قسم حتى يكون سلس»). الافتراضي: **كل الأقسام
  // مقفلة** بما فيها شركات الشحن («الأفضل حتى قسم شركات الشحن افتراضياً
  // مقفل») — الجانبية تفتح دائماً على رؤوس الأقسام فقط + المثبّتين.
  // المفتاح الجديد يطبّق الافتراض مرة واحدة ثم تفضيل المستخدم يفوز.
  const ALL_SECTION_IDS = NAV_SECTIONS.map(s => s.id);
  const [collapsedSecs, setCollapsedSecs] = useState(() => {
    try {
      const stored = localStorage.getItem('sa-nav-collapsed-v5');
      return new Set(stored ? JSON.parse(stored) : ALL_SECTION_IDS);
    } catch { return new Set(ALL_SECTION_IDS); }
  });
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
  const toggleSection = (id) => setCollapsedSecs(prev => {
    // أكورديون: القسم المفتوح واحد فقط — فتح قسم يقفل كل البقية،
    // وإغلاق المفتوح يقفل الجميع.
    const wasCollapsed = prev.has(id);
    const next = new Set(ALL_SECTION_IDS);
    if (wasCollapsed) next.delete(id);
    try { localStorage.setItem('sa-nav-collapsed-v5', JSON.stringify([...next])); } catch { /* ignore */ }
    return next;
  });

  useEffect(() => {
    const activeItem = NAV_ITEMS.find(n => {
      if (!n.section) return false;
      if (location.pathname === n.path) return true;
      return n.subTabs?.some(s => s.legacy === location.pathname);
    });
    if (!activeItem?.section) return;
    setCollapsedSecs(prev => {
      if (!prev.has(activeItem.section)) return prev;
      const next = new Set(ALL_SECTION_IDS);
      next.delete(activeItem.section);
      try { localStorage.setItem('sa-nav-collapsed-v5', JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, [location.pathname]);

  // ── Default redirect after login: always go to /overview ──
  // /overview was promoted to be the home page; /dashboard is kept
  // as a still-reachable legacy alias but no longer the landing.
  useEffect(() => {
    if (!profile) return;
    if (location.pathname === '/' || location.pathname === '') {
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

  // ── Audit results: keep the fresh draft in memory. sessionStorage is
  // best-effort only: large audits can exceed the browser quota, and that
  // must never block navigation to /results.
  const rememberAudit = (audit) => {
    setPendingAudit(audit);
    try {
      sessionStorage.setItem('lastAudit', JSON.stringify(audit));
    } catch (e) {
      console.info('[audit-results] skipped sessionStorage cache:', e.message);
      try { sessionStorage.removeItem('lastAudit'); } catch { /* ignore */ }
    }
  };
  const handleAuditComplete = (audit) => {
    rememberAudit(audit);
    navigate('/results');
  };
  const handleOpenAudit = (audit) => {
    rememberAudit(audit);
    navigate('/results');
  };

  const activeFor = (item) => {
    // الصفوف الفرعية أُزيلت من الجانبية (v4) — الأب يحمل التمييز حين يكون
    // أي تبويب من تبويباته نشطاً (بما فيها المسارات القديمة legacy).
    if (item.subTabs && subTabOf(item)) return true;
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
              <div style={{
                display:'grid', gridTemplateColumns:'auto 1fr', alignItems:'center',
                gap:12, width:'100%',
              }}>
                <div style={{
                  width:48, height:48, borderRadius:14,
                  background:'var(--sidebar-logo-tile-bg, #fff)',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  boxShadow:'var(--sidebar-logo-shadow, 0 10px 24px rgba(2,8,23,.24))',
                }}>
                  <LamhaMark size={32}/>
                </div>
                <div style={{ minWidth:0 }}>
                  <div style={{ color:'var(--sidebar-brand-text, #fff)', fontSize:15, fontWeight:800, lineHeight:1.2 }}>ShipAudit Pro</div>
                  <div style={{ color:'var(--sidebar-brand-muted, rgba(199,210,254,.72))', fontSize:11, marginTop:3 }}>Lamha finance ops</div>
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
              const sectionHasActive = items.some(n => activeFor(n) || (n.subTabs && subTabOf(n)));
              const rowCount = items.reduce((sum, n) => (
                sum + 1 + (!collapsed && n.showSubTabsInNav && n.subTabs ? n.subTabs.length : 0)
              ), 0);
              // Accordion remains one-section-at-a-time. Navigation opens
              // the active section so action links are not hidden.
              // design-v2 (يتجاوز قرار الأكورديون v4): المجموعات ظاهرة دائماً
              // تحت عناوين خافتة — كالمعاينة المعتمدة direction-mock-v1.
              const isOpen = true;
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
                      {/* design-v2: العنوان تسمية ثابتة لا زرّ طيّ */}
                      <div
                        style={{
                          display: 'flex', alignItems: 'center', gap: 9,
                          width: '100%', padding: '10px 14px 6px',
                          background: 'transparent', border: 'none',
                          fontFamily: 'var(--font-sans)',
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
                        <div style={{
                          flex: 1,
                          minWidth: 0,
                          overflow: 'hidden',
                        }}>
                          <div style={{
                            fontSize: 11.5,
                            fontWeight: 800,
                            letterSpacing: 0,
                            color: sectionHasActive ? sec.accent : 'var(--nav-label-color)',
                            minWidth: 0,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {sec.label}
                          </div>
                          <div style={{
                            fontSize: 9.8,
                            fontWeight: 600,
                            letterSpacing: 0,
                            color: 'var(--nav-hint-color, rgba(199,210,254,.58))',
                            marginTop: 2,
                            minWidth: 0,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {sec.hint}
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                  <div style={{
                    overflow: 'hidden',
                    maxHeight: isOpen ? rowCount * 42 + 12 : 0,
                    transition: 'max-height .25s cubic-bezier(.4,0,.2,1)',
                    paddingInlineEnd: collapsed ? 0 : 6,
                  }}>
                    {/* بعض عناصر الـhub تعرض اختصارات فرعية عند الحاجة العملية للوصول السريع. */}
                    {items.map(n => {
                      const activeSubTab = subTabOf(n);
                      const showSubTabs = !collapsed && n.showSubTabsInNav && n.subTabs?.length;
                      return (
                        <div key={n.id}>
                          <NavBtn
                            n={n}
                            active={activeFor(n)}
                            accent={sec.accent}
                            collapsed={collapsed}
                            onClick={() => goto(n.path)}
                            nested
                          />
                          {showSubTabs && n.subTabs.map(t => (
                            <NavSubBtn
                              key={t.tabId}
                              tab={t}
                              active={activeSubTab?.tabId === t.tabId}
                              accent={sec.accent}
                              onClick={() => goto(`${n.path}?tab=${t.tabId}`)}
                            />
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>

          {/* Footer */}
          <div className="sidebar-footer">
            <NavBtn
              n={{ id:'settings', path:'/settings/ai', label:'إعدادات التطبيق', icon:Settings }}
              active={location.pathname.startsWith('/settings')}
              collapsed={collapsed}
              onClick={() => goto('/settings/ai')}
            />

            {!collapsed && (
              <div style={{
                marginTop:10, display:'flex', alignItems:'center', gap:11,
                padding:'12px 14px', borderRadius:14,
                background:'var(--sidebar-user-bg, rgba(255,255,255,.08))',
                border:'1px solid var(--sidebar-user-border, rgba(255,255,255,.10))',
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
                  <div style={{ fontSize:13, fontWeight:600, color:'var(--sidebar-brand-text, #fff)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{profile.name}</div>
                  <div style={{ fontSize:11, color:'var(--sidebar-brand-muted, rgba(199,210,254,.72))', marginTop:2 }}>{ROLE_LABEL[profile.role] ?? profile.role}</div>
                </div>
                <button onClick={signOut} title="تسجيل خروج" style={{
                  background:'var(--sidebar-logout-bg, rgba(255,255,255,.06))', border:'1px solid var(--sidebar-logout-border, rgba(255,255,255,.12))',
                  color:'var(--sidebar-logout-color, rgba(199,210,254,.82))',
                  cursor:'pointer', padding:'6px 7px', borderRadius:8,
                  display:'flex', alignItems:'center', transition:'all .15s',
                }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--red)'; e.currentTarget.style.borderColor = 'var(--red)'; }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--sidebar-logout-color, rgba(199,210,254,.82))'; e.currentTarget.style.borderColor = 'var(--sidebar-logout-border, rgba(255,255,255,.12))'; }}
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
                color:'var(--text)', whiteSpace:'nowrap', letterSpacing:0,
              }}>
                {currentTitle}
              </span>
              <span style={{
                color:'var(--muted)', fontSize:11, fontFamily:'var(--font-mono)',
                letterSpacing:1.5, textTransform:'uppercase', fontWeight:600,
                marginInlineStart:6,
              }}>
                Lamha
              </span>
              {/* Quick search / command palette trigger */}
              <button
                onClick={() => setPaletteOpen(true)}
                title="بحث سريع (Ctrl+K)"
                style={{
                  marginInlineStart: 'auto', display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 12px', borderRadius: 12, cursor: 'pointer',
                  background: '#FFFFFF', border: '1px solid var(--border2)',
                  color: 'var(--text2)', fontFamily: 'var(--font-sans)', fontSize: 12.5,
                  maxWidth: 320, minWidth: 220,
                  boxShadow: '0 1px 2px rgba(15,23,42,.04)',
                }}
              >
                <Search size={15}/>
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>عميل، فاتورة، AWB، صفحة…</span>
                <kbd style={{ fontSize: 10, border: '1px solid var(--border2)', borderRadius: 6, padding: '2px 6px', marginInlineStart: 'auto', color:'var(--muted)' }}>Ctrl K</kbd>
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

            <PageSlot active={pathname==='/decisions'} scroll>
              <DecisionsBoard isActive={pathname==='/decisions'}/>
            </PageSlot>
            {/* /hub + /carrier-kpi + /claims all render this workspace;
                CarriersWorkspace reads ?tab= or the legacy path to pick
                the right inner tab (cards / KPIs / claims). */}
            <PageSlot active={CARRIER_WORKSPACE_PATHS.includes(pathname)} scroll>
              <CarriersWorkspace carriers={carriers} isActive={CARRIER_WORKSPACE_PATHS.includes(pathname)}/>
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
              <AuditResultsPage auditFromState={pendingAudit} carriers={carriers} onNewAudit={() => navigate('/upload')} isActive={pathname==='/results'}/>
            </PageSlot>
            <PageSlot active={pathname==='/audits'} scroll>
              <AuditsHistory onOpen={handleOpenAudit} isActive={pathname==='/audits'}/>
            </PageSlot>
            <PageSlot active={pathname==='/aramex-statements'} scroll>
              <CarrierStatements carriers={carriers}/>
            </PageSlot>
            <PageSlot active={pathname==='/reports'} scroll>
              <ReportsCenter isActive={pathname==='/reports'}/>
            </PageSlot>
            {/* هبوط موافقة زوهو OAuth — بلا عنصر قائمة */}
            <PageSlot active={pathname==='/zoho-callback'} scroll>
              <ZohoCallback isActive={pathname==='/zoho-callback'}/>
            </PageSlot>
            <PageSlot active={COLLECTIONS_HUB_PATHS.includes(pathname)} scroll>
              <CollectionsHub isActive={COLLECTIONS_HUB_PATHS.includes(pathname)}/>
            </PageSlot>
            <PageSlot active={SALES_HUB_PATHS.includes(pathname)} scroll>
              <SalesHub isActive={SALES_HUB_PATHS.includes(pathname)}/>
            </PageSlot>
            <PageSlot active={pathname==='/whatsapp-settings'} scroll>
              <WhatsAppSettings isActive={pathname==='/whatsapp-settings'}/>
            </PageSlot>
            <PageSlot active={pathname==='/zoho-data'} scroll>
              <ZohoData isActive={pathname==='/zoho-data'}/>
            </PageSlot>
            <PageSlot active={pathname==='/pnl'} scroll>
              <FinancialPosition isActive={pathname==='/pnl'}/>
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
            {/* /claims now renders inside CarriersWorkspace (claims tab) above */}
            <PageSlot active={pathname==='/ledger'} scroll>
              <CarrierLedger isActive={pathname==='/ledger'}/>
            </PageSlot>
            {/* /cod-settlements + /payments + /bank + /payment-requests
                all funnel through MoneyHub which selects the right tab
                based on the path. */}
            <PageSlot active={MONEY_HUB_PATHS.includes(pathname)} scroll>
              <MoneyHub isActive={MONEY_HUB_PATHS.includes(pathname)}/>
            </PageSlot>
            {/* متابعة العملاء — كانت hub بأربعة تبويبات؛ بعد المرحلتين 2+3 بقيت المتابعة فقط */}
            <PageSlot active={CUSTOMER_HUB_PATHS.includes(pathname)} scroll>
              <CustomerWatch isActive={CUSTOMER_HUB_PATHS.includes(pathname)}/>
            </PageSlot>
            <PageSlot active={pathname==='/periods'} scroll>
              <Periods isActive={pathname==='/periods'}/>
            </PageSlot>
            <PageSlot active={pathname==='/forecast'} scroll>
              <Forecast carriers={carriers} isActive={pathname==='/forecast'}/>
            </PageSlot>
            {/* CRM/المتابعة — صفحة واحدة بـ5 تبويبات تقرأ ?tab= */}
            {/* /collections القديم يهبط على تبويب «قائمة التحصيل» داخل CRM */}
            <PageSlot active={pathname==='/crm'} scroll>
              <CrmWorkspace isActive={pathname==='/crm'}/>
            </PageSlot>
            {/* تدقيق التجهيز 3PL — مسار منفصل عن تدقيق الشحن */}
            <PageSlot active={pathname==='/fulfillment'} scroll>
              <FulfillmentAudit isActive={pathname==='/fulfillment'}/>
            </PageSlot>
            <PageSlot active={pathname==='/overview'} scroll>
              <Overview carriers={carriers} isActive={pathname==='/overview'}/>
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
                <Route path="*" element={<Navigate to="/overview" replace/>}/>
              </Routes>
            )}

          </div>
        </main>
      </div>

      {/* ── شريط التنقّل السفلي (جوال فقط ≤768px، مخفي بالـCSS على الحاسب) ──
          يختصر التنقّل اليومي من نقرتين عبر الدرج إلى نقرة واحدة. طبقة جوال
          منفصلة عن الدرج — لا تخالف قاعدة «لا تثبيت عناصر جديدة» (§1.11f). */}
      <nav className="bottom-nav">
        {[
          { path: '/overview',       label: 'الرئيسية', icon: LayoutDashboard, permKey: 'overview.view' },
          { path: '/decisions',      label: 'القرارات', icon: Gauge,           permKey: 'overview.view' },
          { path: '/drop',           label: 'رفع',      icon: Upload,          permKey: 'audits.create' },
          { path: '/webhook',        label: 'الوارد',   icon: Inbox,           permKey: 'webhook.view' },
        ].filter(it => isAdmin || can(it.permKey)).map(it => {
          const Icon = it.icon;
          const active = location.pathname === it.path;
          return (
            <button key={it.path} onClick={() => goto(it.path)}
              className={`bottom-nav-btn ${active ? 'active' : ''}`}>
              <Icon size={19}/>
              <span>{it.label}</span>
            </button>
          );
        })}
        <button className="bottom-nav-btn" onClick={() => setMobileOpen(true)}>
          <Menu size={19}/>
          <span>القائمة</span>
        </button>
      </nav>

      {/* Floating AI assistant — always available once logged in */}
      <AIChat/>
    </>
  );
}

// ── AuditResults wrapper (reads from sessionStorage when activated) ──────────
function AuditResultsPage({ auditFromState, carriers, onNewAudit, isActive }) {
  const [audit, setAudit] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!isActive) return;
    let live = true;
    if (auditFromState) {
      setAudit(auditFromState);
      return;
    }
    const auditId = new URLSearchParams(location.search).get('audit');
    if (auditId) {
      setAudit(null);
      loadAuditByIdFromDB(auditId)
        .then(a => {
          if (!live) return;
          try { sessionStorage.setItem('lastAudit', JSON.stringify(a)); } catch { /* ignore */ }
          setAudit(a);
        })
        .catch(() => {
          if (live) navigate('/audits', { replace: true });
        });
      return () => { live = false; };
    }
    try {
      const data = JSON.parse(sessionStorage.getItem('lastAudit') || 'null');
      if (data) { setAudit(data); }
      else { navigate('/upload', { replace: true }); }
    } catch { navigate('/upload', { replace: true }); }
    return () => { live = false; };
  }, [isActive, auditFromState, navigate, location.search]);

  if (!audit) return null;
  return <AuditResults audit={audit} carriers={carriers} onNewAudit={onNewAudit}/>;
}

// ── PageSlot: keeps page mounted, hides without triggering CSS animations ─────
function PageSlot({ active, scroll = false, children }) {
  return (
    <div className="page-slot" style={{
      position: 'absolute', inset: 0,
      overflow: scroll ? 'auto' : 'hidden',
      visibility: active ? 'visible' : 'hidden',
      pointerEvents: active ? 'auto' : 'none',
      display: 'flex', flexDirection: 'column', alignItems: 'stretch',
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
    ...(nested && !collapsed ? { marginInlineStart: 10 } : {}),
    ...(active && accent ? { '--item-accent': accent } : {}),
  };
  if (active && accent) {
    inlineStyle.color      = 'var(--text)';
    inlineStyle.fontWeight = 700;
  }
  const iconColor = active && accent ? accent : undefined;
  return (
    <button
      className={`nav-item ${active ? 'active' : ''} ${accent ? 'section-nav' : ''}`}
      onClick={onClick}
      title={collapsed ? n.label : undefined}
      style={inlineStyle}
    >
      <span className="nav-icon" style={iconColor ? { color: iconColor } : undefined}>
        <Icon
          size={15}
          strokeWidth={active ? 2.2 : 1.8}
        />
      </span>
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

// NavSubBtn: اختصارات فرعية خفيفة لعناصر محددة فقط.
// نستخدمها عندما يكون الوصول للتاب نفسه جزءاً من العمل اليومي، مثل ملف العملاء.
function NavSubBtn({ tab, active, accent, onClick }) {
  const Icon = tab.icon || ChevronLeft;
  return (
    <button
      onClick={onClick}
      className={`nav-sub-item ${active ? 'active' : ''}`}
      style={{
        width: 'calc(100% - 18px)',
        minHeight: 32,
        margin: '1px 14px 1px 4px',
        padding: '6px 10px',
        border: 'none',
        borderRadius: 9,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
        background: active ? `color-mix(in srgb, ${accent} 12%, transparent)` : 'transparent',
        color: active ? accent : 'var(--nav-label-color)',
        fontSize: 11.5,
        fontWeight: active ? 800 : 650,
        textAlign: 'right',
      }}
    >
      <span style={{
        width: 20,
        height: 20,
        borderRadius: 7,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: active ? accent : 'var(--muted)',
        background: active ? `color-mix(in srgb, ${accent} 10%, transparent)` : 'transparent',
        flexShrink: 0,
      }}>
        <Icon size={12} strokeWidth={active ? 2.2 : 1.8}/>
      </span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {tab.label}
      </span>
      {active && (
        <span style={{
          width: 5,
          height: 5,
          borderRadius: '50%',
          background: accent,
          boxShadow: `0 0 8px ${accent}`,
          flexShrink: 0,
        }}/>
      )}
    </button>
  );
}

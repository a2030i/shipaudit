import { useState, useEffect, useCallback, Component } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Truck, Upload, History, Settings,
  ChevronLeft, ChevronRight, ChevronDown, Menu, X, Users, Sun, Moon, Wallet, FileText, BookOpen, Banknote, CreditCard, BarChart3, Activity, LogOut, Scale, Webhook, ClipboardList, Building2, Inbox, ShoppingBag, Briefcase, FileCheck, DollarSign, UserCog, ListTodo, Layers, Lock, TrendingUp, GitCompare, Phone, CalendarRange, Search, Gauge, Headset, Boxes, HandCoins, Target, MessageCircle, UserPlus, LifeBuoy,
} from 'lucide-react';
import { ToastContainer, Spinner } from './components/UI.jsx';
import { LamhaMark, LamhaLogo } from './components/BrandLogo.jsx';
import AIChat from './components/AIChat.jsx';
import { AuthProvider, useAuth } from './lib/auth.jsx';
import { logLogin, logPageView, logDenied } from './lib/activityLogger.js';
import { PAGE_TITLES } from './lib/pageTitles.js';
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
import PlatformCarriers  from './pages/PlatformCarriers.jsx';
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
import NextActions      from './pages/NextActions.jsx';
import CommandPalette    from './components/CommandPalette.jsx';
import Overview         from './pages/Overview.jsx';
import Reconciliation   from './pages/Reconciliation.jsx';
import UploadsHub       from './pages/UploadsHub.jsx';
import TicketForm       from './pages/TicketForm.jsx';
import SupportBoard     from './pages/SupportBoard.jsx';

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
  // قائمة اليوم العابرة للتحصيل والمبيعات — اسمها يشرح أنها مهام، لا شاشة تحليل أخرى.
  { id: 'next-actions', path: '/next-actions', label: 'مهام العملاء اليوم', icon: Target, section: 'customers', permAny: ['collections.view', 'sales.view', 'overview.view'] },

  // ── نظام شركات الشحن — مرتّب بتدفّق العمل اليومي: استقبال → تدقيق → حسابات ──
  // مراجعة المسميات (2026-07-15، طلب المستخدم): لغة إنسان عادي — لا «مطابقات/دفتر/تدفّق».
  { id: 'hub',          path: '/hub',               label: 'حالة الشركات',   icon: Building2,  section: 'carriers', permKey: 'carriers.view',
    subTabs: [
      { tabId: 'hub',    label: 'البطاقات',     icon: Building2 },
      { tabId: 'kpi',    label: 'أداء الشركات', icon: BarChart3, legacy: '/carrier-kpi' },
      { tabId: 'claims', label: 'المطالبات',    icon: Scale,     legacy: '/claims' },
    ] },
  { id: 'drop',         path: '/drop',              label: 'رفع ملف',          icon: Upload,    section: 'carriers', permKey: 'audits.create' },
  { id: 'webhook',      path: '/webhook',           label: 'وارد الفواتير',    icon: Inbox,     section: 'carriers', permKey: 'webhook.view' },
  { id: 'audits',       path: '/audits',            label: 'تدقيق الفواتير',   icon: History,   section: 'carriers', permKey: 'audits.view' },
  { id: 'aramex-stmt',  path: '/aramex-statements', label: 'كشوف حساب الشركات', icon: FileText, section: 'carriers', permKey: 'carriers.view' },
  { id: 'ledger',       path: '/ledger',            label: 'حسابات الشركات',   icon: BookOpen,  section: 'carriers', permKey: 'ledger.view' },
  { id: 'platform-carriers', path: '/platform-carriers', label: 'شركات المنصّة المفعّلة', icon: DollarSign, section: 'carriers', permKey: 'carriers.view' },
  // فواتير التجهيز — نادرة → «الأدوات»
  { id: 'fulfillment',  path: '/fulfillment',       label: 'فواتير التجهيز',   icon: Briefcase, section: 'tools', permKey: 'audits.view' },

  // ── الحملات والتقارير ───────────────────────────────────────────
  { id: 'reports',          path: '/reports',          label: 'مكتبة التقارير',        icon: FileText,      section: 'outreach', permKey: 'carriers.view' },
  { id: 'monthly-report',   path: '/monthly-report',   label: 'التقرير الشهري',        icon: CalendarRange, section: 'outreach', permKey: 'carriers.view' },
  { id: 'weight-billing',   path: '/weight-billing',   label: 'فوترة الأوزان الزائدة', icon: Scale,         section: 'tools',    permKey: 'internal_exports.view' },
  { id: 'internal-exports', path: '/internal-exports', label: 'التصدير وسجل الملفات',  icon: FileText,      section: 'outreach', permKey: 'internal_exports.view' },

  // ── نظام الأموال — هل نربح؟ → البنك → زوهو → المطابقة → الديون → المستقبل ──
  { id: 'pnl',       path: '/pnl',      label: 'الأرباح والخسائر',  icon: TrendingUp, section: 'money', permKey: 'money.pnl' },
  { id: 'money',     path: '/money',    label: 'البنك والمدفوعات',  icon: Banknote,   section: 'money', permKey: 'payments.view',
    subTabs: [
      { tabId: 'cod',      label: 'تسويات COD',  icon: Banknote,   legacy: '/cod-settlements' },
      { tabId: 'payments', label: 'الدفعات',      icon: CreditCard, legacy: '/payments' },
      { tabId: 'bank',     label: 'كشف البنك',    icon: Wallet,     legacy: '/bank' },
      { tabId: 'requests', label: 'طلبات السداد', icon: Inbox,      legacy: '/payment-requests' },
    ] },
  { id: 'cash-aging', path: '/cash-aging', label: 'أعمار الديون',  icon: Wallet,     section: 'money', permKey: 'ledger.view' },
  { id: 'forecast',   path: '/forecast',   label: 'توقّع السيولة', icon: TrendingUp, section: 'money', permKey: 'forecast.view' },

  // ── Customers (AR side) ───────────────────────────────────────
  // Customers + receivables + segments + merchants merged into
  // /customer-360 — kept the legacy routes alive in App so any
  // existing deep links still land on the right tab.
  { id: 'customer-watch',  path: '/customer-360',    label: 'ملفات العملاء', icon: Users,     section: 'customers', permKey: 'receivables.view' },
  // «تحصيل العملاء» — شاشة التحصيل الأولى (زوهو API المرجع)، أول عنصر بالقسم
  // §1.32 مرحلة 2: مركز التحصيل = تحصيل العملاء + قائمة التحصيل + القانوني + الكشف الداخلي
  { id: 'collections-hub', path: '/customer-money',  label: 'الديون والتحصيل',  icon: HandCoins, section: 'customers', permKey: 'receivables.view',
    subTabs: [
      { tabId: 'money',    label: 'أرصدة العملاء',   icon: HandCoins },
      { tabId: 'queue',    label: 'قائمة التحصيل',    icon: Phone,  legacy: '/collections' },
      { tabId: 'legal',    label: 'التصعيد القانوني', icon: Scale,  legacy: '/legal' },
      { tabId: 'internal', label: 'الكشف الداخلي',   icon: FileText, legacy: '/receivables' },
    ] },
  // §1.32 مرحلة 3: مركز المبيعات = إعادة الاستهداف + فرص هاتف + خارج المنصّة + الشرائح + المتاجر
  // مركز المبيعات: صلاحية مستقلة لكل تبويب (تفصيص 2026-07-16) — permAny = يظهر
  // العنصر لمن يملك أياً منها، وSalesHub يفلتر تبويباته بالمفتاح الدقيق.
  { id: 'sales-hub',       path: '/retargeting',     label: 'فرص البيع',  icon: Target,    section: 'customers',
    permAny: ['sales.view', 'sales.hatif_leads', 'sales.external_leads', 'sales.segments', 'merchants.view'],
    subTabs: [
      { tabId: 'today',       label: 'خطة اليوم',           icon: Target },
      { tabId: 'retargeting', label: 'إعادة الاستهداف',    icon: Target },
      { tabId: 'hatif',       label: 'فرص من هاتف',        icon: UserPlus,    legacy: '/hatif-leads' },
      { tabId: 'external',    label: 'عملاء خارج المنصّة', icon: ShoppingBag },
      { tabId: 'segments',    label: 'مجموعات العملاء',      icon: Layers,      legacy: '/segments' },
      { tabId: 'merchants',   label: 'متاجر المنصّة',      icon: ShoppingBag, legacy: '/merchants' },
    ] },
  // قائمة التحصيل دُمجت تبويباً أول داخل CRM (موافقة المستخدم 2026-07-02) —
  // /collections القديم يهبط على تبويبها داخل CrmWorkspace.
  { id: 'crm',             path: '/crm',             label: 'الصفقات والمتابعات', icon: TrendingUp, section: 'customers', permKey: 'crm.view',
    subTabs: [
      { tabId: 'queue', label: 'قائمة المتابعة',  icon: Headset },
      { tabId: 'deals', label: 'صفقات المبيعات',  icon: TrendingUp },
      { tabId: 'tasks', label: 'المواعيد',         icon: CalendarRange },
      { tabId: 'board', label: 'الأداء',           icon: BarChart3 },
    ] },
  // تذاكر خدمة العملاء (§1.35) — لوحة المتابعة؛ نموذج الإدخال السريع على /ticket (شاشة مستقلة)
  { id: 'support',         path: '/support',         label: 'خدمة العملاء', icon: LifeBuoy, section: 'customers', permKey: 'support.view' },
  { id: 'zoho-data',       path: '/zoho-data',       label: 'بيانات زوهو',       icon: BookOpen,   section: 'money', permKey: 'zoho.view' },
  { id: 'reconciliation',  path: '/reconciliation',  label: 'مطابقة زوهو مع لمحة', icon: GitCompare, section: 'money', permKey: 'reconciliation.view' },

  // ── الحملات والتقارير ───────────────────────────────────────────
  { id: 'whatsapp-settings', path: '/whatsapp-settings', label: 'منصة هاتف', icon: MessageCircle, section: 'outreach', permKey: 'whatsapp.view_log' },

  // ── الإعدادات والأدوات (الأقل استخداماً + الإعداد + النادر) ──────
  { id: 'employees',    path: '/employees',    label: 'الفريق والصلاحيات',  icon: UserCog,       section: 'tools', adminOnly: true },
  { id: 'carriers',     path: '/carriers',     label: 'إدارة الشركات',      icon: Truck,         section: 'tools', permKey: 'carriers.view' },
  { id: 'contracts',    path: '/contracts',    label: 'العقود والأسعار',    icon: ClipboardList, section: 'tools', permKey: 'carriers.edit_contract' },
  { id: 'periods',      path: '/periods',      label: 'إقفال الشهور',       icon: Lock,          section: 'tools', permKey: 'system.period_close' },
  { id: 'tasks',        path: '/tasks',        label: 'المهام',             icon: ListTodo,      section: 'tools', permKey: 'audits.view' },
  { id: 'uploads',      path: '/uploads',      label: 'حالة مصادر البيانات', icon: Layers,       section: 'tools', permKey: 'uploads.view' },
  { id: 'integrity',    path: '/integrity',    label: 'فحص سلامة البيانات', icon: FileCheck,     section: 'tools', permKey: 'system.view_audit_log' },
  { id: 'activity-log', path: '/activity-log', label: 'سجل النظام',         icon: Activity,      section: 'tools', permKey: 'system.view_audit_log' },
];
// Each section carries an accent color so the sidebar reads as
// five visually-distinct zones instead of one flat list. The color
// shows up on:
//   1. The section icon (always)
//   2. The active indicator on items in that section
//   3. The subtle left-edge bar on the active item
const NAV_SECTIONS = [
  // دمج الأقسام (2026-07-21، قرار المستخدم «التبويبات كثيرة ومشتتة»): 7 أقسام → 5.
  // المبدأ: التجميع حسب مَن يستعملها/الوظيفة اليومية، والنادر/المرجعي يُنزَل لـ«الأدوات».
  //   • المالية + (البنك/COD/الدفعات) → «الأموال» (مالنا نحن)
  //   • التحصيل + المبيعات → «العملاء» (كل ما يخصّ العميل: تحصيل + بيع + دعم)
  //   • واتساب + التقارير → «الحملات والتقارير» (المخرجات والتواصل)
  //   • الإدارة + النادر (التجهيز/الأوزان/الإقفال/العقود/إدارة الشركات/المهام/المصادر) → «الإعدادات والأدوات»
  { id: 'carriers',  label: 'شركات الشحن',       icon: Truck,         accent: '#2B68DE', hint: 'فواتيرها · تدقيقها · حساباتها' },
  { id: 'money',     label: 'الأموال',           icon: DollarSign,    accent: '#F59E0B', hint: 'الأرباح · البنك · زوهو · الأعمار' },
  { id: 'customers', label: 'العملاء والمبيعات',  icon: Users,         accent: '#EF4444', hint: 'ملفات · ديون · فرص · صفقات · دعم' },
  { id: 'outreach',  label: 'الحملات والتقارير', icon: MessageCircle, accent: '#22C55E', hint: 'واتساب · التقارير الجاهزة' },
  { id: 'tools',     label: 'الإعدادات والأدوات', icon: Briefcase,    accent: '#31D5E1', hint: 'الفريق · الفحوص · الإعداد · النادر' },
];
// ── الحارس المركزي للمسارات (2026-07-16) ──────────────────────────────
// 31 صفحة كانت بلا حارس داخلي — موظف محدود يكتب /bank أو /ledger في
// العنوان يرى كل المال (القائمة تخفي العنصر لكن الصفحة تُعرض).
// الخريطة تُشتق من NAV_ITEMS تلقائياً (المسار + مسارات subTabs القديمة)،
// فأي صفحة جديدة تُحمى بمجرد حملها permKey في القائمة. المسار الممنوع
// يُعامل كمسار مجهول → إعادة توجيه لأول صفحة مرئية للموظف.
const PATH_PERM = new Map();
for (const it of NAV_ITEMS) {
  const pk = it.permAny || it.permKey;   // permAny = مصفوفة «أيّ منها يكفي»
  if (!pk) continue;
  PATH_PERM.set(it.path, pk);
  for (const s of it.subTabs || []) if (s.legacy) PATH_PERM.set(s.legacy, pk);
}
// مسارات لا تظهر في القائمة
PATH_PERM.set('/carrier',   'carriers.view');
PATH_PERM.set('/upload',    'audits.create');
PATH_PERM.set('/results',   'audits.view');
PATH_PERM.set('/customers', 'receivables.view');

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

const ROLE_LABEL = { admin: 'مدير', accountant: 'موظف' };

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
  // الحارس المركزي: المسار الممنوع يصير '__locked__' فلا يطابق أي PageSlot
  // (لا عرض ولا جلب بيانات) ويسقط في تحويلة «مسار مجهول» → أول صفحة مسموحة.
  const rawPath   = location.pathname;
  const pathPermKey = rawPath.startsWith('/settings') ? 'system.view_settings' : PATH_PERM.get(rawPath);
  const pathAllowed = isAdmin || !pathPermKey
    || (Array.isArray(pathPermKey) ? pathPermKey.some(k => can(k)) : can(pathPermKey));
  const pathname  = pathAllowed ? rawPath : '__locked__';
  const isSettingsPath = pathAllowed && rawPath.startsWith('/settings');

  // سجل التحركات (§1.36): دخول مرة/جلسة + كل تنقّل + كل محاولة ممنوعة (بـIP سيرفري)
  useEffect(() => { if (user && profile) logLogin(); }, [user, profile]);
  useEffect(() => {
    if (!user || !profile) return;
    if (pathAllowed) logPageView(rawPath);
    else logDenied(rawPath, Array.isArray(pathPermKey) ? pathPermKey.join('|') : pathPermKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawPath, pathAllowed, user, profile]);
  const KNOWN_PATHS = ['/hub','/carrier','/carriers','/contracts','/upload','/results','/audits','/bank','/aramex-statements','/ledger','/cod-settlements','/payments','/payment-requests','/receivables','/merchants','/customers','/customer-360','/weight-billing','/internal-exports','/carrier-kpi','/activity-log','/webhook','/employees','/tasks','/segments','/periods','/forecast','/overview','/reconciliation','/uploads','/money','/collections','/monthly-report','/drop','/cash-aging','/integrity','/claims','/decisions','/crm','/fulfillment','/reports','/zoho-callback','/pnl','/zoho-data','/customer-money','/legal','/retargeting','/whatsapp-settings','/hatif-leads','/support','/platform-carriers','/next-actions'];
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
      const stored = localStorage.getItem('sa-nav-collapsed-v6');
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
    try { localStorage.setItem('sa-nav-collapsed-v6', JSON.stringify([...next])); } catch { /* ignore */ }
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
      try { localStorage.setItem('sa-nav-collapsed-v6', JSON.stringify([...next])); } catch { /* ignore */ }
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

  useEffect(() => {
    const title = PAGE_TITLES[rawPath]
      ?? (rawPath.startsWith('/settings') ? 'الإعدادات' : 'ShipAudit');
    document.title = `${title} — ShipAudit Pro`;
  }, [rawPath]);

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

  // «/ticket» — نموذج تذكرة الدعم السريع (§1.35): شاشة كاملة بلا قائمة جانبية.
  // خلف بوابة الدخول (ليس عاماً) — رابط مباشر يحفظه فريق خدمة العملاء.
  if (pathname === '/ticket') return <TicketForm/>;

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
        if (n.permAny)   return n.permAny.some(k => can(k));
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

          {/* هوية هادئة: الشعار الملون على السطح الفاتح، والأبيض في الداكن. */}
          <div className="sidebar-logo">
            {collapsed ? (
              <LamhaMark size={32}/>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:7, width:'100%', alignItems:'flex-start' }}>
                <LamhaLogo height={36} variant={theme === 'light' ? 'color' : 'white'}/>
                <div className="sidebar-product-label" style={{ display:'flex', alignItems:'center', gap:7 }}>
                  <span className="live-dot"/>
                  <span style={{ fontSize:10.5, fontWeight:700 }}>
                    منصة العمليات المالية
                  </span>
                </div>
              </div>
            )}
            {mobileOpen && (
              <button aria-label="إغلاق القائمة" onClick={() => setMobileOpen(false)} style={{ background:'none', border:'none', color:'var(--muted)', cursor:'pointer', marginRight:'auto', padding:4 }}>
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
              const sectionHasActive = items.some(n => activeFor(n) || (n.subTabs && subTabOf(n)));
              const rowCount = items.length;
              // في الوضع المصغّر تبقى الأيقونات متاحة. في الوضع الكامل يعمل
              // أكورديون قسم واحد حتى تظل مساحة العمل قصيرة وواضحة.
              const isOpen = collapsed || !collapsedSecs.has(sec.id);
              const SecIcon = sec.icon;
              return (
                <div key={sec.id} className={`nav-section ${isOpen ? 'open' : ''} ${sectionHasActive ? 'has-active' : ''}`}>
                  {collapsed ? (
                    <div className="nav-section-divider"/>
                  ) : (
                    <button
                      type="button"
                      className="nav-section-trigger"
                      aria-expanded={isOpen}
                      onClick={() => toggleSection(sec.id)}
                    >
                      <span className="nav-section-icon"><SecIcon size={15} strokeWidth={2}/></span>
                      <span className="nav-section-copy">
                        <strong>{sec.label}</strong>
                        <small>{sec.hint}</small>
                      </span>
                      <ChevronDown className="nav-section-chevron" size={15}/>
                    </button>
                  )}
                  <div
                    className="nav-section-items"
                    style={{ maxHeight: isOpen ? `${rowCount * 48 + 12}px` : 0 }}
                  >
                    {items.map(n => (
                      <NavBtn
                        key={n.id}
                        n={n}
                        active={activeFor(n)}
                        accent={sec.accent}
                        collapsed={collapsed}
                        onClick={() => goto(n.path)}
                        nested
                      />
                    ))}
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
            <button className="hamburger-btn" aria-label="فتح القائمة" onClick={() => setMobileOpen(true)}>
              <Menu size={16}/>
            </button>

            <div style={{ flex:1, display:'flex', alignItems:'center', gap:10, minWidth:0 }}>
              <span className="topbar-title" style={{
                fontFamily:'var(--font-sans)', fontSize:15, fontWeight:800,
                color:'var(--text)', whiteSpace:'nowrap', letterSpacing:0,
              }}>
                {currentTitle}
              </span>
              <span className="topbar-brandtag" style={{
                color:'var(--muted)', fontSize:11, fontFamily:'var(--font-mono)',
                letterSpacing:1.5, textTransform:'uppercase', fontWeight:600,
                marginInlineStart:6,
              }}>
                Lamha
              </span>
              {/* Quick search / command palette trigger — minWidth 220 يُصفَّر
                  على الجوال عبر .topbar-search (كان يوسّع التطبيق كله أفقياً) */}
              <button
                className="topbar-search"
                onClick={() => setPaletteOpen(true)}
                title="بحث سريع (Ctrl+K)"
                style={{
                  marginInlineStart: 'auto', display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 12px', borderRadius: 12, cursor: 'pointer',
                  background: 'var(--surface)', border: '1px solid var(--border2)',
                  color: 'var(--text2)', fontFamily: 'var(--font-sans)', fontSize: 12.5,
                  maxWidth: 320, minWidth: 220,
                  boxShadow: '0 1px 2px rgba(15,23,42,.04)',
                }}
              >
                <Search size={15}/>
                <span className="topbar-search-hint" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>عميل، فاتورة، AWB، صفحة…</span>
                <kbd className="topbar-search-kbd" style={{ fontSize: 10, border: '1px solid var(--border2)', borderRadius: 6, padding: '2px 6px', marginInlineStart: 'auto', color:'var(--muted)' }}>Ctrl K</kbd>
              </button>
            </div>

            {/* Theme toggle */}
            <button className="theme-toggle" aria-label={theme === 'dark' ? 'تفعيل الوضع النهاري' : 'تفعيل الوضع الليلي'} onClick={toggleTheme} title={theme === 'dark' ? 'الوضع النهاري' : 'الوضع الليلي'} style={{
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

            <PageSlot active={pathname==='/next-actions'} scroll>
              <NextActions isActive={pathname==='/next-actions'}/>
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
            <PageSlot active={pathname==='/support'} scroll>
              <SupportBoard isActive={pathname==='/support'}/>
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
            <PageSlot active={pathname==='/platform-carriers'} scroll>
              <PlatformCarriers isActive={pathname==='/platform-carriers'}/>
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

            {/* مسار ممنوع → رسالة صريحة «ما عندك صلاحية» (طلب المستخدم — لا تحويل صامت).
                المحاولة مسجَّلة في سجل التحركات (logDenied أعلاه) بالـIP. */}
            {!pathAllowed && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 380, gap: 10, fontFamily: 'var(--font-sans)', textAlign: 'center', padding: 24 }}>
                <div style={{ fontSize: 44 }}>⛔</div>
                <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)' }}>ما عندك صلاحية على هذه الصفحة</div>
                <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                  الصفحة <span style={{ fontFamily: 'var(--font-mono)', direction: 'ltr', display: 'inline-block' }}>{rawPath}</span> تتطلب صلاحية لا يملكها حسابك — اطلبها من المدير.
                  <br/>هذه المحاولة سُجّلت في سجل التحركات.
                </div>
                {visibleNav.length > 0 && (
                  <button onClick={() => navigate(visibleNav[0].path)} style={{
                    marginTop: 8, padding: '9px 22px', borderRadius: 10, border: 'none', cursor: 'pointer',
                    background: 'var(--brand, var(--accent))', color: 'var(--brand-ink, #fff)',
                    fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 700,
                  }}>
                    العودة لصفحتك الرئيسية
                  </button>
                )}
              </div>
            )}

            {/* Unknown paths → redirect (المسارات الممنوعة تُعرض رسالة أعلاه لا تحويل) */}
            {pathAllowed && !isKnownPath && !isSettingsPath && (
              visibleNav.length ? (
                <Routes>
                  {/* هبوط ذكي: مَن لا يملك overview.view يهبط على أول صفحة مرئية له
                      (اكتُشف مع موظف مبيعات هبط على غرفة العمليات 2026-07-16) */}
                  <Route path="*" element={<Navigate to={(can('overview.view') ? '/overview' : visibleNav[0]?.path) || '/overview'} replace/>}/>
                </Routes>
              ) : (
                // موظف بلا أي صلاحية — رسالة بدل حلقة تحويل لا نهائية
                <div style={{ padding: 60, textAlign: 'center', color: 'var(--muted)', fontFamily: 'var(--font-sans)', fontSize: 13 }}>
                  🔒 لا صلاحيات ممنوحة لحسابك بعد — اطلب من المدير منحك صلاحيات من شاشة الفريق.
                </div>
              )
            )}

          </div>
        </main>
      </div>

      {/* ── شريط التنقّل السفلي (جوال فقط ≤768px، مخفي بالـCSS على الحاسب) ──
          يختصر التنقّل اليومي من نقرتين عبر الدرج إلى نقرة واحدة. طبقة جوال
          منفصلة عن الدرج — لا تخالف قاعدة «لا تثبيت عناصر جديدة» (§1.11f). */}
      <nav className="bottom-nav">
        {[
          // design-v2 + الأنظمة السبعة: التحصيل والمبيعات (الاستخدام اليومي بالجوال)
          // بدل رفع/وارد المكتبيّين. active يشمل مسارات الهَب القديمة.
          { path: '/overview',       label: 'الرئيسية', icon: LayoutDashboard, permKey: 'overview.view' },
          { path: '/decisions',      label: 'القرارات', icon: Gauge,           permKey: 'overview.view' },
          { path: '/customer-money', label: 'التحصيل',  icon: HandCoins,       permKey: 'receivables.view', group: COLLECTIONS_HUB_PATHS },
          { path: '/retargeting',    label: 'المبيعات', icon: Target,          permKey: 'sales.view',       group: SALES_HUB_PATHS },
        ].filter(it => isAdmin || can(it.permKey)).map(it => {
          const Icon = it.icon;
          const active = it.group ? it.group.includes(location.pathname) : location.pathname === it.path;
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
// حاجز أخطاء لكل صفحة: كل ~55 صفحة في شجرة React واحدة (PageSlot يبدّل
// visibility فقط) — انهيار render في أي صفحة (حتى مخفية) كان يُسقط التطبيق كله.
// هذا الحاجز يعزل العطل في صفحته ويعرض بطاقة استعادة بدل الشاشة البيضاء.
class SlotBoundary extends Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (this.state.err) {
      return (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>تعطّلت هذه الصفحة</div>
          <div style={{ fontSize: 12, marginBottom: 16 }}>{String(this.state.err?.message || this.state.err).slice(0, 160)}</div>
          <button onClick={() => window.location.reload()}
            style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }}>
            تحديث الصفحة
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function PageSlot({ active, scroll = false, children }) {
  return (
    <div className="page-slot" style={{
      position: 'absolute', inset: 0,
      overflow: scroll ? 'auto' : 'hidden',
      visibility: active ? 'visible' : 'hidden',
      pointerEvents: active ? 'auto' : 'none',
      display: 'flex', flexDirection: 'column', alignItems: 'stretch',
    }}>
      <SlotBoundary>{children}</SlotBoundary>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function NavBtn({ n, active, accent, collapsed, onClick, nested, expandable, expanded, onToggleExpand }) {
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
      {expandable && !collapsed ? (
        // chevron توسيع/طيّ التبويبات الفرعية — لا يُنقّل (يوقف الانتشار)
        <span
          role="button"
          title={expanded ? 'طيّ' : 'توسيع'}
          onClick={(e) => { e.stopPropagation(); onToggleExpand?.(); }}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 20, height: 20, borderRadius: 6, flexShrink: 0,
            color: active && accent ? accent : 'var(--muted)', cursor: 'pointer',
          }}
        >
          <ChevronDown size={14} style={{ transition: 'transform .15s', transform: expanded ? 'rotate(180deg)' : 'none' }}/>
        </span>
      ) : active && (
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
        width: 'calc(100% - 8px)',
        minHeight: 31,
        margin: '1px 4px 1px 2px',
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

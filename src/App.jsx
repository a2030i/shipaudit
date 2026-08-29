import { useState, useEffect, useCallback, useRef, lazy, Suspense, Component } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Truck, Upload, Download, History, Settings,
  Menu, Users, Sun, Moon, Wallet, FileText, BookOpen, Banknote, CreditCard, BarChart3, Activity, Scale, Webhook, ClipboardList, Building2, Inbox, ShoppingBag, Briefcase, FileCheck, DollarSign, UserCog, ListTodo, Layers, Lock, TrendingUp, GitCompare, Phone, CalendarRange, Search, Gauge, Headset, Boxes, HandCoins, Target, MessageCircle, UserPlus, Bot, Landmark, ListFilter,
} from 'lucide-react';
import { ToastContainer, Spinner } from './components/UI.jsx';
import CenterWorkspace from './components/CenterWorkspace.jsx';
import QuickActionLauncher from './components/QuickActionLauncher.jsx';
import NavigationHub, { firstSectionDestination } from './components/NavigationHub.jsx';
import ExecutiveSidebar from './components/ExecutiveSidebar.jsx';
import { MobileExperienceManager } from './components/MobileUX.jsx';
import { AuthProvider, useAuth } from './lib/auth.jsx';
import { logLogin, logPageView, logDenied } from './lib/activityLogger.js';
import { PAGE_TITLES } from './lib/pageTitles.js';
import {
  NAV_SECTIONS as NAV_SECTION_MODEL,
  CENTER_WORKSPACES,
  applyNavigationIA,
} from './lib/navigation.js';
import { loadCarriers, loadAuditByIdFromDB } from './lib/coreService.js';
const CarrierProfile = lazy(() => import('./pages/CarrierProfile.jsx'));
const InternalExports = lazy(() => import('./pages/InternalExports.jsx'));
const CarrierManager = lazy(() => import('./pages/CarrierManager.jsx'));
const UploadWizard = lazy(() => import('./pages/UploadWizard.jsx'));
const AuditResults = lazy(() => import('./pages/AuditResults.jsx'));
// ملف واحد يُصدِّر صفحتين → lazy لكل تصدير على حدة (وإلا شدّ معه
// `engine/export.js` ومكتبة الإكسل كاملةً إلى حزمة الدخول — §الأداء).
const SettingsPage   = lazy(() => import('./pages/Settings.jsx').then(m => ({ default: m.SettingsPage })));
const AuditsHistory  = lazy(() => import('./pages/Settings.jsx').then(m => ({ default: m.AuditsHistory })));
import LoginPage from './pages/LoginPage.jsx';
const EmployeeManager = lazy(() => import('./pages/EmployeeManager.jsx'));
const CarrierStatements = lazy(() => import('./pages/CarrierStatements.jsx'));
const CarrierLedger = lazy(() => import('./pages/CarrierLedger.jsx'));
const PlatformCarriers = lazy(() => import('./pages/PlatformCarriers.jsx'));
const ActivityLog = lazy(() => import('./pages/ActivityLog.jsx'));
const WeightBilling = lazy(() => import('./pages/WeightBilling.jsx'));
const WebhookEvents = lazy(() => import('./pages/WebhookEvents.jsx'));
const ContractsOverview = lazy(() => import('./pages/ContractsOverview.jsx'));
const Tasks = lazy(() => import('./pages/Tasks.jsx'));
const CustomerWatch = lazy(() => import('./pages/CustomerWatch.jsx'));
const CarriersWorkspace = lazy(() => import('./pages/CarriersWorkspace.jsx'));
const FulfillmentAudit = lazy(() => import('./pages/FulfillmentAudit.jsx'));
const MoneyHub = lazy(() => import('./pages/MoneyHub.jsx'));
const Periods = lazy(() => import('./pages/Periods.jsx'));
const Forecast = lazy(() => import('./pages/Forecast.jsx'));
const MonthlyReport = lazy(() => import('./pages/MonthlyReport.jsx'));
const ReportsCenter = lazy(() => import('./pages/ReportsCenter.jsx'));
const ZohoCallback = lazy(() => import('./pages/ZohoCallback.jsx'));
const FinancialPosition = lazy(() => import('./pages/FinancialPosition.jsx'));
const FinanceExecutive = lazy(() => import('./pages/FinanceExecutive.jsx'));
const ZohoData = lazy(() => import('./pages/ZohoData.jsx'));
const CollectionsHub = lazy(() => import('./pages/CollectionsHub.jsx'));
const SalesHub = lazy(() => import('./pages/SalesHub.jsx'));
const WhatsAppSettings = lazy(() => import('./pages/WhatsAppSettings.jsx'));
const SmartCampaignCenter = lazy(() => import('./pages/SmartCampaignCenter.jsx'));
const SmartDrop = lazy(() => import('./pages/SmartDrop.jsx'));
const CashAging = lazy(() => import('./pages/CashAging.jsx'));
const IntegrityCheck = lazy(() => import('./pages/IntegrityCheck.jsx'));
// Claims now renders inside CarriersWorkspace (claims tab), not a top-level route.
const DecisionsBoard = lazy(() => import('./pages/DecisionsBoard.jsx'));
import CommandPalette    from './components/CommandPalette.jsx';
const Overview = lazy(() => import('./pages/Overview.jsx'));
const Reconciliation = lazy(() => import('./pages/Reconciliation.jsx'));
const UploadsHub = lazy(() => import('./pages/UploadsHub.jsx'));
const WorkAgents = lazy(() => import('./pages/WorkAgents.jsx'));
const OperationsCenter = lazy(() => import('./pages/OperationsCenter.jsx'));
const AccountingCycle = lazy(() => import('./pages/AccountingCycle.jsx'));
const PublicShortAddress = lazy(() => import('./pages/PublicShortAddress.jsx'));
const PublicInternationalRates = lazy(() => import('./pages/PublicInternationalRates.jsx'));
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
const ROUTE_ITEMS = [
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
  { id: 'accounting-cycle', path: '/accounting-cycle', label: 'دورة تشغيل المحاسب', icon: ClipboardList, section: 'money', navOrder: 5,
    permAny: ['audits.view', 'audits.create', 'internal_exports.view', 'uploads.view', 'cod.view'] },
  // ── نظام شركات الشحن — مرتّب بتدفّق العمل اليومي: استقبال → تدقيق → حسابات ──
  // مراجعة المسميات (2026-07-15، طلب المستخدم): لغة إنسان عادي — لا «مطابقات/دفتر/تدفّق».
  { id: 'hub',          path: '/hub',               label: 'نظرة الناقلين',   icon: Building2,  section: 'carriers', navOrder: 10, permKey: 'carriers.view',
    subTabs: [
      { tabId: 'hub',    label: 'حالة الشركات',         icon: Building2 },
      { tabId: 'kpi',    label: 'مقارنة الأداء',        icon: BarChart3, legacy: '/carrier-kpi' },
      { tabId: 'claims', label: 'المطالبات والاسترداد', icon: Scale,     legacy: '/claims' },
    ] },
  { id: 'drop',         path: '/drop',              label: 'رفع ملف',          icon: Upload,    section: 'carriers', navOrder: 20, permKey: 'audits.create' },
  { id: 'webhook',      path: '/webhook',           label: 'وارد التكاملات',   icon: Inbox,     section: 'carriers', navOrder: 30, permKey: 'webhook.view' },
  { id: 'audits',       path: '/audits',            label: 'تدقيق الفواتير',   icon: History,   section: 'carriers', navOrder: 40, permKey: 'audits.view' },
  { id: 'aramex-stmt',  path: '/aramex-statements', label: 'كشوف الناقلين',    icon: FileText,  section: 'carriers', navOrder: 50, permKey: 'carriers.view' },
  { id: 'ledger',       path: '/ledger',            label: 'دفتر حساب الناقلين', icon: BookOpen, section: 'carriers', navOrder: 60, permKey: 'ledger.view' },
  { id: 'platform-carriers', path: '/platform-carriers', label: 'مقارنة أسعار المنصّات', icon: DollarSign, section: 'carriers', navOrder: 70, permKey: 'carriers.view' },
  { id: 'fulfillment',  path: '/fulfillment',       label: 'فواتير التجهيز',   icon: Briefcase, section: 'money', navOrder: 80, permKey: 'audits.view' },

  // ── التقارير والرقابة ───────────────────────────────────────────
  { id: 'reports',          path: '/reports',          label: 'مكتبة التقارير',         icon: FileText,      section: 'outreach', navOrder: 10, permAny: ['reports.view_operational', 'reports.view_financial', 'reports.view_bank_reconciliation'],
    subTabs: [
      { tabId: 'reports',   label: 'مكتبة التقارير',       icon: FileText, anyPerm: ['reports.view_operational', 'reports.view_financial', 'reports.view_bank_reconciliation'] },
      { tabId: 'monthly',   label: 'التقرير الشهري',       icon: CalendarRange, legacy: '/monthly-report', perm: 'reports.view_operational' },
      { tabId: 'exports',   label: 'الملفات المصدّرة',      icon: Download, legacy: '/internal-exports', perm: 'internal_exports.view' },
    ] },
  { id: 'monthly-report',   path: '/monthly-report',   label: 'التقرير الشهري',         icon: CalendarRange, section: 'outreach', navOrder: 20, permKey: 'reports.view_operational' },
  { id: 'weight-billing',   path: '/weight-billing',   label: 'فوترة الأوزان الزائدة', icon: Scale,         section: 'money',    navOrder: 90, permKey: 'internal_exports.view' },
  { id: 'internal-exports', path: '/internal-exports', label: 'سجل التقارير المصدّرة',  icon: FileText,      section: 'outreach', navOrder: 30, permKey: 'internal_exports.view' },

  // ── نظام الأموال — هل نربح؟ → البنك → زوهو → المطابقة → الديون → المستقبل ──
  { id: 'pnl',       path: '/pnl',      label: 'الربح الفعلي',  icon: TrendingUp, section: 'money', navOrder: 30, permKey: 'money.pnl' },
  { id: 'money',     path: '/money',    label: 'النقد والتسويات',  icon: Banknote,   section: 'money', navOrder: 10, permAny: ['bank.view', 'cod.view', 'payments.view'],
    subTabs: [
      { tabId: 'bank',     label: 'البنوك',              icon: Wallet,     legacy: '/bank', perm: 'bank.view' },
      { tabId: 'cod',      label: 'تحصيل شركات الشحن', icon: Banknote,   legacy: '/cod-settlements', perm: 'cod.view' },
      { tabId: 'payments', label: 'دفعات الناقلين',     icon: CreditCard, legacy: '/payments', perm: 'payments.view' },
      { tabId: 'unclassified', label: 'العمليات غير المصنفة', icon: ListFilter, perm: 'bank.view' },
    ] },
  { id: 'bank',      path: '/bank',     label: 'الحسابات البنكية', icon: Wallet, section: 'money', navOrder: 20, permKey: 'bank.view' },
  { id: 'cash-aging', path: '/cash-aging', label: 'أعمار التحصيل والسداد', icon: Wallet, section: 'money', navOrder: 40, permKey: 'ledger.view' },
  { id: 'forecast',   path: '/forecast',   label: 'توقّع السيولة', icon: TrendingUp, section: 'money', navOrder: 50, permKey: 'forecast.view' },

  // ── العملاء والنمو ─────────────────────────────────────────────
  // Customers + receivables + segments + merchants merged into
  // /customer-360 — kept the legacy routes alive in App so any
  // existing deep links still land on the right tab.
  { id: 'customer-watch',  path: '/customer-360',    label: 'ملف العميل 360', icon: Users,     section: 'customers', navOrder: 10, permKey: 'receivables.view' },
  // «تحصيل العملاء» — شاشة التحصيل الأولى (زوهو API المرجع)، أول عنصر بالقسم
  // مركز التحصيل: الرصيد الحي + قائمة العمل + أداة المطابقة الداخلية.
  { id: 'collections-hub', path: '/customer-money',  label: 'الديون والتحصيل',  icon: HandCoins, section: 'money', navOrder: 20, permKey: 'receivables.view',
    subTabs: [
      { tabId: 'money',    label: 'أرصدة العملاء',   icon: HandCoins },
      { tabId: 'queue',    label: 'قائمة التحصيل',    icon: Phone,  legacy: '/collections' },
      { tabId: 'internal', label: 'الكشف الداخلي',   icon: FileText, legacy: '/receivables' },
    ] },
  // §1.32 مرحلة 3: مركز المبيعات = إعادة الاستهداف + فرص هاتف + خارج المنصّة + الشرائح + المتاجر
  // مركز المبيعات: صلاحية مستقلة لكل تبويب (تفصيص 2026-07-16) — permAny = يظهر
  // العنصر لمن يملك أياً منها، وSalesHub يفلتر تبويباته بالمفتاح الدقيق.
  { id: 'sales-hub',       path: '/retargeting',     label: 'فرص المنصة',  icon: Target,    section: 'customers', navOrder: 20,
    permAny: ['sales.view', 'sales.hatif_leads', 'sales.external_leads', 'sales.segments', 'merchants.view'],
    subTabs: [
      { tabId: 'pipeline',    label: 'مسار عملاء المنصة',   icon: Target, perm: 'sales.view' },
      { tabId: 'today',       label: 'خطة اليوم',           icon: Target },
      { tabId: 'activation',  label: 'تفعيل المتاجر',       icon: TrendingUp },
      { tabId: 'retargeting', label: 'إعادة الاستهداف',    icon: Target },
      { tabId: 'hatif',       label: 'مرجع طلبات هاتف',    icon: UserPlus,    legacy: '/hatif-leads' },
      { tabId: 'external',    label: 'عملاء خارج المنصّة', icon: ShoppingBag },
      { tabId: 'segments',    label: 'شرائح العملاء',        icon: Layers,      legacy: '/segments' },
      { tabId: 'merchants',   label: 'متاجر المنصّة',      icon: ShoppingBag, legacy: '/merchants' },
    ] },
  { id: 'campaign-center', path: '/campaigns', label: 'مركز الحملات الذكي', icon: MessageCircle, section: 'sales', navOrder: 40,
    permAny: ['campaigns.send', 'campaigns.ivr', 'whatsapp.view_log', 'receivables.view', 'sales.view'] },
  { id: 'zoho-data',       path: '/zoho-data',       label: 'زوهو: الفواتير والربط', icon: BookOpen,   section: 'money', navOrder: 60, permKey: 'zoho.view',
    subTabs: [
      { tabId: 'overview',  label: 'مراقبة اتصال زوهو',       icon: Activity },
      { tabId: 'customers', label: 'العملاء والفواتير',       icon: Users, children: [
        { tabId: 'invoices', label: 'فواتير العملاء', icon: FileText },
        { tabId: 'payments', label: 'دفعات العملاء', icon: CreditCard },
      ] },
      { tabId: 'vendors',   label: 'الموردون والمصروفات',     icon: Briefcase, children: [
        { tabId: 'bills', label: 'فواتير الموردين', icon: FileText },
        { tabId: 'vendor_payments', label: 'دفعات الموردين', icon: CreditCard },
        { tabId: 'purchase_orders', label: 'أوامر الشراء', icon: ClipboardList },
        { tabId: 'expenses', label: 'المصروفات', icon: Wallet },
        { tabId: 'vendor_credits', label: 'أرصدة الموردين', icon: DollarSign },
        { tabId: 'items', label: 'الأصناف', icon: Boxes },
      ] },
      { tabId: 'banks',     label: 'البنوك والمطابقة',        icon: Landmark, legacyTabIds: ['bank_accounts'], children: [
        { tabId: 'bank_accounts', label: 'الحسابات البنكية', icon: Landmark },
      ] },
      { tabId: 'accounts',  label: 'القيود ودليل الحسابات',   icon: BookOpen, children: [
        { tabId: 'journals', label: 'القيود اليومية', icon: BookOpen },
        { tabId: 'chart_accounts', label: 'دليل الحسابات', icon: ListFilter },
      ] },
    ] },
  { id: 'reconciliation',  path: '/reconciliation',  label: 'مطابقة زوهو', icon: GitCompare, section: 'money', navOrder: 70, permKey: 'reconciliation.view' },

  // ── الحملات والاتصالات — ضمن رحلة العملاء والنمو ────────────────
  { id: 'whatsapp-settings', path: '/whatsapp-settings', label: 'الحملات والاتصالات', icon: MessageCircle, section: 'customers', navOrder: 50,
    permAny: ['whatsapp.view_log', 'whatsapp.configure', 'campaigns.ivr'],
    subTabs: [
      { tabId: 'overview',  label: 'نظرة عامة',       icon: Activity },
      { tabId: 'campaigns', label: 'الحملات والرسائل', icon: MessageCircle, children: [
        { tabId: 'summary', label: 'أداء الحملات', icon: BarChart3, queryKey: 'panel' },
        { tabId: 'quality', label: 'جودة القوالب', icon: FileCheck, queryKey: 'panel' },
        { tabId: 'messages', label: 'مستكشف الرسائل', icon: MessageCircle, queryKey: 'panel' },
        { tabId: 'controls', label: 'ضوابط الإرسال', icon: Settings, queryKey: 'panel', perm: 'whatsapp.configure' },
      ] },
      { tabId: 'impact',    label: 'التحصيل المرتبط',  icon: DollarSign },
      { tabId: 'ivr',       label: 'المكالمات وIVR',   icon: Phone },
      { tabId: 'agents',    label: 'نشاط فريق هاتف',   icon: Users },
      { tabId: 'problems',  label: 'جودة التواصل',     icon: Headset },
    ] },

  // ── الإعدادات الفعلية + عناصر التشغيل المنقولة لأقسامها ─────────
  { id: 'employees',    path: '/employees',    label: 'الفريق والصلاحيات',  icon: UserCog,       section: 'tools', navOrder: 10, adminOnly: true },
  { id: 'carriers',     path: '/carriers',     label: 'إدارة شركات الشحن',  icon: Truck,         section: 'tools', navOrder: 20, permKey: 'carriers.view' },
  { id: 'contracts',    path: '/contracts',    label: 'العقود والأسعار',    icon: ClipboardList, section: 'tools', navOrder: 30, permKey: 'carriers.edit_contract' },
  { id: 'hatif-settings', path: '/settings/hatif', label: 'إعدادات هاتف', icon: MessageCircle, section: 'tools', navOrder: 35, permKey: 'whatsapp.configure' },
  { id: 'app-settings', path: '/settings/ai',  label: 'الإعدادات', icon: Settings, section: 'tools', navOrder: 40,
    permAny: ['system.view_settings', 'carriers.view', 'carriers.edit_contract'],
    subTabs: [
      { tabId: 'ai',        label: 'الذكاء الاصطناعي', icon: Bot, perm: 'system.view_settings' },
      { tabId: 'data',      label: 'البيانات والتكاملات', icon: Layers, legacy: '/settings/data', perm: 'system.view_settings' },
      { tabId: 'employees', label: 'الفريق والصلاحيات', icon: UserCog, legacy: '/employees', adminOnly: true },
      { tabId: 'carriers',  label: 'شركات الشحن', icon: Truck, legacy: '/carriers', perm: 'carriers.view' },
      { tabId: 'contracts', label: 'العقود والأسعار', icon: ClipboardList, legacy: '/contracts', perm: 'carriers.edit_contract' },
    ] },
  { id: 'periods',      path: '/periods',      label: 'إقفال الشهور',       icon: Lock,          section: 'money', navOrder: 100, permKey: 'system.period_close' },
  { id: 'tasks',        path: '/tasks',        label: 'مهام شركات الشحن',   icon: ListTodo,      section: 'carriers', navOrder: 80, permKey: 'audits.view' },
  { id: 'uploads',      path: '/uploads',      label: 'حالة مصادر البيانات', icon: Layers,       section: 'outreach', navOrder: 40, permKey: 'uploads.view' },
  { id: 'integrity',    path: '/integrity',    label: 'سلامة البيانات',     icon: FileCheck,     section: 'outreach', navOrder: 50, permKey: 'system.view_audit_log' },
  { id: 'activity-log', path: '/activity-log', label: 'سجل النظام',         icon: Activity,      section: 'outreach', navOrder: 60, permKey: 'system.view_audit_log' },
  { id: 'work-agents', path: '/work-agents', label: 'وكلاء العمل', icon: Bot, section: 'outreach', navOrder: 70, permKey: 'agents.view' },
  { id: 'operations', path: '/operations', label: 'التكاملات', icon: Activity, section: 'outreach', navOrder: 15,
    permAny: ['agents.view', 'system.view_audit_log', 'system.view_settings', 'uploads.view', 'zoho.view', 'whatsapp.view_log', 'whatsapp.configure', 'campaigns.ivr', 'webhook.view'],
    subTabs: [
      { tabId: 'overview', label: 'مراقبة التكاملات', icon: Activity },
      { tabId: 'sources', label: 'مزامنة مصادر البيانات', icon: Layers, legacy: '/uploads', perm: 'uploads.view' },
      { tabId: 'integrity', label: 'سلامة البيانات', icon: FileCheck, legacy: '/integrity', perm: 'system.view_audit_log' },
      { tabId: 'activity', label: 'سجل النظام', icon: Activity, legacy: '/activity-log', perm: 'system.view_audit_log' },
      { tabId: 'agents', label: 'وكلاء العمل', icon: Bot, legacy: '/work-agents', perm: 'agents.view' },
      { tabId: 'webhook', label: 'وارد التكاملات', icon: Inbox, legacy: '/webhook', perm: 'webhook.view' },
    ] },
];
// Each section carries an accent color so the sidebar reads as
// five visually-distinct zones instead of one flat list. The color
// shows up on:
//   1. The section icon (always)
//   2. The active indicator on items in that section
//   3. The subtle left-edge bar on the active item
const NAV_ITEMS = applyNavigationIA(ROUTE_ITEMS);
const navigationItemForPath = path => NAV_ITEMS.find(entry => (
  entry.path === path || entry.subTabs?.some(tab => tab.legacy === path)
));
const SECTION_ICONS = { Truck, Users, Target, DollarSign, FileCheck, Settings, Landmark };
const NAV_SECTIONS = NAV_SECTION_MODEL.map(section => ({
  ...section,
  icon: SECTION_ICONS[section.icon] || Layers,
}));

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
  for (const s of it.subTabs || []) if (s.legacy) PATH_PERM.set(s.legacy, s.perm || pk);
}
// مسارات لا تظهر في القائمة
PATH_PERM.set('/carrier',   'carriers.view');
PATH_PERM.set('/upload',    'audits.create');
PATH_PERM.set('/results',   'audits.view');
PATH_PERM.set('/customers', 'receivables.view');
// مركز الحملات وجهة مستقلة داخل مركز المبيعات، كما يستقبل سياق جمهور قادمًا
// من التحصيل. تعريف ROUTE_ITEMS أعلاه هو حارس المسار ومصدر ظهوره في القائمة.

// Paths that all render the CustomerHub page (which selects the
// right tab based on which path was used). Used to scope the
// PageSlot active check.
const CUSTOMER_HUB_PATHS = ['/customer-360', '/customers'];
// مركز المبيعات (§1.32 المرحلة 3): الفرص الثلاث + الشرائح + دليل المتاجر
const SALES_HUB_PATHS = ['/retargeting', '/hatif-leads', '/segments', '/merchants'];
// مركز التحصيل (§1.32 المرحلة 2): 4 شاشات كانت متفرّقة — المسارات القديمة تهبط على تبويبها
const COLLECTIONS_HUB_PATHS = ['/customer-money', '/collections', '/receivables'];
// /hub, /carrier-kpi, /claims all render the CarriersWorkspace (3 tabs).
const CARRIER_WORKSPACE_PATHS = ['/hub', '/carrier-kpi', '/claims'];
// /money hosts cod-settlements / payments / bank
// as four tabs. Legacy paths land on the right tab automatically.
const MONEY_HUB_PATHS = ['/money', '/cod-settlements', '/payments', '/bank'];
const ACCOUNTING_WORKSPACE_PATHS = ['/zoho-data', '/reconciliation'];
const FINANCE_PLANNING_PATHS = ['/pnl', '/cash-aging', '/forecast', '/periods'];
const OPERATIONS_CARRIER_PATHS = ['/hub', '/carrier-kpi', '/claims', '/platform-carriers', '/tasks'];
const OPERATIONS_AUDIT_PATHS = ['/drop', '/audits', '/aramex-statements', '/ledger'];
const OPERATIONS_BILLING_PATHS = ['/fulfillment', '/weight-billing'];
const REPORTS_ANALYSIS_PATHS = ['/reports', '/monthly-report'];
const REPORTS_ARCHIVE_PATHS = ['/internal-exports', '/activity-log'];
const ADMIN_CARRIER_PATHS = ['/carriers', '/contracts'];
const ADMIN_INTEGRATION_PATHS = ['/operations', '/uploads', '/webhook', '/work-agents'];

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

// مسارات تُرسَم مستقلّةً خارج غلاف التطبيق (بلا جانبية/شريط/تحقّق دخول).
// التطبيع يمنع الشرطة النهائية من إسقاط الرابط العام داخل حارس النظام.
const normalizePublicPath = (pathname = '/') => pathname.replace(/\/+$/, '') || '/';
const LAST_CENTER_ROUTE_PREFIX = 'shipaudit:last-center-route:v1:';
const PUBLIC_ROUTES = new Map([
  ['/short-address', PublicShortAddress],
  ['/national-address', PublicShortAddress],
  ['/international-rates', PublicInternationalRates],
]);

function AppShell(props) {
  const location = useLocation();
  const PublicPage = PUBLIC_ROUTES.get(normalizePublicPath(location.pathname));
  if (PublicPage) {
    return (
      <Suspense fallback={<div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><Spinner size={28}/></div>}>
        <PublicPage/>
      </Suspense>
    );
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
  // المسارات الإدارية المتخصصة (مثل إعدادات هاتف) تحمل صلاحيتها الدقيقة.
  // لا نطغى عليها بصلاحية إعدادات النظام العامة لمجرد أنها تبدأ بـ/settings.
  const pathPermKey = PATH_PERM.get(rawPath)
    ?? (rawPath.startsWith('/settings') ? 'system.view_settings' : undefined);
  const pathAllowed = rawPath === '/employees'
    ? isAdmin
    : (isAdmin || !pathPermKey
      || (Array.isArray(pathPermKey) ? pathPermKey.some(k => can(k)) : can(pathPermKey)));
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
  useEffect(() => {
    if (!pathAllowed) return;
    const item = navigationItemForPath(rawPath);
    if (!item || NAV_SECTIONS.some(section => section.path === rawPath)) return;
    try { localStorage.setItem(`${LAST_CENTER_ROUTE_PREFIX}${item.section}`, `${rawPath}${location.search}`); } catch { /* best effort */ }
  }, [location.search, pathAllowed, rawPath]);
  const CENTER_ROUTES = NAV_SECTIONS.map(section => section.path);
  const KNOWN_PATHS = ['/hub','/carrier','/carriers','/contracts','/upload','/results','/audits','/bank','/aramex-statements','/ledger','/cod-settlements','/payments','/receivables','/merchants','/customers','/customer-360','/weight-billing','/internal-exports','/carrier-kpi','/activity-log','/webhook','/employees','/tasks','/segments','/periods','/forecast','/overview','/reconciliation','/uploads','/money','/collections','/monthly-report','/drop','/cash-aging','/integrity','/claims','/decisions','/crm','/sales','/fulfillment','/reports','/zoho-callback','/pnl','/zoho-data','/customer-money','/legal','/retargeting','/campaigns','/whatsapp-settings','/hatif-leads','/marketers','/platform-carriers','/next-actions','/work-agents','/operations','/accounting-cycle','/workspace/customers','/workspace/operations','/workspace/reports', ...CENTER_ROUTES];
  const isKnownPath = KNOWN_PATHS.includes(pathname) || isSettingsPath;
  const campaignActionActive = pathname === '/campaigns';

  const [carriers,        setCarriers]        = useState([]);
  const [carriersLoading, setCarriersLoading] = useState(false);
  const [mobileOpen,      setMobileOpen]      = useState(false);
  const [navSectionId,    setNavSectionId]    = useState(null);
  const [quickActionOpen, setQuickActionOpen] = useState(false);
  const [pendingAudit,    setPendingAudit]    = useState(null);
  // الجانبية الأساسية للمراكز فقط. اختيار المركز يفتح صفحة مركزية تجمع
  // وجهات العمل كبطاقات؛ لا توجد جانبية سياقية ثانية على أي مقاس شاشة.
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
  // ── Default redirect after login: always go to /overview ──
  // /overview was promoted to be the home page; /dashboard is kept
  // as a still-reachable legacy alias but no longer the landing.
  useEffect(() => {
    if (!profile) return;
    if (location.pathname === '/' || location.pathname === '') {
      navigate('/overview', { replace: true });
    }
  }, [profile, location.pathname]);

  // Carrier 360 is the canonical user-facing home for carrier-scoped work.
  // Legacy pages remain valid for global/cross-carrier queues; once a carrier
  // is present they resolve to the matching section inside the carrier file.
  useEffect(() => {
    if (!profile || !pathAllowed) return;
    const params = new URLSearchParams(location.search);
    // صفحات تقاعدت من تجربة المستخدم. نحافظ على الروابط القديمة بتحويلها
    // إلى الوظيفة الحالية بدل عرض صفحة فارغة أو كسر Deep Link محفوظ.
    if (rawPath === '/sales' || rawPath === '/crm') {
      navigate('/retargeting?view=today&source=legacy-sales', { replace: true });
      return;
    }
    if (rawPath === '/marketers') {
      navigate('/workspace/sales?source=legacy-marketers', { replace: true });
      return;
    }
    if (rawPath === '/legal') {
      navigate('/customer-money?view=money&source=retired-legal', { replace: true });
      return;
    }
    if (rawPath === '/customer-money' && ['performance', 'legal'].includes(params.get('view') || params.get('tab'))) {
      navigate('/customer-money?view=money&source=retired-collection-view', { replace: true });
      return;
    }
    if (rawPath === '/upload' && !params.get('carrier')) {
      navigate('/hub?action=upload-invoice', { replace: true });
      return;
    }
    if (rawPath === '/merchants') {
      const next = new URLSearchParams(params);
      next.set('source', next.get('source') || 'merchants');
      navigate(`/customer-360?${next.toString()}`, { replace: true });
      return;
    }
    const scopedCarrier = params.get('carrier') || (rawPath === '/contracts' ? params.get('edit') : null);
    if (!scopedCarrier) return;
    const destinations = {
      '/upload': ['invoices', { mode: 'upload' }],
      '/audits': ['invoices', {}],
      '/claims': ['claims', {}],
      '/ledger': ['account', { panel: 'ledger' }],
      '/cod-settlements': ['account', { panel: 'cod' }],
      '/aramex-statements': ['account', { panel: 'statements' }],
      '/payments': ['account', { panel: 'ledger' }],
      '/carrier-kpi': ['performance', {}],
      '/contracts': ['contract', {}],
    };
    const destination = destinations[rawPath];
    if (!destination) return;
    const [view, extra] = destination;
    const next = new URLSearchParams({ id: scopedCarrier, view, ...extra });
    const auditId = params.get('audit');
    if (auditId) next.set('invoice', auditId);
    navigate(`/carrier?${next.toString()}`, { replace: true });
  }, [profile, pathAllowed, rawPath, location.search, navigate]);

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
    const center = NAV_SECTIONS.find(section => section.path === path);
    let destination = path;
    if (center && center.id !== 'finance') {
      try {
        const saved = localStorage.getItem(`${LAST_CENTER_ROUTE_PREFIX}${center.id}`);
        if (saved?.startsWith('/')) {
          const savedUrl = new URL(saved, window.location.origin);
          const item = navigationItemForPath(savedUrl.pathname);
          const belongsToCenter = item?.section === center.id && !item.navHidden;
          const allowed = belongsToCenter && (isAdmin
            || (!item.adminOnly && (item.permAny ? item.permAny.some(key => can(key)) : !item.permKey || can(item.permKey))));
          if (allowed) destination = `${savedUrl.pathname}${savedUrl.search}`;
        }
      } catch { /* fall back to the center destination */ }
    }
    navigate(destination);
    setMobileOpen(false);
  };

  const openNavigation = (sectionId = null) => {
    setNavSectionId(sectionId);
    setMobileOpen(true);
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
    navigate(`/carrier?id=${encodeURIComponent(audit.carrierId)}&view=invoices&mode=result&invoice=${encodeURIComponent(audit.id)}`);
  };
  const handleOpenAudit = (audit) => {
    rememberAudit(audit);
    navigate(`/carrier?id=${encodeURIComponent(audit.carrierId)}&view=invoices&mode=result&invoice=${encodeURIComponent(audit.id)}`);
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
      const params = new URLSearchParams(location.search);
      const cur = params.get('view') || params.get('tab');
      const effective = cur || item.subTabs[0].tabId;
      return item.subTabs.find(s => s.tabId === effective || s.legacyTabIds?.includes(effective)) || null;
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
  const permissionNav = isAdmin
    ? NAV_ITEMS
    : NAV_ITEMS.filter(n => {
        if (n.adminOnly) return false;
        if (n.permAny)   return n.permAny.some(k => can(k));
        if (!n.permKey)  return true;
        return can(n.permKey);
      });
  const visibleNav = permissionNav.filter(n => !n.navHidden);

  // Prefer a dedicated route over a legacy sub-tab match. For example, /bank
  // is a first-class finance destination even though the historical money
  // workspace still keeps /bank as a compatible legacy path.
  // Hidden compatibility/detail routes still belong to a workspace. Resolve the
  // active item from the permission-filtered set so a customer/carrier detail
  // keeps the correct finance context without becoming another menu entry.
  const currentNavItem = permissionNav.find(item => location.pathname === item.path)
    || permissionNav.find(item => activeFor(item));
  const currentSubTab = currentNavItem ? subTabOf(currentNavItem) : null;
  const currentSection = NAV_SECTIONS.find(section => section.id === currentNavItem?.section);
  const centerRouteSection = NAV_SECTIONS.find(section => section.path === pathname);
  const contextParams = new URLSearchParams(location.search);
  const reportScoped = (
    rawPath === '/carrier-kpi'
    || rawPath === '/platform-carriers'
    || (rawPath === '/crm' && contextParams.get('source') === 'reports')
    || (rawPath === '/customer-money' && contextParams.get('source') === 'reports')
    || (rawPath === '/whatsapp-settings' && contextParams.get('source') === 'reports')
  );
  const adminScoped = (
    (rawPath === '/crm' && (contextParams.get('view') || contextParams.get('tab')) === 'settings')
    || (rawPath === '/zoho-data' && !['customers', 'vendors', 'banks', 'accounts'].includes(contextParams.get('tab')))
    || (rawPath === '/whatsapp-settings' && (contextParams.get('tab') === 'settings'))
  );
  const forcedSectionId = reportScoped ? 'reports' : adminScoped ? 'settings' : null;
  const detailSectionId = rawPath === '/carrier' ? 'shipping' : null;
  const contextSection = (forcedSectionId ? NAV_SECTIONS.find(section => section.id === forcedSectionId) : null)
    || (detailSectionId ? NAV_SECTIONS.find(section => section.id === detailSectionId) : null)
    || centerRouteSection
    || currentSection;
  const currentTitle = pathname === '/overview'
    ? 'مركز القيادة'
    : centerRouteSection?.label ?? currentSubTab?.label
      ?? currentNavItem?.label
      ?? PAGE_TITLES[location.pathname]
      ?? (location.pathname.startsWith('/settings') ? 'الإعدادات' : 'لمحة');
  const quickActionLabel = ({
    finance: 'إجراء مالي جديد',
    sales: 'إضافة فرصة أو تواصل',
    customers: 'بحث أو فتح عميل',
    shipping: 'رفع ملف أو تشغيل دورة',
    reports: 'إنشاء أو تصدير تقرير',
    settings: 'إجراء إداري',
  })[contextSection?.id] || 'إجراء جديد';

  return (
    <>
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

      <QuickActionLauncher
        open={quickActionOpen}
        onClose={() => setQuickActionOpen(false)}
        onNavigate={goto}
      />

      <NavigationHub
        open={mobileOpen}
        initialSectionId={navSectionId}
        sections={NAV_SECTIONS}
        workspaces={CENTER_WORKSPACES}
        navItems={visibleNav}
        canOpenHome={isAdmin || can('overview.view')}
        canOpenSubTab={tab => isAdmin || (!tab.adminOnly && (!tab.perm || can(tab.perm)) && (!tab.anyPerm || tab.anyPerm.some(key => can(key))))}
        currentSectionId={contextSection?.id || null}
        currentPath={location.pathname}
        currentSearch={location.search}
        profile={profile}
        roleLabel={ROLE_LABEL[profile.role] ?? profile.role}
        onClose={() => setMobileOpen(false)}
        onNavigate={goto}
        onQuickAction={() => setQuickActionOpen(true)}
        onSignOut={signOut}
      />

      <div className="app-layout">

        <ExecutiveSidebar
          sections={NAV_SECTIONS}
          navItems={visibleNav}
          currentSectionId={contextSection?.id || null}
          pathname={location.pathname}
          profile={profile}
          roleLabel={ROLE_LABEL[profile.role] ?? profile.role}
          canOpenHome={isAdmin || can('overview.view')}
          onNavigate={goto}
          onMore={() => openNavigation()}
          onSignOut={signOut}
        />

        {/* ═══════════════ MAIN ═══════════════ */}
        <main className="app-main">

          {/* Topbar */}
          <div className="topbar">
            <button className="hamburger-btn" aria-label="فتح قائمة أقسام المركز" onClick={() => openNavigation(contextSection?.id || null)}>
              <Menu size={20}/>
            </button>

            <div className="topbar-route">
              {currentSection && (
                <div className="topbar-breadcrumb" aria-label="مسار الصفحة">
                  <span>{currentSection.label}</span>
                </div>
              )}
              <strong className="topbar-title">{currentTitle}</strong>
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
                <span className="topbar-search-hint" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>عميل، متجر، فاتورة، شحنة أو صفحة…</span>
                <kbd className="topbar-search-kbd" style={{ fontSize: 10, border: '1px solid var(--border2)', borderRadius: 6, padding: '2px 6px', marginInlineStart: 'auto', color:'var(--muted)' }}>Ctrl K</kbd>
              </button>
            </div>

            <button type="button" className="topbar-quick-action" aria-label={quickActionLabel || 'إجراء جديد'} title={quickActionLabel || 'إجراء جديد'} onClick={() => setQuickActionOpen(true)}>
              <Upload size={16}/><span>{quickActionLabel}</span>
            </button>

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

            {NAV_SECTIONS.map(section => {
              return (
                <PageSlot key={section.id} active={pathname === section.path} scroll>
                  <Navigate to={firstSectionDestination(section.id, CENTER_WORKSPACES, visibleNav)} replace/>
                </PageSlot>
              );
            })}

            <PageSlot active={pathname==='/decisions'} scroll>
              <DecisionsBoard isActive={pathname==='/decisions'}/>
            </PageSlot>
            <PageSlot active={pathname==='/accounting-cycle'} scroll>
              <AccountingCycle carriers={carriers} isActive={pathname==='/accounting-cycle'}/>
            </PageSlot>

            {/* المسار القديم كان يكرر التحصيل والمبيعات في قائمة واحدة غامضة.
                نحتفظ بالرابط فقط، ونرسله إلى قائمة المبيعات اليومية القانونية. */}
            {pathname === '/next-actions' && (
              <Navigate to="/retargeting?tab=today" replace/>
            )}
            <PageSlot active={OPERATIONS_CARRIER_PATHS.includes(pathname)} scroll>
              <CenterWorkspace
                scope="operations-carriers"
                title="الناقلون والمتابعة"
                subtitle="حالة الناقلين والأداء والمطالبات والأسعار والمهام"
                tone="#2B68DE"
                activePath={pathname}
                onNavigate={goto}
                tabs={[
                  { id: 'carriers', path: '/hub', label: 'حالة الناقلين', icon: Building2,
                    eyebrow: 'صورة تشغيلية', purpose: 'ابدأ من حالة كل ناقل وما يحتاج متابعة',
                    description: 'الأرصدة والفواتير والتحصيل وآخر المراجعات تبقى من مصادرها الحالية.',
                    outcome: 'ناقل واضح وخطوة تالية', tone: 'var(--brand)',
                    render: () => <CarriersWorkspace carriers={carriers} isActive={CARRIER_WORKSPACE_PATHS.includes(pathname)}/> },
                  { id: 'performance', path: '/carrier-kpi', label: 'مقارنة الأداء', icon: BarChart3,
                    eyebrow: 'قرار تشغيلي', purpose: 'قارن الالتزام والجودة والتكلفة بين الناقلين',
                    description: 'يفتح عرض الأداء التاريخي نفسه دون تغيير تعريف أي مؤشر.',
                    outcome: 'مقارنة قابلة للقرار', tone: 'var(--accent3)',
                    render: () => <CarriersWorkspace carriers={carriers} isActive={CARRIER_WORKSPACE_PATHS.includes(pathname)}/> },
                  { id: 'claims', path: '/claims', label: 'المطالبات', icon: Scale,
                    eyebrow: 'استرداد الفروقات', purpose: 'تابع المطالبة من الاكتشاف حتى الاسترداد',
                    description: 'الفروقات والمبالغ المستردة تبقى منفصلة وقابلة للتتبع.',
                    outcome: 'مطالبة موثقة', tone: 'var(--gold)',
                    render: () => <CarriersWorkspace carriers={carriers} isActive={CARRIER_WORKSPACE_PATHS.includes(pathname)}/> },
                  { id: 'platforms', path: '/platform-carriers', label: 'أسعار المنصات', icon: DollarSign,
                    eyebrow: 'مرجع الأسعار', purpose: 'قارن أسعار الناقلين بين المنصات',
                    description: 'يبقى مصدر الأسعار وحساباته الحالية كما هي.',
                    outcome: 'سعر واضح للمقارنة', tone: 'var(--green)',
                    render: () => <PlatformCarriers isActive={pathname==='/platform-carriers'}/> },
                  { id: 'tasks', path: '/tasks', label: 'المهام', icon: ListTodo,
                    eyebrow: 'متابعة الاستحقاق', purpose: 'راجع مهام الناقلين ومواعيدها الصريحة',
                    description: 'لا يغيّر العرض الجدولة أو قواعد اكتمال الدورة.',
                    outcome: 'مهمة ومسؤول وموعد', tone: 'var(--red)',
                    render: () => <Tasks carriers={carriers} isActive={pathname==='/tasks'}/> },
                ]}
              />
            </PageSlot>
            <PageSlot active={pathname==='/carrier'} scroll>
              <CarrierProfile carriers={carriers} setCarriers={setCarriers} onCarriersChange={reloadCarriers}/>
            </PageSlot>
            <PageSlot active={ADMIN_CARRIER_PATHS.includes(pathname)} scroll>
              <CenterWorkspace
                scope="admin-carriers"
                title="شركات الشحن والعقود"
                subtitle="إعداد الناقل ثم مراجعة عقده وأسعاره في عرض مستقل"
                tone="#31D5E1"
                activePath={pathname}
                onNavigate={goto}
                tabs={[
                  ...(isAdmin || can('carriers.view') ? [{
                    id: 'carriers', path: '/carriers', label: 'شركات الشحن', icon: Truck,
                    eyebrow: 'إعداد تشغيلي', purpose: 'أدر تعريف الناقل وخصائص تشغيله',
                    description: 'لا يغيّر هذا الغلاف بيانات الناقل أو قواعد الملفات.',
                    outcome: 'ناقل مضبوط بوضوح', tone: 'var(--brand)',
                    render: () => <CarrierManager carriers={carriers} setCarriers={setCarriers} onCarriersChange={reloadCarriers}/>,
                  }] : []),
                  ...(isAdmin || can('carriers.edit_contract') ? [{
                    id: 'contracts', path: '/contracts', label: 'العقود والأسعار', icon: ClipboardList,
                    eyebrow: 'مرجع تعاقدي', purpose: 'راجع العقود والأسعار وفترات سريانها',
                    description: 'يبقى العقد مصدر قواعد التدقيق الحالي دون تعديل.',
                    outcome: 'عقد نافذ وقاعدة سعر واضحة', tone: 'var(--gold)',
                    render: () => <ContractsOverview isActive={pathname==='/contracts'}/>,
                  }] : []),
                ]}
              />
            </PageSlot>
            <PageSlot active={pathname==='/employees'} scroll>
              <EmployeeManager/>
            </PageSlot>
            <PageSlot active={pathname==='/upload'} scroll>
              <UploadWizard carriers={carriers} onComplete={handleAuditComplete}/>
            </PageSlot>
            <PageSlot active={pathname==='/results'}>
              <AuditResultsPage auditFromState={pendingAudit} carriers={carriers} onNewAudit={() => navigate('/upload')} isActive={pathname==='/results'}/>
            </PageSlot>
            <PageSlot active={OPERATIONS_AUDIT_PATHS.includes(pathname)} scroll>
              <CenterWorkspace
                scope="operations-audit"
                title="تدقيق وفواتير الناقلين"
                subtitle="استلام الملف ثم المراجعة والكشف ودفتر الحساب"
                tone="#2B68DE"
                activePath={pathname}
                onNavigate={goto}
                tabs={[
                  ...(isAdmin || can('audits.create') ? [{
                    id: 'drop', path: '/drop', label: 'استلام الملفات', icon: Upload,
                    eyebrow: 'بداية المسار', purpose: 'استقبل ملف الناقل وحدد مساره الصحيح',
                    description: 'الرفع يستخدم القارئ الحالي ولا يغيّر قواعد التدقيق.',
                    outcome: 'ملف معروف النوع والناقل', tone: 'var(--brand)',
                    render: () => <SmartDrop carriers={carriers}/>,
                  }] : []),
                  ...(isAdmin || can('audits.view') ? [{
                    id: 'audits', path: '/audits', label: 'المراجعات', icon: History,
                    eyebrow: 'قرار التدقيق', purpose: 'راجع الفروقات وحالة كل ملف',
                    description: 'الاعتماد والرفض والصلاحيات تبقى كما هي.',
                    outcome: 'مراجعة موثقة وقابلة للفتح', tone: 'var(--accent3)',
                    render: () => <AuditsHistory onOpen={handleOpenAudit} isActive={pathname==='/audits'}/>,
                  }] : []),
                  ...(isAdmin || can('carriers.view') ? [{
                    id: 'statements', path: '/aramex-statements', label: 'كشوف الناقلين', icon: FileText,
                    eyebrow: 'كشف ومطابقة', purpose: 'راجع كشف الناقل قبل الانتقال للحساب',
                    description: 'تبقى بيانات الكشف في عرض مستقل عن المراجعات.',
                    outcome: 'كشف واضح وحالة متابعة', tone: 'var(--gold)',
                    render: () => <CarrierStatements carriers={carriers}/>,
                  }] : []),
                  ...(isAdmin || can('ledger.view') ? [{
                    id: 'ledger', path: '/ledger', label: 'دفتر الناقل', icon: BookOpen,
                    eyebrow: 'حركة الحساب', purpose: 'راجع عمليات الناقل ودفعاته وتسوياته',
                    description: 'لا يخلط الدفتر بين المراجعة والكشف أو يغيّر القيود.',
                    outcome: 'حركة قابلة للتتبع', tone: 'var(--green)',
                    render: () => <CarrierLedger isActive={pathname==='/ledger'}/>,
                  }] : []),
                ]}
              />
            </PageSlot>
            <PageSlot active={REPORTS_ANALYSIS_PATHS.includes(pathname)} scroll>
              <CenterWorkspace
                scope="reports-analysis"
                title="التقارير والتحليل"
                subtitle="التقارير الرسمية والتحليل التشغيلي الشهري"
                tone="#22C55E"
                activePath={pathname}
                onNavigate={goto}
                tabs={[
                  ...(isAdmin || can('reports.view_operational') || can('reports.view_financial') || can('reports.view_bank_reconciliation') ? [
                    { id: 'reports', path: '/reports', label: 'مكتبة التقارير', icon: FileText,
                      eyebrow: 'إنشاء وتحليل', purpose: 'اختر التقرير ومعاملاته ثم راجع مصدره',
                      description: 'كل تقرير يحافظ على مصدره وصلاحياته وسجل التصدير الحالي.',
                      outcome: 'تقرير موثق وقابل للتنزيل', tone: 'var(--green)',
                      render: () => <ReportsCenter isActive={pathname==='/reports'}/> },
                  ] : []),
                  ...(isAdmin || can('reports.view_operational') ? [
                    { id: 'monthly', path: '/monthly-report', label: 'التقرير الشهري', icon: CalendarRange,
                      eyebrow: 'متابعة شهرية', purpose: 'راجع حركة كل ناقل خلال الشهر المختار',
                      description: 'المفوتر والتحصيل والمدفوعات والمراجعات من الخدمة الحالية نفسها.',
                      outcome: 'صورة شهرية قابلة للمقارنة', tone: 'var(--brand)',
                      render: () => <MonthlyReport isActive={pathname==='/monthly-report'}/> },
                  ] : []),
                ]}
              />
            </PageSlot>
            <PageSlot active={REPORTS_ARCHIVE_PATHS.includes(pathname)} scroll>
              <CenterWorkspace
                scope="reports-archive"
                title="التصدير والأرشيف"
                subtitle="الملفات الناتجة وسجل العمليات التاريخي في عرضين منفصلين"
                tone="#22C55E"
                activePath={pathname}
                onNavigate={goto}
                tabs={[
                  ...(isAdmin || can('internal_exports.view') ? [{
                    id: 'exports', path: '/internal-exports', label: 'الملفات المصدّرة', icon: Download,
                    eyebrow: 'أرشيف الملفات', purpose: 'أعد تنزيل الملفات المصدّرة وتتبع مصدرها',
                    description: 'السجل الحالي محفوظ كما هو ولا يعاد إنشاء الملف عند التنزيل.',
                    outcome: 'ملف معروف المصدر والتاريخ', tone: 'var(--green)',
                    render: () => <InternalExports carriers={carriers} isActive={pathname==='/internal-exports'}/>,
                  }] : []),
                  ...(isAdmin || can('system.view_audit_log') ? [{
                    id: 'activity', path: '/activity-log', label: 'سجل النظام', icon: Activity,
                    eyebrow: 'أثر تاريخي', purpose: 'اعرف من نفّذ الإجراء ومتى',
                    description: 'سجل للقراءة والمراجعة ولا يغيّر العمليات المسجلة.',
                    outcome: 'إجراء قابل للتتبع', tone: 'var(--brand)',
                    render: () => <ActivityLog isActive={pathname==='/activity-log'}/>,
                  }] : []),
                ]}
              />
            </PageSlot>
            <PageSlot active={pathname==='/integrity'} scroll>
              <IntegrityCheck isActive={pathname==='/integrity'}/>
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
            <PageSlot active={campaignActionActive} scroll>
              <SmartCampaignCenter isActive={campaignActionActive}/>
            </PageSlot>
            <PageSlot active={pathname==='/whatsapp-settings'} scroll>
              <WhatsAppSettings isActive={pathname==='/whatsapp-settings'}/>
            </PageSlot>
            <PageSlot active={pathname==='/workspace/finance'} scroll>
              <FinanceExecutive carriers={carriers} isActive={pathname==='/workspace/finance'}/>
            </PageSlot>
            <PageSlot active={ACCOUNTING_WORKSPACE_PATHS.includes(pathname)} scroll>
              <CenterWorkspace
                scope="finance-accounting"
                title="الحسابات والمطابقة"
                subtitle="بيانات Zoho والمطابقات المحاسبية من مصادرها الحالية"
                tone="#2563EB"
                activePath={pathname}
                onNavigate={goto}
                tabs={[
                  ...(isAdmin || can('zoho.view') ? [{
                    id: 'zoho', path: '/zoho-data', label: 'زوهو والحسابات', icon: BookOpen,
                    eyebrow: 'المصدر المحاسبي', purpose: 'راجع بيانات Zoho وحالة الربط',
                    description: 'الفواتير والموردون والبنوك والقيود تبقى بعروض منفصلة داخل صفحة Zoho.',
                    outcome: 'بيانات محاسبية قابلة للتتبع', tone: 'var(--brand)',
                    render: () => <ZohoData isActive={pathname==='/zoho-data'}/>,
                  }] : []),
                  ...(isAdmin || can('reconciliation.view') ? [{
                    id: 'reconciliation', path: '/reconciliation', label: 'مطابقة الأرصدة', icon: GitCompare,
                    eyebrow: 'فحص الفروقات', purpose: 'قارن الرصيد الداخلي بمرجع Zoho',
                    description: 'المطابقة لا تغيّر مصدر الدين؛ تعرض الفرق وتفتح إجراء المراجعة فقط.',
                    outcome: 'فرق معروف ومصدر واضح', tone: 'var(--accent3)',
                    render: () => <Reconciliation isActive={pathname==='/reconciliation'}/>,
                  }] : []),
                ]}
              />
            </PageSlot>
            <PageSlot active={FINANCE_PLANNING_PATHS.includes(pathname)} scroll>
              <CenterWorkspace
                scope="finance-planning"
                title="الربحية والسيولة والإقفال"
                subtitle="قراءة الربحية والتدفق المتوقع ثم إقفال الفترة"
                tone="#F59E0B"
                activePath={pathname}
                onNavigate={goto}
                tabs={[
                  ...(isAdmin || can('money.pnl') ? [{
                    id: 'pnl', path: '/pnl', label: 'قائمة الدخل', icon: TrendingUp,
                    eyebrow: 'النتيجة المالية', purpose: 'اقرأ الربح الفعلي من التقرير الرسمي',
                    description: 'تعرض قائمة الدخل وضريبة القيمة المضافة من Zoho دون إعادة حسابها في الواجهة.',
                    outcome: 'ربحية موثقة للفترة', tone: 'var(--green)',
                    render: () => <FinancialPosition isActive={pathname==='/pnl'}/>,
                  }] : []),
                  ...(isAdmin || can('ledger.view') ? [{
                    id: 'aging', path: '/cash-aging', label: 'أعمار التحصيل والسداد', icon: Wallet,
                    eyebrow: 'توقيت النقد', purpose: 'اعرف ما تأخر من التحصيل والسداد',
                    description: 'تصنيف زمني للحركة الحالية مع إبقاء ذمم العملاء والناقلين منفصلة.',
                    outcome: 'أولوية نقدية واضحة', tone: 'var(--gold)',
                    render: () => <CashAging isActive={pathname==='/cash-aging'}/>,
                  }] : []),
                  ...(isAdmin || can('forecast.view') ? [{
                    id: 'forecast', path: '/forecast', label: 'توقع السيولة', icon: Activity,
                    eyebrow: 'نظرة مستقبلية', purpose: 'توقع الداخل والخارج قبل موعده',
                    description: 'يستخدم الخدمات والحسابات الحالية كما هي، مع توضيح مصدر التقدير.',
                    outcome: 'فجوة سيولة معروفة مبكراً', tone: 'var(--accent3)',
                    render: () => <Forecast carriers={carriers} isActive={pathname==='/forecast'}/>,
                  }] : []),
                  ...(isAdmin || can('system.period_close') ? [{
                    id: 'periods', path: '/periods', label: 'إقفال الشهور', icon: Lock,
                    eyebrow: 'ضبط الفترة', purpose: 'راجع الجاهزية قبل إقفال الشهر',
                    description: 'الإقفال يحافظ على صلاحياته ومساره الحالي ولا يغيّر أي قيد مالي.',
                    outcome: 'فترة مكتملة ومقفلة بصلاحية', tone: 'var(--red)',
                    render: () => <Periods isActive={pathname==='/periods'}/>,
                  }] : []),
                ]}
              />
            </PageSlot>
            {/* /claims now renders inside CarriersWorkspace (claims tab) above */}
            {/* /cod-settlements + /payments + /bank
                all funnel through MoneyHub which selects the right tab
                based on the path. */}
            <PageSlot active={MONEY_HUB_PATHS.includes(pathname)} scroll>
              <MoneyHub isActive={MONEY_HUB_PATHS.includes(pathname)}/>
            </PageSlot>
            {/* متابعة العملاء — كانت hub بأربعة تبويبات؛ بعد المرحلتين 2+3 بقيت المتابعة فقط */}
            <PageSlot active={CUSTOMER_HUB_PATHS.includes(pathname)} scroll>
              <CustomerWatch isActive={CUSTOMER_HUB_PATHS.includes(pathname)}/>
            </PageSlot>
            <PageSlot active={OPERATIONS_BILLING_PATHS.includes(pathname)} scroll>
              <CenterWorkspace
                scope="operations-service-billing"
                title="فوترة الخدمات والأوزان"
                subtitle="خدمات التجهيز والأوزان الزائدة في عرضين مستقلين"
                tone="#2B68DE"
                activePath={pathname}
                onNavigate={goto}
                tabs={[
                  ...(isAdmin || can('audits.view') ? [{
                    id: 'fulfillment', path: '/fulfillment', label: 'فوترة التجهيز', icon: Briefcase,
                    eyebrow: 'خدمات العملاء', purpose: 'راجع خدمات التجهيز القابلة للفوترة',
                    description: 'يبقى تدقيق 3PL منفصلًا عن تدقيق فواتير الشحن.',
                    outcome: 'خدمة موثقة وقابلة للفوترة', tone: 'var(--brand)',
                    render: () => <FulfillmentAudit isActive={pathname==='/fulfillment'}/>,
                  }] : []),
                  ...(isAdmin || can('internal_exports.view') ? [{
                    id: 'weight', path: '/weight-billing', label: 'الأوزان الزائدة', icon: Scale,
                    eyebrow: 'فروقات الوزن', purpose: 'راجع الشحنات المؤهلة لفوترة الوزن',
                    description: 'لا تدخل مراجعة قديمة أو غير موثقة إلى التصدير.',
                    outcome: 'وزن موثق وملف قابل للتسليم', tone: 'var(--gold)',
                    render: () => <WeightBilling carriers={carriers} isActive={pathname==='/weight-billing'}/>,
                  }] : []),
                ]}
              />
            </PageSlot>
            <PageSlot active={pathname==='/overview'} scroll>
              <Overview carriers={carriers} isActive={pathname==='/overview'}/>
            </PageSlot>
            <PageSlot active={ADMIN_INTEGRATION_PATHS.includes(pathname)} scroll>
              <CenterWorkspace
                scope="admin-integrations"
                title="التكاملات والأتمتة"
                subtitle="المراقبة والمصادر وWebhooks ووكلاء العمل في Views واضحة"
                tone="#31D5E1"
                activePath={pathname}
                onNavigate={goto}
                tabs={[
                  ...(isAdmin || ['agents.view', 'system.view_audit_log', 'system.view_settings', 'uploads.view', 'zoho.view', 'whatsapp.view_log', 'whatsapp.configure', 'campaigns.ivr', 'webhook.view'].some(permission => can(permission)) ? [{
                    id: 'monitor', path: '/operations', label: 'مراقبة التكاملات', icon: Activity,
                    eyebrow: 'حالة التشغيل', purpose: 'اعرف ما يعمل وما تأخر من آخر أثر فعلي',
                    description: 'المصدر غير المتاح يبقى ظاهرًا ولا يتحول إلى نجاح أو صفر.',
                    outcome: 'تكامل وحالة وإجراء واضح', tone: 'var(--brand)',
                    render: () => <OperationsCenter isActive={pathname==='/operations'}/>,
                  }] : []),
                  ...(isAdmin || can('uploads.view') ? [{
                    id: 'sources', path: '/uploads', label: 'مصادر البيانات', icon: Layers,
                    eyebrow: 'حداثة المصدر', purpose: 'راجع آخر ملف وحالة كل مصدر يدوي',
                    description: 'يعرض آخر تحديث والفقد والتأخر من السجل الحالي.',
                    outcome: 'مصدر حديث أو تنبيه صريح', tone: 'var(--green)',
                    render: () => <UploadsHub isActive={pathname==='/uploads'}/>,
                  }] : []),
                  ...(isAdmin || can('webhook.view') ? [{
                    id: 'webhooks', path: '/webhook', label: 'Webhooks', icon: Inbox,
                    eyebrow: 'الوارد الخارجي', purpose: 'راجع الأحداث الواردة وحالة معالجتها',
                    description: 'إعادة العرض لا تعيد تنفيذ الحدث ولا تغيّر منطقه.',
                    outcome: 'حدث معروف وحالة معالجة', tone: 'var(--gold)',
                    render: () => <WebhookEvents carriers={carriers} isActive={pathname==='/webhook'}/>,
                  }] : []),
                  ...(isAdmin || can('agents.view') ? [{
                    id: 'agents', path: '/work-agents', label: 'وكلاء العمل', icon: Bot,
                    eyebrow: 'أتمتة مراقبة', purpose: 'راجع الوكلاء وتشغيلاتهم وآخر نتائجهم',
                    description: 'العرض يحافظ على صلاحيات التشغيل وسجل النتائج الحالي.',
                    outcome: 'وكيل وحالة وتشغيل قابل للتتبع', tone: 'var(--accent3)',
                    render: () => <WorkAgents isActive={pathname==='/work-agents'}/>,
                  }] : []),
                ]}
              />
            </PageSlot>
            <PageSlot active={isSettingsPath} scroll>
              <CenterWorkspace
                scope="admin-system-settings"
                title="إعدادات النظام والقنوات"
                subtitle="إعدادات النظام والبيانات وقنوات هاتف وIVR"
                tone="#31D5E1"
                activePath={pathname}
                onNavigate={goto}
                tabs={[
                  ...(isAdmin || can('system.view_settings') || can('carriers.view') || can('carriers.edit_contract') ? [{
                    id: 'settings', path: '/settings/ai', label: 'إعدادات النظام', icon: Settings,
                    eyebrow: 'ضبط التطبيق', purpose: 'أدر إعدادات الذكاء الاصطناعي والبيانات',
                    description: 'تبقى صفحات الفريق والناقلين والعقود في مساحاتها الإدارية الواضحة.',
                    outcome: 'إعداد معروف وصلاحية واضحة', tone: 'var(--brand)',
                    render: () => <SettingsPage carriers={carriers} tab={pathname.startsWith('/settings/') ? pathname.replace('/settings/','') : 'ai'}/>,
                  }] : []),
                  ...(isAdmin || can('whatsapp.configure') ? [{
                    id: 'hatif', path: '/settings/hatif', label: 'هاتف وIVR', icon: MessageCircle,
                    eyebrow: 'إعداد القنوات', purpose: 'راجع إعدادات هاتف والمكالمات الآلية',
                    description: 'لا يرسل هذا العرض رسالة أو حملة بمجرد فتحه.',
                    outcome: 'قناة مضبوطة وآمنة', tone: 'var(--accent3)',
                    render: () => <WhatsAppSettings isActive={pathname==='/settings/hatif'} settingsOnly/>,
                  }] : []),
                ]}
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
          { path: '/overview',            label: 'الرئيسية', icon: LayoutDashboard, show: isAdmin || can('overview.view') },
          { path: '/workspace/finance',   label: 'المالية',  icon: DollarSign, sectionId: 'finance', show: visibleNav.some(item => item.section === 'finance') },
          { path: '/workspace/customers', label: 'العملاء',  icon: Users, sectionId: 'customers', show: visibleNav.some(item => item.section === 'customers') },
          { path: '/workspace/operations', label: 'التشغيل', icon: Truck, sectionId: 'shipping', show: visibleNav.some(item => item.section === 'shipping') },
        ].filter(it => it.show).map(it => {
          const Icon = it.icon;
          const active = it.sectionId ? contextSection?.id === it.sectionId : location.pathname === it.path;
          return (
            <button key={it.path} onClick={() => goto(it.path)} aria-current={active ? 'page' : undefined}
              className={`bottom-nav-btn ${active ? 'active' : ''}`}>
              <Icon size={19}/>
              <span>{it.label}</span>
            </button>
          );
        })}
        <button className="bottom-nav-btn" aria-label="فتح قائمة المراكز" onClick={() => openNavigation()}>
          <Menu size={19}/>
          <span>القائمة</span>
        </button>
      </nav>

      <MobileExperienceManager routeKey={`${location.pathname}${location.search}`}/>
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
      navigate(`/carrier?id=${encodeURIComponent(auditFromState.carrierId)}&view=invoices&mode=result&invoice=${encodeURIComponent(auditFromState.id)}`, { replace: true });
      return;
    }
    const auditId = new URLSearchParams(location.search).get('audit');
    if (auditId) {
      setAudit(null);
      loadAuditByIdFromDB(auditId)
        .then(a => {
          if (!live) return;
          try { sessionStorage.setItem('lastAudit', JSON.stringify(a)); } catch { /* ignore */ }
          navigate(`/carrier?id=${encodeURIComponent(a.carrierId)}&view=invoices&mode=result&invoice=${encodeURIComponent(a.id)}`, { replace: true });
        })
        .catch(() => {
          if (live) navigate('/audits', { replace: true });
        });
      return () => { live = false; };
    }
    try {
      const data = JSON.parse(sessionStorage.getItem('lastAudit') || 'null');
      if (data) navigate(`/carrier?id=${encodeURIComponent(data.carrierId)}&view=invoices&mode=result&invoice=${encodeURIComponent(data.id)}`, { replace: true });
      else navigate('/hub', { replace: true });
    } catch { navigate('/hub', { replace: true }); }
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
  // ── (١) لا تُنشأ الصفحة قبل أول زيارة (2026-07-28) ──
  // كانت الـ41 صفحة تُركَّب كلها عند أول تحميل — عمل ضخم قبل ظهور أي شيء.
  // الآن الصفحة تُركَّب عند أول تنشيط فقط، ثم تبقى (يُحفظ سلوك keep-alive:
  // الحالة والتمرير والبيانات المحمَّلة لا تضيع عند التنقّل).
  const seen = useRef(false);
  if (active) seen.current = true;

  // Keep the mounted page state while always passing the current route props.
  // Freezing the last active JSX froze `isActive=true`, so hidden pages kept
  // polling Supabase after navigation and could exhaust the statement timeout.
  const content = children;
  return (
    <div className="page-slot" style={{
      position: 'absolute', inset: 0,
      overflow: scroll ? 'auto' : 'hidden',
      visibility: active ? 'visible' : 'hidden',
      // `visibility:hidden` يُخفي لكن المتصفح **يظل يحسب التخطيط ويرسم** كل
      // الصفحات الـ59 المركَّبة — ومع الهيدر المتدرّج ذي الضبابية في كل صفحة
      // صار كل تنقّل ثقيلاً (بلاغ المستخدم 2026-07-28). `content-visibility`
      // يُلغي رسم وتخطيط محتوى الصفحة غير النشطة **مع بقاء DOM وحالة React**
      // كما هي (بعكس display:none الذي يفقد قياسات التمرير).
      contentVisibility: active ? 'visible' : 'hidden',
      pointerEvents: active ? 'auto' : 'none',
      display: 'flex', flexDirection: 'column', alignItems: 'stretch',
    }}>
      {seen.current && (
        <SlotBoundary>
          {/* الصفحات تُحمَّل كسولاً (React.lazy) — Suspense داخل الخانة كي
              يبقى انتظار أول فتح محصوراً في الصفحة لا في التطبيق كله. */}
          <Suspense fallback={
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 260 }}>
              <Spinner size={26}/>
            </div>
          }>
            {content}
          </Suspense>
        </SlotBoundary>
      )}
      {scroll && <div className="page-slot-scroll-end" aria-hidden="true" />}
    </div>
  );
}

// نستخدمها عندما يكون الوصول للتاب نفسه جزءاً من العمل اليومي، مثل ملف العملاء.

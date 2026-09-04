import { useState, useEffect, useCallback, useRef, lazy, Suspense, Component } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Truck, Upload, Download, History, Settings,
  Menu, Users, Sun, Moon, Wallet, FileText, BookOpen, Banknote, CreditCard, BarChart3, Activity, Scale, Webhook, ClipboardList, Building2, Inbox, ShoppingBag, Briefcase, FileCheck, DollarSign, UserCog, ListTodo, Layers, Lock, TrendingUp, GitCompare, Phone, CalendarRange, Search, Gauge, Headset, Boxes, HandCoins, Target, MessageCircle, UserPlus, Bot, Landmark, ListFilter,
} from 'lucide-react';
import { ToastContainer, Spinner } from './components/UI.jsx';
import QuickActionLauncher from './components/QuickActionLauncher.jsx';
import NavigationHub, { firstSectionDestination } from './components/NavigationHub.jsx';
import ExecutiveSidebar from './components/ExecutiveSidebar.jsx';
import { MobileExperienceManager } from './components/MobileUX.jsx';
import { AppShell, Breadcrumbs } from './design-system/EnterpriseUI.jsx';
import EnterpriseOperationsOverview from './components/enterprise/EnterpriseOperationsOverview.jsx';
import AdminWorkspaceNav from './components/enterprise/AdminWorkspaceNav.jsx';
import { AuthProvider, useAuth } from './lib/auth.jsx';
import { logLogin, logPageView, logDenied } from './lib/activityLogger.js';
import { PAGE_TITLES } from './lib/pageTitles.js';
import {
  NAV_SECTIONS as NAV_SECTION_MODEL,
  CENTER_WORKSPACES,
  applyNavigationIA,
  resolveSavedWorkspaceRoute,
  resolveWorkspace,
} from './lib/navigation.js';
import { loadCarriers, loadAuditByIdFromDB } from './lib/coreService.js';
const lazyWithRouteRecovery = (routeKey, importer) => lazy(async () => {
  const retryKey = `shipaudit:lazy-route-retry:${routeKey}`;
  try {
    const module = await importer();
    try { sessionStorage.removeItem(retryKey); } catch { /* storage may be unavailable */ }
    return module;
  } catch (error) {
    const isChunkFailure = /dynamically imported module|chunkloaderror|loading chunk/i.test(String(error?.message || error));
    let retried = false;
    try { retried = sessionStorage.getItem(retryKey) === '1'; } catch { /* storage may be unavailable */ }
    if (isChunkFailure && !retried) {
      try { sessionStorage.setItem(retryKey, '1'); } catch { /* storage may be unavailable */ }
      window.location.reload();
      return new Promise(() => {});
    }
    throw error;
  }
});
const renderWorkspaceView = (tabs, activePath) => {
  const active = tabs.find(tab => tab.path === activePath) || tabs[0];
  return active?.render?.() || null;
};
const CarrierProfile = lazy(() => import('./pages/CarrierProfile.jsx'));
const CarrierManager = lazy(() => import('./pages/CarrierManager.jsx'));
const UploadWizard = lazy(() => import('./pages/UploadWizard.jsx'));
const AuditResults = lazy(() => import('./pages/AuditResults.jsx'));
// ملف واحد يُصدِّر صفحتين → lazy لكل تصدير على حدة (وإلا شدّ معه
// `engine/export.js` ومكتبة الإكسل كاملةً إلى حزمة الدخول — §الأداء).
const SettingsPage   = lazy(() => import('./pages/Settings.jsx').then(m => ({ default: m.SettingsPage })));
const AuditsHistory  = lazy(() => import('./pages/EnterpriseAuditsHistory.jsx'));
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
const StoreActivation = lazy(() => import('./pages/StoreActivation.jsx'));
const CarriersWorkspace = lazy(() => import('./pages/CarriersWorkspace.jsx'));
const FulfillmentAudit = lazy(() => import('./pages/FulfillmentAudit.jsx'));
const MoneyHub = lazy(() => import('./pages/MoneyHub.jsx'));
const Periods = lazy(() => import('./pages/Periods.jsx'));
const Forecast = lazy(() => import('./pages/Forecast.jsx'));
const ReportsWorkspace = lazy(() => import('./pages/ReportsWorkspace.jsx'));
const AdminWorkspace = lazy(() => import('./pages/AdminWorkspace.jsx'));
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
const Reconciliation = lazyWithRouteRecovery('reconciliation', () => import('./pages/Reconciliation.jsx'));
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
  { id: 'admin-workspace', path: '/workspace/admin', label: 'مركز الإدارة', icon: Settings, section: 'tools', navOrder: 5,
    permAny: ['system.manage_employees', 'system.manage_permissions', 'agents.view', 'system.view_audit_log', 'system.view_settings', 'uploads.view', 'zoho.view', 'whatsapp.view_log', 'whatsapp.configure', 'campaigns.ivr', 'webhook.view', 'carriers.view', 'carriers.edit_contract'] },
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
  { id: 'work-agents', path: '/work-agents', label: 'مركز الأتمتة', icon: Bot, section: 'outreach', navOrder: 70, permKey: 'agents.view' },
  { id: 'operations', path: '/operations', label: 'التكاملات', icon: Activity, section: 'outreach', navOrder: 15,
    permAny: ['agents.view', 'system.view_audit_log', 'system.view_settings', 'uploads.view', 'zoho.view', 'whatsapp.view_log', 'whatsapp.configure', 'campaigns.ivr', 'webhook.view'],
    subTabs: [
      { tabId: 'overview', label: 'مراقبة التكاملات', icon: Activity },
      { tabId: 'sources', label: 'مزامنة مصادر البيانات', icon: Layers, legacy: '/uploads', perm: 'uploads.view' },
      { tabId: 'integrity', label: 'سلامة البيانات', icon: FileCheck, legacy: '/integrity', perm: 'system.view_audit_log' },
      { tabId: 'activity', label: 'سجل النظام', icon: Activity, legacy: '/activity-log', perm: 'system.view_audit_log' },
      { tabId: 'agents', label: 'مركز الأتمتة', icon: Bot, legacy: '/work-agents', perm: 'agents.view' },
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
const SECTION_ICONS = { Truck, Users, Target, MessageCircle, DollarSign, FileCheck, Settings, Landmark };
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
PATH_PERM.set('/workspace/sales', ['sales.view', 'sales.hatif_leads', 'sales.external_leads', 'sales.segments', 'merchants.view']);
PATH_PERM.set('/workspace/campaigns', ['campaigns.send', 'campaigns.ivr', 'whatsapp.view_log', 'receivables.view', 'sales.view']);
// مركز الحملات وجهة مستقلة داخل مركز المبيعات، كما يستقبل سياق جمهور قادمًا
// من التحصيل. تعريف ROUTE_ITEMS أعلاه هو حارس المسار ومصدر ظهوره في القائمة.

// Paths that all render the CustomerHub page (which selects the
// right tab based on which path was used). Used to scope the
// PageSlot active check.
const CUSTOMER_HUB_PATHS = ['/customer-360', '/customers'];
// مركز المبيعات (§1.32 المرحلة 3): الفرص الثلاث + الشرائح + دليل المتاجر
const SALES_HUB_PATHS = ['/workspace/sales'];
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
const REPORTS_WORKSPACE_PATHS = ['/workspace/reports'];
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
      <AppRouterShell theme={theme} toggleTheme={toggleTheme}/>
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

function AppRouterShell(props) {
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
  const campaignActionActive = pathname === '/workspace/campaigns';

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
      const next = new URLSearchParams(params);
      next.set('view', next.get('view') || next.get('tab') || 'today');
      next.delete('tab');
      next.set('source', next.get('source') || 'legacy-sales');
      navigate(`/workspace/sales?${next.toString()}`, { replace: true });
      return;
    }
    if (rawPath === '/marketers') {
      const next = new URLSearchParams(params);
      next.set('view', next.get('view') || 'overview');
      next.set('source', next.get('source') || 'legacy-marketers');
      navigate(`/workspace/sales?${next.toString()}`, { replace: true });
      return;
    }
    if (['/retargeting', '/hatif-leads', '/segments', '/next-actions'].includes(rawPath)) {
      const next = new URLSearchParams(params);
      const legacyView = rawPath === '/hatif-leads' ? 'hatif'
        : rawPath === '/segments' ? 'segments'
          : rawPath === '/next-actions' ? 'today'
            : (next.get('view') || next.get('tab') || 'pipeline');
      next.set('view', legacyView);
      next.delete('tab');
      next.set('source', next.get('source') || `${rawPath.slice(1)}-alias`);
      navigate(`/workspace/sales?${next.toString()}`, { replace: true });
      return;
    }
    if (rawPath === '/campaigns') {
      const next = new URLSearchParams(params);
      next.set('source', next.get('source') || 'campaigns-alias');
      navigate(`/workspace/campaigns?${next.toString()}`, { replace: true });
      return;
    }
    if (['/reports', '/monthly-report', '/internal-exports'].includes(rawPath)) {
      const next = new URLSearchParams(params);
      const view = rawPath === '/monthly-report' ? 'monthly' : rawPath === '/internal-exports' ? 'exports' : 'builder';
      next.set('view', view);
      next.set('source', next.get('source') || `${rawPath.slice(1)}-alias`);
      navigate(`/workspace/reports?${next.toString()}`, { replace: true });
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
      const next = new URLSearchParams(params);
      next.set('action', 'upload-invoice');
      next.set('source', next.get('source') || 'upload-legacy-route');
      navigate(`/hub?${next.toString()}`, { replace: true });
      return;
    }
    if (rawPath === '/customers') {
      const next = new URLSearchParams(params);
      next.set('source', next.get('source') || 'customers-alias');
      navigate(`/workspace/customers?${next.toString()}`, { replace: true });
      return;
    }
    if (rawPath === '/collections' || rawPath === '/receivables') {
      const next = new URLSearchParams(params);
      next.set('view', rawPath === '/collections' ? 'queue' : 'internal');
      next.set('source', next.get('source') || rawPath.slice(1));
      navigate(`/customer-money?${next.toString()}`, { replace: true });
      return;
    }
    if (rawPath === '/merchants') {
      const next = new URLSearchParams(params);
      next.set('source', next.get('source') || 'merchants');
      navigate(`/customer-360?${next.toString()}`, { replace: true });
      return;
    }
    if (['/bank', '/cod-settlements', '/payments'].includes(rawPath) && !params.get('carrier')) {
      const next = new URLSearchParams(params);
      const targetTab = rawPath === '/bank' ? 'bank' : rawPath === '/cod-settlements' ? 'cod' : 'payments';
      next.set('tab', targetTab);
      next.set('source', next.get('source') || `${targetTab}-legacy-route`);
      navigate(`/money?${next.toString()}`, { replace: true });
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
    // Deep links carry operational context (filters, shipment/invoice ids and
    // returnTo). Start from the incoming query instead of rebuilding it, then
    // normalize only the carrier/view keys required by Carrier 360.
    const next = new URLSearchParams(params);
    next.delete('carrier');
    next.delete('edit');
    next.set('id', scopedCarrier);
    next.set('view', view);
    Object.entries(extra).forEach(([key, value]) => next.set(key, value));
    const auditId = params.get('audit');
    if (auditId) next.set('invoice', auditId);
    navigate(`/carrier?${next.toString()}`, { replace: true });
  }, [profile, pathAllowed, rawPath, location.search, navigate]);

  useEffect(() => {
    const title = rawPath === '/customer-money' && new URLSearchParams(location.search).get('worklist') === '1'
      ? 'قائمة التنفيذ'
      : PAGE_TITLES[rawPath]
      ?? (rawPath.startsWith('/settings') ? 'الإعدادات' : 'ShipAudit');
    document.title = `${title} — ShipAudit Pro`;
  }, [location.search, rawPath]);

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
    if (center && !['finance', 'sales', 'campaigns', 'customers', 'reports', 'settings'].includes(center.id)) {
      try {
        const saved = localStorage.getItem(`${LAST_CENTER_ROUTE_PREFIX}${center.id}`);
        const restored = resolveSavedWorkspaceRoute({
          requestedWorkspace: center.id,
          fallbackPath: path,
          savedRoute: saved,
          navigationItems: NAV_ITEMS,
        });
        if (restored !== path) {
          const savedUrl = new URL(restored, window.location.origin);
          const item = navigationItemForPath(savedUrl.pathname);
          const allowed = !item?.navHidden && (isAdmin
            || (!item.adminOnly && (item.permAny ? item.permAny.some(key => can(key)) : !item.permKey || can(item.permKey))));
          if (allowed) destination = restored;
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
  const worklistScoped = rawPath === '/customer-money' && contextParams.get('worklist') === '1';
  const reportScoped = (
    rawPath === '/platform-carriers'
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
  const routeWorkspaceId = resolveWorkspace(rawPath, NAV_ITEMS);
  const contextSection = (forcedSectionId ? NAV_SECTIONS.find(section => section.id === forcedSectionId) : null)
    || (detailSectionId ? NAV_SECTIONS.find(section => section.id === detailSectionId) : null)
    || (routeWorkspaceId ? NAV_SECTIONS.find(section => section.id === routeWorkspaceId) : null)
    || centerRouteSection
    || currentSection;
  const currentTitle = worklistScoped
    ? 'قائمة التنفيذ'
    : pathname === '/overview'
    ? 'مركز القيادة'
    : centerRouteSection?.label ?? currentSubTab?.label
      ?? currentNavItem?.label
      ?? PAGE_TITLES[location.pathname]
      ?? (location.pathname.startsWith('/settings') ? 'الإعدادات' : 'لمحة');
  const quickActionLabel = ({
    finance: 'إجراء مالي جديد',
    sales: 'إضافة فرصة أو تواصل',
    campaigns: 'إنشاء حملة',
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

      <AppShell>

        <ExecutiveSidebar
          sections={NAV_SECTIONS}
          navItems={visibleNav}
          currentSectionId={contextSection?.id || null}
          pathname={location.pathname}
          profile={profile}
          roleLabel={ROLE_LABEL[profile.role] ?? profile.role}
          canOpenHome={isAdmin || can('overview.view')}
          onNavigate={goto}
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
              <Breadcrumbs
                className="topbar-breadcrumb"
                items={contextSection
                  ? [{ label: 'الرئيسية', onClick: () => goto('/overview') }, { label: contextSection.label }]
                  : [{ label: 'الرئيسية' }]}
              />
              <strong className="topbar-title">{currentTitle}</strong>
              {/* Quick search / command palette trigger — minWidth 220 يُصفَّر
                  على الجوال عبر .topbar-search (كان يوسّع التطبيق كله أفقياً) */}
              <button
                className="topbar-search"
                onClick={() => setPaletteOpen(true)}
                title="بحث سريع (Ctrl+K)"
              >
                <Search size={15}/>
                <span className="topbar-search-hint">عميل، متجر، فاتورة، شحنة أو صفحة…</span>
                <kbd className="topbar-search-kbd">Ctrl K</kbd>
              </button>
            </div>

            <button type="button" className="topbar-quick-action" aria-label={quickActionLabel || 'إجراء جديد'} title={quickActionLabel || 'إجراء جديد'} onClick={() => setQuickActionOpen(true)}>
              <Upload size={16}/><span>{quickActionLabel}</span>
            </button>

            <div className="topbar-user" aria-label={`المستخدم ${profile?.name || ''}`}>
              <span style={{ '--avatar-color': profile?.avatar_color || '#64748b' }}>{profile?.name?.[0] || 'ل'}</span>
              <div><strong>{profile?.name || 'لمحة'}</strong><small>{ROLE_LABEL[profile.role] ?? profile.role}</small></div>
            </div>

            {/* Theme toggle */}
            <button className="theme-toggle" aria-label={theme === 'dark' ? 'تفعيل الوضع النهاري' : 'تفعيل الوضع الليلي'} onClick={toggleTheme} title={theme === 'dark' ? 'الوضع النهاري' : 'الوضع الليلي'}>
              {theme === 'dark' ? <Sun size={15}/> : <Moon size={15}/>}
            </button>
          </div>

          {/* ── Pages ── */}
          {/* All pages permanently mounted — visibility:hidden instead of display:none
              prevents CSS animations from replaying on every navigation */}
          <div className="page-content">

            {contextSection?.id === 'settings' && pathname !== '/workspace/admin' ? (
              <div className="admin-detail-workspace-nav"><AdminWorkspaceNav/></div>
            ) : null}

            {NAV_SECTIONS.map(section => {
              return (
                <PageSlot key={section.id} active={pathname === section.path} scroll>
                  {section.id === 'finance'
                    ? <FinanceExecutive carriers={carriers} isActive={pathname === section.path}/>
                    : section.id === 'sales' || section.id === 'campaigns' || section.id === 'reports' || section.id === 'settings'
                      ? null
                    : section.id === 'customers'
                        ? <CustomerWatch isActive={pathname === section.path}/>
                    : section.id === 'shipping'
                      ? <EnterpriseOperationsOverview isActive={pathname === section.path} navigate={goto}/>
                    // لا نُبقِ Navigate مركبًا بعد مغادرة المركز. PageSlot يحتفظ
                    // بالمحتوى الذي زاره المستخدم؛ وكان التحويل المخفي يعيد
                    // التنفيذ عند أي تنقل لاحق فيخطف فتح المالية/العملاء/النمو.
                    : pathname === section.path
                      ? <Navigate to={firstSectionDestination(section.id, CENTER_WORKSPACES, visibleNav)} replace/>
                      : null}
                </PageSlot>
              );
            })}

            <PageSlot active={pathname==='/decisions'} scroll>
              <DecisionsBoard isActive={pathname==='/decisions'}/>
            </PageSlot>
            <PageSlot active={pathname==='/accounting-cycle'} scroll>
              <AccountingCycle carriers={carriers} isActive={pathname==='/accounting-cycle'}/>
            </PageSlot>

            <PageSlot active={OPERATIONS_CARRIER_PATHS.includes(pathname)} scroll>
              {CARRIER_WORKSPACE_PATHS.includes(pathname)
                ? <CarriersWorkspace carriers={carriers} isActive/>
                : pathname === '/platform-carriers'
                  ? <PlatformCarriers isActive/>
                  : <Tasks carriers={carriers} isActive/>}
            </PageSlot>
            <PageSlot active={pathname==='/carrier'} scroll>
              <CarrierProfile carriers={carriers} setCarriers={setCarriers} onCarriersChange={reloadCarriers}/>
            </PageSlot>
            <PageSlot active={ADMIN_CARRIER_PATHS.includes(pathname)} scroll>
              {pathname === '/carriers'
                ? <CarrierManager carriers={carriers} setCarriers={setCarriers} onCarriersChange={reloadCarriers}/>
                : <ContractsOverview isActive={pathname==='/contracts'}/>}
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
              {pathname === '/drop' && (isAdmin || can('audits.create')) ? <SmartDrop carriers={carriers}/> : null}
              {pathname === '/audits' && (isAdmin || can('audits.view')) ? <AuditsHistory onOpen={handleOpenAudit} isActive/> : null}
              {pathname === '/aramex-statements' && (isAdmin || can('carriers.view')) ? <CarrierStatements carriers={carriers}/> : null}
              {pathname === '/ledger' && (isAdmin || can('ledger.view')) ? <CarrierLedger isActive/> : null}
            </PageSlot>
            <PageSlot active={REPORTS_WORKSPACE_PATHS.includes(pathname)} scroll>
              <ReportsWorkspace carriers={carriers} isActive={REPORTS_WORKSPACE_PATHS.includes(pathname)}/>
            </PageSlot>
            <PageSlot active={pathname==='/workspace/admin'} scroll>
              <AdminWorkspace isActive={pathname==='/workspace/admin'}/>
            </PageSlot>
            <PageSlot active={pathname==='/activity-log'} scroll>
              <ActivityLog isActive={pathname==='/activity-log'}/>
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
            <PageSlot active={ACCOUNTING_WORKSPACE_PATHS.includes(pathname)} scroll>
              {renderWorkspaceView([
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
                ], pathname)}
            </PageSlot>
            <PageSlot active={FINANCE_PLANNING_PATHS.includes(pathname)} scroll>
              {renderWorkspaceView([
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
                ], pathname)}
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
              {pathname === '/fulfillment' && (isAdmin || can('audits.view')) ? <FulfillmentAudit isActive/> : null}
              {pathname === '/weight-billing' && (isAdmin || can('internal_exports.view')) ? <WeightBilling carriers={carriers} isActive/> : null}
            </PageSlot>
            <PageSlot active={pathname==='/overview'} scroll>
              <Overview carriers={carriers} isActive={pathname==='/overview'}/>
            </PageSlot>
            <PageSlot active={ADMIN_INTEGRATION_PATHS.includes(pathname)} scroll>
              {pathname === '/operations' ? <OperationsCenter isActive/>
                : pathname === '/uploads' ? <UploadsHub isActive/>
                  : pathname === '/webhook' ? <WebhookEvents carriers={carriers} isActive/>
                    : <WorkAgents isActive/>}
            </PageSlot>
            <PageSlot active={isSettingsPath} scroll>
              {pathname === '/settings/hatif'
                ? <WhatsAppSettings isActive settingsOnly/>
                : <SettingsPage carriers={carriers} tab={pathname.startsWith('/settings/') ? pathname.replace('/settings/','') : 'ai'}/>}
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
      </AppShell>

      {/* ── شريط التنقّل السفلي (جوال فقط ≤768px، مخفي بالـCSS على الحاسب) ──
          يختصر التنقّل اليومي من نقرتين عبر الدرج إلى نقرة واحدة. طبقة جوال
          منفصلة عن الدرج — لا تخالف قاعدة «لا تثبيت عناصر جديدة» (§1.11f). */}
      <nav className="bottom-nav">
        {[
          { path: '/overview',            label: 'الرئيسية', icon: LayoutDashboard, show: isAdmin || can('overview.view') },
          { path: '/workspace/customers', label: 'العملاء',  icon: Users, sectionId: 'customers', show: visibleNav.some(item => item.section === 'customers') },
          { path: '/workspace/sales',     label: 'المبيعات', icon: Target, sectionId: 'sales', show: visibleNav.some(item => item.section === 'sales') },
          { path: '/workspace/finance',   label: 'المالية',  icon: DollarSign, sectionId: 'finance', show: visibleNav.some(item => item.section === 'finance') },
          { path: '__more__', label: 'المزيد', icon: Menu, sectionId: 'more', show: visibleNav.some(item => ['campaigns','shipping','reports','settings'].includes(item.section)) },
        ].filter(it => it.show).map(it => {
          const Icon = it.icon;
          const active = it.sectionId === 'more'
            ? ['campaigns','shipping','reports','settings'].includes(contextSection?.id)
            : it.exact
              ? location.pathname === it.path
            : it.sectionId
              ? contextSection?.id === it.sectionId
              : location.pathname === it.path;
          return (
            <button key={it.path} onClick={() => it.sectionId === 'more' ? openNavigation(null) : goto(it.path)} aria-current={active ? 'page' : undefined}
              className={`bottom-nav-btn ${active ? 'active' : ''}`}>
              <Icon size={19}/>
              <span>{it.label}</span>
            </button>
          );
        })}
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
      const next = new URLSearchParams(location.search);
      next.delete('audit');
      next.set('id', auditFromState.carrierId);
      next.set('view', 'invoices');
      next.set('mode', 'result');
      next.set('invoice', auditFromState.id);
      navigate(`/carrier?${next.toString()}`, { replace: true });
      return;
    }
    const auditId = new URLSearchParams(location.search).get('audit');
    if (auditId) {
      setAudit(null);
      loadAuditByIdFromDB(auditId)
        .then(a => {
          if (!live) return;
          try { sessionStorage.setItem('lastAudit', JSON.stringify(a)); } catch { /* ignore */ }
          const next = new URLSearchParams(location.search);
          next.delete('audit');
          next.set('id', a.carrierId);
          next.set('view', 'invoices');
          next.set('mode', 'result');
          next.set('invoice', a.id);
          navigate(`/carrier?${next.toString()}`, { replace: true });
        })
        .catch(() => {
          if (live) {
            const next = new URLSearchParams(location.search);
            next.set('source', next.get('source') || 'results-unavailable');
            navigate(`/audits?${next.toString()}`, { replace: true });
          }
        });
      return () => { live = false; };
    }
    try {
      const data = JSON.parse(sessionStorage.getItem('lastAudit') || 'null');
      if (data) {
        const next = new URLSearchParams(location.search);
        next.delete('audit');
        next.set('id', data.carrierId);
        next.set('view', 'invoices');
        next.set('mode', 'result');
        next.set('invoice', data.id);
        navigate(`/carrier?${next.toString()}`, { replace: true });
      }
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
  componentDidCatch(error, info) {
    console.error('[page-slot] failed to render', error, info);
  }
  render() {
    if (this.state.err) {
      return (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>تعذر تحميل مساحة العمل</div>
          <div style={{ fontSize: 12, marginBottom: 16 }}>لم تتغير بياناتك. أعد تحميل الصفحة لاستعادة المسار بأمان.</div>
          <button onClick={() => window.location.reload()}
            style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }}>
            إعادة التحميل الآمنة
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

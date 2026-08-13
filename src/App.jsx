import { useState, useEffect, useCallback, useRef, lazy, Suspense, Component } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Truck, Upload, Download, History, Settings,
  ChevronLeft, ChevronRight, ChevronDown, Menu, X, Users, Sun, Moon, Wallet, FileText, BookOpen, Banknote, CreditCard, BarChart3, Activity, LogOut, Scale, Webhook, ClipboardList, Building2, Inbox, ShoppingBag, Briefcase, FileCheck, DollarSign, UserCog, ListTodo, Layers, Lock, TrendingUp, GitCompare, Phone, CalendarRange, Search, Gauge, Headset, Boxes, HandCoins, Target, MessageCircle, UserPlus, LifeBuoy, BadgeDollarSign, Bot, Landmark,
} from 'lucide-react';
import { ToastContainer, Spinner } from './components/UI.jsx';
import { LamhaMark, LamhaLogo } from './components/BrandLogo.jsx';
import AIChat from './components/AIChat.jsx';
import CenterWorkspace from './components/CenterWorkspace.jsx';
import { AuthProvider, useAuth } from './lib/auth.jsx';
import { logLogin, logPageView, logDenied } from './lib/activityLogger.js';
import { PAGE_TITLES } from './lib/pageTitles.js';
import { NAV_SECTIONS as NAV_SECTION_MODEL, NAV_GROUPS as NAV_GROUP_MODEL, applyNavigationIA } from './lib/navigation.js';
import { loadCarriers, loadAuditByIdFromDB } from './lib/coreService.js';
import { ACCOUNTING_CYCLE_STAGES } from './lib/accountingCycleStages.js';
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
const CrmWorkspace = lazy(() => import('./pages/CrmWorkspace.jsx'));
const FulfillmentAudit = lazy(() => import('./pages/FulfillmentAudit.jsx'));
const MoneyHub = lazy(() => import('./pages/MoneyHub.jsx'));
const Periods = lazy(() => import('./pages/Periods.jsx'));
const Forecast = lazy(() => import('./pages/Forecast.jsx'));
const MonthlyReport = lazy(() => import('./pages/MonthlyReport.jsx'));
const ReportsCenter = lazy(() => import('./pages/ReportsCenter.jsx'));
const ZohoCallback = lazy(() => import('./pages/ZohoCallback.jsx'));
const FinancialPosition = lazy(() => import('./pages/FinancialPosition.jsx'));
const ZohoData = lazy(() => import('./pages/ZohoData.jsx'));
const CollectionsHub = lazy(() => import('./pages/CollectionsHub.jsx'));
const SalesHub = lazy(() => import('./pages/SalesHub.jsx'));
const WhatsAppSettings = lazy(() => import('./pages/WhatsAppSettings.jsx'));
const SmartDrop = lazy(() => import('./pages/SmartDrop.jsx'));
const CashAging = lazy(() => import('./pages/CashAging.jsx'));
const IntegrityCheck = lazy(() => import('./pages/IntegrityCheck.jsx'));
// Claims now renders inside CarriersWorkspace (claims tab), not a top-level route.
const DecisionsBoard = lazy(() => import('./pages/DecisionsBoard.jsx'));
import CommandPalette    from './components/CommandPalette.jsx';
const Overview = lazy(() => import('./pages/Overview.jsx'));
const Reconciliation = lazy(() => import('./pages/Reconciliation.jsx'));
const UploadsHub = lazy(() => import('./pages/UploadsHub.jsx'));
const TicketForm = lazy(() => import('./pages/TicketForm.jsx'));
const SupportBoard = lazy(() => import('./pages/SupportBoard.jsx'));
const Marketers = lazy(() => import('./pages/Marketers.jsx'));
const WorkAgents = lazy(() => import('./pages/WorkAgents.jsx'));
const OperationsCenter = lazy(() => import('./pages/OperationsCenter.jsx'));
const AccountingCycle = lazy(() => import('./pages/AccountingCycle.jsx'));
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
  { id: 'money',     path: '/money',    label: 'حركة الأموال',  icon: Banknote,   section: 'money', navOrder: 10, permAny: ['cod.view', 'payments.view', 'bank.view'],
    subTabs: [
      { tabId: 'cod',      label: 'تحصيل شركات الشحن', icon: Banknote,   legacy: '/cod-settlements', perm: 'cod.view' },
      { tabId: 'payments', label: 'دفعات الناقلين',     icon: CreditCard, legacy: '/payments', perm: 'payments.view' },
      { tabId: 'bank',     label: 'الحسابات البنكية',   icon: Wallet,     legacy: '/bank', perm: 'bank.view' },
    ] },
  { id: 'cash-aging', path: '/cash-aging', label: 'أعمار التحصيل والسداد', icon: Wallet, section: 'money', navOrder: 40, permKey: 'ledger.view' },
  { id: 'forecast',   path: '/forecast',   label: 'توقّع السيولة', icon: TrendingUp, section: 'money', navOrder: 50, permKey: 'forecast.view' },

  // ── العملاء والنمو ─────────────────────────────────────────────
  // Customers + receivables + segments + merchants merged into
  // /customer-360 — kept the legacy routes alive in App so any
  // existing deep links still land on the right tab.
  { id: 'customer-watch',  path: '/customer-360',    label: 'ملف العميل 360', icon: Users,     section: 'customers', navOrder: 10, permKey: 'receivables.view' },
  // «تحصيل العملاء» — شاشة التحصيل الأولى (زوهو API المرجع)، أول عنصر بالقسم
  // §1.32 مرحلة 2: مركز التحصيل = تحصيل العملاء + قائمة التحصيل + القانوني + الكشف الداخلي
  { id: 'collections-hub', path: '/customer-money',  label: 'الديون والتحصيل',  icon: HandCoins, section: 'money', navOrder: 20, permKey: 'receivables.view',
    subTabs: [
      { tabId: 'money',    label: 'أرصدة العملاء',   icon: HandCoins },
      { tabId: 'queue',    label: 'قائمة التحصيل',    icon: Phone,  legacy: '/collections' },
      { tabId: 'performance', label: 'أداء فريق التحصيل', icon: BarChart3, perm: 'collections.view_all' },
      { tabId: 'legal',    label: 'التصعيد القانوني', icon: Scale,  legacy: '/legal' },
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
      { tabId: 'segments',    label: 'مجموعات العملاء',      icon: Layers,      legacy: '/segments' },
      { tabId: 'merchants',   label: 'متاجر المنصّة',      icon: ShoppingBag, legacy: '/merchants' },
    ] },
  // قائمة التحصيل دُمجت تبويباً أول داخل CRM (موافقة المستخدم 2026-07-02) —
  // /collections القديم يهبط على تبويبها داخل CrmWorkspace.
  { id: 'crm',             path: '/crm',             label: 'صفقات ومواعيد المبيعات', icon: TrendingUp, section: 'customers', navOrder: 30, permKey: 'crm.view',
    subTabs: [
      { tabId: 'deals', label: 'صفقات المبيعات',  icon: TrendingUp },
      { tabId: 'tasks', label: 'المواعيد',         icon: CalendarRange },
      { tabId: 'board', label: 'أداء المبيعات',    icon: BarChart3 },
      { tabId: 'settings', label: 'إعدادات مراحل البيع', icon: Settings, perm: 'crm.manage_statuses' },
    ] },
  // تذاكر خدمة العملاء (§1.35) — لوحة المتابعة؛ نموذج الإدخال السريع على /ticket (شاشة مستقلة)
  { id: 'support',         path: '/support',         label: 'خدمة العملاء', icon: LifeBuoy, section: 'customers', navOrder: 40, permKey: 'support.view' },
  { id: 'marketers',       path: '/marketers',       label: 'المسوّقون والعمولات', icon: BadgeDollarSign, section: 'customers', navOrder: 60, permKey: 'marketers.view' },
  { id: 'zoho-data',       path: '/zoho-data',       label: 'زوهو: الفواتير والربط', icon: BookOpen,   section: 'money', navOrder: 60, permKey: 'zoho.view',
    subTabs: [
      { tabId: 'overview',  label: 'مراقبة اتصال زوهو',       icon: Activity },
      { tabId: 'customers', label: 'العملاء والفواتير',       icon: Users },
      { tabId: 'vendors',   label: 'الموردون والمصروفات',     icon: Briefcase },
      { tabId: 'banks',     label: 'البنوك والمطابقة',        icon: Landmark, legacyTabIds: ['bank_accounts'] },
      { tabId: 'accounts',  label: 'القيود ودليل الحسابات',   icon: BookOpen },
    ] },
  { id: 'reconciliation',  path: '/reconciliation',  label: 'مطابقة زوهو', icon: GitCompare, section: 'money', navOrder: 70, permKey: 'reconciliation.view' },

  // ── الحملات والاتصالات — ضمن رحلة العملاء والنمو ────────────────
  { id: 'whatsapp-settings', path: '/whatsapp-settings', label: 'الحملات والاتصالات', icon: MessageCircle, section: 'customers', navOrder: 50,
    permAny: ['whatsapp.view_log', 'whatsapp.configure', 'campaigns.ivr'],
    subTabs: [
      { tabId: 'overview',  label: 'نظرة عامة',       icon: Activity },
      { tabId: 'campaigns', label: 'الحملات والرسائل', icon: MessageCircle },
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
  { id: 'operations', path: '/operations', label: 'مركز التكاملات والتشغيل', icon: Activity, section: 'outreach', navOrder: 15,
    permAny: ['agents.view', 'system.view_audit_log', 'uploads.view', 'zoho.view', 'whatsapp.view_log', 'webhook.view'],
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
const SECTION_ICONS = { Truck, Users, Target, DollarSign, FileCheck, Settings };
const NAV_SECTIONS = NAV_SECTION_MODEL.map(section => ({
  ...section,
  icon: SECTION_ICONS[section.icon] || Layers,
}));

function groupNavItems(sectionId, items, compact) {
  if (compact) return [{ id: `${sectionId}-all`, label: '', items }];

  const definitions = NAV_GROUP_MODEL[sectionId] || [];
  const buckets = new Map(definitions.map(group => [group.id, []]));
  const ungrouped = [];
  for (const item of items) {
    const bucket = buckets.get(item.navGroup);
    if (bucket) bucket.push(item);
    else ungrouped.push(item);
  }

  const groups = definitions
    .map(group => ({ ...group, items: buckets.get(group.id) || [] }))
    .filter(group => group.items.length > 0);
  if (ungrouped.length > 0) groups.push({ id: `${sectionId}-other`, label: 'أخرى', items: ungrouped });
  return groups;
}
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
// /money hosts cod-settlements / payments / bank
// as four tabs. Legacy paths land on the right tab automatically.
const MONEY_HUB_PATHS = ['/money', '/cod-settlements', '/payments', '/bank'];
const REPORTS_WORKSPACE_PATHS = ['/reports', '/monthly-report', '/internal-exports'];

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
// **فارغة الآن**: بوابة التاجر للدفع أُلغيت بالكامل (2026-07-29، قرار
// المستخدم) — التحصيل يتم عبر حملات واتساب والتحويل البنكي المباشر.
// أي سطح عام جديد يُضاف هنا ويُوثَّق سبب كونه عاماً.
const PUBLIC_PATHS = [];

function AppShell(props) {
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
  const KNOWN_PATHS = ['/hub','/carrier','/carriers','/contracts','/upload','/results','/audits','/bank','/aramex-statements','/ledger','/cod-settlements','/payments','/receivables','/merchants','/customers','/customer-360','/weight-billing','/internal-exports','/carrier-kpi','/activity-log','/webhook','/employees','/tasks','/segments','/periods','/forecast','/overview','/reconciliation','/uploads','/money','/collections','/monthly-report','/drop','/cash-aging','/integrity','/claims','/decisions','/crm','/fulfillment','/reports','/zoho-callback','/pnl','/zoho-data','/customer-money','/legal','/retargeting','/whatsapp-settings','/hatif-leads','/support','/marketers','/platform-carriers','/next-actions','/work-agents','/operations','/accounting-cycle'];
  const isKnownPath = KNOWN_PATHS.includes(pathname) || isSettingsPath;

  const [carriers,        setCarriers]        = useState([]);
  const [carriersLoading, setCarriersLoading] = useState(false);
  // على اللابتوب/التابلت الأفقي كان الشريط الكامل يترك قرابة 600px فقط
  // للمحتوى. ابدأ مصغّراً بين 769–1100px، مع بقاء زر التوسيع متاحاً.
  const [collapsed,       setCollapsed]       = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(min-width: 769px) and (max-width: 1100px)').matches
  ));
  const [mobileOpen,      setMobileOpen]      = useState(false);
  const [mobileNavLevel,  setMobileNavLevel]  = useState('centers');
  const [selectedSectionId, setSelectedSectionId] = useState('');
  const [pendingAudit,    setPendingAudit]    = useState(null);
  // الجانبية الأساسية للمراكز فقط. اختيار مركز يفتح جانبية سياقية للصفحات
  // التابعة له، وعلى الجوال ينتقل الدرج إلى المستوى الثاني مع زر رجوع واضح.
  // Command palette (Ctrl/Cmd+K) — instant jump to any page or carrier
  // screen, so buried sections and carrier-page hopping aren't a chore.
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 769px) and (max-width: 1100px)');
    const onViewport = (event) => setCollapsed(event.matches);
    mq.addEventListener?.('change', onViewport);
    return () => mq.removeEventListener?.('change', onViewport);
  }, []);
  useEffect(() => {
    const routeItem = NAV_ITEMS.find(item => (
      item.path === rawPath || item.subTabs?.some(tab => tab.legacy === rawPath)
    ));
    setSelectedSectionId(routeItem?.section || '');
  }, [rawPath]);
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
    setMobileNavLevel('centers');
  };

  const visibleSubTabsFor = (item) => (item.subTabs || []).filter(tab => {
    if (tab.adminOnly && !isAdmin) return false;
    return isAdmin
      || (tab.anyPerm ? tab.anyPerm.some(permission => can(permission)) : (!tab.perm || can(tab.perm)));
  });

  const subTabPath = (item, tab) => (
    tab.legacy || `${item.path}?tab=${encodeURIComponent(tab.tabId)}`
  );

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

  // «/ticket» — نموذج تذكرة الدعم السريع (§1.35): شاشة كاملة بلا قائمة جانبية.
  // خلف بوابة الدخول (ليس عاماً) — رابط مباشر يحفظه فريق خدمة العملاء.
  if (pathname === '/ticket') return <TicketForm/>;

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

  const currentNavItem = visibleNav.find(item => activeFor(item));
  const currentSubTab = currentNavItem ? subTabOf(currentNavItem) : null;
  const currentSection = NAV_SECTIONS.find(section => section.id === currentNavItem?.section);
  const currentGroup = (NAV_GROUP_MODEL[currentSection?.id] || [])
    .find(group => group.id === currentNavItem?.navGroup);
  const currentContextTabs = currentNavItem ? visibleSubTabsFor(currentNavItem) : [];
  const contextSection = NAV_SECTIONS.find(section => section.id === (selectedSectionId || currentSection?.id));
  const contextItems = contextSection
    ? visibleNav.filter(item => item.section === contextSection.id)
      .sort((a, b) => (a.navOrder ?? 999) - (b.navOrder ?? 999))
    : [];
  const contextGroups = contextSection ? groupNavItems(contextSection.id, contextItems, false) : [];
  const accountingStageId = location.pathname === '/accounting-cycle'
    ? new URLSearchParams(location.search).get('stage')
    : null;
  const accountingStages = ACCOUNTING_CYCLE_STAGES.filter(stage => isAdmin || can(stage.permission));
  const hasContextSidebar = Boolean(contextSection && contextItems.length);
  const currentContextValue = accountingStageId
    ? `/accounting-cycle?stage=${encodeURIComponent(accountingStageId)}`
    : (currentSubTab
      && (location.pathname !== currentNavItem?.path || new URLSearchParams(location.search).has('tab'))
      ? subTabPath(currentNavItem, currentSubTab)
      : (currentNavItem?.path || ''));
  const currentTitle = currentSubTab?.label
    ?? currentNavItem?.label
    ?? PAGE_TITLES[location.pathname]
    ?? (location.pathname.startsWith('/settings') ? 'الإعدادات' : 'لمحة');

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

      <div className={`app-layout${hasContextSidebar ? ' has-context-sidebar' : ''}`}>

        {/* ═══════════════ SIDEBAR ═══════════════ */}
        <aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>

          {/* الجانبية داكنة في الثيمين، لذلك يبقى الشعار الأبيض ثابتاً وواضحاً. */}
          <div className="sidebar-logo">
            {collapsed ? (
              <LamhaMark size={32}/>
            ) : (
              <div className="sidebar-brand-lockup">
                <span className="sidebar-brand-logo sidebar-brand-logo--desktop">
                  <LamhaLogo height={36} variant="white"/>
                </span>
                <span className="sidebar-brand-logo sidebar-brand-logo--mobile">
                  <LamhaLogo height={36} variant="color"/>
                </span>
                <div className="sidebar-product-label">
                  <span className="live-dot"/>
                  <span>
                    منصة العمليات المالية
                  </span>
                </div>
              </div>
            )}
            {mobileOpen && <strong className="sidebar-mobile-title">{mobileNavLevel === 'context' ? contextSection?.label : 'المراكز'}</strong>}
            {mobileOpen && (
              <button className="sidebar-close" aria-label="إغلاق القائمة" onClick={() => setMobileOpen(false)}>
                <X size={20}/>
              </button>
            )}
          </div>

          {/* المستوى الأول: مراكز فقط. الصفحات تنتقل إلى الجانبية السياقية. */}
          <nav className={`sidebar-nav${mobileNavLevel === 'context' ? ' is-mobile-context' : ''}`}>
            <div className="primary-center-nav">
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

            {/* مراكز العمل — لا أقسام فرعية داخل الجانبية الأساسية. */}
            {NAV_SECTIONS.map((sec) => {
              const items = visibleNav
                .filter(n => n.section === sec.id)
                .sort((a, b) => (a.navOrder ?? 999) - (b.navOrder ?? 999));
              if (!items.length) return null;
              const sectionHasActive = contextSection?.id === sec.id;
              const SecIcon = sec.icon;
              return (
                <button
                  key={sec.id}
                  type="button"
                  className={`primary-center-item${sectionHasActive ? ' active' : ''}`}
                  aria-current={sectionHasActive ? 'true' : undefined}
                  title={collapsed ? sec.label : undefined}
                  onClick={() => {
                    setSelectedSectionId(sec.id);
                    setMobileNavLevel('context');
                  }}
                >
                  <span className="primary-center-item__icon" style={{ '--center-accent': sec.accent }}><SecIcon size={18}/></span>
                  {!collapsed && <span><strong>{sec.label}</strong><small>{sec.hint}</small></span>}
                  {!collapsed && <ChevronLeft size={15}/>}
                </button>
              );
            })}
            </div>

            <div className="mobile-context-navigation">
              <button type="button" className="mobile-context-back" onClick={() => setMobileNavLevel('centers')}>
                <ChevronRight size={16}/> العودة إلى المراكز
              </button>
              <ContextSectionNavigation
                groups={contextGroups}
                currentNavItem={currentNavItem}
                currentContextTabs={currentContextTabs}
                currentSubTab={currentSubTab}
                accountingStages={accountingStages}
                accountingStageId={accountingStageId}
                onNavigate={goto}
                subTabPath={subTabPath}
              />
            </div>
          </nav>

          {/* Footer */}
          <div className="sidebar-footer">
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
                <button onClick={signOut} title="تسجيل خروج" aria-label="تسجيل الخروج" style={{
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

          <button
            type="button"
            className="sidebar-toggle"
            aria-label={collapsed ? 'توسيع القائمة الجانبية' : 'تصغير القائمة الجانبية'}
            onClick={() => setCollapsed(c => !c)}
          >
            {collapsed ? <ChevronLeft size={12}/> : <ChevronRight size={12}/>}
          </button>
        </aside>

        {/* ═══════════════ MAIN ═══════════════ */}
        {hasContextSidebar && (
          <aside className="context-sidebar" aria-label={`صفحات ${contextSection.label}`}>
            <header className="context-sidebar__header">
              <span className="context-sidebar__eyebrow">مركز عمل</span>
              <h2>{contextSection.label}</h2>
              <p>{contextSection.hint}</p>
            </header>
            <ContextSectionNavigation
              groups={contextGroups}
              currentNavItem={currentNavItem}
              currentContextTabs={currentContextTabs}
              currentSubTab={currentSubTab}
              accountingStages={accountingStages}
              accountingStageId={accountingStageId}
              onNavigate={goto}
              subTabPath={subTabPath}
            />
          </aside>
        )}

        <main className="app-main">

          {/* Topbar */}
          <div className="topbar">
            <button className="hamburger-btn" aria-label="فتح القائمة" onClick={() => { setMobileNavLevel('centers'); setMobileOpen(true); }}>
              <Menu size={20}/>
            </button>

            <div className="topbar-route">
              {(currentSection || currentGroup) && (
                <div className="topbar-breadcrumb" aria-label="مسار الصفحة">
                  {currentSection && <span>{currentSection.label}</span>}
                  {currentSection && currentGroup && <ChevronLeft size={12} aria-hidden="true"/>}
                  {currentGroup && <span>{currentGroup.label}</span>}
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

          {hasContextSidebar && (
            <div className="context-mobile-nav">
              <span>داخل {contextSection.label}</span>
              <select
                aria-label={`داخل ${contextSection.label}`}
                value={currentContextValue}
                onChange={(event) => goto(event.target.value)}
              >
                {contextGroups.map(group => (
                  <optgroup key={group.id} label={group.label || contextSection.label}>
                    {group.items.flatMap(item => {
                      const tabs = visibleSubTabsFor(item);
                      const options = [
                        <option key={item.path} value={item.path}>{item.label}</option>,
                      ];
                      for (const tab of tabs) {
                        const path = subTabPath(item, tab);
                        if (path !== item.path) {
                          options.push(<option key={`${item.id}-${tab.tabId}`} value={path}>↳ {tab.label}</option>);
                        }
                      }
                      if (item.id === 'accounting-cycle') {
                        accountingStages.forEach((stage, index) => {
                          const path = `/accounting-cycle?stage=${encodeURIComponent(stage.id)}`;
                          options.push(<option key={`${item.id}-${stage.id}`} value={path}>↳ {index + 1}. {stage.label}</option>);
                        });
                      }
                      return options;
                    })}
                  </optgroup>
                ))}
              </select>
            </div>
          )}

          {/* ── Pages ── */}
          {/* All pages permanently mounted — visibility:hidden instead of display:none
              prevents CSS animations from replaying on every navigation */}
          <div className="page-content">

            <PageSlot active={pathname==='/decisions'} scroll>
              <DecisionsBoard isActive={pathname==='/decisions'}/>
            </PageSlot>
            <PageSlot active={pathname==='/work-agents'} scroll>
              <WorkAgents isActive={pathname==='/work-agents'}/>
            </PageSlot>
            <PageSlot active={pathname==='/operations'} scroll>
              <OperationsCenter isActive={pathname==='/operations'}/>
            </PageSlot>
            <PageSlot active={pathname==='/uploads'} scroll>
              <UploadsHub isActive={pathname==='/uploads'}/>
            </PageSlot>
            <PageSlot active={pathname==='/integrity'} scroll>
              <IntegrityCheck isActive={pathname==='/integrity'}/>
            </PageSlot>
            <PageSlot active={pathname==='/activity-log'} scroll>
              <ActivityLog isActive={pathname==='/activity-log'}/>
            </PageSlot>
            <PageSlot active={pathname==='/accounting-cycle'} scroll>
              <AccountingCycle carriers={carriers} isActive={pathname==='/accounting-cycle'}/>
            </PageSlot>

            {/* المسار القديم كان يكرر التحصيل والمبيعات في قائمة واحدة غامضة.
                نحتفظ بالرابط فقط، ونرسله إلى قائمة المبيعات اليومية القانونية. */}
            {pathname === '/next-actions' && (
              <Navigate to="/retargeting?tab=today" replace/>
            )}
            {/* /hub + /carrier-kpi + /claims all render this workspace;
                CarriersWorkspace reads ?tab= or the legacy path to pick
                the right inner tab (cards / KPIs / claims). */}
            <PageSlot active={CARRIER_WORKSPACE_PATHS.includes(pathname)} scroll>
              <CarriersWorkspace carriers={carriers} isActive={CARRIER_WORKSPACE_PATHS.includes(pathname)}/>
            </PageSlot>
            <PageSlot active={pathname==='/carrier'} scroll>
              <CarrierProfile/>
            </PageSlot>
            {/* صفحات الإعدادات مستقلة: القائمة الجانبية هي نقطة التنقل الوحيدة،
                فلا نكررها كشريط تبويبات غير متوافق داخل صفحة شركات الشحن. */}
            <PageSlot active={pathname==='/carriers'} scroll>
              <CarrierManager carriers={carriers} setCarriers={setCarriers} onCarriersChange={reloadCarriers}/>
            </PageSlot>
            <PageSlot active={pathname==='/contracts'} scroll>
              <ContractsOverview isActive={pathname==='/contracts'}/>
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
            <PageSlot active={pathname==='/audits'} scroll>
              <AuditsHistory onOpen={handleOpenAudit} isActive={pathname==='/audits'}/>
            </PageSlot>
            <PageSlot active={pathname==='/aramex-statements'} scroll>
              <CarrierStatements carriers={carriers}/>
            </PageSlot>
            <PageSlot active={REPORTS_WORKSPACE_PATHS.includes(pathname)} scroll>
              <CenterWorkspace
                scope="reports-center"
                title="التقارير"
                subtitle="التقارير المالية والتشغيلية والملفات المصدّرة"
                tone="#22C55E"
                activePath={pathname}
                onNavigate={navigate}
                tabs={[
                  ...(isAdmin || can('reports.view_operational') || can('reports.view_financial') || can('reports.view_bank_reconciliation') ? [
                    { id: 'reports', path: '/reports', label: 'التقارير', icon: FileText, render: () => <ReportsCenter isActive={pathname==='/reports'}/> },
                  ] : []),
                  ...(isAdmin || can('reports.view_operational') ? [
                    { id: 'monthly', path: '/monthly-report', label: 'التقرير الشهري', icon: CalendarRange, render: () => <MonthlyReport isActive={pathname==='/monthly-report'}/> },
                  ] : []),
                  ...(isAdmin || can('internal_exports.view') ? [{ id: 'exports', path: '/internal-exports', label: 'الملفات المصدّرة', icon: Download, render: () => <InternalExports carriers={carriers} isActive={pathname==='/internal-exports'}/> }] : []),
                ]}
              />
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
            <PageSlot active={pathname==='/settings/hatif'} scroll>
              <WhatsAppSettings isActive={pathname==='/settings/hatif'} settingsOnly/>
            </PageSlot>
            <PageSlot active={pathname==='/support'} scroll>
              <SupportBoard isActive={pathname==='/support'}/>
            </PageSlot>
            <PageSlot active={pathname==='/marketers'} scroll>
              <Marketers isActive={pathname==='/marketers'}/>
            </PageSlot>
            <PageSlot active={pathname==='/zoho-data'} scroll>
              <ZohoData isActive={pathname==='/zoho-data'}/>
            </PageSlot>
            <PageSlot active={pathname==='/pnl'} scroll>
              <FinancialPosition isActive={pathname==='/pnl'}/>
            </PageSlot>
            <PageSlot active={pathname==='/drop'} scroll>
              <SmartDrop carriers={carriers}/>
            </PageSlot>
            <PageSlot active={pathname==='/cash-aging'} scroll>
              <CashAging isActive={pathname==='/cash-aging'}/>
            </PageSlot>
            {/* /claims now renders inside CarriersWorkspace (claims tab) above */}
            <PageSlot active={pathname==='/ledger'} scroll>
              <CarrierLedger isActive={pathname==='/ledger'}/>
            </PageSlot>
            <PageSlot active={pathname==='/platform-carriers'} scroll>
              <PlatformCarriers isActive={pathname==='/platform-carriers'}/>
            </PageSlot>
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
            <PageSlot active={pathname==='/weight-billing'} scroll>
              <WeightBilling carriers={carriers} isActive={pathname==='/weight-billing'}/>
            </PageSlot>
            <PageSlot active={pathname==='/webhook'} scroll>
              <WebhookEvents carriers={carriers} isActive={pathname==='/webhook'}/>
            </PageSlot>
            <PageSlot active={pathname==='/tasks'} scroll>
              <Tasks carriers={carriers} isActive={pathname==='/tasks'}/>
            </PageSlot>
            <PageSlot active={isSettingsPath && pathname!=='/settings/hatif'} scroll>
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
  // ── (١) لا تُنشأ الصفحة قبل أول زيارة (2026-07-28) ──
  // كانت الـ41 صفحة تُركَّب كلها عند أول تحميل — عمل ضخم قبل ظهور أي شيء.
  // الآن الصفحة تُركَّب عند أول تنشيط فقط، ثم تبقى (يُحفظ سلوك keep-alive:
  // الحالة والتمرير والبيانات المحمَّلة لا تضيع عند التنقّل).
  const seen = useRef(false);
  if (active) seen.current = true;

  // ── (٢) تجميد المحتوى غير النشط ──
  // كل تنقّل يغيّر `location` فيُعاد رسم AppInner ومعه كل الصفحات المركَّبة
  // (props جديدة لكل PageSlot). بالاحتفاظ بمرجع آخر children رُسمت وهي نشطة،
  // يرى React نفس عنصر JSX للصفحات الخاملة فيتخطّى إعادة رسمها كلياً.
  const frozen = useRef(children);
  if (active) frozen.current = children;
  const content = active ? children : frozen.current;
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

// ── Helpers ───────────────────────────────────────────────────────────────────
function ContextSectionNavigation({
  groups,
  currentNavItem,
  currentContextTabs,
  currentSubTab,
  accountingStages,
  accountingStageId,
  onNavigate,
  subTabPath,
}) {
  return (
    <nav className="context-sidebar__nav">
      {groups.map(group => (
        <section className="context-nav-group" key={group.id} aria-label={group.label}>
          {group.label && <h3>{group.label}</h3>}
          {group.items.map(item => {
            const active = currentNavItem?.id === item.id;
            const Icon = item.icon || FileText;
            const tabs = active ? currentContextTabs : [];
            const showStages = active && item.id === 'accounting-cycle';
            return (
              <div className={`context-page-entry${active ? ' active' : ''}`} key={item.id}>
                <button
                  type="button"
                  className={`context-nav-item${active ? ' active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => onNavigate(item.path)}
                >
                  <span className="context-nav-item__icon"><Icon size={17}/></span>
                  <span>{item.label}</span>
                  <ChevronLeft className="context-nav-item__arrow" size={15}/>
                </button>
                {active && tabs.length > 1 && (
                  <div className="context-subnav" aria-label={`داخل ${item.label}`}>
                    {tabs.map(tab => {
                      const TabIcon = tab.icon || Icon;
                      const tabActive = currentSubTab?.tabId === tab.tabId;
                      return (
                        <button
                          key={tab.tabId}
                          type="button"
                          className={tabActive ? 'active' : ''}
                          onClick={() => onNavigate(subTabPath(item, tab))}
                        >
                          <TabIcon size={14}/><span>{tab.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {showStages && (
                  <div className="context-subnav accounting-stage-nav" aria-label="مراحل الدورة المحاسبية">
                    {accountingStages.map((stage, index) => {
                      const stageActive = accountingStageId === stage.id || (!accountingStageId && index === 0);
                      return (
                        <button
                          key={stage.id}
                          type="button"
                          className={stageActive ? 'active' : ''}
                          onClick={() => onNavigate(`/accounting-cycle?stage=${encodeURIComponent(stage.id)}`)}
                        >
                          <b>{index + 1}</b><span>{stage.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </nav>
  );
}

function NavBtn({ n, active, ancestorActive = false, accent, collapsed, onClick, nested, expandable, expanded, onToggleExpand }) {
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
            color: (active || ancestorActive) && accent ? accent : 'var(--muted)', cursor: 'pointer',
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

// نستخدمها عندما يكون الوصول للتاب نفسه جزءاً من العمل اليومي، مثل ملف العملاء.

// «تحصيل العملاء» — شاشة التحصيل الأولى (زوهو API المرجع، جوال أولاً).
// سؤال واحد تجيبه: كم لي بالخارج، وعند مَن، وكيف أحصّله الآن؟
// مصدر الحقيقة الواحد: RPC customer_money_dashboard() (قاعدة «رقم واحد
// لكل مفهوم» 2026-07-03) — نفس أرقام /zoho-data ومتابعة العملاء.
// كل بطاقة عميل فيها 📞 اتصال و💬 واتساب مباشرين + فواتيره بنقرة.

import { lazy, Suspense, useState, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Search, Download, Phone, MessageCircle, ChevronDown, ChevronLeft, HandCoins,
  TrendingUp, PhoneCall, Scale, Megaphone, ListChecks } from 'lucide-react';
import * as XLSX from 'xlsx';
import { persistAndDownloadExport } from '../lib/internalExportsService.js';
import { Card, Btn, Spinner, Empty, toast, PageHeader, Modal, Input, WorkspaceLoadingState } from '../components/UI.jsx';
import DataConfidenceBar from '../components/DataConfidenceBar.jsx';
import { useAuth } from '../lib/auth.jsx';
import { loadCustomerMoneyDashboard, loadCustomerCollectibleLines, loadZohoOpenInvoices, zohoStatusAr, loadZohoUnusedCredits,
  planZohoApplyCredits, applyZohoCredits, getZohoWriteAuthUrl, syncZohoDocs } from '../lib/pnlService.js';
import { normalizeSaudiPhone, loadMorningBriefConfig, saveMorningBriefConfig,
  previewMorningBrief, sendMorningBriefNow, loadWhatsAppCampaignStatus, loadTemplateSentSet } from '../lib/whatsappService.js';
import { assignCollectionTasks, listTasks, loadCollectionAssignmentCandidates, STAGE_LABELS } from '../lib/collectionsService.js';
import WhatsAppSendModal from '../components/WhatsAppSendModal.jsx';
import { describeCollectionAgingFilter } from '../lib/tahseelPortalTemplate.js';
import IvrCallButton from '../components/IvrCallButton.jsx';
import CustomerCallLog from '../components/CustomerCallLog.jsx';
import CustomerCommTimeline from '../components/CustomerCommTimeline.jsx';
import TagButton from '../components/TagButton.jsx';
import AgingOperationsQueue from '../components/operations/AgingOperationsQueue.jsx';
import {
  AGING_PAGE_SIZE, buildAgingRows, buildCampaignAgingProjection, evaluateBulkEligibility, saveAudienceHandoff,
} from '../lib/agingOperations.js';
import {
  CUSTOMER_CAMPAIGN_BUCKETS,
  INVOICE_CAMPAIGN_BUCKETS,
  OPENING_CAMPAIGN_BUCKET,
  campaignBucketAmount,
  campaignBucketLabel,
  selectedCampaignAmount,
} from '../lib/customerCampaignBuckets.js';
import { loadCustomerActivationCommandCenter } from '../lib/retargetingService.js';
import './CustomerFinanceCenter.css';
import useMobileLayout from '../lib/useMobileLayout.js';
import { useWindowedRows } from '../hooks/useWindowedRows.js';
import { ProgressiveListFooter } from '../components/MobileUX.jsx';

const fmt = (n) => (n == null || Number.isNaN(n)) ? '—'
  : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtK = (n) => { const a = Math.abs(n); return a >= 1000 ? (n / 1000).toFixed(1) + 'ك' : String(Math.round(n)); };
const fmtDate = (d) => { if (!d) return ''; try { return new Date(d).toLocaleDateString('ar-SA', { day: 'numeric', month: 'short' }); } catch { return String(d).slice(0, 10); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LamhaFinancialAccountReview = lazy(() => import('../components/LamhaFinancialAccountReview.jsx'));

const BUCKETS = CUSTOMER_CAMPAIGN_BUCKETS;

const platformStatusKey = (customer) => {
  const raw = String(customer?.platformStatus || '').trim().toLowerCase();
  if (raw === 'نشط' || raw === 'active') return 'active';
  if (raw === 'غير نشط' || raw === 'inactive') return 'inactive';
  return 'unknown';
};

const platformStatusMeta = (customer) => {
  const key = platformStatusKey(customer);
  if (key === 'active') return { key, label: 'نشط في المنصّة', color: 'var(--green)' };
  if (key === 'inactive') return { key, label: 'غير نشط في المنصّة', color: 'var(--muted)' };
  return { key, label: 'حالة المنصّة غير متوفرة', color: 'var(--gold)' };
};

export default function CustomerMoney({ isActive = true }) {
  const { can, user, isAdmin } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [applyTarget, setApplyTarget] = useState(null);   // { zohoId, name } عند فتح مودال التطبيق
  const [d, setD] = useState(null);
  const [viewUpdatedAt, setViewUpdatedAt] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [collectionTasks, setCollectionTasks] = useState([]);
  const [collectionTaskError, setCollectionTaskError] = useState(false);
  const [agingLines, setAgingLines] = useState([]);
  const [agingLinesError, setAgingLinesError] = useState(false);
  const [agingLinesReady, setAgingLinesReady] = useState(false);
  const [collectionAssignees, setCollectionAssignees] = useState([]);
  const [growthPulse, setGrowthPulse] = useState({ status: 'idle', data: null, error: null });
  const [q, setQ] = useState(() => searchParams.get('search') || searchParams.get('customer') || searchParams.get('q') || '');
  const [buckets, setBuckets] = useState(() => {
    const allowed = new Set(BUCKETS.map(bucket => bucket.key));
    return new Set((searchParams.get('aging') || '').split(',').filter(key => allowed.has(key)));
  });   // شرائح الأعمار المختارة (متعددة) — فارغ = كل الدين
  const toggleBucket = (key) => setBuckets(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    const params = new URLSearchParams(searchParams);
    if (next.size) params.set('aging', [...next].join(','));
    else params.delete('aging');
    params.delete('page');
    setSearchParams(params);
    return next;
  });
  const clearBuckets = () => {
    const params = new URLSearchParams(searchParams);
    params.delete('aging');
    params.delete('page');
    setSearchParams(params);
    setBuckets(new Set());
  };
  const [sortBy, setSortBy] = useState(() => searchParams.get('sort') === 'oldest' ? 'oldest' : 'owed');
  const [platformFilter, setPlatformFilter] = useState(() => ['active', 'inactive', 'unknown'].includes(searchParams.get('status')) ? searchParams.get('status') : 'all');
  const [selectedAging, setSelectedAging] = useState(() => new Set());
  const [bulkAction, setBulkAction] = useState(null);
  const [bulkAssignee, setBulkAssignee] = useState('');
  const [waOpen, setWaOpen] = useState(false);
  const [waSingle, setWaSingle] = useState(null);          // مستلِم واحد عند «واتساب» من البطاقة
  const [waStatus, setWaStatus] = useState(() => new Map()); // حالة آخر حملة لكل هاتف
  const [busy, setBusy] = useState(false);
  const [syncingZoho, setSyncingZoho] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const [credits, setCredits] = useState(null);   // أرصدة دائنة غير مستخدمة
  const [creditsState, setCreditsState] = useState({ status: 'idle', error: null });
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [settlementsOpen, setSettlementsOpen] = useState(true);
  const [bulkOpen, setBulkOpen] = useState(false);   // مودال «طبّق للكل»
  const [lamhaPolicyOpen, setLamhaPolicyOpen] = useState(false);
  const dashboardRefreshInFlightRef = useRef(false);
  const lastDashboardRefreshAtRef = useRef(0);
  const resetCredits = () => {
    setCredits(null);
    setCreditsState({ status: 'idle', error: null });
  };

  useEffect(() => {
    const customer = searchParams.get('search') || searchParams.get('customer') || searchParams.get('q');
    setQ(customer || '');
    const allowed = new Set(BUCKETS.map(bucket => bucket.key));
    setBuckets(new Set((searchParams.get('aging') || '').split(',').filter(key => allowed.has(key))));
    setSortBy(searchParams.get('sort') === 'oldest' ? 'oldest' : 'owed');
    setPlatformFilter(['active', 'inactive', 'unknown'].includes(searchParams.get('status')) ? searchParams.get('status') : 'all');
    setUnclaimedOnly(searchParams.get('source') === 'unclaimed');
  }, [searchParams]);

  const updateUrlFilters = (patch, { replace = false } = {}) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (value == null || value === '' || value === false || value === 'all') next.delete(key);
      else next.set(key, String(value));
    }
    next.delete('customer');
    next.delete('q');
    setSearchParams(next, { replace });
  };

  const refresh = async () => {
    if (dashboardRefreshInFlightRef.current) return;
    dashboardRefreshInFlightRef.current = true;
    setBusy(true);
    setLoadError(null);
    try {
      const canViewTasks = can('collections.view');
      const canReadAssignees = can('collections.assign');
      const [dashboard, tasks, assignees, collectibleLines] = await Promise.all([
        loadCustomerMoneyDashboard(),
        canViewTasks ? listTasks().catch(() => null) : Promise.resolve([]),
        canReadAssignees ? loadCollectionAssignmentCandidates().catch(() => []) : Promise.resolve([]),
        loadCustomerCollectibleLines().catch(() => null),
      ]);
      setD(dashboard);
      setViewUpdatedAt(new Date().toISOString());
      if (tasks !== null) setCollectionTasks(tasks);
      setCollectionTaskError(tasks === null);
      setCollectionAssignees(assignees);
      if (collectibleLines !== null) {
        setAgingLines(collectibleLines);
        setAgingLinesReady(true);
      }
      setAgingLinesError(collectibleLines === null);
    } catch (e) {
      setLoadError(e);
      toast(`فشل التحميل: ${e.message}`, 'error');
    } finally {
      lastDashboardRefreshAtRef.current = Date.now();
      dashboardRefreshInFlightRef.current = false;
      setBusy(false);
    }
  };
  const handleSyncZoho = async () => {
    setSyncingZoho(true);
    try {
      const res = await syncZohoDocs();
      const count = res?.results?.invoices;
      const reused = res?.cached || res?.reused_recent_sync || res?.reused_same_window || res?.reused_client_sync;
      toast(reused
        ? 'بيانات زوهو حديثة بالفعل؛ تم تحديث العرض دون طلب جديد'
        : count != null ? `تمت مزامنة فواتير زوهو: ${count}` : 'تمت مزامنة زوهو', 'success');
      resetCredits();
      await refresh();
    } catch (e) {
      toast(`فشلت مزامنة زوهو: ${e.message}`, 'error');
    } finally {
      setSyncingZoho(false);
    }
  };
  // بطاقة العميل تجمع زوهو مع أحدث snapshot للمتاجر. أبقِها حديثة عند
  // الرجوع للتبويب/المتصفح، ومع إعادة تحقق خفيفة أثناء بقاء الصفحة مفتوحة؛
  // وإلا قد تظل حالة «نشط» من snapshot سابق بعد رفع ملف متاجر أحدث.
  useEffect(() => {
    if (!isActive) return undefined;
    refresh();
    const refreshIfStale = () => {
      if (document.visibilityState === 'hidden') return;
      if (Date.now() - lastDashboardRefreshAtRef.current < 60_000) return;
      refresh();
    };
    window.addEventListener('focus', refreshIfStale);
    document.addEventListener('visibilitychange', refreshIfStale);
    const intervalId = window.setInterval(refreshIfStale, 120_000);
    return () => {
      window.removeEventListener('focus', refreshIfStale);
      document.removeEventListener('visibilitychange', refreshIfStale);
      window.clearInterval(intervalId);
    };
  }, [isActive]); // eslint-disable-line react-hooks/exhaustive-deps
  // حالة آخر حملة واتساب لكل عميل (تحميل كسول + بعد كل إرسال)
  const loadWaStatus = () => loadWhatsAppCampaignStatus().then(setWaStatus).catch(() => {});
  useEffect(() => { if (isActive) loadWaStatus(); }, [isActive]); // eslint-disable-line
  // مَن وصله قالب المطالبة (sadad) يوماً — لفلتر «لم تصلهم مطالبة» (فحص الوكلاء:
  // 29 من 40 مديناً بهاتف لم يُطالَبوا قط). يُعاد تحميله بعد كل إرسال.
  const [sadadSet, setSadadSet] = useState(() => new Set());
  const [unclaimedOnly, setUnclaimedOnly] = useState(() => searchParams.get('source') === 'unclaimed');
  const loadSadad = () => loadTemplateSentSet('sadad').then(setSadadSet).catch(() => {});
  useEffect(() => { if (isActive) loadSadad(); }, [isActive]); // eslint-disable-line

  // Progressive load: customer money is the primary content. Platform
  // activity starts only after that content is available, avoiding another
  // request on the critical path while still giving Finance one customer view.
  useEffect(() => {
    if (!isActive || !d || growthPulse.status !== 'idle') return undefined;
    let cancelled = false;
    setGrowthPulse({ status: 'loading', data: null, error: null });
    loadCustomerActivationCommandCenter(5, 500, 24)
      .then(data => { if (!cancelled) setGrowthPulse({ status: 'available', data, error: null }); })
      .catch(error => { if (!cancelled) setGrowthPulse({ status: 'unavailable', data: null, error: error.message }); });
    return () => {
      cancelled = true;
      setGrowthPulse(current => current.status === 'loading'
        ? { status: 'idle', data: null, error: null }
        : current);
    };
    // growthPulse.status is deliberately not a dependency: changing idle to
    // loading must not cancel the request that is responsible for resolving it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, isActive]);
  // فتح حملة لعميل واحد من زر «واتساب» في بطاقته
  // مبلغ التحصيل لكل عميل = مجموع الشرائح المختارة فقط (أو كامل الدين إن لم تُختَر شريحة).
  // فحملة على شريحة 61–90 ترسل مبلغ تلك الشريحة لا كامل دين العميل.
  const campaignProjection = useMemo(() => buildCampaignAgingProjection(
    agingLines,
    (d?.customers || []).map(customer => customer.zohoId),
  ), [agingLines, d]);
  const campaignAging = agingLinesReady ? campaignProjection.totals : (d?.campaignAging || {});
  const campaignCustomer = (customer) => {
    const projected = agingLinesReady
      ? campaignProjection.byContact.get(String(customer.zohoId || '').trim())
      : null;
    return projected ? { ...customer, ...projected } : customer;
  };
  const bandAmt = (c) => {
    return selectedCampaignAmount(campaignCustomer(c), buckets);
  };
  // أعمدة التحصيل المتاحة لربط متغيرات القالب ديناميكياً (مودال الإرسال)
  const collectionFields = (c, amt = c.owed) => ({
    name: (c.storeName || c.name || '').trim(), amount: amt, full_amount: c.owed,
    filtered_overdue_amount: amt,
    aging_filter: describeCollectionAgingFilter([...buckets], c.oldestDays),
    count: c.invCnt,
    overdue: c.overdue, oldest_days: c.oldestDays, wallet: c.walletBalance,
    last_shipment: c.lastShipmentAt, last_payment: c.lastPaymentDate,
  });
  const openSingleWa = (c) => {
    if (c.balanceSyncIssue) {
      toast('هذا العميل محجوب مؤقتاً: رصيد Zoho لا يطابق الفواتير المستوردة. أعد مزامنة Zoho أولاً.', 'error');
      return;
    }
    const name = (c.storeName || c.name || '').trim();
    const amt = bandAmt(c);
    setWaSingle({
      to: normalizeSaudiPhone(c.phone), name, amount: amt, count: c.invCnt,
      vars: [name, Number(amt).toLocaleString('en-US', { maximumFractionDigits: 2 }), String(c.invCnt)],
      fields: collectionFields(c, amt),
    });
    setWaOpen(true);
  };
  // أرصدة دائنة غير مستخدمة (تحميل كسول مرة واحدة)
  useEffect(() => {
    if (!isActive || credits != null || creditsState.status === 'loading' || creditsState.status === 'unavailable') return;
    setCreditsState({ status: 'loading', error: null });
    loadZohoUnusedCredits()
      .then((result) => {
        setCredits(result);
        setCreditsState({ status: 'fresh', error: null });
      })
      .catch((error) => {
        setCredits(null);
        setCreditsState({ status: 'unavailable', error: error?.message || 'تعذرت القراءة' });
      });
  }, [isActive, credits, creditsState.status]);
  // منح صلاحية الكتابة (invoices.UPDATE) لمرة واحدة — يفتح موافقة زوهو
  const grantWriteAccess = async () => {
    const r = await getZohoWriteAuthUrl();
    if (r?.ok && r.url) {
      toast('تُفتح صفحة موافقة زوهو — اضغط Accept. القراءة تبقى كما هي + صلاحية تطبيق فقط.', 'info');
      window.open(r.url, '_blank', 'noopener');
    } else toast(`تعذّر فتح الموافقة: ${r?.error || 'غير معروف'}`, 'error');
  };

  const filtered = useMemo(() => {
    if (!d) return [];
    let list = d.customers;
    if (buckets.size) list = list.filter(c => bandAmt(c) > 0.5);
    if (platformFilter !== 'all') list = list.filter(c => platformStatusKey(c) === platformFilter);
    // «لم تصلهم مطالبة» = له هاتف ولم يصله قالب sadad قط
    if (unclaimedOnly) list = list.filter(c => c.phone && !sadadSet.has(normalizeSaudiPhone(c.phone)));
    const s = q.trim().toLowerCase();
    if (s) list = list.filter(c =>
      [c.name, c.storeName, c.phone].some(v => String(v ?? '').toLowerCase().includes(s)));
    return [...list].sort((a, b) => sortBy === 'oldest' ? b.oldestDays - a.oldestDays : bandAmt(b) - bandAmt(a));
  }, [d, q, buckets, platformFilter, sortBy, unclaimedOnly, sadadSet, campaignProjection, agingLinesReady]);  // eslint-disable-line
  const filteredTotal = useMemo(() => +filtered.reduce((s, c) => s + bandAmt(c), 0).toFixed(2), [filtered, buckets]);  // eslint-disable-line
  const isMobile = useMobileLayout();
  const {
    visible: visibleCustomerRows,
    count: visibleCustomerCount,
    total: visibleCustomerTotal,
    hasMore: hasMoreCustomers,
    sentinelRef: customerRowsSentinelRef,
    loadMore: loadMoreCustomers,
  } = useWindowedRows(filtered, { batch: isMobile ? 20 : 120 });
  const collectionTaskByCustomer = useMemo(() => {
    const rank = { promised: 4, contacted: 3, snoozed: 2, todo: 1 };
    const indexed = new Map();
    for (const task of collectionTasks) {
      const current = indexed.get(task.customer_name);
      if (!current || (rank[task.stage] || 0) > (rank[current.stage] || 0)) {
        indexed.set(task.customer_name, task);
      }
    }
    return indexed;
  }, [collectionTasks]);
  const collectionAssigneeById = useMemo(
    () => new Map(collectionAssignees.map(employee => [employee.id, employee.name])),
    [collectionAssignees],
  );
  const agingFilterState = useMemo(() => ({
    aging: buckets,
    search: searchParams.get('search') || '',
    minAmount: searchParams.get('minAmount') || '',
    maxAmount: searchParams.get('maxAmount') || '',
    owner: searchParams.get('owner') || 'all',
    collection: searchParams.get('collection') || 'all',
    promise: searchParams.get('promise') || 'all',
    contact: searchParams.get('contact') || 'all',
    sort: searchParams.get('sort') || 'amount',
    actionOnly: searchParams.get('action') === 'needed',
  }), [buckets, searchParams]);
  const allAgingRows = useMemo(() => buildAgingRows({
    customers: d?.customers || [], lines: agingLines, buckets,
    taskByCustomer: collectionTaskByCustomer, assigneeById: collectionAssigneeById,
    communicationByPhone: waStatus,
  }), [d, agingLines, buckets, collectionTaskByCustomer, collectionAssigneeById, waStatus]);
  const agingRows = useMemo(() => {
    const today = new Date().toLocaleDateString('en-CA');
    const now = Date.now();
    const min = agingFilterState.minAmount === '' ? null : Number(agingFilterState.minAmount);
    const max = agingFilterState.maxAmount === '' ? null : Number(agingFilterState.maxAmount);
    const needle = agingFilterState.search.trim().toLowerCase();
    const list = allAgingRows.filter(row => {
      const { customer, task, summary } = row;
      if (needle && ![customer.storeName, customer.storeId, customer.zohoId, customer.name]
        .some(value => String(value || '').toLowerCase().includes(needle))) return false;
      if (min != null && summary.amount < min) return false;
      if (max != null && summary.amount > max) return false;
      if (agingFilterState.owner === 'unassigned' && task?.assigned_to) return false;
      if (!['all', 'unassigned'].includes(agingFilterState.owner) && task?.assigned_to !== agingFilterState.owner) return false;
      if (agingFilterState.collection === 'no_task' && task) return false;
      if (!['all', 'no_task'].includes(agingFilterState.collection) && task?.stage !== agingFilterState.collection) return false;
      if (agingFilterState.promise === 'today' && task?.promise_date !== today) return false;
      if (agingFilterState.promise === 'overdue' && !(task?.promise_date && task.promise_date < today)) return false;
      if (agingFilterState.promise === 'none' && task?.promise_date) return false;
      const contactAt = row.lastCommunicationAt ? new Date(row.lastCommunicationAt).getTime() : null;
      if (agingFilterState.contact === 'none' && contactAt) return false;
      if (agingFilterState.contact === '7d' && (!contactAt || now - contactAt > 7 * 86_400_000)) return false;
      if (agingFilterState.contact === '30d' && (!contactAt || now - contactAt > 30 * 86_400_000)) return false;
      if (agingFilterState.actionOnly) {
        const actionable = !task || !task.assigned_to || task.stage !== 'snoozed'
          || !task.snooze_until || new Date(task.snooze_until).getTime() <= now;
        if (!actionable) return false;
      }
      return true;
    });
    return [...list].sort((a, b) => {
      if (agingFilterState.sort === 'oldest') return b.summary.oldestDays - a.summary.oldestDays;
      if (agingFilterState.sort === 'promise') return String(a.task?.promise_date || '9999').localeCompare(String(b.task?.promise_date || '9999'));
      if (agingFilterState.sort === 'last_contact') return String(b.lastCommunicationAt || '').localeCompare(String(a.lastCommunicationAt || ''));
      return b.summary.amount - a.summary.amount;
    });
  }, [allAgingRows, agingFilterState]);
  const agingPage = Math.max(1, Number(searchParams.get('page')) || 1);
  const agingPageRows = useMemo(() => agingRows.slice((agingPage - 1) * AGING_PAGE_SIZE, agingPage * AGING_PAGE_SIZE), [agingRows, agingPage]);
  const agingFilteredTotal = useMemo(() => +agingRows.reduce((sum, row) => sum + row.summary.amount, 0).toFixed(2), [agingRows]);
  const agingDetailsTotal = useMemo(() => +allAgingRows.reduce((sum, row) => sum + row.summary.amount, 0).toFixed(2), [allAgingRows]);
  const agingDashboardTotal = useMemo(() => {
    if (!d) return 0;
    if (!buckets.size) return +Number(d.outstanding || 0).toFixed(2);
    return +[...buckets].reduce((sum, key) => sum + Number(campaignAging?.[key] || 0), 0).toFixed(2);
  }, [d, buckets, campaignAging]);
  const agingReconciliation = useMemo(() => ({
    detailsTotal: agingDetailsTotal,
    dashboardTotal: agingDashboardTotal,
    ok: !agingLinesError && Math.abs(agingDetailsTotal - agingDashboardTotal) <= 0.01,
  }), [agingDetailsTotal, agingDashboardTotal, agingLinesError]);
  const platformCounts = useMemo(() => {
    const counts = { all: 0, active: 0, inactive: 0, unknown: 0 };
    for (const customer of d?.customers || []) {
      counts.all += 1;
      counts[platformStatusKey(customer)] += 1;
    }
    return counts;
  }, [d]);

  useEffect(() => {
    const visibleKeys = new Set(agingRows.map(row => row.identityKey));
    setSelectedAging(current => {
      const next = new Set([...current].filter(key => visibleKeys.has(key)));
      return next.size === current.size ? current : next;
    });
  }, [agingRows]);

  const handleAgingFilter = (key, value) => {
    if (key === 'agingToggle') {
      toggleBucket(value);
      return;
    }
    if (key === 'clearSecondary') {
      updateUrlFilters({
        minAmount: null, maxAmount: null, owner: null, collection: null,
        promise: null, contact: null, sort: null, action: null, page: null,
      });
      return;
    }
    const urlKey = key === 'actionOnly' ? 'action' : key;
    updateUrlFilters({ [urlKey]: key === 'actionOnly' ? (value ? 'needed' : null) : value, page: null }, { replace: key === 'search' });
  };
  const toggleAgingSelection = key => setSelectedAging(current => {
    const next = new Set(current);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });
  const toggleAgingPage = checked => setSelectedAging(current => {
    if (!checked) return new Set();
    const next = new Set(current);
    agingPageRows.forEach(row => next.add(row.identityKey));
    return next;
  });
  const allAgingSelected = agingRows.length > 0 && agingRows.every(row => selectedAging.has(row.identityKey));
  const toggleAllAgingResults = checked => setSelectedAging(
    checked ? new Set(agingRows.map(row => row.identityKey)) : new Set(),
  );
  const openStoreFromAging = (row, invoice = false) => {
    if (!row.customer.storeId) {
      toast('لا يمكن فتح Store 360 قبل وجود Store ID مؤكد لهذا الحساب المالي.', 'info');
      return;
    }
    const returnTo = `${location.pathname}${location.search}`;
    const params = new URLSearchParams({
      customer: row.customer.storeId,
      open: '1',
      view: 'finance',
      source: 'aging',
      returnTo,
    });
    if (buckets.size) params.set('aging', [...buckets].join(','));
    if (invoice) params.set('invoice', 'bucket');
    navigate(`/customer-360?${params.toString()}`);
  };
  const selectedAgingRows = useMemo(() => agingRows.filter(row => selectedAging.has(row.identityKey)), [agingRows, selectedAging]);
  const bulkPermissions = useMemo(() => ({
    canAssign: can('collections.assign'), canCampaign: can('campaigns.send'), canIvr: can('campaigns.ivr'),
  }), [can]);
  const bulkReview = useMemo(
    () => evaluateBulkEligibility(selectedAgingRows, bulkAction, bulkPermissions),
    [selectedAgingRows, bulkAction, bulkPermissions],
  );
  const eligibleBulkRows = useMemo(() => bulkReview.filter(row => row.eligible), [bulkReview]);
  const openBulkReview = action => {
    if (!selectedAging.size) return;
    if (!agingReconciliation.ok && action !== 'export') {
      toast('توقفت الإجراءات: مبلغ الشريحة لا يطابق تفاصيلها بالهللة.', 'error');
      return;
    }
    setBulkAssignee('');
    setBulkAction(action);
  };
  const handoffContext = (channel, rows) => ({
    version: 1,
    source: 'aging_operations',
    channel,
    aging: [...buckets],
    filters: Object.fromEntries([...searchParams.entries()].filter(([key]) => key !== 'page')),
    snapshotAt: viewUpdatedAt || new Date().toISOString(),
    count: rows.length,
    totalAmount: +rows.reduce((sum, row) => sum + row.summary.amount, 0).toFixed(2),
    selectionKeys: rows.map(row => row.identityKey),
    returnTo: `${location.pathname}${location.search}`,
  });
  const confirmBulkAction = async () => {
    if (!eligibleBulkRows.length) return;
    if (bulkAction === 'assign') {
      if (!bulkAssignee) return toast('اختر المحصل قبل تنفيذ الإسناد', 'info');
      try {
        const result = await assignCollectionTasks(eligibleBulkRows.map(row => row.task.id), bulkAssignee);
        toast(`أُسندت ${result.updated || 0} مهمة تحصيل`, 'success');
        setBulkAction(null); setSelectedAging(new Set()); await refresh();
      } catch (error) { toast(`تعذر الإسناد: ${error.message}`, 'error'); }
      return;
    }
    if (bulkAction === 'export') {
      await exportXlsx(eligibleBulkRows.map(row => row.customer), 'Aging_المحدد');
      setBulkAction(null);
      return;
    }
    const context = handoffContext(bulkAction, eligibleBulkRows);
    const token = saveAudienceHandoff(context);
    setBulkAction(null);
    if (bulkAction === 'followup') {
      navigate(`/collections?view=queue&batchContext=${encodeURIComponent(token)}&returnTo=${encodeURIComponent(context.returnTo)}`);
      return;
    }
    navigate(`/campaigns?audienceContext=${encodeURIComponent(token)}&channel=${bulkAction === 'ivr' ? 'ivr' : 'whatsapp'}&step=5&returnTo=${encodeURIComponent(context.returnTo)}`);
  };

  // مرّر كل نتائج الفلتر إلى نافذة الحملة، بما فيها الصف بلا هاتف. نافذة
  // الإرسال هي بوابة الأهلية الوحيدة وتشرح سبب كل استبعاد بدل إسقاطه صامتاً.
  const waRecipients = useMemo(() => filtered
    .filter(c => bandAmt(c) > 0.5)
    .map(c => {
      const name = (c.storeName || c.name || '').trim();
      const amt = bandAmt(c);
      return {
        to: normalizeSaudiPhone(c.phone), name, storeId: c.storeId || null, amount: amt, count: c.invCnt,
        financialHold: !!c.balanceSyncIssue,
        vars: [name, Number(amt).toLocaleString('en-US', { maximumFractionDigits: 2 }), String(c.invCnt)],
        fields: collectionFields(c, amt),
      };
    }), [filtered, buckets, campaignProjection, agingLinesReady]);  // eslint-disable-line

  const openFocusedCampaign = () => {
    if (!buckets.size) {
      document.getElementById('collection-campaign-segments')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast('اختر شريحة فواتير متأخرة أو الرصيد الافتتاحي أولاً حتى تكون الحملة مركزة.', 'info');
      return;
    }
    if (waRecipients.length) setWaOpen(true);
    else toast('لا عملاء مؤهلين في الشريحة المختارة', 'info');
  };

  // ملف الحملة — زوهو المرجع للدين + سياق المتجر (هاتف/نوع فوترة/حالة/محفظة/آخر
  // شحنة) للفريق. يمرّ عبر persistAndDownloadExport (تخزين + سجل السحبات، §1.13).
  const exportXlsx = async (exportRows = filtered, exportLabel = null) => {
    if (!exportRows.length) return;
    const campLabel = buckets.size ? 'مبلغ الشرائح المختارة' : 'مبلغ التحصيل';
    // «رقم المتجر» = معرّفه في نظام لمحة — يسبق الاسم لأنه المفتاح الذي
    // يُبحَث به في المنصّة الداخلية (الاسم قد يتكرّر بين متجرين §1.53).
    const headers = ['العميل', 'رقم المتجر', 'المتجر', 'الهاتف', 'نوع الفوترة', 'الحالة في المنصّة',
      'الرصيد المدين في زوهو', 'الرصيد الدائن المقابل', 'المطلوب تحصيله', 'متأخر',
      'فواتير', 'أقدم استحقاق (يوم)', '1-15', '16-30', '31-60', '61-90', '+90 فواتير فقط', 'رصيد افتتاحي', 'المحفظة', 'آخر شحنة', 'آخر دفعة', 'مبلغها', campLabel];
    const grossTotal = +exportRows.reduce((s, c) => s + (c.grossDue || 0), 0).toFixed(2);
    const creditTotal = +exportRows.reduce((s, c) => s + (c.creditOffset || 0), 0).toFixed(2);
    const owedTotal = +exportRows.reduce((s, c) => s + (c.owed || 0), 0).toFixed(2);
    const exportSelectedTotal = +exportRows.reduce((s, c) => s + bandAmt(c), 0).toFixed(2);
    const aoa = [
      ['تحصيل العملاء — زوهو API المرجع', '', new Date().toISOString().slice(0, 10)],
      buckets.size ? [`الشرائح المختارة: ${campaignBucketLabel(buckets)} — «مبلغ الشرائح المختارة» هو مجموع هذه الشرائح فقط`] : [],
      headers,
      ...exportRows.map(c => {
        const bucketed = campaignCustomer(c);
        return [c.name, c.storeId || '', c.storeName || '', c.phone || '', c.billingType || '', c.platformStatus || '',
          c.grossDue, c.creditOffset, c.owed, c.overdue, c.invCnt, c.oldestDays, bucketed.inv1_15, bucketed.inv16_30,
          bucketed.inv31_60, bucketed.inv61_90, bucketed.inv90p, bucketed.opening,
          c.walletBalance || 0, c.lastShipmentAt ? new Date(c.lastShipmentAt).toLocaleDateString('en-CA') : '',
          c.lastPaymentDate || '', c.lastPaymentAmount || '', bandAmt(c)];
      }),
      [],
      ['الإجمالي', ...Array(5).fill(''), grossTotal, creditTotal, owedTotal, ...Array(headers.length - 10).fill(''), exportSelectedTotal],
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // 0 = العميل · 1 = رقم المتجر (ضيّق) · 2 = اسم المتجر
    ws['!cols'] = headers.map((_, i) => ({ wch: i === 0 ? 32 : i === 1 ? 10 : i === 2 ? 24 : 12 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'تحصيل العملاء');
    try {
      await persistAndDownloadExport({
        wb, fileName: `${exportLabel || 'تحصيل_العملاء'}_${new Date().toISOString().slice(0, 10)}.xlsx`,
        kind: 'zoho_campaign', rowCount: exportRows.length, total: exportSelectedTotal, userId: user?.id || null,
      });
      toast(`صُدّر ${exportRows.length} عميلاً ✓ (محفوظ في سجل السحبات)`, 'success');
    } catch (e) { toast(`فشل التصدير: ${e.message}`, 'error'); }
  };

  if (!can('receivables.view')) return <div style={{ padding: 40 }}><Empty icon="🔒" title="لا صلاحية" sub="تحتاج صلاحية «عرض المديونيات»"/></div>;
  if (d == null && loadError) return (
    <div className="customer-money-page workspace-page">
      <PageHeader icon={<HandCoins size={22}/>} iconColor="var(--green)"
        title="تحصيل العملاء"
        subtitle="تعذّر جلب مديونيات زوهو — لم نعرض قائمة فارغة حتى لا تُفهم أن الديون صفر"/>
      <div className="data-load-error" role="alert">
        <HandCoins size={22}/>
        <div>
          <strong>تعذّر الوصول إلى بيانات التحصيل</strong>
          <span>{loadError.message || 'تحقق من الاتصال ثم أعد المحاولة.'}</span>
        </div>
        <Btn size="sm" variant="ghost" onClick={refresh}>إعادة المحاولة</Btn>
      </div>
    </div>
  );
  if (d == null) return (
    <div className="customer-money-page workspace-page">
      <PageHeader icon={<HandCoins size={22}/>} iconColor="var(--green)"
        title="تحصيل العملاء"
        subtitle="زوهو API هو المرجع — كم لك بالخارج وكيف تحصّله الآن"/>
      <WorkspaceLoadingState title="جارٍ تحميل أرصدة العملاء" source="Zoho Books API" rows={2}/>
    </div>
  );

  const invoiceCampaignTotal = INVOICE_CAMPAIGN_BUCKETS.reduce((s, b) => s + (campaignAging?.[b.key] || 0), 0) || 1;
  const colDelta = d.collectedPrevMonth > 0
    ? Math.round(((d.collectedThisMonth - d.collectedPrevMonth) / d.collectedPrevMonth) * 100) : null;

  // أرصدة دائنة: قابل للتطبيق (رصيد + فاتورة مفتوحة) مقابل «رصيد قائم» (بلا فواتير)
  const applicableRows = (credits?.rows || []).filter(r => r.applicable > 0.5);
  const standingCount = (credits?.rows?.length || 0) - applicableRows.length;
  const growth = growthPulse.data || {};
  const growthCurrent = growth.current || {};
  const currentReturnTo = `${location.pathname}${location.search}`;
  const openWithContext = (path) => {
    const [pathname, query = ''] = path.split('?');
    const params = new URLSearchParams(query);
    params.set('returnTo', currentReturnTo);
    navigate(`${pathname}?${params.toString()}`);
  };
  const scrollToAging = () => document.querySelector('.aging-operations')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const guideCollectionCampaign = () => {
    const target = document.getElementById('collection-campaign-segments');
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => target?.focus({ preventScroll: true }), 250);
    toast('اختر شريحة، ثم حدّد النتائج، وبعدها اضغط «Draft حملة» لمراجعة الجمهور دون إرسال مباشر.', 'info');
  };

  const campaignSegmentsPanel = (
    <Card style={{ padding: '16px 18px', marginBottom: 12 }}>
      <div id="collection-campaign-segments" tabIndex={-1} aria-label="اختيار شريحة حملة التحصيل" style={{ scrollMarginTop: 90, outline: 'none' }}>
        <div style={{ marginBottom: 9 }}>
          <strong style={{ display: 'block', fontSize: 13, color: 'var(--text)' }}>فلتر شرائح السداد</strong>
          <span style={{ display: 'block', marginTop: 3, fontSize: 11.5, color: 'var(--muted)' }}>
            اختر شريحة أو أكثر؛ فترات الأيام تخص الفواتير المتأخرة فقط
          </span>
        </div>
        <div className="collection-aging-overview" style={{ display: 'flex', height: 26, borderRadius: 8, overflow: 'hidden', cursor: 'pointer' }}>
          {INVOICE_CAMPAIGN_BUCKETS.map(b => {
            const v = campaignAging?.[b.key] || 0;
            const pct = Math.max((v / invoiceCampaignTotal) * 100, v > 0.5 ? 6 : 0);
            if (pct === 0) return null;
            const active = buckets.has(b.key);
            return (
              <button type="button" key={b.key} title={`${b.label}: ${fmt(v)} ر.س`}
                onClick={() => toggleBucket(b.key)}
                aria-pressed={active}
                style={{ width: `${pct}%`, border: 0, background: b.color, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', color: '#fff', fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap',
                  overflow: 'hidden', outline: active ? '2.5px solid var(--text)' : 'none', outlineOffset: -2 }}>
                {pct > 12 ? `${b.label} · ${fmtK(v)}` : ''}
              </button>
            );
          })}
        </div>
        <div className="collection-aging-options" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 6, alignItems: 'center' }}>
          {INVOICE_CAMPAIGN_BUCKETS.map(b => (
            <button type="button" key={b.key} onClick={() => toggleBucket(b.key)}
              aria-pressed={buckets.has(b.key)}
              className="collection-aging-option"
              style={{ border: 0, background: 'transparent', fontSize: 10.5, color: buckets.has(b.key) ? 'var(--text)' : 'var(--muted)', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', padding: '6px 4px',
                fontWeight: buckets.has(b.key) ? 800 : 500 }}>
              <input type="checkbox" checked={buckets.has(b.key)} readOnly
                aria-hidden="true" tabIndex={-1}
                style={{ verticalAlign: 'middle', marginInlineEnd: 4, pointerEvents: 'none' }}/>
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: b.color, marginInlineEnd: 4 }}/>
              {b.label}: {fmt(campaignAging?.[b.key] || 0)}
            </button>
          ))}
        </div>
        <button type="button"
          onClick={() => toggleBucket(OPENING_CAMPAIGN_BUCKET.key)}
          aria-pressed={buckets.has(OPENING_CAMPAIGN_BUCKET.key)}
          style={{ marginTop: 8, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            padding: '10px 12px', borderRadius: 9, cursor: 'pointer', textAlign: 'right',
            border: `1.5px solid ${buckets.has(OPENING_CAMPAIGN_BUCKET.key) ? 'var(--accent3)' : 'var(--border)'}`,
            background: buckets.has(OPENING_CAMPAIGN_BUCKET.key) ? 'color-mix(in srgb, var(--accent3) 10%, transparent)' : 'var(--surface2)',
            color: buckets.has(OPENING_CAMPAIGN_BUCKET.key) ? 'var(--accent3)' : 'var(--text2)' }}>
          <span><b>رصيد افتتاحي غير مدفوع</b><small style={{ display: 'block', marginTop: 2, color: 'var(--muted)' }}>شريحة مستقلة ولا تدخل ضمن «أكثر من 90 يوم»</small></span>
          <strong style={{ whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}>{fmt(campaignAging?.opening || 0)} ر.س</strong>
        </button>
        {buckets.size > 0 && (
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div>
              <strong style={{ display: 'block', fontSize: 11.5 }}>المحدد: {campaignBucketLabel(buckets)}</strong>
              <span style={{ display: 'block', marginTop: 3, color: 'var(--muted)', fontSize: 10.5 }}>
                {filtered.length} عميل · {fmt(filteredTotal)} ر.س من الشرائح المختارة فقط
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {can('campaigns.send') && (
                <Btn size="sm" variant="accent" icon={<MessageCircle size={13}/>} onClick={openFocusedCampaign}>
                  مراجعة الحملة
                </Btn>
              )}
              <button type="button" onClick={clearBuckets} style={{ border: 0, background: 'transparent', fontSize: 10.5, color: 'var(--accent)', cursor: 'pointer', fontWeight: 700 }}>✕ مسح التحديد</button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );

  return (
    <div className="customer-money-page workspace-page">
      <PageHeader icon={<HandCoins size={22}/>} iconColor="var(--green)"
        title="مركز العملاء المالي"
        subtitle="الرصيد والنشاط والتحصيل والتواصل — افتح العميل مرة واحدة ونفّذ الإجراء من نفس السياق"/>

      <section className="customer-finance-command" aria-label="مركز إجراءات مال العملاء">
        <div className="customer-finance-command__head">
          <div><span>القرار الآن</span><h2>من يحتاج تحصيلًا أو تواصلًا اليوم؟</h2><p>Zoho للأرقام المالية · لمحة للنشاط · هاتف وWhatsApp وIVR للتنفيذ.</p></div>
          <div className="customer-finance-command__source"><i className={growthPulse.status === 'available' ? 'is-live' : ''}/>{growthPulse.status === 'loading' ? 'جارٍ تحميل نشاط لمحة' : growthPulse.status === 'available' ? 'المصادر متاحة' : 'نشاط لمحة غير متاح'}</div>
        </div>
        <div className="customer-finance-command__kpis">
          <button type="button" onClick={scrollToAging}><ListChecks/><span>فواتير زوهو غير المدفوعة</span><strong>{d.zohoUnpaidInvoicesAvailable ? fmt(d.zohoUnpaidInvoices) : '—'} ر.س</strong><small>{d.zohoUnpaidInvoicesAvailable ? 'نفس إجمالي الفواتير في Aging · دون المسودات' : 'المصدر غير متاح'}</small></button>
          <button type="button" onClick={() => setSettlementsOpen(true)}><Scale/><span>أرصدة دائنة</span><strong>− {fmt(d.creditOffset)} ر.س</strong><small>تُخصم قبل مطالبة العميل</small></button>
          <button type="button" onClick={scrollToAging}><HandCoins/><span>صافي المطلوب تحصيله</span><strong>{fmt(d.outstanding)} ر.س</strong><small>{d.outstandingCnt} عميلًا</small></button>
          <button type="button" onClick={() => updateUrlFilters({ aging: 'inv90p', page: null })}><Scale/><span>أكثر من 90 يومًا</span><strong>{fmt(campaignAging?.inv90p || 0)} ر.س</strong><small>فتح الشريحة</small></button>
          <button type="button" onClick={() => openWithContext('/retargeting?view=activation')}><TrendingUp/><span>نشطون خلال 5 أيام</span><strong>{growthPulse.status === 'available' ? growthCurrent.active ?? 0 : '—'}</strong><small>{growthPulse.status === 'available' ? `الهدف ${growthCurrent.target || 500}` : 'المصدر غير متاح'}</small></button>
          <button type="button" onClick={() => openWithContext('/reconciliation?tab=customers')}><ListChecks/><span>فروق المطابقة</span><strong>{d.balanceSyncIssueCount || 0}</strong><small>{d.balanceSyncIssueCount ? `${fmt(d.balanceSyncGapTotal)} ر.س` : 'لا فروق محجوبة'}</small></button>
        </div>
        <div className="customer-finance-command__actions" role="toolbar" aria-label="إجراءات سريعة">
          <Btn variant="accent" onClick={scrollToAging} icon={<HandCoins size={15}/>}>ابدأ التحصيل</Btn>
          {can('campaigns.send') ? <Btn variant="ghost" onClick={guideCollectionCampaign} icon={<Megaphone size={15}/>}>جهّز حملة تحصيل</Btn> : null}
          {isAdmin ? <Btn variant="ghost" onClick={() => setLamhaPolicyOpen(true)} icon={<ListChecks size={15}/>}>ضبط حسابات لمحة</Btn> : null}
          <details className="customer-finance-command__more-actions">
            <summary>إجراءات أخرى</summary>
            <div className="customer-finance-command__more-actions-body">
              <Btn variant="ghost" onClick={() => openWithContext('/whatsapp-settings?tab=campaigns&source=customer-finance')} icon={<MessageCircle size={15}/>}>هاتف وWhatsApp</Btn>
              {can('campaigns.ivr') ? <Btn variant="ghost" onClick={() => openWithContext('/whatsapp-settings?tab=ivr&source=customer-finance')} icon={<PhoneCall size={15}/>}>مراجعة IVR</Btn> : null}
              <Btn variant="ghost" onClick={() => openWithContext('/retargeting?view=today&source=customer-finance')} icon={<TrendingUp size={15}/>}>عملاء لمحة اليوم</Btn>
              <Btn variant="ghost" onClick={() => openWithContext('/reconciliation?tab=customers&source=customer-finance')} icon={<Scale size={15}/>}>مطابقة الأرصدة</Btn>
            </div>
          </details>
        </div>
        {d.zohoDraftCount > 0 ? (
          <button type="button" className="customer-finance-command__drafts" onClick={() => openWithContext('/zoho-data?tab=customers&status=draft')}>
            <ListChecks size={16}/>
            <span><strong>{d.zohoDraftCount} فاتورة مسودة في زوهو</strong><small>قيمتها {fmt(d.zohoDraftOutstanding)} ر.س · لا تدخل إجمالي الفواتير غير المدفوعة حتى تتحول إلى مرسلة</small></span>
            <ChevronLeft size={17}/>
          </button>
        ) : null}
        {growthPulse.status === 'unavailable' ? <div className="customer-finance-command__warning" role="status">تعذر تحميل نشاط عملاء لمحة: {growthPulse.error}. بقيت الأرقام المالية وإجراءات التحصيل متاحة.</div> : null}
      </section>

      <AgingOperationsQueue
        rows={agingPageRows}
        totalRows={agingRows.length}
        totalAmount={agingFilteredTotal}
        filters={agingFilterState}
        onFilter={handleAgingFilter}
        assignees={collectionAssignees}
        selected={selectedAging}
        onToggle={toggleAgingSelection}
        onTogglePage={toggleAgingPage}
        onToggleAll={toggleAllAgingResults}
        allResultsSelected={allAgingSelected}
        page={agingPage}
        onPage={(value) => updateUrlFilters({ page: value <= 1 ? null : value })}
        onOpen={row => openStoreFromAging(row, false)}
        onInvoices={row => openStoreFromAging(row, true)}
        onBulk={openBulkReview}
        reconciliation={agingReconciliation}
        sourceHealthy={!agingLinesError && !loadError}
        sourceUpdatedAt={viewUpdatedAt}
        campaignPanel={campaignSegmentsPanel}
      />

      {loadError && (
        <div className="data-load-error is-inline" role="status">
          <HandCoins size={17}/>
          <div>
            <strong>التحديث الأخير لم يكتمل</strong>
            <span>ما زالت آخر بيانات ناجحة ظاهرة ويمكن إعادة المحاولة بأمان.</span>
          </div>
          <Btn size="sm" variant="ghost" onClick={refresh}>حاول مجدداً</Btn>
        </div>
      )}

      <DataConfidenceBar
        active={isActive}
        sourceLabel="Zoho Books API"
        viewUpdatedAt={viewUpdatedAt}
        canSync={can?.('money.pnl')}
        syncing={syncingZoho}
        refreshing={busy}
        onSync={handleSyncZoho}
        onRefresh={() => { resetCredits(); refresh(); }}
        sourcePath="/zoho-data?type=invoices"
      />

      {d.balanceSyncIssueCount > 0 && (
        <div className="data-load-error is-inline" role="alert">
          <HandCoins size={17}/>
          <div>
            <strong>توقفت المطالبة عن {d.balanceSyncIssueCount} عميل لحماية الأرقام</strong>
            <span>
              يوجد فرق قدره {fmt(d.balanceSyncGapTotal)} ر.س بين رصيد Zoho والفواتير المستوردة.
              لن يدخل هؤلاء العملاء الحملات أو الوكلاء حتى تكتمل المصالحة.
            </span>
          </div>
          <Btn size="sm" variant="ghost" onClick={handleSyncZoho} disabled={syncingZoho}>
            {syncingZoho ? 'جارٍ إصلاح الفواتير…' : 'إصلاح ومصالحة الآن'}
          </Btn>
        </div>
      )}

      {can('collections.view') && collectionTaskError && (
        <div className="data-load-error is-inline" role="status">
          <HandCoins size={17}/>
          <div>
            <strong>الأرصدة محمّلة، لكن مسؤوليات التحصيل لم تُحمّل</strong>
            <span>الأرقام المالية سليمة في هذا العرض؛ أعد التحديث لإظهار المسؤول والإجراء التالي.</span>
          </div>
          <Btn size="sm" variant="ghost" onClick={refresh}>إعادة تحميل المسؤوليات</Btn>
        </div>
      )}

      {/* ── البطل: كم لك بالخارج ── */}
      <div className="customer-money-hero">
      <Card style={{ padding: '18px 20px', marginBottom: 12 }}>
        <div className="hero-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 14 }}>
          <div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>فواتير زوهو غير المدفوعة</div>
            <div className="customer-money-kpi-value" title={d.zohoUnpaidInvoicesAvailable ? `${fmt(d.zohoUnpaidInvoices)} ر.س` : 'مصدر Zoho غير متاح'} style={{ fontSize: 26, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--text)', lineHeight: 1.2 }}>
              {d.zohoUnpaidInvoicesAvailable ? fmt(d.zohoUnpaidInvoices) : 'المصدر غير متاح'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted2)' }}>نفس إجمالي تقرير Aging في زوهو · لا يشمل المسودات</div>
          </div>
          <div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>أرصدة دائنة</div>
            <div className="customer-money-kpi-value" title={`${fmt(d.creditOffset)} ر.س`} style={{ fontSize: 26, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--green)', lineHeight: 1.2 }}>
              − {fmt(d.creditOffset)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted2)' }}>
              مبالغ لصالح العملاء تُخصم قبل المطالبة
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>💰 المطلوب تحصيله</div>
            <div className="customer-money-kpi-value" title={`${fmt(d.outstanding)} ر.س`} style={{ fontSize: 30, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--gold)', lineHeight: 1.2 }}>
              {fmt(d.outstanding)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted2)' }}>{d.outstandingCnt} عميلاً يدخلون حملات التحصيل</div>
          </div>
          <div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>⏰ منها متأخّرة</div>
            <div className="customer-money-kpi-value" title={`${fmt(d.overdueAmt)} ر.س`} style={{ fontSize: 30, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--red)', lineHeight: 1.2 }}>
              {fmt(d.overdueAmt)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted2)' }}>تجاوزت موعد السداد</div>
          </div>
          <div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>✅ حصّلنا هذا الشهر</div>
            <div className="customer-money-kpi-value" title={`${fmt(d.collectedThisMonth)} ر.س`} style={{ fontSize: 30, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--green)', lineHeight: 1.2 }}>
              {fmt(d.collectedThisMonth)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted2)' }}>
              الشهر الماضي {fmtK(d.collectedPrevMonth)}{colDelta != null ? ` (${colDelta >= 0 ? '+' : ''}${colDelta}%)` : ''}
            </div>
          </div>
        </div>

        {d.zohoUnpaidInvoicesAvailable ? (
          <div className="customer-money-equation" role="status">
            <span><b>{fmt(d.zohoUnpaidInvoices)}</b> فواتير غير مدفوعة</span>
            <span>{Number(d.zohoOpeningAndAdjustments || 0) >= 0 ? '+' : '−'} <b>{fmt(Math.abs(d.zohoOpeningAndAdjustments || 0))}</b> رصيد افتتاحي/تسويات</span>
            <span>− <b>{fmt(d.creditOffset)}</b> أرصدة دائنة</span>
            <strong>= {fmt(d.outstanding)} ر.س صافي التحصيل</strong>
          </div>
        ) : null}

      </Card>
      </div>

      {d.settlements.length > 0 && (
        <Card style={{ padding: 0, marginBottom: 12, overflow: 'hidden',
          border: '1.5px solid color-mix(in srgb, var(--gold) 38%, var(--border))' }}>
          <button type="button" onClick={() => setSettlementsOpen(v => !v)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
              background: 'color-mix(in srgb, var(--gold) 8%, transparent)', border: 0, cursor: 'pointer', textAlign: 'right' }}>
            <span style={{ fontSize: 18 }}>⚖️</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 800 }}>تسويات زوهو المطلوبة ({d.settlementCount})</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                مدين ودائن لنفس العميل بقيمة {fmt(d.settlementTotal)} ر.س — مستبعدة من حملات التحصيل حتى تتم التسوية
              </div>
            </div>
            <ChevronDown size={16} style={{ transform: settlementsOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}/>
          </button>
          {settlementsOpen && (
            <div style={{ padding: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(280px,100%),1fr))', gap: 8,
              borderTop: '1px solid var(--border)' }}>
              {d.settlements.map(row => (
                <div key={row.name} style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface2)' }}>
                  <div style={{ fontWeight: 800, fontSize: 12.5, marginBottom: 8 }}>{row.storeName || row.name}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '5px 12px', fontSize: 11.5 }}>
                    <span style={{ color: 'var(--muted)' }}>الرصيد المدين</span><b style={{ fontFamily: 'var(--font-mono)' }}>{fmt(row.grossDue)}</b>
                    <span style={{ color: 'var(--muted)' }}>الرصيد الدائن المقابل</span><b style={{ fontFamily: 'var(--font-mono)', color: 'var(--green)' }}>− {fmt(row.creditOffset)}</b>
                    <span style={{ color: 'var(--muted)' }}>المطلوب تحصيله</span><b style={{ fontFamily: 'var(--font-mono)', color: row.coveredFully ? 'var(--green)' : 'var(--gold)' }}>{fmt(row.collectibleDue)}</b>
                  </div>
                  <div style={{ fontSize: 10.5, color: row.coveredFully ? 'var(--green)' : 'var(--gold)', marginTop: 8, lineHeight: 1.6 }}>
                    {row.coveredFully
                      ? 'مغطى بالكامل — لا يُطالَب العميل، لكنه لا يُعد مسددًا حتى تنخفض المديونية في زوهو.'
                      : 'تسوية جزئية — تُغطّى الأرصدة الأقدم أولًا، ويُطالَب العميل بالباقي فقط.'}
                  </div>
                </div>
              ))}
              <div style={{ gridColumn: '1 / -1', fontSize: 10.5, color: 'var(--muted2)', lineHeight: 1.7 }}>
                هذه معاينة تشغيلية فقط؛ لم يُعدّل النظام أي فاتورة أو رصيد في زوهو. الرصيد الافتتاحي بتاريخ 10 يناير 2026 يُغطّى قبل الفواتير الأحدث.
              </div>
            </div>
          )}
        </Card>
      )}

      {/* ── أرصدة دائنة غير مستخدمة — طبّقها في زوهو لتصفير الدين ── */}
      {creditsState.status === 'unavailable' && (
        <div className="data-load-error is-inline" role="status">
          <HandCoins size={17}/>
          <div>
            <strong>تعذر قراءة الأرصدة الدائنة غير المستخدمة من Zoho</strong>
            <span>لم نعرضها كرصيد صفري ولم نسمح بتطبيقها. السبب: {creditsState.error}</span>
          </div>
          <Btn size="sm" variant="ghost" onClick={resetCredits}>إعادة المحاولة</Btn>
        </div>
      )}

      {credits && credits.rows.length > 0 && (
        <Card style={{ padding: 0, marginBottom: 12, overflow: 'hidden',
          border: '1.5px solid color-mix(in srgb, var(--green) 30%, var(--border))' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', flexWrap: 'wrap',
            background: 'color-mix(in srgb, var(--green) 7%, transparent)' }}>
            <button onClick={() => setCreditsOpen(o => !o)}
              style={{ flex: 1, minWidth: 200, display: 'flex', alignItems: 'center', gap: 10,
                background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'right', padding: 0 }}>
              <span style={{ fontSize: 17 }}>💳</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 800 }}>
                  {credits.rows.length} عميل لهم أرصدة دائنة في زوهو
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                  {applicableRows.length > 0
                    ? <>قابل للتطبيق الآن: <b style={{ color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>{fmt(credits.totalApplicable)}</b> ر.س على {applicableRows.length} عميل · </>
                    : <>لا شيء قابل للتطبيق حالياً · </>}
                  {standingCount > 0 && <>{standingCount} رصيد بلا فواتير مفتوحة · </>}
                  افتح للتفاصيل
                </div>
              </div>
              <ChevronDown size={16} style={{ transform: creditsOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s', color: 'var(--muted)' }}/>
            </button>
            {isAdmin && (
              <>
                {/* صلاحيات v2: التطبيق كتابة مالية — مفتاح zoho.apply_credits الحسّاس */}
                {applicableRows.length > 0 && can('zoho.apply_credits') && (
                  <Btn size="sm" variant="accent" onClick={() => setBulkOpen(true)} title="يطبّق الأرصدة القابلة للتطبيق (لها فواتير مفتوحة) دفعة واحدة">
                    ⚡ طبّق للكل ({applicableRows.length})
                  </Btn>
                )}
                <Btn size="sm" variant="ghost" onClick={grantWriteAccess} title="مرة واحدة — يفعّل التطبيق">
                  🔑 منح صلاحية
                </Btn>
              </>
            )}
          </div>
          {creditsOpen && (
            <div className="m-flow" style={{ maxHeight: 340, overflowY: 'auto', borderTop: '1px solid var(--border)' }}>
              <table className="m-cards" style={{ width: '100%', fontSize: 12.5 }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
                  <tr>{['العميل', 'الدين', 'رصيد غير مستخدم', 'يُطبَّق', 'يبقى', ''].map(h => (
                    <th key={h} style={{ padding: '8px 12px', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {credits.rows.map(r => (
                    <tr key={r.zohoId} style={{ borderTop: '1px solid var(--border)' }}>
                      <td data-label="" style={{ padding: '8px 12px', fontWeight: 700, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</td>
                      <td data-label="الدين" style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{fmt(r.outstanding)}</td>
                      <td data-label="رصيد غير مستخدم" style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', color: 'var(--green)', whiteSpace: 'nowrap' }}>{fmt(r.unusedCredit)}</td>
                      <td data-label="يُطبَّق" style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontWeight: 800, whiteSpace: 'nowrap' }}>{fmt(r.applicable)}</td>
                      <td data-label="يبقى" style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap',
                        color: r.applicable > 0.5 ? (r.clearsFully ? 'var(--green)' : 'var(--gold)') : 'var(--muted2)' }}>
                        {r.applicable > 0.5 ? (r.clearsFully ? '✓ صفر' : fmt(r.remainingAfter)) : 'رصيد بلا فواتير مفتوحة'}
                      </td>
                      <td data-label="" style={{ padding: '8px 12px', whiteSpace: 'nowrap', display: 'flex', gap: 8, alignItems: 'center' }}>
                        {isAdmin && can('zoho.apply_credits') && r.applicable > 0.5 && (
                          <button onClick={() => setApplyTarget({ zohoId: r.zohoId, name: r.name, zohoUrl: r.zohoUrl })}
                            style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--green)', background: 'color-mix(in srgb, var(--green) 12%, transparent)',
                              border: '1px solid color-mix(in srgb, var(--green) 30%, transparent)', borderRadius: 7, padding: '4px 10px', cursor: 'pointer' }}>
                            طبّق تلقائياً
                          </button>
                        )}
                        {r.applicable <= 0.5 && <span style={{ fontSize: 10.5, color: 'var(--muted2)' }}>لا فواتير مفتوحة</span>}
                        {r.zohoUrl
                          ? <a href={r.zohoUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--accent)', textDecoration: 'none' }}>زوهو ↗</a>
                          : <span style={{ fontSize: 11, color: 'var(--muted2)' }}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ padding: '8px 14px', fontSize: 10.5, color: 'var(--muted2)', borderTop: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ flex: 1, minWidth: 180 }}>
                  «طبّق تلقائياً» يُطبّق الرصيد في زوهو (تطبيق فقط — لا إنشاء/حذف). أو افتح «زوهو ↗» وطبّق يدوياً.
                </span>
                {isAdmin && (
                  <button onClick={grantWriteAccess}
                    style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', background: 'transparent',
                      border: '1px solid var(--border)', borderRadius: 7, padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    🔑 منح صلاحية التطبيق (مرة واحدة)
                  </button>
                )}
              </div>
            </div>
          )}
        </Card>
      )}

      <details className="customer-portfolio-advanced">
      <summary>التفاصيل المتقدمة</summary>
      <div className="customer-portfolio-advanced__body">
      {/* ── أدوات القائمة ── */}
      <div className="customer-money-toolbar workspace-filter-bar" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 170 }}>
          <Search size={14} style={{ position: 'absolute', right: 12, top: 10, color: 'var(--muted)' }}/>
          <input value={q} onChange={e => updateUrlFilters({ search: e.target.value || null }, { replace: true })} placeholder="ابحث بالعميل/المتجر/الهاتف…"
            aria-label="البحث في مستحقات العملاء"
            style={{ width: '100%', padding: '9px 36px 9px 12px', borderRadius: 8, fontSize: 13 }}/>
        </div>
        <select value={sortBy} onChange={e => updateUrlFilters({ sort: e.target.value === 'owed' ? null : e.target.value })} aria-label="ترتيب مستحقات العملاء" style={{ padding: '8px 10px', borderRadius: 8, fontSize: 12.5 }}>
          <option value="owed">الأكبر ديناً أولاً</option>
          <option value="oldest">الأقدم ديناً أولاً</option>
        </select>
        <select value={platformFilter} onChange={e => updateUrlFilters({ status: e.target.value === 'all' ? null : e.target.value })}
          aria-label="فلتر حالة المتجر في المنصّة"
          style={{ padding: '8px 10px', borderRadius: 8, fontSize: 12.5 }}>
          <option value="all">كل حالات المنصّة ({platformCounts.all})</option>
          <option value="active">نشط — راجع الإيقاف ({platformCounts.active})</option>
          <option value="inactive">غير نشط ({platformCounts.inactive})</option>
          <option value="unknown">بلا حالة مرتبطة ({platformCounts.unknown})</option>
        </select>
        {/* «لم تصلهم مطالبة» — مدينون بهاتف لم يصلهم قالب sadad قط (سدّ فجوة الـ29) */}
        {(() => {
          const unclaimedCount = (d?.customers || []).filter(c =>
            c.phone && (c.owed || 0) > 0.5 && !sadadSet.has(normalizeSaudiPhone(c.phone))).length;
          return (
            <Btn size="sm" variant={unclaimedOnly ? 'primary' : 'outline'}
              onClick={() => updateUrlFilters({ source: unclaimedOnly ? null : 'unclaimed' })}
              title="مدينون لهم هاتف ولم يصلهم قالب المطالبة (sadad) إطلاقاً">
              🔕 لم تصلهم مطالبة ({unclaimedCount})
            </Btn>
          );
        })()}
        {can('campaigns.send') && (
          <Btn size="sm" variant="accent" icon={<MessageCircle size={13}/>} onClick={openFocusedCampaign}>
            {buckets.size ? `مراجعة حملة (${waRecipients.length})` : 'اختر شريحة للحملة'}
          </Btn>
        )}
        <Btn size="sm" variant="ghost" icon={<Download size={13}/>} onClick={() => exportXlsx(filtered)} disabled={!filtered.length}>تصدير</Btn>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 10 }}>
        عرض <b style={{ color: 'var(--text)' }}>{filtered.length}</b> من {d.customers.length} عميلاً
        {platformFilter !== 'all' ? ` — حالة المنصّة: ${
          platformFilter === 'active' ? 'نشط' : platformFilter === 'inactive' ? 'غير نشط' : 'غير متوفرة'
        }` : ''}
        {buckets.size ? ` — شرائح ${campaignBucketLabel(buckets)}` : ''} ·
        {buckets.size ? 'مجموع الشرائح المختارة ' : 'إجمالي المعروض '}
        <b style={{ color: 'var(--gold)', fontFamily: 'var(--font-mono)' }}>{fmt(filteredTotal)}</b> ر.س
        {buckets.size > 0 && <span style={{ color: 'var(--muted2)' }}> — الحملة تُرسل بهذا المبلغ لا كامل الدين</span>}
      </div>

      {/* ── بطاقات العملاء ── */}
      {!filtered.length ? <Card><Empty icon="🎉" title="لا ديون في هذا العرض" sub="جرّب فلتراً آخر"/></Card> : (<>
        <div className="customer-money-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(330px,100%),1fr))', gap: 10 }}>
          {visibleCustomerRows.map(c => (
            <CustomerCard key={c.name} c={c} highlight={buckets}
              wa={waStatus.get(normalizeSaudiPhone(c.phone))}
              onWa={can('campaigns.send') ? openSingleWa : null}
              collectionTask={collectionTaskByCustomer.get(c.name) || null}
              collectionAssignee={collectionAssigneeById.get(collectionTaskByCustomer.get(c.name)?.assigned_to) || null}
              currentUserId={user?.id || null}
              returnTo={`${location.pathname}${location.search}`}
              showCollectionWork={can('collections.view')}/>
          ))}
        </div>
        <ProgressiveListFooter hasMore={hasMoreCustomers} shown={visibleCustomerCount} total={visibleCustomerTotal} onLoadMore={loadMoreCustomers} sentinelRef={customerRowsSentinelRef}/>
      </>)}
      </div>
      </details>

      {bulkAction && (
        <Modal title={{ assign: 'مراجعة الإسناد الجماعي', followup: 'مراجعة قائمة المتابعة', campaign: 'مراجعة Draft الحملة', ivr: 'مراجعة جمهور IVR', export: 'مراجعة التصدير' }[bulkAction]} onClose={() => setBulkAction(null)} width={680}>
          <div className="aging-bulk-review">
            <div className="aging-bulk-review__equation">
              <div><span>المحدد</span><b>{bulkReview.length}</b></div><i>−</i>
              <div className="is-excluded"><span>المستبعد</span><b>{bulkReview.length - eligibleBulkRows.length}</b></div><i>=</i>
              <div className="is-ready"><span>المؤهل</span><b>{eligibleBulkRows.length}</b></div>
            </div>
            <div className="aging-bulk-review__amount">إجمالي مبلغ المؤهل <strong>{fmt(eligibleBulkRows.reduce((sum, row) => sum + row.summary.amount, 0))} ر.س</strong></div>
            {bulkAction === 'assign' && (
              <label className="aging-bulk-review__assignee">المحصل
                <select value={bulkAssignee} onChange={e => setBulkAssignee(e.target.value)}>
                  <option value="">اختر المحصل</option>
                  {collectionAssignees.map(employee => <option value={employee.id} key={employee.id}>{employee.name}</option>)}
                </select>
              </label>
            )}
            {bulkAction === 'campaign' && <div className="aging-bulk-review__notice">سيُفتح مركز الحملات كـDraft غير مرسل. سيُعاد احتساب الجمهور والحماية قبل أي تنفيذ.</div>}
            {bulkAction === 'ivr' && <div className="aging-bulk-review__notice">سيُفتح IVR Review فقط. لن تبدأ أي مكالمة من هذه الشاشة.</div>}
            {bulkAction === 'followup' && <div className="aging-bulk-review__notice">ستُفتح مهام التحصيل الموجودة فقط؛ لن تُنشأ مهمة صامتة لأي متجر.</div>}
            <div className="aging-bulk-review__rows">
              {bulkReview.map(row => <div key={row.identityKey} className={row.eligible ? 'is-ready' : 'is-excluded'}>
                <span><b>{row.customer.storeName || row.customer.name}</b><small>{fmt(row.summary.amount)} ر.س</small></span>
                <strong>{row.eligible ? 'مؤهل' : row.exclusionReason}</strong>
              </div>)}
            </div>
            <div className="aging-bulk-review__actions"><Btn variant="ghost" onClick={() => setBulkAction(null)}>إلغاء</Btn><Btn variant="accent" onClick={confirmBulkAction} disabled={!eligibleBulkRows.length || (bulkAction === 'assign' && !bulkAssignee)}>{bulkAction === 'assign' ? 'تنفيذ الإسناد' : bulkAction === 'campaign' ? 'فتح Draft الحملة' : bulkAction === 'ivr' ? 'فتح IVR Review' : bulkAction === 'followup' ? 'فتح قائمة المتابعة' : 'تصدير المؤهل'}</Btn></div>
          </div>
        </Modal>
      )}

      <WhatsAppSendModal open={waOpen}
        onClose={() => { setWaOpen(false); setWaSingle(null); }}
        recipients={waOpen ? (waSingle ? [waSingle] : waRecipients) : []}
        bucketLabel={waSingle ? `العميل ${waSingle.name}` : (buckets.size ? `شريحة ${campaignBucketLabel(buckets)}` : 'تحصيل العملاء')}
        onSent={() => { loadWaStatus(); loadSadad(); }}/>

      {briefOpen && <MorningBriefModal onClose={() => setBriefOpen(false)}/>}
      {bulkOpen && credits && (
        <BulkApplyModal rows={applicableRows} onGrant={grantWriteAccess}
          onClose={() => setBulkOpen(false)}
          onDone={() => { setBulkOpen(false); resetCredits(); refresh(); }}/>
      )}
      {lamhaPolicyOpen ? <Suspense fallback={<WorkspaceLoadingState label="جارٍ فتح مراجعة حسابات لمحة…"/>}>
        <LamhaFinancialAccountReview onClose={() => setLamhaPolicyOpen(false)}/>
      </Suspense> : null}
      {applyTarget && (
        <ApplyCreditsModal target={applyTarget} onGrant={grantWriteAccess}
          onClose={() => setApplyTarget(null)}
          onDone={() => { setApplyTarget(null); resetCredits(); refresh(); }}/>
      )}
    </div>
  );
}

// مودال «طبّق للكل» — تطبيق أرصدة كل العملاء تسلسلياً مع تقدّم حيّ
function BulkApplyModal({ rows, onClose, onDone, onGrant }) {
  const operationGroup = useRef(crypto.randomUUID());
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [idx, setIdx] = useState(0);
  const [log, setLog] = useState([]);   // [{name, ok, applied, error}]
  const [rateHit, setRateHit] = useState(false);   // توقّف بسبب حصة زوهو
  const totalPlanned = rows.reduce((s, r) => s + r.applicable, 0);
  const appliedSum = log.filter(l => l.ok).reduce((s, l) => s + (l.applied || 0), 0);
  const authFailed = log.some(l => !l.ok && /authoriz|صلاح/i.test(l.error || ''));

  const run = async () => {
    setRunning(true);
    for (let i = 0; i < rows.length; i++) {
      setIdx(i + 1);
      const r = rows[i];
      const res = await applyZohoCredits(r.zohoId, `${operationGroup.current}:${r.zohoId}`);
      // تجاوز حصة زوهو → أوقف واعرض بانر (يُكمل المستخدم لاحقاً بأمان)
      if (res?.rate_limited) { setRateHit(true); break; }
      const entry = res?.ok
        ? { name: r.name, ok: !(res.results || []).some(x => !x.ok), applied: res.applied,
            error: (res.results || []).find(x => !x.ok)?.error || null }
        : { name: r.name, ok: false, applied: 0, error: res?.error || 'فشل' };
      setLog(prev => [...prev, entry]);
      // أوقف فوراً لو المشكلة صلاحية (لا فائدة من إكمال البقية)
      if (!entry.ok && /authoriz|صلاح/i.test(entry.error || '')) break;
      // مباعدة بسيطة لتفادي ضرب حصة زوهو (~100 طلب/دقيقة)
      await sleep(1200);
    }
    setRunning(false);
    setDone(true);
  };

  const okCount = log.filter(l => l.ok).length;
  const failCount = log.filter(l => !l.ok).length;

  return (
    <Modal title={`تطبيق أرصدة كل العملاء (${rows.length})`} onClose={running ? undefined : onClose} width={560}>
      {!running && !done ? (
        <div>
          <div style={{ fontSize: 13, lineHeight: 1.8, marginBottom: 14 }}>
            سيُطبَّق الرصيد الدائن على فواتير <b>{rows.length}</b> عميلاً دفعة واحدة — إجمالي متوقّع
            <b style={{ color: 'var(--green)', fontFamily: 'var(--font-mono)' }}> {fmt(totalPlanned)}</b> ر.س.
            <br/><span style={{ fontSize: 12, color: 'var(--muted)' }}>
              عملية آمنة: تطبيق رصيد موجود على فاتورة موجودة فقط — لا إنشاء ولا حذف. تُكتب في Zoho Books.
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-start' }}>
            <Btn variant="accent" onClick={run}>⚡ ابدأ تطبيق الكل ({rows.length})</Btn>
            <Btn variant="ghost" onClick={onClose}>إلغاء</Btn>
          </div>
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            {running && <Spinner size={16}/>}
            <div style={{ fontSize: 13, fontWeight: 700 }}>
              {running ? `جارٍ… ${idx}/${rows.length}` : `انتهى — ✓ ${okCount} نجح${failCount ? ` · ✗ ${failCount} فشل` : ''}`}
            </div>
            <div style={{ marginInlineStart: 'auto', fontSize: 13, fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--green)' }}>
              {fmt(appliedSum)} ر.س
            </div>
          </div>
          {/* شريط تقدّم */}
          <div style={{ height: 6, borderRadius: 3, background: 'var(--surface2)', overflow: 'hidden', marginBottom: 12 }}>
            <div style={{ width: `${(log.length / rows.length) * 100}%`, height: '100%', background: 'var(--green)', transition: 'width .2s' }}/>
          </div>
          <div className="m-flow" style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}>
            {log.map((l, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, padding: '6px 10px', borderTop: i ? '1px solid var(--border)' : 'none' }}>
                <span>{l.ok ? '✓' : '✗'}</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</span>
                <span style={{ fontFamily: 'var(--font-mono)', color: l.ok ? 'var(--green)' : 'var(--red)' }}>
                  {l.ok ? fmt(l.applied) : (l.error || 'فشل').slice(0, 40)}
                </span>
              </div>
            ))}
          </div>
          {authFailed && (
            <div style={{ marginTop: 10, padding: '9px 12px', borderRadius: 8, fontSize: 12, background: 'color-mix(in srgb, var(--gold) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--gold) 30%, transparent)' }}>
              توقّف بسبب رفض صلاحية الكتابة. <Btn size="sm" variant="accent" onClick={onGrant} style={{ marginInlineStart: 8 }}>🔑 منح الصلاحية</Btn>
            </div>
          )}
          {rateHit && (
            <div style={{ marginTop: 10, padding: '9px 12px', borderRadius: 8, fontSize: 12, lineHeight: 1.7, background: 'color-mix(in srgb, var(--gold) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--gold) 30%, transparent)' }}>
              توقّف مؤقتاً — حصة زوهو ممتلئة (~100 طلب/دقيقة). انتظر دقيقة و«طبّق للكل» مجدداً؛ ما طُبِّق محفوظ والباقي يُكمَّل بأمان (لا ازدواج).
            </div>
          )}
          {done && (
            <div style={{ marginTop: 14, textAlign: 'left' }}>
              <Btn variant="primary" onClick={onDone}>تم</Btn>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// مودال تطبيق الأرصدة الدائنة — معاينة (قراءة) ثم تأكيد التطبيق (كتابة في زوهو)
function ApplyCreditsModal({ target, onClose, onDone, onGrant }) {
  const operationKey = useRef(`${crypto.randomUUID()}:${target.zohoId}`);
  const [plan, setPlan] = useState(null);   // null=جارٍ · {ok,...} · {error}
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    planZohoApplyCredits(target.zohoId).then(setPlan).catch(e => setPlan({ ok: false, error: String(e) }));
  }, [target.zohoId]);

  const doApply = async () => {
    setApplying(true);
    const r = await applyZohoCredits(target.zohoId, operationKey.current);
    setApplying(false);
    if (r?.rate_limited) { toast('حصة زوهو ممتلئة مؤقتاً — انتظر دقيقة وأعد المحاولة', 'info'); if (r.applied > 0) setDone(r); return; }
    if (r?.ok) { setDone(r); if (!r.results?.some(x => !x.ok)) toast(`تم تطبيق ${fmt(r.applied)} ر.س ✓`, 'success'); }
    else toast(`فشل التطبيق: ${r?.error || 'غير معروف'}`, 'error');
  };

  return (
    <Modal title={`تطبيق الرصيد الدائن — ${target.name}`} onClose={onClose} width={560}>
      {plan == null ? <div style={{ padding: 30, textAlign: 'center' }}><Spinner/></div>
        : !plan.ok ? <div style={{ color: 'var(--red)', fontSize: 13, padding: 12 }}>خطأ: {plan.error}</div>
        : done ? (
          <div>
            {done.applied > 0 && (
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--green)', marginBottom: 10 }}>
                ✓ طُبِّق {fmt(done.applied)} ر.س على {done.count} فاتورة
              </div>
            )}
            {done.results?.filter(x => !x.ok).map((x, i) => (
              <div key={i} style={{ fontSize: 12, color: 'var(--red)' }}>{x.source || x.invoice}: {x.error}</div>
            ))}
            {(done.role_error || done.results?.some(x => !x.ok && /authoriz|scope|permission|صلاح/i.test(x.error || ''))) && (
              <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 8, fontSize: 12, lineHeight: 1.75,
                background: 'color-mix(in srgb, var(--gold) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--gold) 30%, transparent)' }}>
                زوهو رفض التطبيق الآلي (صلاحية OAuth للكتابة لم تُمنَح رغم إعادة الموافقة).
                <b> الأضمن: طبّقه يدوياً في زوهو بنقرة</b> — بحسابك الذي يملك الصلاحية كاملة:
                <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {target.zohoUrl && (
                    <a href={target.zohoUrl} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
                      <Btn size="sm" variant="accent">افتح العميل في زوهو ↗</Btn>
                    </a>
                  )}
                  <Btn size="sm" variant="ghost" onClick={onGrant}>🔑 إعادة منح الصلاحية</Btn>
                </div>
              </div>
            )}
            <div style={{ marginTop: 14, textAlign: 'left' }}><Btn variant="primary" onClick={onDone}>تم</Btn></div>
          </div>
        ) : !plan.plan?.length ? (
          <div style={{ fontSize: 13, color: 'var(--muted)', padding: 12 }}>لا فواتير مفتوحة لتطبيق الرصيد عليها.</div>
        ) : (
          <div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.7, marginBottom: 12 }}>
              سيُطبَّق <b style={{ color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>{fmt(plan.total_applied)}</b> ر.س
              من الرصيد الدائن على <b>{plan.plan.length}</b> فاتورة (الأقدم أولاً). **هذه العملية تكتب في Zoho Books** —
              تطبيق رصيد موجود فقط، لا تُنشئ ولا تحذف أي فاتورة.
            </div>
            <div className="m-flow" style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
              {plan.plan.map((p, i) => (
                <div key={p.invoice_id} style={{ padding: '9px 12px', borderTop: i ? '1px solid var(--border)' : 'none', fontSize: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>{p.number} · {p.date}</span>
                    <span>يُطبَّق <b style={{ color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>{fmt(p.applied)}</b>{p.remaining > 0.5 ? ` · يبقى ${fmt(p.remaining)}` : ' · يُصفَّر ✓'}</span>
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--muted2)', marginTop: 2 }}>{(p.detail || []).join(' · ')}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-start' }}>
              <Btn variant="accent" onClick={doApply} disabled={applying}>
                {applying ? <><Spinner size={13}/> جارٍ التطبيق في زوهو…</> : `أكّد التطبيق في زوهو (${fmt(plan.total_applied)} ر.س)`}
              </Btn>
              <Btn variant="ghost" onClick={onClose} disabled={applying}>إلغاء</Btn>
            </div>
          </div>
        )}
    </Modal>
  );
}

const BRIEF_VARIABLE_LABELS = {
  compact: ['التاريخ', 'لك عند العملاء', 'منها متأخرة', 'حصّلنا هذا الشهر', 'أكبر 3 مدينين', 'فواتير تنتظر نظرتك'],
  expanded: [
    'التاريخ', 'صحة اليوم', 'البنوك والأرصدة', 'عمليات البنك', 'ذمم العملاء', 'المتأخر والافتتاحي',
    'أعمار الدين', 'التحصيل الشهري', 'أكبر 5 مدينين', 'تغطية مهام التحصيل', 'وعود السداد',
    'الموردون والفواتير', 'دورة المحاسب', 'زاتكا', 'المبيعات والمتابعة', 'التكاملات وحداثة المصادر',
  ],
};

function BriefMetric({ label, value, detail, tone = 'default' }) {
  return (
    <div className={`brief-metric brief-metric--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

function BriefSection({ title, subtitle, children }) {
  return (
    <section className="brief-section">
      <header><div><h4>{title}</h4>{subtitle && <p>{subtitle}</p>}</div></header>
      <div className="brief-section__body">{children}</div>
    </section>
  );
}

// إعداد ملخّص الصباح — رسالة واتساب يومية 7:15 صباحاً + لوحة إدارة موسعة
function MorningBriefModal({ onClose }) {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(null);
  const [sending, setSending] = useState(false);

  useEffect(() => { loadMorningBriefConfig().then(setCfg).catch(() => setCfg({ enabled: false, phone: '', templateName: '', templateLanguage: 'ar', channelId: '', reportMode: 'compact' })); }, []);

  const save = async (next) => {
    setCfg(next); setSaving(true);
    try { await saveMorningBriefConfig(next); } catch (e) { toast(`تعذّر الحفظ: ${e.message}`, 'error'); }
    setSaving(false);
  };
  const doPreview = async () => {
    setPreview('...');
    const r = await previewMorningBrief();
    setPreview(r?.ok ? r : `خطأ: ${r?.error || 'غير معروف'}`);
  };
  const doSendNow = async () => {
    setSending(true);
    const r = await sendMorningBriefNow();
    setSending(false);
    if (r?.ok && !r.skipped) toast(`أُرسل الملخّص ✓ (نجح ${r.sent ?? 1})`, 'success');
    else if (r?.skipped) toast('الملخّص معطَّل — فعّله واحفظ أولاً', 'warn');
    else toast(`فشل الإرسال: ${r?.error || 'غير معروف'}`, 'error');
  };

  const mode = cfg?.reportMode === 'expanded' ? 'expanded' : 'compact';
  const variableLabels = BRIEF_VARIABLE_LABELS[mode];
  const report = preview?.report;
  const customer = report?.customer || {};
  const finance = report?.finance || {};
  const collections = report?.collections || {};
  const operations = report?.operations || {};
  const sales = report?.sales || {};
  const system = report?.system || {};
  const aging = customer?.aging || {};
  const topCustomers = Array.isArray(customer?.customers) ? customer.customers.slice(0, 5) : [];
  const cycleLabel = operations?.cycle_status === 'closed' ? 'مقفلة' : operations?.cycle_status === 'open' ? 'مفتوحة' : 'لم تبدأ';
  const healthTone = report?.health?.level === 'critical' ? 'critical' : report?.health?.level === 'attention' ? 'attention' : 'good';

  return (
    <Modal title="🌅 ملخّص الصباح — تقرير الإدارة اليومي" onClose={onClose} width={1080} className="morning-brief-dialog" bodyClassName="morning-brief-body">
      {!cfg ? <div style={{ padding: 30, textAlign: 'center' }}><Spinner/></div> : (
        <div className="morning-brief-layout">
          <div className="brief-intro">
            <div>
              <strong>نظرة واحدة قبل بدء اليوم</strong>
              <p>تجمع النقد والبنوك، العملاء والتحصيل، الموردين، دورة المحاسب، زاتكا، المبيعات، والتكاملات. القراءة فقط ولا تغيّر أي رصيد أو مهمة.</p>
            </div>
            <span>يوميًا · 7:15 ص · بتوقيت السعودية</span>
          </div>

          <label className="brief-enable">
            <input type="checkbox" checked={cfg.enabled} onChange={e => save({ ...cfg, enabled: e.target.checked })}/>
            <span><b>تفعيل الإرسال اليومي</b><small>{cfg.enabled ? 'سيصل التقرير تلقائيًا في الموعد' : 'المعاينة تعمل، لكن لن تُرسل رسالة تلقائية'}</small></span>
          </label>

          <div className="brief-mode-grid" role="radiogroup" aria-label="حجم تقرير واتساب">
            <button type="button" className={mode === 'expanded' ? 'selected' : ''} onClick={() => save({ ...cfg, reportMode: 'expanded' })}>
              <b>تقرير إدارة موسّع</b><small>16 متغيّرًا · بنوك، تحصيل، تشغيل، زاتكا، فريق ومبيعات</small><em>الموصى به</em>
            </button>
            <button type="button" className={mode === 'compact' ? 'selected' : ''} onClick={() => save({ ...cfg, reportMode: 'compact' })}>
              <b>الملخص الحالي</b><small>6 متغيّرات · ذمم وتحصيل وأكبر المدينين فقط</small>
            </button>
          </div>

          {mode === 'expanded' && (
            <div className="brief-template-note">
              القالب الموسّع يحتاج قالب Hatif معتمدًا بـ <b>16 متغيّرًا</b>. اختيار الوضع لا يغيّر القالب تلقائيًا؛ اكتب اسم القالب المعتمد أدناه.
            </div>
          )}

          <div className="brief-config-grid">
            <Input label="رقم المستلِم (05… أو 9665…)" value={cfg.phone}
              onChange={e => setCfg({ ...cfg, phone: e.target.value })}
              onBlur={() => save(cfg)} placeholder="05XXXXXXXX"/>
            <Input label="اسم القالب المعتمد" value={cfg.templateName}
              onChange={e => setCfg({ ...cfg, templateName: e.target.value })}
              onBlur={() => save(cfg)} placeholder="morning_brief"/>
            <Input label="لغة القالب" value={cfg.templateLanguage}
              onChange={e => setCfg({ ...cfg, templateLanguage: e.target.value })}
              onBlur={() => save(cfg)} placeholder="ar"/>
            <Input label="معرّف القناة (اختياري)" value={cfg.channelId}
              onChange={e => setCfg({ ...cfg, channelId: e.target.value })}
              onBlur={() => save(cfg)}/>
          </div>

          <details className="brief-variable-contract">
            <summary>عرض ترتيب متغيّرات القالب ({variableLabels.length})</summary>
            <div>{variableLabels.map((label, index) => <span key={label}><b>{`{{${index + 1}}}`}</b>{label}</span>)}</div>
          </details>

          <div className="brief-actions">
            <Btn size="sm" variant="ghost" onClick={doPreview}>تحديث ومعاينة التقرير</Btn>
            <Btn size="sm" variant="accent" onClick={doSendNow} disabled={sending || !cfg.enabled || !cfg.phone || !cfg.templateName}>
              {sending ? <Spinner size={13}/> : 'أرسل الآن (تجربة)'}
            </Btn>
            {saving && <span style={{ fontSize: 11, color: 'var(--muted)', alignSelf: 'center' }}>يحفظ…</span>}
          </div>

          {report && <div className="brief-dashboard">
            <div className={`brief-health brief-health--${healthTone}`}>
              <div><span>صحة اليوم</span><strong>{report.health?.alerts?.length ? `${report.health.alerts.length} إشارات تحتاج قرارًا` : 'الوضع مستقر'}</strong></div>
              <div>{report.health?.alerts?.length ? report.health.alerts.map(alert => <span key={alert}>{alert}</span>) : <span>لا توجد إشارات حرجة في اللقطة الحالية</span>}</div>
            </div>

            <div className="brief-hero-metrics">
              <BriefMetric label="الرصيد الختامي للبنوك" value={`${fmt(finance.statement_balance)} ر.س`} detail={`زوهو ${fmt(finance.book_balance)} · الفرق ${fmt(finance.statement_vs_book_difference)}`} tone={Math.abs(Number(finance.statement_vs_book_difference || 0)) > 0.5 ? 'attention' : 'good'}/>
              <BriefMetric label="لك عند العملاء" value={`${fmt(customer.outstanding)} ر.س`} detail={`${customer.outstanding_cnt || 0} عميل`}/>
              <BriefMetric label="المتأخر" value={`${fmt(customer.overdue_amt)} ر.س`} detail={`+90 يوم ${fmt(aging.b90p)} ر.س`} tone="critical"/>
              <BriefMetric label="تحصيل هذا الشهر" value={`${fmt(customer.collected_this_month)} ر.س`} detail={`الشهر السابق ${fmt(customer.collected_prev_month)} ر.س`} tone="good"/>
            </div>

            <div className="brief-sections-grid">
              <BriefSection title="النقد والبنوك" subtitle="كشف البنك مقابل رصيد زوهو">
                <div className="brief-mini-grid">
                  <BriefMetric label="حسابات مربوطة" value={finance.linked_bank_accounts || 0}/>
                  <BriefMetric label="عمليات غير مصنفة" value={finance.uncategorized_bank_operations || 0} tone={finance.uncategorized_bank_operations ? 'attention' : 'good'}/>
                  <BriefMetric label="آخر كشف" value={finance.statement_as_of || 'غير متوفر'}/>
                  <BriefMetric label="فرق الكشف عن زوهو" value={`${fmt(finance.statement_vs_book_difference)} ر.س`} tone={Math.abs(Number(finance.statement_vs_book_difference || 0)) > 0.5 ? 'attention' : 'good'}/>
                </div>
              </BriefSection>

              <BriefSection title="أعمار ديون العملاء" subtitle={`يتضمن الرصيد الافتتاحي ${fmt(aging.opening_balance)} ر.س`}>
                <div className="brief-aging-grid">
                  {[['0–15 يوم', aging.b0_15, 'good'], ['16–30 يوم', aging.b16_30, 'good'], ['31–60 يوم', aging.b31_60, 'default'], ['61–90 يوم', aging.b61_90, 'attention'], ['+90 يوم', aging.b90p, 'critical']].map(([label, value, tone]) => <BriefMetric key={label} label={label} value={`${fmt(value)} ر.س`} tone={tone}/>) }
                </div>
              </BriefSection>

              <BriefSection title="التحصيل ووعود السداد" subtitle="هل كل عميل يحتاج متابعة لديه مهمة ومسؤول؟">
                <div className="brief-mini-grid">
                  <BriefMetric label="مرشحون للتحصيل" value={collections.candidates || 0} detail={`${fmt(collections.candidate_debt)} ر.س`}/>
                  <BriefMetric label="بلا مهمة" value={collections.missing_tasks || 0} detail={`${fmt(collections.missing_task_debt)} ر.س`} tone={collections.missing_tasks ? 'critical' : 'good'}/>
                  <BriefMetric label="بلا مسؤول" value={collections.unassigned_customers || 0} tone={collections.unassigned_customers ? 'attention' : 'good'}/>
                  <BriefMetric label="وعود اليوم / متجاوزة" value={`${collections.promises_due_today || 0} / ${collections.broken_promises || 0}`} tone={collections.broken_promises ? 'critical' : 'default'}/>
                </div>
              </BriefSection>

              <BriefSection title="الموردون والالتزامات" subtitle="الالتزام الصافي والفواتير التي تحتاج سدادًا">
                <div className="brief-mini-grid">
                  <BriefMetric label="صافي الموردين" value={`${fmt(finance.vendor_net_payable)} ر.س`}/>
                  <BriefMetric label="فواتير مفتوحة" value={finance.open_bills || 0} detail={`${fmt(finance.open_bills_balance)} ر.س`}/>
                  <BriefMetric label="فواتير متأخرة" value={finance.overdue_bills || 0} detail={`${fmt(finance.overdue_bills_balance)} ر.س`} tone={finance.overdue_bills ? 'critical' : 'good'}/>
                  <BriefMetric label="أرصدة دائنة للموردين" value={`${fmt(finance.vendor_credits)} ر.س`}/>
                </div>
              </BriefSection>

              <BriefSection title="التشغيل وزاتكا" subtitle="دورة المحاسب، جداول الناقلين، والفوترة الإلكترونية">
                <div className="brief-mini-grid">
                  <BriefMetric label="دورة الشهر" value={cycleLabel} detail={`${operations.current_month_events || 0} أحداث ناجحة`}/>
                  <BriefMetric label="ناقلون بجداول ناقصة" value={operations.missing_carrier_schedules || 0} detail={`من ${operations.contracted_carriers || 0} ناقل`} tone={operations.missing_carrier_schedules ? 'attention' : 'good'}/>
                  <BriefMetric label="فواتير زاتكا معلقة" value={system.zatca_pending || 0} tone={system.zatca_pending ? 'critical' : 'good'}/>
                  <BriefMetric label="تكاملات تحتاج مراجعة" value={system.integration_issues || 0} tone={system.integration_issues ? 'attention' : 'good'}/>
                </div>
              </BriefSection>

              <BriefSection title="المبيعات والفريق" subtitle="العمل الجديد الذي لم يصل إلى مسؤول">
                <div className="brief-mini-grid">
                  <BriefMetric label="عملاء جدد اليوم" value={sales.new_leads_today || 0}/>
                  <BriefMetric label="ليد وارد بلا مسؤول" value={sales.unassigned_inbound_leads || 0} tone={sales.unassigned_inbound_leads ? 'attention' : 'good'}/>
                  <BriefMetric label="متابعات بلا مسؤول" value={sales.unassigned_followups || 0} tone={sales.unassigned_followups ? 'attention' : 'good'}/>
                  <BriefMetric label="مهام CRM متأخرة" value={sales.overdue_crm_tasks || 0} tone={sales.overdue_crm_tasks ? 'critical' : 'good'}/>
                </div>
              </BriefSection>
            </div>

            <BriefSection title="أكبر 5 مدينين" subtitle="الأولوية حسب صافي الرصيد القابل للتحصيل">
              <div className="brief-debtors">
                {topCustomers.length ? topCustomers.map((row, index) => <div key={`${row.name}-${index}`}><span>{index + 1}</span><b>{row.store_name || row.name}</b><strong>{fmt(row.owed)} ر.س</strong><small>{row.inv_cnt || 0} فاتورة · أقدمها {row.oldest_days || 0} يوم</small></div>) : <p>لا يوجد عملاء مدينون.</p>}
              </div>
            </BriefSection>

            <div className="brief-freshness">
              <span>آخر مزامنة زوهو: <b>{system.zoho_last_sync ? new Date(system.zoho_last_sync).toLocaleString('ar-SA') : 'غير متوفر'}</b></span>
              <span>آخر ملف منصة: <b>{system.platform_last_snapshot ? new Date(system.platform_last_snapshot).toLocaleString('ar-SA') : 'غير متوفر'}</b></span>
              <span>Webhooks معلقة: <b>{system.pending_webhooks || 0}</b></span>
              <span>إخفاقات الوكلاء 24س: <b>{system.agent_failures_24h || 0}</b></span>
            </div>

            <details className="brief-message-preview">
              <summary>معاينة القيم التي ستصل إلى قالب واتساب ({preview.vars?.length || 0})</summary>
              <div>{(preview.vars || []).map((value, index) => <div key={index}><span>{`{{${index + 1}}} ${variableLabels[index] || ''}`}</span><b>{value}</b></div>)}</div>
            </details>
          </div>}
          {typeof preview === 'string' && preview !== '...' && (
            <div style={{ color: 'var(--red)', fontSize: 12 }}>{preview}</div>
          )}
          {preview === '...' && <Spinner size={16}/>}
        </div>
      )}
    </Modal>
  );
}

// بطاقة عميل — الاسم والمبلغ وأزرار الفعل، وفواتيره بنقرة
// wa = حالة آخر حملة واتساب لهذا الهاتف (من whatsapp_campaign_status) · onWa = يطلق حملة لعميل واحد
function CustomerCard({
  c, highlight, wa: waStat, onWa,
  collectionTask, collectionAssignee, currentUserId, showCollectionWork, returnTo,
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [invs, setInvs] = useState(null);
  const digits = String(c.phone || '').replace(/\D/g, '');
  const waChat = digits ? `https://wa.me/${digits.startsWith('05') ? '966' + digits.slice(1) : digits}` : null;
  const storeStatus = platformStatusMeta(c);

  const ownerLabel = !collectionTask?.assigned_to
    ? 'بلا مسؤول'
    : collectionAssignee
      ? collectionAssignee
      : collectionTask.assigned_to === currentUserId ? 'أنت المسؤول' : 'مسند لموظف آخر';
  const nextAction = (() => {
    if (!collectionTask) return 'إنشاء أو إسناد مهمة متابعة';
    if (collectionTask.stage === 'promised') {
      const due = collectionTask.promise_date ? fmtDate(collectionTask.promise_date) : '';
      return `متابعة وعد السداد${due ? ` في ${due}` : ''}`;
    }
    if (collectionTask.stage === 'snoozed') {
      const due = collectionTask.snooze_until ? fmtDate(collectionTask.snooze_until) : '';
      return `متابعة بعد التأجيل${due ? ` في ${due}` : ''}`;
    }
    if (collectionTask.stage === 'contacted') return 'متابعة الرد وتسجيل النتيجة';
    return 'التواصل وتسجيل النتيجة';
  })();
  const openCollectionTask = () => {
    const params = new URLSearchParams({ view: 'queue', search: c.name });
    if (returnTo) params.set('returnTo', returnTo);
    navigate(`/customer-money?${params.toString()}`);
  };

  const toggleInvoices = async () => {
    const next = !open;
    setOpen(next);
    if (next && invs == null) {
      try { setInvs(await loadZohoOpenInvoices(c.name)); }
      catch { setInvs([]); }
    }
  };

  const ageColor = c.oldestDays > 90 ? 'var(--red)' : c.oldestDays > 60 ? 'color-mix(in srgb, var(--gold) 50%, var(--red))' : c.oldestDays > 30 ? 'var(--gold)' : 'var(--green)';

  // الرقم البارز يتبع الفلتر: عند اختيار شرائح أعمار يصير **مبلغ تلك
  // الشرائح** لا كامل الدين — لأن الغرض مطالبة التاجر بمبلغ محدَّد،
  // ومطالبته بكامل دينه بينما الفلتر على 61–90 مطالبةٌ خاطئة.
  // وكامل الدين يبقى ظاهراً تحته فلا يُخفى شيء (قاعدة: أي عرض مفلتر
  // يعلن ما يستبعده).
  const bandKeys = highlight instanceof Set ? [...highlight] : [];
  const bandSum  = bandKeys.reduce((s, k) => s + campaignBucketAmount(c, k), 0);
  const banded   = bandKeys.length > 0;
  const headline = banded ? bandSum : (c.owed || 0);
  const bandLabel = banded
    ? bandKeys.map(k => (BUCKETS.find(b => b.key === k) || {}).label).filter(Boolean).join(' + ')
    : null;
  const openStore360 = () => {
    const params = new URLSearchParams({
      customer: c.storeId || c.name,
      open: '1',
      view: 'finance',
      source: 'aging',
      returnTo: returnTo || '/customer-money',
    });
    if (bandKeys.length) params.set('aging', bandKeys.join(','));
    navigate(`/customer-360?${params.toString()}`);
  };

  return (
    <Card style={{ padding: '13px 15px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {c.storeName || c.name}
          </div>
          {c.storeName && c.storeName !== c.name && (
            <div style={{ fontSize: 10.5, color: 'var(--muted2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
          )}
          {/* رقم المتجر في لمحة — للبحث في المنصّة الداخلية بلا التباس أسماء */}
          {c.storeId && (
            <div style={{ fontSize: 9.5, color: 'var(--muted2)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>
              متجر #{c.storeId}
            </div>
          )}
        </div>
        <div style={{ textAlign: 'left' }}>
          <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--font-mono)',
            color: banded ? 'var(--red)' : 'var(--gold)', whiteSpace: 'nowrap' }}>{fmt(headline)}</div>
          <div style={{ fontSize: 9.5, color: 'var(--muted2)' }}>
            {banded ? 'ر.س — المطلوب سداده' : 'ر.س مستحقة'}
          </div>
          {banded && (
            <div style={{ fontSize: 9.5, color: 'var(--muted2)', marginTop: 2, whiteSpace: 'nowrap' }}>
              {bandLabel} · من أصل {fmt(c.owed)}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 10.5 }}>
        <Chip color={storeStatus.color}>{storeStatus.label}</Chip>
        {c.creditOffset > 0.005 && (
          <>
            <Chip color="var(--muted)">مدين زوهو {fmt(c.grossDue)}</Chip>
            <Chip color="var(--green)">دائن مقابل −{fmt(c.creditOffset)}</Chip>
            <Chip color="var(--gold)">يُحصّل {fmt(c.owed)}</Chip>
          </>
        )}
        {c.balanceSyncIssue && (
          <Chip color="var(--red)">
            فرق مزامنة {fmt(Math.max(c.balanceSyncGap || 0, c.balanceSyncOverage || 0))} — محجوب من الحملات
          </Chip>
        )}
        {c.invCnt > 0 ? (
          <>
            <Chip color={ageColor}>أقدم استحقاق {c.oldestDays} يوم</Chip>
            <Chip color="var(--muted)">{c.invCnt} فاتورة</Chip>
            {c.opening > 0.5 && <Chip color="var(--gold)">رصيد افتتاحي {fmt(c.opening)} — من 10 يناير 2026</Chip>}
          </>
        ) : c.opening > 0.5 ? (
          <Chip color="var(--gold)">رصيد افتتاحي {fmt(c.opening)} — من 10 يناير 2026</Chip>
        ) : null}
        {c.lastPaymentDate
          ? <Chip color="var(--green)">آخر دفعة {c.lastPaymentDate} ({fmtK(c.lastPaymentAmount)})</Chip>
          : <Chip color="var(--red)">لم يدفع شيئاً بعد</Chip>}
        {/* محفظة المنصّة — تُعرَض هنا حتى لا يحتاج المشغّل صفحة أخرى.
            دفع مسبق برصيد موجب يغطّي الدين = «خصم من المحفظة» لا تحصيل. */}
        {(c.walletBalance || 0) > 0.5 && (
          <Chip color="var(--green)">
            💰 محفظة +{fmt(c.walletBalance)}{c.walletBalance >= c.owed ? ' — تغطّي الدين' : ''}
          </Chip>
        )}
        {(c.walletBalance || 0) < -0.5 && (
          <Chip color="var(--red)">محفظة {fmt(c.walletBalance)} (دفع مسبق سالب)</Chip>
        )}
      </div>

      {/* حالة آخر حملة واتساب — متى استلمها + هل ردّ + هل سدّد بعدها */}
      {waStat && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 10, alignItems: 'center',
          borderTop: '1px dashed var(--border)', paddingTop: 6 }}>
          <span style={{ color: 'var(--muted2)' }}>📲 آخر حملة {fmtDate(waStat.lastSentAt)}{waStat.sends > 1 ? ` (${waStat.sends}×)` : ''}</span>
          {waStat.paidAfter
            ? <Chip color="var(--green)">✅ سدّد بعدها {waStat.paidAt ? fmtDate(waStat.paidAt) : ''}</Chip>
            : waStat.replied ? <Chip color="var(--brand)">💬 ردّ — لم يسدّد</Chip>
            : waStat.read ? <Chip color="var(--muted)">قرأها — لا رد</Chip>
            : waStat.delivered ? <Chip color="var(--muted)">وصلت</Chip>
            : waStat.status === 'Failed' ? <Chip color="var(--red)">فشل الإرسال</Chip>
            : <Chip color="var(--muted)">أُرسلت</Chip>}
        </div>
      )}

      {/* شريط أعمار مصغّر */}
      <div style={{ display: 'flex', height: 5, borderRadius: 3, overflow: 'hidden', background: 'var(--surface2)' }}>
        {BUCKETS.map(b => {
          const v = c[b.key] || 0;
          if (v <= 0.5) return null;
          return <div key={b.key} style={{ width: `${(v / c.owed) * 100}%`, background: b.color,
            opacity: (!highlight || highlight.size === 0 || highlight.has(b.key)) ? 1 : 0.25 }}/>;
        })}
      </div>

      {showCollectionWork && (
        <div className={`customer-collection-work${collectionTask ? '' : ' is-unassigned'}`}>
          <div className="customer-collection-work__copy">
            <span>
              المسؤول: <b>{ownerLabel}</b>
            </span>
            <span>
              الإجراء التالي: <b>{nextAction}</b>
            </span>
            {collectionTask && (
              <span className="customer-collection-work__stage">
                المرحلة: {STAGE_LABELS[collectionTask.stage] || collectionTask.stage}
              </span>
            )}
          </div>
          <button type="button" className="customer-collection-work__button" onClick={openCollectionTask}>
            {collectionTask ? 'فتح المهمة' : 'فتح قائمة التحصيل'}
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button type="button" onClick={openStore360} title="فتح ملف المتجر المالي الكامل"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            padding: '8px 10px', borderRadius: 8, background: 'color-mix(in srgb, var(--accent) 9%, transparent)',
            border: '1px solid color-mix(in srgb, var(--accent) 28%, var(--border))',
            color: 'var(--accent)', cursor: 'pointer', fontSize: 11.5, fontWeight: 700 }}>
          ملف 360 <ChevronLeft size={12}/>
        </button>
        {digits && (
          /* `amount` = المطلوب سداده (يتبع الفلتر) كي ينطق النص الآلي نفس
             الرقم الظاهر على البطاقة — لا كامل الدين. */
          <IvrCallButton phone={digits} name={c.storeName || c.name}
            fields={{ name: c.storeName || c.name, amount: headline, overdue: c.overdue, wallet: c.walletBalance,
              invoices_count: c.invCnt, oldest_days: c.oldestDays, last_shipment: c.lastShipmentAt }}
            label size={13} style={{ flex: 1, justifyContent: 'center', padding: '8px 0', fontSize: 12, fontWeight: 700 }}/>
        )}
        {digits && onWa && (
          <button onClick={() => onWa(c)} title="إطلاق حملة واتساب لهذا العميل (قالب معتمد)"
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            padding: '8px 0', borderRadius: 8, background: 'color-mix(in srgb, var(--green) 12%, transparent)',
            border: '1px solid color-mix(in srgb, var(--green) 35%, transparent)',
            color: 'var(--green)', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
            <MessageCircle size={13}/> حملة واتساب
          </button>
        )}
        {digits && waChat && (
          <a href={waChat} target="_blank" rel="noreferrer" title="محادثة يدوية (بلا قالب)"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 9px', borderRadius: 8,
            background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', textDecoration: 'none' }}>
            💬
          </a>
        )}
        {!digits && <span style={{ flex: 1, textAlign: 'center', fontSize: 11, color: 'var(--muted2)' }}>لا هاتف — اربط المتجر في /merchants</span>}
        <button onClick={toggleInvoices} title={c.invCnt > 0 ? 'الفواتير المفتوحة' : 'تفاصيل الرصيد'}
          style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '8px 10px', borderRadius: 8,
            background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', cursor: 'pointer', fontSize: 11.5 }}>
          {c.invCnt > 0 ? 'الفواتير' : 'تفاصيل الرصيد'} <ChevronDown size={12} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}/>
        </button>
      </div>

      {open && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          {invs == null ? <div style={{ textAlign: 'center', padding: 8 }}><Spinner size={16}/></div>
            : !invs.length ? <div style={{ fontSize: 11, color: 'var(--muted2)' }}>هذا رصيد افتتاحي/داخلي ولا توجد له فاتورة زوهو مفتوحة.</div>
            : invs.map(inv => (
              <div key={inv.invoice_number} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', fontSize: 11.5 }}>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>{inv.invoice_number}</span>
                <span style={{ color: 'var(--muted2)' }}>استحقاق {inv.due_date || inv.date}</span>
                <span style={{ marginInlineStart: 'auto', fontSize: 10, color: 'var(--muted)' }}>{zohoStatusAr(inv.status)}</span>
                {inv.allocatedCredit > 0.005 && (
                  <span style={{ fontSize: 10, color: 'var(--green)', whiteSpace: 'nowrap' }}>
                    بعد دائن −{fmt(inv.allocatedCredit)}
                  </span>
                )}
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{fmt(inv.balance)}</span>
              </div>
            ))}
        </div>
      )}

      {digits && (
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <CustomerCallLog phone={digits}/>
          <TagButton phone={digits} name={c.storeName || c.name}
            suggest={[...(c.owed > 0.5 ? ['عليه مديونية'] : []), ...(c.oldestDays > 90 ? ['متأخر 90 يوم'] : []), ...(c.billingType === 'دفع مسبق' ? ['دفع مسبق'] : [])]}/>
        </div>
      )}
      {digits && <div style={{ marginTop: 4 }}><CustomerCommTimeline phone={digits}/></div>}
    </Card>
  );
}

function Chip({ color, children }) {
  return (
    <span style={{ padding: '2px 8px', borderRadius: 999, fontWeight: 700, whiteSpace: 'nowrap',
      color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}>
      {children}
    </span>
  );
}

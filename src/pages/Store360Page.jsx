import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, BadgeDollarSign, Building2, CalendarClock, CheckCircle2, ChevronLeft, CircleDollarSign,
  ExternalLink, HandCoins, ListChecks, MessageCircle, PackageSearch, PhoneCall,
  Power, PowerOff, ReceiptText, Send, ShieldAlert, ShoppingBag, Target, Truck, WalletCards,
} from 'lucide-react';
import { Btn, Card, Empty, Modal, Spinner, toast } from '../components/UI.jsx';
import IvrCallButton from '../components/IvrCallButton.jsx';
import { MobileActionSheet } from '../components/MobileUX.jsx';
import { ActionResult } from '../components/operations/BulkPreflightDialog.jsx';
import { useAuth } from '../lib/auth.jsx';
import { recordPlatformSalesActivity } from '../lib/retargetingService.js';
import { recordPromise } from '../lib/collectionsService.js';
import {
  loadStore360Core, loadStore360Finance, loadStore360Shipments,
  loadStore360Communications, loadStore360Timeline, loadStore360Work,
} from '../lib/store360Service.js';
import { buildStore360Url } from '../lib/store360Navigation.js';
import { STORE_TIMELINE_FILTERS } from '../lib/store360Timeline.js';
import {
  isLamhaStatusResultFresh, loadCachedLamhaStoreStatuses,
  loadLamhaStoreStatus, updateLamhaStoreStatus,
} from '../lib/lamhaStoreStatusService.js';
import { saveAudienceHandoff } from '../lib/agingOperations.js';
import { createSubmissionGuard, summarizeActionResults } from '../lib/operationalWorkflows.js';
import { moneyToMinorUnits } from '../lib/customerFinancialPosition.js';
import './store-360.css';

const VIEWS = [
  ['overview', 'نظرة عامة'], ['finance', 'المالية والفواتير'],
  ['work', 'المبيعات والتحصيل'], ['shipments', 'الشحنات والناقلون'],
  ['communications', 'التواصل'], ['timeline', 'النشاط الكامل'],
];
const VIEW_IDS = new Set(VIEWS.map(([id]) => id));
const OPEN_TASK_STAGES = new Set(['todo', 'contacted', 'promised', 'snoozed']);
const STAGE_AR = { todo: 'جديدة', contacted: 'تم التواصل', promised: 'وعد دفع', snoozed: 'مؤجلة', done: 'مكتملة', cancelled: 'ملغاة' };
const STATUS_AR = {
  overdue: 'متأخرة', open: 'مفتوحة', paid: 'مدفوعة', partially_paid: 'مدفوعة جزئيًا',
  over_credit_limit: 'تجاوزت الحد الائتماني', resolved: 'محلولة', closed: 'مغلقة',
  in_progress: 'قيد المعالجة', waiting_customer: 'بانتظار العميل', active: 'نشط', inactive: 'غير نشط',
};
const STATUS_LABEL = value => STATUS_AR[String(value || '').toLowerCase()] || value || 'غير متاحة';
const COMMUNICATION_KIND_LABELS = {
  campaign: 'حملة WhatsApp', voice_call: 'مكالمة هاتف', ivr: 'مكالمة IVR', handled: 'تولّى الفريق المحادثة',
};
const COMMUNICATION_STATUS_LABELS = {
  sent: 'أُرسلت', delivered: 'وصلت', read: 'قُرئت', replied: 'ردّ العميل', handled: 'تولاها الفريق', failed: 'فشلت',
};
const communicationTitle = row => {
  const raw = String(row?.title || '').trim();
  return !raw || raw === row?.kind || COMMUNICATION_KIND_LABELS[raw]
    ? (COMMUNICATION_KIND_LABELS[row?.kind] || COMMUNICATION_KIND_LABELS[raw] || raw || 'تواصل')
    : raw;
};
const MONEY = (value) => Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DATE = (value, withTime = false) => {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return date.toLocaleString('ar-SA', withTime
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { year: 'numeric', month: 'short', day: 'numeric' });
};
const AGE_LABEL = (days) => !days ? 'لا يوجد' : days <= 15 ? '0–15 يوم' : days <= 30 ? '16–30 يوم' : days <= 60 ? '31–60 يوم' : days <= 90 ? '61–90 يوم' : '+90 يوم';
const AGING_LABELS = { inv1_15: '1–15 يوم', inv16_30: '16–30 يوم', inv31_60: '31–60 يوم', inv61_90: '61–90 يوم', inv90p: '+90 يوم', opening: 'رصيد افتتاحي' };
const EMPTY_LAMHA_STATUS = { state: 'idle', value: null, canCreateShipments: null, error: null };

function selectedAgingAmount(finance, keys = []) {
  const values = {
    inv1_15: finance?.aging?.b0_15,
    inv16_30: finance?.aging?.b16_30,
    inv31_60: finance?.aging?.b31_60,
    inv61_90: finance?.aging?.b61_90,
    inv90p: finance?.aging?.b90p,
    opening: finance?.aging?.opening,
  };
  return +keys.reduce((sum, key) => sum + Number(values[key] || 0), 0).toFixed(2);
}

function safeReturnTo(value, fallback = '/customers') {
  return value?.startsWith('/') && !value.startsWith('//') ? value : fallback;
}

function useLamhaAccountStatus(isAdmin, storeId, localStatus) {
  const [status, setStatus] = useState(EMPTY_LAMHA_STATUS);
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const id = Number(storeId);
    if (!isAdmin || !Number.isSafeInteger(id) || id <= 0) {
      setStatus({ ...EMPTY_LAMHA_STATUS, state: isAdmin ? 'unavailable' : 'restricted' });
      return undefined;
    }
    if (refreshKey === 0) {
      const normalized = String(localStatus || '').trim().toLowerCase();
      const visualCanCreateShipments = ['active', 'نشط'].includes(normalized)
        ? true
        : ['inactive', 'غير نشط'].includes(normalized) ? false : null;
      setStatus({ state: 'cache-loading', value: localStatus || null, visualCanCreateShipments, canCreateShipments: null, error: null, source: 'local' });
      loadCachedLamhaStoreStatuses([id])
        .then(cached => {
          if (cancelled) return;
          const result = (cached.results || []).find(item => Number(item.storeId) === id);
          if (isLamhaStatusResultFresh(result)) {
            setStatus({ state: 'available', value: result.store?.status || null, visualCanCreateShipments, canCreateShipments: result.store?.canCreateShipments ?? null, error: null, source: 'live-cache' });
          } else {
            setStatus({ state: 'unverified', value: localStatus || null, visualCanCreateShipments, canCreateShipments: null, error: result?.error || null, source: 'local' });
          }
        })
        .catch(() => {
          if (!cancelled) setStatus({ state: 'unverified', value: localStatus || null, visualCanCreateShipments, canCreateShipments: null, error: null, source: 'local' });
        });
      return () => { cancelled = true; };
    }
    setStatus({ ...EMPTY_LAMHA_STATUS, state: 'loading' });
    loadLamhaStoreStatus(id)
      .then(result => {
        if (!cancelled) setStatus({ state: 'available', value: result.store?.status || null, canCreateShipments: result.store?.canCreateShipments ?? null, error: null, source: 'live' });
      })
      .catch(error => {
        if (!cancelled) setStatus({ state: 'error', value: null, canCreateShipments: null, error: error.message });
      });
    return () => { cancelled = true; };
  }, [isAdmin, storeId, localStatus, refreshKey]);
  const refresh = useCallback(() => setRefreshKey(value => value + 1), []);
  return [status, setStatus, refresh];
}

function lamhaAccountLabel(status) {
  if (status.state === 'loading' || status.state === 'idle' || status.state === 'cache-loading') return 'حساب لمحة: جارٍ التحقق…';
  if (status.state === 'restricted') return 'حساب لمحة: يتطلب صلاحية مدير';
  if (status.state === 'error') return 'حساب لمحة: تعذر الفحص';
  if (status.state === 'unverified') return 'حساب لمحة: يحتاج فحصًا مباشرًا';
  if (status.canCreateShipments === true) return 'حساب لمحة: نشط';
  if (status.canCreateShipments === false) return 'حساب لمحة: غير نشط';
  return 'حساب لمحة: غير متاح من القراءة';
}

function SourceState({ value, compact = false }) {
  if (!value) return null;
  const unavailable = value.status === 'unavailable';
  return <div className={`s360-source ${unavailable ? 'is-error' : ''}`} title={value.error || ''}>
    <span className="s360-source-dot"/>
    <span>{unavailable ? 'المصدر غير متاح' : value.label}</span>
    {value.updatedAt ? <span>· {DATE(value.updatedAt, !compact)}</span> : null}
  </div>;
}

function LoadingBlock({ label = 'جارٍ تحميل هذا العرض…' }) {
  return <Card className="s360-loading"><Spinner size={18}/><span>{label}</span></Card>;
}

function UnavailableBlock({ source, onRetry }) {
  const sourceName = source?.label || 'بيانات هذا القسم';
  return <Card className="s360-unavailable">
    <ShieldAlert size={24}/>
    <div>
      <strong>تعذر تحديث {sourceName}</strong>
      <p>لن نعرض أصفارًا أو بيانات بديلة على أنها الحالة الحالية. يمكنك إعادة المحاولة، أو متابعة الأقسام التي تحمل مصدرًا سليمًا.</p>
      {source?.updatedAt ? <small>آخر بيانات معروفة: {DATE(source.updatedAt, true)}</small> : null}
      {source?.error ? <details className="s360-technical-details"><summary>التفاصيل التقنية</summary><code dir="ltr">{source.error}</code></details> : null}
    </div>
    {onRetry ? <Btn size="sm" variant="ghost" onClick={onRetry}>إعادة المحاولة</Btn> : null}
  </Card>;
}

function KpiCard({ label, value, detail, source, onClick, tone = 'default', loading = false, priority = 'primary' }) {
  return <button type="button" className={`s360-kpi tone-${tone} is-${priority}`} onClick={onClick} disabled={!onClick && !loading}>
    <span className="s360-kpi-label">{label}</span>
    <strong>{loading ? <Spinner size={17}/> : value}</strong>
    <span className="s360-kpi-detail">{detail || '—'}</span>
    <SourceState value={source} compact/>
    {onClick ? <span className="s360-drill">عرض التفاصيل <ChevronLeft size={12}/></span> : null}
  </button>;
}

function SectionHeader({ title, subtitle, source, action }) {
  return <div className="s360-section-header">
    <div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div>
    <div className="s360-section-meta">{source ? <SourceState value={source}/> : null}{action}</div>
  </div>;
}

function ActionButton({ icon: Icon, label, reason, onClick, external = false }) {
  const disabled = !onClick;
  return <button type="button" className="s360-action" onClick={onClick} disabled={disabled} title={disabled ? reason : label}>
    <span className="s360-action-icon"><Icon size={17}/></span>
    <span><b>{label}</b>{disabled && reason ? <small>{reason}</small> : null}</span>
    {external ? <ExternalLink size={12}/> : <ChevronLeft size={13}/>}
  </button>;
}

function SalesActionModal({ store, mode, onClose, onSaved }) {
  const tomorrow = new Date(Date.now() + 86_400_000);
  const local = new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  const [form, setForm] = useState({ outcome: mode === 'followup' ? 'needs_followup' : 'contacted', nextAt: local, note: '', activityType: 'call' });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!form.nextAt) return toast('حدّد موعد الإجراء التالي', 'error');
    setSaving(true);
    try {
      await recordPlatformSalesActivity({
        phone: store.phone, outcome: form.outcome, activityType: form.activityType,
        nextAt: new Date(form.nextAt).toISOString(), note: form.note.trim() || null, touch: mode !== 'followup',
      });
      toast(mode === 'followup' ? 'تمت جدولة المتابعة' : 'تم تسجيل نتيجة المبيعات', 'success');
      await onSaved?.(); onClose();
    } catch (error) { toast(`تعذر الحفظ: ${error.message}`, 'error'); }
    setSaving(false);
  };
  return <Modal title={mode === 'followup' ? `جدولة متابعة — ${store.storeName}` : `تسجيل نتيجة — ${store.storeName}`} onClose={onClose} width={520}>
    <div className="s360-form">
      {mode !== 'followup' ? <label>النتيجة<select value={form.outcome} onChange={e => setForm(current => ({ ...current, outcome: e.target.value }))}>
        <option value="contacted">تم التواصل</option><option value="interested">مهتم</option><option value="no_answer">لم يرد</option>
        <option value="needs_followup">يحتاج متابعة</option><option value="not_interested">غير مهتم</option><option value="price_issue">مشكلة سعر</option>
      </select></label> : null}
      <label>قناة التواصل<select value={form.activityType} onChange={e => setForm(current => ({ ...current, activityType: e.target.value }))}>
        <option value="call">مكالمة</option><option value="whatsapp">واتساب يدوي</option><option value="meeting">اجتماع</option><option value="email">بريد</option><option value="note">ملاحظة</option>
      </select></label>
      <label>موعد الإجراء التالي<input type="datetime-local" value={form.nextAt} onChange={e => setForm(current => ({ ...current, nextAt: e.target.value }))}/></label>
      <label>ملاحظة<textarea rows={3} value={form.note} onChange={e => setForm(current => ({ ...current, note: e.target.value }))}/></label>
      <p>يستخدم هذا الإجراء مسار المبيعات الحالي، ولا يرسل رسالة أو حملة.</p>
      <div className="s360-form-actions"><Btn variant="ghost" onClick={onClose}>إلغاء</Btn><Btn variant="accent" onClick={save} disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ'}</Btn></div>
    </div>
  </Modal>;
}

function PromiseModal({ task, contextAmount = null, contextLabel = '', currentBalance = null, onClose, onSaved }) {
  const taskBalance = Number(task?.debt_at_creation) || 0;
  const hasAgingContext = Number(contextAmount) > 0;
  const defaultAmount = hasAgingContext ? Number(contextAmount) : taskBalance || Number(currentBalance) || '';
  const [amount, setAmount] = useState(defaultAmount);
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!amount || !date) return toast('المبلغ والتاريخ مطلوبان', 'error');
    setSaving(true);
    try { await recordPromise(task.id, { amount, date, notes }); toast('تم تسجيل وعد التحصيل', 'success'); await onSaved?.(); onClose(); }
    catch (error) { toast(`تعذر تسجيل الوعد: ${error.message}`, 'error'); }
    setSaving(false);
  };
  return <Modal title={`وعد تحصيل — ${task.customer_name}`} onClose={onClose} width={460}>
    <div className="s360-form">
      <div className="s360-promise-balances" aria-label="مصادر مبلغ وعد التحصيل">
        {hasAgingContext ? <div className="is-selected"><span>رصيد الشريحة · {contextLabel}</span><b>{MONEY(contextAmount)} ر.س</b><small>المبلغ الافتراضي لهذا الإجراء</small></div> : null}
        <div><span>رصيد المهمة عند إنشائها</span><b>{MONEY(taskBalance)} ر.س</b><small>المصدر: collection_tasks.debt_at_creation</small></div>
        <div><span>إجمالي المتجر الحالي</span><b>{MONEY(currentBalance)} ر.س</b><small>المصدر: Zoho Books + محفظة لمحة</small></div>
      </div>
      <p>{hasAgingContext ? 'بدأ الإجراء من شريحة Aging؛ لذلك استُخدم مبلغ الشريحة افتراضيًا. يبقى رصيد المهمة التاريخي ظاهرًا للمقارنة.' : 'لم يبدأ الإجراء من شريحة Aging؛ استُخدم رصيد المهمة وقت إنشائها افتراضيًا.'}</p>
      <label>مبلغ الوعد<input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}/></label>
      <label>موعد الوعد<input type="date" value={date} onChange={e => setDate(e.target.value)}/></label>
      <label>ملاحظة<textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)}/></label>
      <div className="s360-form-actions"><Btn variant="ghost" onClick={onClose}>إلغاء</Btn><Btn variant="accent" onClick={save} disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'تسجيل الوعد'}</Btn></div>
    </div>
  </Modal>;
}

function StoreStatusConfirmModal({ store, finance, task, canCreateShipments, activate, busy, result, onClose, onConfirm }) {
  const activating = activate;
  return <Modal title={`${activating ? 'تشغيل' : 'إيقاف'} حساب لمحة`} onClose={busy ? undefined : onClose} width={460}>
    {result ? <ActionResult summary={result} title={activating ? 'نتيجة تشغيل حساب لمحة' : 'نتيجة إيقاف حساب لمحة'} onClose={onClose}/> : <div className="s360-status-confirm">
      <div className={`s360-status-confirm__icon ${activating ? 'is-active' : 'is-danger'}`}>{activating ? <Power size={24}/> : <PowerOff size={24}/>}</div>
      <div><b>{store.storeName}</b><span>Store ID: {store.storeId}</span></div>
      <p>{activating
        ? 'سيُعاد تشغيل حساب المتجر في لمحة فورًا. سيتم التحقق من الحالة بعد التنفيذ.'
        : 'سيُوقف حساب المتجر في لمحة فورًا ولن يتمكن من متابعة العمليات الجديدة حتى إعادة تشغيله.'}</p>
      <div className="s360-status-confirm__state"><span>الحالة الحالية</span><strong>{canCreateShipments === true ? 'نشط' : canCreateShipments === false ? 'غير نشط' : 'غير متاحة'}</strong></div>
      <div className="s360-status-confirm__state"><span>حالة الحساب المطلوبة</span><strong>{activating ? 'نشط' : 'غير نشط'}</strong></div>
      <div className="s360-status-confirm__state"><span>إنشاء الشحنات بعد التنفيذ</span><strong>{activating ? 'مسموح' : 'متوقف'}</strong></div>
      {!activating && finance ? <div className="s360-status-confirm__financial" aria-label="سياق القرار المالي">
        {moneyToMinorUnits(store.walletBalance) !== 0 ? <span><small>محفظة لمحة</small><b>{MONEY(store.walletBalance)} ر.س</b></span> : null}
        <span><small>القابل للتحصيل تشغيليًا</small><b>{MONEY(finance.operationalCollectible)} ر.س</b></span>
        <span><small>المتأخر</small><b>{MONEY(finance.overdue)} ر.س</b></span>
        <span><small>أقدم استحقاق</small><b>{Number(finance.oldestDays || 0)} يومًا</b></span>
        <span><small>الفواتير المفتوحة</small><b>{Number(finance.invoiceCount || 0)}</b></span>
      </div> : null}
      {!activating ? <div className="s360-status-confirm__collection"><span>آخر سياق تحصيل</span><strong>{task ? `${STAGE_AR[task.stage] || task.stage}${task.promise_date ? ` · وعد ${DATE(task.promise_date)}` : ''}` : 'لا توجد مهمة تحصيل مفتوحة'}</strong></div> : null}
      {!activating && finance?.balanceSyncIssue ? <div className="s360-status-confirm__warning"><AlertTriangle size={15}/><span>يوجد فرق مطابقة مالي. هذا التنبيه لا يغيّر صلاحية الإجراء اليدوي، لكنه يستحق المراجعة قبل التأكيد.</span></div> : null}
      {canCreateShipments == null ? <small>حالة الحساب الحالية غير متاحة من القراءة؛ سيُرسل أمر صريح ثم تتحقق المنصة من النتيجة.</small> : null}
      <div className="s360-form-actions"><Btn variant="ghost" onClick={onClose} disabled={busy}>إلغاء</Btn><Btn variant={activating ? 'accent' : 'danger'} onClick={() => onConfirm(activating)} disabled={busy}>{busy ? 'جارٍ التحقق…' : activating ? 'تشغيل الحساب' : 'إيقاف الحساب'}</Btn></div>
    </div>}
  </Modal>;
}

function ActionCenter({ core, work, can, isAdmin, changeView, currentUrl, onReloadWork, onOpenCampaign, lamhaStatus, setLamhaStatus, refreshLamhaStatus }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [modal, setModal] = useState(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusResult, setStatusResult] = useState(null);
  const statusSubmissionGuardRef = useRef(createSubmissionGuard());
  const closeMobileActions = useCallback(() => setMobileOpen(false), []);
  const store = core.store;
  const task = work?.activeTask;
  const salesAllowed = can('sales.manage');
  const promiseAllowed = can('collections.record_promise');
  const campaignAllowed = can('campaigns.send');
  const ivrAllowed = can('campaigns.ivr');
  const contextParams = new URLSearchParams(currentUrl.split('?')[1] || '');
  const agingKeys = (contextParams.get('aging') || '').split(',').filter(Boolean);
  const agingAmount = selectedAgingAmount(core.financial, agingKeys);
  const agingLabel = agingKeys.map(key => AGING_LABELS[key]).filter(Boolean).join(' + ');
  const validStoreId = Number.isSafeInteger(Number(store.storeId)) && Number(store.storeId) > 0;
  const runStoreStatusAction = async (activate) => statusSubmissionGuardRef.current.run(async () => {
    setStatusBusy(true); setStatusResult(null);
    try {
      const result = await updateLamhaStoreStatus(store.storeId, activate);
      setLamhaStatus({ state: 'available', value: result.store?.status || (activate ? 'active' : 'inactive'), canCreateShipments: result.store?.canCreateShipments ?? activate, error: null });
      setStatusResult(summarizeActionResults([{ key: store.storeId, label: store.storeName, status: 'success' }]));
      toast(activate ? 'تم تشغيل حساب المتجر في لمحة' : 'تم إيقاف حساب المتجر في لمحة', 'success');
    } catch (error) {
      setStatusResult(summarizeActionResults([{ key: store.storeId, label: store.storeName, status: 'failed', reason: error.message }]));
      toast(`تعذر تحديث حساب لمحة: ${error.message}`, 'error');
    } finally { setStatusBusy(false); }
  });
  const closeStatusModal = () => { setModal(null); setStatusResult(null); };
  const statusReason = !isAdmin ? 'هذا الإجراء متاح للمدير فقط'
    : !validStoreId ? 'لا يوجد Store ID صالح'
      : ['loading', 'cache-loading'].includes(lamhaStatus.state) ? 'جارٍ قراءة الحالة الحية من لمحة'
        : lamhaStatus.state === 'error' ? `تعذر قراءة الحالة: ${lamhaStatus.error}`
          : null;
  const accountStatusLabel = ['loading', 'cache-loading'].includes(lamhaStatus.state) ? 'جارٍ الفحص…'
    : lamhaStatus.state === 'error' ? 'تعذر الفحص'
      : lamhaStatus.state === 'unverified' ? 'لم تُفحص مباشرة'
      : lamhaStatus.canCreateShipments === true ? 'نشط'
        : lamhaStatus.canCreateShipments === false ? 'غير نشط'
          : 'غير متاحة من القراءة';
  const shipmentAccessLabel = lamhaStatus.canCreateShipments === true ? 'إنشاء الشحنات مسموح'
    : lamhaStatus.canCreateShipments === false ? 'إنشاء الشحنات متوقف'
      : lamhaStatus.state === 'unverified' && lamhaStatus.visualCanCreateShipments != null
        ? `الحالة البصرية: ${lamhaStatus.visualCanCreateShipments ? 'نشط' : 'غير نشط'} — يلزم فحص مباشر`
        : statusReason || 'افحص الحالة الحية قبل اتخاذ قرار الحساب';
  const actions = [
    { icon: Target, label: 'تسجيل نتيجة مبيعات', reason: !store.phone ? 'لا يوجد رقم تواصل' : !salesAllowed ? 'تحتاج صلاحية إدارة المبيعات' : null, onClick: store.phone && salesAllowed ? () => setModal('sales') : null },
    { icon: CalendarClock, label: 'جدولة متابعة', reason: !store.phone ? 'لا يوجد رقم تواصل' : !salesAllowed ? 'تحتاج صلاحية إدارة المبيعات' : null, onClick: store.phone && salesAllowed ? () => setModal('followup') : null },
    { icon: HandCoins, label: 'تسجيل وعد تحصيل', reason: !core.customerName ? 'لا يوجد حساب مالي مرتبط' : !task ? 'لا توجد مهمة تحصيل مفتوحة' : !promiseAllowed ? 'تحتاج صلاحية تسجيل وعد تحصيل' : null, onClick: core.customerName && task && promiseAllowed ? () => setModal('promise') : null },
    { icon: ReceiptText, label: 'فتح الفواتير', onClick: () => changeView('finance', { invoice: 'open' }) },
    { icon: WalletCards, label: 'فتح Aging', onClick: () => changeView('finance', { invoice: null }) },
    { icon: MessageCircle, label: 'بدء تواصل', reason: !store.phone ? 'لا يوجد رقم تواصل' : null, onClick: store.phone ? () => window.open(`https://wa.me/${String(store.phone).replace(/\D/g, '')}`, '_blank', 'noopener,noreferrer') : null, external: true },
    { icon: Truck, label: 'فتح الشحنات', onClick: () => changeView('shipments') },
    { icon: CircleDollarSign, label: 'التفاصيل المالية', onClick: () => changeView('finance') },
    { icon: Send, label: 'إنشاء حملة للمتجر', reason: !store.phone ? 'لا يوجد رقم تواصل' : !campaignAllowed ? 'تحتاج صلاحية الحملات' : null, onClick: store.phone && campaignAllowed ? onOpenCampaign : null },
  ];
  return <>
    <Card className="s360-action-center">
      <div className="s360-action-title"><div><ListChecks size={18}/><span><b>مركز الإجراءات</b><small>الإجراءات الحالية للمتجر من مكان واحد</small></span></div>
        <span className="s360-mobile-action-trigger"><Btn size="sm" variant="accent" onClick={() => setMobileOpen(true)}>الإجراءات</Btn></span>
      </div>
      <div className={`s360-lamha-status ${lamhaStatus.canCreateShipments === false ? 'is-inactive' : lamhaStatus.canCreateShipments === true ? 'is-active' : 'is-unknown'}`} aria-live="polite">
        <span className="s360-lamha-status__icon" aria-hidden="true">{lamhaStatus.canCreateShipments === false ? <PowerOff size={19}/> : <Power size={19}/>}</span>
        <span className="s360-lamha-status__copy">
          <small>حالة حساب لمحة</small>
          <b>{accountStatusLabel}</b>
          <em>{shipmentAccessLabel}</em>
        </span>
        <span className="s360-lamha-status__actions">
          {lamhaStatus.canCreateShipments === true ? <button
            type="button"
            className="s360-lamha-status__action is-stop"
            onClick={() => setModal('store-deactivate')}
            aria-label={`إيقاف المتجر ${store.storeName} في لمحة`}
          >إيقاف الحساب</button> : null}
          {lamhaStatus.canCreateShipments === false ? <button
            type="button"
            className="s360-lamha-status__action is-start"
            onClick={() => setModal('store-activate')}
            aria-label={`تشغيل المتجر ${store.storeName} في لمحة`}
          >تشغيل الحساب</button> : null}
          {lamhaStatus.canCreateShipments == null ? <button
            type="button"
            className="s360-lamha-status__action"
            onClick={['loading', 'cache-loading'].includes(lamhaStatus.state) || !isAdmin || !validStoreId ? undefined : refreshLamhaStatus}
            disabled={['loading', 'cache-loading'].includes(lamhaStatus.state) || !isAdmin || !validStoreId}
            aria-label={`إعادة فحص حالة حساب ${store.storeName} في لمحة`}
          >{lamhaStatus.state === 'loading' ? 'جارٍ الفحص…' : 'فحص مباشر'}</button> : null}
        </span>
      </div>
      <div className="s360-actions-desktop">{actions.map(item => <ActionButton key={item.label} {...item}/>)}</div>
      <div className="s360-ivr-slot">{store.phone && ivrAllowed
        ? <IvrCallButton phone={store.phone} name={store.storeName} fields={{ name: store.storeName, amount: core.financial?.operationalCollectible || 0 }} label labelText="تشغيل IVR"/>
        : <ActionButton icon={PhoneCall} label="تشغيل IVR" reason={!store.phone ? 'لا يوجد رقم تواصل' : 'تحتاج صلاحية تشغيل IVR'}/>}</div>
    </Card>
    <MobileActionSheet open={mobileOpen} title="إجراءات المتجر" eyebrow={store.storeName} onClose={closeMobileActions}>
      {actions.map(item => <ActionButton key={item.label} {...item} onClick={item.onClick ? () => { closeMobileActions(); item.onClick(); } : null}/>)}
      {store.phone && ivrAllowed
        ? <IvrCallButton phone={store.phone} name={store.storeName} fields={{ name: store.storeName, amount: core.financial?.operationalCollectible || 0 }} label labelText="تشغيل IVR" style={{ width: '100%', justifyContent: 'center', minHeight: 46 }}/>
        : <ActionButton icon={PhoneCall} label="تشغيل IVR" reason={!store.phone ? 'لا يوجد رقم تواصل' : 'تحتاج صلاحية تشغيل IVR'}/>}
    </MobileActionSheet>
    {modal === 'sales' || modal === 'followup' ? <SalesActionModal store={store} mode={modal} onClose={() => setModal(null)} onSaved={onReloadWork}/> : null}
    {modal === 'promise' && task ? <PromiseModal task={task} contextAmount={agingAmount || null} contextLabel={agingLabel} currentBalance={core.financial?.operationalCollectible} onClose={() => setModal(null)} onSaved={onReloadWork}/> : null}
    {modal === 'store-activate' || modal === 'store-deactivate' ? <StoreStatusConfirmModal store={store} finance={core.financial} task={task} canCreateShipments={lamhaStatus.canCreateShipments} activate={modal === 'store-activate'} busy={statusBusy} result={statusResult} onClose={closeStatusModal} onConfirm={runStoreStatusAction}/> : null}
  </>;
}

function DecisionPanel({ core, work, lamhaStatus, changeView, onOpenReconciliation }) {
  const finance = core.financial;
  const financeUnavailable = core.sources.finance?.status === 'unavailable';
  let tone = 'success';
  let icon = <CheckCircle2 size={22}/>;
  let eyebrow = 'قرار اليوم';
  let title = 'لا يوجد إجراء مالي عاجل ظاهر';
  let detail = 'يمكن متابعة نشاط المتجر أو فتح سجل التواصل من نفس الملف.';
  let actionLabel = 'فتح العمل والنشاط';
  let onAction = () => changeView('work');

  if (financeUnavailable) {
    tone = 'unavailable'; icon = <ShieldAlert size={22}/>; eyebrow = 'حالة المصدر';
    title = 'البيانات المالية غير متاحة';
    detail = 'يعرض النظام آخر ما هو معروف ولا يحول تعذر المصدر إلى رصيد صفر.';
    actionLabel = 'فتح تفاصيل المالية'; onAction = () => changeView('finance');
  } else if (finance?.balanceSyncIssue) {
    tone = 'danger'; icon = <AlertTriangle size={22}/>; eyebrow = 'مطابقة الأرصدة';
    title = 'رصيد المتجر بين لمحة وZoho يحتاج مراجعة';
    detail = 'افتح المطابقة لهذا المتجر قبل اتخاذ إجراء تحصيل أو قرار حساب.';
    actionLabel = 'مراجعة المطابقة'; onAction = onOpenReconciliation;
  } else if (Number(finance?.overdue || 0) > 0 && lamhaStatus.canCreateShipments === true) {
    tone = 'warning'; icon = <AlertTriangle size={22}/>; eyebrow = 'قرار حساب لمحة';
    title = `الحساب نشط وعليه ${MONEY(finance.overdue)} ر.س متأخرة`;
    detail = work?.activeTask
      ? `مهمة التحصيل الحالية: ${STAGE_AR[work.activeTask.stage] || work.activeTask.stage}. راجعها قبل إيقاف الحساب.`
      : 'لا توجد مهمة تحصيل مفتوحة؛ راجع المستحقات ثم استخدم إجراء الحساب من الأعلى.';
    actionLabel = 'فتح المالية والتحصيل'; onAction = () => changeView('finance');
  } else if (Number(finance?.overdue || 0) > 0 && !work?.activeTask) {
    tone = 'warning'; icon = <AlertTriangle size={22}/>; eyebrow = 'التحصيل';
    title = 'مستحقات متأخرة بلا مهمة تحصيل مفتوحة';
    detail = 'ابدأ الإجراء من مركز الإجراءات مع إبقاء مرحلة المبيعات مستقلة.';
    actionLabel = 'فتح المبيعات والتحصيل'; onAction = () => changeView('work');
  } else if (work?.nextAction) {
    tone = 'info'; eyebrow = 'الإجراء المجدول';
    title = work.nextAction.label || 'يوجد إجراء تالٍ';
    detail = `${work.nextAction.source || 'المتابعة'} · ${DATE(work.nextAction.at, true)}`;
    actionLabel = 'فتح الإجراء'; onAction = () => changeView('work');
  }

  return <Card className={`s360-decision-panel is-${tone}`}>
    <span className="s360-decision-panel__icon">{icon}</span>
    <div className="s360-decision-panel__copy"><small>{eyebrow}</small><strong>{title}</strong><p>{detail}</p></div>
    <button type="button" onClick={onAction}>{actionLabel}<ChevronLeft size={15}/></button>
  </Card>;
}

function OverviewView({ core, work, lamhaStatus, changeView, onOpenStore, onOpenCampaign, onOpenReconciliation, onOpenCarrierCenter }) {
  const finance = core.financial;
  return <div className="s360-view-stack">
    <section><SectionHeader title="ما يحتاج انتباه الآن" subtitle="قرار واحد واضح مبني على البيانات الحالية، دون تغيير قواعد العمل"/>
      <DecisionPanel core={core} work={work} lamhaStatus={lamhaStatus} changeView={changeView} onOpenReconciliation={onOpenReconciliation}/>
    </section>
    <section><SectionHeader title="حياة المتجر" subtitle="المالية والمبيعات والتحصيل تبقى مستقلة في التعريف، ومجتمعة في تجربة واحدة"/>
      <div className="s360-summary-grid">
        <Card><Target size={18}/><b>المبيعات</b><strong>{work?.sales?.account?.sales_stage || work?.sales?.account?.stage || 'لم تبدأ'}</strong><span>{work?.sales?.account?.owner_name || 'بلا مسؤول'}</span><button onClick={() => changeView('work')}>فتح المبيعات</button></Card>
        <Card><HandCoins size={18}/><b>التحصيل</b><strong>{work?.activeTask ? STAGE_AR[work.activeTask.stage] || work.activeTask.stage : 'لا توجد مهمة مفتوحة'}</strong><span>{work?.activeTask?.assignee_name || 'بلا محصل'}</span><button onClick={() => changeView('work')}>فتح التحصيل</button></Card>
        <Card><ReceiptText size={18}/><b>الفواتير</b><strong>{finance ? `${finance.invoiceCount} فاتورة` : core.sources.finance?.status === 'unavailable' ? 'المصدر غير متاح' : 'لا توجد بيانات مالية'}</strong><span>{finance ? `${MONEY(finance.operationalCollectible)} ر.س قابل للتحصيل` : 'لا يوجد حساب مالي مرتبط'}</span><button onClick={() => changeView('finance')}>فتح الفواتير</button></Card>
      </div>
    </section>
    <section><SectionHeader title="رحلات المتجر" subtitle="كل ما يخص هذا المتجر يبدأ من ملفه، بينما القوائم الجماعية تبقى لاكتشاف من يحتاج إجراء"/>
      <div className="s360-workflow-grid">
        <Card className={`s360-workflow-card ${finance?.balanceSyncIssue ? 'is-warning' : 'is-ready'}`}>
          <span className="s360-workflow-card__icon"><BadgeDollarSign size={19}/></span>
          <div><b>مطابقة لمحة مع Zoho</b><strong>{!finance ? 'لا يوجد ربط مالي موثق' : finance.balanceSyncIssue ? 'تحتاج مراجعة' : 'مطابقة الرصيد متاحة'}</strong><small>المطابقة تفتح على هذا المتجر فقط ولا تنشئ ربطًا تلقائيًا.</small></div>
          <button type="button" onClick={onOpenReconciliation}>فتح المطابقة <ChevronLeft size={14}/></button>
        </Card>
        <Card className="s360-workflow-card is-action">
          <span className="s360-workflow-card__icon"><Send size={19}/></span>
          <div><b>حملة وتواصل</b><strong>{finance?.operationalCollectible > 0 ? 'حملة تحصيل لهذا المتجر' : 'حملة تواصل لهذا المتجر'}</strong><small>ينتقل إلى المراجعة واختيار القالب والحماية قبل أي إرسال.</small></div>
          <button type="button" onClick={onOpenCampaign} disabled={!core.store.phone} title={!core.store.phone ? 'لا يوجد رقم تواصل موثق لهذا المتجر' : undefined}>{core.store.phone ? 'مراجعة الحملة' : 'لا يوجد رقم تواصل'} <ChevronLeft size={14}/></button>
        </Card>
        <Card className="s360-workflow-card">
          <span className="s360-workflow-card__icon"><Truck size={19}/></span>
          <div><b>الشحن والناقلون والعقود</b><strong>الشحنات هنا، والتدقيق في Carrier 360</strong><small>نتائج العقود والأسعار تبقى من محرك تدقيق الناقل المعتمد دون إعادة حساب.</small></div>
          <div className="s360-workflow-card__actions"><button type="button" onClick={() => changeView('shipments')}>شحنات المتجر</button><button type="button" onClick={onOpenCarrierCenter}>شركات الشحن والعقود</button></div>
        </Card>
      </div>
    </section>
    {core.sharedContactStores.length ? <section><SectionHeader title="متاجر تشترك في رقم التواصل" subtitle="تشابه رقم الاتصال لا يعني ملكية واحدة ولا تُجمع المبالغ بينها" source={core.sources.identity}/>
      <div className="s360-related-list">{core.sharedContactStores.map(store => <button key={store.storeId} type="button" onClick={() => onOpenStore(store)}>
        <ShoppingBag size={16}/><span><b>{store.storeName}</b><small>{store.storeId} · {store.status || 'حالة غير متاحة'}</small></span><ChevronLeft size={14}/>
      </button>)}</div>
    </section> : null}
  </div>;
}

function InvoiceDetailModal({ invoice, task, canRecordPromise, contextAmount, contextLabel, currentBalance, onClose, onSaved }) {
  const [promiseOpen, setPromiseOpen] = useState(false);
  if (!invoice) return null;
  if (promiseOpen && task) {
    return <PromiseModal
      task={task}
      contextAmount={contextAmount}
      contextLabel={contextLabel}
      currentBalance={currentBalance}
      onClose={() => setPromiseOpen(false)}
      onSaved={onSaved}
    />;
  }
  const promiseReason = !task
    ? 'لا توجد مهمة تحصيل مفتوحة لهذه الفاتورة'
    : !canRecordPromise
      ? 'تحتاج صلاحية تسجيل وعد تحصيل'
      : '';
  return <Modal title={`تفاصيل الفاتورة — ${invoice.invoice_number || 'فاتورة'}`} onClose={onClose} width={620}>
    <div className="s360-invoice-detail">
      <div className="s360-invoice-detail__grid">
        <div><span>رقم الفاتورة</span><b>{invoice.invoice_number || 'غير متاح'}</b></div>
        <div><span>الرصيد المكوّن للمبلغ</span><b>{MONEY(invoice.balance)} ر.س</b></div>
        <div><span>تاريخ الإصدار</span><b>{DATE(invoice.date)}</b></div>
        <div><span>تاريخ الاستحقاق</span><b>{DATE(invoice.due_date)}</b></div>
        <div><span>عمر الاستحقاق</span><b>{Number(invoice.age_days) || 0} يوم</b></div>
        <div><span>الحالة</span><b>{STATUS_LABEL(invoice.status || 'open')}</b></div>
      </div>
      <div className="s360-invoice-detail__collection">
        <strong>إجراء التحصيل الحالي</strong>
        <span>{task ? `${task.trigger || 'متابعة تحصيل'} · ${STAGE_AR[task.stage] || task.stage}` : 'لا توجد مهمة تحصيل مفتوحة'}</span>
        {promiseReason ? <small>{promiseReason}</small> : null}
      </div>
      <div className="s360-form-actions">
        <Btn variant="ghost" onClick={onClose}>إغلاق التفاصيل</Btn>
        <Btn variant="accent" onClick={task && canRecordPromise ? () => setPromiseOpen(true) : undefined} disabled={Boolean(promiseReason)}>تسجيل وعد تحصيل</Btn>
      </div>
    </div>
  </Modal>;
}

function FinanceView({ core, data, work, invoiceFocus, agingBuckets = [], canRecordPromise, onOpenInvoice, onCloseInvoice, onOpenAllAging, onOpenReconciliation, onReloadWork }) {
  if (data?.source?.status === 'unavailable') return <UnavailableBlock source={data.source}/>;
  const finance = core.financial;
  const activeTask = work?.activeTask;
  const selectedAgingLabel = agingBuckets.map(key => AGING_LABELS[key]).filter(Boolean).join(' + ');
  const selectedExpected = agingBuckets.length && data?.campaignAging
    ? +agingBuckets.reduce((sum, key) => sum + Number(data.campaignAging[key] || 0), 0).toFixed(2)
    : selectedAgingAmount(finance, agingBuckets);
  const displayedAging = {
    b0_15: finance?.aging?.b0_15,
    b16_30: finance?.aging?.b16_30,
    b31_60: finance?.aging?.b31_60,
    b61_90: finance?.aging?.b61_90,
    b90p: data?.campaignAging?.inv90p ?? finance?.aging?.b90p,
    opening: data?.campaignAging?.opening ?? finance?.aging?.opening,
  };
  const selectedInvoice = invoiceFocus && !['open', 'bucket'].includes(invoiceFocus)
    ? data?.invoices?.find(invoice => String(invoice.invoice_number) === String(invoiceFocus))
    : null;
  if (!finance) return <div className="s360-view-stack">
    <SectionHeader title="المالية والفواتير" subtitle="لا تُجمع مبالغ متاجر أخرى بسبب تشابه الهاتف" source={core.sources.finance}/>
    {core.sources.finance?.status === 'unavailable'
      ? <UnavailableBlock source={core.sources.finance}/>
      : <Card className="s360-unlinked-finance"><BadgeDollarSign size={24}/><div><b>لا توجد بيانات مالية مرتبطة بهذا المتجر</b><p>مصدر Zoho متاح، لكن Store ID الحالي لا يطابق حسابًا ماليًا في القراءة الحالية.</p></div></Card>}
  </div>;
  return <div className="s360-view-stack">
    <Card className={`s360-reconciliation-status ${finance.balanceSyncIssue ? 'is-warning' : 'is-match'}`}>
      <span>{finance.balanceSyncIssue ? <AlertTriangle size={21}/> : <CheckCircle2 size={21}/>}</span>
      <div><small>مطابقة رصيد المتجر بين لمحة وZoho</small><strong>{finance.balanceSyncIssue ? 'تحتاج مراجعة' : 'لا توجد مشكلة مطابقة ظاهرة'}</strong><p>الفتح مقيّد بهذا Store ID، ولا ينشئ ربطًا أو كتابة تلقائية.</p></div>
      <button type="button" onClick={onOpenReconciliation}>{finance.balanceSyncIssue ? 'مراجعة الفرق' : 'فتح المطابقة'}<ChevronLeft size={14}/></button>
    </Card>
    {agingBuckets.length ? <div className={`s360-aging-context ${moneyToMinorUnits(data?.selectedAmount) === moneyToMinorUnits(selectedExpected) ? 'is-match' : 'is-mismatch'}`}>
      <div><b>سياق Aging: {selectedAgingLabel}</b><span>يعرض هذا القسم السطور التي كوّنت مبلغ الشريحة فقط.</span></div>
      <strong>{MONEY(data?.selectedAmount)} / {MONEY(selectedExpected)} ر.س</strong>
    </div> : null}
    <section><SectionHeader title="المركز المالي" subtitle="الرصيد المحاسبي منفصل عن المبلغ المستخدم في إجراءات التحصيل" source={core.sources.finance} action={<Btn size="sm" variant="ghost" onClick={onOpenAllAging}>عرض كل العملاء في Aging</Btn>}/>
      <div className="s360-aging-grid" aria-label="تعريفات المركز المالي">
        <div><span>إجمالي الرصيد المحاسبي</span><b>{MONEY(finance.accountingOutstanding)} ر.س</b></div>
        <div><span>القابل للتحصيل تشغيليًا</span><b>{MONEY(finance.operationalCollectible)} ر.س</b></div>
        {moneyToMinorUnits(core.store.walletBalance) !== 0 ? <div><span>محفظة لمحة</span><b>{MONEY(core.store.walletBalance)} ر.س</b></div> : null}
        {moneyToMinorUnits(finance.residualBalance) !== 0 ? <div><span>الرصيد الهامشي / غير التشغيلي</span><b>{MONEY(finance.residualBalance)} ر.س</b>{moneyToMinorUnits(finance.creditOffset) !== 0 ? <small>منه {MONEY(finance.creditOffset)} ر.س رصيد دائن</small> : null}</div> : null}
      </div>
    </section>
    <section><SectionHeader title="تركيب القابل للتحصيل" subtitle="المبالغ تخص هذا المتجر المرتبط فقط" source={core.sources.finance}/>
      <div className="s360-aging-grid">
        {[['0–15', displayedAging.b0_15], ['16–30', displayedAging.b16_30], ['31–60', displayedAging.b31_60], ['61–90', displayedAging.b61_90], ['+90', displayedAging.b90p], ['رصيد افتتاحي', displayedAging.opening]].map(([label, value]) => <div key={label}><span>{label}</span><b>{MONEY(value)} ر.س</b></div>)}
      </div>
    </section>
    <section id="invoices"><SectionHeader title="الفواتير المكونة للمبلغ" subtitle={`${data?.invoices?.length || 0} فاتورة${data?.openingRows?.length ? ' + رصيد افتتاحي' : ''}`} source={data?.source}/>
      {data?.openingRows?.map((row, index) => <Card className="s360-opening-row" key={row.line_id || `opening-${index}`}><div><BadgeDollarSign size={17}/><span><b>رصيد افتتاحي غير مدفوع</b><small>تاريخ السطر {DATE(row.due_date)}</small></span></div><strong>{MONEY(row.balance)} ر.س</strong></Card>)}
      {!data?.invoices?.length ? <Empty icon="✓" title="لا توجد فواتير مفتوحة" sub="لا يعرض النظام صفرًا عند تعذر المصدر"/> : <div className="s360-card-list">{data.invoices.map(invoice => {
        const focused = invoiceFocus && invoiceFocus !== 'open' && String(invoice.invoice_number) === invoiceFocus;
        return <button type="button" key={invoice.invoice_number || `${invoice.date}-${invoice.balance}`} className={`s360-invoice-row${focused ? ' is-focused' : ''}`} onClick={() => onOpenInvoice(invoice)}>
          <div><ReceiptText size={17}/><span><b>{invoice.invoice_number || 'فاتورة'}</b><small>صدرت {DATE(invoice.date)} · تستحق {DATE(invoice.due_date)}</small></span></div>
          <div><b>{MONEY(invoice.balance)} ر.س</b><small>{STATUS_LABEL(invoice.status || 'open')}</small><span className="s360-invoice-row__open">فتح التفاصيل <ChevronLeft size={12}/></span></div>
        </button>;
      })}</div>}
    </section>
    <section><SectionHeader title="التحصيل الحالي" source={work?.sources?.collections}/>
      <Card className="s360-info-card">{activeTask ? <><div><b>المهمة</b><span>{activeTask.trigger || 'متابعة تحصيل'}</span></div><div><b>المرحلة</b><span>{STAGE_AR[activeTask.stage] || activeTask.stage}</span></div><div><b>المحصل</b><span>{activeTask.assignee_name || 'بلا محصل'}</span></div><div><b>الوعد</b><span>{activeTask.promise_date ? `${MONEY(activeTask.promise_amount)} ر.س · ${DATE(activeTask.promise_date)}` : 'لا يوجد وعد حالي'}</span></div></> : <span>لا توجد مهمة تحصيل مفتوحة لهذا الحساب.</span>}</Card>
    </section>
    <InvoiceDetailModal
      invoice={selectedInvoice}
      task={activeTask}
      canRecordPromise={canRecordPromise}
      contextAmount={agingBuckets.length ? Number(data?.selectedAmount || selectedExpected) : null}
      contextLabel={selectedAgingLabel}
      currentBalance={finance?.operationalCollectible}
      onClose={onCloseInvoice}
      onSaved={onReloadWork}
    />
  </div>;
}

function WorkView({ data }) {
  const account = data?.sales?.account || {};
  const activities = data?.sales?.activities || [];
  const task = data?.activeTask;
  return <div className="s360-work-grid">
    <section><SectionHeader title="المبيعات" subtitle="مرحلة المبيعات مستقلة عن التحصيل" source={data?.sources?.sales}/>
      <Card className="s360-info-card"><div><b>المرحلة</b><span>{account.sales_stage || account.stage || 'لم تبدأ'}</span></div><div><b>المسؤول</b><span>{account.owner_name || 'بلا مسؤول'}</span></div><div><b>آخر نتيجة</b><span>{activities[0]?.outcome || activities[0]?.result || 'لا توجد نتيجة'}</span></div><div><b>المتابعة القادمة</b><span>{DATE(account.next_action_at, true)}</span></div></Card>
    </section>
    <section><SectionHeader title="التحصيل" subtitle="مرحلة التحصيل لا تغيّر مرحلة المبيعات" source={data?.sources?.collections}/>
      <Card className="s360-info-card">{task ? <><div><b>المهمة</b><span>{task.trigger || 'متابعة تحصيل'}</span></div><div><b>المرحلة</b><span>{STAGE_AR[task.stage] || task.stage}</span></div><div><b>المحصل</b><span>{task.assignee_name || 'بلا محصل'}</span></div><div><b>آخر وعد</b><span>{task.promise_amount ? `${MONEY(task.promise_amount)} ر.س` : 'لا يوجد'}</span></div><div><b>موعد الوعد</b><span>{DATE(task.promise_date)}</span></div><div><b>آخر إجراء</b><span>{DATE(task.updated_at, true)}</span></div></> : <span>لا توجد مهمة تحصيل مفتوحة.</span>}</Card>
    </section>
  </div>;
}

function ShipmentsView({ data, page, onPage, onOpenCarrierCenter }) {
  if (data?.source?.status === 'unavailable') return <UnavailableBlock source={data.source}/>;
  const pages = Math.max(1, Math.ceil((data?.count || 0) / 20));
  return <section><SectionHeader title="الشحنات والناقلون" subtitle="هذا القسم من آخر snapshot لشحنات لمحة ويطابق اسم المتجر؛ مؤشر الرأس المنفصل مصدره دليل المتاجر" source={data?.source} action={<Btn size="sm" variant="ghost" onClick={onOpenCarrierCenter}>شركات الشحن والعقود</Btn>}/>
    {!data?.rows?.length ? <Empty icon="📦" title="لا توجد شحنات مطابقة في مصدر شحنات لمحة" sub="قد يعرض دليل المتاجر عددًا وآخر شحنة من مصدر مختلف؛ مصدر الشحنات الحالية لا يحمل Store ID ويعتمد اسم المتجر"/> : <div className="s360-card-list shipments">{data.rows.map(row => <article key={row.id}>
      <div><PackageSearch size={17}/><span><b>{row.awb || row.order_no || 'شحنة'}</b><small>{row.carrier_name || 'الناقل غير متاح'} · {DATE(row.order_date || row.pickup_at)}</small></span></div>
      <div><b>{row.order_status || 'الحالة غير متاحة'}</b>{row.delivered_at ? <small>تسليم {DATE(row.delivered_at)}</small> : null}</div>
    </article>)}</div>}
    {pages > 1 ? <div className="s360-pagination"><Btn size="sm" variant="ghost" disabled={page <= 0} onClick={() => onPage(page - 1)}>السابق</Btn><span>{page + 1} / {pages}</span><Btn size="sm" variant="ghost" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>التالي</Btn></div> : null}
  </section>;
}

function CommunicationView({ data, canCreateCampaign, onOpenCampaign }) {
  const communications = data?.communications || [];
  const kinds = communications.reduce((map, row) => map.set(row.kind, (map.get(row.kind) || 0) + 1), new Map());
  return <div className="s360-view-stack">
    <div className="s360-contact-notice">هذا السجل مرتبط <b>برقم التواصل</b>، وليس إثباتًا أن جميع أحداث الاتصال تخص هوية متجر مضمونة.</div>
    <section><SectionHeader title="التواصل" subtitle="WhatsApp وHatif وIVR والحملات والردود" source={data?.sources?.communications} action={<Btn size="sm" variant="accent" onClick={canCreateCampaign ? onOpenCampaign : undefined} disabled={!canCreateCampaign}>مراجعة حملة لهذا المتجر</Btn>}/>
      {data?.sources?.communications?.status === 'unavailable' ? <UnavailableBlock source={data.sources.communications}/> : <>
        <div className="s360-channel-grid">{[['campaign', 'حملات وWhatsApp'], ['voice_call', 'مكالمات Hatif'], ['ivr', 'IVR'], ['handled', 'محادثات تولّاها الفريق']].map(([key, label]) => <div key={key}><b>{kinds.get(key) || 0}</b><span>{label}</span></div>)}</div>
        <div className="s360-card-list compact">{communications.slice(0, 30).map((row, index) => <article key={row.id || `${row.occurred_at}-${index}`}><div><PhoneCall size={16}/><span><b>{communicationTitle(row)}</b><small>{row.detail || row.reply_body || 'لا توجد تفاصيل إضافية'}</small></span></div><div><b>{row.reply_intent || COMMUNICATION_STATUS_LABELS[row.status] || row.status || 'مسجل'}</b><small>{DATE(row.occurred_at, true)}</small></div></article>)}</div>
      </>}
    </section>
  </div>;
}

function TimelineView({ data }) {
  const [filter, setFilter] = useState('all');
  const rows = filter === 'all' ? data?.rows || [] : (data?.rows || []).filter(row => row.group === filter);
  return <section><SectionHeader title="النشاط الكامل" subtitle="Experience-level timeline؛ لا تُنشأ أحداث دون وقت فعلي"/>
    <div className="s360-timeline-filters" role="tablist" aria-label="تصفية النشاط">{STORE_TIMELINE_FILTERS.map(([id, label]) => <button type="button" role="tab" aria-selected={filter === id} key={id} onClick={() => setFilter(id)}>{label}</button>)}</div>
    {!rows.length ? <Empty icon="🕘" title="لا توجد أحداث مؤرخة" sub="الحالات الحالية بلا تاريخ لا تتحول إلى أحداث وهمية"/> : <div className="s360-timeline">{rows.map(row => <article key={row.id}>
      <div className={`s360-timeline-dot group-${row.group}`}/><div className="s360-timeline-time">{DATE(row.occurredAt, true)}</div>
      <Card><div className="s360-timeline-title"><b>{row.title}</b><span>{row.source}</span></div>{row.outcome ? <strong>{row.outcome}</strong> : null}{row.details ? <p>{row.details}</p> : null}{row.amount != null ? <div className="s360-event-amount">{MONEY(row.amount)} ر.س</div> : null}<footer>{row.actor ? <span>المسؤول: {row.actor}</span> : <span>المسؤول غير متاح</span>}{row.detailUrl ? <a href={row.detailUrl}>فتح التفاصيل <ChevronLeft size={12}/></a> : null}</footer></Card>
    </article>)}</div>}
  </section>;
}

export default function Store360Page({ identity }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { can, isAdmin } = useAuth();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const agingBuckets = useMemo(() => (params.get('aging') || '').split(',').filter(Boolean), [params]);
  const requestedView = params.get('view');
  const view = VIEW_IDS.has(requestedView) ? requestedView : 'overview';
  const [core, setCore] = useState(null);
  const [coreError, setCoreError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [work, setWork] = useState(null);
  const [workLoading, setWorkLoading] = useState(false);
  const [viewData, setViewData] = useState({});
  const [viewLoading, setViewLoading] = useState({});
  const [shipmentPage, setShipmentPage] = useState(0);
  const [lamhaStatus, setLamhaStatus, refreshLamhaStatus] = useLamhaAccountStatus(isAdmin, core?.store?.storeId, core?.store?.status);
  const currentUrl = `${location.pathname}${location.search}`;

  const loadCore = useCallback(async () => {
    setLoading(true); setCoreError(null); setCore(null); setWork(null); setViewData({}); setShipmentPage(0);
    try {
      const result = await loadStore360Core(identity);
      setCore(result);
      setWork(result.prefetchedWork || null);
      if (result.store?.phone) {
        loadStore360Communications({ phone: result.store.phone })
          .then(communications => setViewData(current => ({ ...current, communications })))
          .catch(() => {});
      }
    }
    catch (error) { setCoreError(error); }
    setLoading(false);
  }, [identity]);
  useEffect(() => { loadCore(); }, [loadCore]);

  const loadWork = useCallback(async () => {
    if (!core) return null;
    setWorkLoading(true);
    try { const result = await loadStore360Work({ phone: core.store.phone, customerName: core.customerName }); setWork(result); return result; }
    catch { setWork(null); return null; }
    finally { setWorkLoading(false); }
  }, [core]);
  useEffect(() => {
    if (core && (!core.prefetchedWork || view === 'work')) loadWork();
  }, [core, loadWork, view]);

  const loadView = useCallback(async (target, { force = false, page = shipmentPage } = {}) => {
    if (!core || target === 'overview' || (viewData[target] && !force && target !== 'shipments')) return;
    setViewLoading(current => ({ ...current, [target]: true }));
    try {
      let result;
      if (target === 'finance') result = await loadStore360Finance({ customerName: core.customerName, zohoId: core.financial?.zohoId, agingBuckets });
      if (target === 'shipments') result = await loadStore360Shipments({ storeName: core.store.storeName, page, pageSize: 20 });
      if (target === 'communications') result = await loadStore360Communications({ phone: core.store.phone });
      if (target === 'timeline') result = await loadStore360Timeline({ core });
      setViewData(current => ({ ...current, [target]: result }));
    } catch (error) { setViewData(current => ({ ...current, [target]: { source: { status: 'unavailable', label: target, error: error.message } } })); }
    setViewLoading(current => ({ ...current, [target]: false }));
  }, [core, shipmentPage, viewData, agingBuckets]);
  useEffect(() => { if (core && view !== 'work') loadView(view); }, [core, view, shipmentPage]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeView = useCallback((nextView, extras = {}) => {
    const next = new URLSearchParams(location.search);
    next.set('view', nextView);
    for (const [key, value] of Object.entries(extras)) value == null ? next.delete(key) : next.set(key, value);
    navigate(`${location.pathname}?${next.toString()}`);
  }, [location.pathname, location.search, navigate]);
  const goBack = () => navigate(safeReturnTo(params.get('returnTo')));

  if (loading) return <div className="s360-page"><LoadingBlock label="جارٍ تجهيز ملف المتجر…"/></div>;
  if (coreError) return <div className="s360-page"><button className="s360-back" onClick={goBack}><ArrowRight size={16}/> رجوع</button><Card className="s360-not-found"><Building2 size={36}/><h1>تعذر فتح ملف المتجر</h1><p>لم تصل بيانات الهوية الأساسية بصورة تسمح بعرض ملف موثوق. لم نعرض سجلًا ناقصًا على أنه Customer 360 مكتمل.</p>{coreError.message ? <details className="s360-technical-details"><summary>التفاصيل التقنية</summary><code dir="ltr">{coreError.message}</code></details> : null}<Btn variant="accent" onClick={loadCore}>إعادة المحاولة</Btn></Card></div>;

  const store = core.store;
  const finance = core.financial;
  const openCampaignReview = () => {
    const bucketMap = { b0_15: 'inv1_15', b16_30: 'inv16_30', b31_60: 'inv31_60', b61_90: 'inv61_90', b90p: 'inv90p', opening: 'opening' };
    const positiveAging = Object.entries(finance?.aging || {}).filter(([, amount]) => Number(amount) > 0).map(([key]) => bucketMap[key]).filter(Boolean);
    const collection = positiveAging.length > 0 && finance?.outstanding > 0;
    const context = collection ? {
      source: 'aging_operations', aging: positiveAging, filters: { store_id: store.storeId },
      selectionKeys: [`store:${store.storeId}`], snapshotAt: new Date().toISOString(),
      count: 1, totalAmount: Number(finance.operationalCollectible) || 0, returnTo: currentUrl,
    } : {
      source: 'store_360', storeId: store.storeId, storeName: store.storeName,
      manualRows: [{ phone: store.phone, name: store.storeName, amount: 0 }],
      snapshotAt: new Date().toISOString(), count: 1, returnTo: currentUrl,
    };
    const token = saveAudienceHandoff(context);
    navigate(`/campaigns?audienceContext=${encodeURIComponent(token)}&channel=whatsapp&step=5&returnTo=${encodeURIComponent(currentUrl)}`);
  };
  const openReconciliation = () => navigate(`/reconciliation?tab=zoho_live&store=${encodeURIComponent(store.storeId)}&search=${encodeURIComponent(store.storeName)}&returnTo=${encodeURIComponent(currentUrl)}`);
  const openCarrierCenter = () => navigate(`/hub?source=store360&returnTo=${encodeURIComponent(currentUrl)}`);
  const financeMissingLabel = core.sources.finance?.status === 'unavailable' ? 'المصدر غير متاح' : 'لا توجد بيانات مالية';
  const financeDetails = viewData.finance;
  const financeInvoiceCount = financeDetails?.invoiceCount ?? finance?.invoiceCount;
  const financeOpeningCount = financeDetails?.openingCount || 0;
  const openingOnly = Boolean(financeDetails && financeInvoiceCount === 0 && financeOpeningCount > 0);
  const financeDocumentDetail = finance
    ? `${financeInvoiceCount || 0} فاتورة مفتوحة${financeOpeningCount ? ` + ${financeOpeningCount} رصيد افتتاحي` : ''}`
    : 'لا يوجد حساب مالي مرتبط';
  const agingValue = openingOnly ? 'رصيد افتتاحي' : finance ? AGE_LABEL(finance.oldestDays) : financeMissingLabel;
  const agingDetail = openingOnly
    ? `${financeOpeningCount} رصيد افتتاحي غير مدفوع`
    : finance?.oldestDays ? `${finance.oldestDays} يوم` : finance ? 'لا يوجد استحقاق' : 'لا يوجد حساب مالي مرتبط';
  const sourceValues = Object.values(core.sources);
  const hasUnavailable = sourceValues.some(item => item.status === 'unavailable');
  const latestUpdate = sourceValues.map(item => item.updatedAt).filter(Boolean).sort().at(-1) || null;
  const communicationRows = viewData.communications?.communications || [];
  const latestCommunication = communicationRows[0] || null;
  const latestCampaign = communicationRows.find(row => row.kind === 'campaign') || null;
  return <div className="s360-page">
    <header className="s360-header">
      <button type="button" className="s360-back" onClick={goBack}><ArrowRight size={16}/> رجوع</button>
      <div className="s360-identity">
        <div className="s360-avatar">{(store.storeName || '?').trim().slice(0, 1)}</div>
        <div className="s360-identity-copy"><div className="s360-eyebrow">STORE 360</div><h1>{store.storeName}</h1><div className="s360-identifiers"><span><ShoppingBag size={13}/>{store.storeId || 'Store ID غير متاح'}</span><span dir="ltr"><PhoneCall size={13}/>{store.phone || 'الهاتف غير متاح'}</span></div></div>
      </div>
      <div className="s360-header-status">
        <span className={`s360-health ${hasUnavailable ? 'is-warning' : ''}`}>{hasUnavailable ? 'بعض المصادر غير متاحة' : 'المصادر الأساسية متاحة'}</span>
        <small>آخر تحديث: {DATE(latestUpdate, true)}</small>
      </div>
      <div className="s360-meta-chips"><span className={`s360-account-chip ${lamhaStatus.canCreateShipments === true ? 'is-active' : lamhaStatus.canCreateShipments === false ? 'is-inactive' : 'is-unknown'}`}>{lamhaAccountLabel(lamhaStatus)}</span><span>{store.billingType || 'نوع الفوترة غير متاح'}</span><span>{store.integrationType || 'التكامل غير متاح'}</span><span>{workLoading ? 'المسؤول…' : work?.owner || 'بلا مسؤول'}</span></div>
    </header>

    <ActionCenter core={core} work={work} can={can} isAdmin={isAdmin} changeView={changeView} currentUrl={currentUrl} onReloadWork={loadWork} onOpenCampaign={openCampaignReview} lamhaStatus={lamhaStatus} setLamhaStatus={setLamhaStatus} refreshLamhaStatus={refreshLamhaStatus}/>

    {latestCommunication ? <button type="button" className="s360-communication-summary" onClick={() => changeView('communications')}>
      <div><PhoneCall size={16}/><span><b>آخر تواصل</b><small>{communicationTitle(latestCommunication)} · {DATE(latestCommunication.occurred_at, true)}</small></span></div>
      <div><span><b>آخر حملة</b><small>{latestCampaign ? `${latestCampaign.title || 'حملة'} · ${DATE(latestCampaign.occurred_at, true)}` : 'لا توجد حملة سابقة'}</small></span><ChevronLeft size={14}/></div>
    </button> : null}

    <div className="s360-kpi-row">
      <KpiCard label="القابل للتحصيل" value={finance ? `${MONEY(finance.operationalCollectible)} ر.س` : financeMissingLabel} detail={financeDocumentDetail} source={core.sources.finance} tone="danger" onClick={() => changeView('finance')}/>
      <KpiCard label="المتأخر" value={finance ? `${MONEY(finance.overdue)} ر.س` : financeMissingLabel} detail={openingOnly ? 'رصيد افتتاحي غير مدفوع' : finance ? AGE_LABEL(finance.oldestDays) : 'لا يوجد حساب مالي مرتبط'} source={core.sources.finance} tone="warning" onClick={() => changeView('finance')}/>
      {moneyToMinorUnits(store.walletBalance) !== 0 ? <KpiCard label="محفظة لمحة" value={`${MONEY(store.walletBalance)} ر.س`} detail={store.walletBalance < 0 ? 'رصيد سالب يحتاج قرارًا تشغيليًا' : 'رصيد متاح في محفظة المتجر'} source={core.sources.identity} tone={store.walletBalance < 0 ? 'danger' : 'success'} onClick={() => changeView('finance')}/> : null}
      <KpiCard label="الإجراء التالي" value={workLoading ? 'جارٍ التحميل…' : work?.nextAction?.label || 'لا يوجد إجراء'} detail={work?.nextAction ? DATE(work.nextAction.at, true) : 'لا يوجد موعد حالي'} source={work?.nextAction?.source === 'التحصيل' ? work?.sources?.collections : work?.sources?.sales} loading={workLoading} onClick={() => changeView('work')}/>
      <KpiCard priority="secondary" label="أقدم استحقاق / Aging" value={agingValue} detail={agingDetail} source={core.sources.finance} onClick={() => changeView('finance')}/>
      <KpiCard priority="secondary" label="آخر دفعة" value={finance?.lastPaymentDate ? `${MONEY(finance.lastPaymentAmount)} ر.س` : finance ? 'لا توجد دفعة' : financeMissingLabel} detail={finance ? DATE(finance.lastPaymentDate) : 'لا يوجد حساب مالي مرتبط'} source={core.sources.payments} tone="success" onClick={() => changeView('finance')}/>
      {finance && moneyToMinorUnits(finance.residualBalance) !== 0 ? <KpiCard priority="secondary" label="الرصيد غير التشغيلي" value={`${MONEY(finance.residualBalance)} ر.س`} detail={moneyToMinorUnits(finance.creditOffset) !== 0 ? `يشمل ${MONEY(finance.creditOffset)} ر.س رصيدًا دائنًا` : 'رصيد هامشي لا يدخل التحصيل'} source={core.sources.finance} onClick={() => changeView('finance')}/> : null}
      <KpiCard priority="secondary" label="آخر شحنة · دليل المتاجر" value={store.lastShipmentAt ? DATE(store.lastShipmentAt) : 'لا توجد شحنة'} detail={`${store.shipmentCount} شحنة في دليل متاجر لمحة`} source={core.sources.identity} onClick={() => changeView('shipments')}/>
    </div>

    <main className="s360-main">
      {viewLoading[view] || (view === 'work' && workLoading) ? <LoadingBlock/> : null}
      {!viewLoading[view] && view === 'overview' ? <OverviewView core={core} work={work} lamhaStatus={lamhaStatus} changeView={changeView} onOpenCampaign={openCampaignReview} onOpenReconciliation={openReconciliation} onOpenCarrierCenter={openCarrierCenter} onOpenStore={target => {
        const targetUrl = buildStore360Url({ storeId: target.storeId, view: 'overview', returnTo: currentUrl, source: 'shared-contact' });
        if (targetUrl) navigate(targetUrl);
        else toast('تعذر فتح الملف لأن رقم المتجر غير موثّق', 'warning');
      }}/> : null}
      {!viewLoading[view] && view === 'finance' ? <FinanceView
        core={core}
        data={viewData.finance}
        work={work}
        invoiceFocus={params.get('invoice')}
        agingBuckets={agingBuckets}
        canRecordPromise={can('collections.record_promise')}
        onOpenInvoice={invoice => changeView('finance', { invoice: invoice.invoice_number })}
        onCloseInvoice={() => changeView('finance', { invoice: null })}
        onOpenAllAging={() => navigate(safeReturnTo(params.get('returnTo'), '/customer-money'))}
        onOpenReconciliation={openReconciliation}
        onReloadWork={loadWork}
      /> : null}
      {!viewLoading[view] && !workLoading && view === 'work' ? <WorkView data={work}/> : null}
      {!viewLoading[view] && view === 'shipments' ? <ShipmentsView data={viewData.shipments} page={shipmentPage} onPage={setShipmentPage} onOpenCarrierCenter={openCarrierCenter}/> : null}
      {!viewLoading[view] && view === 'communications' ? <CommunicationView data={viewData.communications} canCreateCampaign={Boolean(store.phone && can('campaigns.send'))} onOpenCampaign={openCampaignReview}/> : null}
      {!viewLoading[view] && view === 'timeline' ? <TimelineView data={viewData.timeline}/> : null}
    </main>
  </div>;
}

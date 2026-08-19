import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight, BadgeDollarSign, Building2, CalendarClock, ChevronLeft, CircleDollarSign,
  ExternalLink, HandCoins, LifeBuoy, ListChecks, MessageCircle, PackageSearch, PhoneCall,
  ReceiptText, Send, ShieldAlert, ShoppingBag, Target, TicketCheck, Truck, WalletCards, X,
} from 'lucide-react';
import { Btn, Card, Empty, Modal, Spinner, toast } from '../components/UI.jsx';
import IvrCallButton from '../components/IvrCallButton.jsx';
import { useAuth } from '../lib/auth.jsx';
import { recordPlatformSalesActivity } from '../lib/retargetingService.js';
import { recordPromise } from '../lib/collectionsService.js';
import {
  loadStore360Core, loadStore360Finance, loadStore360Shipments,
  loadStore360Support, loadStore360Timeline, loadStore360Work,
} from '../lib/store360Service.js';
import { STORE_TIMELINE_FILTERS } from '../lib/store360Timeline.js';
import './store-360.css';

const TicketCreateForm = lazy(() => import('../components/TicketCreateForm.jsx'));
const WhatsAppSendModal = lazy(() => import('../components/WhatsAppSendModal.jsx'));

const VIEWS = [
  ['overview', 'نظرة عامة'], ['finance', 'المالية والفواتير'],
  ['work', 'المبيعات والتحصيل'], ['shipments', 'الشحنات والناقلون'],
  ['support', 'الدعم والتواصل'], ['timeline', 'النشاط الكامل'],
];
const VIEW_IDS = new Set(VIEWS.map(([id]) => id));
const OPEN_TASK_STAGES = new Set(['todo', 'contacted', 'promised', 'snoozed']);
const STAGE_AR = { todo: 'جديدة', contacted: 'تم التواصل', promised: 'وعد دفع', snoozed: 'مؤجلة', done: 'مكتملة', cancelled: 'ملغاة' };
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
  return <Card className="s360-unavailable">
    <ShieldAlert size={24}/>
    <div><strong>المصدر غير متاح</strong><p>{source?.error || 'تعذر تحميل بيانات هذا القسم.'}</p></div>
    {onRetry ? <Btn size="sm" variant="ghost" onClick={onRetry}>إعادة المحاولة</Btn> : null}
  </Card>;
}

function KpiCard({ label, value, detail, source, onClick, tone = 'default', loading = false }) {
  return <button type="button" className={`s360-kpi tone-${tone}`} onClick={onClick} disabled={!onClick && !loading}>
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

function ActionCenter({ core, work, can, changeView, currentUrl, onReloadWork }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [modal, setModal] = useState(null);
  const [waOpen, setWaOpen] = useState(false);
  const store = core.store;
  const task = work?.activeTask;
  const salesAllowed = can('sales.manage');
  const promiseAllowed = can('collections.record_promise');
  const supportAllowed = can('support.create');
  const campaignAllowed = can('campaigns.send');
  const ivrAllowed = can('campaigns.ivr');
  const contextParams = new URLSearchParams(currentUrl.split('?')[1] || '');
  const agingKeys = (contextParams.get('aging') || '').split(',').filter(Boolean);
  const agingAmount = selectedAgingAmount(core.financial, agingKeys);
  const agingLabel = agingKeys.map(key => AGING_LABELS[key]).filter(Boolean).join(' + ');
  const actions = [
    { icon: Target, label: 'تسجيل نتيجة مبيعات', reason: !store.phone ? 'لا يوجد رقم تواصل' : !salesAllowed ? 'تحتاج صلاحية إدارة المبيعات' : null, onClick: store.phone && salesAllowed ? () => setModal('sales') : null },
    { icon: CalendarClock, label: 'جدولة متابعة', reason: !store.phone ? 'لا يوجد رقم تواصل' : !salesAllowed ? 'تحتاج صلاحية إدارة المبيعات' : null, onClick: store.phone && salesAllowed ? () => setModal('followup') : null },
    { icon: HandCoins, label: 'تسجيل وعد تحصيل', reason: !core.customerName ? 'لا يوجد حساب مالي مرتبط' : !task ? 'لا توجد مهمة تحصيل مفتوحة' : !promiseAllowed ? 'تحتاج صلاحية تسجيل وعد تحصيل' : null, onClick: core.customerName && task && promiseAllowed ? () => setModal('promise') : null },
    { icon: ReceiptText, label: 'فتح الفواتير', onClick: () => changeView('finance', { invoice: 'open' }) },
    { icon: WalletCards, label: 'فتح Aging', onClick: () => changeView('finance', { invoice: null }) },
    { icon: MessageCircle, label: 'بدء تواصل', reason: !store.phone ? 'لا يوجد رقم تواصل' : null, onClick: store.phone ? () => window.open(`https://wa.me/${String(store.phone).replace(/\D/g, '')}`, '_blank', 'noopener,noreferrer') : null, external: true },
    { icon: LifeBuoy, label: 'إنشاء/فتح تذكرة', reason: !supportAllowed ? 'تحتاج صلاحية إنشاء تذكرة' : null, onClick: supportAllowed ? () => setModal('ticket') : null },
    { icon: Truck, label: 'فتح الشحنات', onClick: () => changeView('shipments') },
    { icon: CircleDollarSign, label: 'التفاصيل المالية', onClick: () => changeView('finance') },
    { icon: Send, label: 'إضافة إلى حملة', reason: !store.phone ? 'لا يوجد رقم تواصل' : !campaignAllowed ? 'تحتاج صلاحية الحملات' : null, onClick: store.phone && campaignAllowed ? () => setWaOpen(true) : null },
  ];
  return <>
    <Card className="s360-action-center">
      <div className="s360-action-title"><div><ListChecks size={18}/><span><b>مركز الإجراءات</b><small>الإجراءات الحالية للمتجر من مكان واحد</small></span></div>
        <span className="s360-mobile-action-trigger"><Btn size="sm" variant="accent" onClick={() => setMobileOpen(true)}>الإجراءات</Btn></span>
      </div>
      <div className="s360-actions-desktop">{actions.map(item => <ActionButton key={item.label} {...item}/>)}</div>
      <div className="s360-ivr-slot">{store.phone && ivrAllowed
        ? <IvrCallButton phone={store.phone} name={store.storeName} fields={{ name: store.storeName, amount: core.financial?.outstanding || 0 }} label labelText="تشغيل IVR"/>
        : <ActionButton icon={PhoneCall} label="تشغيل IVR" reason={!store.phone ? 'لا يوجد رقم تواصل' : 'تحتاج صلاحية تشغيل IVR'}/>}</div>
    </Card>
    {mobileOpen ? <div className="s360-sheet-backdrop" onClick={() => setMobileOpen(false)}><div className="s360-action-sheet" role="dialog" aria-modal="true" aria-label="إجراءات المتجر" onClick={e => e.stopPropagation()}>
      <div className="s360-sheet-head"><b>إجراءات المتجر</b><button type="button" aria-label="إغلاق" onClick={() => setMobileOpen(false)}><X size={18}/></button></div>
      {actions.map(item => <ActionButton key={item.label} {...item} onClick={item.onClick ? () => { setMobileOpen(false); item.onClick(); } : null}/>)}
      {store.phone && ivrAllowed
        ? <IvrCallButton phone={store.phone} name={store.storeName} fields={{ name: store.storeName, amount: core.financial?.outstanding || 0 }} label labelText="تشغيل IVR" style={{ width: '100%', justifyContent: 'center', minHeight: 46 }}/>
        : <ActionButton icon={PhoneCall} label="تشغيل IVR" reason={!store.phone ? 'لا يوجد رقم تواصل' : 'تحتاج صلاحية تشغيل IVR'}/>}
    </div></div> : null}
    {modal === 'sales' || modal === 'followup' ? <SalesActionModal store={store} mode={modal} onClose={() => setModal(null)} onSaved={onReloadWork}/> : null}
    {modal === 'promise' && task ? <PromiseModal task={task} contextAmount={agingAmount || null} contextLabel={agingLabel} currentBalance={core.financial?.outstanding} onClose={() => setModal(null)} onSaved={onReloadWork}/> : null}
    {modal === 'ticket' ? <Modal title={`تذكرة — ${store.storeName}`} onClose={() => setModal(null)} width={760}><Suspense fallback={<LoadingBlock/>}><TicketCreateForm prefillPhone={store.phone} prefillStore={store} onClose={() => setModal(null)}/></Suspense></Modal> : null}
    {waOpen ? <Suspense fallback={null}><WhatsAppSendModal open recipients={[{ to: store.phone, name: store.storeName, amount: core.financial?.outstanding || 0, vars: [store.storeName, MONEY(core.financial?.outstanding)] }]} bucketLabel={`متجر 360 · ${store.storeName}`} onClose={() => setWaOpen(false)} onSent={() => setWaOpen(false)}/></Suspense> : null}
  </>;
}

function OverviewView({ core, work, changeView, onOpenStore }) {
  const finance = core.financial;
  return <div className="s360-view-stack">
    <section><SectionHeader title="ما يحتاج انتباه الآن" subtitle="الملخص لا يخلط مرحلة المبيعات بمرحلة التحصيل"/>
      <div className="s360-summary-grid">
        <Card><Target size={18}/><b>المبيعات</b><strong>{work?.sales?.account?.sales_stage || work?.sales?.account?.stage || 'لم تبدأ'}</strong><span>{work?.sales?.account?.owner_name || 'بلا مسؤول'}</span><button onClick={() => changeView('work')}>فتح المبيعات</button></Card>
        <Card><HandCoins size={18}/><b>التحصيل</b><strong>{work?.activeTask ? STAGE_AR[work.activeTask.stage] || work.activeTask.stage : 'لا توجد مهمة مفتوحة'}</strong><span>{work?.activeTask?.assignee_name || 'بلا محصل'}</span><button onClick={() => changeView('work')}>فتح التحصيل</button></Card>
        <Card><ReceiptText size={18}/><b>الفواتير</b><strong>{finance ? `${finance.invoiceCount} فاتورة` : core.sources.finance?.status === 'unavailable' ? 'المصدر غير متاح' : 'لا توجد بيانات مالية'}</strong><span>{finance ? `${MONEY(finance.outstanding)} ر.س مستحق` : 'لا يوجد حساب مالي مرتبط'}</span><button onClick={() => changeView('finance')}>فتح الفواتير</button></Card>
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
        <div><span>الحالة</span><b>{invoice.status || 'مفتوحة'}</b></div>
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

function FinanceView({ core, data, work, invoiceFocus, agingBuckets = [], canRecordPromise, onOpenInvoice, onCloseInvoice, onOpenAllAging, onReloadWork }) {
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
    {agingBuckets.length ? <div className={`s360-aging-context ${Math.abs(Number(data?.selectedAmount || 0) - selectedExpected) <= 0.01 ? 'is-match' : 'is-mismatch'}`}>
      <div><b>سياق Aging: {selectedAgingLabel}</b><span>يعرض هذا القسم السطور التي كوّنت مبلغ الشريحة فقط.</span></div>
      <strong>{MONEY(data?.selectedAmount)} / {MONEY(selectedExpected)} ر.س</strong>
    </div> : null}
    <section><SectionHeader title="تركيب المستحق" subtitle="المبالغ تخص هذا المتجر المرتبط فقط" source={core.sources.finance} action={<Btn size="sm" variant="ghost" onClick={onOpenAllAging}>عرض كل العملاء في Aging</Btn>}/>
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
          <div><b>{MONEY(invoice.balance)} ر.س</b><small>{invoice.status || 'مفتوحة'}</small><span className="s360-invoice-row__open">فتح التفاصيل <ChevronLeft size={12}/></span></div>
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
      currentBalance={finance?.outstanding}
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

function ShipmentsView({ data, page, onPage }) {
  if (data?.source?.status === 'unavailable') return <UnavailableBlock source={data.source}/>;
  const pages = Math.max(1, Math.ceil((data?.count || 0) / 20));
  return <section><SectionHeader title="الشحنات والناقلون" subtitle="هذا القسم من آخر snapshot لشحنات لمحة ويطابق اسم المتجر؛ مؤشر الرأس المنفصل مصدره دليل المتاجر" source={data?.source}/>
    {!data?.rows?.length ? <Empty icon="📦" title="لا توجد شحنات مطابقة في مصدر شحنات لمحة" sub="قد يعرض دليل المتاجر عددًا وآخر شحنة من مصدر مختلف؛ مصدر الشحنات الحالية لا يحمل Store ID ويعتمد اسم المتجر"/> : <div className="s360-card-list shipments">{data.rows.map(row => <article key={row.id}>
      <div><PackageSearch size={17}/><span><b>{row.awb || row.order_no || 'شحنة'}</b><small>{row.carrier_name || 'الناقل غير متاح'} · {DATE(row.order_date || row.pickup_at)}</small></span></div>
      <div><b>{row.order_status || 'الحالة غير متاحة'}</b>{row.delivered_at ? <small>تسليم {DATE(row.delivered_at)}</small> : null}</div>
    </article>)}</div>}
    {pages > 1 ? <div className="s360-pagination"><Btn size="sm" variant="ghost" disabled={page <= 0} onClick={() => onPage(page - 1)}>السابق</Btn><span>{page + 1} / {pages}</span><Btn size="sm" variant="ghost" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>التالي</Btn></div> : null}
  </section>;
}

function SupportView({ data }) {
  const openTickets = (data?.tickets || []).filter(ticket => !['resolved', 'closed'].includes(ticket.status));
  const communications = data?.communications || [];
  const kinds = communications.reduce((map, row) => map.set(row.kind, (map.get(row.kind) || 0) + 1), new Map());
  return <div className="s360-view-stack">
    <div className="s360-contact-notice">هذا السجل مرتبط <b>برقم التواصل</b>، وليس إثباتًا أن جميع أحداث الاتصال تخص هوية متجر مضمونة.</div>
    <section><SectionHeader title="التذاكر" subtitle={`${openTickets.length} مفتوحة`} source={data?.sources?.support}/>
      {data?.sources?.support?.status === 'unavailable' ? <UnavailableBlock source={data.sources.support}/> : !data?.tickets?.length ? <Empty icon="🎫" title="لا توجد تذاكر" sub="يمكن إنشاء تذكرة من مركز الإجراءات"/> : <div className="s360-card-list">{data.tickets.slice(0, 20).map(ticket => <article key={ticket.id}>
        <div><TicketCheck size={17}/><span><b>{ticket.ref || 'تذكرة'}</b><small>{ticket.title} · {DATE(ticket.createdAt)}</small></span></div><div><b>{ticket.status}</b><small>{ticket.assigneeName || 'غير مسندة'}</small></div>
      </article>)}</div>}
    </section>
    <section><SectionHeader title="التواصل" subtitle="WhatsApp وHatif وIVR والحملات والردود" source={data?.sources?.communications}/>
      {data?.sources?.communications?.status === 'unavailable' ? <UnavailableBlock source={data.sources.communications}/> : <>
        <div className="s360-channel-grid">{[['campaign', 'حملات وWhatsApp'], ['voice_call', 'مكالمات Hatif'], ['ivr', 'IVR'], ['handled', 'محادثات تولّاها الفريق']].map(([key, label]) => <div key={key}><b>{kinds.get(key) || 0}</b><span>{label}</span></div>)}</div>
        <div className="s360-card-list compact">{communications.slice(0, 30).map((row, index) => <article key={row.id || `${row.occurred_at}-${index}`}><div><PhoneCall size={16}/><span><b>{row.title || row.kind}</b><small>{row.detail || row.reply_body || '—'}</small></span></div><div><b>{row.status || row.reply_intent || 'مسجل'}</b><small>{DATE(row.occurred_at, true)}</small></div></article>)}</div>
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
  const { can } = useAuth();
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
  const currentUrl = `${location.pathname}${location.search}`;

  const loadCore = useCallback(async () => {
    setLoading(true); setCoreError(null); setCore(null); setWork(null); setViewData({}); setShipmentPage(0);
    try { setCore(await loadStore360Core(identity)); }
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
  useEffect(() => { if (core) loadWork(); }, [core, loadWork]);

  const loadView = useCallback(async (target, { force = false, page = shipmentPage } = {}) => {
    if (!core || target === 'overview' || (viewData[target] && !force && target !== 'shipments')) return;
    setViewLoading(current => ({ ...current, [target]: true }));
    try {
      let result;
      if (target === 'finance') result = await loadStore360Finance({ customerName: core.customerName, zohoId: core.financial?.zohoId, agingBuckets });
      if (target === 'shipments') result = await loadStore360Shipments({ storeName: core.store.storeName, page, pageSize: 20 });
      if (target === 'support') result = await loadStore360Support({ storeId: core.store.storeId, phone: core.store.phone });
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
  if (coreError) return <div className="s360-page"><button className="s360-back" onClick={goBack}><ArrowRight size={16}/> رجوع</button><Card className="s360-not-found"><Building2 size={36}/><h1>تعذر فتح ملف المتجر</h1><p>{coreError.message}</p><Btn variant="accent" onClick={loadCore}>إعادة المحاولة</Btn></Card></div>;

  const store = core.store;
  const finance = core.financial;
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
  const activeSource = view === 'finance' ? core.sources.finance : core.sources.identity;
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
      <div className="s360-meta-chips"><span>{store.status || 'حالة غير متاحة'}</span><span>{store.billingType || 'نوع الفوترة غير متاح'}</span><span>{store.integrationType || 'التكامل غير متاح'}</span><span>{workLoading ? 'المسؤول…' : work?.owner || 'بلا مسؤول'}</span></div>
    </header>

    <ActionCenter core={core} work={work} can={can} changeView={changeView} currentUrl={currentUrl} onReloadWork={loadWork}/>

    <div className="s360-kpi-row">
      <KpiCard label="المستحق" value={finance ? `${MONEY(finance.outstanding)} ر.س` : financeMissingLabel} detail={financeDocumentDetail} source={core.sources.finance} tone="danger" onClick={() => changeView('finance')}/>
      <KpiCard label="المتأخر" value={finance ? `${MONEY(finance.overdue)} ر.س` : financeMissingLabel} detail={openingOnly ? 'رصيد افتتاحي غير مدفوع' : finance ? AGE_LABEL(finance.oldestDays) : 'لا يوجد حساب مالي مرتبط'} source={core.sources.finance} tone="warning" onClick={() => changeView('finance')}/>
      <KpiCard label="أقدم استحقاق / Aging" value={agingValue} detail={agingDetail} source={core.sources.finance} onClick={() => changeView('finance')}/>
      <KpiCard label="آخر دفعة" value={finance?.lastPaymentDate ? `${MONEY(finance.lastPaymentAmount)} ر.س` : finance ? 'لا توجد دفعة' : financeMissingLabel} detail={finance ? DATE(finance.lastPaymentDate) : 'لا يوجد حساب مالي مرتبط'} source={core.sources.payments} tone="success" onClick={() => changeView('finance')}/>
      <KpiCard label="آخر شحنة · دليل المتاجر" value={store.lastShipmentAt ? DATE(store.lastShipmentAt) : 'لا توجد شحنة'} detail={`${store.shipmentCount} شحنة في دليل متاجر لمحة`} source={core.sources.identity} onClick={() => changeView('shipments')}/>
      <KpiCard label="الإجراء التالي" value={workLoading ? 'جارٍ التحميل…' : work?.nextAction?.label || 'لا يوجد إجراء'} detail={work?.nextAction ? DATE(work.nextAction.at, true) : 'لا يوجد موعد حالي'} source={work?.nextAction?.source === 'التحصيل' ? work?.sources?.collections : work?.sources?.sales} loading={workLoading} onClick={() => changeView('work')}/>
    </div>

    <nav className="s360-view-nav" aria-label="طريقة العرض">
      <label>طريقة العرض<select value={view} onChange={e => changeView(e.target.value)}>{VIEWS.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label>
      <div role="tablist">{VIEWS.map(([id, label]) => <button type="button" role="tab" aria-selected={view === id} key={id} onClick={() => changeView(id)}>{label}</button>)}</div>
      <SourceState value={activeSource}/>
    </nav>

    <main className="s360-main">
      {viewLoading[view] || (view === 'work' && workLoading) ? <LoadingBlock/> : null}
      {!viewLoading[view] && view === 'overview' ? <OverviewView core={core} work={work} changeView={changeView} onOpenStore={target => navigate(`/customer-360?customer=${encodeURIComponent(target.storeId)}&view=overview&returnTo=${encodeURIComponent(currentUrl)}`)}/> : null}
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
        onReloadWork={loadWork}
      /> : null}
      {!viewLoading[view] && !workLoading && view === 'work' ? <WorkView data={work}/> : null}
      {!viewLoading[view] && view === 'shipments' ? <ShipmentsView data={viewData.shipments} page={shipmentPage} onPage={setShipmentPage}/> : null}
      {!viewLoading[view] && view === 'support' ? <SupportView data={viewData.support}/> : null}
      {!viewLoading[view] && view === 'timeline' ? <TimelineView data={viewData.timeline}/> : null}
    </main>
  </div>;
}

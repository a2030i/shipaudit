import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, CalendarClock, Download, FileText, Megaphone, PhoneCall, Plus,
  Search, ShieldAlert, Trash2, UserRoundCog, WalletCards,
} from 'lucide-react';
import { CUSTOMER_CAMPAIGN_BUCKETS } from '../../lib/customerCampaignBuckets.js';
import { AGING_PAGE_SIZE } from '../../lib/agingOperations.js';
import useMobileLayout from '../../lib/useMobileLayout.js';
import { useWindowedRows } from '../../hooks/useWindowedRows.js';
import { ProgressiveListFooter } from '../MobileUX.jsx';
import { Money, NumberValue } from '../../design-system/EnterpriseUI.jsx';
import OperationalResultSet from './OperationalResultSet.jsx';
import { daysSinceLastShipment } from '../../lib/customerOperationalQuery.js';
import './aging-operations-queue.css';

const MONEY = value => `\u2066${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\u2069`;
const DATE = value => value ? new Date(value).toLocaleDateString('ar-SA', { day: 'numeric', month: 'short', year: 'numeric' }) : 'غير متاح';
const STAGE = { todo: 'جديدة', contacted: 'تم التواصل', promised: 'وعد دفع', snoozed: 'مؤجلة' };

const CONDITION_ORDER = [
  'aging', 'minDays', 'maxDays', 'minAmount', 'maxAmount', 'billing', 'wallet',
  'invoices', 'status', 'lastShipmentMinDays', 'lastShipmentMaxDays', 'shipmentState',
  'sharedContact', 'owner', 'collection', 'promise', 'contact', 'actionOnly',
];

function conditionIsActive(key, filters) {
  if (key === 'aging') return filters.aging?.size > 0;
  if (key === 'actionOnly') return filters.actionOnly === true;
  if (['minDays', 'maxDays', 'minAmount', 'maxAmount', 'lastShipmentMinDays', 'lastShipmentMaxDays'].includes(key)) return filters[key] !== '' && filters[key] != null;
  return !['', 'all', null, undefined].includes(filters[key]);
}

function NumericConditionInput({ value, onCommit, ...props }) {
  const [draft, setDraft] = useState(value ?? '');
  const timerRef = useRef(null);
  useEffect(() => setDraft(value ?? ''), [value]);
  useEffect(() => () => window.clearTimeout(timerRef.current), []);
  const schedule = next => {
    setDraft(next);
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => onCommit(next), 450);
  };
  const flush = () => {
    window.clearTimeout(timerRef.current);
    if (String(draft) !== String(value ?? '')) onCommit(draft);
  };
  return <input {...props} value={draft} onChange={event => schedule(event.target.value)} onBlur={flush} onKeyDown={event => { if (event.key === 'Enter') { flush(); event.currentTarget.blur(); } }}/>
}

function ConditionBuilder({ filters, assignees, onFilter }) {
  const [visible, setVisible] = useState(() => new Set(CONDITION_ORDER.filter(key => conditionIsActive(key, filters))));
  const [addKey, setAddKey] = useState('');
  useEffect(() => {
    const active = CONDITION_ORDER.filter(key => conditionIsActive(key, filters));
    if (!active.length) return;
    setVisible(current => {
      const next = new Set(current);
      active.forEach(key => next.add(key));
      return next.size === current.size ? current : next;
    });
  }, [filters]);
  const definitions = useMemo(() => ({
    aging: { label: 'عمر الفواتير المكوّنة للمبلغ', operator: 'ضمن', reset: () => onFilter('agingClear', true), control: <div className="aoq-condition__buckets">{CUSTOMER_CAMPAIGN_BUCKETS.map(bucket => <button type="button" key={bucket.key} aria-pressed={filters.aging.has(bucket.key)} onClick={() => onFilter('agingToggle', bucket.key)}><i style={{ background: bucket.color }}/>{bucket.label}</button>)}</div> },
    minDays: { label: 'أقدم استحقاق', operator: 'أكبر من', reset: '', control: <div className="aoq-unit-input"><NumericConditionInput aria-label="الحد الأدنى لعمر الاستحقاق" type="number" min="0" value={filters.minDays} onCommit={value => onFilter('minDays', value)} placeholder="30"/><b>يوم</b></div> },
    maxDays: { label: 'أقدم استحقاق', operator: 'حتى', reset: '', control: <div className="aoq-unit-input"><NumericConditionInput aria-label="الحد الأعلى لعمر الاستحقاق" type="number" min="0" value={filters.maxDays} onCommit={value => onFilter('maxDays', value)}/><b>يوم</b></div> },
    minAmount: { label: filters.minDays !== '' || filters.maxDays !== '' ? 'مبلغ الفواتير داخل العمر' : 'مبلغ النتائج', operator: 'من', reset: '', control: <div className="aoq-unit-input"><NumericConditionInput aria-label="الحد الأدنى للمبلغ" type="number" min="0" step="0.01" value={filters.minAmount} onCommit={value => onFilter('minAmount', value)} placeholder="100"/><b>ر.س</b></div> },
    maxAmount: { label: filters.minDays !== '' || filters.maxDays !== '' ? 'مبلغ الفواتير داخل العمر' : 'مبلغ النتائج', operator: 'حتى', reset: '', control: <div className="aoq-unit-input"><NumericConditionInput aria-label="الحد الأعلى للمبلغ" type="number" min="0" step="0.01" value={filters.maxAmount} onCommit={value => onFilter('maxAmount', value)}/><b>ر.س</b></div> },
    billing: { label: 'نوع الدفع', operator: 'يساوي', reset: 'all', control: <select aria-label="نوع الدفع" value={filters.billing} onChange={event => onFilter('billing', event.target.value)}><option value="all">اختر…</option><option value="prepaid">مسبق الدفع</option><option value="postpaid">دفع لاحق</option><option value="unknown">غير متاح</option></select> },
    wallet: { label: 'رصيد المحفظة', operator: 'حالته', reset: 'all', control: <select aria-label="حالة رصيد المحفظة" value={filters.wallet} onChange={event => onFilter('wallet', event.target.value)}><option value="all">اختر…</option><option value="positive">موجب (أكثر من 0.50)</option><option value="negative">سالب (أقل من -0.50)</option><option value="zero">صفري / هامشي</option></select> },
    invoices: { label: 'الفواتير', operator: 'حالته', reset: 'all', control: <select aria-label="حالة الفواتير" value={filters.invoices} onChange={event => onFilter('invoices', event.target.value)}><option value="all">اختر…</option><option value="open">لديه فواتير مفتوحة</option><option value="none">بلا فواتير مفتوحة</option></select> },
    status: { label: 'تشغيل حساب لمحة', operator: 'حالته', reset: 'all', control: <select aria-label="حالة تشغيل حساب لمحة" value={filters.status} onChange={event => onFilter('status', event.target.value)}><option value="all">اختر…</option><option value="active">يعمل حسب آخر مزامنة</option><option value="inactive">موقوف حسب آخر مزامنة</option><option value="unknown">غير متاح</option></select> },
    lastShipmentMinDays: { label: 'آخر شحنة', operator: 'مرّ عليها أكثر من', reset: '', control: <div className="aoq-unit-input"><NumericConditionInput aria-label="الحد الأدنى لأيام آخر شحنة" type="number" min="0" value={filters.lastShipmentMinDays} onCommit={value => onFilter('lastShipmentMinDays', value)} placeholder="5"/><b>يوم</b></div> },
    lastShipmentMaxDays: { label: 'آخر شحنة', operator: 'خلال', reset: '', control: <div className="aoq-unit-input"><NumericConditionInput aria-label="الحد الأعلى لأيام آخر شحنة" type="number" min="0" value={filters.lastShipmentMaxDays} onCommit={value => onFilter('lastShipmentMaxDays', value)}/><b>يوم</b></div> },
    shipmentState: { label: 'وجود شحنات', operator: 'حالته', reset: 'all', control: <select aria-label="حالة وجود آخر شحنة" value={filters.shipmentState || 'all'} onChange={event => onFilter('shipmentState', event.target.value)}><option value="all">اختر…</option><option value="exists">لديه شحنة سابقة</option><option value="none">لا توجد شحنة</option></select> },
    sharedContact: { label: 'متاجر بنفس رقم التواصل', operator: 'حالته', reset: 'all', control: <select aria-label="المتاجر المشتركة في رقم التواصل" value={filters.sharedContact || 'all'} onChange={event => onFilter('sharedContact', event.target.value)}><option value="all">اختر…</option><option value="with">له متاجر أخرى</option><option value="without">لا توجد متاجر أخرى</option></select> },
    owner: { label: 'المحصل', operator: 'مُسند إلى', reset: 'all', control: <select aria-label="المحصل" value={filters.owner} onChange={event => onFilter('owner', event.target.value)}><option value="all">اختر…</option><option value="unassigned">بلا مسؤول</option>{assignees.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select> },
    collection: { label: 'حالة التحصيل', operator: 'تساوي', reset: 'all', control: <select aria-label="حالة التحصيل" value={filters.collection} onChange={event => onFilter('collection', event.target.value)}><option value="all">اختر…</option><option value="no_task">بلا مهمة</option>{Object.entries(STAGE).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select> },
    promise: { label: 'وعد السداد', operator: 'حالته', reset: 'all', control: <select aria-label="حالة الوعد" value={filters.promise} onChange={event => onFilter('promise', event.target.value)}><option value="all">اختر…</option><option value="today">وعد اليوم</option><option value="overdue">وعد متأخر</option><option value="none">بلا وعد</option></select> },
    contact: { label: 'آخر تواصل', operator: 'كان', reset: 'all', control: <select aria-label="آخر تواصل" value={filters.contact} onChange={event => onFilter('contact', event.target.value)}><option value="all">اختر…</option><option value="7d">خلال 7 أيام</option><option value="30d">خلال 30 يومًا</option><option value="none">غير متاح</option></select> },
    actionOnly: { label: 'الحالة التشغيلية', operator: 'تساوي', reset: false, control: <button type="button" className={`aoq-condition__toggle${filters.actionOnly ? ' is-active' : ''}`} aria-pressed={filters.actionOnly} onClick={() => onFilter('actionOnly', !filters.actionOnly)}>يحتاج إجراء الآن</button> },
  }), [assignees, filters, onFilter]);
  const remove = key => {
    const definition = definitions[key];
    if (typeof definition.reset === 'function') definition.reset();
    else onFilter(key, definition.reset);
    setVisible(current => { const next = new Set(current); next.delete(key); return next; });
  };
  const available = CONDITION_ORDER.filter(key => !visible.has(key));
  return <section className="aoq-query-builder" aria-labelledby="aoq-query-title">
    <div className="aoq-query-builder__heading">
      <div><strong id="aoq-query-title">ضع شروطك وأنشئ قائمة التنفيذ</strong><span>لا توجد سيناريوهات مفروضة: أضف الشروط التي تحتاجها، وكلها تُطبّق معًا على النتائج أدناه.</span></div>
      <span className="aoq-query-builder__live"><i/> النتائج تتحدث تلقائيًا</span>
    </div>
    {visible.size ? <div className="aoq-condition-list">{CONDITION_ORDER.filter(key => visible.has(key)).map(key => <div className="aoq-condition" key={key}>
      <strong>{definitions[key].label}</strong><span>{definitions[key].operator}</span><div>{definitions[key].control}</div>
      <button type="button" className="aoq-condition__remove" onClick={() => remove(key)} aria-label={`حذف شرط ${definitions[key].label}`}><Trash2 size={15}/></button>
    </div>)}</div> : <div className="aoq-query-builder__empty">لا توجد شروط حاليًا؛ تعرض القائمة كل المبالغ القابلة للتحصيل. أضف أول شرط للبدء.</div>}
    <div className="aoq-query-builder__footer">
      <label className="aoq-add-condition"><Plus size={15}/><select value={addKey} onChange={event => { const key = event.target.value; setAddKey(''); if (key) setVisible(current => new Set(current).add(key)); }}><option value="">أضف شرطًا…</option>{available.map(key => <option key={key} value={key}>{definitions[key].label} — {definitions[key].operator}</option>)}</select></label>
      {visible.size ? <button type="button" onClick={() => { onFilter('clearAll', true); setVisible(new Set()); }}>مسح كل الشروط</button> : null}
    </div>
  </section>;
}

function RowCard({ row, selected, onSelect, onOpen, onInvoices }) {
  const { customer, summary, task } = row;
  const canOpenStore = !!customer.storeId;
  const shipmentDays = daysSinceLastShipment(customer.lastShipmentAt);
  const sharedCount = Number(customer.sharedContactStoreCount) || 0;
  return <article className={`aoq-card${selected ? ' is-selected' : ''}`}>
    <div className="aoq-card__select">
      <input type="checkbox" checked={selected} onChange={onSelect} aria-label={`تحديد ${customer.storeName || customer.name}`}/>
    </div>
    <div className="aoq-card__identity">
      <div><strong>{customer.storeName || customer.name}</strong><small>{customer.storeId ? `متجر #${customer.storeId}` : `Zoho #${customer.zohoId}`}</small></div>
      <div className="aoq-amount"><strong><Money value={summary.amount}/></strong><small>{summary.amount === customer.owed ? 'إجمالي القابل للتحصيل' : <>داخل الشروط · الإجمالي <Money value={customer.owed}/></>}</small></div>
    </div>
    <div className="aoq-card__facts">
      <span><b>{summary.invoiceCount}</b> فاتورة{summary.openingCount ? ' + رصيد افتتاحي' : ''}</span>
      <span>الأقدم <b>{summary.oldestDays} يومًا</b></span>
      <span>الدفع <b>{customer.billingType || 'غير متاح'}</b></span>
      <span>المحفظة <b><Money value={customer.walletBalance}/></b></span>
      <span>حساب لمحة <b>{customer.platformStatus || 'غير متاح'}</b></span>
      <span>آخر شحنة <b>{shipmentDays == null ? 'لا توجد' : `${shipmentDays} يومًا`}</b></span>
      {sharedCount ? <span className="aoq-shared-contact">متاجر الرقم <b>{sharedCount} أخرى</b></span> : null}
      <details className="aoq-card__secondary">
        <summary>تفاصيل التحصيل والتواصل</summary>
        <div>
          <span>آخر دفعة <b>{customer.lastPaymentDate ? DATE(customer.lastPaymentDate) : 'لا توجد'}</b></span>
          <span>آخر تواصل* <b>{row.lastCommunicationAt ? DATE(row.lastCommunicationAt) : 'غير متاح'}</b></span>
          <span>الوعد <b>{task?.promise_date ? <><Money value={task.promise_amount}/> · {DATE(task.promise_date)}</> : 'لا يوجد'}</b></span>
          <span>المحصل <b>{row.assignee || 'بلا مسؤول'}</b></span>
        </div>
      </details>
    </div>
    <div className="aoq-card__reason"><WalletCards size={15}/><span><b>سبب الظهور:</b> {row.reason}</span></div>
    <div className="aoq-card__decision">
      <div className="aoq-card__next"><span>الإجراء التالي</span><strong>{row.nextAction}</strong></div>
      <div className="aoq-card__actions">
        <button type="button" onClick={onOpen} disabled={!canOpenStore} title={canOpenStore ? 'فتح Store 360' : 'Store ID غير متاح'}>فتح الملف <ArrowLeft size={14}/></button>
        <button type="button" onClick={onInvoices} disabled={!canOpenStore} title={canOpenStore ? 'فتح الفواتير المكوّنة للمبلغ' : 'Store ID غير متاح'} aria-label="فتح الفواتير المكوّنة للمبلغ"><FileText size={14}/><span>الفواتير</span></button>
      </div>
    </div>
  </article>;
}

export default function AgingOperationsQueue({
  rows = [], totalRows = 0, totalAmount = 0, filters, onFilter,
  assignees = [], selected = new Set(), onToggle, onTogglePage, onToggleAll,
  allResultsSelected = false,
  selectedCount = selected.size,
  page = 1, onPage, onOpen, onInvoices, onBulk,
  canSuspend = false,
  reconciliation, loading = false, sourceHealthy = true, sourceUpdatedAt,
}) {
  const isMobile = useMobileLayout();
  const rowWindow = useWindowedRows(rows, { batch: isMobile ? 10 : Math.max(rows.length, 1) });
  const pages = Math.max(1, Math.ceil(totalRows / AGING_PAGE_SIZE));
  const allSelected = rows.length > 0 && rows.every(row => selected.has(row.identityKey));
  const activeFilters = [
    ...(filters.aging.size ? [{ key: 'aging', label: `أعمار الفواتير: ${CUSTOMER_CAMPAIGN_BUCKETS.filter(bucket => filters.aging.has(bucket.key)).map(bucket => bucket.label).join(' + ')}`, onRemove: () => onFilter('agingClear', true) }] : []),
    ...(filters.search ? [{ key: 'search', label: `بحث: ${filters.search}`, onRemove: () => onFilter('search', '') }] : []),
    ...(filters.minAmount ? [{ key: 'min', label: `${filters.minDays || filters.maxDays ? 'مبلغ العمر' : 'المبلغ'} من ${filters.minAmount} ر.س`, onRemove: () => onFilter('minAmount', '') }] : []),
    ...(filters.maxAmount ? [{ key: 'max', label: `${filters.minDays || filters.maxDays ? 'مبلغ العمر' : 'المبلغ'} إلى ${filters.maxAmount} ر.س`, onRemove: () => onFilter('maxAmount', '') }] : []),
    ...(filters.minDays ? [{ key: 'minDays', label: `أقدم استحقاق > ${filters.minDays} يوم`, onRemove: () => onFilter('minDays', '') }] : []),
    ...(filters.maxDays ? [{ key: 'maxDays', label: `أقدم استحقاق ≤ ${filters.maxDays} يوم`, onRemove: () => onFilter('maxDays', '') }] : []),
    ...(filters.billing !== 'all' ? [{ key: 'billing', label: filters.billing === 'prepaid' ? 'مسبق الدفع' : filters.billing === 'postpaid' ? 'دفع لاحق' : 'نوع الدفع غير متاح', onRemove: () => onFilter('billing', 'all') }] : []),
    ...(filters.wallet !== 'all' ? [{ key: 'wallet', label: filters.wallet === 'positive' ? 'محفظة موجبة' : filters.wallet === 'negative' ? 'محفظة سالبة' : 'محفظة صفرية/هامشية', onRemove: () => onFilter('wallet', 'all') }] : []),
    ...(filters.invoices !== 'all' ? [{ key: 'invoices', label: filters.invoices === 'open' ? 'فواتير مفتوحة' : 'بلا فواتير مفتوحة', onRemove: () => onFilter('invoices', 'all') }] : []),
    ...(filters.status !== 'all' ? [{ key: 'status', label: filters.status === 'active' ? 'حساب لمحة يعمل' : filters.status === 'inactive' ? 'حساب لمحة موقوف' : 'حالة لمحة غير متاحة', onRemove: () => onFilter('status', 'all') }] : []),
    ...(filters.lastShipmentMinDays ? [{ key: 'lastShipmentMinDays', label: `آخر شحنة منذ أكثر من ${filters.lastShipmentMinDays} يوم`, onRemove: () => onFilter('lastShipmentMinDays', '') }] : []),
    ...(filters.lastShipmentMaxDays ? [{ key: 'lastShipmentMaxDays', label: `آخر شحنة خلال ${filters.lastShipmentMaxDays} يوم`, onRemove: () => onFilter('lastShipmentMaxDays', '') }] : []),
    ...((filters.shipmentState || 'all') !== 'all' ? [{ key: 'shipmentState', label: filters.shipmentState === 'none' ? 'لا توجد شحنة' : 'لديه شحنة سابقة', onRemove: () => onFilter('shipmentState', 'all') }] : []),
    ...((filters.sharedContact || 'all') !== 'all' ? [{ key: 'sharedContact', label: filters.sharedContact === 'with' ? 'له متاجر أخرى بنفس الرقم' : 'لا توجد متاجر أخرى بنفس الرقم', onRemove: () => onFilter('sharedContact', 'all') }] : []),
    ...(filters.owner !== 'all' ? [{ key: 'owner', label: filters.owner === 'unassigned' ? 'بلا مسؤول' : 'محصل محدد', onRemove: () => onFilter('owner', 'all') }] : []),
    ...(filters.collection !== 'all' ? [{ key: 'collection', label: filters.collection === 'no_task' ? 'بلا مهمة' : STAGE[filters.collection] || filters.collection, onRemove: () => onFilter('collection', 'all') }] : []),
    ...(filters.promise !== 'all' ? [{ key: 'promise', label: filters.promise === 'today' ? 'وعد اليوم' : filters.promise === 'overdue' ? 'وعد متأخر' : 'بلا وعد', onRemove: () => onFilter('promise', 'all') }] : []),
    ...(filters.contact !== 'all' ? [{ key: 'contact', label: filters.contact === 'none' ? 'تواصل غير متاح' : `تواصل ${filters.contact}`, onRemove: () => onFilter('contact', 'all') }] : []),
    ...(filters.sort !== 'amount' ? [{ key: 'sort', label: 'ترتيب مخصص', onRemove: () => onFilter('sort', 'amount') }] : []),
    ...(filters.actionOnly ? [{ key: 'action', label: 'يحتاج إجراء', onRemove: () => onFilter('actionOnly', false) }] : []),
  ];
  const context = {
    title: 'نتائج الشروط',
    description: 'أضف شروطك المتغيرة، راجع النتائج، ثم حدد ونفّذ الإجراء من القائمة نفسها.',
    reason: activeFilters.length
      ? `تطابق كل شروط القائمة الحالية (${activeFilters.length} شروط فعالة).`
      : filters.aging.size
      ? `العملاء في شرائح الأعمار المحددة: ${CUSTOMER_CAMPAIGN_BUCKETS.filter(bucket => filters.aging.has(bucket.key)).map(bucket => bucket.label).join(' + ')}`
      : 'لديهم مبالغ مستحقة قابلة للتحصيل وفق مصدر التحصيل الحالي.',
    metrics: [
      { key: 'count', label: 'عدد النتائج', value: <NumberValue value={totalRows}/> },
      { key: 'amount', label: filters.minDays || filters.maxDays ? 'مبلغ العمر المحدد' : 'مبلغ العرض', value: <Money value={totalAmount}/>, detail: filters.minDays || filters.maxDays ? 'من الفواتير داخل نطاق العمر فقط' : null },
      { key: 'oldest', label: 'أقدم استحقاق', value: `${rows.reduce((max, row) => Math.max(max, Number(row.summary?.oldestDays) || 0), 0)} يومًا`, detail: 'ضمن الصفحة الحالية' },
      { key: 'reconcile', label: 'مطابقة التفاصيل', value: reconciliation?.pending ? 'جارية' : reconciliation?.ok ? 'مطابق' : 'تحتاج مراجعة', detail: reconciliation?.pending ? 'بانتظار نفس طلب الشريحة' : <><Money value={reconciliation?.detailsTotal}/> / <Money value={reconciliation?.dashboardTotal}/></> },
    ],
    source: 'Zoho Books / customer_collectible_lines',
    updatedAt: sourceUpdatedAt,
    sourceState: sourceHealthy ? 'healthy' : 'error',
    activeFilters,
  };
  const toolbar = <>
    <ConditionBuilder filters={filters} assignees={assignees} onFilter={onFilter}/>
    <div className="aoq-result-tools">
      <label className="aoq-search"><Search size={15}/><input value={filters.search} onChange={event => onFilter('search', event.target.value)} placeholder="ابحث داخل النتائج بالمتجر أو الرقم أو حساب Zoho" aria-label="البحث داخل النتائج"/></label>
      <label><span>ترتيب النتائج</span><select aria-label="ترتيب النتائج" value={filters.sort} onChange={event => onFilter('sort', event.target.value)}><option value="amount">الأعلى مبلغًا</option><option value="oldest">الأقدم</option><option value="promise">موعد الوعد</option><option value="last_contact">آخر تواصل</option></select></label>
      <span>{totalRows.toLocaleString('en-US')} نتيجة مطابقة</span>
    </div>
    {!sourceHealthy ? <div className="aoq-source-error" role="alert"><strong>مصدر التفاصيل غير متاح</strong><span>تبقى آخر بيانات ناجحة ظاهرة، لكن الإجراءات الجماعية متوقفة حتى تعود قراءة سطور التحصيل.</span></div> : null}
    <small className="aoq-identity-note">* رقم التواصل يعرض المتاجر المشتركة كسياق فقط؛ لا يثبت ملكية واحدة ولا يربط أو يجمع المديونيات.</small>
  </>;
  const selection = {
    visibleCount: rows.length,
    totalCount: totalRows,
    selectedCount,
    allVisibleSelected: allSelected,
    allResultsSelected,
    onToggleVisible: onTogglePage,
    onSelectAllResults: onToggleAll,
    onClear: () => onToggleAll(false),
    disabled: loading || !sourceHealthy || !reconciliation?.ok,
    showActionsWhenEmpty: false,
    actions: [
      ...(canSuspend ? [{ key: 'suspend', label: 'إيقاف الحسابات', icon: <ShieldAlert size={14}/>, variant: 'danger', onClick: () => onBulk('suspend') }] : []),
      { key: 'assign', label: 'إسناد', icon: <UserRoundCog size={14}/>, onClick: () => onBulk('assign') },
      { key: 'followup', label: 'متابعة', icon: <CalendarClock size={14}/>, onClick: () => onBulk('followup') },
      { key: 'campaign', label: 'حملة WhatsApp', icon: <Megaphone size={14}/>, variant: 'primary', onClick: () => onBulk('campaign') },
      { key: 'ivr', label: 'مراجعة IVR', icon: <PhoneCall size={14}/>, onClick: () => onBulk('ivr') },
      { key: 'export', label: 'تصدير', icon: <Download size={14}/>, onClick: () => onBulk('export') },
    ],
  };
  return <OperationalResultSet
    context={context}
    toolbar={toolbar}
    selection={selection}
    state={loading && !rows.length ? 'loading' : 'available'}
    empty={!rows.length}
    pagination={pages > 1 ? {
      page, pages, total: totalRows, canPrevious: page > 1, canNext: page < pages,
      onPrevious: () => onPage(page - 1), onNext: () => onPage(page + 1),
    } : null}
    className="aging-operations"
  >
    <div className="aoq-list">
      <div className="aoq-list__head" aria-hidden="true"><span/><span>العميل والمبلغ</span><span>البيانات التشغيلية</span><span>سبب الظهور</span><span>الإجراء التالي</span></div>
      {rowWindow.visible.map(row => <RowCard key={row.identityKey} row={row} selected={selected.has(row.identityKey)} onSelect={() => onToggle(row.identityKey)} onOpen={() => onOpen(row)} onInvoices={() => onInvoices(row)}/>) }
    </div>
    <ProgressiveListFooter hasMore={rowWindow.hasMore} shown={rowWindow.count} total={rows.length} onLoadMore={rowWindow.loadMore} sentinelRef={rowWindow.sentinelRef}/>
  </OperationalResultSet>;
}

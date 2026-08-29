import {
  ArrowLeft, CalendarClock, Download, FileText, Megaphone, PhoneCall,
  Search, ShieldAlert, UserRoundCog, WalletCards,
} from 'lucide-react';
import { CUSTOMER_CAMPAIGN_BUCKETS } from '../../lib/customerCampaignBuckets.js';
import { AGING_PAGE_SIZE } from '../../lib/agingOperations.js';
import useMobileLayout from '../../lib/useMobileLayout.js';
import { useWindowedRows } from '../../hooks/useWindowedRows.js';
import { MobileFilterBar, ProgressiveListFooter } from '../MobileUX.jsx';
import OperationalResultSet from './OperationalResultSet.jsx';
import './aging-operations-queue.css';

const MONEY = value => Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DATE = value => value ? new Date(value).toLocaleDateString('ar-SA', { day: 'numeric', month: 'short', year: 'numeric' }) : 'غير متاح';
const STAGE = { todo: 'جديدة', contacted: 'تم التواصل', promised: 'وعد دفع', snoozed: 'مؤجلة' };

function RowCard({ row, selected, onSelect, onOpen, onInvoices }) {
  const { customer, summary, task } = row;
  const canOpenStore = !!customer.storeId;
  return <article className={`aoq-card${selected ? ' is-selected' : ''}`}>
    <div className="aoq-card__select">
      <input type="checkbox" checked={selected} onChange={onSelect} aria-label={`تحديد ${customer.storeName || customer.name}`}/>
    </div>
    <div className="aoq-card__identity">
      <div><strong>{customer.storeName || customer.name}</strong><small>{customer.storeId ? `متجر #${customer.storeId}` : `Zoho #${customer.zohoId}`}</small></div>
      <div className="aoq-amount"><strong>{MONEY(summary.amount)} ر.س</strong><small>من أصل {MONEY(customer.owed)} ر.س</small></div>
    </div>
    <div className="aoq-card__facts">
      <span><b>{summary.invoiceCount}</b> فاتورة{summary.openingCount ? ' + رصيد افتتاحي' : ''}</span>
      <span>الأقدم <b>{summary.oldestDays} يومًا</b></span>
      <span>الدفع <b>{customer.billingType || 'غير متاح'}</b></span>
      <span>المحفظة <b>{MONEY(customer.walletBalance)} ر.س</b></span>
      <span>حساب لمحة <b>{customer.platformStatus || 'غير متاح'}</b></span>
      <span>آخر دفعة <b>{customer.lastPaymentDate ? DATE(customer.lastPaymentDate) : 'لا توجد'}</b></span>
      <span>آخر تواصل* <b>{row.lastCommunicationAt ? DATE(row.lastCommunicationAt) : 'غير متاح'}</b></span>
      <span>الوعد <b>{task?.promise_date ? `${MONEY(task.promise_amount)} · ${DATE(task.promise_date)}` : 'لا يوجد'}</b></span>
      <span>المحصل <b>{row.assignee || 'بلا مسؤول'}</b></span>
    </div>
    <div className="aoq-card__reason"><WalletCards size={15}/><span><b>سبب الظهور:</b> {row.reason}</span></div>
    <div className="aoq-card__next"><span>الإجراء التالي</span><strong>{row.nextAction}</strong></div>
    <div className="aoq-card__actions">
      <button type="button" onClick={onOpen} disabled={!canOpenStore} title={canOpenStore ? 'فتح Store 360' : 'Store ID غير متاح'}>فتح الملف <ArrowLeft size={14}/></button>
      <button type="button" onClick={onInvoices} disabled={!canOpenStore} title={canOpenStore ? 'فتح الفواتير المكوّنة للمبلغ' : 'Store ID غير متاح'}>الفواتير المكوّنة للمبلغ <FileText size={14}/></button>
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
  const searchControl = <label className="aoq-search"><Search size={15}/><input value={filters.search} onChange={e => onFilter('search', e.target.value)} placeholder="المتجر، رقم المتجر أو حساب Zoho" aria-label="البحث في قائمة Aging"/></label>;
  const renderOperationalConditions = () => <>
    <label><span>مبلغ النتائج أكبر من</span><input aria-label="الحد الأدنى للمبلغ" type="number" min="0" value={filters.minAmount} onChange={e => onFilter('minAmount', e.target.value)} placeholder="مثال: 100" /></label>
    <label><span>مبلغ النتائج حتى</span><input aria-label="الحد الأعلى للمبلغ" type="number" min="0" value={filters.maxAmount} onChange={e => onFilter('maxAmount', e.target.value)} /></label>
    <label><span>أقدم استحقاق أكبر من</span><div className="aoq-unit-input"><input aria-label="الحد الأدنى لعمر الاستحقاق" type="number" min="0" value={filters.minDays} onChange={e => onFilter('minDays', e.target.value)} placeholder="مثال: 30"/><b>يوم</b></div></label>
    <label><span>أقدم استحقاق حتى</span><div className="aoq-unit-input"><input aria-label="الحد الأعلى لعمر الاستحقاق" type="number" min="0" value={filters.maxDays} onChange={e => onFilter('maxDays', e.target.value)}/><b>يوم</b></div></label>
    <label><span>نوع الدفع</span><select aria-label="نوع الدفع" value={filters.billing} onChange={e => onFilter('billing', e.target.value)}><option value="all">الكل</option><option value="prepaid">مسبق الدفع</option><option value="postpaid">دفع لاحق</option><option value="unknown">غير متاح</option></select></label>
    <label><span>رصيد المحفظة</span><select aria-label="حالة رصيد المحفظة" value={filters.wallet} onChange={e => onFilter('wallet', e.target.value)}><option value="all">الكل</option><option value="positive">موجب (أكثر من 0.50)</option><option value="negative">سالب (أقل من -0.50)</option><option value="zero">صفري / هامشي</option></select></label>
    <label><span>الفواتير</span><select aria-label="حالة الفواتير" value={filters.invoices} onChange={e => onFilter('invoices', e.target.value)}><option value="all">الكل</option><option value="open">لديه فواتير مفتوحة</option><option value="none">بلا فواتير مفتوحة</option></select></label>
    <label><span>تشغيل حساب لمحة</span><select aria-label="حالة تشغيل حساب لمحة" value={filters.status} onChange={e => onFilter('status', e.target.value)}><option value="all">كل الحالات</option><option value="active">يعمل حسب آخر مزامنة</option><option value="inactive">موقوف حسب آخر مزامنة</option><option value="unknown">غير متاح</option></select></label>
  </>;
  const renderSecondaryFilters = () => <>
    <label><span>المحصل</span><select aria-label="المحصل" value={filters.owner} onChange={e => onFilter('owner', e.target.value)}><option value="all">الكل</option><option value="unassigned">بلا مسؤول</option>{assignees.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label><span>حالة التحصيل</span><select aria-label="حالة التحصيل" value={filters.collection} onChange={e => onFilter('collection', e.target.value)}><option value="all">كل الحالات</option><option value="no_task">بلا مهمة</option>{Object.entries(STAGE).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
    <label><span>الوعد</span><select aria-label="حالة الوعد" value={filters.promise} onChange={e => onFilter('promise', e.target.value)}><option value="all">الكل</option><option value="today">وعد اليوم</option><option value="overdue">وعد متأخر</option><option value="none">بلا وعد</option></select></label>
    <label><span>آخر تواصل</span><select aria-label="آخر تواصل" value={filters.contact} onChange={e => onFilter('contact', e.target.value)}><option value="all">الكل</option><option value="7d">خلال 7 أيام</option><option value="30d">خلال 30 يومًا</option><option value="none">غير متاح</option></select></label>
    <label><span>الترتيب</span><select aria-label="ترتيب النتائج" value={filters.sort} onChange={e => onFilter('sort', e.target.value)}><option value="amount">الأعلى مبلغًا</option><option value="oldest">الأقدم</option><option value="promise">موعد الوعد</option><option value="last_contact">آخر تواصل</option></select></label>
    <button type="button" className={filters.actionOnly ? 'is-active' : ''} aria-pressed={filters.actionOnly} onClick={() => onFilter('actionOnly', !filters.actionOnly)}>يحتاج إجراء فقط</button>
  </>;
  const activeFilters = [
    ...(filters.minAmount ? [{ key: 'min', label: `من ${filters.minAmount} ر.س`, onRemove: () => onFilter('minAmount', '') }] : []),
    ...(filters.maxAmount ? [{ key: 'max', label: `إلى ${filters.maxAmount} ر.س`, onRemove: () => onFilter('maxAmount', '') }] : []),
    ...(filters.minDays ? [{ key: 'minDays', label: `أقدم استحقاق > ${filters.minDays} يوم`, onRemove: () => onFilter('minDays', '') }] : []),
    ...(filters.maxDays ? [{ key: 'maxDays', label: `أقدم استحقاق ≤ ${filters.maxDays} يوم`, onRemove: () => onFilter('maxDays', '') }] : []),
    ...(filters.billing !== 'all' ? [{ key: 'billing', label: filters.billing === 'prepaid' ? 'مسبق الدفع' : filters.billing === 'postpaid' ? 'دفع لاحق' : 'نوع الدفع غير متاح', onRemove: () => onFilter('billing', 'all') }] : []),
    ...(filters.wallet !== 'all' ? [{ key: 'wallet', label: filters.wallet === 'positive' ? 'محفظة موجبة' : filters.wallet === 'negative' ? 'محفظة سالبة' : 'محفظة صفرية/هامشية', onRemove: () => onFilter('wallet', 'all') }] : []),
    ...(filters.invoices !== 'all' ? [{ key: 'invoices', label: filters.invoices === 'open' ? 'فواتير مفتوحة' : 'بلا فواتير مفتوحة', onRemove: () => onFilter('invoices', 'all') }] : []),
    ...(filters.status !== 'all' ? [{ key: 'status', label: filters.status === 'active' ? 'حساب لمحة يعمل' : filters.status === 'inactive' ? 'حساب لمحة موقوف' : 'حالة لمحة غير متاحة', onRemove: () => onFilter('status', 'all') }] : []),
    ...(filters.owner !== 'all' ? [{ key: 'owner', label: filters.owner === 'unassigned' ? 'بلا مسؤول' : 'محصل محدد', onRemove: () => onFilter('owner', 'all') }] : []),
    ...(filters.collection !== 'all' ? [{ key: 'collection', label: filters.collection === 'no_task' ? 'بلا مهمة' : STAGE[filters.collection] || filters.collection, onRemove: () => onFilter('collection', 'all') }] : []),
    ...(filters.promise !== 'all' ? [{ key: 'promise', label: filters.promise === 'today' ? 'وعد اليوم' : filters.promise === 'overdue' ? 'وعد متأخر' : 'بلا وعد', onRemove: () => onFilter('promise', 'all') }] : []),
    ...(filters.contact !== 'all' ? [{ key: 'contact', label: filters.contact === 'none' ? 'تواصل غير متاح' : `تواصل ${filters.contact}`, onRemove: () => onFilter('contact', 'all') }] : []),
    ...(filters.sort !== 'amount' ? [{ key: 'sort', label: 'ترتيب مخصص', onRemove: () => onFilter('sort', 'amount') }] : []),
    ...(filters.actionOnly ? [{ key: 'action', label: 'يحتاج إجراء', onRemove: () => onFilter('actionOnly', false) }] : []),
  ];
  const clearSecondaryFilters = () => onFilter('clearSecondary', true);
  const context = {
    title: 'قائمة عمل أعمار المستحقات',
    description: 'افتح السجلات المكوّنة للمبلغ، حافظ على سياق العميل، ثم نفّذ الإجراء من نفس مجموعة النتائج.',
    reason: activeFilters.length
      ? `تطابق كل شروط القائمة الحالية (${activeFilters.length} شروط فعالة).`
      : filters.aging.size
      ? `العملاء في شرائح الأعمار المحددة: ${CUSTOMER_CAMPAIGN_BUCKETS.filter(bucket => filters.aging.has(bucket.key)).map(bucket => bucket.label).join(' + ')}`
      : 'لديهم مبالغ مستحقة قابلة للتحصيل وفق مصدر التحصيل الحالي.',
    metrics: [
      { key: 'count', label: 'عدد النتائج', value: totalRows },
      { key: 'amount', label: 'مبلغ العرض', value: `${MONEY(totalAmount)} ر.س` },
      { key: 'oldest', label: 'أقدم استحقاق', value: `${rows.reduce((max, row) => Math.max(max, Number(row.summary?.oldestDays) || 0), 0)} يومًا`, detail: 'ضمن الصفحة الحالية' },
      { key: 'reconcile', label: 'مطابقة التفاصيل', value: reconciliation?.pending ? 'جارية' : reconciliation?.ok ? 'مطابق' : 'تحتاج مراجعة', detail: reconciliation?.pending ? 'بانتظار نفس طلب الشريحة' : `${MONEY(reconciliation?.detailsTotal)} / ${MONEY(reconciliation?.dashboardTotal)} ر.س` },
    ],
    source: 'Zoho Books / customer_collectible_lines',
    updatedAt: sourceUpdatedAt,
    sourceState: sourceHealthy ? 'healthy' : 'error',
    activeFilters,
  };
  const toolbar = <>
    <section className="aoq-query-builder" aria-labelledby="aoq-query-title">
      <div className="aoq-query-builder__heading"><div><strong id="aoq-query-title">ابنِ قائمة العمل بشروطك</strong><span>كل الشروط أدناه تُطبق معًا، والنتائج والإجراءات تبقى في هذه الصفحة.</span></div><button type="button" onClick={clearSecondaryFilters} disabled={!activeFilters.length}>مسح الشروط</button></div>
      <div className="aoq-query-builder__grid">{renderOperationalConditions()}</div>
    </section>
    <div className="aoq-bucket-scope"><strong>نطاق المبلغ حسب عمر الفاتورة</strong><span>اختيار أكثر من شريحة يجمعها في نتيجة واحدة.</span></div>
    <div className="aoq-buckets" aria-label="شرائح أعمار المستحقات">
      {CUSTOMER_CAMPAIGN_BUCKETS.map(bucket => <button type="button" key={bucket.key} aria-pressed={filters.aging.has(bucket.key)} onClick={() => {
        onFilter('agingToggle', bucket.key);
        if (isMobile) window.setTimeout(() => document.querySelector('.aoq-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 40);
      }}>
        <i style={{ background: bucket.color }}/><span>{bucket.label}</span>
      </button>)}
    </div>

    <MobileFilterBar
      search={searchControl}
      title="فلترة قائمة المستحقات"
      activeFilters={activeFilters}
      onClear={clearSecondaryFilters}
      desktop={<div className="aoq-filters workspace-filter-bar">{searchControl}{renderSecondaryFilters()}</div>}
    >
      {renderSecondaryFilters()}
    </MobileFilterBar>
    {!sourceHealthy ? <div className="aoq-source-error" role="alert"><strong>مصدر التفاصيل غير متاح</strong><span>تبقى آخر بيانات ناجحة ظاهرة، لكن الإجراءات الجماعية متوقفة حتى تعود قراءة سطور التحصيل.</span></div> : null}
    <small className="aoq-identity-note">* سجل التواصل مرتبط برقم التواصل للعرض فقط، ولا يُستخدم لإثبات هوية المتجر أو احتساب مديونيته.</small>
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
    actions: [
      ...(canSuspend ? [{ key: 'suspend', label: 'مراجعة الإيقاف', icon: <ShieldAlert size={14}/>, variant: 'primary', onClick: () => onBulk('suspend') }] : []),
      { key: 'assign', label: 'إسناد', icon: <UserRoundCog size={14}/>, onClick: () => onBulk('assign') },
      { key: 'followup', label: 'متابعة', icon: <CalendarClock size={14}/>, onClick: () => onBulk('followup') },
      { key: 'campaign', label: 'حملة WhatsApp', icon: <Megaphone size={14}/>, variant: 'accent', onClick: () => onBulk('campaign') },
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
      {rowWindow.visible.map(row => <RowCard key={row.identityKey} row={row} selected={selected.has(row.identityKey)} onSelect={() => onToggle(row.identityKey)} onOpen={() => onOpen(row)} onInvoices={() => onInvoices(row)}/>) }
    </div>
    <ProgressiveListFooter hasMore={rowWindow.hasMore} shown={rowWindow.count} total={rows.length} onLoadMore={rowWindow.loadMore} sentinelRef={rowWindow.sentinelRef}/>
  </OperationalResultSet>;
}

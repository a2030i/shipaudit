import {
  ArrowLeft, CalendarClock, Download, FileText, Megaphone, PhoneCall,
  Search, UserRoundCog, WalletCards,
} from 'lucide-react';
import { Btn } from '../UI.jsx';
import { CUSTOMER_CAMPAIGN_BUCKETS } from '../../lib/customerCampaignBuckets.js';
import { AGING_PAGE_SIZE } from '../../lib/agingOperations.js';
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
  page = 1, onPage, onOpen, onInvoices, onBulk,
  reconciliation, sourceHealthy = true, sourceUpdatedAt,
}) {
  const pages = Math.max(1, Math.ceil(totalRows / AGING_PAGE_SIZE));
  const allSelected = rows.length > 0 && rows.every(row => selected.has(row.identityKey));
  const hasMoreResults = totalRows > rows.length;
  return <section className="aging-operations" dir="rtl">
    <header className="aoq-header">
      <div><span>AGING OPERATIONS</span><h1>قائمة عمل أعمار المستحقات</h1><p>اختر الشريحة، افتح الفواتير التي صنعت مبلغها، ثم نفّذ الإجراء وارجع إلى السياق نفسه.</p></div>
      <div className={`aoq-reconcile ${reconciliation?.ok ? 'is-pass' : 'is-fail'}`}>
        <small>مطابقة الشريحة بالتفاصيل</small><strong>{reconciliation?.ok ? 'مطابق بالهللة' : 'تحتاج مراجعة'}</strong>
        <span>{MONEY(reconciliation?.detailsTotal)} / {MONEY(reconciliation?.dashboardTotal)} ر.س</span>
      </div>
    </header>

    <div className="aoq-buckets" aria-label="شرائح أعمار المستحقات">
      {CUSTOMER_CAMPAIGN_BUCKETS.map(bucket => <button type="button" key={bucket.key} aria-pressed={filters.aging.has(bucket.key)} onClick={() => onFilter('agingToggle', bucket.key)}>
        <i style={{ background: bucket.color }}/><span>{bucket.label}</span>
      </button>)}
    </div>

    <div className="aoq-filters workspace-filter-bar">
      <label className="aoq-search"><Search size={15}/><input value={filters.search} onChange={e => onFilter('search', e.target.value)} placeholder="المتجر، رقم المتجر أو حساب Zoho" aria-label="البحث في قائمة Aging"/></label>
      <label><span>المبلغ من</span><input type="number" min="0" value={filters.minAmount} onChange={e => onFilter('minAmount', e.target.value)} /></label>
      <label><span>إلى</span><input type="number" min="0" value={filters.maxAmount} onChange={e => onFilter('maxAmount', e.target.value)} /></label>
      <label><span>المحصل</span><select value={filters.owner} onChange={e => onFilter('owner', e.target.value)}><option value="all">الكل</option><option value="unassigned">بلا مسؤول</option>{assignees.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label><span>حالة التحصيل</span><select value={filters.collection} onChange={e => onFilter('collection', e.target.value)}><option value="all">كل الحالات</option><option value="no_task">بلا مهمة</option>{Object.entries(STAGE).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
      <label><span>الوعد</span><select value={filters.promise} onChange={e => onFilter('promise', e.target.value)}><option value="all">الكل</option><option value="today">وعد اليوم</option><option value="overdue">وعد متأخر</option><option value="none">بلا وعد</option></select></label>
      <label><span>آخر تواصل</span><select value={filters.contact} onChange={e => onFilter('contact', e.target.value)}><option value="all">الكل</option><option value="7d">خلال 7 أيام</option><option value="30d">خلال 30 يومًا</option><option value="none">غير متاح</option></select></label>
      <label><span>الترتيب</span><select value={filters.sort} onChange={e => onFilter('sort', e.target.value)}><option value="amount">الأعلى مبلغًا</option><option value="oldest">الأقدم</option><option value="promise">موعد الوعد</option><option value="last_contact">آخر تواصل</option></select></label>
      <button type="button" className={filters.actionOnly ? 'is-active' : ''} aria-pressed={filters.actionOnly} onClick={() => onFilter('actionOnly', !filters.actionOnly)}>يحتاج إجراء فقط</button>
    </div>

    {!sourceHealthy ? <div className="aoq-source-error" role="alert"><strong>مصدر التفاصيل غير متاح</strong><span>لن تظهر أرقام صفرية ولن تتاح الإجراءات الجماعية حتى تعود قراءة سطور التحصيل.</span></div> : null}

    <div className="aoq-summary">
      <span>النتائج <b>{totalRows}</b></span><span>مبلغ العرض <b>{MONEY(totalAmount)} ر.س</b></span>
      <span>المصدر: <b>Zoho Books / customer_collectible_lines</b></span>
      <span>آخر تحديث: <b>{sourceUpdatedAt ? new Date(sourceUpdatedAt).toLocaleString('ar-SA') : 'غير متاح'}</b></span>
      <span>* سجل التواصل مرتبط برقم التواصل للعرض فقط، ولا يُستخدم لإثبات هوية المتجر أو احتساب مديونيته.</span>
    </div>

    <div className="aoq-select-page">
      <label><input type="checkbox" checked={allSelected} onChange={e => onTogglePage(e.target.checked)}/> تحديد نتائج هذه الصفحة</label>
      <div className="aoq-select-page__meta">
        {hasMoreResults && !allResultsSelected ? <button type="button" onClick={() => onToggleAll(true)}>تحديد كل النتائج ({totalRows})</button> : null}
        <span>صفحة {page} من {pages}</span>
      </div>
    </div>

    {allResultsSelected && totalRows > 0 ? <div className="aoq-selection-scope is-all" role="status">
      <strong>تم تحديد جميع النتائج المطابقة للفلاتر ({totalRows})</strong>
      <button type="button" onClick={() => onToggleAll(false)}>إلغاء تحديد الكل</button>
    </div> : null}

    {selected.size ? <div className="aoq-bulk" role="toolbar" aria-label="إجراءات جماعية">
      <strong>{selected.size} متجر محدد</strong>
      <Btn size="sm" variant="ghost" icon={<UserRoundCog size={14}/>} onClick={() => onBulk('assign')}>إسناد</Btn>
      <Btn size="sm" variant="ghost" icon={<CalendarClock size={14}/>} onClick={() => onBulk('followup')}>متابعة</Btn>
      <Btn size="sm" variant="accent" icon={<Megaphone size={14}/>} onClick={() => onBulk('campaign')}>Draft حملة</Btn>
      <Btn size="sm" variant="ghost" icon={<PhoneCall size={14}/>} onClick={() => onBulk('ivr')}>IVR Review</Btn>
      <Btn size="sm" variant="ghost" icon={<Download size={14}/>} onClick={() => onBulk('export')}>تصدير</Btn>
      <button type="button" onClick={() => onToggleAll(false)}>إلغاء التحديد</button>
    </div> : null}

    <div className="aoq-list">
      {rows.map(row => <RowCard key={row.identityKey} row={row} selected={selected.has(row.identityKey)} onSelect={() => onToggle(row.identityKey)} onOpen={() => onOpen(row)} onInvoices={() => onInvoices(row)}/>) }
      {!rows.length ? <div className="aoq-empty">لا توجد متاجر تطابق الفلاتر الحالية.</div> : null}
    </div>

    {pages > 1 ? <div className="aoq-pages"><Btn size="sm" variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>السابق</Btn><span>{page} / {pages}</span><Btn size="sm" variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>التالي</Btn></div> : null}
  </section>;
}

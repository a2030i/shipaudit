import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CircleAlert, FileText, RefreshCw, UserRound, WalletCards } from 'lucide-react';
import { Btn, Modal, Spinner } from './UI.jsx';
import { loadStore360Core, loadStore360Finance } from '../lib/store360Service.js';
import './customer-context-drawer.css';

const MONEY = value => Number(value || 0).toLocaleString('en-US', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const DATE = value => value ? new Date(value).toLocaleDateString('ar-SA-u-ca-gregory', {
  day: 'numeric', month: 'short', year: 'numeric',
}) : 'غير متاح';

const rowCustomer = row => row?.customer || row || {};

export default function CustomerContextDrawer({ row, initialView = 'summary', onClose, onOpenFull }) {
  const customer = rowCustomer(row);
  const storeId = customer.storeId || customer.store_id || row?.storeId;
  const [view, setView] = useState(initialView === 'invoices' ? 'invoices' : 'summary');
  const [state, setState] = useState({ status: 'loading', core: null, finance: null, error: null });

  const load = async () => {
    if (!storeId) {
      setState({ status: 'error', core: null, finance: null, error: 'لا يوجد Store ID مؤكد لفتح سياق العميل.' });
      return;
    }
    setState(current => ({ ...current, status: 'loading', error: null }));
    try {
      const core = await loadStore360Core(storeId);
      const finance = await loadStore360Finance({
        customerName: core.customerName || customer.name,
        zohoId: core.financial?.zohoId || customer.zohoId,
        agingBuckets: row?.agingBuckets || [],
      });
      setState({ status: 'available', core, finance, error: null });
    } catch (error) {
      setState({ status: 'error', core: null, finance: null, error: error?.message || 'تعذر تحميل سياق العميل.' });
    }
  };

  useEffect(() => { load(); }, [storeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const core = state.core;
  const finance = state.finance;
  const financial = core?.financial || {};
  const merchant = core?.store || customer;
  const invoices = useMemo(() => [...(finance?.invoices || []), ...(finance?.openingRows || [])], [finance]);
  const residual = Number(financial.residualBalance) || 0;

  return <Modal
    title={`معاينة العميل — ${merchant?.storeName || customer.storeName || customer.name || `متجر #${storeId}`}`}
    onClose={onClose}
    width={560}
    variant="drawer"
    className="customer-context-drawer"
    bodyClassName="customer-context-drawer__body"
  >
    {state.status === 'loading' ? <div className="customer-context-drawer__state"><Spinner size={24}/><span>جارٍ جمع موقف العميل من مصادره الحالية…</span></div> : null}
    {state.status === 'error' ? <div className="customer-context-drawer__state is-error"><CircleAlert size={22}/><strong>تعذر فتح المعاينة</strong><span>{state.error}</span><Btn size="sm" variant="ghost" icon={<RefreshCw size={14}/>} onClick={load}>إعادة المحاولة</Btn></div> : null}

    {state.status === 'available' ? <>
      <div className="customer-context-drawer__identity">متجر #{storeId || '—'}{core?.customerName ? ` · ${core.customerName}` : ''}</div>
      <nav className="customer-context-drawer__tabs" aria-label="أقسام معاينة العميل">
        <button type="button" className={view === 'summary' ? 'is-active' : ''} onClick={() => setView('summary')}><UserRound size={15}/>الموقف</button>
        <button type="button" className={view === 'invoices' ? 'is-active' : ''} onClick={() => setView('invoices')}><FileText size={15}/>الفواتير في السياق ({invoices.length})</button>
      </nav>

      {view === 'summary' ? <div className="customer-context-drawer__content">
        <section className="customer-context-drawer__status">
          <span><small>حالة الحساب من آخر مصدر</small><strong>{merchant?.status || 'غير متاحة'}</strong></span>
          <span><small>آخر نشاط</small><strong>{DATE(merchant?.lastShipmentAt || customer.lastShipmentAt)}</strong></span>
        </section>
        <section className="customer-context-drawer__finance">
          <div><small>الرصيد المحاسبي</small><strong>{MONEY(financial.accountingOutstanding)} ر.س</strong></div>
          <div className="is-primary"><small>القابل للتحصيل تشغيليًا</small><strong>{MONEY(financial.operationalCollectible ?? financial.outstanding)} ر.س</strong></div>
          <div><small>المتأخر</small><strong>{MONEY(financial.overdue)} ر.س</strong></div>
          <div><small>محفظة لمحة</small><strong>{MONEY(merchant?.walletBalance)} ر.س</strong></div>
          {residual !== 0 ? <div><small>الرصيد الهامشي</small><strong>{MONEY(residual)} ر.س</strong></div> : null}
          <div><small>أقدم استحقاق</small><strong>{Number(financial.oldestDays || 0)} يومًا</strong></div>
        </section>
        <section className="customer-context-drawer__evidence">
          <WalletCards size={16}/><span><b>{finance?.invoiceCount || 0} فاتورة مفتوحة</b><small>آخر دفعة {financial.lastPaymentDate ? `${MONEY(financial.lastPaymentAmount)} ر.س · ${DATE(financial.lastPaymentDate)}` : 'غير متاحة'}</small></span>
          <button type="button" onClick={() => setView('invoices')}>عرض الفواتير <ArrowLeft size={14}/></button>
        </section>
      </div> : <div className="customer-context-drawer__content">
        <div className="customer-context-drawer__invoice-summary"><span>{invoices.length} سجل</span><strong>{MONEY(finance?.selectedAmount)} ر.س</strong><small>{finance?.source?.label || 'Zoho Books'}</small></div>
        {!invoices.length ? <div className="customer-context-drawer__empty">لا توجد فواتير مفتوحة في هذا السياق.</div> : <div className="customer-context-drawer__invoices">
          {invoices.map((invoice, index) => <article key={invoice.line_id || invoice.invoice_id || invoice.invoice_number || index}>
            <span><b>{invoice.invoice_number || (invoice.line_kind === 'opening_balance' ? 'رصيد افتتاحي' : 'فاتورة')}</b><small>{invoice.due_date ? `استحقاق ${DATE(invoice.due_date)}` : DATE(invoice.date)}</small></span>
            <span><strong>{MONEY(invoice.collectible_amount ?? invoice.balance)} ر.س</strong><small>{Number(invoice.age_days || 0)} يومًا</small></span>
          </article>)}
        </div>}
      </div>}

      <footer className="customer-context-drawer__footer">
        <Btn variant="primary" icon={<ArrowLeft size={15}/>} onClick={() => onOpenFull?.(view)}>فتح Customer 360 الكامل</Btn>
        <small>المعاينة للقراءة فقط ولا تنفذ أي إجراء خارجي.</small>
      </footer>
    </> : null}
  </Modal>;
}

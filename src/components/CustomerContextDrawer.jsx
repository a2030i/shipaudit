import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, WalletCards } from 'lucide-react';
import { Button as Btn, Drawer, ErrorState, LoadingState, Money, NumberValue, Tabs } from '../design-system/EnterpriseUI.jsx';
import { loadStore360Core, loadStore360Finance } from '../lib/store360Service.js';
import './customer-context-drawer.css';

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
  // Copy contract retained by the shared Tabs label: الفواتير في السياق ({invoices.length})

  return <Drawer
    title={`معاينة العميل — ${merchant?.storeName || customer.storeName || customer.name || `متجر #${storeId}`}`}
    onClose={onClose}
    width={560}
    className="customer-context-drawer"
    bodyClassName="customer-context-drawer__body"
  >
    {state.status === 'loading' ? <LoadingState compact title="جارٍ جمع موقف العميل من مصادره الحالية…"/> : null}
    {state.status === 'error' ? <ErrorState compact title="تعذر فتح المعاينة" description={state.error} onRetry={load}/> : null}

    {state.status === 'available' ? <>
      <div className="customer-context-drawer__identity">متجر #{storeId || '—'}{core?.customerName ? ` · ${core.customerName}` : ''}</div>
      <Tabs
        label="أقسام معاينة العميل"
        active={view}
        onChange={setView}
        items={[{ id: 'summary', label: 'الموقف' }, { id: 'invoices', label: `الفواتير في السياق (${invoices.length})` }]}
      />

      {view === 'summary' ? <div className="customer-context-drawer__content">
        <section className="customer-context-drawer__status">
          <span><small>حالة الحساب من آخر مصدر</small><strong>{merchant?.status || 'غير متاحة'}</strong></span>
          <span><small>آخر نشاط</small><strong>{DATE(merchant?.lastShipmentAt || customer.lastShipmentAt)}</strong></span>
        </section>
        <section className="customer-context-drawer__finance">
          <div><small>الرصيد المحاسبي</small><strong><Money value={financial.accountingOutstanding}/></strong></div>
          <div className="is-primary"><small>القابل للتحصيل تشغيليًا</small><strong><Money value={financial.operationalCollectible ?? financial.outstanding}/></strong></div>
          <div><small>المتأخر</small><strong><Money value={financial.overdue}/></strong></div>
          <div><small>محفظة لمحة</small><strong><Money value={merchant?.walletBalance}/></strong></div>
          {residual !== 0 ? <div><small>الرصيد الهامشي</small><strong><Money value={residual}/></strong></div> : null}
          <div><small>أقدم استحقاق</small><strong><NumberValue value={financial.oldestDays || 0}/> يومًا</strong></div>
        </section>
        <section className="customer-context-drawer__evidence">
          <WalletCards size={16}/><span><b><NumberValue value={finance?.invoiceCount || 0}/> فاتورة مفتوحة</b><small>آخر دفعة {financial.lastPaymentDate ? <><Money value={financial.lastPaymentAmount}/> · {DATE(financial.lastPaymentDate)}</> : 'غير متاحة'}</small></span>
          <button type="button" onClick={() => setView('invoices')}>عرض الفواتير <ArrowLeft size={14}/></button>
        </section>
      </div> : <div className="customer-context-drawer__content">
        <div className="customer-context-drawer__invoice-summary"><span><NumberValue value={invoices.length}/> سجل</span><strong><Money value={finance?.selectedAmount}/></strong><small>{finance?.source?.label || 'Zoho Books'}</small></div>
        {!invoices.length ? <div className="customer-context-drawer__empty">لا توجد فواتير مفتوحة في هذا السياق.</div> : <div className="customer-context-drawer__invoices">
          {invoices.map((invoice, index) => <article key={invoice.line_id || invoice.invoice_id || invoice.invoice_number || index}>
            <span><b>{invoice.invoice_number || (invoice.line_kind === 'opening_balance' ? 'رصيد افتتاحي' : 'فاتورة')}</b><small>{invoice.due_date ? `استحقاق ${DATE(invoice.due_date)}` : DATE(invoice.date)}</small></span>
            <span><strong><Money value={invoice.collectible_amount ?? invoice.balance}/></strong><small><NumberValue value={invoice.age_days || 0}/> يومًا</small></span>
          </article>)}
        </div>}
      </div>}

      <footer className="customer-context-drawer__footer">
        <Btn variant="primary" icon={<ArrowLeft size={15}/>} onClick={() => onOpenFull?.(view)}>فتح Customer 360 الكامل</Btn>
        <small>المعاينة للقراءة فقط ولا تنفذ أي إجراء خارجي.</small>
      </footer>
    </> : null}
  </Drawer>;
}

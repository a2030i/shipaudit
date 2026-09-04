import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Activity, ArrowDownCircle, ArrowLeft, ArrowUpCircle, Banknote, BookOpen,
  Building2, CalendarDays, CircleAlert, Landmark, RefreshCw, ReceiptText,
  Store, TrendingDown, TrendingUp, UsersRound, WalletCards,
} from 'lucide-react';
import { Empty, Spinner } from '../components/UI.jsx';
import {
  currentPeriod, loadOverviewRead,
} from '../lib/overviewService.js';
import {
  currentPnlPeriod, isUsablePnlSnapshot, loadInvoicedVsCollected,
  loadPnlSnapshots, loadZohoFinancialDashboard,
} from '../lib/pnlService.js';
import { loadCashflowForecast } from '../lib/forecastService.js';
import EnterpriseFinanceOverview from '../components/enterprise/EnterpriseFinanceOverview.jsx';
import { ErrorState, LoadingState, Page as DsPage, PageHeader as DsPageHeader } from '../design-system/EnterpriseUI.jsx';
import './finance-executive.css';

const MONEY = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const INT = new Intl.NumberFormat('en-US');
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const money = value => Number.isFinite(Number(value)) ? MONEY.format(Number(value)) : '—';
const compact = value => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  const absolute = Math.abs(number);
  if (absolute >= 1_000_000) return `${(number / 1_000_000).toFixed(2)}م`;
  if (absolute >= 1_000) return `${(number / 1_000).toFixed(1)}ك`;
  return MONEY.format(number);
};
const monthLabel = period => {
  const [year, month] = String(period || '').split('-').map(Number);
  return year && month ? `${MONTHS[month - 1]} ${year}` : 'الفترة الحالية';
};
const movePeriod = (period, amount) => {
  const [year, month] = String(period).split('-').map(Number);
  const date = new Date(year, month - 1 + amount, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};
const sourceDate = value => {
  if (!value) return 'غير متاح';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'غير متاح';
  return new Intl.DateTimeFormat('ar-SA-u-ca-gregory', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  }).format(date);
};

function ExecutiveMetric({ icon: Icon, label, value, note, tone = 'neutral', onClick }) {
  return (
    <button type="button" className={`fex-metric is-${tone}`} onClick={onClick}>
      <span className="fex-metric__icon"><Icon size={18}/></span>
      <span><small>{label}</small><strong>{value}</strong><em>{note}</em></span>
      <ArrowLeft size={14}/>
    </button>
  );
}

function PnlBridge({ snapshot, onOpen }) {
  if (!isUsablePnlSnapshot(snapshot)) {
    return <div className="fex-empty"><CircleAlert size={20}/><span>قائمة الدخل غير متاحة لهذه الفترة.</span><button onClick={onOpen}>فتح المصدر</button></div>;
  }
  const rows = [
    { label: 'الدخل', value: Number(snapshot.income) || 0, tone: 'green', sign: '+' },
    { label: 'تكلفة المبيعات', value: Number(snapshot.cogs) || 0, tone: 'red', sign: '−' },
    { label: 'المصروفات التشغيلية', value: Number(snapshot.opex) || 0, tone: 'amber', sign: '−' },
    { label: 'صافي الربح', value: Number(snapshot.net) || 0, tone: Number(snapshot.net) >= 0 ? 'blue' : 'red', sign: Number(snapshot.net) >= 0 ? '=' : '−' },
  ];
  const max = Math.max(1, ...rows.map(row => Math.abs(row.value)));
  return (
    <div className="fex-pnl-bridge" aria-label="تركيب قائمة الدخل">
      {rows.map(row => (
        <button type="button" key={row.label} onClick={onOpen} className={`is-${row.tone}`}>
          <span className="fex-pnl-bridge__label"><b>{row.sign}</b>{row.label}</span>
          <span className="fex-pnl-bridge__track"><i style={{ '--bar-size': `${Math.max(3, Math.abs(row.value) / max * 100)}%` }}/></span>
          <strong>{compact(Math.abs(row.value))} ر.س</strong>
        </button>
      ))}
    </div>
  );
}

function CashProjectionChart({ forecast, onOpen }) {
  const points = useMemo(() => {
    if (forecast?.bankBalance == null) return [];
    return [
      { label: 'اليوم', value: Number(forecast.bankBalance) || 0 },
      ...(forecast.dailyFlow || []).map(row => ({ label: row.date?.slice(5), value: Number(row.runningBalance) || 0 })),
    ];
  }, [forecast]);
  if (points.length < 2) {
    return <div className="fex-empty"><Activity size={20}/><span>لا توجد أحداث نقدية مؤرخة تكفي لرسم التوقع.</span><button onClick={onOpen}>فتح التوقعات</button></div>;
  }
  const values = points.map(point => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const plot = points.map((point, index) => ({
    ...point,
    x: 28 + (index * (344 / Math.max(1, points.length - 1))),
    y: 23 + ((max - point.value) / range) * 104,
  }));
  const path = plot.map(point => `${point.x},${point.y}`).join(' ');
  const danger = Math.min(...values) < 0;
  return (
    <button type="button" className={`fex-cash-chart${danger ? ' is-danger' : ''}`} onClick={onOpen} aria-label="فتح توقع السيولة التفصيلي">
      <svg role="img" aria-labelledby="fex-cash-title" viewBox="0 0 400 166" preserveAspectRatio="none">
        <title id="fex-cash-title">توقع رصيد السيولة خلال سبعة أيام</title>
        <line x1="28" y1="127" x2="372" y2="127"/>
        <polyline points={path}/>
        {plot.map((point, index) => <g key={`${point.label}-${index}`}>
          <circle cx={point.x} cy={point.y} r="4"/>
          {(index === 0 || index === plot.length - 1) ? <>
            <text x={point.x} y={Math.max(13, point.y - 11)} textAnchor={index ? 'end' : 'start'}>{compact(point.value)}</text>
            <text className="is-date" x={point.x} y="148" textAnchor={index ? 'end' : 'start'}>{point.label}</text>
          </> : null}
        </g>)}
      </svg>
      <span>فتح تفاصيل التدفقات <ArrowLeft size={13}/></span>
    </button>
  );
}

function PositionEquation({ bank, receivable, payable, vat, onOpen }) {
  const available = [bank, receivable, payable, vat].every(value => Number.isFinite(Number(value)));
  const net = available ? Number(bank) + Number(receivable) - Number(payable) - Math.max(0, Number(vat)) : null;
  const items = [
    { label: 'النقد', value: bank, sign: '+', tone: 'blue' },
    { label: 'قابل للتحصيل', value: receivable, sign: '+', tone: 'green' },
    { label: 'التزامات', value: payable, sign: '−', tone: 'red' },
    { label: 'ضريبة', value: Math.max(0, Number(vat) || 0), sign: '−', tone: 'amber' },
  ];
  return (
    <button type="button" className="fex-equation" onClick={onOpen}>
      {items.map((item, index) => <span key={item.label} className={`is-${item.tone}`}>
        {index ? <b>{item.sign}</b> : null}<small>{item.label}</small><strong>{compact(item.value)}</strong>
      </span>)}
      <span className={`is-result${net != null && net < 0 ? ' is-negative' : ''}`}><small>المركز بعد الالتزامات</small><strong>{compact(net)} ر.س</strong></span>
    </button>
  );
}

function MerchantPulse({ pulse, navigate }) {
  if (!pulse?.available) return <div className="fex-empty"><Store size={20}/><span>حالة المتاجر غير متاحة من آخر مزامنة Lamha.</span><button onClick={() => navigate('/operations')}>فحص المصدر</button></div>;
  const total = Math.max(1, Number(pulse.total) || 0);
  const active = Number(pulse.active) || 0;
  const inactive = Number(pulse.inactive) || 0;
  const unknown = Math.max(0, total - active - inactive);
  return (
    <div className="fex-merchant-pulse">
      <button type="button" className="fex-merchant-pulse__total" onClick={() => navigate('/customer-360')}>
        <small>إجمالي المتاجر</small><strong>{INT.format(Number(pulse.total) || 0)}</strong><span>من Lamha API</span>
      </button>
      <div className="fex-merchant-pulse__states">
        <div className="fex-merchant-pulse__bar" aria-label={`يعمل ${active}، موقوف ${inactive}، غير محسوم ${unknown}`}>
          <i className="is-active" style={{ '--share': `${active / total * 100}%` }}/>
          <i className="is-inactive" style={{ '--share': `${inactive / total * 100}%` }}/>
          {unknown ? <i className="is-unknown" style={{ '--share': `${unknown / total * 100}%` }}/> : null}
        </div>
        <div className="fex-merchant-pulse__legend">
          <span><i className="is-active"/>يعمل <b>{INT.format(active)}</b></span>
          <span><i className="is-inactive"/>موقوف <b>{INT.format(inactive)}</b></span>
          {unknown ? <span><i className="is-unknown"/>غير محسوم <b>{INT.format(unknown)}</b></span> : null}
        </div>
      </div>
      <div className="fex-merchant-pulse__movement">
        <button onClick={() => navigate('/customer-360?view=lists&listGroup=growth')}><strong>{INT.format(Number(pulse.newThisPeriod) || 0)}</strong><span>سجلوا هذا الشهر</span></button>
        <button onClick={() => navigate('/customer-360?view=lists&listGroup=activity&lastShipmentDays=5')}><strong>{INT.format(Number(pulse.recentFiveDays) || 0)}</strong><span>شحنوا خلال 5 أيام</span></button>
        <button onClick={() => navigate('/customer-360?view=overview')}><strong>{INT.format(Number(pulse.neverShipped) || 0)}</strong><span>سجلوا ولم يشحنوا</span></button>
        <button onClick={() => navigate('/merchants?decision=activate&returnTo=%2Fworkspace%2Ffinance')}><strong>{INT.format(Number(pulse.stoppedWithWallet) || 0)}</strong><span>موقوفون ولديهم رصيد</span></button>
      </div>
    </div>
  );
}

export default function FinanceExecutive({ carriers = [], isActive = true }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedPeriod = searchParams.get('period');
  const period = /^\d{4}-\d{2}$/.test(requestedPeriod || '') ? requestedPeriod : currentPnlPeriod();
  const [state, setState] = useState({ loading: true, error: null, loadedAt: null });

  const reload = useCallback(async () => {
    setState(current => ({ ...current, loading: true, error: null }));
    const [overviewResult, pnlResult, invoiceResult, financialResult, forecastResult] = await Promise.allSettled([
      loadOverviewRead({ period: period || currentPeriod(), topN: 5, mode: 'core' }),
      loadPnlSnapshots(),
      loadInvoicedVsCollected(period),
      loadZohoFinancialDashboard(),
      loadCashflowForecast({ horizonDays: 7, carriers }),
    ]);
    const failures = [overviewResult, pnlResult, invoiceResult, financialResult, forecastResult]
      .filter(result => result.status === 'rejected');
    setState({
      loading: false,
      error: failures.length === 5 ? failures[0]?.reason : null,
      partial: failures.length > 0 && failures.length < 5,
      overview: overviewResult.status === 'fulfilled' ? overviewResult.value.overview : null,
      vat: overviewResult.status === 'fulfilled' ? overviewResult.value.vat : null,
      pnl: pnlResult.status === 'fulfilled' ? pnlResult.value : [],
      invoice: invoiceResult.status === 'fulfilled' ? invoiceResult.value : null,
      financial: financialResult.status === 'fulfilled' ? financialResult.value : null,
      forecast: forecastResult.status === 'fulfilled' ? forecastResult.value : null,
      loadedAt: new Date().toISOString(),
    });
  }, [carriers, period]);

  useEffect(() => { if (isActive) reload(); }, [isActive, reload]);

  const snapshot = useMemo(() => (state.pnl || []).find(row => row.period === period), [period, state.pnl]);
  const cash = state.overview?.cashPosition || {};
  const merchantPulse = state.overview?.merchantPulse || null;
  const vendor = state.financial?.vendor_summary || {};
  const bills = state.financial?.bills_summary || {};
  const bank = state.financial?.bank_summary || {};
  const netProfit = isUsablePnlSnapshot(snapshot) ? Number(snapshot.net) || 0 : null;
  const operationalCollectible = Number.isFinite(Number(cash.totalAR)) ? Number(cash.totalAR) : null;
  const accountingOutstanding = Number.isFinite(Number(cash.grossAR)) ? Number(cash.grossAR) : operationalCollectible;
  const residual = accountingOutstanding != null && operationalCollectible != null
    ? +(accountingOutstanding - operationalCollectible).toFixed(2) : null;
  const vendorPayable = Number.isFinite(Number(vendor.net_payable)) ? Number(vendor.net_payable) : Number(cash.totalAP) || null;
  const updatePeriod = next => {
    const params = new URLSearchParams(searchParams);
    if (next === currentPnlPeriod()) params.delete('period');
    else params.set('period', next);
    setSearchParams(params);
  };

  if (state.loading && !state.loadedAt) {
    return <DsPage><DsPageHeader title="مركز المالية" description="السيولة، الذمم، الالتزامات والمطابقة"/><LoadingState title="جارٍ تجهيز مركز المالية" description="Zoho · البنوك · الموردون · لمحة · توقع السيولة"/></DsPage>;
  }
  if (state.error && !state.loadedAt) {
    return <DsPage><DsPageHeader title="مركز المالية"/><ErrorState title="تعذر إعداد الصورة المالية" description={state.error.message || 'تعذر الوصول إلى المصادر.'} onRetry={reload}/></DsPage>;
  }

  return <EnterpriseFinanceOverview
    state={state}
    period={period}
    snapshot={snapshot}
    cash={cash}
    vendor={vendor}
    bills={bills}
    bank={bank}
    netProfit={netProfit}
    operationalCollectible={operationalCollectible}
    accountingOutstanding={accountingOutstanding}
    residual={residual}
    vendorPayable={vendorPayable}
    onPeriodChange={amount => updatePeriod(movePeriod(period, amount))}
    onReload={reload}
    navigate={navigate}
  />;

  /* واجهة المالية السابقة محفوظة مؤقتًا كفرع غير قابل للوصول حتى اكتمال الترحيل. */
  return (
    <div className="finance-executive" dir="rtl">
      <header className="fex-header">
        <div><span>مركز قيادة مالي</span><h1>المالية التنفيذية</h1><p>هل نربح؟ أين المال؟ ماذا لنا وماذا علينا؟ والإجابة تفتح التفاصيل مباشرة.</p></div>
        <div className="fex-header__controls">
          <small>آخر قراءة {sourceDate(state.loadedAt)}</small>
          <div className="fex-period">
            <button onClick={() => updatePeriod(movePeriod(period, -1))} aria-label="الشهر السابق">›</button>
            <span><CalendarDays size={14}/>{monthLabel(period)}</span>
            <button onClick={() => updatePeriod(movePeriod(period, 1))} disabled={period >= currentPnlPeriod()} aria-label="الشهر التالي">‹</button>
          </div>
          <button className="fex-refresh" onClick={reload} disabled={state.loading}><RefreshCw size={15} className={state.loading ? 'is-spinning' : ''}/><span>تحديث القراءة</span></button>
        </div>
      </header>

      {state.partial ? <div className="fex-partial" role="status"><CircleAlert size={15}/><span>بعض المصادر لم تستجب؛ تظهر القيم المتاحة فقط دون استبدال الناقص بصفر.</span></div> : null}

      <section className="fex-section">
        <div className="fex-section__heading"><div><span>القرار خلال 30 ثانية</span><h2>وضع الشركة المالي الآن</h2></div><small>كل رقم يفتح مصدره أو قائمة العمل المرتبطة به</small></div>
        <div className="fex-metrics">
          <ExecutiveMetric icon={netProfit != null && netProfit >= 0 ? TrendingUp : TrendingDown} label="صافي الربح" value={netProfit == null ? 'غير متاح' : `${netProfit >= 0 ? '+' : '−'}${compact(Math.abs(netProfit))} ر.س`} note={monthLabel(period)} tone={netProfit == null ? 'neutral' : netProfit >= 0 ? 'green' : 'red'} onClick={() => navigate('/pnl')}/>
          <ExecutiveMetric icon={ReceiptText} label="فوترنا هذا الشهر" value={state.invoice?.hasData ? `${compact(state.invoice.invoiced)} ر.س` : 'غير متاح'} note={state.invoice?.hasData ? `${INT.format(state.invoice.invCount)} فاتورة` : 'من مرآة Zoho'} tone="blue" onClick={() => navigate('/zoho-data?tab=customers&type=invoices')}/>
          <ExecutiveMetric icon={Landmark} label="النقد والبنوك" value={cash.bankBalance == null ? 'غير متاح' : `${compact(cash.bankBalance)} ر.س`} note={cash.bankBalanceComplete ? 'أرصدة ختامية مكتملة' : 'حسب الحسابات المتاحة'} tone="blue" onClick={() => navigate('/money?tab=banks')}/>
          <ExecutiveMetric icon={WalletCards} label="القابل للتحصيل تشغيليًا" value={operationalCollectible == null ? 'غير متاح' : `${compact(operationalCollectible)} ر.س`} note={accountingOutstanding == null ? 'تعذر قراءة الرصيد المحاسبي' : `محاسبي ${compact(accountingOutstanding)} ر.س`} tone="green" onClick={() => navigate('/customer-money?worklist=1&returnTo=%2Fworkspace%2Ffinance')}/>
          <ExecutiveMetric icon={Building2} label="صافي الموردين" value={vendorPayable == null ? 'غير متاح' : `${compact(vendorPayable)} ر.س`} note={`${INT.format(Number(bills.overdue_count) || 0)} فاتورة مورد متأخرة`} tone={vendorPayable > 0.5 ? 'red' : 'green'} onClick={() => navigate('/zoho-data?tab=vendors&type=bills')}/>
          <ExecutiveMetric icon={ReceiptText} label={`ضريبة ${state.vat?.quarter || 'الربع الحالي'}`} value={state.vat ? `${compact(state.vat.netDue)} ر.س` : 'غير متاح'} note={state.vat ? `مخرجات ${compact(state.vat.outputTax)} · مدخلات ${compact(state.vat.inputTax)}` : 'من Zoho'} tone="amber" onClick={() => navigate('/pnl')}/>
        </div>
        {residual != null && Math.round(residual * 100) !== 0 ? <div className="fex-residual"><CircleAlert size={14}/><span>الرصيد الهامشي/غير التشغيلي: <b>{money(residual)} ر.س</b> — جزء من الرصيد المحاسبي ولا يدخل تلقائيًا في التحصيل أو الإيقاف.</span></div> : null}
      </section>

      <div className="fex-grid fex-grid--primary">
        <section className="fex-panel">
          <div className="fex-panel__heading"><div><span>الربحية</span><h2>كيف تحوّل الدخل إلى صافي ربح؟</h2></div><button onClick={() => navigate('/pnl')}>قائمة الدخل <ArrowLeft size={13}/></button></div>
          <PnlBridge snapshot={snapshot} onOpen={() => navigate('/pnl')}/>
          {state.invoice?.hasData ? <div className="fex-collection-line">
            <span><small>فوترنا</small><strong>{compact(state.invoice.invoiced)}</strong></span>
            <span><small>حصّلنا</small><strong>{compact(state.invoice.collected)}</strong></span>
            <span><small>متبقي من فواتير الشهر</small><strong>{compact(state.invoice.remaining)}</strong></span>
          </div> : null}
        </section>

        <section className="fex-panel">
          <div className="fex-panel__heading"><div><span>السيولة</span><h2>أين سيصل رصيدنا خلال 7 أيام؟</h2></div><button onClick={() => navigate('/forecast')}>كل الأحداث <ArrowLeft size={13}/></button></div>
          <div className="fex-forecast-summary">
            <span><ArrowUpCircle size={16}/><small>داخل متوقع</small><strong>{compact(state.forecast?.inflowTotal)} ر.س</strong></span>
            <span><ArrowDownCircle size={16}/><small>خارج متوقع</small><strong>{compact(state.forecast?.outflowTotal)} ر.س</strong></span>
            <span className={Number(state.forecast?.projectedBalance) < 0 ? 'is-danger' : ''}><Banknote size={16}/><small>الرصيد المتوقع</small><strong>{compact(state.forecast?.projectedBalance)} ر.س</strong></span>
          </div>
          <CashProjectionChart forecast={state.forecast} onOpen={() => navigate('/forecast')}/>
        </section>
      </div>

      <section className="fex-panel fex-position">
        <div className="fex-panel__heading"><div><span>رأس المال العامل</span><h2>ما المتاح بعد الأموال التي لنا والالتزامات التي علينا؟</h2></div><button onClick={() => navigate('/money')}>فتح النقد والتسويات <ArrowLeft size={13}/></button></div>
        <PositionEquation bank={cash.bankBalance} receivable={operationalCollectible} payable={vendorPayable} vat={state.vat?.netDue} onOpen={() => navigate('/money')}/>
        <div className="fex-control-rows">
          <button onClick={() => navigate('/zoho-data?tab=vendors&type=bills')}><Building2 size={17}/><span><strong>الموردون والمشتريات</strong><small>{INT.format(Number(vendor.vendors) || 0)} مورد · {money(vendor.outstanding_payable)} ر.س ذمم إجمالية</small></span><ArrowLeft size={14}/></button>
          <button onClick={() => navigate('/zoho-data?tab=banks&type=bank_accounts')}><Landmark size={17}/><span><strong>البنوك والخزائن</strong><small>{INT.format(Number(bank.linked_bank_count) || 0)} حساب بنكي مربوط · {INT.format(state.financial?.treasuries?.length || 0)} خزينة مصنفة</small></span><ArrowLeft size={14}/></button>
          <button onClick={() => navigate('/zoho-data?tab=accounts&type=chart_accounts')}><BookOpen size={17}/><span><strong>شجرة الحسابات والقيود</strong><small>افتح الدليل المحاسبي من مرآة Zoho عند الحاجة للتفصيل</small></span><ArrowLeft size={14}/></button>
          <button onClick={() => navigate('/reconciliation')}><Activity size={17}/><span><strong>المطابقة والرقابة</strong><small>فرق العملاء والموردين والبنوك دون تعديل المصدر</small></span><ArrowLeft size={14}/></button>
        </div>
      </section>

      <section className="fex-panel">
        <div className="fex-panel__heading"><div><span>أداء المتاجر</span><h2>من يعمل، من توقف، وأين توجد فرصة أو خطر؟</h2></div><button onClick={() => navigate('/customer-360')}>دليل المتاجر <ArrowLeft size={13}/></button></div>
        <MerchantPulse pulse={merchantPulse} navigate={navigate}/>
      </section>
    </div>
  );
}

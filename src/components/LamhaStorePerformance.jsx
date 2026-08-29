import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight,
  Clock3, PackageCheck, RefreshCw, Search, Store, Truck, UserPlus, UserRoundX,
} from 'lucide-react';
import { Btn, Card, Empty, Spinner } from './UI.jsx';
import { loadLamhaStorePerformance } from '../lib/retargetingService.js';
import { buildStore360Url } from '../lib/store360Navigation.js';
import './LamhaStorePerformance.css';

const PAGE_SIZE = 25;
const INT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const MONEY = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

const FILTERS = {
  all: 'كل المتاجر',
  shipped_today: 'شحنت اليوم',
  registered_today: 'سجلت اليوم',
  observed_today: 'ظهرت أول مرة لدينا',
  first_shipment: 'أول شحنة',
  resumed: 'عادت للشحن',
  disabled_today: 'أُوقفت اليوم',
  enabled_today: 'شُغلت اليوم',
  account_enabled: 'الحساب يعمل',
  account_disabled: 'الحساب موقوف',
  active_5d: 'نشط خلال 5 أيام',
  active_30d: 'نشط خلال 30 يومًا',
  never_shipped: 'لم يشحن',
  dormant_30: 'خامل أكثر من 30 يومًا',
  counter_exception: 'استثناء عداد الشحنات',
};

const ACTIVITY_LABELS = {
  active_5d: 'شحن خلال 5 أيام',
  active_30d: 'شحن خلال 30 يومًا',
  dormant_30: 'لم يشحن منذ 30+ يومًا',
  never_shipped: 'لم يشحن بعد',
};

const STAGE_LABELS = {
  registered_today: 'سجل اليوم',
  first_shipment: 'أول شحنة',
  resumed: 'عاد للشحن',
  active_5d: 'نشط حاليًا',
  active_30d: 'نشاط حديث',
  dormant_30: 'خامل',
  never_shipped: 'قبل أول شحنة',
};

const metricDate = value => {
  if (!value) return 'غير متاح';
  try { return new Date(`${value}T00:00:00+03:00`).toLocaleDateString('ar-SA', { day: 'numeric', month: 'long', year: 'numeric' }); }
  catch { return String(value); }
};

const shortDate = value => {
  if (!value) return '—';
  try { return new Date(value).toLocaleDateString('ar-SA', { day: 'numeric', month: 'short' }); }
  catch { return String(value).slice(0, 10); }
};

function Signal({ icon, label, value, hint, active, tone = 'neutral', onClick }) {
  return (
    <button type="button" className={`lamha-pulse-signal tone-${tone}${active ? ' is-active' : ''}`} onClick={onClick}>
      <span className="lamha-pulse-signal-icon">{icon}</span>
      <span><b>{INT.format(Number(value) || 0)}</b><small>{label}</small>{hint ? <em>{hint}</em> : null}</span>
      <ArrowLeft size={15}/>
    </button>
  );
}

function DimensionButton({ label, value, active, tone = 'neutral', onClick }) {
  return <button type="button" className={`lamha-dimension tone-${tone}${active ? ' is-active' : ''}`} onClick={onClick}><b>{INT.format(Number(value) || 0)}</b><span>{label}</span></button>;
}

function StateBadge({ row }) {
  if (row.accountState === 'disabled') return <span className="lamha-state danger">موقوف في لمحة</span>;
  if (row.accountState === 'enabled') return <span className="lamha-state success">قابل للشحن</span>;
  return <span className="lamha-state neutral">الحالة غير متاحة</span>;
}

export default function LamhaStorePerformance() {
  const navigate = useNavigate();
  const location = useLocation();
  const initialParams = useMemo(() => new URLSearchParams(location.search), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [filter, setFilter] = useState(() => FILTERS[initialParams.get('performanceFilter')] ? initialParams.get('performanceFilter') : 'all');
  const [search, setSearch] = useState(() => initialParams.get('performanceSearch') || '');
  const [appliedSearch, setAppliedSearch] = useState(() => initialParams.get('performanceSearch') || '');
  const [page, setPage] = useState(() => Math.max(0, Number(initialParams.get('performancePage')) - 1 || 0));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      const normalized = search.trim();
      setAppliedSearch(normalized);
      setPage(0);
      const params = new URLSearchParams(location.search);
      normalized ? params.set('performanceSearch', normalized) : params.delete('performanceSearch');
      params.delete('performancePage');
      navigate(`${location.pathname}?${params.toString()}`, { replace: true });
    }, 300);
    return () => clearTimeout(timer);
  }, [search, navigate, location.pathname]); // location.search is intentionally read from the search edit render

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await loadLamhaStorePerformance({ filter, search: appliedSearch, page, limit: PAGE_SIZE }));
    } catch (loadError) {
      setError(loadError.message || 'تعذر تحميل أداء متاجر لمحة');
    } finally {
      setLoading(false);
    }
  }, [filter, appliedSearch, page]);

  useEffect(() => { load(); }, [load]);

  const chooseFilter = next => {
    setFilter(next);
    setPage(0);
    const params = new URLSearchParams(location.search);
    next === 'all' ? params.delete('performanceFilter') : params.set('performanceFilter', next);
    params.delete('performancePage');
    navigate(`${location.pathname}?${params.toString()}`, { replace: true });
  };

  const changePage = nextPage => {
    const safePage = Math.max(0, nextPage);
    setPage(safePage);
    const params = new URLSearchParams(location.search);
    safePage ? params.set('performancePage', String(safePage + 1)) : params.delete('performancePage');
    navigate(`${location.pathname}?${params.toString()}`, { replace: true });
  };

  const openStore = row => {
    const url = buildStore360Url({
      storeId: row.storeId,
      source: 'lamha-store-performance',
      returnTo: `${location.pathname}${location.search}`,
    });
    if (url) navigate(url);
  };

  const summary = data?.summary || {};
  const maxTrend = useMemo(() => Math.max(1, ...(data?.trend || []).map(point => point.shipments)), [data?.trend]);
  const totalPages = Math.max(1, Math.ceil((data?.count || 0) / PAGE_SIZE));
  const sourceLabel = data?.metric?.source === 'lamha_employee_api_export_scheduled'
    ? 'مزامنة منتصف الليل'
    : data?.metric?.source === 'lamha_employee_api_export_manual'
      ? 'تحديث يدوي'
      : 'لقطة API الأقرب لمنتصف الليل';

  return (
    <section className="lamha-performance" aria-labelledby="lamha-performance-title">
      <div className="lamha-performance-heading">
        <div>
          <span className="lamha-performance-kicker">نبض لمحة اليومي</span>
          <h2 id="lamha-performance-title">ماذا حدث للمتاجر؟</h2>
          <p>الشحن والنشاط وحالة الحساب ثلاثة مفاهيم مستقلة. كل رقم يفتح متاجره في القائمة نفسها.</p>
        </div>
        <div className="lamha-performance-source">
          <span>{sourceLabel}</span>
          <b>{metricDate(data?.metric?.date)}</b>
          <Btn size="sm" variant="ghost" onClick={load} disabled={loading} aria-label="تحديث أداء متاجر لمحة"><RefreshCw size={14} className={loading ? 'spin' : ''}/></Btn>
        </div>
      </div>

      {error && !data ? (
        <Card className="lamha-pulse-error" role="alert"><AlertTriangle size={20}/><div><b>تعذر تجهيز نبض متاجر لمحة</b><span>{error}</span></div><Btn size="sm" variant="primary" onClick={load}>إعادة المحاولة</Btn></Card>
      ) : null}

      {!data && loading ? <div className="lamha-pulse-loading"><Spinner/><span>جارٍ بناء مقارنة اليوم…</span></div> : null}

      {data ? <>
        {!data.metric?.has_previous ? <div className="lamha-pulse-notice warning"><AlertTriangle size={16}/><span>لا توجد لقطة منتصف ليل سابقة؛ أرقام التغير اليومي تبقى صفرًا حتى تتوفر المقارنة، بينما حالة المتاجر الحالية متاحة.</span></div> : null}
        {Number(summary.counter_exceptions) > 0 ? <button type="button" className="lamha-pulse-notice danger" onClick={() => chooseFilter('counter_exception')}><AlertTriangle size={16}/><span>{INT.format(summary.counter_exceptions)} عدادات شحن تراجعت. عُزلت ولم تُخصم من شحنات اليوم.</span><ArrowLeft size={14}/></button> : null}

        <div className="lamha-pulse-signals">
          <Signal icon={<Truck size={18}/>} label="شحنة منذ منتصف الليل" value={summary.shipments_today} hint={`${INT.format(summary.shipping_stores || 0)} متجرًا شحن`} active={filter === 'shipped_today'} tone="brand" onClick={() => chooseFilter('shipped_today')}/>
          <Signal icon={<UserPlus size={18}/>} label="سجلوا في لمحة اليوم" value={summary.registered_today} hint={`${INT.format(summary.observed_today || 0)} ظهروا أول مرة لدينا`} active={filter === 'registered_today'} onClick={() => chooseFilter('registered_today')}/>
          <Signal icon={<PackageCheck size={18}/>} label="نفذوا أول شحنة" value={summary.first_shipment} active={filter === 'first_shipment'} tone="success" onClick={() => chooseFilter('first_shipment')}/>
          <Signal icon={<RefreshCw size={18}/>} label="عادوا للشحن" value={summary.resumed} hint="بعد انقطاع 60+ يومًا" active={filter === 'resumed'} tone="success" onClick={() => chooseFilter('resumed')}/>
          <Signal icon={<UserRoundX size={18}/>} label="أُوقفت حساباتهم" value={summary.disabled_today} active={filter === 'disabled_today'} tone="danger" onClick={() => chooseFilter('disabled_today')}/>
          <Signal icon={<CheckCircle2 size={18}/>} label="أُعيد تشغيل حساباتهم" value={summary.enabled_today} active={filter === 'enabled_today'} tone="success" onClick={() => chooseFilter('enabled_today')}/>
        </div>

        <div className="lamha-performance-body">
          <Card className="lamha-dimensions">
            <div className="lamha-dimension-group">
              <div><b>حالة الحساب</b><small>هل يستطيع إنشاء شحنة؟</small></div>
              <DimensionButton label="قابل للشحن" value={summary.account_enabled} active={filter === 'account_enabled'} tone="success" onClick={() => chooseFilter('account_enabled')}/>
              <DimensionButton label="موقوف في لمحة" value={summary.account_disabled} active={filter === 'account_disabled'} tone="danger" onClick={() => chooseFilter('account_disabled')}/>
              {Number(summary.account_unknown) > 0 ? <DimensionButton label="غير معروف" value={summary.account_unknown} active={false}/> : null}
            </div>
            <div className="lamha-dimension-group">
              <div><b>نشاط الشحن</b><small>متى كانت آخر شحنة؟</small></div>
              <DimensionButton label="آخر 5 أيام" value={summary.active_5d} active={filter === 'active_5d'} tone="success" onClick={() => chooseFilter('active_5d')}/>
              <DimensionButton label="آخر 30 يومًا" value={summary.active_30d} active={filter === 'active_30d'} onClick={() => chooseFilter('active_30d')}/>
              <DimensionButton label="خامل 30+ يومًا" value={summary.dormant_30} active={filter === 'dormant_30'} tone="warning" onClick={() => chooseFilter('dormant_30')}/>
              <DimensionButton label="لم يشحن" value={summary.never_shipped} active={filter === 'never_shipped'} onClick={() => chooseFilter('never_shipped')}/>
            </div>
          </Card>

          {data.trend?.length > 1 ? <Card className="lamha-daily-trend">
            <div className="lamha-trend-heading"><div><b>الشحنات اليومية الموثقة</b><small>فرق عداد لمحة بين لقطتي منتصف الليل</small></div><span>آخر {data.trend.length} أيام</span></div>
            <div className="lamha-trend-bars" aria-label="اتجاه الشحنات اليومية">
              {data.trend.map(point => <div key={point.date} title={`${metricDate(point.date)}: ${INT.format(point.shipments)} شحنة من ${INT.format(point.shippingStores)} متجر`}>
                <b>{INT.format(point.shipments)}</b>
                <span style={{ height: `${Math.max(4, Math.round((point.shipments / maxTrend) * 82))}px` }}/>
                <small>{shortDate(`${point.date}T00:00:00+03:00`)}</small>
              </div>)}
            </div>
          </Card> : null}
        </div>

        <Card className="lamha-result-set">
          <div className="lamha-result-toolbar">
            <div><b>{FILTERS[filter] || 'نتائج المتاجر'}</b><span>{INT.format(data.count)} نتيجة · افتح المتجر دون مغادرة سياق اليوم</span></div>
            <label><Search size={16}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="اسم المتجر، رقمه، أو الجوال"/></label>
            {filter !== 'all' || appliedSearch ? <button type="button" onClick={() => { chooseFilter('all'); setSearch(''); }}>مسح الفلاتر</button> : null}
          </div>

          {loading ? <div className="lamha-result-loading"><Spinner/><span>تحديث النتائج…</span></div> : null}
          {!loading && !data.rows.length ? <Empty icon="🏪" title="لا توجد متاجر مطابقة" sub="غيّر الفلتر أو عبارة البحث دون فقد سياق الصفحة."/> : null}
          {!loading && data.rows.length ? <div className="lamha-result-scroll">
            <table>
              <thead><tr><th>المتجر</th><th>شحن اليوم</th><th>آخر شحنة</th><th>حالة الحساب</th><th>نشاط الشحن</th><th>المرحلة</th><th>الدفع والربط</th><th aria-label="فتح المتجر"/></tr></thead>
              <tbody>{data.rows.map(row => <tr key={row.storeId} onClick={() => openStore(row)}>
                <td data-label="المتجر"><b>{row.storeName}</b><small><span dir="ltr">#{row.storeId}</span>{row.phone ? <span dir="ltr">{row.phone}</span> : null}</small></td>
                <td data-label="شحن اليوم"><b className={row.shipmentDelta > 0 ? 'positive' : row.negativeShipmentDelta < 0 ? 'danger-text' : ''}>{row.negativeShipmentDelta < 0 ? row.negativeShipmentDelta : `+${INT.format(row.shipmentDelta)}`}</b><small>{INT.format(row.shipmentCount)} تراكمي</small></td>
                <td data-label="آخر شحنة"><b>{row.daysSinceLast == null ? 'لم يشحن' : row.daysSinceLast === 0 ? 'اليوم' : `منذ ${INT.format(row.daysSinceLast)} يوم`}</b><small>{shortDate(row.lastShipmentAt)}</small></td>
                <td data-label="حالة الحساب"><StateBadge row={row}/>{row.rawStatus ? <small>قيمة لمحة: {row.rawStatus}</small> : null}</td>
                <td data-label="نشاط الشحن"><b>{ACTIVITY_LABELS[row.activityState] || row.activityState}</b></td>
                <td data-label="المرحلة"><span className={`lamha-stage ${row.lifecycleStage}`}>{STAGE_LABELS[row.lifecycleStage] || row.lifecycleStage}</span></td>
                <td data-label="الدفع والربط"><b>{row.billingType || 'غير متاح'}</b><small>{row.integrationType || 'بلا ربط ظاهر'}{row.walletBalance == null ? '' : ` · محفظة ${MONEY.format(row.walletBalance)} ر.س`}</small></td>
                <td><button type="button" onClick={event => { event.stopPropagation(); openStore(row); }} aria-label={`فتح ملف ${row.storeName}`}><ChevronLeft size={17}/></button></td>
              </tr>)}</tbody>
            </table>
          </div> : null}

          {data.count > PAGE_SIZE ? <div className="lamha-result-pagination">
            <Btn size="sm" variant="ghost" disabled={page === 0 || loading} onClick={() => changePage(page - 1)}><ChevronRight size={14}/> السابق</Btn>
            <span>صفحة {INT.format(page + 1)} من {INT.format(totalPages)}</span>
            <Btn size="sm" variant="ghost" disabled={page + 1 >= totalPages || loading} onClick={() => changePage(page + 1)}>التالي <ChevronLeft size={14}/></Btn>
          </div> : null}
        </Card>
      </> : null}
    </section>
  );
}

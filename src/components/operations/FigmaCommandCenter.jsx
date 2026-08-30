import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowDownCircle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Database,
  FileSpreadsheet,
  Landmark,
  PhoneCall,
  ReceiptText,
  RefreshCw,
  SlidersHorizontal,
  ShieldCheck,
  UploadCloud,
  UserRoundX,
  UsersRound,
  WalletCards,
  Workflow,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import {
  DEFAULT_SUSPENSION_MIN_OVERDUE, filterActionableSuspensionRows, suspensionDecisionAmount,
} from '../../lib/lamhaDecisionActions.js';
import {
  LAMHA_STATUS_UPDATED_EVENT,
  loadCachedLamhaStoreStatuses,
  readRecentLamhaFinancialHolds,
  readRecentLamhaStoreStatuses,
} from '../../lib/lamhaStoreStatusService.js';
import './figma-command-center.css';

const money = (value, digits = 0) => Number(value || 0).toLocaleString('en-US', {
  minimumFractionDigits: digits,
  maximumFractionDigits: digits,
});

const compactMoney = (value) => {
  const amount = Number(value || 0);
  const absolute = Math.abs(amount);
  if (absolute >= 1_000_000) return `${(amount / 1_000_000).toFixed(2)}م`;
  if (absolute >= 1_000) return `${(amount / 1_000).toFixed(1)}ك`;
  return money(amount);
};

const monthLabel = (period) => {
  if (!period) return 'الفترة الحالية';
  const [year, month] = period.split('-').map(Number);
  const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  return `${months[month - 1] || month} ${year}`;
};

const uploadDateLabel = (iso) => {
  if (!iso) return 'لم يُرفع بعد';
  return `آخر رفع ${new Intl.DateTimeFormat('ar-SA-u-ca-gregory', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(iso))}`;
};

const syncDateLabel = (iso) => {
  if (!iso) return 'لم تُسجل مزامنة بعد';
  return `آخر مزامنة ${new Intl.DateTimeFormat('ar-SA-u-ca-gregory', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(iso))}`;
};

const dateLabel = (iso) => {
  if (!iso) return null;
  return new Intl.DateTimeFormat('ar-SA-u-ca-gregory', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  }).format(new Date(iso));
};

const uploadEvidencePath = (item, period) => {
  const source = item?.sourceKind ? `&source=${encodeURIComponent(item.sourceKind)}` : '';
  return `/accounting-cycle?period=${period}&stage=${item?.stage || 'carrier_audits'}${source}`;
};

const sourceTone = (state) => {
  if (!state || state.status === 'unavailable') return 'red';
  if (state.status === 'loading') return 'amber';
  if (state.status === 'fresh') return 'green';
  return 'amber';
};

const sourceLabel = (state) => {
  if (!state || state.status === 'unavailable') return 'غير متاح';
  if (state.status === 'loading') return 'جارٍ التحميل';
  if (state.status === 'fresh') return 'محدّث';
  return 'يحتاج تحديث';
};

const operationalBlockerReason = (reason) => {
  const value = String(reason || '').trim();
  if (!value) return 'تعذر التحقق من المصدر؛ لا يمكن تأكيد الجاهزية الآن.';
  if (/(column|relation)\s+.+does not exist|undefined|null reference|sql|pgrst|schema cache|syntax error/i.test(value)) {
    return 'تعذر التحقق من المصدر؛ آخر البيانات المتاحة لا تكفي لتأكيد الجاهزية.';
  }
  return value;
};

function ActionCard({ tone, icon: Icon, title, count, value, note, action, onClick, unavailable = false, source, statusMessage = null }) {
  const sourceName = source?.label || source?.source || 'المصدر التشغيلي';
  return (
    <button className={`fco-action-row fco-action-row--${tone}`} type="button" onClick={onClick}>
      <span className="fco-action-row__icon"><Icon size={19}/></span>
      <span className="fco-action-row__content">
        <strong>{title}</strong>
        <small>{note}</small>
      </span>
      <span className="fco-action-row__metric">
        <small>الحالات</small>
        <strong>{unavailable ? '—' : money(count || 0)}</strong>
      </span>
      <span className="fco-action-row__metric">
        <small>الأثر</small>
        <strong>{unavailable ? '—' : value || '—'}</strong>
      </span>
      <span className="fco-action-row__source">
        <small>{sourceName}</small>
        <strong>{unavailable ? 'غير متاح' : statusMessage || sourceLabel(source)}</strong>
      </span>
      <span className="fco-action-row__action">{action}<ArrowLeft size={14}/></span>
    </button>
  );
}

function WorklistBuilder({ navigate }) {
  return (
    <div className="fco-worklist-builder">
      <button className="fco-worklist-builder__trigger" type="button" onClick={() => navigate('/customer-money?worklist=1&returnTo=%2Foverview')}>
        <span className="fco-worklist-builder__icon"><SlidersHorizontal size={19}/></span>
        <span><strong>أنشئ قائمة تنفيذ بشروطك</strong><small>أضف أو احذف أي شرط، شاهد النتائج فورًا، ثم حدد ونفّذ الإجراء من الشاشة نفسها.</small></span>
        <em>لا توجد شروط مفروضة</em>
        <span className="fco-worklist-builder__cta">فتح قائمة التنفيذ</span>
      </button>
    </div>
  );
}

function FinancialMetric({ label, value, note, icon: Icon, onClick, tone = 'neutral', sourceState, unavailable = false }) {
  return (
    <button type="button" className={`fco-financial-metric is-${tone}${unavailable ? ' is-unavailable' : ''}`} onClick={onClick}>
      <span className="fco-financial-metric__icon"><Icon size={17}/></span>
      <span><small>{label}</small><strong>{unavailable ? 'غير متاح' : value}</strong><em>{note}</em></span>
      <i className={`fco-source-dot fco-source-dot--${sourceTone(sourceState)}`}/>
    </button>
  );
}

function ProfitMicro({ snapshot, loading, onClick }) {
  if (loading) return <div className="fco-insight-empty">جارٍ قراءة قائمة الدخل…</div>;
  if (!snapshot) return <button type="button" className="fco-insight-empty" onClick={onClick}>قائمة الدخل غير متاحة لهذه الفترة</button>;
  const rows = [
    { label: 'الدخل', value: Number(snapshot.income) || 0, tone: 'green' },
    { label: 'تكلفة المبيعات', value: Number(snapshot.cogs) || 0, tone: 'red' },
    { label: 'المصروفات', value: Number(snapshot.opex) || 0, tone: 'amber' },
    { label: 'صافي الربح', value: Number(snapshot.net) || 0, tone: Number(snapshot.net) >= 0 ? 'blue' : 'red' },
  ];
  const max = Math.max(1, ...rows.map(row => Math.abs(row.value)));
  return <div className="fco-profit-micro" aria-label="تركيب صافي الربح">
    {rows.map(row => <button type="button" key={row.label} onClick={onClick} className={`is-${row.tone}`}>
      <span>{row.label}</span><i><b style={{ '--share': `${Math.max(3, Math.abs(row.value) / max * 100)}%` }}/></i><strong>{compactMoney(row.value)} ر.س</strong>
    </button>)}
  </div>;
}

function CashflowMicro({ forecast, loading, currentOnly, onClick }) {
  const points = forecast?.bankBalance == null ? [] : [
    Number(forecast.bankBalance) || 0,
    ...(forecast.dailyFlow || []).map(row => Number(row.runningBalance) || 0),
  ];
  if (loading) return <div className="fco-insight-empty">جارٍ قراءة تدفقات الأيام القادمة…</div>;
  if (currentOnly) return <button type="button" className="fco-insight-empty" onClick={onClick}>توقع السيولة يعرض للشهر الحالي فقط</button>;
  if (points.length < 2) return <button type="button" className="fco-insight-empty" onClick={onClick}>لا توجد أحداث مؤرخة تكفي لرسم السيولة</button>;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = Math.max(1, max - min);
  const plot = points.map((value, index) => ({
    value,
    x: 16 + index * (268 / Math.max(1, points.length - 1)),
    y: 15 + ((max - value) / range) * 58,
  }));
  const path = plot.map(point => `${point.x},${point.y}`).join(' ');
  return <button type="button" className={`fco-cashflow-micro${min < 0 ? ' is-danger' : ''}`} onClick={onClick}>
    <svg viewBox="0 0 300 94" role="img" aria-labelledby="fco-cashflow-title" preserveAspectRatio="none">
      <title id="fco-cashflow-title">توقع رصيد السيولة خلال سبعة أيام</title>
      <line x1="16" y1="74" x2="284" y2="74"/><polyline points={path}/>
      {plot.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="3"/>)}
    </svg>
    <span><b>اليوم {compactMoney(points[0])}</b><b>متوقع {compactMoney(points.at(-1))}</b></span>
  </button>;
}

function TaskRow({ icon: Icon, title, note, status, tone, onClick }) {
  return (
    <button className="fco-task" type="button" onClick={onClick}>
      <span className={`fco-task__icon fco-task__icon--${tone}`}><Icon size={17}/></span>
      <span className="fco-task__copy"><strong>{title}</strong><small>{note}</small></span>
      <span className={`fco-status fco-status--${tone}`}>{status}</span>
      <ArrowLeft size={15}/>
    </button>
  );
}

function MovementMetric({ label, value, note, tone = 'blue', onClick }) {
  const Component = onClick ? 'button' : 'article';
  return (
    <Component className={`fco-movement__metric fco-movement__metric--${tone}${onClick ? ' is-action' : ''}`} type={onClick ? 'button' : undefined} onClick={onClick}>
      <strong>{value}</strong><span>{label}</span><small>{note}</small>{onClick ? <ArrowLeft size={13}/> : null}
    </Component>
  );
}

function AgingBand({ label, value, tone }) {
  return <div className="fco-aging__band"><span><i className={`fco-dot fco-dot--${tone}`}/>{label}</span><strong>{compactMoney(value)}</strong></div>;
}

function IntegrationItem({ name, state, note, onClick, icon: Icon = Database }) {
  const tone = sourceTone(state);
  return (
    <button type="button" className="fco-integration" onClick={onClick}>
      <span className={`fco-integration__icon fco-integration__icon--${tone}`}><Icon size={17}/></span>
      <span><strong>{name}</strong><small>{note || sourceLabel(state)}</small></span>
      <i className={`fco-source-dot fco-source-dot--${tone}`}/>
    </button>
  );
}

export default function FigmaCommandCenter({
  data,
  vat,
  executiveFinance,
  customerGrowth,
  period,
  refreshing,
  onRefresh,
  onPrevious,
  onNext,
  onCurrent,
  isCurrent,
  navigate,
}) {
  const decisions = data?.customerDecisions || {};
  const decisionSummary = data?.customerDecisionSummary || {};
  const stopRows = decisions.stopPostpaid || [];
  const deductRows = decisions.deductPrepaid || [];
  const negativeRows = decisions.negativePrepaid || [];
  const thresholdStopRows = stopRows.filter(row => suspensionDecisionAmount(row) > DEFAULT_SUSPENSION_MIN_OVERDUE);
  const stopStoreIds = thresholdStopRows.map(row => Number(row.storeId)).filter(Number.isSafeInteger);
  const stopStoreIdsKey = stopStoreIds.join(',');
  const [recentStopStatuses, setRecentStopStatuses] = useState(() => readRecentLamhaStoreStatuses(stopStoreIds));
  const [financialHoldStoreIds, setFinancialHoldStoreIds] = useState(() => readRecentLamhaFinancialHolds());
  const [stopStatusLoading, setStopStatusLoading] = useState(stopStoreIds.length > 0);
  const [stopStatusError, setStopStatusError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refreshLocalState = () => {
      setRecentStopStatuses(readRecentLamhaStoreStatuses(stopStoreIds));
      setFinancialHoldStoreIds(readRecentLamhaFinancialHolds());
    };
    refreshLocalState();
    if (!stopStoreIds.length) {
      setStopStatusLoading(false);
      setStopStatusError(false);
      return undefined;
    }
    setStopStatusLoading(true);
    setStopStatusError(false);
    loadCachedLamhaStoreStatuses(stopStoreIds).then(result => {
      if (cancelled) return;
      setRecentStopStatuses(new Map((result.results || []).map(item => [Number(item.storeId), item])));
      setFinancialHoldStoreIds(new Set((result.financialHoldStoreIds || []).map(Number)));
    }).catch(() => {
      if (!cancelled) setStopStatusError(true);
    }).finally(() => {
      if (!cancelled) setStopStatusLoading(false);
    });
    window.addEventListener(LAMHA_STATUS_UPDATED_EVENT, refreshLocalState);
    return () => {
      cancelled = true;
      window.removeEventListener(LAMHA_STATUS_UPDATED_EVENT, refreshLocalState);
    };
  }, [stopStoreIdsKey]);

  const actionableStopRows = filterActionableSuspensionRows(thresholdStopRows, {
    minAmount: DEFAULT_SUSPENSION_MIN_OVERDUE,
    financialHoldStoreIds,
    liveStatuses: recentStopStatuses,
  });
  const stopCount = Array.isArray(decisions.stopPostpaid)
    ? actionableStopRows.length
    : decisionSummary.stopPostpaid?.count ?? 0;
  const deductCount = decisionSummary.deductPrepaid?.count ?? deductRows.length;
  const negativeCount = decisionSummary.negativeWallet?.count ?? decisionSummary.negativePrepaid?.count ?? negativeRows.length;
  const stopAmount = Array.isArray(decisions.stopPostpaid)
    ? actionableStopRows.reduce((sum, row) => sum + suspensionDecisionAmount(row), 0)
    : decisionSummary.stopPostpaid?.amount ?? 0;
  const deductAmount = decisionSummary.deductPrepaid?.amount
    ?? deductRows.reduce((sum, row) => sum + Math.min(Number(row.walletBalance || 0), Number(row.debt || 0)), 0);
  const negativeAmount = decisionSummary.negativeWallet?.amount ?? decisionSummary.negativePrepaid?.amount
    ?? negativeRows.reduce((sum, row) => sum + Math.abs(Math.min(0, Number(row.walletBalance || 0))), 0);
  const negativeAvailable = Array.isArray(decisions.negativePrepaid) || !!decisionSummary.negativeWallet || !!decisionSummary.negativePrepaid;
  const invoiceOps = data?.invoiceOperations || {};
  const zatcaCount = Number(invoiceOps.zatcaTodayCount || 0) + Number(invoiceOps.zatcaOverdueCount || 0);
  const zatcaAmount = Number(invoiceOps.zatcaTodayTotal || 0) + Number(invoiceOps.zatcaOverdueTotal || 0);
  const merchantPulse = data?.merchantPulse || {};
  const growth = customerGrowth?.data || {};
  const growthCurrent = growth.current || {};
  const growthMovement = growth.movement || {};
  const growthExecution = growth.execution || {};
  const growthOutcomes = growth.outcomes30d || {};
  const growthAvailable = Boolean(customerGrowth?.data && !customerGrowth?.error);
  const growthProgress = Math.max(0, Math.min(100, Number(growthCurrent.progress_pct) || 0));
  const aging = data?.customerAging || {};
  const overdue30 = Number(aging.b31_60 || 0) + Number(aging.b61_90 || 0) + Number(aging.b90p || 0);
  const cash = data?.cashPosition || {};
  const accountingOutstanding = Number(cash.grossAR ?? cash.totalAR);
  const operationalCollectible = Number(cash.totalAR);
  const residualBalance = Number.isFinite(accountingOutstanding) && Number.isFinite(operationalCollectible)
    ? +(accountingOutstanding - operationalCollectible).toFixed(2)
    : null;
  const states = data?.sourceStates || {};
  const sourceEntries = Object.values(data?.primarySourceStates || states);
  const availableSources = sourceEntries.filter((source) => source?.status !== 'unavailable').length;
  const freshSources = sourceEntries.filter((source) => source?.status === 'fresh').length;
  const availabilityPercent = sourceEntries.length ? Math.round((availableSources / sourceEntries.length) * 100) : 0;
  const sourcePercent = sourceEntries.length ? Math.round((freshSources / sourceEntries.length) * 100) : 0;
  const closeReadiness = data?.closeReadiness || { ready: false, completed: 0, required: 6, blockers: [] };
  const firstCloseBlocker = closeReadiness.blockers?.[0];
  const operationalUploads = data?.operationalUploads || null;
  const uploadItems = operationalUploads?.items || [];
  const merchantExcelEvidence = uploadItems.find(item => item.key === 'lamha_merchants_excel');
  const apiNeedsUpdate = !merchantPulse.available || sourceTone(states.merchants) !== 'green';
  const merchantExcelMissing = operationalUploads?.available && merchantExcelEvidence && !merchantExcelEvidence.uploaded;
  const merchantNeedsUpdate = (data?.lamhaSourceNeedsUpdate ?? apiNeedsUpdate) || merchantExcelMissing;
  const missingUploadCount = operationalUploads?.available
    ? uploadItems.filter(item => !item.uploaded).length
    : null;
  const decisionSourceUnavailable = [states.customerMoney || states.finance, states.merchants]
    .some(source => source?.status === 'unavailable');
  const decisionGuard = {
    status: decisionSourceUnavailable ? 'unavailable' : data?.customerDecisionFresh ? 'ready' : 'stale',
    message: decisionSourceUnavailable
      ? 'تعذر التحقق من أحد المصدرين'
      : data?.customerDecisionFresh ? 'جاهز للقرار' : 'للعرض فقط · يُعاد التحقق داخل النتائج',
  };
  const financePulse = executiveFinance?.period === period ? executiveFinance : { loading: true };
  const netProfit = financePulse.snapshot ? Number(financePulse.snapshot.net) : null;
  const showStopSignal = stopCount > 0 || decisionGuard.status === 'unavailable';
  const showDeductSignal = deductCount > 0 || decisionGuard.status === 'unavailable';
  const showNegativeSignal = negativeCount > 0 || !negativeAvailable;
  const showZatcaSignal = zatcaCount > 0 || !invoiceOps.zatcaAvailable;
  const showLamhaSignal = merchantNeedsUpdate || (!merchantPulse.loading && !merchantPulse.available);
  const hasAutomatedSignals = showStopSignal || showDeductSignal || showNegativeSignal || showZatcaSignal || showLamhaSignal;

  return (
    <div className="figma-command-center" dir="rtl">
      <section className="fco-heading">
        <div>
          <h1>مركز القيادة</h1>
          <p>ما الذي يحتاج قرارك اليوم؟ صورة موحدة مرتبة حسب الأثر والخطر وقابلية التنفيذ.</p>
        </div>
        <div className="fco-heading__actions">
          {data?.loadedAt ? <small className="fco-heading__updated">آخر تحديث {dateLabel(data.loadedAt)}</small> : null}
          <div className="fco-period" aria-label="الفترة المعروضة">
            <button type="button" onClick={onPrevious} aria-label="الشهر السابق">›</button>
            <span><CalendarDays size={15}/>{monthLabel(period)}</span>
            {!isCurrent && <button type="button" onClick={onNext} aria-label="الشهر التالي">‹</button>}
          </div>
          {!isCurrent && <button className="fco-current" type="button" onClick={onCurrent}>الشهر الحالي</button>}
          <button
            className="fco-refresh"
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="تحديث بيانات العرض فقط"
            title="تحديث بيانات العرض فقط"
          >
            <RefreshCw size={16} className={refreshing ? 'is-spinning' : ''}/><span>تحديث العرض</span>
          </button>
        </div>
      </section>

      <div className={`fco-freshness fco-freshness--${closeReadiness.ready ? 'green' : 'amber'}`}>
        <div className="fco-readiness-facts" aria-label="توفر المصادر وحداثة البيانات وجاهزية الإقفال">
          <span><Database size={17}/><strong>توفر المصادر {availabilityPercent}%</strong><small>{availableSources} من {sourceEntries.length || 0} متاحة</small></span>
          <span><Activity size={17}/><strong>حداثة البيانات {sourcePercent}%</strong><small>{freshSources} من {sourceEntries.length || 0} حديثة</small></span>
          <span className={closeReadiness.ready ? 'is-ready' : 'is-blocked'}><CheckCircle2 size={17}/><strong>جاهزية الإقفال: {closeReadiness.ready ? 'جاهز' : 'متوقف'}</strong><small>{closeReadiness.ready ? 'المراحل الحرجة مكتملة' : `${firstCloseBlocker?.source || 'مصدر حرج'}: ${operationalBlockerReason(firstCloseBlocker?.reason)}`}</small></span>
        </div>
        <button type="button" onClick={() => navigate('/operations')}>مراقبة التكاملات <ArrowLeft size={14}/></button>
      </div>

      <div className="fco-command-grid">
      <section className="fco-section fco-command-grid__worklists">
        <div className="fco-section__heading"><div><h2>قائمة العمل والقرارات</h2><span>ابدأ بشروطك أو افتح قائمة جاهزة من استثناء حقيقي</span></div><small>النتائج والتحديد والإجراء في مساحة واحدة</small></div>
        <WorklistBuilder navigate={navigate}/>
        <div className="fco-saved-worklists"><strong>تنبيهات آلية</strong><small>تكشف الاستثناءات فقط؛ التنفيذ المرن يبدأ من قائمة التنفيذ أعلاه</small></div>
        <div className="fco-actions-list">
          {showStopSignal ? <ActionCard tone="red" icon={UserRoundX} title="حسابات مرشحة للإيقاف" count={stopCount} value={`${compactMoney(stopAmount)} ر.س`} note={`دفع لاحق · الحساب يعمل · تجاوز 30 يومًا · أكثر من ${money(DEFAULT_SUSPENSION_MIN_OVERDUE)} ر.س`} action="عرض النتائج" onClick={() => navigate(`/customer-money?decision=stop&decisionMin=${DEFAULT_SUSPENSION_MIN_OVERDUE}&returnTo=%2Foverview`)} unavailable={decisionGuard.status === 'unavailable'} statusMessage={stopStatusLoading ? 'جارٍ التحقق الحي' : stopStatusError ? 'يُعاد الفحص داخل النتائج' : decisionGuard.message} source={states.customerMoney || states.finance || states.zohoInvoices}/> : null}
          {showDeductSignal ? <ActionCard tone="blue" icon={WalletCards} title="محفظة موجبة مع فواتير غير مسددة" count={deductCount} value={`${compactMoney(deductAmount)} ر.س`} note="مراجعة تشغيلية للإيقاف؛ تسوية Zoho إجراء مستقل" action="عرض النتائج" onClick={() => navigate('/customer-money?decision=deduct&returnTo=%2Foverview')} unavailable={decisionGuard.status === 'unavailable'} statusMessage={decisionGuard.message} source={states.customerMoney || states.finance || states.zohoInvoices}/> : null}
          {showNegativeSignal ? <ActionCard tone="red" icon={CircleAlert} title="محافظ سالبة تحتاج قرارًا" count={negativeCount} value={`${compactMoney(negativeAmount)} ر.س`} note="إشارة من محفظة لمحة؛ حالة تشغيل الحساب تُفحص حيًا قبل أي إيقاف" action="عرض النتائج" onClick={() => navigate('/customer-money?decision=negative&returnTo=%2Foverview')} unavailable={!negativeAvailable} source={states.merchants}/> : null}
          {showZatcaSignal ? <ActionCard tone={zatcaCount ? 'amber' : 'red'} icon={ReceiptText} title="فواتير زاتكا تحتاج إجراء" count={zatcaCount} value={`${compactMoney(zatcaAmount)} ر.س`} note={`${invoiceOps.draftCount || 0} مسودة في Zoho Books`} action="عرض الفواتير" onClick={() => navigate('/zoho-data?tab=customers&type=invoices&focus=zatca')} unavailable={!invoiceOps.zatcaAvailable} source={states.zatcaPending}/> : null}
          {showLamhaSignal ? <ActionCard tone="amber" icon={FileSpreadsheet} title="مصدر Lamha يحتاج مراجعة" count={merchantNeedsUpdate ? 1 : 0} value={merchantPulse.total ? `${money(merchantPulse.total)} متجر` : ''} note={apiNeedsUpdate ? 'مزامنة Lamha API تحتاج مراجعة' : merchantExcelMissing ? 'ملف إثراء المتاجر من Excel غير مرفوع لهذه الفترة' : 'API يحتاج فحصًا'} action={apiNeedsUpdate ? 'مراقبة المزامنة' : 'فتح مرحلة الرفع'} onClick={() => navigate(apiNeedsUpdate ? '/operations' : `/accounting-cycle?period=${period}&stage=lamha_sources`)} unavailable={!merchantPulse.loading && !merchantPulse.available} source={states.merchants}/> : null}
          {!hasAutomatedSignals ? <div className="fco-no-exceptions"><CheckCircle2 size={18}/><span><strong>لا توجد استثناءات حرجة حاليًا</strong><small>ابنِ قائمة بشروطك لإجراء مراجعة أو تنفيذ مخصص.</small></span></div> : null}
        </div>
      </section>

      <section className="fco-section fco-command-grid__finance">
        <div className="fco-section__heading"><div><span>المركز المالي الآن</span><h2>أين المال وما الذي يغيّر القرار؟</h2></div><button type="button" onClick={() => navigate('/workspace/finance')}>فتح المالية <ArrowLeft size={14}/></button></div>
        <div className="fco-financial-strip fco-company-strip">
          <FinancialMetric icon={netProfit != null && netProfit >= 0 ? TrendingUp : TrendingDown} label="صافي الربح" value={netProfit == null ? '—' : `${netProfit >= 0 ? '+' : '−'}${compactMoney(Math.abs(netProfit))} ر.س`} note={monthLabel(period)} sourceState={states.finance} unavailable={netProfit == null && !financePulse.loading} tone={netProfit != null && netProfit < 0 ? 'red' : 'green'} onClick={() => navigate('/pnl')}/>
          <FinancialMetric icon={ReceiptText} label="فوترنا هذا الشهر" value={financePulse.invoice?.hasData ? `${compactMoney(financePulse.invoice.invoiced)} ر.س` : '—'} note={financePulse.invoice?.hasData ? `${money(financePulse.invoice.invCount)} فاتورة` : 'من مرآة Zoho'} sourceState={states.finance} unavailable={!financePulse.loading && !financePulse.invoice?.hasData} tone="blue" onClick={() => navigate('/zoho-data?tab=customers&type=invoices')}/>
          <FinancialMetric icon={Landmark} label="النقد والبنوك" value={cash.bankBalance == null ? '—' : `${compactMoney(cash.bankBalance)} ر.س`} note={cash.bankBalanceComplete ? 'أرصدة ختامية مكتملة' : 'من الحسابات المتاحة'} sourceState={states.banks} unavailable={cash.bankBalance == null} tone="blue" onClick={() => navigate('/money?tab=banks')}/>
          <FinancialMetric icon={ReceiptText} label="إجمالي الرصيد المحاسبي" value={`${compactMoney(accountingOutstanding)} ر.س`} note="Zoho outstanding_receivable · رقم محاسبي خام" sourceState={states.customerMoney || states.zohoInvoices} unavailable={!Number.isFinite(accountingOutstanding)} onClick={() => navigate('/customer-money')}/>
          <FinancialMetric icon={WalletCards} label="القابل للتحصيل تشغيليًا" value={`${compactMoney(operationalCollectible)} ر.س`} note={`${compactMoney(overdue30)} ر.س تجاوزت 30 يومًا`} sourceState={states.customerMoney || states.zohoInvoices} unavailable={!Number.isFinite(operationalCollectible)} tone="green" onClick={() => navigate('/customer-money?worklist=1')}/>
          {residualBalance != null && Math.round(residualBalance * 100) !== 0 ? <FinancialMetric icon={CircleAlert} label="الرصيد الهامشي / غير التشغيلي" value={`${money(residualBalance, 2)} ر.س`} note="محاسبي فقط · لا يدخل الإيقاف أو التحصيل" sourceState={states.customerMoney || states.zohoInvoices} tone="neutral" onClick={() => navigate('/customer-money')}/> : null}
          <FinancialMetric icon={ArrowDownCircle} label="التزامات علينا" value={`${compactMoney(cash.totalAP)} ر.س`} note="موردون وشركات شحن" sourceState={states.finance} tone="red" onClick={() => navigate('/pnl')}/>
          <FinancialMetric icon={ReceiptText} label={`ضريبة ${vat?.quarter || 'الربع الحالي'}`} value={vat ? `${compactMoney(vat.netDue)} ر.س` : '—'} note={vat ? `${vat.from} — ${vat.to} · مخرجات ${compactMoney(vat.outputTax)} · مدخلات ${compactMoney(vat.inputTax)}` : 'تحتاج قراءة Zoho'} sourceState={states.zatcaPending} unavailable={!vat} tone="amber" onClick={() => navigate('/zoho-data?tab=reports')}/>
        </div>
        <div className="fco-finance-insights">
          <article><header><span>من الدخل إلى صافي الربح</span><button type="button" onClick={() => navigate('/pnl')}>التفاصيل</button></header><ProfitMicro snapshot={financePulse.snapshot} loading={financePulse.loading} onClick={() => navigate('/pnl')}/></article>
          <article><header><span>رصيد السيولة خلال 7 أيام</span><button type="button" onClick={() => navigate('/forecast')}>الأحداث</button></header><CashflowMicro forecast={financePulse.forecast} loading={financePulse.loading} currentOnly={financePulse.forecastCurrentOnly} onClick={() => navigate('/forecast')}/></article>
        </div>
      </section>
      </div>

      <details className="fco-operations-disclosure">
        <summary><span><Database size={16}/><strong>مصادر Lamha وملفات الدورة</strong><small>المزامنة، آخر رفع، والملفات الناقصة</small></span><em>{missingUploadCount == null ? 'الحالة غير متاحة' : missingUploadCount ? `${missingUploadCount} عناصر تحتاج رفعًا` : 'الملفات مكتملة'}</em><ArrowLeft size={15}/></summary>
      <section className="fco-section fco-lamha-upload">
        <div className="fco-section__heading">
          <div><span>مصادر Lamha الأساسية</span><h2>مزامنة API يومية وملفات Excel للإثراء فقط</h2></div>
          <details className="fco-upload-menu">
            <summary><UploadCloud size={16}/> رفع ملف لمحة</summary>
            <div className="fco-upload-menu__popover">
              <button type="button" onClick={() => navigate(`/accounting-cycle?period=${period}&stage=lamha_sources&source=merchants`)}>
                <FileSpreadsheet size={18}/><span><strong>إثراء المتاجر من Excel</strong><small>{uploadDateLabel(data?.lamhaUploads?.merchants?.excelUploadedAt)}</small></span><ArrowLeft size={15}/>
              </button>
              <button type="button" onClick={() => navigate(`/accounting-cycle?period=${period}&stage=lamha_sources&source=internal_settlement`)}>
                <ReceiptText size={18}/><span><strong>كشف حساب لمحة</strong><small>{uploadDateLabel(data?.lamhaUploads?.balance?.uploadedAt)}</small></span><ArrowLeft size={15}/>
              </button>
            </div>
          </details>
        </div>
        <div className="fco-lamha-upload__status">
          <button type="button" onClick={() => navigate('/operations')}><RefreshCw size={17}/><span><strong>دليل المتاجر من Lamha API</strong><small>{syncDateLabel(data?.lamhaUploads?.merchants?.apiSyncedAt || data?.lamhaUploads?.merchants?.uploadedAt)}</small></span></button>
          <button type="button" onClick={() => navigate(`/accounting-cycle?period=${period}&stage=lamha_sources&source=merchants`)}><FileSpreadsheet size={17}/><span><strong>إثراء المتاجر من Excel</strong><small>{data?.lamhaUploads?.merchants?.excelFileName ? `${data.lamhaUploads.merchants.excelFileName} · ${uploadDateLabel(data.lamhaUploads.merchants.excelUploadedAt)}` : uploadDateLabel(data?.lamhaUploads?.merchants?.excelUploadedAt)}</small></span></button>
          <button type="button" onClick={() => navigate(`/accounting-cycle?period=${period}&stage=lamha_sources&source=internal_settlement`)}><ReceiptText size={17}/><span><strong>كشف حساب Lamha</strong><small>{data?.lamhaUploads?.balance?.fileName ? `${data.lamhaUploads.balance.fileName} · ${uploadDateLabel(data.lamhaUploads.balance.uploadedAt)}` : uploadDateLabel(data?.lamhaUploads?.balance?.uploadedAt)}</small></span></button>
        </div>
        <div className="fco-upload-evidence" aria-label="حالة ملفات الدورة الحالية">
          <div className="fco-upload-evidence__heading">
            <strong>ملفات {monthLabel(period)}</strong>
            <small>{missingUploadCount == null ? 'تعذر التحقق من سجل الرفع' : missingUploadCount ? `${missingUploadCount} عناصر بلا رفع ناجح مسجل` : 'كل الملفات المطلوبة مسجلة'}</small>
          </div>
          {operationalUploads?.available ? (
            <div className="fco-upload-evidence__rows">
              {uploadItems.map(item => (
                <button key={item.key} type="button" onClick={() => navigate(uploadEvidencePath(item, period))}>
                  <span className={`fco-upload-evidence__state ${item.uploaded ? 'is-complete' : 'is-missing'}`}>{item.uploaded ? <CheckCircle2 size={15}/> : <Clock3 size={15}/>}</span>
                  <span><strong>{item.label}</strong><small>{item.uploaded ? `${item.fileName} · ${uploadDateLabel(item.uploadedAt)}` : 'لا يوجد رفع ناجح مسجل لهذه الفترة'}</small></span>
                  <em>{item.uploaded ? 'مسجل' : item.action}</em><ArrowLeft size={14}/>
                </button>
              ))}
            </div>
          ) : <p className="fco-upload-evidence__error">تعذر قراءة سجل الملفات؛ افتح دورة المحاسب للتحقق دون افتراض أن الملفات ناقصة.</p>}
        </div>
      </section>
      </details>

      <div className="fco-dashboard-grid">
        <section className="fco-panel fco-movement">
          <div className="fco-card-heading"><span><UsersRound size={18}/> نمو العملاء النشطين</span><button type="button" onClick={() => navigate('/retargeting?view=activation')}>فتح مركز النمو <ArrowLeft size={14}/></button></div>
          <div className="fco-growth-target">
            <div><small>نشط خلال {customerGrowth?.config?.days || 5} أيام</small><strong>{growthAvailable ? money(growthCurrent.active) : customerGrowth?.loading ? '…' : '—'} <span>من {growthAvailable ? money(growthCurrent.target) : '—'}</span></strong></div>
            <div><span>الفجوة إلى المستهدف</span><b>{growthAvailable ? money(growthCurrent.gap) : '—'} عميل</b></div>
            <div className="fco-growth-target__track"><i style={{ width: `${growthProgress}%` }}/></div>
          </div>
          <div className="fco-movement__grid">
            <MovementMetric label="نشطون الآن" value={growthAvailable ? growthCurrent.active : '—'} note="عملاء فريدون بالهاتف" tone="green" onClick={() => navigate('/retargeting?view=activation&performanceFilter=active_5d')}/>
            <MovementMetric label="متاجر لم تشحن إطلاقًا" value={merchantPulse.available ? merchantPulse.neverShipped : '—'} note="تذهب إلى فريق المبيعات" tone="amber" onClick={() => navigate('/retargeting?view=activation&performanceFilter=never_shipped')}/>
            <MovementMetric label="اشتغلوا ثم توقفوا" value={growthAvailable ? money(customerGrowth.stoppedCount) : '—'} note="تذهب إلى الحفاظ على العملاء" tone="red" onClick={() => navigate('/retargeting?tab=pipeline&bucket=stopped&work=all')}/>
            <MovementMetric label="عادوا للشحن" value={growthAvailable ? growthOutcomes.resumed : '—'} note="نتيجة موضوعية آخر 30 يومًا" tone="blue" onClick={() => navigate('/retargeting?tab=pipeline&bucket=reactivated&work=all')}/>
          </div>
          <div className="fco-growth-discipline">
            <button type="button" onClick={() => navigate('/retargeting?tab=pipeline&bucket=all&work=unassigned')}><b>{growthAvailable ? money(growthExecution.unassigned) : '—'}</b><span>بلا مسؤول</span></button>
            <button type="button" onClick={() => navigate('/retargeting?tab=pipeline&bucket=all&work=never_contacted')}><b>{growthAvailable ? money(growthExecution.never_contacted) : '—'}</b><span>لم نتواصل</span></button>
            <button type="button" onClick={() => navigate('/retargeting?tab=pipeline&bucket=all&work=due')}><b>{growthAvailable ? money(growthExecution.overdue) : '—'}</b><span>متابعة متأخرة</span></button>
            <span className={`fco-growth-net ${Number(growthMovement.net) < 0 ? 'is-negative' : ''}`}>صافي الحركة: <b>{growthAvailable ? `${Number(growthMovement.net) >= 0 ? '+' : ''}${money(growthMovement.net)}` : '—'}</b></span>
          </div>
        </section>

        <section className="fco-panel fco-aging">
          <div className="fco-card-heading"><span>أعمار مديونيات العملاء</span><button type="button" onClick={() => navigate('/customer-money')}>فتح التحصيل <ArrowLeft size={14}/></button></div>
          <div className="fco-aging__total"><small>إجمالي الرصيد المستحق</small><strong>{compactMoney(aging.total)} <span>ر.س</span></strong></div>
          <div className="fco-aging__track">{[['green', aging.b0_15], ['olive', aging.b16_30], ['amber', aging.b31_60], ['orange', aging.b61_90], ['red', aging.b90p]].map(([tone, value]) => <i key={tone} className={`fco-aging__track-${tone}`} style={{ width: `${aging.total ? Math.max(2, Number(value || 0) / aging.total * 100) : 20}%` }}/>)}</div>
          <div className="fco-aging__bands"><AgingBand label="0–15 يوم" value={aging.b0_15} tone="green"/><AgingBand label="16–30 يوم" value={aging.b16_30} tone="olive"/><AgingBand label="31–60 يوم" value={aging.b31_60} tone="amber"/><AgingBand label="61–90 يوم" value={aging.b61_90} tone="orange"/><AgingBand label="أكثر من 90 يوم" value={aging.b90p} tone="red"/></div>
        </section>

      </div>

      <details className="fco-operations-disclosure fco-secondary-disclosure">
        <summary>
          <span><Workflow size={17}/><strong>التشغيل والتكاملات</strong><small>المهام الدورية وصحة مصادر البيانات</small></span>
          <em>{closeReadiness.ready ? 'الدورة جاهزة' : 'توجد مهام تحتاج مراجعة'}</em>
          <ArrowLeft size={15}/>
        </summary>
        <div className="fco-secondary-grid">
          <section className="fco-panel fco-routine">
            <div className="fco-card-heading"><span><Workflow size={18}/> مهام التشغيل الروتينية</span><small>لا تعتمد على الذاكرة</small></div>
            <div className="fco-task-list">
              <TaskRow icon={UploadCloud} title="ملفات إثراء Lamha" note="Excel للحقول غير المتاحة في API · المرحلة 4" status={merchantNeedsUpdate ? 'مطلوب' : 'محدّث'} tone={merchantNeedsUpdate ? 'amber' : 'green'} onClick={() => navigate(`/accounting-cycle?period=${period}&stage=lamha_sources`)}/>
              <TaskRow icon={ReceiptText} title="إرسال الفواتير إلى زاتكا" note={`${zatcaCount} معلقة · ${invoiceOps.draftCount || 0} مسودة`} status={zatcaCount ? 'يحتاج إجراء' : 'سليم'} tone={zatcaCount ? 'red' : 'green'} onClick={() => navigate('/work-agents')}/>
              <TaskRow icon={Landmark} title="مطابقة البنوك" note="اقرأ زوهو وصدّر النواقص فقط" status={sourceLabel(states.banks)} tone={sourceTone(states.banks)} onClick={() => navigate('/bank')}/>
              <TaskRow icon={CheckCircle2} title="إقفال الفترة المحاسبية" note={closeReadiness.ready ? `${closeReadiness.required} من ${closeReadiness.required} مراحل حرجة مكتملة` : `${firstCloseBlocker?.source || 'مصدر حرج'} — ${operationalBlockerReason(firstCloseBlocker?.reason)}`} status={closeReadiness.ready ? 'جاهز' : 'متوقف'} tone={closeReadiness.ready ? 'green' : 'red'} onClick={() => navigate(`/accounting-cycle?period=${period}`)}/>
            </div>
          </section>

          <section className="fco-integrations">
            <div className="fco-integrations__heading"><span><ShieldCheck size={18}/> حالة التكاملات</span><small>اللون يعكس آخر قراءة فعلية؛ لا توجد حالة نجاح افتراضية</small></div>
            <div className="fco-integrations__grid">
              <IntegrationItem name="Zoho Books" state={states.zohoInvoiceSync || states.zohoInvoices} note={sourceLabel(states.zohoInvoiceSync || states.zohoInvoices)} onClick={() => navigate('/zoho-data')} />
              <IntegrationItem name="لمحة" state={states.merchants} note={sourceLabel(states.merchants)} onClick={() => navigate(`/accounting-cycle?period=${period}`)} icon={FileSpreadsheet}/>
              <IntegrationItem name="البنوك" state={states.banks} note={sourceLabel(states.banks)} onClick={() => navigate('/bank')} icon={Landmark}/>
              <IntegrationItem name="هاتف" state={null} note="افتح مراقبة القنوات والوكلاء" onClick={() => navigate('/work-agents')} icon={PhoneCall}/>
            </div>
          </section>
        </div>
      </details>
    </div>
  );
}

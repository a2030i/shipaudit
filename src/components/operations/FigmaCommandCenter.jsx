import {
  Activity,
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
  Search,
  ShieldCheck,
  UploadCloud,
  UserPlus,
  UserRoundCheck,
  UserRoundX,
  UsersRound,
  WalletCards,
  Workflow,
} from 'lucide-react';
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

const updatedLabel = (iso) => {
  if (!iso) return 'وقت التحديث غير متاح';
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return 'وقت التحديث غير متاح';
  return `آخر تحديث ${new Intl.DateTimeFormat('ar-SA-u-ca-gregory', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  }).format(value)}`;
};

const sourceTone = (state) => {
  if (!state || state.status === 'unavailable') return 'red';
  if (state.status === 'fresh') return 'green';
  return 'amber';
};

const sourceLabel = (state) => {
  if (!state || state.status === 'unavailable') return 'غير متاح';
  if (state.status === 'fresh') return 'محدّث';
  return 'يحتاج تحديث';
};

function ActionCard({ tone, icon: Icon, title, count, value, note, action, onClick, unavailable = false }) {
  return (
    <button className={`fco-action-card fco-action-card--${tone}`} type="button" onClick={onClick}>
      <span className="fco-action-card__icon"><Icon size={20}/></span>
      <span className="fco-action-card__content">
        <small>{note}</small>
        <strong>{title}</strong>
        <span>{unavailable ? 'المصدر غير متاح' : `${count || 0} حالة${value ? ` · ${value}` : ''}`}</span>
      </span>
      <span className="fco-action-card__action">{action}<ArrowLeft size={14}/></span>
    </button>
  );
}

function KpiCard({ label, value, note, icon: Icon, tone = 'blue', onClick, source, updatedAt, unavailable = false }) {
  const Tag = onClick ? 'button' : 'article';
  return (
    <Tag
      className={`fco-kpi fco-kpi--${tone}${unavailable ? ' is-unavailable' : ''}`}
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      aria-label={onClick ? `${label} — فتح التفاصيل` : undefined}
    >
      <span className="fco-kpi__icon"><Icon size={18}/></span>
      <span className="fco-kpi__copy">
        <small>{label}</small>
        <strong>{unavailable ? 'المصدر غير متاح' : value}</strong>
        <em>{unavailable ? 'تعذرت القراءة؛ لم نعرض صفراً بديلاً' : note}</em>
        <span className="fco-kpi__source">{source || 'المصدر غير محدد'} · {updatedLabel(updatedAt)}</span>
      </span>
      {onClick && <ArrowLeft size={15}/>}
    </Tag>
  );
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

function MovementMetric({ label, value, note, tone = 'blue' }) {
  return (
    <article className={`fco-movement__metric fco-movement__metric--${tone}`}>
      <strong>{value}</strong><span>{label}</span><small>{note}</small>
    </article>
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
  const stopRows = decisions.stopPostpaid || [];
  const activateRows = decisions.activatePostpaid || [];
  const deductRows = decisions.deductPrepaid || [];
  const stopAmount = stopRows.reduce((sum, row) => sum + Number(row.over30 || 0), 0);
  const deductAmount = deductRows.reduce((sum, row) => sum + Math.min(Number(row.walletBalance || 0), Number(row.debt || 0)), 0);
  const invoiceOps = data?.invoiceOperations || {};
  const zatcaCount = Number(invoiceOps.zatcaTodayCount || 0) + Number(invoiceOps.zatcaOverdueCount || 0);
  const zatcaAmount = Number(invoiceOps.zatcaTodayTotal || 0) + Number(invoiceOps.zatcaOverdueTotal || 0);
  const merchantPulse = data?.merchantPulse || {};
  const aging = data?.customerAging || {};
  const overdue30 = Number(aging.b31_60 || 0) + Number(aging.b61_90 || 0) + Number(aging.b90p || 0);
  const cash = data?.cashPosition || {};
  const states = data?.sourceStates || {};
  const sourceEntries = Object.values(states);
  const availableSources = sourceEntries.filter((source) => source?.status !== 'unavailable').length;
  const freshSources = sourceEntries.filter((source) => source?.status === 'fresh').length;
  const availabilityPercent = sourceEntries.length ? Math.round((availableSources / sourceEntries.length) * 100) : 0;
  const sourcePercent = sourceEntries.length ? Math.round((freshSources / sourceEntries.length) * 100) : 0;
  const closeReadiness = data?.closeReadiness || { ready: false, completed: 0, required: 6, blockers: [] };
  const firstCloseBlocker = closeReadiness.blockers?.[0];
  const merchantNeedsUpdate = !merchantPulse.available || sourceTone(states.merchants) !== 'green';

  return (
    <div className="figma-command-center" dir="rtl">
      <section className="fco-heading">
        <div>
          <span className="fco-eyebrow">مركز قيادة العمليات</span>
          <h1>ما الذي يحتاج قرارك اليوم؟</h1>
          <p>صورة موحدة للعملاء والسيولة والفوترة والتكاملات، مرتبة حسب الأثر.</p>
        </div>
        <div className="fco-heading__actions">
          <div className="fco-period" aria-label="الفترة المعروضة">
            <button type="button" onClick={onPrevious} aria-label="الشهر السابق">›</button>
            <span><CalendarDays size={15}/>{monthLabel(period)}</span>
            {!isCurrent && <button type="button" onClick={onNext} aria-label="الشهر التالي">‹</button>}
          </div>
          {!isCurrent && <button className="fco-current" type="button" onClick={onCurrent}>الشهر الحالي</button>}
          <button className="fco-refresh" type="button" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw size={16} className={refreshing ? 'is-spinning' : ''}/><span>تحديث</span>
          </button>
        </div>
      </section>

      <div className={`fco-freshness fco-freshness--${closeReadiness.ready ? 'green' : 'amber'}`}>
        <div className="fco-readiness-facts" aria-label="توفر المصادر وحداثة البيانات وجاهزية الإقفال">
          <span><Database size={17}/><strong>توفر المصادر {availabilityPercent}%</strong><small>{availableSources} من {sourceEntries.length || 0} متاحة</small></span>
          <span><Activity size={17}/><strong>حداثة البيانات {sourcePercent}%</strong><small>{freshSources} من {sourceEntries.length || 0} حديثة</small></span>
          <span className={closeReadiness.ready ? 'is-ready' : 'is-blocked'}><CheckCircle2 size={17}/><strong>جاهزية الإقفال: {closeReadiness.ready ? 'جاهز' : 'متوقف'}</strong><small>{closeReadiness.ready ? 'المراحل الحرجة مكتملة' : `${firstCloseBlocker?.source || 'مصدر حرج'}: ${firstCloseBlocker?.reason || 'تعذر التحقق'}`}</small></span>
        </div>
        <button type="button" onClick={() => navigate('/operations')}>مراقبة التكاملات <ArrowLeft size={14}/></button>
      </div>

      <label className="fco-search">
        <Search size={18}/><input placeholder="ابحث عن عميل أو متجر لفتح مستحقاته…" onKeyDown={(event) => {
          if (event.key === 'Enter' && event.currentTarget.value.trim()) navigate(`/customer-money?q=${encodeURIComponent(event.currentTarget.value.trim())}`);
        }}/><kbd>Enter</kbd>
      </label>

      <section className="fco-section">
        <div className="fco-section__heading"><div><span>أولوية اليوم</span><h2>قرارات تحتاج إجراءً الآن</h2></div><small>مرتبة حسب الخطر المالي والتشغيلي</small></div>
        <div className="fco-actions-grid">
          <ActionCard tone="red" icon={UserRoundX} title="أوقف الحسابات المتأخرة" count={stopRows.length} value={`${compactMoney(stopAmount)} ر.س`} note="دفع لاحق · نشط · دين +30 يومًا" action="مراجعة وإيقاف" onClick={() => navigate('/customer-money?decision=stop')} unavailable={!data?.customerDecisionFresh}/>
          <ActionCard tone="blue" icon={WalletCards} title="اخصم الرصيد المدفوع مقدمًا" count={deductRows.length} value={`${compactMoney(deductAmount)} ر.س`} note="رصيد محفظة مع فواتير مفتوحة" action="مراجعة الخصم" onClick={() => navigate('/customer-money?decision=deduct')} unavailable={!data?.customerDecisionFresh}/>
          <ActionCard tone={zatcaCount ? 'amber' : 'green'} icon={ReceiptText} title="اعتمد وأرسل فواتير زاتكا" count={zatcaCount} value={`${compactMoney(zatcaAmount)} ر.س`} note={`${invoiceOps.draftCount || 0} مسودة في زوهو`} action="فتح دورة الفاتورة" onClick={() => navigate('/zoho-data?tab=customers')} unavailable={!invoiceOps.zatcaAvailable}/>
          <ActionCard tone={merchantNeedsUpdate ? 'amber' : 'green'} icon={FileSpreadsheet} title="حدّث ملفات لمحة" count={merchantNeedsUpdate ? 1 : 0} value={merchantPulse.total ? `${money(merchantPulse.total)} متجر` : ''} note="دليل المتاجر · كشف الحساب" action="رفع الملفات الآن" onClick={() => navigate(`/accounting-cycle?period=${period}&stage=lamha_sources`)} unavailable={!merchantPulse.available}/>
        </div>
      </section>

      <section className="fco-section">
        <div className="fco-section__heading"><div><span>نبض الشركة</span><h2>المؤشرات التي تغيّر القرار</h2></div><button type="button" onClick={() => navigate('/reports')}>التقارير <ArrowLeft size={14}/></button></div>
        <div className="fco-kpi-grid">
          <KpiCard icon={Landmark} label="إجمالي مديونيات العملاء" value={`${compactMoney(cash.totalAR)} ر.س`} note={`${compactMoney(overdue30)} ر.س تجاوزت 30 يومًا`} source="Zoho Books" updatedAt={(states.customerMoney || states.zohoInvoices)?.sourceUpdatedAt || (states.customerMoney || states.zohoInvoices)?.checkedAt} unavailable={(states.customerMoney || states.zohoInvoices)?.status === 'unavailable'} tone="red" onClick={() => navigate('/customer-money')}/>
          <KpiCard icon={ReceiptText} label={`ضريبة ${vat?.quarter || 'الربع الحالي'}`} value={vat ? `${compactMoney(vat.netDue)} ر.س` : 'غير متاح'} note={vat ? `${vat.from} ← ${vat.to} · مخرجات ${compactMoney(vat.outputTax)} · مدخلات ${compactMoney(vat.inputTax)}` : 'تحتاج قراءة زوهو'} source="Zoho Books" updatedAt={vat?.fetchedAt || states.zatcaPending?.checkedAt} unavailable={!vat} tone="amber" onClick={() => navigate('/zoho-data?tab=reports')}/>
          <KpiCard icon={UserRoundCheck} label="نشطون خلال آخر 5 أيام" value={money(merchantPulse.recentFiveDays)} note={merchantPulse.snapshotAt ? `حسب لقطة ${new Date(merchantPulse.snapshotAt).toLocaleDateString('ar-SA')}` : 'ارفع ملف متاجر لمحة'} source="دليل متاجر لمحة" updatedAt={merchantPulse.snapshotAt || states.merchants?.checkedAt} unavailable={!merchantPulse.available} tone="green" onClick={() => navigate('/customer-360?view=lists')}/>
          <KpiCard icon={FileSpreadsheet} label="فواتير مسودة" value={money(invoiceOps.draftCount)} note={`${compactMoney(invoiceOps.draftTotal)} ر.س بانتظار الاعتماد`} source="Zoho Books" updatedAt={states.zohoInvoiceSync?.sourceUpdatedAt || states.zatcaPending?.checkedAt} unavailable={!invoiceOps.zatcaAvailable} tone="blue" onClick={() => navigate('/zoho-data?tab=customers')}/>
        </div>
      </section>

      <section className="fco-section fco-lamha-upload">
        <div className="fco-section__heading">
          <div><span>مصادر لمحة الأساسية</span><h2>ارفع الملفات باستمرار ولا تعتمد على التذكّر</h2></div>
          <details className="fco-upload-menu">
            <summary><UploadCloud size={16}/> رفع ملف لمحة</summary>
            <div className="fco-upload-menu__popover">
              <button type="button" onClick={() => navigate(`/accounting-cycle?period=${period}&stage=lamha_sources&source=merchants`)}>
                <FileSpreadsheet size={18}/><span><strong>ملف متاجر لمحة</strong><small>{uploadDateLabel(data?.lamhaUploads?.merchants?.uploadedAt)}</small></span><ArrowLeft size={15}/>
              </button>
              <button type="button" onClick={() => navigate(`/accounting-cycle?period=${period}&stage=lamha_sources&source=internal_settlement`)}>
                <ReceiptText size={18}/><span><strong>كشف حساب لمحة</strong><small>{uploadDateLabel(data?.lamhaUploads?.balance?.uploadedAt)}</small></span><ArrowLeft size={15}/>
              </button>
            </div>
          </details>
        </div>
        <div className="fco-lamha-upload__status">
          <button type="button" onClick={() => navigate(`/accounting-cycle?period=${period}&stage=lamha_sources&source=merchants`)}><FileSpreadsheet size={17}/><span><strong>متاجر لمحة</strong><small>{uploadDateLabel(data?.lamhaUploads?.merchants?.uploadedAt)}</small></span></button>
          <button type="button" onClick={() => navigate(`/accounting-cycle?period=${period}&stage=lamha_sources&source=internal_settlement`)}><ReceiptText size={17}/><span><strong>كشف حساب لمحة</strong><small>{uploadDateLabel(data?.lamhaUploads?.balance?.uploadedAt)}</small></span></button>
        </div>
      </section>

      <div className="fco-dashboard-grid">
        <section className="fco-panel fco-movement">
          <div className="fco-card-heading"><span><UsersRound size={18}/> حركة العملاء</span><button type="button" onClick={() => navigate('/merchants')}>عرض العملاء <ArrowLeft size={14}/></button></div>
          <div className="fco-movement__grid">
            <MovementMetric label="عملاء جدد" value={merchantPulse.available ? merchantPulse.newThisPeriod : '—'} note={monthLabel(period)} tone="blue"/>
            <MovementMetric label="سددوا هذا الشهر" value={merchantPulse.paidThisPeriod ?? '—'} note="حسب آخر دفعة" tone="green"/>
            <MovementMetric label="سجلوا ولم يشحنوا" value={merchantPulse.available ? merchantPulse.neverShipped : '—'} note="فرصة تفعيل" tone="amber"/>
            <MovementMetric label="متوقفون ولديهم رصيد" value={merchantPulse.available ? merchantPulse.stoppedWithWallet : '—'} note={`${compactMoney(merchantPulse.stoppedWalletAmount)} ر.س`} tone="red"/>
          </div>
          <div className="fco-movement__summary"><UserPlus size={17}/><span><b>{activateRows.length}</b> حساب دفع لاحق جاهز لإعادة التشغيل الآن</span><button type="button" onClick={() => navigate('/merchants?decision=activate')}>فتح القائمة</button></div>
        </section>

        <section className="fco-panel fco-routine">
          <div className="fco-card-heading"><span><Workflow size={18}/> مهام التشغيل الروتينية</span><small>لا تعتمد على الذاكرة</small></div>
          <div className="fco-task-list">
            <TaskRow icon={UploadCloud} title="رفع ملفات لمحة" note="دليل المتاجر وكشف الحساب · المرحلة 4" status={merchantNeedsUpdate ? 'مطلوب' : 'محدّث'} tone={merchantNeedsUpdate ? 'amber' : 'green'} onClick={() => navigate(`/accounting-cycle?period=${period}&stage=lamha_sources`)}/>
            <TaskRow icon={ReceiptText} title="إرسال الفواتير إلى زاتكا" note={`${zatcaCount} معلقة · ${invoiceOps.draftCount || 0} مسودة`} status={zatcaCount ? 'يحتاج إجراء' : 'سليم'} tone={zatcaCount ? 'red' : 'green'} onClick={() => navigate('/work-agents')}/>
            <TaskRow icon={Landmark} title="مطابقة البنوك" note="اقرأ زوهو وصدّر النواقص فقط" status={sourceLabel(states.banks)} tone={sourceTone(states.banks)} onClick={() => navigate('/bank')}/>
            <TaskRow icon={CheckCircle2} title="إقفال الفترة المحاسبية" note={closeReadiness.ready ? `${closeReadiness.required} من ${closeReadiness.required} مراحل حرجة مكتملة` : `${firstCloseBlocker?.source || 'مصدر حرج'} — ${firstCloseBlocker?.reason || 'الإقفال متوقف حتى اكتمال التحقق'}`} status={closeReadiness.ready ? 'جاهز' : 'متوقف'} tone={closeReadiness.ready ? 'green' : 'red'} onClick={() => navigate(`/accounting-cycle?period=${period}`)}/>
          </div>
        </section>

        <section className="fco-panel fco-aging">
          <div className="fco-card-heading"><span>أعمار مديونيات العملاء</span><button type="button" onClick={() => navigate('/customer-money')}>فتح التحصيل <ArrowLeft size={14}/></button></div>
          <div className="fco-aging__total"><small>إجمالي الرصيد المستحق</small><strong>{compactMoney(aging.total)} <span>ر.س</span></strong></div>
          <div className="fco-aging__track">{[['green', aging.b0_15], ['olive', aging.b16_30], ['amber', aging.b31_60], ['orange', aging.b61_90], ['red', aging.b90p]].map(([tone, value]) => <i key={tone} className={`fco-aging__track-${tone}`} style={{ width: `${aging.total ? Math.max(2, Number(value || 0) / aging.total * 100) : 20}%` }}/>)}</div>
          <div className="fco-aging__bands"><AgingBand label="0–15 يوم" value={aging.b0_15} tone="green"/><AgingBand label="16–30 يوم" value={aging.b16_30} tone="olive"/><AgingBand label="31–60 يوم" value={aging.b31_60} tone="amber"/><AgingBand label="61–90 يوم" value={aging.b61_90} tone="orange"/><AgingBand label="أكثر من 90 يوم" value={aging.b90p} tone="red"/></div>
        </section>

        <section className="fco-panel fco-cash">
          <div className="fco-card-heading fco-card-heading--light"><span><Landmark size={18}/> السيولة والبنوك</span><button type="button" onClick={() => navigate('/bank')}>فتح البنوك <ArrowLeft size={14}/></button></div>
          <div className="fco-cash__amount"><strong>{cash.bankBalance == null ? 'غير متاح' : money(cash.bankBalance, 2)}</strong>{cash.bankBalance != null && <span>ر.س</span>}</div>
          <p>{cash.bankBalanceComplete ? 'رصيد ختامي مكتمل من الحسابات المرتبطة' : 'الرصيد المقروء من الحسابات المتاحة فقط'}</p>
          <div className="fco-cash__footer"><span>الذمم القابلة للتحصيل <b>{compactMoney(cash.totalAR)} ر.س</b></span><span>صافي المركز <b>{cash.net == null ? '—' : `${compactMoney(cash.net)} ر.س`}</b></span></div>
        </section>
      </div>

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
  );
}

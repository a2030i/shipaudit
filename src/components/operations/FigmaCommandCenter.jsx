import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Database,
  Landmark,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRoundCheck,
  UserRoundX,
  WalletCards,
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

function DecisionRow({ tone, icon: Icon, title, count, amount, action, onClick }) {
  return (
    <button className={`fco-decision fco-decision--${tone}`} type="button" onClick={onClick}>
      <span className="fco-decision__icon"><Icon size={19}/></span>
      <span className="fco-decision__copy">
        <strong>{title}</strong>
        <small>{count ? `${count} حساب` : 'لا توجد حالات الآن'}</small>
      </span>
      <span className="fco-decision__value">
        <b>{amount ? `${compactMoney(amount)} ر.س` : '—'}</b>
        <small>{action}</small>
      </span>
      <ArrowLeft size={16} className="fco-decision__arrow"/>
    </button>
  );
}

function AgingBand({ label, value, tone }) {
  return (
    <div className="fco-aging__band">
      <span><i className={`fco-dot fco-dot--${tone}`}/>{label}</span>
      <strong>{compactMoney(value)}</strong>
    </div>
  );
}

function MiniMetric({ icon: Icon, title, value, note, tone = 'blue', onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className={`fco-mini fco-mini--${tone}`} type={onClick ? 'button' : undefined} onClick={onClick}>
      <span className="fco-mini__icon"><Icon size={18}/></span>
      <span className="fco-mini__copy"><small>{title}</small><strong>{value}</strong><em>{note}</em></span>
      {onClick && <ArrowLeft size={15}/>} 
    </Tag>
  );
}

export default function FigmaCommandCenter({
  data,
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
  const activateValue = activateRows.reduce((sum, row) => sum + Number(row.walletBalance || 0), 0);
  const deductAmount = deductRows.reduce((sum, row) => sum + Math.min(Number(row.walletBalance || 0), Number(row.debt || 0)), 0);
  const decisionCount = stopRows.length + activateRows.length + deductRows.length;

  const aging = data?.customerAging || {};
  const overdue30 = Number(aging.b31_60 || 0) + Number(aging.b61_90 || 0) + Number(aging.b90p || 0);
  const cash = data?.cashPosition || {};
  const sourceEntries = Object.values(data?.sourceStates || {});
  const availableSources = sourceEntries.filter((source) => source?.status !== 'unavailable').length;
  const freshSources = sourceEntries.filter((source) => source?.status === 'fresh').length;
  const sourcePercent = sourceEntries.length ? Math.round((freshSources / sourceEntries.length) * 100) : 0;
  const closePercent = sourceEntries.length ? Math.max(0, Math.min(100, Math.round((availableSources / sourceEntries.length) * 100))) : 0;

  return (
    <div className="figma-command-center" dir="rtl">
      <section className="fco-heading">
        <div>
          <span className="fco-eyebrow">مركز قيادة العمليات</span>
          <h1>ما الذي يحتاج قرارك الآن؟</h1>
          <p>العملاء والسيولة والمصادر في لوحة تنفيذية واحدة.</p>
        </div>
        <div className="fco-heading__actions">
          <div className="fco-period" aria-label="الفترة المعروضة">
            <button type="button" onClick={onPrevious} aria-label="الشهر السابق">›</button>
            <span><CalendarDays size={15}/>{monthLabel(period)}</span>
            {!isCurrent && <button type="button" onClick={onNext} aria-label="الشهر التالي">‹</button>}
          </div>
          {!isCurrent && <button className="fco-current" type="button" onClick={onCurrent}>العودة للحالي</button>}
          <button className="fco-refresh" type="button" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw size={16} className={refreshing ? 'is-spinning' : ''}/><span>تحديث</span>
          </button>
        </div>
      </section>

      <label className="fco-search">
        <Search size={18}/>
        <input placeholder="ابحث عن عميل، فاتورة، رقم متجر أو شحنة…" onKeyDown={(event) => {
          if (event.key === 'Enter' && event.currentTarget.value.trim()) navigate(`/customer-money?q=${encodeURIComponent(event.currentTarget.value.trim())}`);
        }}/>
        <kbd>Enter</kbd>
      </label>

      <div className="fco-grid">
        <section className="fco-cash">
          <div className="fco-card-heading fco-card-heading--light">
            <span><Landmark size={18}/> السيولة المتاحة</span>
            <button type="button" onClick={() => navigate('/bank')}>عرض البنوك <ArrowLeft size={14}/></button>
          </div>
          <div className="fco-cash__amount">
            <strong>{cash.bankBalance == null ? 'غير متاح' : money(cash.bankBalance, 2)}</strong>
            {cash.bankBalance != null && <span>ر.س</span>}
          </div>
          <p>{cash.bankBalanceComplete ? 'رصيد ختامي مكتمل من الحسابات المرتبطة' : 'الرصيد المقروء من الحسابات المتاحة فقط'}</p>
          <div className="fco-cash__bars" aria-hidden="true">
            {[44, 68, 52, 82, 63, 91, 74, 100].map((height, index) => <i key={index} style={{ height: `${height}%` }}/>) }
          </div>
          <div className="fco-cash__footer">
            <span>الذمم القابلة للتحصيل <b>{compactMoney(cash.totalAR)} ر.س</b></span>
            <span>صافي المركز <b>{cash.net == null ? '—' : `${compactMoney(cash.net)} ر.س`}</b></span>
          </div>
        </section>

        <section className="fco-decisions">
          <div className="fco-card-heading">
            <span>قرارات تحتاجك</span>
            <b>{decisionCount}</b>
          </div>
          {!data?.customerDecisionFresh && (
            <div className="fco-data-warning"><CircleAlert size={15}/> آخر قراءة متاحة للعرض؛ حدّث المصادر قبل تنفيذ القرار.</div>
          )}
          <DecisionRow tone="red" icon={UserRoundX} title="أوقف الحسابات المتأخرة" count={stopRows.length} amount={stopAmount} action="تجاوزت 30 يومًا" onClick={() => navigate('/customer-money?decision=stop')}/>
          <DecisionRow tone="green" icon={UserRoundCheck} title="شغّل الحسابات الجاهزة" count={activateRows.length} amount={activateValue} action="لا دين متأخر" onClick={() => navigate('/merchants?decision=activate')}/>
          <DecisionRow tone="blue" icon={WalletCards} title="اخصم الرصيد المدفوع مقدمًا" count={deductRows.length} amount={deductAmount} action="رصيد وفواتير مفتوحة" onClick={() => navigate('/customer-money?decision=deduct')}/>
        </section>

        <section className="fco-aging">
          <div className="fco-card-heading">
            <span>أعمار مديونيات العملاء</span>
            <button type="button" onClick={() => navigate('/customer-money')}>فتح التحصيل <ArrowLeft size={14}/></button>
          </div>
          <div className="fco-aging__total"><small>إجمالي الرصيد المستحق</small><strong>{compactMoney(aging.total)} <span>ر.س</span></strong></div>
          <div className="fco-aging__track" aria-label="توزيع أعمار الدين">
            {[
              ['green', aging.b0_15], ['olive', aging.b16_30], ['amber', aging.b31_60], ['orange', aging.b61_90], ['red', aging.b90p],
            ].map(([tone, value]) => {
              const width = aging.total ? Math.max(2, (Number(value || 0) / aging.total) * 100) : 20;
              return <i key={tone} className={`fco-aging__track-${tone}`} style={{ width: `${width}%` }}/>;
            })}
          </div>
          <div className="fco-aging__bands">
            <AgingBand label="0–15 يوم" value={aging.b0_15} tone="green"/>
            <AgingBand label="16–30 يوم" value={aging.b16_30} tone="olive"/>
            <AgingBand label="31–60 يوم" value={aging.b31_60} tone="amber"/>
            <AgingBand label="61–90 يوم" value={aging.b61_90} tone="orange"/>
            <AgingBand label="أكثر من 90 يوم" value={aging.b90p} tone="red"/>
          </div>
          <div className="fco-aging__overdue"><span>متأخر أكثر من 30 يومًا</span><strong>{compactMoney(overdue30)} ر.س</strong></div>
        </section>

        <section className="fco-readiness">
          <div className="fco-card-heading">
            <span>جاهزية إقفال {monthLabel(period)}</span>
            <button type="button" onClick={() => navigate(`/accounting-cycle?period=${period}`)}>فتح الدورة <ArrowLeft size={14}/></button>
          </div>
          <div className="fco-readiness__gauge" style={{ '--progress': `${closePercent * 3.6}deg`, '--progress-pct': `${closePercent}%` }}>
            <div><strong>{closePercent}%</strong><small>جاهزية المصادر</small></div>
          </div>
          <div className="fco-readiness__status">
            <span><CheckCircle2 size={16}/> {availableSources} مصادر متاحة</span>
            <span><Database size={16}/> {sourceEntries.length - freshSources} تحتاج تحديثًا</span>
          </div>
        </section>

        <div className="fco-mini-grid">
          <MiniMetric icon={CircleAlert} title="مديونيات +30 يوم" value={`${compactMoney(overdue30)} ر.س`} note={`${stopRows.length} حساب يحتاج قرارًا`} tone="red" onClick={() => navigate('/customer-money')}/>
          <MiniMetric icon={ShieldCheck} title="صحة مصادر البيانات" value={`${sourcePercent}%`} note={`${freshSources} من ${sourceEntries.length} حديثة`} tone="green" onClick={() => navigate('/settings/data')}/>
        </div>
      </div>
    </div>
  );
}

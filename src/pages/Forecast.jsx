// "تنبؤ التدفّق النقدي" — forward-looking cash position.
//
// Three things, no chrome:
//   1. Three big numbers: متوقّع داخل / متوقّع خارج / الصافي
//   2. List of upcoming cash events in the horizon, overdue first,
//      with carrier × task × estimated amount × source of estimate
//   3. Side-panel "now" obligations: COD in-transit from carriers,
//      total open AP (derived from the event list's outflows)
//
// Horizon switcher: 7 / 14 / 30 / 60 days. Default 7. Anything
// beyond 60 days is too speculative — schedules drift, contracts
// change, carriers go quiet.
//
// The page is read-only. It doesn't post any ledger entry, doesn't
// "lock in" the forecast. It's a directional planning tool.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import {
  RefreshCw, TrendingUp, Wallet, Calendar, AlertTriangle, Info, Banknote,
} from 'lucide-react';
import { toast } from '../lib/toast.js';
import { loadCashflowForecast } from '../lib/forecastService.js';
import { TASK_KIND_META, CADENCE_META } from '../lib/tasksService.js';
import FinanceWorkspaceNav from '../components/enterprise/FinanceWorkspaceNav.jsx';
import { Breadcrumbs, Button as Btn, EmptyState as Empty, Money, PageHeader, Panel as Card, Spinner, StatStrip, Tabs } from '../design-system/EnterpriseUI.jsx';
import './ReportsWorkspace.css';

const HORIZON_OPTIONS = [
  { days: 7,  label: 'هذا الأسبوع' },
  { days: 14, label: 'أسبوعين'      },
  { days: 30, label: 'هذا الشهر'   },
  { days: 60, label: 'شهرين'        },
];

const fmt = (n) => {
  if (n == null || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const fmtDueLabel = (e) => {
  if (e.isOverdue)        return `متأخّر ${Math.abs(e.dueDays)} يوم`;
  if (e.dueDays === 0)    return 'مستحق اليوم';
  if (e.dueDays === 1)    return 'مستحق غداً';
  return `بعد ${e.dueDays} يوم`;
};

export default function Forecast({ carriers = [], isActive = true }) {
  const location = useLocation();
  const [loading, setLoading]   = useState(true);
  const [horizon, setHorizon]   = useState(30);   // default to the month — fuller forecast view
  const [data, setData]         = useState(null);
  const [error, setError]       = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await loadCashflowForecast({ horizonDays: horizon, carriers });
      setData(result);
    } catch (e) {
      setError(e.message || 'تعذّر تحميل التوقع');
      toast(`فشل التحميل: ${e.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [horizon, carriers]);

  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh, location.pathname]);

  // Group events by ISO date — declared BEFORE the early return so
  // the hook count stays consistent between the loading and loaded
  // renders (Rules of Hooks). Without this, React throws
  // "Rendered more hooks than during the previous render" the
  // moment `data` arrives and the entire page goes blank.
  const eventsByDate = useMemo(() => {
    if (!data?.events) return [];
    const groups = new Map();
    for (const e of data.events) {
      const key = e.dueAt
        ? `${e.dueAt.getFullYear()}-${String(e.dueAt.getMonth()+1).padStart(2,'0')}-${String(e.dueAt.getDate()).padStart(2,'0')}`
        : 'unknown';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }
    return [...groups.entries()];
  }, [data]);

  if (loading && !data) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', justifyContent: 'center', minHeight: 320 }}>
          <Spinner size={28}/>
          <strong style={{ fontSize: 14 }}>نجمّع أرصدة البنوك والناقلين وفواتير العملاء…</strong>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>عادةً تظهر خلال ثوانٍ، ولن تبقى الصفحة فارغة عند تعطل مصدر.</span>
        </div>
      </div>
    );
  }

  if (!data && error) {
    return (
      <div style={{ padding: '40px 28px', maxWidth: 760, margin: '0 auto' }}>
        <Card style={{ textAlign: 'center', padding: 28, borderColor: 'color-mix(in srgb, var(--red) 35%, var(--border))' }}>
          <AlertTriangle size={28} color="var(--red)" style={{ marginBottom: 10 }}/>
          <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 7 }}>تعذّر تجهيز التوقع</div>
          <div style={{ color: 'var(--muted)', fontSize: 12.5, marginBottom: 16 }}>{error}</div>
          <Btn variant="primary" icon={<RefreshCw size={14}/>} onClick={refresh}>إعادة المحاولة</Btn>
        </Card>
      </div>
    );
  }

  const horizonLabel = HORIZON_OPTIONS.find(h => h.days === horizon)?.label || `${horizon} يوم`;

  return (
    <div className="forecast-report-view">
      <Breadcrumbs items={[{ label: 'المالية' }, { label: 'الرقابة المالية' }, { label: 'توقع السيولة' }]}/>
      <PageHeader
        icon={<TrendingUp size={22}/>}
        iconColor="var(--accent3)"
        title="توقّع النقد — الداخل والخارج"
        subtitle="ماذا نتوقّع أن يدخل وأن يخرج خلال الفترة القادمة — مبني على مهام التحصيل والفواتير المجدولة"
        meta={`آخر تحديث ${new Date(data.asOf).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`}
        actions={
          <Btn size="sm" variant="ghost" icon={<RefreshCw size={13}/>} onClick={refresh}>
            تحديث
          </Btn>
        }
      />

      <FinanceWorkspaceNav active="control"/>

      {/* Horizon switcher */}
      <Tabs label="أفق التوقع" active={String(horizon)} onChange={value => setHorizon(Number(value))}
        items={HORIZON_OPTIONS.map(option => ({ id: String(option.days), label: `${option.label} (${option.days}ي)` }))}/>

      {/* Top stats — 3 big numbers */}
      <StatStrip items={[
        { key: 'inflow', label: 'متوقّع يدخل لك', value: <Money value={data.inflowTotal}/>, note: `من ${data.events.filter(e => e.direction === 'in').length} مهمة تحصيل ${horizonLabel}`, tone: 'success' },
        { key: 'outflow', label: 'متوقّع تدفعه', value: <Money value={data.outflowTotal}/>, note: `من ${data.events.filter(e => e.direction === 'out').length} مهمة فاتورة ${horizonLabel}`, tone: 'danger' },
        { key: 'net', label: 'الباقي المتوقّع', value: <Money value={data.netInHorizon}/>, note: data.netInHorizon >= 0 ? 'فائض نقد متوقّع' : 'عجز — جهّز السيولة', tone: data.netInHorizon >= 0 ? 'success' : 'danger' },
      ]}/>

      {/* Side info card: current obligations */}
      <Card style={{
        marginBottom: 18,
        background: 'color-mix(in srgb, var(--accent3) 5%, transparent)',
        border: '1px solid color-mix(in srgb, var(--accent3) 18%, transparent)',
      }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <Wallet size={18} color="var(--accent3)"/>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginBottom: 4 }}>
              مستحقّ علينا للشركات الآن
            </div>
            <div style={{ fontSize: 14, color: 'var(--text)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
              مجموع الأرصدة المفتوحة في الفواتير المجدولة ضمن الفترة:&nbsp;
              <span style={{ color: 'var(--red)' }}>{fmt(data.outflowTotal)} ر.س</span>
            </div>
          </div>
          <div className="mobile-hide" style={{ width: 1, height: 36, background: 'var(--border)' }}/>
          <div style={{ minWidth: 180 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginBottom: 4 }}>
              COD في الطريق إلينا
            </div>
            <div style={{ fontSize: 14, color: 'var(--green)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
              {fmt(data.codInTransit)} <span style={{ fontSize: 11, color: 'var(--muted)' }}>ر.س</span>
            </div>
          </div>
          {(data.customerInflow > 0 || data.receivablesOverdue > 0) && (
            <>
              <div className="mobile-hide" style={{ width: 1, height: 36, background: 'var(--border)' }}/>
              <div style={{ minWidth: 200 }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginBottom: 4 }}>
                  متوقّع من العملاء (الفترة)
                </div>
                <div style={{ fontSize: 14, color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                  {fmt(data.customerInflow)} <span style={{ fontSize: 11, color: 'var(--muted)' }}>ر.س</span>
                </div>
                {data.receivablesOverdue > 0 && (
                  <div style={{ fontSize: 10.5, color: 'var(--gold)', marginTop: 2 }}>
                    + {fmt(data.receivablesOverdue)} متأخّرة قابلة للتحصيل
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </Card>

      {/* Projected bank balance + daily cashflow chart */}
      {data.bankBalance != null && (
        <ProjectedBalance data={data} horizonLabel={horizonLabel}/>
      )}
      {data.dailyFlow && data.dailyFlow.length > 0 && (
        <CashflowChart dailyFlow={data.dailyFlow} bankBalance={data.bankBalance}/>
      )}

      {/* Events timeline grouped by date */}
      {data.events.length === 0 ? (
        <Empty
          icon="🌤️"
          title="لا توجد أحداث متوقّعة في هذه الفترة"
          sub={`جرّب توسيع الأفق أو أضف جداول مهام من /tasks لتظهر التوقّعات.`}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {eventsByDate.map(([dateKey, events]) => (
            <DateGroup key={dateKey} dateKey={dateKey} events={events}/>
          ))}
        </div>
      )}

      {/* Educational footer */}
      <div style={{
        marginTop: 24, padding: 14, borderRadius: 10,
        background: 'var(--surface2)', border: '1px solid var(--border)',
        fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.7,
        display: 'flex', gap: 10, alignItems: 'flex-start',
      }}>
        <Info size={14} style={{ flexShrink: 0, marginTop: 2 }}/>
        <div>
          <strong style={{ color: 'var(--text2)' }}>كيف تُحسب التوقّعات:</strong>{' '}
          مهام التحصيل → متوسط آخر 3 دفعات استلمناها من نفس الشركة.{' '}
          مهام الفواتير → الرصيد المفتوح الحالي مع الشركة كتقدير لما سندفعه.{' '}
          تحصيل العملاء → فواتير مفتوحة، تاريخ التحصيل المتوقّع = تاريخ الفاتورة + 30 يوم (المتأخّرة تُعرض منفصلة).{' '}
          الكشوف وتقارير الأوزان مدرجة كأحداث تشغيلية بدون أثر نقدي.{' '}
          الأرقام إرشادية — لا تستخدمها كقيد محاسبي.
        </div>
      </div>
    </div>
  );
}

// ── subcomponents ──────────────────────────────────────────────

// Projected bank balance: current → after the horizon's net. Warns when
// the lowest projected point dips below zero (a liquidity gap).
function ProjectedBalance({ data, horizonLabel }) {
  const cur = data.bankBalance;
  const proj = data.projectedBalance;
  const low = data.minProjected;
  const risky = (low != null && low < 0) || (proj != null && proj < 0);
  const projColor = proj >= 0 ? 'var(--green)' : 'var(--red)';
  return (
    <Card style={{
      marginBottom: 18, padding: 18,
      background: risky ? 'color-mix(in srgb, var(--red) 6%, transparent)' : 'color-mix(in srgb, var(--green) 5%, transparent)',
      border: `1px solid color-mix(in srgb, ${risky ? 'var(--red)' : 'var(--green)'} 20%, transparent)`,
    }}>
      <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
        <Banknote size={20} color={risky ? 'var(--red)' : 'var(--green)'}/>
        <div style={{ minWidth: 150 }}>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600, marginBottom: 4 }}>الرصيد البنكي الآن</div>
          <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{fmt(cur)} <span style={{ fontSize: 11, color: 'var(--muted)' }}>ر.س</span></div>
        </div>
        <div style={{ fontSize: 20, color: 'var(--muted)' }}>←</div>
        <div style={{ minWidth: 170 }}>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600, marginBottom: 4 }}>المتوقّع بعد {horizonLabel}</div>
          <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--font-mono)', color: projColor }}>
            {fmt(proj)} <span style={{ fontSize: 11, color: 'var(--muted)' }}>ر.س</span>
          </div>
        </div>
        {risky && (
          <div style={{ flex: 1, minWidth: 200, display: 'flex', gap: 8, alignItems: 'center', color: 'var(--red)', fontSize: 12.5, fontWeight: 600 }}>
            <AlertTriangle size={16}/>
            تنبيه: النقد ينخفض — أدنى رصيد متوقّع {fmt(low)} ر.س — قد تحتاج تأخير دفعات أو تسريع تحصيل.
          </div>
        )}
      </div>
    </Card>
  );
}

// Lightweight dependency-free daily cashflow chart: per-day in/out bars +
// a running-balance line, drawn as inline SVG.
function CashflowChart({ dailyFlow, bankBalance }) {
  const W = 720, H = 150, padL = 8, padR = 8, padT = 14, padB = 22;
  const n = dailyFlow.length;
  const balances = [bankBalance ?? 0, ...dailyFlow.map(d => d.runningBalance)];
  const maxBal = Math.max(...balances, 0);
  const minBal = Math.min(...balances, 0);
  const span = (maxBal - minBal) || 1;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const x = (i) => padL + (n <= 1 ? innerW / 2 : (i / (n)) * innerW);
  const y = (v) => padT + innerH - ((v - minBal) / span) * innerH;
  const zeroY = y(0);
  // running-balance polyline (start at bankBalance, then each day)
  const pts = [[padL, y(bankBalance ?? 0)], ...dailyFlow.map((d, i) => [x(i + 1), y(d.runningBalance)])];
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const fmtDay = (iso) => { const d = new Date(iso); return `${d.getDate()}/${d.getMonth() + 1}`; };
  const barW = Math.max(3, Math.min(16, innerW / (n * 1.6)));
  return (
    <Card className="report-chart-frame" aria-label="مسار الرصيد المتوقع">
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>📈 مسار رصيدك المتوقّع</div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>
        الأعمدة = داخل (أخضر) / خارج (أحمر) كل يوم · الخط = الرصيد البنكي الجاري المتوقّع
      </div>
      <div className="report-chart-frame__plot">
      <svg role="img" aria-labelledby="cashflow-chart-title cashflow-chart-description" viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
        <title id="cashflow-chart-title">مسار الرصيد البنكي المتوقع</title>
        <desc id="cashflow-chart-description">الأعمدة تمثل التدفقات اليومية الداخلة والخارجة، والخط يمثل الرصيد الجاري المتوقع.</desc>
        <line x1={padL} y1={zeroY} x2={W - padR} y2={zeroY} stroke="var(--border)" strokeWidth="1" strokeDasharray="3 3"/>
        {dailyFlow.map((d, i) => {
          const cx = x(i + 1);
          const inH = (d.inflow / span) * innerH;
          const outH = (d.outflow / span) * innerH;
          return (
            <g key={d.date}>
              {d.inflow > 0 && <rect x={cx - barW - 1} y={zeroY - inH} width={barW} height={inH} fill="var(--green)" opacity="0.55" rx="1.5"/>}
              {d.outflow > 0 && <rect x={cx + 1} y={zeroY} width={barW} height={outH} fill="var(--red)" opacity="0.5" rx="1.5"/>}
              <text x={cx} y={H - 6} textAnchor="middle" fontSize="9" fill="var(--muted)" fontFamily="var(--font-mono)">{fmtDay(d.date)}</text>
            </g>
          );
        })}
        <path d={path} fill="none" stroke="var(--accent3)" strokeWidth="2" strokeLinejoin="round"/>
        {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="2.5" fill="var(--accent3)"/>)}
      </svg>
      </div>
    </Card>
  );
}

function DateGroup({ dateKey, events }) {
  const overdueCount = events.filter(e => e.isOverdue).length;
  const date = dateKey === 'unknown' ? null : new Date(dateKey);
  const dateLabel = date
    ? date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
    : 'بدون موعد';

  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 16px',
        background: overdueCount > 0
          ? 'color-mix(in srgb, var(--red) 6%, var(--surface2))'
          : 'var(--surface2)',
        borderBottom: '1px solid var(--border)',
      }}>
        <Calendar size={14} color={overdueCount > 0 ? 'var(--red)' : 'var(--muted)'}/>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
          {dateLabel}
        </span>
        {overdueCount > 0 && (
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
            background: 'rgba(220,38,38,.14)', color: 'var(--red)',
          }}>
            {overdueCount} متأخّر
          </span>
        )}
        <span style={{ fontSize: 11, color: 'var(--muted)', marginInlineStart: 'auto' }}>
          {events.length} {events.length === 1 ? 'حدث' : 'أحداث'}
        </span>
      </div>
      <div>
        {events.map((e, i) => <EventRow key={e.scheduleId} e={e} last={i === events.length - 1}/>)}
      </div>
    </Card>
  );
}

function EventRow({ e, last }) {
  const directionColor = e.direction === 'in'  ? 'var(--green)'
                       : e.direction === 'out' ? 'var(--red)'
                       : 'var(--muted)';
  const sign = e.direction === 'in' ? '+' : e.direction === 'out' ? '−' : '';
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '32px 1fr auto auto',
      gap: 14, padding: '14px 16px', alignItems: 'center',
      borderBottom: last ? 'none' : '1px solid var(--border)',
    }}>
      <span style={{
        width: 32, height: 32, borderRadius: 8, fontSize: 16,
        background: `color-mix(in srgb, ${e.taskColor} 14%, transparent)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{e.taskIcon}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
          {e.taskLabel} · <span style={{ color: 'var(--text2)' }}>{e.carrierName}</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
          {fmtDueLabel(e)} · {CADENCE_META[e.cadence]?.label || e.cadence} · {e.estimationSource}
        </div>
      </div>
      <div style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
        {e.estimatedAmount == null ? (
          <span style={{ fontSize: 11, color: 'var(--muted2)', fontStyle: 'italic' }}>
            بدون تقدير
          </span>
        ) : e.estimatedAmount === 0 ? (
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>بلا مبلغ</span>
        ) : (
          <div style={{
            fontSize: 16, fontWeight: 700,
            color: directionColor, fontFamily: 'var(--font-mono)', letterSpacing: -0.3,
          }}>
            {sign}{fmt(e.estimatedAmount)}
            <span style={{ fontSize: 10, color: 'var(--muted)', marginInlineStart: 3, fontWeight: 500 }}> ر.س</span>
          </div>
        )}
      </div>
      {e.isOverdue && (
        <AlertTriangle size={14} color="var(--red)"/>
      )}
    </div>
  );
}

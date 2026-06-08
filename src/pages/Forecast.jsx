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
  RefreshCw, TrendingUp, TrendingDown, Wallet, Calendar,
  ArrowDownCircle, ArrowUpCircle, AlertTriangle, Info, Banknote,
} from 'lucide-react';
import {
  Card, Btn, Spinner, Empty, toast, PageHeader,
} from '../components/UI.jsx';
import { loadCashflowForecast } from '../lib/forecastService.js';
import { TASK_KIND_META, CADENCE_META } from '../lib/tasksService.js';

const HORIZON_OPTIONS = [
  { days: 7,  label: 'هذا الأسبوع' },
  { days: 14, label: 'أسبوعين'      },
  { days: 30, label: 'هذا الشهر'   },
  { days: 60, label: 'شهرين'        },
];

const fmt = (n) => {
  if (n == null || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const fmtCompact = (n) => {
  if (n == null || Number.isNaN(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'م';
  if (a >= 1_000)     return (n / 1_000).toFixed(1)  + 'ك';
  return n.toFixed(0);
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

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await loadCashflowForecast({ horizonDays: horizon, carriers });
      setData(result);
    } catch (e) {
      toast(`فشل التحميل: ${e.message}`, 'error');
    }
    setLoading(false);
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

  if (loading || !data) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 320 }}>
          <Spinner size={28}/>
        </div>
      </div>
    );
  }

  const netColor = data.netInHorizon >= 0 ? '#047857' : '#DC2626';
  const horizonLabel = HORIZON_OPTIONS.find(h => h.days === horizon)?.label || `${horizon} يوم`;

  return (
    <div style={{ padding: '20px 24px 60px', maxWidth: 1200, margin: '0 auto' }}>
      <PageHeader
        icon={<TrendingUp size={22}/>}
        iconColor="#0EA5E9"
        title="تنبؤ التدفّق النقدي"
        subtitle="ماذا نتوقّع أن يدخل وأن يخرج خلال الفترة القادمة — مبني على مهام التحصيل والفواتير المجدولة"
        meta={`آخر تحديث ${new Date(data.asOf).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}`}
        actions={
          <Btn size="sm" variant="ghost" icon={<RefreshCw size={13}/>} onClick={refresh}>
            تحديث
          </Btn>
        }
      />

      {/* Horizon switcher */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        {HORIZON_OPTIONS.map(opt => {
          const active = horizon === opt.days;
          return (
            <button key={opt.days} onClick={() => setHorizon(opt.days)} style={{
              padding: '8px 16px', borderRadius: 999,
              border: `1.5px solid ${active ? '#0EA5E9' : 'var(--border)'}`,
              background: active ? 'color-mix(in srgb, #0EA5E9 12%, transparent)' : 'transparent',
              color: active ? '#0EA5E9' : 'var(--text2)',
              fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
              transition: 'all .15s',
            }}>
              {opt.label} <span style={{ opacity: .65, fontSize: 11 }}>({opt.days}ي)</span>
            </button>
          );
        })}
      </div>

      {/* Top stats — 3 big numbers */}
      <div style={{
        display: 'grid', gap: 12, marginBottom: 18,
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
      }}>
        <BigStat
          color="#10B981"
          icon={<ArrowDownCircle size={20}/>}
          label="متوقّع داخل"
          value={fmt(data.inflowTotal)}
          unit="ر.س"
          hint={`من ${data.events.filter(e => e.direction === 'in').length} مهمة تحصيل ${horizonLabel}`}
        />
        <BigStat
          color="#DC2626"
          icon={<ArrowUpCircle size={20}/>}
          label="متوقّع خارج"
          value={fmt(data.outflowTotal)}
          unit="ر.س"
          hint={`من ${data.events.filter(e => e.direction === 'out').length} مهمة فاتورة ${horizonLabel}`}
        />
        <BigStat
          color={netColor}
          icon={data.netInHorizon >= 0 ? <TrendingUp size={20}/> : <TrendingDown size={20}/>}
          label="الصافي المتوقّع"
          value={(data.netInHorizon >= 0 ? '+' : '−') + fmt(Math.abs(data.netInHorizon))}
          unit="ر.س"
          hint={data.netInHorizon >= 0 ? 'فائض سيولة متوقّع' : '⚠ عجز — جهّز السيولة'}
          big
        />
      </div>

      {/* Side info card: current obligations */}
      <Card style={{
        marginBottom: 18,
        background: 'color-mix(in srgb, #0EA5E9 5%, transparent)',
        border: '1px solid color-mix(in srgb, #0EA5E9 18%, transparent)',
      }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <Wallet size={18} color="#0EA5E9"/>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginBottom: 4 }}>
              مستحقّ علينا للشركات الآن
            </div>
            <div style={{ fontSize: 14, color: 'var(--text)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
              مجموع الأرصدة المفتوحة في الفواتير المجدولة ضمن الفترة:&nbsp;
              <span style={{ color: '#DC2626' }}>{fmt(data.outflowTotal)} ر.س</span>
            </div>
          </div>
          <div style={{ width: 1, height: 36, background: 'var(--border)' }}/>
          <div style={{ minWidth: 200 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginBottom: 4 }}>
              COD في الطريق إلينا
            </div>
            <div style={{ fontSize: 14, color: '#047857', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
              {fmt(data.codInTransit)} <span style={{ fontSize: 11, color: 'var(--muted)' }}>ر.س</span>
            </div>
          </div>
        </div>
      </Card>

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
          الكشوف وتقارير الأوزان مدرجة كأحداث تشغيلية بدون أثر نقدي.{' '}
          الأرقام إرشادية — لا تستخدمها كقيد محاسبي.
        </div>
      </div>
    </div>
  );
}

// ── subcomponents ──────────────────────────────────────────────
function BigStat({ color, icon, label, value, unit, hint, big = false }) {
  return (
    <Card style={{
      padding: 18,
      background: `color-mix(in srgb, ${color} ${big ? 8 : 5}%, transparent)`,
      border: `1px solid color-mix(in srgb, ${color} ${big ? 28 : 18}%, transparent)`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{
          width: 32, height: 32, borderRadius: 9,
          background: `color-mix(in srgb, ${color} 16%, transparent)`,
          color, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', letterSpacing: .5 }}>
          {label}
        </span>
      </div>
      <div style={{
        fontSize: big ? 30 : 24, fontWeight: 800,
        color, fontFamily: 'var(--font-mono)', letterSpacing: -0.6,
      }}>
        {value}
        <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500, marginInlineStart: 6 }}>{unit}</span>
      </div>
      {hint && (
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
          {hint}
        </div>
      )}
    </Card>
  );
}

function DateGroup({ dateKey, events }) {
  const overdueCount = events.filter(e => e.isOverdue).length;
  const date = dateKey === 'unknown' ? null : new Date(dateKey);
  const dateLabel = date
    ? date.toLocaleDateString('ar-SA', { weekday: 'long', day: 'numeric', month: 'long' })
    : 'بدون موعد';

  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 16px',
        background: overdueCount > 0
          ? 'color-mix(in srgb, #DC2626 6%, var(--surface2))'
          : 'var(--surface2)',
        borderBottom: '1px solid var(--border)',
      }}>
        <Calendar size={14} color={overdueCount > 0 ? '#DC2626' : 'var(--muted)'}/>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
          {dateLabel}
        </span>
        {overdueCount > 0 && (
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
            background: 'rgba(220,38,38,.14)', color: '#DC2626',
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
  const directionColor = e.direction === 'in'  ? '#047857'
                       : e.direction === 'out' ? '#DC2626'
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
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>تشغيلي</span>
        ) : (
          <div style={{
            fontSize: 16, fontWeight: 700,
            color: directionColor, fontFamily: 'var(--font-mono)', letterSpacing: -0.3,
          }}>
            {sign}{fmtCompact(e.estimatedAmount)}
            <span style={{ fontSize: 10, color: 'var(--muted)', marginInlineStart: 3, fontWeight: 500 }}> ر.س</span>
          </div>
        )}
      </div>
      {e.isOverdue && (
        <AlertTriangle size={14} color="#DC2626"/>
      )}
    </div>
  );
}

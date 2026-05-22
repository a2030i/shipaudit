// "نظرة عامة" — the one screen that answers "كيف الشركة الآن؟"
//
// Top:    Monthly snapshot. 4 big numbers (carrier spend / COD received /
//         net / drift recovered) with month-over-month deltas.
// Middle: Concentration — top carriers by spend % + top customers by debt %.
//         Designed so the operator immediately notices "60% of our
//         spending sits with one carrier" or "20% of receivables sit
//         with one customer".
// Lower:  AP aging — open carrier balances bucketed by 0-30 / 31-60 /
//         61-90 / 90+ days. Standard accounting view.
// Strip:  Operational alerts (pending audits, overdue AP, etc.)
//
// Everything is read-only. Numbers come from the four overview RPCs
// (monthly_financial_snapshot, ap_aging_by_carrier,
// carrier_spend_concentration, customer_debt_concentration). Period
// switcher at top — defaults to the current month, can flip back to
// any historical month for "كيف كان الوضع شهر يناير".

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  RefreshCw, TrendingUp, TrendingDown, Wallet, Calendar,
  AlertTriangle, Building2, Users, Banknote, Activity,
  ArrowDownCircle, ArrowUpCircle, ChevronLeft, Info,
  Heart, Shield,
} from 'lucide-react';
import {
  Card, Btn, Spinner, Empty, toast, PageHeader,
} from '../components/UI.jsx';
import { loadOverview, currentPeriod, prevPeriodOf } from '../lib/overviewService.js';

const fmtMonth = (period) => {
  if (!period) return '—';
  const [y, m] = period.split('-');
  const months = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  return `${months[Number(m) - 1] || m} ${y}`;
};
const fmt = (n) =>
  n == null || Number.isNaN(n) ? '—'
  : Number(n).toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtCompact = (n) => {
  if (n == null || Number.isNaN(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'م';
  if (a >= 1_000)     return (n / 1_000).toFixed(1) + 'ك';
  return n.toFixed(0);
};

export default function Overview({ carriers = [], isActive = true }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData]       = useState(null);
  const [period, setPeriod]   = useState(currentPeriod());

  const carrierNameById = useMemo(
    () => new Map((carriers || []).map(c => [c.id, c.name])),
    [carriers],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await loadOverview({ period, topN: 5 });
      setData(result);
    } catch (e) {
      toast(`فشل التحميل: ${e.message}`, 'error');
    }
    setLoading(false);
  }, [period]);

  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh, location.pathname]);

  if (loading || !data) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 320 }}>
          <Spinner size={28}/>
        </div>
      </div>
    );
  }

  // Period-back navigation: go to the previous month
  const goPrev = () => setPeriod(prevPeriodOf(period));
  // Allow forward only up to current month — no point projecting backwards
  const isCurrent = period === currentPeriod();
  const goNext = () => {
    if (isCurrent) return;
    const [y, m] = period.split('-').map(Number);
    const next = new Date(y, m, 1);
    setPeriod(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`);
  };

  return (
    <div style={{ padding: '20px 24px 60px', maxWidth: 1280, margin: '0 auto' }}>
      <PageHeader
        icon={<Activity size={22}/>}
        iconColor="#0EA5E9"
        title="نظرة عامة"
        subtitle={`الوضع المالي العام للشركة — ${fmtMonth(period)}`}
        meta={`مقارنة بـ ${fmtMonth(data.prevPeriod)}`}
        actions={
          <div style={{ display: 'flex', gap: 6 }}>
            <Btn size="sm" variant="ghost" onClick={goPrev} title="الشهر السابق">
              ‹
            </Btn>
            {!isCurrent && (
              <Btn size="sm" variant="ghost" onClick={goNext} title="الشهر التالي">
                ›
              </Btn>
            )}
            {!isCurrent && (
              <Btn size="sm" variant="ghost" onClick={() => setPeriod(currentPeriod())}>
                العودة للشهر الحالي
              </Btn>
            )}
            <Btn size="sm" variant="ghost" icon={<RefreshCw size={13}/>} onClick={refresh}>
              تحديث
            </Btn>
          </div>
        }
      />

      {/* ── Section 1: Monthly snapshot — 4 big numbers ── */}
      <SectionTitle icon={<Calendar size={14}/>} color="#0EA5E9">
        لمحة الشهر — {fmtMonth(period)}
      </SectionTitle>
      <div style={{
        display: 'grid', gap: 12, marginBottom: 24,
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
      }}>
        <BigStat
          color="#DC2626"
          icon={<ArrowUpCircle size={18}/>}
          label="إنفاق على الشركات"
          value={fmt(data.thisMonth.carrierSpend)}
          unit="ر.س"
          delta={data.deltas.carrierSpend}
          deltaInverted    /* spend going up is bad, so red arrow */
          hint={`${data.thisMonth.auditsApproved} مراجعة معتمدة هذا الشهر`}
        />
        <BigStat
          color="#10B981"
          icon={<ArrowDownCircle size={18}/>}
          label="COD مُستلَم"
          value={fmt(data.thisMonth.codReceived)}
          unit="ر.س"
          delta={data.deltas.codReceived}
          hint="من ملفات تحصيل الشركات"
        />
        <BigStat
          color={data.thisMonth.net >= 0 ? '#047857' : '#DC2626'}
          icon={data.thisMonth.net >= 0 ? <TrendingUp size={18}/> : <TrendingDown size={18}/>}
          label="صافي الشهر"
          value={(data.thisMonth.net >= 0 ? '+' : '−') + fmt(Math.abs(data.thisMonth.net))}
          unit="ر.س"
          delta={data.deltas.net}
          hint="COD مُستلَم − إنفاق على الشركات"
          big
        />
        <BigStat
          color="#8B5CF6"
          icon={<AlertTriangle size={18}/>}
          label="الفروق المُكتشفة"
          value={fmt(data.thisMonth.driftTotal)}
          unit="ر.س"
          hint={data.thisMonth.driftTotal < 0 ? 'مبالغ زائدة وفّرناها' : data.thisMonth.driftTotal > 0 ? 'مبالغ ناقصة على فواتير' : 'لا فروق'}
        />
      </div>

      {/* Action alerts strip */}
      {data.thisMonth.auditsPending > 0 && (
        <Card
          style={{
            marginBottom: 18,
            background: 'color-mix(in srgb, #F59E0B 8%, transparent)',
            border: '1px solid color-mix(in srgb, #F59E0B 24%, transparent)',
            cursor: 'pointer',
          }}
          hover
          onClick={() => navigate('/audits')}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <AlertTriangle size={16} color="#F59E0B"/>
            <span style={{ fontSize: 13, color: 'var(--text)', flex: 1 }}>
              <strong>{data.thisMonth.auditsPending}</strong> مراجعة بانتظار اعتمادك — افتح القائمة
            </span>
            <ChevronLeft size={14} color="var(--muted)"/>
          </div>
        </Card>
      )}

      {/* ── Section 2: Concentration — risk awareness ── */}
      <div style={{
        display: 'grid', gap: 14, marginBottom: 24,
        gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
      }}>
        {/* Top carriers by spend */}
        <Card>
          <SectionTitle icon={<Building2 size={14}/>} color="#3B82F6" inline>
            الناقلون — تركّز الإنفاق ({fmtMonth(period)})
          </SectionTitle>
          {data.carrierConcentration.length === 0 ? (
            <Empty icon="📭" title="لا إنفاق هذا الشهر" sub="ينعكس بعد اعتماد أوّل مراجعة"/>
          ) : (
            <ConcentrationBars
              rows={data.carrierConcentration.map(r => ({
                key:        r.carrierId,
                name:       carrierNameById.get(r.carrierId) || r.carrierId,
                value:      r.spend,
                share:      r.sharePct,
                rank:       r.rank,
                meta:       `${r.auditsCount} مراجعة`,
                onClick:    () => navigate(`/carrier?id=${r.carrierId}`),
              }))}
              valueUnit="ر.س"
              warnAtPct={50}
              tint="#3B82F6"
            />
          )}
        </Card>

        {/* Top customers by debt */}
        <Card>
          <SectionTitle icon={<Users size={14}/>} color="#EF4444" inline>
            العملاء — تركّز المديونيات
          </SectionTitle>
          {data.customerConcentration.length === 0 ? (
            <Empty icon="📭" title="لا مديونيات حالياً" sub="ارفع snapshot من /receivables"/>
          ) : (
            <ConcentrationBars
              rows={data.customerConcentration.map(r => ({
                key:        r.customerName,
                name:       r.customerName,
                value:      r.debt,
                share:      r.sharePct,
                rank:       r.rank,
                meta:       `${r.invoiceCount} فاتورة`,
                onClick:    () => navigate('/receivables'),
              }))}
              valueUnit="ر.س"
              warnAtPct={25}
              tint="#EF4444"
            />
          )}
        </Card>
      </div>

      {/* ── Section 3: AP aging ── */}
      <SectionTitle icon={<Wallet size={14}/>} color="#F59E0B">
        أعمار الذمم الدائنة — ما علينا للشركات
      </SectionTitle>
      <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 18 }}>
        {/* Totals row up top */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          background: 'var(--surface2)', borderBottom: '1px solid var(--border)',
        }}>
          <AgingCell label="حديث (0–30ي)"  value={data.aging.totals.current} tone="#10B981"/>
          <AgingCell label="31–60 يوم"      value={data.aging.totals.d31_60}  tone="#F59E0B"/>
          <AgingCell label="61–90 يوم"      value={data.aging.totals.d61_90}  tone="#F97316"/>
          <AgingCell label="+90 يوم"        value={data.aging.totals.d90}     tone="#DC2626"/>
          <AgingCell label="المجموع"        value={data.aging.totals.total}   tone="var(--text)" bold/>
        </div>
        {/* Per-carrier rows */}
        {data.aging.rows.length === 0 ? (
          <Empty icon="✓" title="لا ذمم مفتوحة" sub="كل الفواتير معتمدة ومسدّدة"/>
        ) : (
          <div>
            {data.aging.rows.map(r => (
              <div key={r.carrierId} style={{
                display: 'grid',
                gridTemplateColumns: '1.3fr repeat(5, 1fr)',
                borderBottom: '1px solid var(--border)',
                padding: '10px 0', fontSize: 12,
                cursor: 'pointer',
              }}
              onClick={() => navigate(`/carrier?id=${r.carrierId}`)}>
                <div style={{ padding: '0 14px', fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  {carrierNameById.get(r.carrierId) || r.carrierId}
                  <ChevronLeft size={12} color="var(--muted2)"/>
                </div>
                <AmtCell value={r.current} active={r.current > 0.5} tone="#10B981"/>
                <AmtCell value={r.d31_60}  active={r.d31_60 > 0.5}  tone="#F59E0B"/>
                <AmtCell value={r.d61_90}  active={r.d61_90 > 0.5}  tone="#F97316"/>
                <AmtCell value={r.d90}     active={r.d90 > 0.5}     tone="#DC2626"/>
                <AmtCell value={r.total}   active                  tone="var(--text)" bold/>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── Section 4: Carrier health KPIs ── */}
      {data.carrierHealth.length > 0 && (
        <>
          <SectionTitle icon={<Shield size={14}/>} color="#10B981">
            صحة الناقلين — جودة الفواتير والبيانات
          </SectionTitle>
          <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 18 }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1.4fr repeat(6, 1fr)',
              background: 'var(--surface2)', borderBottom: '1px solid var(--border)',
              padding: '10px 0', fontSize: 11, color: 'var(--muted)', fontWeight: 600,
            }}>
              <div style={{ padding: '0 14px' }}>الناقل</div>
              <div style={{ padding: '0 8px', textAlign: 'center' }}>صحة</div>
              <div style={{ padding: '0 8px', textAlign: 'center' }}>مراجعات</div>
              <div style={{ padding: '0 8px', textAlign: 'center' }}>الفروق %</div>
              <div style={{ padding: '0 8px', textAlign: 'center' }}>عدم تطابق %</div>
              <div style={{ padding: '0 8px', textAlign: 'center' }}>قبول أول مرة</div>
              <div style={{ padding: '0 8px', textAlign: 'center' }}>متوسط الاعتماد</div>
            </div>
            {data.carrierHealth.map(r => (
              <div
                key={r.carrierId}
                onClick={() => navigate(`/carrier?id=${r.carrierId}`)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1.4fr repeat(6, 1fr)',
                  borderBottom: '1px solid var(--border)',
                  padding: '12px 0', fontSize: 12, alignItems: 'center',
                  cursor: 'pointer',
                }}
              >
                <div style={{ padding: '0 14px', fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  {carrierNameById.get(r.carrierId) || r.carrierId}
                  <ChevronLeft size={12} color="var(--muted2)"/>
                </div>
                <div style={{ padding: '0 8px', textAlign: 'center' }}>
                  <HealthPill score={r.score}/>
                </div>
                <div style={{ padding: '0 8px', textAlign: 'center', fontFamily: 'var(--font-mono)', color: 'var(--text2)' }}>
                  {r.auditsApproved}
                </div>
                <div style={{ padding: '0 8px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontWeight: 600, color: r.driftPct > 1 ? '#DC2626' : 'var(--text2)' }}>
                  {r.driftPct.toFixed(1)}%
                </div>
                <div style={{ padding: '0 8px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontWeight: 600, color: r.mismatchPct > 1 ? '#F59E0B' : 'var(--text2)' }}>
                  {r.mismatchPct.toFixed(1)}%
                </div>
                <div style={{ padding: '0 8px', textAlign: 'center', fontFamily: 'var(--font-mono)', color: r.firstPassRate < 80 ? '#F59E0B' : '#10B981' }}>
                  {r.firstPassRate.toFixed(0)}%
                </div>
                <div style={{ padding: '0 8px', textAlign: 'center', fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
                  {r.avgApprovalHours < 1 ? '<1س'
                    : r.avgApprovalHours < 24 ? `${r.avgApprovalHours.toFixed(0)}س`
                    : `${(r.avgApprovalHours / 24).toFixed(1)}ي`}
                </div>
              </div>
            ))}
          </Card>
        </>
      )}

      {/* Footer hint */}
      <div style={{
        marginTop: 14, padding: 14, borderRadius: 10,
        background: 'var(--surface2)', border: '1px solid var(--border)',
        fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.7,
        display: 'flex', gap: 10, alignItems: 'flex-start',
      }}>
        <Info size={14} style={{ flexShrink: 0, marginTop: 2 }}/>
        <div>
          <strong style={{ color: 'var(--text2)' }}>كيف تُحسب الأرقام:</strong>{' '}
          الإنفاق = مجموع <code>amount_dr</code> في <code>carrier_operations</code> بتاريخ ضمن الشهر.{' '}
          COD المُستلَم = ما رُفع من ملفات تحصيل الشركات بـ <code>direction='in'</code>.{' '}
          الفروق = مجموع <code>drift_pre_tax</code> للمراجعات المعتمدة هذا الشهر — سالب يعني وفّرنا، موجب يعني ندفع زيادة.
          تركّز العملاء يأتي من آخر snapshot مديونيات.{' '}
          أعمار الذمم = الفرق بين تاريخ الفاتورة واليوم، للقيود غير المسددة.
        </div>
      </div>
    </div>
  );
}

// ─── subcomponents ──────────────────────────────────────────────
function SectionTitle({ icon, color, children, inline = false }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      marginBottom: inline ? 14 : 10,
      paddingBottom: inline ? 10 : 0,
      borderBottom: inline ? '1px solid var(--border)' : 'none',
    }}>
      <span style={{
        width: 24, height: 24, borderRadius: 7,
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
        color, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{icon}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
        {children}
      </span>
    </div>
  );
}

function BigStat({ color, icon, label, value, unit, delta, deltaInverted = false, hint, big = false }) {
  // delta semantics: positive number = went UP this month.
  // deltaInverted=true flips the color meaning (spend going up = bad).
  const deltaUp = delta != null && delta > 0;
  const deltaColor = delta == null
    ? 'var(--muted)'
    : (deltaUp ? (deltaInverted ? '#DC2626' : '#047857') : (deltaInverted ? '#047857' : '#DC2626'));
  const deltaArrow = delta == null ? '·' : deltaUp ? '↑' : '↓';

  return (
    <Card style={{
      padding: 16,
      background: `color-mix(in srgb, ${color} ${big ? 8 : 5}%, transparent)`,
      border:     `1px solid color-mix(in srgb, ${color} ${big ? 28 : 18}%, transparent)`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{
          width: 30, height: 30, borderRadius: 8,
          background: `color-mix(in srgb, ${color} 16%, transparent)`,
          color, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', letterSpacing: .5 }}>
          {label}
        </span>
        {delta != null && (
          <span style={{
            marginInlineStart: 'auto',
            fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 999,
            background: `color-mix(in srgb, ${deltaColor} 14%, transparent)`,
            color: deltaColor, fontFamily: 'var(--font-mono)',
          }}>
            {deltaArrow} {Math.abs(delta).toFixed(1)}%
          </span>
        )}
      </div>
      <div style={{
        fontSize: big ? 28 : 22, fontWeight: 800,
        color, fontFamily: 'var(--font-mono)', letterSpacing: -0.6,
      }}>
        {value}
        <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 500, marginInlineStart: 6 }}>{unit}</span>
      </div>
      {hint && (
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
          {hint}
        </div>
      )}
    </Card>
  );
}

function ConcentrationBars({ rows, valueUnit, warnAtPct, tint }) {
  const maxValue = Math.max(...rows.map(r => r.value), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map(r => {
        const widthPct = Math.max(2, (r.value / maxValue) * 100);
        const warn = r.share >= warnAtPct;
        return (
          <div
            key={r.key}
            onClick={r.onClick}
            style={{ cursor: r.onClick ? 'pointer' : 'default', padding: '4px 0' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{
                fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
                color: 'var(--muted)', minWidth: 16, textAlign: 'center',
              }}>{r.rank}</span>
              <span style={{
                fontSize: 12.5, fontWeight: 600,
                color: warn ? '#DC2626' : 'var(--text)',
                flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{r.name}</span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{r.meta}</span>
              <span style={{
                fontSize: 11.5, fontWeight: 700,
                color: warn ? '#DC2626' : tint,
                fontFamily: 'var(--font-mono)',
              }}>
                {r.share.toFixed(1)}%
              </span>
            </div>
            <div style={{
              position: 'relative', height: 6, borderRadius: 3,
              background: 'var(--surface2)',
              marginInlineStart: 24,
            }}>
              <div style={{
                position: 'absolute', insetInlineEnd: 0, top: 0, bottom: 0,
                width: `${widthPct}%`,
                background: warn
                  ? 'linear-gradient(to left, #DC2626, color-mix(in srgb, #DC2626 60%, transparent))'
                  : `linear-gradient(to left, ${tint}, color-mix(in srgb, ${tint} 60%, transparent))`,
                borderRadius: 3,
              }}/>
            </div>
            <div style={{
              fontSize: 10.5, color: 'var(--muted)', marginTop: 3, marginInlineStart: 24,
              fontFamily: 'var(--font-mono)',
            }}>
              {fmtCompact(r.value)} {valueUnit}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AgingCell({ label, value, tone, bold = false }) {
  return (
    <div style={{ padding: '12px 14px', borderInlineStart: '1px solid var(--border)' }}>
      <div style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 600, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{
        fontSize: 15, fontFamily: 'var(--font-mono)',
        fontWeight: bold ? 800 : 700,
        color: value > 0.5 ? tone : 'var(--muted2)',
      }}>
        {value > 0.5 ? fmtCompact(value) : '—'}
      </div>
    </div>
  );
}

function HealthPill({ score }) {
  // Three-tier color: green ≥90, amber 70-89, red <70.
  const tone = score >= 90 ? '#047857'
             : score >= 70 ? '#B45309'
             :              '#DC2626';
  const bg   = score >= 90 ? 'rgba(16,185,129,.14)'
             : score >= 70 ? 'rgba(245,158,11,.14)'
             :              'rgba(220,38,38,.14)';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 9px', borderRadius: 999,
      background: bg, color: tone,
      fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)',
    }}>
      <Heart size={9}/> {score}
    </span>
  );
}

function AmtCell({ value, active, tone, bold = false }) {
  return (
    <div style={{
      padding: '4px 14px', textAlign: 'center',
      fontFamily: 'var(--font-mono)', fontSize: 12,
      fontWeight: bold ? 800 : 600,
      color: active ? tone : 'var(--muted2)',
    }}>
      {active ? fmtCompact(value) : '—'}
    </div>
  );
}

import { useState, useEffect, useMemo, useCallback } from 'react';
import { RefreshCw, TrendingUp, TrendingDown, AlertTriangle, BarChart3 } from 'lucide-react';
import { Card, Btn, Spinner, Empty, toast, PageHeader } from '../components/UI.jsx';
import { loadCarrierKpis } from '../lib/carrierStatementsService.js';
import { carrierScore } from '../lib/carrierScore.js';

const fmt = n => (n == null || Number.isNaN(n))
  ? '—'
  : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = n => (n == null || Number.isNaN(n)) ? '—' : `${(n * 100).toFixed(0)}%`;

export default function CarrierKpi({ isActive = true }) {
  const [kpis, setKpis] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await loadCarrierKpis();
      setKpis(data);
    } catch (e) {
      toast(`خطأ: ${e.message}`, 'error');
    }
    setLoading(false);
  }, []);

  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh]);

  const totals = useMemo(() => kpis.reduce((acc, k) => ({
    ops:           acc.ops + k.ops,
    overcharges:   acc.overcharges + k.overcharges,
    overchargeAmt: acc.overchargeAmt + k.overchargeAmount,
    disputesOpen:  acc.disputesOpen + k.disputesOpen,
    totalBilled:   acc.totalBilled + k.totalBilled,
    totalPaid:     acc.totalPaid + k.totalPaid,
  }), { ops: 0, overcharges: 0, overchargeAmt: 0, disputesOpen: 0, totalBilled: 0, totalPaid: 0 }), [kpis]);

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner size={22}/></div>
  );

  return (
    <div style={{ padding: '24px 28px 80px', maxWidth: 1320, margin: '0 auto' }}>
      <PageHeader
        icon={<BarChart3 size={22}/>}
        title="أداء الناقلين"
        subtitle="مؤشرات الدقة، النزاعات، الالتزام بالسداد، والتغطية بالتدقيق لكل ناقل."
        actions={<Btn size="sm" variant="ghost" icon={<RefreshCw size={14}/>} onClick={refresh}>تحديث</Btn>}
      />

      {kpis.length === 0 ? (
        <Empty icon="📊" title="لا توجد بيانات بعد" sub="ارفع كشف حساب وفواتير لتظهر المؤشرات هنا"/>
      ) : (
        <>
          {/* Overall totals */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px,1fr))', gap: 12, marginBottom: 18 }}>
            <Stat label="إجمالي الفواتير" value={totals.ops} color="var(--accent)" big/>
            <Stat label="إجمالي مفوتر" value={fmt(totals.totalBilled)} suffix="ر.س" color="var(--text)" big/>
            <Stat label="استرداد عبر التدقيق" value={fmt(totals.overchargeAmt)} suffix="ر.س"
              hint={`${totals.overcharges} مراجعة بفروق`} color="var(--green)"/>
            <Stat label="نزاعات مفتوحة" value={totals.disputesOpen} color="var(--red)"/>
          </div>

          {/* Per-carrier scorecards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px,1fr))', gap: 14 }}>
            {kpis.map(k => <CarrierCard key={k.carrierId} k={k}/>)}
          </div>
        </>
      )}
    </div>
  );
}

// ── CarrierCard ────────────────────────────────────────────────────────
function CarrierCard({ k }) {
  // الدرجة الموحّدة من carrierScore.js (نفس معادلة جدول «صحة الناقلين» في
  // الرئيسية) — المكوّن غير المتاح يُستبعَد ويُعاد توزيع وزنه بدل اعتباره كاملاً.
  const { score, level } = useMemo(() => carrierScore({
    coverage:       k.rvOps ? k.auditCoverage : null,
    mismatchPct:    k.auditsCount ? k.mismatchRate * 100 : null,
    avgDisputeDays: k.disputesResolved ? k.avgDisputeDays : null,
    avgPayDays:     (k.paidOnTime + k.paidLate) ? k.avgPayDays : null,
  }), [k]);

  const scoreColor = level?.color || 'var(--muted)';

  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '14px 16px', borderBottom: '1px solid var(--border)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        background: 'var(--surface)',
      }}>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 15, color: 'var(--accent)' }}>
            {k.carrierName}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            {k.ops} عملية · {fmt(k.totalBilled)} ر.س مفوتر
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 28,
            color: scoreColor, lineHeight: 1,
          }}>
            {score ?? '—'}
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>تقييم</div>
        </div>
      </div>

      {/* Metric rows */}
      <div style={{ padding: '4px 0' }}>
        <Row icon="🔬"
          label="تغطية التدقيق"
          value={`${k.opsAudited} من ${k.rvOps} فاتورة`}
          extra={pct(k.auditCoverage)}
          extraColor={k.auditCoverage >= 0.9 ? 'var(--green)' : k.auditCoverage >= 0.5 ? 'var(--gold)' : 'var(--red)'}
        />
        <Row icon="✗"
          label="نسبة الفواتير بفروق"
          value={`${k.overcharges} من ${k.auditsCount} تدقيق`}
          extra={pct(k.mismatchRate)}
          extraColor={k.mismatchRate <= 0.1 ? 'var(--green)' : k.mismatchRate <= 0.3 ? 'var(--gold)' : 'var(--red)'}
        />
        <Row icon="💸"
          label="استرداد محتمل"
          value={`${fmt(k.overchargeAmount)} ر.س`}
          valueColor="var(--green)"
        />
        <div style={{ borderTop: '1px dashed var(--border)', margin: '4px 0' }}/>
        <Row icon="⚠️"
          label="النزاعات"
          value={`${k.disputesOpened} فُتح · ${k.disputesResolved} حُلّ`}
          extra={k.disputesOpen > 0 ? `${k.disputesOpen} مفتوح` : '✓'}
          extraColor={k.disputesOpen > 0 ? 'var(--red)' : 'var(--green)'}
        />
        {k.disputesResolved > 0 && (
          <Row icon="⏱"
            label="متوسط مدة الحل"
            value={`${k.avgDisputeDays.toFixed(0)} يوم`}
            valueColor={k.avgDisputeDays <= 14 ? 'var(--green)' : k.avgDisputeDays <= 30 ? 'var(--gold)' : 'var(--red)'}
          />
        )}
        <div style={{ borderTop: '1px dashed var(--border)', margin: '4px 0' }}/>
        <Row icon="✓"
          label="مسدّد في الموعد"
          value={`${k.paidOnTime} في الموعد · ${k.paidLate} متأخر`}
          extra={k.paidOnTime + k.paidLate > 0 ? pct(k.paidOnTime / (k.paidOnTime + k.paidLate)) : '—'}
          extraColor={k.paidLate === 0 ? 'var(--green)' : k.paidOnTime / Math.max(1, k.paidOnTime + k.paidLate) >= 0.8 ? 'var(--gold)' : 'var(--red)'}
        />
        {(k.paidOnTime + k.paidLate) > 0 && (
          <Row icon="📅"
            label="متوسط أيام السداد"
            value={`${k.avgPayDays >= 0 ? '+' : ''}${k.avgPayDays.toFixed(0)} يوم`}
            valueColor={k.avgPayDays <= 0 ? 'var(--green)' : k.avgPayDays <= 7 ? 'var(--gold)' : 'var(--red)'}
            sub="من تاريخ الاستحقاق"
          />
        )}
      </div>
    </Card>
  );
}

// ── Building blocks ────────────────────────────────────────────────────
function Row({ icon, label, value, valueColor, extra, extraColor, sub }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 10,
      padding: '8px 16px', alignItems: 'center',
    }}>
      <span style={{ fontSize: 14, opacity: 0.85 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{label}</div>
        <div style={{
          fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 600,
          color: valueColor || 'var(--text)', marginTop: 1,
        }}>{value}</div>
        {sub && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1 }}>{sub}</div>}
      </div>
      {extra != null && (
        <div style={{
          fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 13,
          color: extraColor || 'var(--text)',
        }}>
          {extra}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, suffix, hint, color, big }) {
  return (
    <div className="stat-card" style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 11, padding: '13px 16px',
      '--sc-tone': color,
    }}>
      <div style={{ color: 'var(--muted)', fontSize: 10, fontFamily: 'var(--font-mono)', marginBottom: 3 }}>
        {label}
      </div>
      <div style={{
        color, fontSize: big ? 22 : 16, fontFamily: 'var(--font-mono)', fontWeight: 700, whiteSpace: 'nowrap',
      }}>
        {value}
        {suffix && <span style={{ fontSize: 10, color: 'var(--muted)', marginRight: 4 }}> {suffix}</span>}
      </div>
      {hint && <div style={{ color: 'var(--muted)', fontSize: 10, marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

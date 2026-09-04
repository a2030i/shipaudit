import { useState, useEffect, useMemo, useCallback } from 'react';
import { RefreshCw, TrendingUp, TrendingDown, AlertTriangle, BarChart3 } from 'lucide-react';
import { Button as Btn, EmptyState as Empty, Money, PageHeader, Panel as Card, Spinner, StatStrip } from '../design-system/EnterpriseUI.jsx';
import { toast } from '../lib/toast.js';
import OperationsWorkspaceNav from '../components/enterprise/OperationsWorkspaceNav.jsx';
import { loadCarrierKpis } from '../lib/carrierStatementsService.js';
import { carrierScore } from '../lib/carrierScore.js';
import './ReportsWorkspace.css';

const fmt = n => (n == null || Number.isNaN(n))
  ? '—'
  : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = n => (n == null || Number.isNaN(n)) ? '—' : `${(n * 100).toFixed(0)}%`;

export default function CarrierKpi({ isActive = true, carrierId = '', embedded = false }) {
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

  const visibleKpis = useMemo(() => carrierId ? kpis.filter(k => String(k.carrierId) === String(carrierId)) : kpis, [kpis, carrierId]);
  const totals = useMemo(() => visibleKpis.reduce((acc, k) => ({
    ops:           acc.ops + k.ops,
    overcharges:   acc.overcharges + k.overcharges,
    overchargeAmt: acc.overchargeAmt + k.overchargeAmount,
    disputesOpen:  acc.disputesOpen + k.disputesOpen,
    totalBilled:   acc.totalBilled + k.totalBilled,
    totalPaid:     acc.totalPaid + k.totalPaid,
  }), { ops: 0, overcharges: 0, overchargeAmt: 0, disputesOpen: 0, totalBilled: 0, totalPaid: 0 }), [visibleKpis]);

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner size={22}/></div>
  );

  return (
    <div className="carrier-kpi-view" style={{ padding: embedded ? 0 : undefined }}>
      <PageHeader
        icon={<BarChart3 size={22}/>}
        title={carrierId ? 'أداء شركة الشحن' : 'أداء شركات الشحن'}
        subtitle={carrierId ? 'الدقة والمخالفات والمطالبات والالتزام بالسداد لهذه الشركة.' : 'مؤشرات الدقة، النزاعات، الالتزام بالسداد، والتغطية بالتدقيق لكل شركة.'}
        actions={<Btn size="sm" variant="ghost" icon={<RefreshCw size={14}/>} onClick={refresh}>تحديث</Btn>}
      />
      <OperationsWorkspaceNav active="carriers"/>

      {visibleKpis.length === 0 ? (
        <Empty icon="📊" title="لا توجد بيانات بعد" sub="ارفع كشف حساب وفواتير لتظهر المؤشرات هنا"/>
      ) : (
        <>
          {/* Overall totals */}
          <StatStrip items={[
            { key: 'ops', label: 'إجمالي الفواتير', value: totals.ops.toLocaleString('en-US') },
            { key: 'ledger', label: 'صافي حركة دفتر الناقلين', value: <Money value={totals.totalBilled}/>, note: 'السالب يعني صافي رصيد لصالحك' },
            { key: 'recovery', label: 'استرداد عبر التدقيق', value: <Money value={totals.overchargeAmt}/>, note: `${totals.overcharges} مراجعة بفروق`, tone: 'success' },
            { key: 'disputes', label: 'نزاعات مفتوحة', value: totals.disputesOpen.toLocaleString('en-US'), tone: totals.disputesOpen ? 'danger' : undefined },
          ]}/>

          {/* Per-carrier scorecards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px,1fr))', gap: 14 }}>
            {visibleKpis.map(k => <CarrierCard key={k.carrierId} k={k}/>)}
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
            {k.ops} حركة · صافي الدفتر {fmt(k.totalBilled)} ر.س
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

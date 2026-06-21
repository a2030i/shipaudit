// لوحة القرارات — "شاشة الصباح": one screen that pulls together every
// signal that needs a DECISION today, from across the app, so the operator
// doesn't have to tour 5 pages. Each card is a one-glance KPI + the top
// offenders + a button into the page where the action happens.
//
// Sources (all existing): customer anomalies + risk (customer360Service +
// customerRisk), COD net per carrier (carrier_cod_net_balances), COD
// treasuries (Zoho trial balance), vendor recording gap (Zoho vendors).

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Gauge, ChevronLeft } from 'lucide-react';
import { Card, Spinner, Btn, PageHeader, toast } from '../components/UI.jsx';
import { loadCustomerWatch } from '../lib/customer360Service.js';
import { computeRisk } from '../lib/customerRisk.js';
import { loadCarrierNetBalances } from '../lib/codSettlementService.js';
import { loadTreasuryBalances, loadVendorReconciliation } from '../lib/reconciliationService.js';

const fmt  = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtK = (n) => { const a = Math.abs(n); return a >= 1000 ? (n / 1000).toFixed(1) + 'ك' : String(Math.round(n)); };

export default function DecisionsBoard({ isActive = true }) {
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [watch, codNet, treasury, vendor] = await Promise.all([
        loadCustomerWatch().catch(() => null),
        loadCarrierNetBalances().catch(() => new Map()),
        loadTreasuryBalances().catch(() => ({ rows: [], uploadedAt: null })),
        loadVendorReconciliation().catch(() => []),
      ]);

      // Stop-list: flatten every anomaly customer (dedupe), score, keep the
      // "suspend before it grows" ones, highest risk first.
      const seen = new Set(); const anom = [];
      for (const list of Object.values(watch?.anomalies || {})) {
        for (const c of (list || [])) { if (!seen.has(c.name)) { seen.add(c.name); anom.push(c); } }
      }
      const stopList = anom.map(c => ({ ...c, risk: computeRisk(c) }))
        .filter(c => c.risk.shouldStop)
        .sort((a, b) => b.risk.score - a.risk.score);
      const stopTotal = stopList.reduce((s, c) => s + (Number(c.total) || 0), 0);

      // COD owed to us (positive nets only).
      let codOut = 0, codN = 0;
      for (const v of codNet.values()) { if (v > 0.5) { codOut += v; codN++; } }

      // COD treasuries still holding cash (the bigger of debit/credit side).
      const trows = treasury.rows || [];
      const held = trows.reduce((s, r) => s + Math.max(Number(r.debit) || 0, Number(r.credit) || 0), 0);
      const trN  = trows.filter(r => (Number(r.debit) || 0) + (Number(r.credit) || 0) > 0.5).length;

      // Vendor recording gap (our books vs Zoho), biggest first.
      const vgaps = (vendor || []).filter(v => Math.abs(Number(v.diff) || 0) > 1)
        .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
      const vgapTotal = vgaps.reduce((s, v) => s + Math.abs(Number(v.diff) || 0), 0);

      setD({
        stopList, stopTotal,
        anomalyCount: watch?.totals?.anomalyCount || 0,
        totalDebt:    watch?.totals?.totalDebt || 0,
        codOut, codN,
        held, trN, trUploadedAt: treasury.uploadedAt,
        vgaps, vgapTotal,
      });
    } catch (e) { toast(`فشل التحميل: ${e.message}`, 'error'); }
    setLoading(false);
  }, []);

  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh]);

  return (
    <div style={{ padding: '28px 32px 80px', maxWidth: 1120, margin: '0 auto' }}>
      <PageHeader
        icon={<Gauge size={22}/>}
        title="لوحة القرارات"
        subtitle="شاشة الصباح — كل ما يحتاج قراراً اليوم، مجموعاً في مكان واحد"
        actions={<Btn size="sm" variant="ghost" onClick={refresh} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''}/></Btn>}
      />

      {!d && loading ? (
        <div style={{ padding: 60, textAlign: 'center' }}><Spinner/></div>
      ) : !d ? null : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(265px, 1fr))', gap: 14 }}>
          <DecisionCard
            color="#DC2626" icon="🛑" title="يُوقَف الآن" value={d.stopList.length} unit="عميل نشط"
            sub={`دينهم ${fmt(d.stopTotal)} ر.س — أوقفهم قبل ما يتراكم`}
            top={d.stopList.slice(0, 3).map(c => `${c.merchant?.storeName || c.name} · ${fmtK(c.total)} ر.س`)}
            cta="فتح المديونيات" onClick={() => navigate('/receivables')}
          />
          <DecisionCard
            color="#D97706" icon="📥" title="COD لم يُحصَّل" value={fmt(d.codOut)} unit="ر.س"
            sub={`موزّع على ${d.codN} ناقل — تابع تحويلهم`}
            cta="تسويات COD" onClick={() => navigate('/money?tab=cod')}
          />
          <DecisionCard
            color="#0EA5E9" icon="💰" title="خزائن COD محتجزة" value={fmt(d.held)} unit="ر.س"
            sub={d.trUploadedAt ? `${d.trN} خزينة — راجع سحب المحاسب` : 'ارفع ميزان المراجعة لتظهر'}
            cta="رقابة الخزائن" onClick={() => navigate('/reconciliation')}
          />
          <DecisionCard
            color="#8B5CF6" icon="🧾" title="فجوة تسجيل Zoho" value={fmt(d.vgapTotal)} unit="ر.س"
            sub={`${d.vgaps.length} ناقل يختلف رصيدهم عن Zoho`}
            top={d.vgaps.slice(0, 3).map(v => `${v.carrierName} · ${fmtK(v.diff)} ر.س`)}
            cta="مطابقة الموردين" onClick={() => navigate('/reconciliation')}
          />
          <DecisionCard
            color="#EF4444" icon="⚠️" title="تنبيهات العملاء" value={d.anomalyCount} unit="عميل"
            sub={`إجمالي المديونيات ${fmt(d.totalDebt)} ر.س`}
            cta="فتح التنبيهات" onClick={() => navigate('/receivables')}
          />
        </div>
      )}
    </div>
  );
}

function DecisionCard({ color, icon, title, value, unit, sub, top, cta, onClick }) {
  return (
    <Card
      onClick={onClick}
      style={{
        cursor: 'pointer', borderTop: `3px solid ${color}`,
        display: 'flex', flexDirection: 'column', gap: 8, minHeight: 150,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{title}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 26, fontWeight: 800, color, fontFamily: 'var(--font-mono)', lineHeight: 1 }}>{value}</span>
        <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{unit}</span>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6 }}>{sub}</div>
      {top && top.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2 }}>
          {top.map((t, i) => (
            <div key={i} style={{ fontSize: 11, color: 'var(--text2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              • {t}
            </div>
          ))}
        </div>
      )}
      <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 4, color, fontSize: 12, fontWeight: 600 }}>
        {cta} <ChevronLeft size={14}/>
      </div>
    </Card>
  );
}

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
import { loadCreditStopList, stopReasonAr } from '../lib/collectionsService.js';
import { loadCarrierNetBalances } from '../lib/codSettlementService.js';
import { loadTreasuryBalances, loadVendorReconciliation } from '../lib/reconciliationService.js';
import { loadCrmDecisionSignals } from '../lib/crmService.js';
import { loadPnlSnapshots, currentPnlPeriod, loadZatcaPending } from '../lib/pnlService.js';
import { loadInvoicesAwaitingReview } from '../lib/webhookService.js';
import { loadLegalDashboard } from '../lib/legalService.js';

const fmt  = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtK = (n) => { const a = Math.abs(n); return a >= 1000 ? (n / 1000).toFixed(1) + 'ك' : String(Math.round(n)); };

export default function DecisionsBoard({ isActive = true }) {
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [watch, codNet, treasury, vendor, crm, pnlSnaps, awaiting, legal, creditStop, zatca] = await Promise.all([
        loadCustomerWatch().catch(() => null),
        loadCarrierNetBalances().catch(() => new Map()),
        loadTreasuryBalances().catch(() => ({ rows: [], uploadedAt: null })),
        loadVendorReconciliation().catch(() => []),
        loadCrmDecisionSignals().catch(() => ({ brokenCount: 0, brokenTotal: 0, dueCount: 0, brokenPromises: [], dueFollowups: [] })),
        loadPnlSnapshots().catch(() => []),
        loadInvoicesAwaitingReview().catch(() => []),
        loadLegalDashboard().catch(() => ({ overdue90: [], prepaidNegative: [], aging: {} })),
        loadCreditStopList().catch(() => null),
        loadZatcaPending().catch(() => ({ todayCount: 0, todayTotal: 0, overdueCount: 0, overdueTotal: 0, invoices: [] })),
      ]);
      // ربح الشهر الجاري من كاش زوهو (§1.19: أي إشارة قرار = بطاقة هنا)
      const pnlCur = (pnlSnaps || []).find(s => s.period === currentPnlPeriod()) || null;

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

      // تحويلات قانونية: تجاوز 90 يوم (زوهو) + دفع مسبق برصيد سالب (المنصّة).
      const over90 = legal.overdue90 || [], negWal = legal.prepaidNegative || [];
      const legalTop = [
        ...over90.slice(0, 2).map(r => `${r.storeName || r.name} · ${fmtK(r.amount90)} · +90ي`),
        ...negWal.slice(0, 1).map(r => `${r.storeName} · ${fmtK(r.wallet)} · محفظة سالبة`),
      ];
      const legalSig = {
        count: over90.length + negWal.length, over90N: over90.length, negN: negWal.length,
        over90Amt: over90.reduce((s, r) => s + (Number(r.amount90) || 0), 0),
        negAmt: negWal.reduce((s, r) => s + Math.abs(Number(r.wallet) || 0), 0),
        top: legalTop,
      };

      setD({
        creditStop: creditStop || { activeCount: 0, activeTotal: 0, count: 0, total: 0, limit: 10000, rows: [] },
        anomalyCount: watch?.totals?.anomalyCount || 0,
        totalDebt:    watch?.totals?.totalDebt || 0,
        codOut, codN,
        held, trN, trUploadedAt: treasury.uploadedAt,
        vgaps, vgapTotal,
        crm,
        pnl: pnlCur,
        awaiting,
        legal: legalSig,
        zatca,
      });
    } catch (e) { toast(`فشل التحميل: ${e.message}`, 'error'); }
    setLoading(false);
  }, []);

  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh]);

  return (
    <div style={{ padding: '22px 28px 70px', maxWidth: 1360, margin: '0 auto' }}>
      <PageHeader
        icon={<Gauge size={22}/>}
        title="لوحة القرارات"
        subtitle="شاشة الصباح — كل ما يحتاج قراراً اليوم، مجموعاً في مكان واحد"
        actions={<Btn size="sm" variant="ghost" onClick={refresh} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''}/></Btn>}
      />

      {!d && loading ? (
        <div style={{ padding: 60, textAlign: 'center' }}><Spinner/></div>
      ) : !d ? null : (() => {
        // البطاقات الصامتة (لا قرار فيها اليوم) تنزل لشريط «تمام» مضغوط —
        // الشاشة تعرض فقط ما يحتاج فعلاً + عدّاد بالأعلى (تحسين 2026-07-02).
        const cards = [
          d.pnl && {
            key: 'pnl', active: true, info: true,
            props: {
              color: Number(d.pnl.net) >= 0 ? 'var(--green)' : 'var(--red)',
              icon: Number(d.pnl.net) >= 0 ? '✅' : '🔻',
              title: 'ربح الشهر (زوهو)',
              value: `${Number(d.pnl.net) >= 0 ? '+' : '−'}${fmt(Math.abs(Number(d.pnl.net)))}`, unit: 'ر.س',
              sub: `قائمة الدخل الرسمية — شهر جارٍ يكبر مع التسجيل${d.pnl.fetched_at ? ` · حتى ${new Date(d.pnl.fetched_at).toLocaleDateString('ar-SA', { month: 'short', day: 'numeric' })}` : ''}`,
              cta: 'الوضع المالي', onClick: () => navigate('/pnl'),
            },
          },
          {
            key: 'zatca', active: (d.zatca?.todayCount || 0) > 0 || (d.zatca?.overdueCount || 0) > 0,
            okLabel: 'كل الفواتير مُرسَلة لزاتكا',
            props: {
              color: 'var(--red)', icon: '🧾', title: 'فواتير لم تُرسَل لزاتكا',
              value: (d.zatca?.todayCount || 0) + (d.zatca?.overdueCount || 0), unit: 'فاتورة معلّقة',
              sub: `اليوم ${d.zatca?.todayCount || 0} (${fmt(d.zatca?.todayTotal || 0)} ر.س) — المهلة منتصف الليل بتوقيت السعودية`
                 + ((d.zatca?.overdueCount || 0) > 0 ? ` · ⚠️ ${d.zatca.overdueCount} متأخرة سابقاً (${fmtK(d.zatca.overdueTotal)})` : ''),
              top: (d.zatca?.invoices || []).slice(0, 3).map(v => `${v.invoice_number} · ${(v.customer || '').slice(0, 20)} · ${fmtK(v.total)}${v.overdue ? ' · متأخرة' : ''}`),
              cta: 'الفواتير', onClick: () => navigate('/zoho-data?tab=invoices'),
            },
          },
          {
            key: 'awaiting', active: (d.awaiting?.length || 0) > 0, okLabel: 'لا فواتير تنتظر مراجعة في الوارد',
            props: {
              color: '#F97316', icon: '🧾', title: 'فواتير تنتظر نظرتك', value: d.awaiting?.length || 0, unit: 'ملف في الوارد',
              sub: `أقدمها منذ ${Math.max(...(d.awaiting || []).map(a => a.ageDays), 0)} يوماً — استوردها أو اعتمدها بنقرة ⚡`,
              top: (d.awaiting || []).slice(0, 3).map(a => `${a.carrierName || a.sender || '؟'} · ${a.fileName || a.subject || ''} · ${a.ageDays}ي`),
              cta: 'فتح الوارد', onClick: () => navigate('/webhook'),
            },
          },
          {
            key: 'stop', active: (d.creditStop?.activeCount || 0) > 0, okLabel: 'لا تاجر تجاوز الحدّ الائتماني',
            props: {
              color: 'var(--red)', icon: '🛑', title: 'تجاوزوا الحدّ الائتماني', value: d.creditStop?.activeCount || 0, unit: 'تاجر نشط',
              sub: `دينهم ${fmt(d.creditStop?.activeTotal || 0)} ر.س فوق حدّ ${fmtK(d.creditStop?.limit || 10000)} — أوقِف شحنهم قبل التراكم`,
              top: (d.creditStop?.rows || []).filter(r => r.active).slice(0, 3)
                .map(r => `${r.storeName || r.customerName} · ${fmtK(r.totalOpen)} ر.س · ${stopReasonAr(r.reason)}`),
              cta: 'قائمة التحصيل', onClick: () => navigate('/crm?tab=collections'),
            },
          },
          {
            key: 'legal', active: (d.legal?.count || 0) > 0, okLabel: 'لا تحويلات قانونية',
            props: {
              color: 'var(--red)', icon: '⚖️', title: 'تحويلات قانونية', value: d.legal?.count || 0, unit: 'حالة',
              sub: `${d.legal?.over90N || 0} تجاوز 90ي (${fmt(d.legal?.over90Amt || 0)} ر.س) · ${d.legal?.negN || 0} محفظة سالبة (${fmt(d.legal?.negAmt || 0)} ر.س) — حوّلهم فوراً`,
              top: d.legal?.top || [],
              cta: 'الصفحة القانونية', onClick: () => navigate('/legal'),
            },
          },
          {
            key: 'cod', active: d.codOut > 0.5, okLabel: 'كل COD محصَّل',
            props: {
              color: '#D97706', icon: '📥', title: 'COD لم يُحصَّل', value: fmt(d.codOut), unit: 'ر.س',
              sub: `موزّع على ${d.codN} ناقل — تابع تحويلهم`,
              cta: 'تسويات COD', onClick: () => navigate('/money?tab=cod'),
            },
          },
          {
            key: 'held', active: d.held > 0.5, okLabel: 'لا خزائن COD محتجزة',
            props: {
              color: '#0EA5E9', icon: '💰', title: 'خزائن COD محتجزة', value: fmt(d.held), unit: 'ر.س',
              sub: d.trUploadedAt ? `${d.trN} خزينة — راجع سحب المحاسب` : 'خزائن COD تحتاج ربط Zoho API',
              cta: 'رقابة الخزائن', onClick: () => navigate('/reconciliation?tab=vendors'),
            },
          },
          {
            key: 'vgap', active: d.vgapTotal > 1, okLabel: 'أرصدة الموردين مطابقة لزوهو',
            props: {
              color: '#8B5CF6', icon: '🧾', title: 'فجوة تسجيل Zoho', value: fmt(d.vgapTotal), unit: 'ر.س',
              sub: `${d.vgaps.length} ناقل يختلف رصيدهم عن Zoho`,
              top: d.vgaps.slice(0, 3).map(v => `${v.carrierName} · ${fmtK(v.diff)} ر.س`),
              cta: 'مطابقة الموردين', onClick: () => navigate('/reconciliation?tab=vendors'),
            },
          },
          {
            key: 'anom', active: d.anomalyCount > 0, okLabel: 'لا تنبيهات عملاء',
            props: {
              color: 'var(--red)', icon: '⚠️', title: 'تنبيهات العملاء', value: d.anomalyCount, unit: 'عميل',
              sub: `إجمالي المديونيات ${fmt(d.totalDebt)} ر.س (الكشف الداخلي)`,
              cta: 'فتح التنبيهات', onClick: () => navigate('/receivables?tab=anomalies'),
            },
          },
          {
            key: 'broken', active: (d.crm?.brokenCount || 0) > 0, okLabel: 'لا وعود مكسورة',
            props: {
              color: 'var(--gold)', icon: '🤝', title: 'وعود مكسورة', value: d.crm?.brokenCount || 0, unit: 'وعد',
              sub: `بقيمة ${fmt(d.crm?.brokenTotal || 0)} ر.س — تجاوزت تاريخها بلا دفع`,
              top: (d.crm?.brokenPromises || []).slice(0, 3).map(p => `${p.entity_ref} · ${fmtK(p.promise_amount)} ر.س`),
              cta: 'فتح المتابعة', onClick: () => navigate('/crm?tab=queue'),
            },
          },
          {
            key: 'due', active: (d.crm?.dueCount || 0) > 0, okLabel: 'لا متابعات مستحقة اليوم',
            props: {
              color: '#06B6D4', icon: '📞', title: 'متابعات مستحقة اليوم', value: d.crm?.dueCount || 0, unit: 'عميل',
              sub: 'موعدهم اليوم أو بلا إجراء تالٍ مجدوَل',
              cta: 'قائمة المتابعة', onClick: () => navigate('/crm?tab=queue'),
            },
          },
        ].filter(Boolean);
        const activeCards = cards.filter(c => c.active);
        const okCards = cards.filter(c => !c.active && c.okLabel);
        const decisionsCount = activeCards.filter(c => !c.info).length;
        return (<>
          {/* عدّاد اليوم */}
          <div style={{ fontSize: 13, marginBottom: 14, fontWeight: 700,
            color: decisionsCount ? 'var(--text)' : 'var(--green)' }}>
            {decisionsCount
              ? `🔔 ${decisionsCount} إشارة تحتاج قرارك اليوم`
              : '✨ لا قرارات معلّقة اليوم — كل الإشارات هادئة'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(295px, 1fr))', gap: 12 }}>
            {activeCards.map(c => <DecisionCard key={c.key} {...c.props}/>)}
          </div>
          {/* الإشارات الهادئة — سطر مضغوط بدل بطاقات صفرية تشتّت */}
          {okCards.length > 0 && (
            <div style={{
              marginTop: 16, padding: '10px 14px', borderRadius: 12, fontSize: 12,
              background: 'color-mix(in srgb, var(--green) 6%, transparent)',
              border: '1px solid color-mix(in srgb, var(--green) 25%, transparent)',
              color: 'var(--green2)', display: 'flex', flexWrap: 'wrap', gap: '6px 16px',
            }}>
              {okCards.map(c => <span key={c.key}>✓ {c.okLabel}</span>)}
            </div>
          )}
        </>);
      })()}
    </div>
  );
}

function DecisionCard({ color, icon, title, value, unit, sub, top, cta, onClick }) {
  // مضغوطة (شكوى «الهوامش عالية»): حشوة أخف، قيمة 22، رأس بسطر واحد —
  // 3-4 بطاقات في الصف على الشاشات العريضة بدل عمود فارغ.
  return (
    <Card
      onClick={onClick}
      style={{
        cursor: 'pointer', borderTop: `3px solid ${color}`, padding: '14px 16px',
        display: 'flex', flexDirection: 'column', gap: 6, minHeight: 118,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ fontSize: 16 }}>{icon}</span>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>{title}</span>
        <span style={{ marginInlineStart: 'auto', display: 'flex', alignItems: 'center', gap: 3, color, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
          {cta} <ChevronLeft size={12}/>
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 22, fontWeight: 800, color, fontFamily: 'var(--font-mono)', lineHeight: 1 }}>{value}</span>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{unit}</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.55 }}>{sub}</div>
      {top && top.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {top.map((t, i) => (
            <div key={i} style={{ fontSize: 10.5, color: 'var(--text2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              • {t}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

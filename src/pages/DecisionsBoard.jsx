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
import { useAuth } from '../lib/auth.jsx';
import { loadCustomerWatch } from '../lib/customer360Service.js';
import { loadCreditStopList, stopReasonAr } from '../lib/collectionsService.js';
import { loadCarrierNetBalances } from '../lib/codSettlementService.js';
import { loadTreasuryBalances, loadVendorReconciliation } from '../lib/reconciliationService.js';
import { loadCrmDecisionSignals } from '../lib/crmService.js';
import { loadPnlSnapshots, currentPnlPeriod, loadZatcaPending } from '../lib/pnlService.js';
import { loadInvoicesAwaitingReview } from '../lib/webhookService.js';
import { loadLegalDashboard } from '../lib/legalService.js';
import { loadIntegrityChecks } from '../lib/integrityService.js';
import { loadClaims, summarizeClaims } from '../lib/claimsService.js';
import { loadHatifCallOps, loadWhatsAppNumberHealth } from '../lib/whatsappService.js';
import { loadSlaBreaches } from '../lib/nextActionsService.js';
import { loadCompanyOperatingPulse } from '../lib/companyOpsService.js';

// تسميات فئات مشاكل المكالمات (متطابقة مع تبويب تحليل المكالمات).
const CALL_PROBLEM_AR = {
  price: 'السعر مرتفع', returns: 'لبس الإرجاع المجاني', delivery: 'تأخّر التوصيل',
  lost: 'شحنات مفقودة', support: 'صعوبة الدعم', billing: 'الفوترة',
  carriers: 'نقص الناقلين', closed: 'إغلاق النشاط', cr_requirement: 'اشتراط السجل التجاري',
};

const fmt  = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtK = (n) => { const a = Math.abs(n); return a >= 1000 ? (n / 1000).toFixed(1) + 'ك' : String(Math.round(n)); };

export default function DecisionsBoard({ isActive = true }) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(false);
  const [pulse, setPulse] = useState(null);
  const [pulseLoading, setPulseLoading] = useState(false);
  const [pulseError, setPulseError] = useState('');

  const refresh = useCallback(async ({ forcePulse = false } = {}) => {
    setLoading(true);
    setPulseLoading(true);
    setPulseError('');
    // هذا الملخص أخف من بقية لوحة القرارات؛ نعرضه فور اكتماله ولا نحبسه
    // خلف أبطأ استعلام مالي في الصفحة. فشله مستقل ولا يحجب بقية الإشارات.
    loadCompanyOperatingPulse({ force: forcePulse })
      .then(data => {
        setPulse(data);
        setPulseError('');
      })
      .catch(error => setPulseError(error?.message || 'تعذّر تحميل نبض الفرق'))
      .finally(() => setPulseLoading(false));
    try {
      const [watch, codNet, treasury, vendor, crm, pnlSnaps, awaiting, legal, creditStop, zatca, integrity, claims, callOps, waHealth, sla] = await Promise.all([
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
        loadIntegrityChecks().catch(() => null),
        loadClaims().then(summarizeClaims).catch(() => null),
        loadHatifCallOps().catch(() => null),
        loadWhatsAppNumberHealth().catch(() => null),
        loadSlaBreaches().catch(() => null),
      ]);
      // فحص السلامة: أخطر التناقضات (item_count>0) — يجمع «ناقل بلا فاتورة» وiMile…
      const integ = Array.isArray(integrity) ? integrity.filter(c => c.count > 0) : [];
      const integTop = integ.slice(0, 3).map(c => `${c.label} · ${c.count}${c.total > 0.5 ? ` · ${fmtK(c.total)} ر.س` : ''}`);
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
        ...negWal.slice(0, 1).map(r => `${r.storeName} · ${fmtK(r.wallet)} · رصيد محفظة تحت الصفر`),
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
        integ: { count: integ.length, top: integTop,
          total: integ.reduce((s, c) => s + (c.total > 0.5 ? c.total : 0), 0) },
        claims: claims || { open: 0, openTotal: 0, submitted: 0, submittedTotal: 0, recovered: 0, recoveredTotal: 0 },
        callOps: callOps || null,
        waHealth: waHealth || null,
        sla: sla || null,
      });
    } catch (e) { toast(`فشل التحميل: ${e.message}`, 'error'); }
    setLoading(false);
  }, []);

  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh]);

  if (!can('overview.view')) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>🔒 لا صلاحية</div>;

  return (
    <div style={{ padding: '24px 28px 80px', maxWidth: 1320, margin: '0 auto' }}>
      <PageHeader
        icon={<Gauge size={22}/>}
        title="لوحة القرارات"
        subtitle="شاشة الصباح — كل ما يحتاج قراراً اليوم، مجموعاً في مكان واحد"
        actions={<Btn size="sm" variant="ghost" title="تحديث لوحة القرارات" ariaLabel="تحديث لوحة القرارات" onClick={() => refresh({ forcePulse: true })} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''}/></Btn>}
      />

      <OperatingPulse
        pulse={pulse}
        loading={pulseLoading}
        error={pulseError}
        onRetry={() => refresh({ forcePulse: true })}
        navigate={navigate}
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
              sub: `تقرير الأرباح الرسمي — شهر جارٍ يكبر مع التسجيل${d.pnl.fetched_at ? ` · حتى ${new Date(d.pnl.fetched_at).toLocaleDateString('ar-SA', { month: 'short', day: 'numeric' })}` : ''}`,
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
              color: 'var(--gold)', icon: '🧾', title: 'فواتير تنتظر نظرتك', value: d.awaiting?.length || 0, unit: 'ملف في الوارد',
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
              cta: 'قائمة التحصيل', onClick: () => navigate('/customer-money?tab=queue'),
            },
          },
          {
            key: 'legal', active: (d.legal?.count || 0) > 0, okLabel: 'لا تحويلات قانونية',
            props: {
              color: 'var(--red)', icon: '⚖️', title: 'تحويلات قانونية', value: d.legal?.count || 0, unit: 'حالة',
              sub: `${d.legal?.over90N || 0} تجاوز 90ي (${fmt(d.legal?.over90Amt || 0)} ر.س) · ${d.legal?.negN || 0} رصيد محفظة تحت الصفر (${fmt(d.legal?.negAmt || 0)} ر.س) — حوّلهم فوراً`,
              top: d.legal?.top || [],
              cta: 'الصفحة القانونية', onClick: () => navigate('/legal'),
            },
          },
          {
            key: 'sla', active: (d.sla?.total || 0) > 0, okLabel: 'لا متابعة متأخّرة — الفريق منضبط',
            props: {
              color: 'var(--red)', icon: '⏰', title: 'متابعات تجاوزت SLA',
              value: d.sla?.total || 0, unit: 'متابعة متأخّرة',
              sub: `${d.sla?.stale || 0} راكدة (+3 أيام بلا تواصل) · ${d.sla?.overdue || 0} تجاوزت موعدها · أقدمها ${d.sla?.oldestDays || 0} يوماً — الفريق يتجاهل عملاء مُسنَدين`,
              cta: 'خطة المبيعات اليوم', onClick: () => navigate('/retargeting?tab=today'),
            },
          },
          {
            key: 'negCalls', active: (d.callOps?.negative_7d || 0) > 0, okLabel: 'لا مكالمات سلبية تحتاج مراجعة',
            props: {
              color: 'var(--red)', icon: '🎧', title: 'مكالمات سلبية تحتاج مراجعة',
              value: d.callOps?.negative_7d || 0, unit: 'مكالمة (7 أيام)',
              sub: `مشاعرها سلبية${(d.callOps?.negative_prev || 0) > 0 ? ` — كانت ${d.callOps.negative_prev} في الأسبوع السابق` : ''} · اسمع تسجيلها وتدخّل عند اللزوم`,
              cta: 'أداء الفريق', onClick: () => navigate('/whatsapp-settings'),
            },
          },
          {
            key: 'waHealth', active: !!d.waHealth?.at_risk,
            okLabel: 'رقم واتساب بصحّة جيدة',
            props: {
              color: 'var(--red)', icon: '📉', title: 'جودة رقم واتساب في خطر',
              value: `${d.waHealth?.delivered_pct ?? '—'}%`, unit: 'تسليم (14 يوماً)',
              sub: `ردّ ${d.waHealth?.reply_pct ?? '—'}% · أضعف حملة «${(d.waHealth?.worst_campaign || '').slice(0, 24)}» (ردّ ${d.waHealth?.worst_reply_pct ?? '—'}%) — قلّل الباردة وأوقف الأرقام الضعيفة قبل تدهور التصنيف`,
              cta: 'الأثر والحملات', onClick: () => navigate('/whatsapp-settings'),
            },
          },
          {
            key: 'risingProblem', active: !!d.callOps?.rising_category && (d.callOps?.rising_delta || 0) > 0,
            okLabel: 'لا مشكلة مكالمات صاعدة',
            props: {
              color: 'var(--gold)', icon: '🧩', title: 'مشكلة صاعدة في المكالمات',
              value: CALL_PROBLEM_AR[d.callOps?.rising_category] || d.callOps?.rising_category || '—', unit: '',
              sub: `${d.callOps?.rising_now || 0} مكالمة (▲ +${d.callOps?.rising_delta || 0} عن الفترة السابقة) — عالجها قبل ما تكبر`,
              cta: 'تحليل المكالمات', onClick: () => navigate('/whatsapp-settings'),
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
            key: 'held', active: d.held > 0.5, okLabel: 'لا فلوس COD محتجزة في زوهو',
            props: {
              color: 'var(--accent3)', icon: '💰', title: 'فلوس COD محتجزة في زوهو', value: fmt(d.held), unit: 'ر.س',
              sub: d.trUploadedAt ? `${d.trN} خزينة — راجع سحب المحاسب` : 'خزائن COD تحتاج ربط Zoho API',
              cta: 'متابعة المحتجز', onClick: () => navigate('/reconciliation?tab=vendors'),
            },
          },
          {
            key: 'vgap', active: d.vgapTotal > 1, okLabel: 'أرصدة الموردين مطابقة لزوهو',
            props: {
              color: 'var(--accent)', icon: '🧾', title: 'فرق الرصيد بينك وبين زوهو', value: fmt(d.vgapTotal), unit: 'ر.س',
              sub: `${d.vgaps.length} ناقل يختلف رصيدهم عن Zoho`,
              top: d.vgaps.slice(0, 3).map(v => `${v.carrierName} · ${fmtK(v.diff)} ر.س`),
              cta: 'مطابقة الموردين', onClick: () => navigate('/reconciliation?tab=vendors'),
            },
          },
          // بطاقة «تنبيهات العملاء» أُزيلت من شاشة الصباح (2026-07-21): كانت من
          // الكشف الداخلي المجمّد (توقّف 10 يوليو) فنصف عملائها سدّدوا فعلاً —
          // إشارة الدين الحيّة هي بطاقة «الإيقاف الائتماني» (creditStop، زوهو حي).
          // التنبيهات تبقى داخل /receivables موسومةً كالكشف الداخلي.
          {
            key: 'integ', active: (d.integ?.count || 0) > 0, okLabel: 'لا تناقضات بيانات',
            props: {
              color: 'var(--red)', icon: '🩺', title: 'سلامة البيانات', value: d.integ?.count || 0, unit: 'تناقض',
              sub: d.integ?.total > 0.5 ? `بأثر مالي ${fmt(d.integ.total)} ر.س` : 'تناقضات صامتة تحتاج مراجعة',
              top: d.integ?.top || [],
              cta: 'فتح فحص السلامة', onClick: () => navigate('/integrity'),
            },
          },
          {
            key: 'claims', active: (d.claims?.open || 0) + (d.claims?.submitted || 0) > 0, okLabel: 'لا مطالبات مفتوحة',
            props: {
              color: 'var(--gold)', icon: '⚖️', title: 'مطالبات استرداد مفتوحة',
              value: (d.claims?.open || 0) + (d.claims?.submitted || 0), unit: 'مطالبة',
              sub: `مكتشفة ${fmt(d.claims?.openTotal || 0)} · قيد المطالبة ${fmt(d.claims?.submittedTotal || 0)} ر.س — استُرد ${fmt(d.claims?.recoveredTotal || 0)}`,
              cta: 'فتح المطالبات', onClick: () => navigate('/hub?tab=claims'),
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
              color: 'var(--brand)', icon: '📞', title: 'متابعات مستحقة اليوم', value: d.crm?.dueCount || 0, unit: 'عميل',
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

function OperatingPulse({ pulse, loading, error, onRetry, navigate }) {
  const teams = [
    pulse?.sales && {
      key: 'sales', icon: '🎯', title: 'المبيعات', color: 'var(--brand)',
      path: '/retargeting?tab=today', data: pulse.sales,
      thirdLabel: 'متأخر', thirdValue: pulse.sales.overdue,
      detail: `بلا إجراء تالٍ ${pulse.sales.withoutNextAction} · بلا مسؤول ${pulse.sales.unassigned}`,
      warning: pulse.sales.financialHoldConflicts > 0
        ? `${pulse.sales.financialHoldConflicts} متابعة تاريخية على حسابات محجوزة ماليًا`
        : '',
    },
    pulse?.collections && {
      key: 'collections', icon: '💳', title: 'التحصيل', color: 'var(--green)',
      path: '/collections', data: pulse.collections,
      thirdLabel: 'وعود متأخرة', thirdValue: pulse.collections.promiseOverdue,
      detail: `${fmt(pulse.collections.openAmount)} ر.س مفتوحة · بلا مسؤول ${pulse.collections.unassigned}`,
      warning: pulse.collections.snoozeExpired > 0
        ? `${pulse.collections.snoozeExpired} تأجيل انتهى ويحتاج عودة للعمل`
        : '',
    },
    pulse?.support && {
      key: 'support', icon: '🎧', title: 'خدمة العملاء', color: 'var(--accent3)',
      path: '/support', data: pulse.support,
      thirdLabel: 'متأخر', thirdValue: pulse.support.overdue,
      detail: `بلا مسؤول ${pulse.support.unassigned} · بلا موعد ${pulse.support.withoutFollowup}`,
      warning: pulse.support.urgent > 0
        ? `${pulse.support.urgent} تذكرة عاجلة`
        : '',
    },
  ].filter(Boolean);

  if (!teams.length && !error && !loading) return null;

  return (
    <section style={{
      marginBottom: 18, padding: 16, borderRadius: 16,
      border: '1px solid color-mix(in srgb, var(--brand) 18%, var(--border))',
      background: 'color-mix(in srgb, var(--brand) 4%, var(--card))',
    }} aria-label="نبض تشغيل الفرق">
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>نبض تشغيل الفرق</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
            ملخص إداري من قوائم الفرق الأصلية — لا ينشئ طابورًا موازيًا ولا يحوّل المخزون كله إلى عمل اليوم.
          </div>
        </div>
        {pulse?.generatedAt && (
          <span style={{ fontSize: 10.5, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
            حُسب {new Date(pulse.generatedAt).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      {error ? (
        <div className="data-load-error" style={{ margin: 0 }}>
          <span>تعذّر تحميل نبض الفرق، وبقية لوحة القرارات ما زالت تعمل.</span>
          <Btn size="sm" variant="ghost" onClick={onRetry}>إعادة المحاولة</Btn>
        </div>
      ) : loading && !teams.length ? (
        <div style={{ padding: 18, textAlign: 'center' }}><Spinner/></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(245px, 1fr))', gap: 10 }}>
          {teams.map(team => (
            <PulseTeamCard key={team.key} {...team} onClick={() => navigate(team.path)}/>
          ))}
        </div>
      )}
    </section>
  );
}

function PulseTeamCard({ icon, title, color, data, thirdLabel, thirdValue, detail, warning, onClick }) {
  const scope = data.scope === 'team' ? 'الفريق' : 'مهامي';
  return (
    <div role="button" tabIndex={0} aria-label={`فتح مساحة ${title}`} onClick={onClick}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }} style={{ height: '100%', outlineOffset: 3 }}>
      <Card hover style={{
        cursor: 'pointer', padding: '13px 14px', borderInlineStart: `3px solid ${color}`,
        display: 'flex', flexDirection: 'column', gap: 9, minHeight: 140, height: '100%',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span>{icon}</span>
          <strong style={{ fontSize: 12.5 }}>{title}</strong>
          <span style={{ marginInlineStart: 'auto', fontSize: 10, color: 'var(--muted)' }}>{scope}</span>
          <ChevronLeft size={13} style={{ color }}/>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          <PulseMetric label="عمل اليوم" value={data.today} color={color}/>
          <PulseMetric label="مخزون" value={data.backlog}/>
          <PulseMetric label={thirdLabel} value={thirdValue} color={thirdValue > 0 ? 'var(--red)' : 'var(--green)'}/>
        </div>
        <div style={{ fontSize: 10.5, lineHeight: 1.5, color: 'var(--muted)' }}>{detail}</div>
        {warning && (
          <div style={{
            fontSize: 10.5, lineHeight: 1.45, color: 'var(--red)', fontWeight: 700,
            padding: '6px 8px', borderRadius: 8,
            background: 'color-mix(in srgb, var(--red) 8%, transparent)',
          }}>⚠ {warning}</div>
        )}
      </Card>
    </div>
  );
}

function PulseMetric({ label, value, color = 'var(--text)' }) {
  return (
    <div style={{ padding: '7px 6px', borderRadius: 9, background: 'var(--surface2)', textAlign: 'center' }}>
      <div style={{ fontSize: 17, fontWeight: 850, lineHeight: 1, color, fontFamily: 'var(--font-mono)' }}>{value || 0}</div>
      <div style={{ fontSize: 9.5, color: 'var(--muted)', marginTop: 5 }}>{label}</div>
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

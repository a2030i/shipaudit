// Company overview service — wraps the four RPCs that power /overview:
//   monthly_financial_snapshot(p_period)       — headline numbers
//   ap_aging_by_carrier()                      — open AP per carrier × age
//   carrier_spend_concentration(p_period)      — top N carriers by spend
//   customer_debt_concentration(p_limit)       — top N customers by debt
//
// loadOverview({ period, prevPeriod }) does a single round-trip with
// all four queries fanned out in parallel + the previous-period
// snapshot for month-over-month deltas. Returns the shape the
// /overview page renders directly — no further client-side
// aggregation needed.

import { supabase } from './supabase.js';
import { carrierScore } from './carrierScore.js';

// 'YYYY-MM' helpers
export const currentPeriod = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
export const prevPeriodOf = (period) => {
  const [y, m] = (period || currentPeriod()).split('-').map(Number);
  const prev = new Date(y, m - 2, 1);  // m is 1-based, subtract 2 then add 1
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
};

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args || {});
  if (error) throw error;
  return data || [];
}

export async function loadOverview({ period = null, topN = 5 } = {}) {
  const thisPeriod = period || currentPeriod();
  const prevPeriod = prevPeriodOf(thisPeriod);

  const { loadCurrentBalance }   = await import('./bankBalanceService.js');
  const { loadCarrierNetBalances } = await import('./codSettlementService.js');
  // الرصيد الختامي لآخر كشف بنكي مرفوع (bank_statement_summaries §1.15) —
  // المصدر التلقائي للرصيد؛ الإدخال اليدوي يبقى للتحديث بين الكشوف.
  const latestClosingQ = supabase.from('bank_statement_summaries')
    .select('period_to, closing_balance, file_name')
    .order('period_to', { ascending: false }).limit(1)
    .then(r => r.data?.[0] || null).catch(() => null);
  const [thisSnapArr, prevSnapArr, aging, carriersAll, customersTop, healthRaw, wcArr, bankBalance, codNet, latestClosing, zohoDash] = await Promise.all([
    rpc('monthly_financial_snapshot', { p_period: thisPeriod }),
    rpc('monthly_financial_snapshot', { p_period: prevPeriod }),
    rpc('ap_aging_by_carrier', {}),
    rpc('carrier_spend_concentration', { p_period: thisPeriod }),
    rpc('customer_debt_concentration', { p_limit: topN }),
    rpc('carrier_health_kpis', {}),
    rpc('working_capital_now', {}),
    loadCurrentBalance().catch(() => null),
    // Company-wide uncollected COD — carriers that collected cash on our
    // behalf and haven't remitted it yet (net = SUM(out) − SUM(in) > 0).
    // Previously only visible per-carrier inside /money; surfaced here.
    loadCarrierNetBalances().catch(() => new Map()),
    latestClosingQ,
    // مرجع دين العملاء = زوهو الحي (فحص وكلاء 2026-07-03: كانت الرئيسية
    // تعرض 314K من snapshot غير مفلتر مقابل 191K في /receivables و250K في
    // زوهو — ثلاثة أرقام لنفس السؤال). فشل الجلب صامت → fallback للـ snapshot.
    supabase.rpc('zoho_invoice_dashboard').then(r => r.data || null).catch(() => null),
  ]);

  const thisSnap = (thisSnapArr[0] || {});
  const prevSnap = (prevSnapArr[0] || {});

  const num = (v) => Number(v) || 0;

  // Month-over-month deltas — percentage change. null when prev is 0
  // (can't divide), surfaced in the UI as "—".
  const delta = (a, b) => {
    const x = num(a), y = num(b);
    if (Math.abs(y) < 0.01) return null;
    return +(((x - y) / Math.abs(y)) * 100).toFixed(1);
  };

  // Aging totals across all carriers
  let apTotal = 0, apCurrent = 0, ap3160 = 0, ap6190 = 0, ap90 = 0;
  for (const r of aging) {
    apTotal   += num(r.total_open);
    apCurrent += num(r.current_amt);
    ap3160    += num(r.d31_60);
    ap6190    += num(r.d61_90);
    ap90      += num(r.d90_plus);
  }

  // Uncollected COD across all carriers — mirrors the /money COD-tab
  // banner: sum the positive per-carrier nets (carrier still owes us)
  // and count how many carriers are due. codNet is a Map<carrierId,net>.
  let codOutstandingTotal = 0, codCarriersDue = 0;
  for (const v of (codNet?.values?.() || [])) {
    const n = num(v);
    if (n > 0.5) { codOutstandingTotal += n; codCarriersDue++; }
  }

  return {
    period:     thisPeriod,
    prevPeriod,
    thisMonth: {
      carrierSpend:  num(thisSnap.carrier_spend_gross),
      carrierPaid:   num(thisSnap.carrier_paid),
      codReceived:   num(thisSnap.cod_received),
      driftTotal:    num(thisSnap.drift_total),
      auditsApproved:num(thisSnap.audits_approved),
      auditsPending: num(thisSnap.audits_pending),
      net:           num(thisSnap.cod_received) - num(thisSnap.carrier_spend_gross),
    },
    prevMonth: {
      carrierSpend:  num(prevSnap.carrier_spend_gross),
      carrierPaid:   num(prevSnap.carrier_paid),
      codReceived:   num(prevSnap.cod_received),
      driftTotal:    num(prevSnap.drift_total),
      auditsApproved:num(prevSnap.audits_approved),
      net:           num(prevSnap.cod_received) - num(prevSnap.carrier_spend_gross),
    },
    deltas: {
      carrierSpend: delta(thisSnap.carrier_spend_gross, prevSnap.carrier_spend_gross),
      codReceived:  delta(thisSnap.cod_received,         prevSnap.cod_received),
      net:          delta(
        num(thisSnap.cod_received) - num(thisSnap.carrier_spend_gross),
        num(prevSnap.cod_received) - num(prevSnap.carrier_spend_gross),
      ),
      auditsApproved: delta(thisSnap.audits_approved, prevSnap.audits_approved),
    },
    codOutstanding: {
      total:       +codOutstandingTotal.toFixed(2),
      carriersDue: codCarriersDue,
    },
    aging: {
      rows:    aging.map(r => ({
        carrierId:  r.carrier_id,
        current:    num(r.current_amt),
        d31_60:     num(r.d31_60),
        d61_90:     num(r.d61_90),
        d90:        num(r.d90_plus),
        total:      num(r.total_open),
        oldestAt:   r.oldest_at,
      })),
      totals: {
        current: +apCurrent.toFixed(2),
        d31_60:  +ap3160.toFixed(2),
        d61_90:  +ap6190.toFixed(2),
        d90:     +ap90.toFixed(2),
        total:   +apTotal.toFixed(2),
      },
    },
    carrierConcentration: carriersAll.slice(0, topN).map(r => ({
      carrierId:    r.carrier_id,
      spend:        num(r.spend),
      sharePct:     num(r.share_pct),
      auditsCount:  num(r.audits_count),
      rank:         num(r.rank_order),
    })),
    // تركّز المديونيات — من زوهو الحي إن توفّر (كان من snapshot غير مفلتر
    // يعرض عملاء «مستبعدين» غير موجودين في /receivables الافتراضي أصلاً)
    customerConcentration: (Array.isArray(zohoDash?.debtors) && zohoDash.debtors.length
      ? zohoDash.debtors.slice(0, topN).map((d, i) => ({
          customerName: d.cust,
          debt:         num(d.owed),
          invoiceCount: num(d.open_cnt),
          sharePct:     num(zohoDash.open_ar) > 0 ? +((num(d.owed) / num(zohoDash.open_ar)) * 100).toFixed(1) : 0,
          rank:         i + 1,
        }))
      : customersTop.map(r => ({
          customerName: r.customer_name,
          debt:         num(r.debt),
          invoiceCount: num(r.invoice_count),
          sharePct:     num(r.share_pct),
          rank:         num(r.rank_order),
        }))),
    arSource: (Array.isArray(zohoDash?.debtors) && zohoDash.debtors.length) ? 'zoho' : 'snapshot',
    // Cash position — the headline question the operator opens
    // /overview to answer: "how much in the bank, how much owed
    // to us, how much we owe, where's the net".
    cashPosition: (() => {
      const wc = wcArr[0] || {};
      // مصدران للرصيد: الختامي التلقائي لآخر كشف مرفوع (موثوق، بتاريخ نهاية
      // فترته) + الإدخال اليدوي (bank_balance_log — للتحديث بين الكشوف).
      // الأحدث تاريخاً يفوز؛ نُظهر المصدر للمستخدم.
      // نفس منطق loadEffectiveBankBalance في bankBalanceService (نقطة الحقيقة
      // المشتركة مع /forecast) — يبقى inline هنا لأن المدخلين مُحمَّلان سلفاً
      // في الـ Promise.all أعلاه. أي تعديل للقاعدة يعدَّل هناك وهنا معاً.
      const manualDate    = bankBalance?.recordedAt ? new Date(bankBalance.recordedAt).getTime() : -1;
      const statementDate = latestClosing?.period_to ? new Date(latestClosing.period_to).getTime() : -1;
      const useStatement  = latestClosing && statementDate >= manualDate;
      const bank = useStatement ? (Number(latestClosing.closing_balance) || 0)
                 : (bankBalance?.balance ?? null);
      // AR من زوهو الحي إن توفّر (نفس رقم «تحصيل العملاء» و/zoho-data) —
      // كان من snapshot غير مفلتر (314K) يخالف /receivables (191K) وزوهو (250K)
      const zohoAr  = Number(zohoDash?.open_ar);
      const arFromZoho = Number.isFinite(zohoAr) && zohoAr > 0;
      const totalAR = arFromZoho ? zohoAr : num(wc.total_ar);
      const totalAP = num(wc.total_ap);
      // COD outstanding from the carriers — money they collected and
      // haven't remitted yet. Read from the AP aging totals doesn't
      // capture this; we use the working-capital RPC which already
      // groups carriers we're net-out (we sent COD they haven't
      // remitted). For now compute later if we need; the simple
      // metric below is: AR + Bank − AP.
      const netNoBank = totalAR - totalAP;
      const net       = bank == null ? null : bank + netNoBank;
      return {
        bankBalance:  bank,
        bankUpdated:  useStatement ? latestClosing.period_to : (bankBalance?.recordedAt || null),
        bankSource:   useStatement ? 'statement' : (bankBalance ? 'manual' : null),
        bankNotes:    useStatement ? `الرصيد الختامي لكشف ${latestClosing.period_to}` : (bankBalance?.notes || null),
        totalAR,                         // owed to us (customers)
        arSource: arFromZoho ? 'zoho' : 'snapshot',
        totalAP,                         // we owe (vendors/carriers)
        netNoBank:    +netNoBank.toFixed(2),
        net:          net != null ? +net.toFixed(2) : null,
      };
    })(),
    workingCapital: (() => {
      const r = wcArr[0] || {};
      return {
        dso:                num(r.dso_days),
        dpo:                num(r.dpo_days),
        ccc:                num(r.ccc_days),
        totalAR:            num(r.total_ar),
        totalAP:            num(r.total_ap),
        customersWithDebt:  num(r.customers_with_debt),
        carriersWithDebt:   num(r.carriers_with_debt),
        topSlowCustomers:   r.top_slow_customers || [],
        topSlowCarriers:    r.top_slow_carriers  || [],
      };
    })(),
    carrierHealth: healthRaw.map(r => {
      const driftPct    = num(r.drift_pct);
      const mismatchPct = num(r.mismatch_pct);
      const firstPass   = num(r.first_pass_rate);
      // الدرجة الموحّدة من carrierScore.js — نفس المعادلة التي تستخدمها
      // بطاقات CarrierKpi، فلا يرى المستخدم درجتين متناقضتين لنفس الناقل.
      const { score } = carrierScore({ driftPct, mismatchPct, firstPassRate: firstPass });
      return {
        carrierId:        r.carrier_id,
        auditsCount:      num(r.audits_count),
        auditsApproved:   num(r.audits_approved),
        driftTotal:       num(r.drift_total),
        totalBilledSum:   num(r.total_billed_sum),
        driftPct,
        mismatchTotal:    num(r.mismatch_total),
        shipmentsTotal:   num(r.shipments_total),
        mismatchPct,
        firstPassRate:    firstPass,
        avgApprovalHours: num(r.avg_approval_hours),
        score,
      };
    }),
  };
}

// Customer 360 service.
//
// Single entry point for the "متابعة العملاء" page. Cross-joins the
// two halves of the operational picture:
//
//   • CRM side  — merchants (stores.xlsx snapshot): name, phone,
//                 billing_type, shipment_count, last_shipment_at,
//                 wallet_balance, created_at_platform, status.
//   • Money side — customer_receivables: total invoiced, aging, oldest
//                 invoice, days outstanding.
//
// The bridge is customer_merchant_links (customer_name → store_id).
//
// What this service returns:
//   {
//     totals:    { activeCustomers, totalDebt, monthlyInvoiced, ... }
//     anomalies: { negative_wallet:[…], prepaid_with_debt:[…], … }
//     top: {
//       byDebt:        [c, c, c, …],
//       byShipments:   [m, m, m, …],
//       byWallet:      [m, m, m, …],
//       newest:        [m, m, m, …],
//       churned:       [m, m, m, …],
//     }
//   }
//
// All ten lists are computed in ONE pass over the joined data — the
// page never has to fan-out to additional queries.

import { loadLatestReceivables } from './customerReceivablesService.js';
import { loadLatestMerchants } from './merchantsService.js';
import { supabase } from './supabase.js';

const DAY = 86_400_000;

export async function loadCustomerWatch() {
  const [receivablesOutcome, merchantsOutcome, zohoOutcome] = await Promise.allSettled([
    loadLatestReceivables(),
    loadLatestMerchants(),
    // «فوترنا شهرياً» من مرآة زوهو الحيّة (كل الفواتير — المدفوعة وغيرها).
    // الـ snapshot الداخلي يحوي المفتوحة فقط فيُظهر 0 للشهر الجاري بعد السداد
    // (شكوى «الصفحات غير مترابطة» 2026-07-03). فشل الجلب صامت — fallback للـ snapshot.
    supabase.rpc('zoho_invoice_dashboard').then(({ data, error }) => {
      if (error) throw error;
      return data;
    }),
  ]);
  if (receivablesOutcome.status === 'rejected') {
    throw new Error(`تعذر قراءة أرصدة العملاء: ${receivablesOutcome.reason?.message || 'خطأ مصدر'}`);
  }
  if (merchantsOutcome.status === 'rejected') {
    throw new Error(`تعذر قراءة دليل المتاجر: ${merchantsOutcome.reason?.message || 'خطأ مصدر'}`);
  }
  const receivablesResult = receivablesOutcome.value;
  const merchantsResult = merchantsOutcome.value;
  if (!merchantsResult?.snapshot || !Array.isArray(merchantsResult.merchants) || merchantsResult.merchants.length === 0) {
    throw new Error('دليل المتاجر غير متاح أو فارغ؛ لا يمكن عرض حالة المتاجر كأنها أصفار.');
  }
  const zohoDash = zohoOutcome.status === 'fulfilled' ? zohoOutcome.value : null;
  const customers = receivablesResult?.activeCustomers || [];
  const merchants = merchantsResult.merchants;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);

  // ── Customer-side derived fields ──────────────────────────────
  // Walk every customer once, classify, compute anomalies, gather
  // monthly invoiced from the invoices list. This is the only place
  // anomaly logic lives — the receivables page should later be
  // re-pointed here to drop duplicate code.
  const anomalies = {
    negative_wallet:    [],
    prepaid_with_debt:  [],
    active_with_debt:   [],
    postpaid_overdue:   [],
    inactive_with_debt: [],
  };

  let totalDebt = 0;
  let monthlyInvoiced = 0;
  let lastMonthInvoiced = 0;
  const debtByCustomer = [];      // for top-by-debt list

  // 12-month time series — keyed by `YYYY-MM`, oldest → newest. Used
  // for the trend AreaChart on the watch page.
  const monthsSeries = [];
  const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  for (let i = 11; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    monthsSeries.push({
      key: monthKey(d),
      label: d.toLocaleDateString('en-GB', { month: 'short' }),
      year: d.getFullYear(),
      value: 0,
      count: 0,
    });
  }
  const seriesByKey = new Map(monthsSeries.map(m => [m.key, m]));

  // PASS 1 — merchant-driven anomalies that don't require receivables debt:
  // a negative prepaid wallet is a technical bug whether or not the
  // merchant currently shows up in the AR snapshot. We loop merchants
  // first so every negative-wallet store is surfaced; if a matching
  // customer record exists in receivables we attach it for context,
  // otherwise we emit a phantom entry with debt=0.
  const customerByStoreId = new Map(
    customers
      .filter(c => c.merchant?.storeId)
      .map(c => [c.merchant.storeId, c]),
  );
  const handledByNegativeWallet = new Set();
  for (const m of merchants) {
    if (m.billing_type !== 'دفع مسبق') continue;
    const w = Number(m.wallet_balance) || 0;
    if (w >= -0.5) continue;
    handledByNegativeWallet.add(m.store_id);
    const c = customerByStoreId.get(m.store_id);
    if (c) {
      anomalies.negative_wallet.push({ ...c, anomaly: 'negative_wallet' });
    } else {
      // Phantom entry — store has neg wallet but no AR row in current
      // snapshot. Still needs investigation as a technical anomaly.
      anomalies.negative_wallet.push({
        name: m.store_name,
        total: 0,
        invoiceCount: 0,
        daysOutstanding: 0,
        merchant: {
          storeId: m.store_id,
          storeName: m.store_name,
          phone: m.phone,
          billingType: m.billing_type,
          platformStatus: m.status,
          shipmentCount: m.shipment_count,
          lastShipmentAt: m.last_shipment_at,
          walletBalance: w,
        },
        anomaly: 'negative_wallet',
      });
    }
  }

  // PASS 2 — customer-driven anomalies (require receivables debt).
  for (const c of customers) {
    const debt = Number(c.total) || 0;
    totalDebt += debt;
    if (debt > 0.5) debtByCustomer.push(c);

    // Sum this-month's invoices for the monthly-invoiced metric +
    // bucket every invoice into the 12-month series for the chart.
    for (const inv of c.invoices || []) {
      if (!inv.date) continue;
      const d = new Date(inv.date);
      const amt = Number(inv.amount) || 0;
      if (d >= monthStart) monthlyInvoiced += amt;
      else if (d >= lastMonthStart && d < monthStart) lastMonthInvoiced += amt;
      const bucket = seriesByKey.get(monthKey(d));
      if (bucket) { bucket.value += amt; bucket.count += 1; }
    }

    const m = c.merchant;
    if (!m) continue;
    // Skip if pass 1 already classified this customer as negative-wallet
    if (m.storeId && handledByNegativeWallet.has(m.storeId)) continue;

    if (m.billingType === 'دفع مسبق' && debt > 0.5) {
      anomalies.prepaid_with_debt.push(c);
      continue;
    }
    if (debt > 0.5 && m.lastShipmentAt) {
      const daysSinceShip = Math.floor((today - new Date(m.lastShipmentAt)) / DAY);
      if (daysSinceShip <= 10) {
        anomalies.active_with_debt.push({ ...c, daysSinceShip });
        continue;
      }
    }
    if (m.billingType === 'دفع لاحق' && (c.daysOutstanding || 0) > 60 && debt > 0.5) {
      anomalies.postpaid_overdue.push(c);
      continue;
    }
    if (m.platformStatus === 'غير نشط' && debt > 0.5) {
      anomalies.inactive_with_debt.push(c);
      continue;
    }
  }

  // ── Merchant-side aggregates ───────────────────────────────────
  let totalWallet = 0;
  let walletPositiveTotal = 0;
  let walletNegativeTotal = 0;
  let activeCount = 0;
  let inactiveCount = 0;
  let newThisMonth = 0;
  let newLast30Days = 0;
  let neverShipped = 0;
  let totalShipments = 0;

  for (const m of merchants) {
    const w = Number(m.wallet_balance) || 0;
    totalWallet += w;
    if (w > 0) walletPositiveTotal += w;
    if (w < 0) walletNegativeTotal += w;

    if (m.status === 'نشط') activeCount++;
    if (m.status === 'غير نشط') inactiveCount++;
    if ((m.shipment_count || 0) === 0) neverShipped++;
    totalShipments += Number(m.shipment_count) || 0;

    if (m.created_at_platform) {
      const created = new Date(m.created_at_platform);
      if (created >= monthStart) newThisMonth++;
      if (today - created <= 30 * DAY) newLast30Days++;
    }
  }

  // ── Top lists ──────────────────────────────────────────────────
  // Ten of each — enough for the page, no more so the table stays
  // scannable. Each list is sorted and sliced in one pass.
  const top = {
    byDebt: debtByCustomer
      .sort((a, b) => (b.total || 0) - (a.total || 0))
      .slice(0, 10),

    byShipments: [...merchants]
      .filter(m => (m.shipment_count || 0) > 0)
      .sort((a, b) => (b.shipment_count || 0) - (a.shipment_count || 0))
      .slice(0, 10),

    byWallet: [...merchants]
      .filter(m => Number(m.wallet_balance || 0) > 0)
      .sort((a, b) => (b.wallet_balance || 0) - (a.wallet_balance || 0))
      .slice(0, 10),

    walletDebtors: [...merchants]
      .filter(m => Number(m.wallet_balance || 0) < -0.5)
      .sort((a, b) => (a.wallet_balance || 0) - (b.wallet_balance || 0))
      .slice(0, 10),

    newest: [...merchants]
      .filter(m => m.created_at_platform)
      .sort((a, b) => new Date(b.created_at_platform) - new Date(a.created_at_platform))
      .slice(0, 10),

    churned: [...merchants]
      .filter(m => m.status === 'غير نشط' && (m.shipment_count || 0) > 0)
      .sort((a, b) => {
        const ta = a.last_shipment_at ? new Date(a.last_shipment_at).getTime() : 0;
        const tb = b.last_shipment_at ? new Date(b.last_shipment_at).getTime() : 0;
        return tb - ta;
      })
      .slice(0, 10),
  };

  // مصدر الحقيقة للفوترة الشهرية = مرآة زوهو (إن توفّرت): تشمل المدفوعة،
  // بينما snapshot المديونيات يحوي المفتوحة فقط (الشهر الجاري يظهر 0 زوراً).
  let invoicedSource = 'snapshot';
  if (Array.isArray(zohoDash?.monthly) && zohoDash.monthly.length) {
    const byYm = new Map(zohoDash.monthly.map(m => [m.ym, m]));
    for (const bucket of monthsSeries) {
      const zm = byYm.get(bucket.key);
      if (zm) { bucket.value = Number(zm.total) || 0; bucket.count = Number(zm.cnt) || 0; }
    }
    const curKey  = monthKey(monthStart);
    const prevKey = monthKey(lastMonthStart);
    monthlyInvoiced    = Number(byYm.get(curKey)?.total)  || 0;
    lastMonthInvoiced  = Number(byYm.get(prevKey)?.total) || 0;
    invoicedSource = 'zoho';
  }

  // Monthly invoicing delta — used by the spotlight's delta pill.
  let monthlyDelta = null;
  if (lastMonthInvoiced > 0) {
    const pct = ((monthlyInvoiced - lastMonthInvoiced) / lastMonthInvoiced) * 100;
    monthlyDelta = +pct.toFixed(1);
  }

  // "اليوم تحتاج" — top 5 prioritised action items. Score each anomaly
  // entry by financial impact + urgency, return the top 5 with the
  // action label the operator should take.
  const allAnoms = [
    ...anomalies.negative_wallet.map(c => ({ c, kind: 'negative_wallet',
      score: Math.abs(c.merchant?.walletBalance || 0) * 5,                 // tech bug, weight 5×
      action: 'افتح تذكرة مع الفريق التقني — رصيد سالب' })),
    ...anomalies.active_with_debt.map(c => ({ c, kind: 'active_with_debt',
      score: (c.total || 0) * 3,                                            // still shipping, weight 3×
      action: 'اتصل اليوم قبل ما يتراكم الدين' })),
    ...anomalies.prepaid_with_debt.map(c => ({ c, kind: 'prepaid_with_debt',
      score: (c.total || 0) * 2,                                            // tech anomaly, weight 2×
      action: 'تحقق من المحفظة — ليه عليه دين وهو دفع مسبق؟' })),
    ...anomalies.postpaid_overdue.map(c => ({ c, kind: 'postpaid_overdue',
      score: (c.total || 0) * (1 + Math.min(1, (c.daysOutstanding || 0) / 180)),
      action: c.daysOutstanding > 90 ? 'مرشّح للإيقاف — أرسل تنبيه نهائي' : 'تنبيه دفع' })),
    ...anomalies.inactive_with_debt.map(c => ({ c, kind: 'inactive_with_debt',
      score: (c.total || 0) * 0.5,
      action: 'حصّل قبل الإغلاق النهائي' })),
  ];
  const todayActions = allAnoms
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  return {
    snapshot: {
      receivables: receivablesResult?.snapshot || null,
      merchants:   merchantsResult?.snapshot || null,
    },
    totals: {
      // Customer-side
      customerCount: customers.length,
      // «عملاء عليهم دين» الحقيقيون (debt>0.5) — customerCount يشمل من دينه
      // صفر بعد السداد/الشطب فكانت الشارة تعدّ 81 بدل الفعليين (فحص وكلاء)
      debtorsCount:  debtByCustomer.length,
      totalDebt:     +totalDebt.toFixed(2),
      monthlyInvoiced:     +monthlyInvoiced.toFixed(2),
      lastMonthInvoiced:   +lastMonthInvoiced.toFixed(2),
      monthlyDelta,
      invoicedSource,       // 'zoho' = من المرآة الحيّة · 'snapshot' = fallback
      // Merchant-side
      merchantsCount: merchants.length,
      activeCount,
      inactiveCount,
      newThisMonth,
      newLast30Days,
      neverShipped,
      totalShipments,
      totalWallet:         +totalWallet.toFixed(2),
      walletPositiveTotal: +walletPositiveTotal.toFixed(2),
      walletNegativeTotal: +walletNegativeTotal.toFixed(2),
      // Anomalies (counts only)
      anomalyCount:
        anomalies.negative_wallet.length +
        anomalies.prepaid_with_debt.length +
        anomalies.active_with_debt.length +
        anomalies.postpaid_overdue.length +
        anomalies.inactive_with_debt.length,
    },
    anomalies,
    top,
    todayActions,
    monthsSeries,
    customers,
    merchants,
  };
}

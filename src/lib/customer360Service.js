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

const DAY = 86_400_000;

export async function loadCustomerWatch() {
  const [receivablesResult, merchantsResult] = await Promise.all([
    loadLatestReceivables().catch(() => null),
    loadLatestMerchants().catch(() => ({ snapshot: null, merchants: [] })),
  ]);
  const customers = receivablesResult?.activeCustomers || [];
  const merchants = merchantsResult?.merchants || [];

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

  for (const c of customers) {
    const debt = Number(c.total) || 0;
    totalDebt += debt;
    if (debt > 0.5) debtByCustomer.push(c);

    // Sum this-month's invoices for the monthly-invoiced metric.
    for (const inv of c.invoices || []) {
      if (!inv.date) continue;
      const d = new Date(inv.date);
      const amt = Number(inv.amount) || 0;
      if (d >= monthStart) monthlyInvoiced += amt;
      else if (d >= lastMonthStart && d < monthStart) lastMonthInvoiced += amt;
    }

    // Anomaly bucket (mirrors the logic in CustomerReceivables).
    const m = c.merchant;
    if (!m) continue;

    if (m.billingType === 'دفع مسبق' && Number(m.walletBalance || 0) < -0.5) {
      anomalies.negative_wallet.push(c);
      continue;
    }
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

  // Monthly invoicing delta — used by the spotlight's delta pill.
  let monthlyDelta = null;
  if (lastMonthInvoiced > 0) {
    const pct = ((monthlyInvoiced - lastMonthInvoiced) / lastMonthInvoiced) * 100;
    monthlyDelta = +pct.toFixed(1);
  }

  return {
    snapshot: {
      receivables: receivablesResult?.snapshot || null,
      merchants:   merchantsResult?.snapshot || null,
    },
    totals: {
      // Customer-side
      customerCount: customers.length,
      totalDebt:     +totalDebt.toFixed(2),
      monthlyInvoiced:     +monthlyInvoiced.toFixed(2),
      lastMonthInvoiced:   +lastMonthInvoiced.toFixed(2),
      monthlyDelta,
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
    customers,
    merchants,
  };
}

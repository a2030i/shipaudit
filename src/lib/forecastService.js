// Cashflow forecast service.
//
// Turns three existing data sources into one forward-looking view:
//   1. carrier_task_schedules — when do we expect each carrier to
//      remit / invoice / send statements / send weight reports?
//   2. carrier_recent_remittance_avg() — average gross of the last 3
//      COD-in batches per carrier. Used as the amount estimator for
//      every upcoming cod_remittance task.
//   3. carrier_open_balance(c) — how much do we owe each carrier
//      right now? Sums the unpaid AP per carrier so an upcoming
//      "invoice" task carries the right cash-out estimate.
//
// The forecast doesn't try to be precise — it's a directional
// signal. For each upcoming scheduled task in the horizon:
//   cod_remittance  → +avg_amount   (inflow)
//   invoice         → -open_balance (outflow — what we'll owe
//                                     when the new invoice posts)
//   statement       → 0             (informational only)
//   weight_report   → 0             (informational only)
//
// Schedules without enough history (no avg_amount yet) are returned
// with `estimatedAmount=null` so the UI can flag them as "unknown
// amount, needs first remittance".

import { supabase } from './supabase.js';
import { listSchedules, partitionByDueness, TASK_KIND_META } from './tasksService.js';
import { loadOpenBalance }                                    from './carrierStatementsService.js';
import { loadCarrierNetBalances }                             from './codSettlementService.js';

const DAY_MS = 86_400_000;

export async function loadCarrierRemittanceAvg(batches = 3) {
  const { data, error } = await supabase.rpc('carrier_recent_remittance_avg', { p_batches: batches });
  if (error) throw error;
  // Map<carrier_id, { avg, last, lastAt, batchCount }>
  const map = new Map();
  for (const r of (data || [])) {
    map.set(r.carrier_id, {
      avg:         Number(r.avg_amount)  || 0,
      last:        Number(r.last_amount) || 0,
      lastAt:      r.last_at,
      batchCount:  Number(r.batch_count) || 0,
    });
  }
  return map;
}

// Expected customer-collection inflow within the horizon. For every open
// invoice in the latest receivables snapshot we estimate its collection
// date = invoice_date + termsDays (default 30). Invoices whose expected
// date falls inside the horizon are bucketed by day (forecast inflow);
// invoices already past their terms are summed as `overdue` (collectable
// but timing-uncertain — surfaced separately, NOT folded into the running
// balance so we don't overstate near-term cash).
async function loadReceivablesInflow(now, horizonEnd, termsDays = 30) {
  // مرآة زوهو الحيّة (§1.23): كان يقرأ customer_receivables المجمّد منذ 10 يوليو
  // فيعدّ ديون من سدّدوا فعلاً كنقد قابل للتحصيل. الآن الفواتير المفتوحة الحيّة.
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('zoho_invoices')
      .select('date, balance')
      .gt('balance', 0.5)
      .order('zoho_id', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data.map(r => ({ invoice_date: r.date, balance_amount: r.balance })));
    if (data.length < 1000) break;
    from += 1000;
  }

  const byDate = new Map();
  let withinTotal = 0, overdue = 0;
  for (const r of rows) {
    const amt = Number(r.balance_amount) || 0;
    if (amt <= 0 || !r.invoice_date) continue;
    const exp = new Date(new Date(r.invoice_date).getTime() + termsDays * DAY_MS);
    if (exp < now)         { overdue += amt; continue; }   // past terms → uncertain
    if (exp > horizonEnd)  continue;                       // beyond horizon
    const key = exp.toISOString().slice(0, 10);
    byDate.set(key, (byDate.get(key) || 0) + amt);
    withinTotal += amt;
  }
  return { byDate, withinTotal: +withinTotal.toFixed(2), overdue: +overdue.toFixed(2) };
}

// One-shot loader for the whole forecast page. Returns:
//   events:        sorted list of upcoming cash-relevant events
//   inflowTotal:   sum of positive estimates in the horizon
//   outflowTotal:  abs sum of negative estimates in the horizon
//   netInHorizon:  inflowTotal - outflowTotal
//   currentAP:     SUM open balances where we owe (positive side)
//   codInTransit:  SUM(out - in) per carrier, only positive side
//                  (= what carriers still owe us)
//   carrierNames:  Map<id, name> for label lookup
//   horizonDays:   echo of input
//   asOf:          ISO timestamp
//
// All money in SAR.
export async function loadCashflowForecast({ horizonDays = 7, carriers = [] } = {}) {
  const now = new Date();
  const horizonEnd = new Date(now.getTime() + horizonDays * DAY_MS);

  // الرصيد الفعّال الموحّد (كشف-أو-يدوي، الأحدث يفوز) — كان يقرأ اليدوي فقط
  // (فارغ) فيختفي التنبؤ رغم وجود ختامي كشف (فحص وكلاء 2026-07-03)
  const { loadEffectiveBankBalance } = await import('./bankBalanceService.js');
  // Pull the data sources in parallel
  const [schedules, avgMap, codNet, bank] = await Promise.all([
    listSchedules({ activeOnly: true }),
    loadCarrierRemittanceAvg(3),
    loadCarrierNetBalances().catch(() => new Map()),
    loadEffectiveBankBalance().catch(() => null),
  ]);
  const bankBalance = bank?.balance ?? null;

  const carrierNames = new Map((carriers || []).map(c => [c.id, c.name]));

  // For "invoice" estimation we need each carrier's current open
  // balance. Only fetch for carriers that actually have an invoice
  // schedule, otherwise we'd hammer N RPCs for nothing.
  const invoiceCarrierIds = new Set(
    schedules
      .filter(s => s.task_kind === 'invoice')
      .map(s => s.carrier_id)
  );
  const openBalances = new Map();
  await Promise.all([...invoiceCarrierIds].map(async (cid) => {
    try {
      const b = await loadOpenBalance(cid);
      openBalances.set(cid, b.balance);
    } catch { /* ignore — carrier may not have any ops yet */ }
  }));

  // Group schedules by due-state. We forecast only the ones whose
  // dueAt falls inside [now, now+horizon]. Anything overdue is
  // also included (operator expected it earlier — still cash that
  // hasn't moved yet).
  const groups = partitionByDueness(schedules, now);
  const inHorizon = [...groups.overdue, ...groups.dueThisWeek, ...groups.later]
    .filter(s => s._state.dueAt && s._state.dueAt <= horizonEnd);

  const events = [];
  let inflowTotal = 0, outflowTotal = 0;

  for (const s of inHorizon) {
    const meta = TASK_KIND_META[s.task_kind] || {};
    const carrierName = carrierNames.get(s.carrier_id) || s.carrier_id;
    let direction = 'info', amount = 0, source = 'unknown';

    if (s.task_kind === 'cod_remittance') {
      const a = avgMap.get(s.carrier_id);
      if (a && a.avg > 0) {
        direction = 'in';
        amount    = a.avg;
        source    = `متوسط آخر ${a.batchCount} دفعة`;
        inflowTotal += amount;
      } else {
        direction = 'in';
        amount    = null;          // unknown — needs first remittance
        source    = 'بدون تاريخ كافٍ';
      }
    } else if (s.task_kind === 'invoice') {
      const bal = openBalances.get(s.carrier_id);
      if (bal != null && bal > 0.5) {
        direction = 'out';
        amount    = bal;
        source    = 'الرصيد المستحق الحالي';
        outflowTotal += amount;
      } else {
        direction = 'out';
        amount    = null;
        source    = 'لا رصيد مفتوح بعد';
      }
    } else {
      // statement / weight_report — informational, no cash impact
      direction = 'info';
      amount    = 0;
      source    = 'إجراء تشغيلي';
    }

    events.push({
      scheduleId:    s.id,
      carrierId:     s.carrier_id,
      carrierName,
      taskKind:      s.task_kind,
      taskLabel:     meta.label || s.task_kind,
      taskIcon:      meta.icon  || '•',
      taskColor:     meta.color || '#6B7280',
      dueAt:         s._state.dueAt,
      dueDays:       s._state.daysUntilDue,
      isOverdue:     s._state.isOverdue,
      cadence:       s.cadence,
      direction,
      estimatedAmount: amount,
      estimationSource: source,
    });
  }

  // ── Customer receivables expected within the horizon ──────────
  // invoice_date + terms → bucketed inflow events. Folded into the same
  // inflow stream (chart + projected balance). Best-effort.
  const RECEIVABLES_TERMS_DAYS = 30;
  let receivablesOverdue = 0, customerInflow = 0;
  try {
    const rec = await loadReceivablesInflow(now, horizonEnd, RECEIVABLES_TERMS_DAYS);
    receivablesOverdue = rec.overdue;
    customerInflow = rec.withinTotal;
    for (const [dateKey, amt] of rec.byDate) {
      const dueAt = new Date(`${dateKey}T12:00:00`);
      events.push({
        scheduleId: `rec_${dateKey}`,
        carrierId: null,
        carrierName: 'العملاء',
        taskKind: 'customer_collection',
        taskLabel: 'تحصيل عملاء',
        taskIcon: '👥',
        taskColor: '#0EA5E9',
        dueAt,
        dueDays: Math.ceil((dueAt.getTime() - now.getTime()) / DAY_MS),
        isOverdue: false,
        cadence: null,
        direction: 'in',
        estimatedAmount: +amt.toFixed(2),
        estimationSource: `فواتير عملاء مستحقة (شروط ${RECEIVABLES_TERMS_DAYS} يوم)`,
      });
      inflowTotal += amt;
    }
  } catch { /* receivables overlay optional */ }

  // Sort by dueness — overdue first, then by date asc
  events.sort((a, b) => {
    if (a.isOverdue && !b.isOverdue) return -1;
    if (!a.isOverdue && b.isOverdue) return 1;
    return (a.dueAt?.getTime() || 0) - (b.dueAt?.getTime() || 0);
  });

  // Current obligations snapshot — independent of horizon
  let codInTransit = 0;
  for (const v of codNet.values()) if (v > 0) codInTransit += v;

  // ── Daily cashflow timeline + projected bank balance ──────────
  // Bucket every dated, money-bearing event by its due day, then walk
  // forward from the current bank balance to project the running cash
  // position. `minProjected` flags the lowest dip in the horizon (a
  // liquidity warning if it crosses zero).
  const dayMap = new Map();   // 'YYYY-MM-DD' → { inflow, outflow }
  for (const e of events) {
    if (e.estimatedAmount == null || e.direction === 'info' || !e.dueAt) continue;
    const key = e.dueAt.toISOString().slice(0, 10);
    const d = dayMap.get(key) || { inflow: 0, outflow: 0 };
    if (e.direction === 'in')  d.inflow  += e.estimatedAmount;
    else                       d.outflow += e.estimatedAmount;
    dayMap.set(key, d);
  }
  let running = bankBalance ?? 0;
  let minProjected = bankBalance;
  const dailyFlow = [...dayMap.keys()].sort().map((date) => {
    const d = dayMap.get(date);
    const net = d.inflow - d.outflow;
    running += net;
    if (minProjected == null || running < minProjected) minProjected = running;
    return {
      date,
      inflow:  +d.inflow.toFixed(2),
      outflow: +d.outflow.toFixed(2),
      net:     +net.toFixed(2),
      runningBalance: +running.toFixed(2),
    };
  });

  return {
    events,
    inflowTotal:   +inflowTotal.toFixed(2),
    outflowTotal:  +outflowTotal.toFixed(2),
    netInHorizon:  +(inflowTotal - outflowTotal).toFixed(2),
    codInTransit:  +codInTransit.toFixed(2),
    customerInflow,
    receivablesOverdue,
    bankBalance:   bankBalance == null ? null : +bankBalance.toFixed(2),
    projectedBalance: bankBalance == null ? null : +(bankBalance + (inflowTotal - outflowTotal)).toFixed(2),
    minProjected:  minProjected == null ? null : +minProjected.toFixed(2),
    dailyFlow,
    horizonDays,
    asOf:          now.toISOString(),
  };
}

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

  // Pull the four data sources in parallel
  const [schedules, avgMap, codNet] = await Promise.all([
    listSchedules({ activeOnly: true }),
    loadCarrierRemittanceAvg(3),
    loadCarrierNetBalances().catch(() => new Map()),
  ]);

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

  // Sort by dueness — overdue first, then by date asc
  events.sort((a, b) => {
    if (a.isOverdue && !b.isOverdue) return -1;
    if (!a.isOverdue && b.isOverdue) return 1;
    return (a.dueAt?.getTime() || 0) - (b.dueAt?.getTime() || 0);
  });

  // Current obligations snapshot — independent of horizon
  let codInTransit = 0;
  for (const v of codNet.values()) if (v > 0) codInTransit += v;

  return {
    events,
    inflowTotal:   +inflowTotal.toFixed(2),
    outflowTotal:  +outflowTotal.toFixed(2),
    netInHorizon:  +(inflowTotal - outflowTotal).toFixed(2),
    codInTransit:  +codInTransit.toFixed(2),
    horizonDays,
    asOf:          now.toISOString(),
  };
}

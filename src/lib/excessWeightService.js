import { supabase } from './supabase.js';

// ─────────────────────────────────────────────────────────────────────────────
//  AR (excess-weight billing) persistence layer.
//
//  Statuses:  pending → billed → paid     (or → waived from any state)
// ─────────────────────────────────────────────────────────────────────────────

export async function saveExcessShipments(rows, userId) {
  if (!rows?.length) return { inserted: 0 };
  const payload = rows.map(r => ({ ...r, uploaded_by: userId ?? null }));
  const { data, error } = await supabase
    .from('excess_shipments')
    .insert(payload)
    .select('id');
  if (error) throw error;
  return { inserted: data?.length ?? 0 };
}

export async function loadShipments({ status, customerName, limit = 1000 } = {}) {
  let q = supabase.from('excess_shipments')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (status)        q = q.eq('status', status);
  if (customerName)  q = q.eq('customer_name', customerName);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/**
 * Group all non-waived shipments by customer with rolled-up totals + counts.
 */
export async function loadCustomerSummary() {
  const { data, error } = await supabase
    .from('excess_shipments')
    .select('customer_name, excess_weight, amount_due, status, created_at, ship_date')
    .neq('status', 'waived');
  if (error) throw error;

  const map = new Map();
  for (const r of data ?? []) {
    if (!map.has(r.customer_name)) {
      map.set(r.customer_name, {
        customer: r.customer_name,
        shipments: 0,
        totalExcess: 0,
        totalDue: 0,
        pendingDue: 0,
        billedDue: 0,
        paidDue: 0,
        pendingCount: 0,
        billedCount: 0,
        paidCount: 0,
        lastShipDate: null,
      });
    }
    const acc = map.get(r.customer_name);
    acc.shipments  += 1;
    acc.totalExcess += Number(r.excess_weight) || 0;
    acc.totalDue    += Number(r.amount_due)    || 0;
    if (r.status === 'pending') {
      acc.pendingDue   += Number(r.amount_due) || 0;
      acc.pendingCount += 1;
    }
    if (r.status === 'billed') {
      acc.billedDue   += Number(r.amount_due) || 0;
      acc.billedCount += 1;
    }
    if (r.status === 'paid') {
      acc.paidDue   += Number(r.amount_due) || 0;
      acc.paidCount += 1;
    }
    const d = r.ship_date || r.created_at?.slice(0, 10);
    if (d && (!acc.lastShipDate || d > acc.lastShipDate)) acc.lastShipDate = d;
  }
  return [...map.values()].sort((a, b) => (b.pendingDue + b.billedDue) - (a.pendingDue + a.billedDue));
}

export async function loadCustomersAR() {
  const summary = await loadCustomerSummary();
  // Aggregate top-level totals
  const totals = summary.reduce((acc, c) => {
    acc.customers     += 1;
    acc.shipments     += c.shipments;
    acc.totalExcess   += c.totalExcess;
    acc.totalDue      += c.totalDue;
    acc.pendingDue    += c.pendingDue;
    acc.billedDue     += c.billedDue;
    acc.paidDue       += c.paidDue;
    acc.openDue       += c.pendingDue + c.billedDue;
    return acc;
  }, { customers: 0, shipments: 0, totalExcess: 0, totalDue: 0,
       pendingDue: 0, billedDue: 0, paidDue: 0, openDue: 0 });
  return { summary, totals };
}

// ─── Mutations ────────────────────────────────────────────────────────────
export async function setShipmentStatus(ids, patch) {
  if (!ids?.length) return;
  const { error } = await supabase
    .from('excess_shipments').update(patch).in('id', Array.isArray(ids) ? ids : [ids]);
  if (error) throw error;
}

export async function markBilled(ids, ref) {
  return setShipmentStatus(ids, { status: 'billed', notes: ref ? `فاتورة: ${ref}` : null });
}

export async function markPaid(ids, paymentRef) {
  return setShipmentStatus(ids, {
    status: 'paid',
    paid_at: new Date().toISOString(),
    payment_ref: paymentRef || null,
  });
}

export async function markWaived(ids, reason) {
  return setShipmentStatus(ids, { status: 'waived', notes: reason || null });
}

export async function deleteShipments(ids) {
  if (!ids?.length) return;
  const { error } = await supabase.from('excess_shipments').delete().in('id', ids);
  if (error) throw error;
}

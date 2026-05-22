// Collections workflow service.
//
// Operator-facing queue of customer-debt tasks. Each task is one
// (customer × trigger) pair the system thinks deserves attention:
// over the credit limit, aged 30/60/90, prepaid-with-debt, or
// manually created. The unique partial index on the DB enforces
// "one open task per pair" so re-running auto-generation doesn't
// duplicate.
//
// Lifecycle:
//   todo        → contacted → promised → done
//                                     ↘  broken → escalate (back to contacted)
//        ↘ snoozed (auto re-emerges)
//        ↘ cancelled (operator says "not real")
//
// Public API:
//   listTasks({ stage, customer })          → task rows
//   regenerateTasks({ customers })          → creates new tasks for
//     customers that meet criteria but don't already have an open
//     task. Returns counts per trigger.
//   updateTaskStage(id, stage, fields)      → moves through lifecycle
//   recordPromise(id, { amount, date, notes }) → stage='promised'
//   completePromise(id, { honoredAmount })  → stage='done'
//   breakPromise(id)                        → promise_status='broken'
//   snoozeTask(id, untilDate)               → stage='snoozed'
//   createManualTask({ customer, debt, notes }) → for one-offs

import { supabase } from './supabase.js';

const TRIGGER_LABELS = {
  over_credit_limit:  '🛑 تجاوز السقف',
  aged_30:            '🟡 متأخّر 30 يوم',
  aged_60:            '🟠 متأخّر 60 يوم',
  aged_90:            '🔴 متأخّر 90 يوم',
  prepaid_with_debt:  '🚨 دفع مسبق وعليه دين',
  manual:             '✍ يدوي',
};
const STAGE_LABELS = {
  todo:       'جديدة',
  contacted:  'تواصلت',
  promised:   'وعد دفع',
  done:       'مكتملة',
  snoozed:    'مؤجّلة',
  cancelled:  'ملغاة',
};
export { TRIGGER_LABELS, STAGE_LABELS };

export async function listTasks({ stage = null, customer = null, includeDone = false } = {}) {
  let q = supabase.from('collection_tasks').select('*').order('created_at', { ascending: false });
  if (stage)      q = q.eq('stage', stage);
  if (customer)   q = q.eq('customer_name', customer);
  if (!includeDone && !stage) {
    q = q.in('stage', ['todo','contacted','promised','snoozed']);
  }
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

// Auto-generate tasks from the customer list (already enriched with
// total/daysOutstanding/overLimit/creditLimit by
// loadLatestReceivables). Skips customers that already have an open
// task with the same trigger thanks to the partial unique index —
// the upsert returns ON CONFLICT DO NOTHING silently.
export async function regenerateTasks({ customers, userId = null }) {
  if (!Array.isArray(customers)) return { created: 0, byTrigger: {} };
  const today = new Date();
  const candidates = [];
  for (const c of customers) {
    const total = Number(c.total) || 0;
    if (total <= 0.5) continue;
    const days = c.daysOutstanding || 0;
    const triggers = [];
    if (c.overLimit)                triggers.push('over_credit_limit');
    if (days > 90)                  triggers.push('aged_90');
    else if (days > 60)             triggers.push('aged_60');
    else if (days > 30)             triggers.push('aged_30');
    // Prepaid-with-debt — a technical anomaly worth chasing
    if (c.merchant?.billingType === 'دفع مسبق' && total > 0.5) {
      triggers.push('prepaid_with_debt');
    }
    for (const t of triggers) {
      candidates.push({
        customer_name:     c.name,
        trigger:           t,
        debt_at_creation:  +total.toFixed(2),
        credit_limit:      c.creditLimit ?? null,
        days_outstanding:  days,
        assigned_to:       userId,
      });
    }
  }
  if (!candidates.length) return { created: 0, byTrigger: {} };

  // INSERT ... ON CONFLICT DO NOTHING using the partial unique
  // index. We can't use upsert() with a partial index cleanly via
  // PostgREST, so we just attempt insert and swallow conflict
  // errors per chunk. Postgres ignores rows that hit the index.
  const CHUNK = 200;
  let created = 0;
  const byTrigger = {};
  for (let i = 0; i < candidates.length; i += CHUNK) {
    const chunk = candidates.slice(i, i + CHUNK);
    // Use upsert with ignoreDuplicates to skip conflicts cleanly
    const { data, error } = await supabase
      .from('collection_tasks')
      .upsert(chunk, { onConflict: 'customer_name,trigger', ignoreDuplicates: true })
      .select();
    if (error) {
      // Fallback: insert one-by-one and skip conflicts
      for (const row of chunk) {
        const { error: insertError } = await supabase.from('collection_tasks').insert(row);
        if (!insertError) {
          created++;
          byTrigger[row.trigger] = (byTrigger[row.trigger] || 0) + 1;
        }
      }
    } else if (data) {
      for (const r of data) {
        created++;
        byTrigger[r.trigger] = (byTrigger[r.trigger] || 0) + 1;
      }
    }
  }
  return { created, byTrigger };
}

export async function updateTaskStage(id, stage, patch = {}) {
  if (!id || !stage) throw new Error('id + stage مطلوبان');
  const row = {
    stage,
    updated_at: new Date().toISOString(),
    ...patch,
  };
  if (stage === 'done')      { row.done_at = new Date().toISOString(); row.done_by = patch.userId || null; delete row.userId; }
  if (stage !== 'snoozed')   row.snooze_until = null;
  const { data, error } = await supabase
    .from('collection_tasks').update(row).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function recordPromise(id, { amount, date, notes }) {
  if (!amount || !date) throw new Error('مبلغ وتاريخ مطلوبان');
  return updateTaskStage(id, 'promised', {
    promise_amount: Number(amount),
    promise_date:   date,
    promise_status: 'pending',
    notes:          notes?.trim() || undefined,
  });
}

export async function completePromise(id, { honoredAmount, userId = null }) {
  return updateTaskStage(id, 'done', {
    promise_status:  'honored',
    honored_amount:  honoredAmount != null ? Number(honoredAmount) : null,
    userId,
  });
}

export async function breakPromise(id) {
  return updateTaskStage(id, 'contacted', {
    promise_status: 'broken',
  });
}

export async function snoozeTask(id, untilDate) {
  if (!untilDate) throw new Error('تاريخ التأجيل مطلوب');
  return updateTaskStage(id, 'snoozed', {
    snooze_until: new Date(untilDate).toISOString(),
  });
}

export async function cancelTask(id, reason) {
  return updateTaskStage(id, 'cancelled', { notes: reason || null });
}

export async function createManualTask({ customerName, debt, notes, userId = null }) {
  if (!customerName) throw new Error('اسم العميل مطلوب');
  const { data, error } = await supabase
    .from('collection_tasks')
    .insert({
      customer_name:    customerName,
      trigger:          'manual',
      stage:            'todo',
      debt_at_creation: Number(debt) || 0,
      notes:            notes?.trim() || null,
      assigned_to:      userId,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteTask(id) {
  if (!id) throw new Error('id مطلوب');
  const { error } = await supabase.from('collection_tasks').delete().eq('id', id);
  if (error) throw error;
  return { ok: true };
}

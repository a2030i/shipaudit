// التصعيد القانوني — يجمع إشارتين للتحويل الفوري للقانونية:
//  (١) عملاء تجاوزت فواتيرهم 90 يوماً (المصدر: فواتير زوهو المفتوحة).
//  (٢) متاجر «دفع مسبق» برصيد محفظة سالب (المصدر: كشف المنصّة/merchants).
// + إجماليات الأعمار مقابل أهداف ثابتة (31–60 ≤ 50ألف · 61–90 ≤ 25ألف · 91+ = 0).
// كله من RPC واحد legal_escalation_dashboard() يقرأ المرآة المحلية.
import { supabase } from './supabase.js';

const asCase = (r) => ({
  id: r.id,
  sourceKind: r.source_kind,
  sourceKey: r.source_key,
  customerName: r.customer_name,
  storeId: r.store_id || '',
  phone: r.phone || '',
  claimAmount: Number(r.claim_amount) || 0,
  stage: r.stage,
  status: r.status,
  caseNumber: r.case_number || '',
  authority: r.authority || '',
  ownerName: r.owner_name || '',
  openedAt: r.opened_at,
  nextAction: r.next_action || '',
  nextActionAt: r.next_action_at,
  result: r.result || '',
  notes: r.notes || '',
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  events: [],
});

const asEvent = (r) => ({
  id: r.id,
  caseId: r.case_id,
  eventType: r.event_type,
  occurredAt: r.occurred_at,
  title: r.title,
  details: r.details || '',
  outcome: r.outcome || '',
  nextActionAt: r.next_action_at,
  documentName: r.document_name || '',
  documentUrl: r.document_url || '',
  createdAt: r.created_at,
});

export async function loadLegalDashboard() {
  const { data, error } = await supabase.rpc('legal_escalation_dashboard');
  if (error) throw error;
  const d = data || {};
  const a = d.aging || {};
  return {
    aging: {
      b31_60: Number(a.b31_60) || 0, b61_90: Number(a.b61_90) || 0, b90plus: Number(a.b90plus) || 0,
      t31_60: Number(a.target_31_60) || 50000, t61_90: Number(a.target_61_90) || 25000, t90plus: Number(a.target_90plus) || 0,
    },
    overdue90: (Array.isArray(d.overdue90) ? d.overdue90 : []).map(r => ({
      name: r.name, storeName: r.store_name || '', phone: r.phone || '',
      amount90: Number(r.amount_90) || 0, totalOpen: Number(r.total_open) || 0,
      oldestDays: Number(r.oldest_days) || 0, invCnt: Number(r.inv_cnt) || 0,
    })),
    prepaidNegative: (Array.isArray(d.prepaid_negative) ? d.prepaid_negative : []).map(r => ({
      storeId: r.store_id, storeName: r.store_name || '', phone: r.phone || '',
      wallet: Number(r.wallet) || 0, status: r.status || '', lastShipmentAt: r.last_shipment_at || null,
    })),
  };
}

export async function loadLegalCases() {
  const { data: rows, error } = await supabase
    .from('legal_cases')
    .select('*')
    .order('next_action_at', { ascending: true, nullsFirst: false })
    .order('updated_at', { ascending: false });
  if (error) throw error;

  const cases = (rows || []).map(asCase);
  if (!cases.length) return cases;
  const { data: eventRows, error: eventsError } = await supabase
    .from('legal_case_events')
    .select('*')
    .in('case_id', cases.map(c => c.id))
    .order('occurred_at', { ascending: false })
    .order('created_at', { ascending: false });
  if (eventsError) throw eventsError;

  const byCase = new Map();
  for (const row of (eventRows || [])) {
    if (!byCase.has(row.case_id)) byCase.set(row.case_id, []);
    byCase.get(row.case_id).push(asEvent(row));
  }
  return cases.map(c => ({ ...c, events: byCase.get(c.id) || [] }));
}

export async function createLegalCase(input, userId) {
  const payload = {
    source_kind: input.sourceKind,
    source_key: input.sourceKey,
    customer_name: input.customerName,
    store_id: input.storeId || null,
    phone: input.phone || null,
    claim_amount: Number(input.claimAmount) || 0,
    stage: input.stage || 'review',
    status: 'open',
    owner_name: input.ownerName || null,
    next_action: input.nextAction || null,
    next_action_at: input.nextActionAt || null,
    notes: input.notes || null,
    created_by: userId,
  };
  const { data, error } = await supabase.from('legal_cases').insert(payload).select('*').single();
  if (error) throw error;
  return asCase(data);
}

export async function updateLegalCase(caseId, input) {
  const payload = {
    stage: input.stage,
    status: input.status,
    case_number: input.caseNumber || null,
    authority: input.authority || null,
    owner_name: input.ownerName || null,
    next_action: input.nextAction || null,
    next_action_at: input.nextActionAt || null,
    result: input.result || null,
    notes: input.notes || null,
  };
  const { data, error } = await supabase.from('legal_cases').update(payload).eq('id', caseId).select('*').single();
  if (error) throw error;
  return asCase(data);
}

export async function addLegalCaseEvent(caseId, input, userId) {
  const payload = {
    case_id: caseId,
    event_type: input.eventType,
    occurred_at: input.occurredAt || new Date().toISOString(),
    title: input.title,
    details: input.details || null,
    outcome: input.outcome || null,
    next_action_at: input.nextActionAt || null,
    document_name: input.documentName || null,
    document_url: input.documentUrl || null,
    created_by: userId,
  };
  const { data, error } = await supabase.from('legal_case_events').insert(payload).select('*').single();
  if (error) throw error;
  return asEvent(data);
}

const VALID_TIME = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

const event = (row) => {
  const occurredAt = VALID_TIME(row.occurredAt);
  if (!occurredAt) return null;
  return {
    id: String(row.id),
    type: row.type || 'activity',
    group: row.group || 'all',
    occurredAt,
    source: row.source || 'غير محدد',
    actor: row.actor || null,
    title: row.title || 'نشاط',
    outcome: row.outcome || null,
    details: row.details || null,
    amount: row.amount == null ? null : Number(row.amount),
    status: row.status || null,
    detailUrl: row.detailUrl || null,
    sourceAvailability: row.sourceAvailability || 'available',
  };
};

export function normalizeStoreTimeline({
  sales = [], collections = [], interactions = [], payments = [],
  invoices = [], shipments = [], communications = [],
} = {}) {
  const rows = [];

  for (const item of sales || []) rows.push(event({
    id: `sales:${item.id || item.created_at || item.occurred_at}`,
    type: 'sales', group: 'sales', occurredAt: item.created_at || item.occurred_at || item.activity_at,
    source: 'المبيعات', actor: item.owner_name || item.employee_name || item.created_by_name,
    title: item.title || item.activity_type || 'نشاط مبيعات',
    outcome: item.outcome || item.result, details: item.note || item.notes,
    status: item.stage || item.status, detailUrl: item.detail_url,
  }));

  for (const item of collections || []) rows.push(event({
    id: `collection:${item.id}:${item.updated_at || item.created_at}`,
    type: item.promise_date ? 'promise' : 'collection', group: 'collections',
    occurredAt: item.updated_at || item.created_at, source: 'قائمة التحصيل',
    actor: item.assignee_name || item.owner_name, title: item.promise_date ? 'وعد تحصيل' : 'مهمة تحصيل',
    outcome: item.promise_status || item.stage, details: item.notes,
    amount: item.promise_amount ?? item.debt_at_creation, status: item.stage,
    detailUrl: item.customer_name ? `/collections?customer=${encodeURIComponent(item.customer_name)}` : null,
  }));

  for (const item of interactions || []) rows.push(event({
    id: `interaction:${item.id}`, type: item.kind || 'interaction',
    group: item.kind === 'promise_to_pay' ? 'collections' : 'sales',
    occurredAt: item.created_at, source: 'سجل المتابعة الداخلي', actor: item.created_by_name,
    title: item.kind === 'promise_to_pay' ? 'وعد مسجل في المتابعة' : 'متابعة',
    outcome: item.kind, details: item.note, status: item.due_date ? 'scheduled' : null,
  }));

  for (const item of payments || []) rows.push(event({
    id: `payment:${item.id || item.date}`, type: 'payment', group: 'finance', occurredAt: item.date,
    source: item.source || 'Zoho Books', title: 'دفعة عميل', amount: item.amount,
    status: item.status, detailUrl: item.detailUrl,
  }));

  for (const item of invoices || []) rows.push(event({
    id: `invoice:${item.invoice_number || item.id}`, type: 'invoice', group: 'finance',
    occurredAt: item.line_date || item.date, source: 'Zoho Books', title: `فاتورة ${item.invoice_number || ''}`.trim(),
    amount: item.collectible_amount ?? item.balance ?? item.amount, status: item.status,
    details: item.due_date ? `الاستحقاق ${item.due_date}` : null,
  }));

  for (const item of shipments || []) rows.push(event({
    id: `shipment:${item.id || item.awb}`, type: 'shipment', group: 'shipments',
    occurredAt: item.delivered_at || item.pickup_at || item.order_date || item.created_at,
    source: 'شحنات لمحة', title: `شحنة ${item.awb || item.order_no || ''}`.trim(),
    outcome: item.order_status, details: item.carrier_name, amount: item.shipping_cost,
    status: item.order_status,
  }));

  for (const item of communications || []) rows.push(event({
    id: `communication:${item.id || item.occurred_at}:${item.kind}`,
    type: item.kind || 'communication', group: 'communications', occurredAt: item.occurred_at,
    source: item.kind === 'campaign' ? 'WhatsApp' : item.kind === 'ivr' ? 'IVR' : item.kind === 'voice_call' ? 'Hatif' : 'التواصل',
    actor: item.agent_name || null, title: item.title || item.kind || 'تواصل',
    outcome: item.reply_intent || item.result, details: item.detail || item.reply_body,
    status: item.status, detailUrl: item.conversation_id ? `https://app.hatif.io/ar/inbox?conversationId=${encodeURIComponent(item.conversation_id)}` : null,
  }));

  return rows.filter(Boolean).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

export const STORE_TIMELINE_FILTERS = [
  ['all', 'الكل'], ['finance', 'مالية'], ['sales', 'مبيعات'], ['collections', 'تحصيل'],
  ['shipments', 'شحنات'], ['communications', 'تواصل'],
];

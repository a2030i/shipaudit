import { CUSTOMER_CAMPAIGN_BUCKETS } from './customerCampaignBuckets.js';

export const AGING_PAGE_SIZE = 20;
export const AGING_BUCKET_KEYS = Object.freeze(CUSTOMER_CAMPAIGN_BUCKETS.map(bucket => bucket.key));

export function agingEntityKey(customer) {
  const storeId = String(customer?.storeId || '').trim();
  if (storeId) return `store:${storeId}`;
  const zohoId = String(customer?.zohoId || '').trim();
  return zohoId ? `zoho:${zohoId}` : '';
}

export function lineMatchesAging(line, buckets) {
  if (!buckets?.size) return true;
  if (line?.line_kind === 'opening_balance') return buckets.has('opening');
  if (line?.line_kind !== 'invoice') return false;
  const age = Number(line.age_days) || 0;
  return (buckets.has('inv1_15') && age >= 1 && age <= 15)
    || (buckets.has('inv16_30') && age >= 16 && age <= 30)
    || (buckets.has('inv31_60') && age >= 31 && age <= 60)
    || (buckets.has('inv61_90') && age >= 61 && age <= 90)
    || (buckets.has('inv90p') && age > 90);
}

export function summarizeAgingLines(lines = [], buckets = new Set()) {
  const selected = lines.filter(line => lineMatchesAging(line, buckets));
  const invoiceRows = selected.filter(line => line.line_kind === 'invoice');
  const openingRows = selected.filter(line => line.line_kind === 'opening_balance');
  return {
    rows: selected,
    amount: +selected.reduce((sum, line) => sum + (Number(line.collectible_amount) || 0), 0).toFixed(2),
    invoiceCount: invoiceRows.length,
    openingCount: openingRows.length,
    oldestDays: selected.reduce((max, line) => Math.max(max, Number(line.age_days) || 0), 0),
    oldestDueDate: selected.map(line => line.due_date).filter(Boolean).sort()[0] || null,
  };
}

export function indexAgingLines(lines = []) {
  const byZoho = new Map();
  for (const line of lines) {
    const key = String(line.contact_id || '').trim();
    if (!key) continue;
    const current = byZoho.get(key) || [];
    current.push(line);
    byZoho.set(key, current);
  }
  return byZoho;
}

export function nextCollectionAction(task, today = new Date().toLocaleDateString('en-CA')) {
  if (!task) return 'إنشاء مهمة تحصيل';
  if (!task.assigned_to) return 'إسناد لمحصل';
  if (task.stage === 'promised') {
    if (task.promise_date && task.promise_date < today) return 'متابعة وعد متأخر';
    if (task.promise_date === today) return 'تحقق من وعد اليوم';
    return 'متابعة الوعد';
  }
  if (task.stage === 'snoozed') return 'متابعة بعد التأجيل';
  if (task.stage === 'contacted') return 'تسجيل نتيجة التواصل';
  return 'بدء التواصل';
}

export function agingReason(buckets, summary) {
  if (!buckets?.size) return 'لديه مبلغ مستحق قابل للتحصيل';
  const labels = CUSTOMER_CAMPAIGN_BUCKETS
    .filter(bucket => buckets.has(bucket.key))
    .map(bucket => bucket.label);
  const base = labels.length === 1 ? `دخل شريحة ${labels[0]}` : `دخل الشرائح: ${labels.join(' + ')}`;
  return `${base} · ${summary.invoiceCount} فاتورة${summary.openingCount ? ' + رصيد افتتاحي' : ''}`;
}

export function buildAgingRows({ customers = [], lines = [], buckets = new Set(), taskByCustomer = new Map(), assigneeById = new Map(), communicationByPhone = new Map() }) {
  const byZoho = indexAgingLines(lines);
  return customers.flatMap(customer => {
    const zohoId = String(customer.zohoId || '').trim();
    const identityKey = agingEntityKey(customer);
    if (!zohoId || !identityKey) return [];
    const summary = summarizeAgingLines(byZoho.get(zohoId) || [], buckets);
    if (summary.amount <= 0.005) return [];
    const task = taskByCustomer.get(customer.name) || null;
    const comm = communicationByPhone.get(String(customer.phone || '').replace(/\D/g, '')) || null;
    return [{
      customer,
      identityKey,
      task,
      assignee: assigneeById.get(task?.assigned_to) || '',
      summary,
      lastCommunicationAt: comm?.lastSentAt || null,
      nextAction: nextCollectionAction(task),
      reason: agingReason(buckets, summary),
    }];
  });
}

export function evaluateBulkEligibility(rows, action, permissions = {}) {
  return rows.map(row => {
    let reason = '';
    if (!row.identityKey) reason = 'لا توجد هوية متجر أو Zoho ثابتة';
    else if (row.customer.balanceSyncIssue) reason = 'موقوف لمصالحة الرصيد';
    else if (action === 'assign' && !permissions.canAssign) reason = 'لا توجد صلاحية إسناد';
    else if (action === 'assign' && !row.task?.id) reason = 'لا توجد مهمة تحصيل؛ لن ننشئها صامتًا';
    else if (action === 'followup' && !row.task?.id) reason = 'لا توجد مهمة تحصيل مفتوحة';
    else if ((action === 'campaign' || action === 'ivr') && !row.customer.phone) reason = 'لا يوجد رقم تواصل';
    else if (action === 'campaign' && !permissions.canCampaign) reason = 'لا توجد صلاحية حملات';
    else if (action === 'ivr' && !permissions.canIvr) reason = 'لا توجد صلاحية IVR';
    return { ...row, eligible: !reason, exclusionReason: reason || null };
  });
}

export function saveAudienceHandoff(context) {
  const token = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  sessionStorage.setItem(`aging-audience:${token}`, JSON.stringify(context));
  return token;
}

export function readAudienceHandoff(token, { consume = false } = {}) {
  if (!token) return null;
  const key = `aging-audience:${token}`;
  const raw = sessionStorage.getItem(key);
  if (!raw) return null;
  if (consume) sessionStorage.removeItem(key);
  try { return JSON.parse(raw); } catch { return null; }
}

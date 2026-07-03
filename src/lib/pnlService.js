// pnlService — قائمة الدخل من Zoho Books عبر edge function `zoho-sync`.
//
// المصدر الحي: action=pnl_month (يجلب من زوهو، يحلّل، ويخزّن في pnl_snapshots).
// القراءة اليومية من الكاش (pnl_snapshots — صف لكل شهر) فلا نستهلك حصة
// الـAPI إلا عند التحديث الصريح أو غياب الشهر.
//
// القاعدة المحاسبية (من خطة الوكلاء): أرقام الربح من زوهو حصراً —
// «تحصيل COD ليس دخلاً، أمانة التجار تمرّ عبرنا».

import { supabase } from './supabase.js';

export const currentPnlPeriod = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
export const prevPnlPeriod = (p) => {
  const [y, m] = p.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// كل الشهور المخزَّنة، الأحدث أولاً.
export async function loadPnlSnapshots() {
  const { data, error } = await supabase
    .from('pnl_snapshots')
    .select('*')
    .order('period', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// جلب/تحديث شهر من زوهو مباشرة (يكتب الكاش ويرجع الصف).
export async function refreshPnlMonth(period) {
  const { data, error } = await supabase.functions.invoke('zoho-sync', {
    body: { action: 'pnl_month', period },
  });
  if (error) throw new Error(error.message);
  if (!data?.ok) throw new Error(data?.error || 'فشل جلب قائمة الدخل');
  return data.snapshot;
}

// مزامنة الفواتير والدفعات (دلتا) — تتطلب money.pnl (الحارس في الدالة).
export async function syncZohoDocs() {
  const { data, error } = await supabase.functions.invoke('zoho-sync', {
    body: { action: 'sync' },
  });
  if (error) throw new Error(error.message);
  if (!data?.ok) throw new Error(data?.error || 'فشل المزامنة');
  return data;   // { invoices: N, customerpayments: M }
}

// «فوترنا × وحصّلنا ص» لشهر — من مرايا zoho_invoices/zoho_payments.
export async function loadInvoicedVsCollected(period) {
  const from = `${period}-01`;
  const [y, m] = period.split('-').map(Number);
  const to = `${period}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
  const page = async (table, col) => {
    const rows = [];
    let f = 0;
    while (true) {
      const { data, error } = await supabase.from(table)
        .select(`${col}, date`)
        .gte('date', from).lte('date', to)
        .order('zoho_id', { ascending: true })     // ترتيب فريد قبل range (§6)
        .range(f, f + 999);
      if (error) throw error;
      if (!data?.length) break;
      rows.push(...data);
      if (data.length < 1000) break;
      f += 1000;
    }
    return rows;
  };
  // نجلب balance أيضاً — «الباقي» الحقيقي = رصيد فواتير هذا الشهر غير المسدّد
  // (لا invoiced−collected؛ فالدفعات قد تكون لفواتير أشهر سابقة — ملاحظة
  // المستخدم الصحيحة). الرصيد يعكس ما تبقّى فعلاً على فواتير هذا الشهر تحديداً.
  const pageInv = async () => {
    const rows = [];
    let f = 0;
    while (true) {
      const { data, error } = await supabase.from('zoho_invoices')
        .select('total, balance, date')
        .gte('date', from).lte('date', to)
        .order('zoho_id', { ascending: true }).range(f, f + 999);
      if (error) throw error;
      if (!data?.length) break;
      rows.push(...data);
      if (data.length < 1000) break;
      f += 1000;
    }
    return rows;
  };
  const [invs, pays] = await Promise.all([pageInv(), page('zoho_payments', 'amount')]);
  return {
    invoiced:  +invs.reduce((s, r) => s + (Number(r.total) || 0), 0).toFixed(2),
    collected: +pays.reduce((s, r) => s + (Number(r.amount) || 0), 0).toFixed(2),
    // الباقي على فواتير هذا الشهر (رصيدها الفعلي) — لا يتأثر بدفعات أشهر أخرى
    remaining: +invs.reduce((s, r) => s + (Number(r.balance) || 0), 0).toFixed(2),
    invCount: invs.length, payCount: pays.length,
    hasData: invs.length > 0 || pays.length > 0,
  };
}

// إجمالي رصيد العملاء الحالي من زوهو (كل الفواتير المفتوحة) — الرقم الحقيقي
// لمطابقة أرصدة العملاء، مستقلّ عن الشهر.
export async function loadZohoArTotal() {
  const rows = [];
  let f = 0;
  while (true) {
    const { data, error } = await supabase.from('zoho_invoices')
      .select('balance').gt('balance', 0.5)
      .order('zoho_id', { ascending: true }).range(f, f + 999);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
    f += 1000;
  }
  return { total: +rows.reduce((s, r) => s + (Number(r.balance) || 0), 0).toFixed(2), openInvoices: rows.length };
}

// حالة المزامنة (لقرار «هل نزامن تلقائياً؟»)
export async function loadSyncState() {
  const { data } = await supabase.from('zoho_sync_state').select('*');
  return new Map((data || []).map(r => [r.entity, r]));
}

// آخر الأحداث الفورية (webhooks) — للنبض فقط، لا تدخل حساب الربح.
export async function loadZohoEvents(limit = 10) {
  const { data, error } = await supabase.from('zoho_events')
    .select('id, event_type, amount, contact_name, ref_number, occurred_at, received_at')
    .order('received_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return data || [];
}

// سجلات زوهو القابلة للتصفح (صفحة /zoho-data) — مرآة لكل كيان
export const ZOHO_MIRRORS = {
  invoices:        { table: 'zoho_invoices',        label: '🧾 فواتير العملاء',  amount: 'total' },
  payments:        { table: 'zoho_payments',        label: '💰 دفعات العملاء',   amount: 'amount' },
  expenses:        { table: 'zoho_expenses',        label: '📋 المصاريف',        amount: 'total' },
  bills:           { table: 'zoho_bills',           label: '📄 فواتير الموردين', amount: 'total' },
  vendor_payments: { table: 'zoho_vendor_payments', label: '💸 دفعات الموردين',  amount: 'amount' },
  journals:        { table: 'zoho_journals',        label: '📒 القيود اليومية',  amount: 'total' },
};

// آخر يوم في شهر 'YYYY-MM'
const monthEnd = (p) => {
  const [y, m] = p.split('-').map(Number);
  return `${p}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
};

// صفوف مرآة لفترة — paginated بترتيب فريد (قاعدة §6).
// period = شهر واحد · أو نطاق {periodFrom, periodTo} (شهور YYYY-MM شاملة).
export async function loadZohoMirror(type, { period = null, periodFrom = null, periodTo = null } = {}) {
  const cfg = ZOHO_MIRRORS[type];
  if (!cfg) return [];
  const from = periodFrom || period;
  const to   = periodTo   || period;
  const rows = [];
  let f = 0;
  while (true) {
    let q = supabase.from(cfg.table).select('*')
      .order('date', { ascending: false })
      .order('zoho_id', { ascending: true })
      .range(f, f + 999);
    if (from) q = q.gte('date', `${from}-01`);
    if (to)   q = q.lte('date', monthEnd(to));
    const { data, error } = await q;
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000 || rows.length >= 5000) break;
    f += 1000;
  }
  return rows;
}

// لوحة فواتير العملاء: باقٍ غير مدفوع/مسودة/متأخّر شهرياً + أعلى المدينين (RPC خفيف).
export async function loadZohoInvoiceDashboard() {
  const { data, error } = await supabase.rpc('zoho_invoice_dashboard');
  if (error) throw error;
  const d = data || {};
  return {
    openAr:     Number(d.open_ar) || 0,
    openCnt:    Number(d.open_cnt) || 0,
    draftCnt:   Number(d.draft_cnt) || 0,
    draftTotal: Number(d.draft_total) || 0,
    overdueCnt: Number(d.overdue_cnt) || 0,
    overdueAmt: Number(d.overdue_amt) || 0,
    totalCnt:   Number(d.total_cnt) || 0,
    monthly:    Array.isArray(d.monthly) ? d.monthly : [],
    debtors:    Array.isArray(d.debtors) ? d.debtors : [],
  };
}

// حملة تحصيل من فواتير زوهو المتأخرة (status=overdue) — مجمَّعة بالعميل
// مع هاتفه من دليل المتاجر (روابط ثم اسم مطبَّع) وقائمة أرقام الفواتير.
export async function loadZohoOverdueCampaign() {
  const { data, error } = await supabase.rpc('zoho_overdue_campaign');
  if (error) throw error;
  return (data || []).map(r => ({
    customerName: r.customer_name,
    storeName:    r.store_name,
    phone:        r.phone,
    owed:         Number(r.owed) || 0,
    invCount:     Number(r.inv_count) || 0,
    oldest:       r.oldest,
    ageDays:      Number(r.oldest_age_days) || 0,
    invoiceList:  r.invoice_list || '',
  }));
}

// «فلوسي عند العملاء» — مصدر الحقيقة الواحد لشاشة التحصيل (RPC واحد):
// مستحق/متأخر/أعمار/تحصيل شهري + عملاء بهواتفهم وآخر دفعة.
export async function loadCustomerMoneyDashboard() {
  const { data, error } = await supabase.rpc('customer_money_dashboard');
  if (error) throw error;
  const d = data || {};
  return {
    outstanding:    Number(d.outstanding) || 0,
    outstandingCnt: Number(d.outstanding_cnt) || 0,
    overdueAmt:     Number(d.overdue_amt) || 0,
    aging: {
      b0: Number(d.aging?.b0_30) || 0,  b1: Number(d.aging?.b31_60) || 0,
      b2: Number(d.aging?.b61_90) || 0, b3: Number(d.aging?.b90p) || 0,
    },
    collectedThisMonth: Number(d.collected_this_month) || 0,
    collectedPrevMonth: Number(d.collected_prev_month) || 0,
    monthlyCollected: Array.isArray(d.monthly_collected) ? d.monthly_collected : [],
    customers: (Array.isArray(d.customers) ? d.customers : []).map(c => ({
      name: c.name, storeName: c.store_name, phone: c.phone,
      owed: Number(c.owed) || 0, overdue: Number(c.overdue) || 0,
      invCnt: Number(c.inv_cnt) || 0, oldestDays: Number(c.oldest_days) || 0,
      b0: Number(c.b0) || 0, b1: Number(c.b1) || 0, b2: Number(c.b2) || 0, b3: Number(c.b3) || 0,
      lastPaymentDate: c.last_payment_date, lastPaymentAmount: Number(c.last_payment_amount) || 0,
    })),
  };
}

// الفواتير المفتوحة لعميل واحد (drill-down في بطاقة العميل)
export async function loadZohoOpenInvoices(customerName) {
  const { data, error } = await supabase.from('zoho_invoices')
    .select('invoice_number, date, total, balance, status')
    .eq('customer_name', customerName)
    .gt('balance', 0.5)
    .order('date', { ascending: true });
  if (error) throw error;
  return data || [];
}

// عملاء لهم أرصدة دائنة غير مستخدمة يمكن تطبيقها على فواتيرهم لتصفير الدين.
// قراءة فقط من مرآة zoho_contacts — التطبيق الفعلي يتم في زوهو (رابط مباشر).
// orgId + dc لبناء رابط جهة الاتصال في Zoho Books.
export async function loadZohoUnusedCredits() {
  const [{ data, error }, authRes] = await Promise.all([
    supabase.rpc('zoho_customer_unused_credits'),
    supabase.from('zoho_auth').select('org_id, api_domain').eq('id', 1).maybeSingle(),
  ]);
  if (error) throw error;
  // مركز البيانات من api_domain (zohoapis.com → books.zoho.com، .sa → .sa …)
  const dom = authRes?.data?.api_domain || '';
  const dc = /\.sa\b/.test(dom) ? 'sa' : /\.eu\b/.test(dom) ? 'eu' : /\.in\b/.test(dom) ? 'in' : 'com';
  const orgId = authRes?.data?.org_id || '';
  const zohoLink = (id) => orgId
    ? `https://books.zoho.${dc}/app/${orgId}#/contacts/${id}`
    : null;
  const rows = (data || []).map(r => ({
    zohoId:         r.zoho_id,
    name:           r.contact_name,
    outstanding:    Number(r.outstanding) || 0,
    unusedCredit:   Number(r.unused_credit) || 0,
    applicable:     Number(r.applicable) || 0,
    remainingAfter: Number(r.remaining_after) || 0,
    clearsFully:    !!r.clears_fully,
    zohoUrl:        zohoLink(r.zoho_id),
  }));
  return {
    rows,
    totalApplicable: +rows.reduce((s, r) => s + r.applicable, 0).toFixed(2),
    clearsCount:     rows.filter(r => r.clearsFully).length,
  };
}

// رابط موافقة زوهو بالصلاحيات الموسّعة (قراءة كاملة + invoices.UPDATE) —
// لتفعيل «تطبيق الرصيد الدائن». admin فقط. يُفتح في نافذة، والموافقة تعود
// لـ/zoho-callback الذي يستبدل التوكن (force). لا يمسّ التطبيق الداخلي.
export async function getZohoWriteAuthUrl() {
  const { data, error } = await supabase.functions.invoke('zoho-authurl', { body: {} });
  if (error) return { ok: false, error: error.message };
  return data;
}

// خطة تطبيق الأرصدة الدائنة لعميل (قراءة فقط — لا كتابة). ترجع الفواتير
// وأي رصيد يُطبَّق على كلٍّ منها. عبر edge function zoho-apply-credits.
export async function planZohoApplyCredits(contactId) {
  const { data, error } = await supabase.functions.invoke('zoho-apply-credits', {
    body: { action: 'plan', contact_id: contactId },
  });
  if (error) return { ok: false, error: error.message };
  return data;
}
// تنفيذ الخطة فعلياً في زوهو (كتابة — admin + صلاحية invoices.UPDATE).
// العملية الوحيدة: تطبيق رصيد موجود على فاتورة موجودة. لا إنشاء/حذف.
export async function applyZohoCredits(contactId) {
  const { data, error } = await supabase.functions.invoke('zoho-apply-credits', {
    body: { action: 'apply', contact_id: contactId },
  });
  if (error) return { ok: false, error: error.message };
  return data;
}

// تعريب حالات مستندات زوهو (فواتير/فواتير موردين). المفتاح lower-case.
export const ZOHO_STATUS_AR = {
  paid: 'مدفوعة', unpaid: 'غير مدفوعة', overdue: 'متأخرة', draft: 'مسودة',
  sent: 'مُرسَلة', partially_paid: 'مدفوعة جزئياً', void: 'ملغاة', voided: 'ملغاة',
  viewed: 'تمت المشاهدة', open: 'مفتوحة', pending: 'معلّقة', pending_approval: 'بانتظار الاعتماد',
  approved: 'معتمدة', declined: 'مرفوضة', stopped: 'موقوفة', expired: 'منتهية',
  partiallypaid: 'مدفوعة جزئياً', partially_refunded: 'مُستردّة جزئياً',
};
export const zohoStatusAr = (s) => {
  if (!s) return '—';
  return ZOHO_STATUS_AR[String(s).toLowerCase().trim()] || s;
};

// حالة الربط (لبانر «غير مربوط» إن انقطع).
export async function loadZohoStatus() {
  const { data, error } = await supabase.functions.invoke('zoho-sync', {
    body: { action: 'status' },
  });
  if (error) return { connected: false };
  return data || { connected: false };
}

// تجميع ربع سنوي من snapshots المتوفرة. quarterOf('2026-05') = '2026-Q2'
export const quarterOf = (period) => {
  const [y, m] = period.split('-').map(Number);
  return `${y}-Q${Math.ceil(m / 3)}`;
};
export function quarterTotals(snaps) {
  const q = new Map();   // '2026-Q2' → { net, income, months: [] }
  for (const s of snaps || []) {
    const k = quarterOf(s.period);
    if (!q.has(k)) q.set(k, { quarter: k, net: 0, income: 0, months: [] });
    const row = q.get(k);
    row.net += Number(s.net) || 0;
    row.income += Number(s.income) || 0;
    row.months.push(s.period);
  }
  // «مكتمل» = 3 أشهر وليس بينها الشهر الجاري (شهر جارٍ = الربع ما زال يكبر)
  const cur = currentPnlPeriod();
  return [...q.values()]
    .map(r => ({ ...r, net: +r.net.toFixed(2), income: +r.income.toFixed(2),
      complete: r.months.length === 3 && !r.months.includes(cur) }))
    .sort((a, b) => b.quarter.localeCompare(a.quarter));
}

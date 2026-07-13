import { supabase } from './supabase.js';
import { searchAwbAcrossAudits } from './coreService.js';

let merchantSnapshotCache = { id: null, at: 0 };

const now = () => Date.now();
const enc = (v) => encodeURIComponent(String(v ?? '').trim());
const cleanTerm = (v) => String(v ?? '').trim().replace(/[%,]/g, ' ').replace(/\s+/g, ' ');
const digitsOnly = (v) => String(v ?? '').replace(/\D+/g, '');
const money = (v) => Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

function uniqBy(rows, keyFn) {
  const out = [];
  const seen = new Set();
  for (const row of rows || []) {
    const key = keyFn(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

async function latestMerchantSnapshotId() {
  if (merchantSnapshotCache.id && now() - merchantSnapshotCache.at < 5 * 60_000) {
    return merchantSnapshotCache.id;
  }
  const { data, error } = await supabase
    .from('merchants')
    .select('snapshot_id')
    .order('uploaded_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  const id = data?.[0]?.snapshot_id || null;
  merchantSnapshotCache = { id, at: now() };
  return id;
}

async function searchMerchants(term) {
  const q = cleanTerm(term);
  if (q.length < 2) return [];
  const snapshotId = await latestMerchantSnapshotId();
  if (!snapshotId) return [];

  const pattern = `%${q}%`;
  const digits = digitsOnly(q);
  const cols = 'store_id, store_name, phone, status, billing_type, shipment_count, last_shipment_at, wallet_balance';
  const queries = [
    supabase.from('merchants').select(cols).eq('snapshot_id', snapshotId).ilike('store_name', pattern).order('shipment_count', { ascending: false }).limit(6),
    supabase.from('merchants').select(cols).eq('snapshot_id', snapshotId).ilike('store_id', pattern).order('shipment_count', { ascending: false }).limit(6),
  ];
  if (digits.length >= 4) {
    queries.push(
      supabase.from('merchants').select(cols).eq('snapshot_id', snapshotId).ilike('phone', `%${digits}%`).order('shipment_count', { ascending: false }).limit(6),
    );
  }

  const settled = await Promise.allSettled(queries);
  const rows = uniqBy(
    settled.flatMap(r => r.status === 'fulfilled' && !r.value.error ? (r.value.data || []) : []),
    r => r.store_id,
  );

  return rows.slice(0, 8).map(m => {
    const title = m.store_name || m.store_id;
    const parts = [
      m.store_id,
      m.phone,
      m.billing_type,
      m.status,
      Number.isFinite(Number(m.wallet_balance)) ? `محفظة ${money(m.wallet_balance)} ر.س` : null,
    ].filter(Boolean);
    return {
      kind: 'merchant',
      group: 'متجر',
      label: title,
      sub: parts.join(' · '),
      path: `/customer-360?tab=watch&customer=${enc(title)}`,
    };
  });
}

async function searchInvoices(term) {
  const q = cleanTerm(term);
  if (q.length < 2) return [];

  const pattern = `%${q}%`;
  const cols = 'zoho_id, invoice_number, customer_name, date, due_date, status, total, balance';
  const settled = await Promise.allSettled([
    supabase.from('zoho_invoices').select(cols).ilike('invoice_number', pattern).order('date', { ascending: false }).limit(7),
    supabase.from('zoho_invoices').select(cols).ilike('customer_name', pattern).order('date', { ascending: false }).limit(7),
  ]);
  const rows = uniqBy(
    settled.flatMap(r => r.status === 'fulfilled' && !r.value.error ? (r.value.data || []) : []),
    r => r.zoho_id || r.invoice_number,
  );

  return rows.slice(0, 8).map(inv => {
    const key = inv.invoice_number || inv.customer_name || q;
    const parts = [
      inv.customer_name,
      inv.status,
      inv.date,
      `متبقي ${money(inv.balance)} ر.س`,
    ].filter(Boolean);
    return {
      kind: 'invoice',
      group: 'فاتورة زوهو',
      label: inv.invoice_number || 'فاتورة زوهو',
      sub: parts.join(' · '),
      path: `/zoho-data?type=invoices&q=${enc(key)}`,
    };
  });
}

async function searchAwb(term) {
  const q = cleanTerm(term);
  const digits = digitsOnly(q);
  if (q.length < 6 && digits.length < 5) return [];

  const hits = await searchAwbAcrossAudits(q);
  return (hits || []).slice(0, 6).map(hit => {
    const carrier = hit.audit?.carrierName || hit.carrierId || 'ناقل';
    const period = hit.audit?.period || hit.period || '';
    return {
      kind: 'awb',
      group: 'AWB',
      label: hit.awb,
      sub: [carrier, period, hit.shipDate, hit.invoiced ? `${money(hit.invoiced)} ر.س` : null].filter(Boolean).join(' · '),
      path: `/results?audit=${enc(hit.auditId)}&awb=${enc(hit.awb)}`,
    };
  });
}

export async function searchGlobalEntities(term) {
  const q = cleanTerm(term);
  if (q.length < 2) return [];

  const settled = await Promise.allSettled([
    searchMerchants(q),
    searchInvoices(q),
    searchAwb(q),
  ]);

  return settled.flatMap(r => r.status === 'fulfilled' ? r.value : []).slice(0, 24);
}

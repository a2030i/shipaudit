import { supabase } from './supabase.js';
import { searchAwbAcrossAudits } from './coreService.js';
import { zohoStatusAr } from './pnlService.js';

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

function merchantResult(m) {
  const title = m.store_name || m.store_id;
  const parts = [
    m.store_id,
    m.phone,
    m.billing_type,
    m.status,
    Number.isFinite(Number(m.wallet_balance)) ? `محفظة ${money(m.wallet_balance)} ر.س` : null,
  ].filter(Boolean);
  return {
    kind: 'merchant', group: 'متجر', label: title, sub: parts.join(' · '),
    path: `/customer-360?tab=watch&customer=${enc(title)}`,
  };
}

function invoiceResult(inv, fallback = '') {
  const key = inv.invoice_number || inv.customer_name || fallback;
  const parts = [
    inv.customer_name,
    zohoStatusAr(inv.status),
    inv.date,
    `متبقي ${money(inv.balance)} ر.س`,
  ].filter(Boolean);
  return {
    kind: 'invoice', group: 'فاتورة زوهو', label: inv.invoice_number || 'فاتورة زوهو',
    sub: parts.join(' · '), path: `/zoho-data?type=invoices&q=${enc(key)}`,
  };
}

async function searchBusinessEntities(term) {
  const q = cleanTerm(term);
  if (q.length < 2) return [];
  const { data, error } = await supabase.rpc('global_entity_search', { p_term: q, p_limit: 8 });
  if (error) throw error;
  return uniqBy((data || []).map(row => row.entity_kind === 'merchant'
    ? merchantResult(row.payload || {})
    : invoiceResult(row.payload || {}, q)), item => `${item.kind}:${item.path}`);
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
    searchBusinessEntities(q),
    searchAwb(q),
  ]);

  return settled.flatMap(r => r.status === 'fulfilled' ? r.value : []).slice(0, 24);
}

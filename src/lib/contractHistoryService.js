// Contract history — diff + log + load.
//
// API:
//   saveCarrierContractsWithHistory(carrierId, oldContracts, newContracts, userId)
//     → writes one contract_history row per added/updated/deleted contract.
//   loadContractHistory({ carrierId?, contractId?, limit? })
//     → most-recent-first list of changes.
//   loadAllContractsOverview()
//     → flattened view of every active contract across all carriers,
//       shaped for the comparison table.

import { supabase } from './supabase.js';

// Fields we care about diffing on a contract. Anything not in here is
// considered cosmetic and won't generate a history row.
const TRACKED_FIELDS = [
  'label', 'startDate', 'endDate',
  'rss', 'rssFixed', 'rssStartDate', 'rssEndDate',
  'fuelPct', 'fuelBase', 'fuelStartDate', 'fuelEndDate', 'fuelHistory',
  'codFee', 'pricing', 'pricingKey',
  'priceFromContract', 'inboundPassthrough', 'codFeePassthrough',
  'fuelPassthrough', 'deliveryInclusiveVat', 'posFeeOnCod', 'posFeePct',
  'splitPosFeeConfirmed',
  'excessPerKg', 'excessUnit', 'notes',
];

function diffContract(before, after) {
  const fieldsChanged = [];
  const diff = {};
  for (const f of TRACKED_FIELDS) {
    const a = before?.[f];
    const b = after?.[f];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      fieldsChanged.push(f);
      diff[f] = { before: a ?? null, after: b ?? null };
    }
  }
  return { fieldsChanged, diff };
}

// Compare old vs new contracts arrays and write history rows for what
// actually changed. Safe to call even if the contracts are identical
// (becomes a no-op).
export async function saveCarrierContractsWithHistory(carrierId, oldContracts, newContracts, userId) {
  const oldById = new Map((oldContracts || []).map(c => [c.id, c]));
  const newById = new Map((newContracts || []).map(c => [c.id, c]));
  const rows = [];

  // Created
  for (const [id, c] of newById) {
    if (oldById.has(id)) continue;
    rows.push({
      carrier_id:     carrierId,
      contract_id:    id,
      contract_label: c.label || null,
      action:         'created',
      changes:        { after: c },
      fields_changed: TRACKED_FIELDS.filter(f => c[f] !== undefined),
      changed_by:     userId || null,
    });
  }

  // Deleted
  for (const [id, c] of oldById) {
    if (newById.has(id)) continue;
    rows.push({
      carrier_id:     carrierId,
      contract_id:    id,
      contract_label: c.label || null,
      action:         'deleted',
      changes:        { before: c },
      fields_changed: TRACKED_FIELDS.filter(f => c[f] !== undefined),
      changed_by:     userId || null,
    });
  }

  // Updated
  for (const [id, oldC] of oldById) {
    const newC = newById.get(id);
    if (!newC) continue;
    const { fieldsChanged, diff } = diffContract(oldC, newC);
    if (!fieldsChanged.length) continue;
    rows.push({
      carrier_id:     carrierId,
      contract_id:    id,
      contract_label: newC.label || oldC.label || null,
      action:         'updated',
      changes:        { fields: diff },
      fields_changed: fieldsChanged,
      changed_by:     userId || null,
    });
  }

  if (!rows.length) return { ok: true, inserted: 0 };

  const { error } = await supabase.from('contract_history').insert(rows);
  if (error) throw error;
  return { ok: true, inserted: rows.length };
}

export async function loadContractHistory({ carrierId, contractId, limit = 100 } = {}) {
  let q = supabase
    .from('contract_history')
    .select('*')
    .order('changed_at', { ascending: false })
    .limit(limit);
  if (carrierId)  q = q.eq('carrier_id', carrierId);
  if (contractId) q = q.eq('contract_id', contractId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

// Flatten every carrier's contracts into a single rows array shaped for
// the comparison table. Each row = one contract (a carrier with two
// contracts produces two rows).
//
// Each row exposes: carrierId, carrierName, carrierLogo, contractId,
// contractLabel, startDate, endDate, isActive, baseDest, basePriceUpTo,
// basePrice, excessPerKg, fuelPct, rssPct, codFee, destinations[].
function summarizePricing(pricing) {
  const dests = Object.keys(pricing || {});
  // Pick the "primary" destination — KSA first, else first key.
  const primary = pricing?.['Saudi Arabia'] || pricing?.[dests[0]] || null;
  let baseUpTo = null, basePrice = null, excessPerKg = null, excessUnit = null;
  if (Array.isArray(primary)) {
    const base = primary[0];
    const next = primary[1];
    if (base) {
      baseUpTo  = base.upTo ?? null;
      basePrice = base.price ?? null;
    }
    if (next && next.pricePerUnit != null) {
      excessPerKg = next.pricePerUnit;
      excessUnit  = next.unitKg ?? 1;
    }
  } else if (primary?.mode === 'lookup' && Array.isArray(primary.brackets)) {
    const sorted = [...primary.brackets].sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
    if (sorted[0]) {
      baseUpTo  = sorted[0].upTo ?? null;
      basePrice = sorted[0].price ?? null;
    }
    if (primary.excess) {
      excessPerKg = primary.excess.perUnit ?? null;
      excessUnit  = primary.excess.unitKg ?? 0.5;
    }
  }
  return { baseUpTo, basePrice, excessPerKg, excessUnit, dests };
}

export async function loadAllContractsOverview() {
  const { data, error } = await supabase
    .from('carriers')
    .select('id, name, logo, color, contracts, contract_pdf_path')
    .order('name', { ascending: true });
  if (error) throw error;
  const today = new Date().toISOString().slice(0, 10);
  const rows = [];
  for (const c of data || []) {
    for (const ct of (c.contracts || [])) {
      const { baseUpTo, basePrice, excessPerKg, excessUnit, dests } = summarizePricing(ct.pricing);
      const startsOk = !ct.startDate || ct.startDate <= today;
      const endsOk   = !ct.endDate   || ct.endDate   >= today;
      rows.push({
        carrierId:    c.id,
        carrierName:  c.name,
        carrierLogo:  c.logo || '📦',
        carrierColor: c.color || '#2DD4BF',
        contractPdfPath: c.contract_pdf_path || null,
        contractId:   ct.id,
        contractLabel: ct.label || '—',
        startDate:    ct.startDate || null,
        endDate:      ct.endDate || null,
        isActive:     startsOk && endsOk,
        baseUpTo,
        basePrice,
        excessPerKg,
        excessUnit,
        fuelPct:      ct.fuelPct ?? null,
        rssPct:       ct.rss ?? null,
        codFee:       ct.codFee ?? null,
        destinations: dests,
        notes:        ct.notes || '',
      });
    }
  }
  return rows;
}

export function deriveContractReadiness(carriers, today = new Date().toISOString().slice(0, 10)) {
  const knownFileKinds = new Set(['audit_with_cod', 'audit_and_cod_separate', 'audit_only', 'cod_only']);
  return (carriers || []).map(carrier => {
    const contracts = Array.isArray(carrier.contracts) ? carrier.contracts : [];
    const activeContracts = contracts.filter(contract => {
      const startsOk = !contract.startDate || contract.startDate <= today;
      const endsOk = !contract.endDate || contract.endDate >= today;
      return startsOk && endsOk;
    });
    const fileKind = String(carrier.file_signature?.file_kind || '').trim();
    const hasContract = activeContracts.length > 0;
    const hasFileKind = knownFileKinds.has(fileKind);
    const hasOfficialDocument = Boolean(String(carrier.contract_pdf_path || '').trim());
    return {
      carrierId: carrier.id,
      carrierName: carrier.name,
      contractCount: contracts.length,
      activeContractCount: activeContracts.length,
      fileKind: fileKind || null,
      hasContract,
      hasFileKind,
      hasOfficialDocument,
      operationallyConfigured: hasContract && hasFileKind,
    };
  });
}

export async function loadContractReadiness() {
  const { data, error } = await supabase
    .from('carriers')
    .select('id, name, contracts, contract_pdf_path, file_signature')
    .order('name', { ascending: true });
  if (error) throw error;
  return deriveContractReadiness(data || []);
}

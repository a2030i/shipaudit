import { calcTotal } from './pricing.js';
import { getActiveContract } from '../data/carriers.js';

// ─── Smart header-row detection ────────────────────────────────────────────────
// Scans the first 15 rows of a raw 2D array (from sheet_to_json header:1)
// and returns the index of the row most likely to contain column headers.
export function detectHeaderRow(allRows) {
  let bestIdx  = 0;
  let bestScore = -1;

  for (let i = 0; i < Math.min(15, allRows.length); i++) {
    const row     = allRows[i];
    const nextRow = allRows[i + 1];
    if (!row || row.length === 0) continue;

    // Count cells that look like text labels (not numbers, not empty)
    const textCells  = row.filter(v => typeof v === 'string' && String(v).trim().length > 1).length;
    const nonEmpty   = row.filter(v => v !== null && v !== '' && v !== undefined).length;
    // Does the very next row have numeric values? Strong sign this row is a header.
    const nextHasNum = nextRow?.some(v => typeof v === 'number') ?? false;

    let score = textCells * 2;
    if (nextHasNum)    score += 8;   // Next row has numbers → big boost
    if (nonEmpty >= 4) score += 3;   // At least 4 filled cells → more likely a real header

    if (score > bestScore) {
      bestScore = score;
      bestIdx   = i;
    }
  }
  return bestIdx;
}

// Build clean headers from a raw header row (deduplicate, remove nulls)
export function buildHeaders(rawRow) {
  const seen = {};
  return rawRow.map((v, i) => {
    let name = (v !== null && v !== '' && v !== undefined)
      ? String(v).trim()
      : `__COL_${i}`;
    if (seen[name]) { seen[name]++; name = `${name}_${seen[name]}`; }
    else seen[name] = 1;
    return name;
  });
}

// ─── Date parsing ──────────────────────────────────────────────────────────────
export function parseDate(v) {
  if (!v) return '';
  if (typeof v === 'number')
    return new Date(Math.round((v - 25569) * 86400 * 1000)).toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

// ─── Column auto-mapper ────────────────────────────────────────────────────────
// Patterns are tried in order. Specific patterns first, generic fallbacks last.
const COL_PATTERNS = {
  // AWB column — different carriers call it different things. We're
  // specific enough to skip clearly-different columns: "Tracking No."
  // for J&T, "Waybill No." for iMile, "AWB" for Aramex/SMSA. The bare
  // /tracking/i also catches things like "Tracking Number" / "Tracking No".
  awb:             [/awb/i, /airway.?bill/i, /waybill/i, /tracking/i, /رقم.?الشحن/],
  // Ship date — also accept J&T's "Entry time" / "Signing time".
  shipDate:        [/ship.?date/i, /pick.?up.?date/i, /entry.?time/i, /signing.?time/i, /created.?date/i, /closed.?date/i, /billing.?date/i, /تاريخ/, /date/i],
  origin:          [/^origin$/i, /origin.?location/i, /^from$/i, /^from.?country$/i, /^source$/i, /مصدر/i, /^من$/],
  dest:            [/^dest$/i, /destination.?location/i, /destination/i, /^to$/i, /^to.?country$/i, /country/i, /دولة/i, /^الى$/],
  destCity:        [/dest.?city/i, /city/i, /مدين/i],
  // Weight column priority:
  //   • "Settlement weight" — J&T's billed weight (rounded up to next kg)
  //   • "Chargeable weight" — Aramex's billed weight
  //   • Fallback to actual / generic / Arabic
  // We always pick the column the carrier ACTUALLY billed against, since
  // that's what the contract math compares against.
  weight:          [/settlement.?weight/i, /chargeable.?weight/i, /charge.?weight/i, /actual.?weight/i, /وزن/i, /^wt$/i, /weight/i],
  deliveryCharges: [/delivery.?charge/i, /delivery.?fee/i, /shipping.?charge/i, /freight.?charge/i, /base.?charge/i, /رسوم.?الشحن/, /رسوم/i, /توصيل/i],
  // RSS = Remote Shipping Surcharge (Aramex). The literal phrase
  // "Remote Area" appears in iMile/iMile-like files as a Yes/No flag,
  // NOT a fee — keep the broad `/remote/i` pattern OUT to avoid the
  // false match. Per-carrier schemas restrict which fields the mapper
  // even tries to populate.
  rss:             [/^rss$/i, /remote.?(charge|fee|surcharge)/i],
  // "Other Charge" is the canonical Aramex column that bundles either fuel
  // surcharge (ZDOI rows) or the COD service fee (ZDCF rows). The audit
  // engine routes it correctly per row based on Billing Type.
  fuelSurcharge:   [/fuel.?surcharge/i, /fuel/i, /وقود/i, /surcharge/i, /other.?charge/i],
  codAmount:       [/cod.?amount/i, /cash.?on/i],
  // COD service fee — the per-shipment fee carriers charge for handling
  // cash-on-delivery (independent of the COD amount itself). iMile puts
  // this in a dedicated "COD Service Fee" column on the same row as the
  // shipment; Aramex breaks it out on a separate ZDCF billing-type row
  // which the engine routes via fuelSurcharge → codFee inside mapRows.
  codFee:          [/cod.?service.?fee/i, /cod.?service.?charge/i, /cod.?fee/i, /رسوم.?cod/i, /رسوم.?الدفع/i],
  // POS (electronic payment / card-acquiring) — iMile exposes two
  // related columns: "POS Amount" (cash collected via card) and
  // "POS Fee" (carrier's processing fee, usually a fixed percent of
  // POS Amount). We audit the fee against contract.posFeePct.
  posAmount:       [/pos.?amount/i, /مبلغ.?pos/i, /مبلغ.?بطاقة/i],
  posFee:          [/pos.?fee/i, /رسوم.?pos/i, /رسوم.?البطاقة/i],
  // "Tax Amount" — actual VAT line from the carrier file. Reading this
  // verbatim lets validateAuditLink skip the 15% assumption (which is
  // wrong for ZOBI international exports = zero-rated).
  tax:             [/^tax\s*amount$/i, /^tax$/i, /tax.?amount/i, /^vat$/i, /vat\s*amount/i, /^ضريبة$/, /قيمة\s*مضافة/i],
  serviceType:     [/service.?type/i, /نوع.?الخدمة/i, /نوع.?الشحن/i, /^type$/i, /^service$/i],
  billingType:     [/billing.?type/i],
  // J&T uses "Signing status" to flag returns ("Return Sign" vs
  // "Normal Sign"). Surfaced to mapRows so we can skip returns from
  // the audit — they're billed at 0 SAR and would otherwise show as
  // false-positive "favorable" diffs.
  signingStatus:   [/signing.?status/i, /حالة.?التوقيع/i, /^status$/i],
};

// Aramex billing-type codes:
//   ZDOI                  → domestic Saudi shipment (regular shipping)
//   ZIBI, ZOBI            → international shipment
//   ZDCF                  → Cash-on-Delivery service fee (separate invoice
//                            from the regular shipping bill). 5 SAR flat per
//                            shipment + 15% VAT, independent of weight.
//   anything else         → unknown — falls through to the unknown-route branch
// AWB-prefix heuristic (5 = domestic, 3 = international) is used only when
// `Billing Type` is missing / empty.
const DOMESTIC_BILLING_CODES      = new Set(['ZDOI']);
const INTERNATIONAL_BILLING_CODES = new Set(['ZIBI', 'ZOBI']);
const COD_BILLING_CODES           = new Set(['ZDCF']);

function isDomesticShipment(billingType, awb) {
  const bt = String(billingType ?? '').trim().toUpperCase();
  if (DOMESTIC_BILLING_CODES.has(bt)) return true;
  // Any non-empty billing type that isn't an explicit domestic code → not
  // domestic. ZDCF is handled separately as a COD-fee row, not as a shipment.
  if (bt) return false;
  // No billing type → fall back to AWB-prefix heuristic
  return String(awb ?? '').trim()[0] === '5';
}

function isCodFeeRow(billingType) {
  return COD_BILLING_CODES.has(String(billingType ?? '').trim().toUpperCase());
}

// ─── Per-carrier field schemas ───────────────────────────────────────────────
// Each carrier's invoice exposes a different subset of columns. iMile
// has POS-fee fields but no RSS / fuel / billing-type; Aramex has all
// of those except POS; J&T has the minimum set. The UI's
// column-mapping step + the auto-detect column resolver only show
// fields in the carrier's schema, so the user never has to map (and
// later look at) columns that aren't billed.
//
// Order matters: this is the order rendered in Step3 of the wizard.
//
// `core` = fields shown in the mapper UI.
// `required` = subset that must map for the audit to be allowed.
export const CARRIER_FIELDS = {
  aramex: {
    core:     ['awb', 'shipDate', 'dest', 'destCity', 'weight', 'deliveryCharges', 'rss', 'fuelSurcharge', 'codAmount', 'tax', 'serviceType', 'billingType'],
    required: ['weight', 'deliveryCharges'],
  },
  smsa: {
    core:     ['awb', 'shipDate', 'dest', 'weight', 'deliveryCharges', 'rss', 'fuelSurcharge', 'codAmount', 'tax', 'signingStatus'],
    required: ['weight', 'deliveryCharges'],
  },
  jt: {
    // J&T has COD amount + COD service charge on every COD shipment.
    // Origin column is also useful since J&T billing is route-based.
    core:     ['awb', 'shipDate', 'origin', 'dest', 'weight', 'deliveryCharges', 'codAmount', 'codFee', 'tax', 'signingStatus'],
    required: ['weight', 'deliveryCharges'],
  },
  imile: {
    // POS Amount + POS Fee are first-class for iMile (1% card fee
    // every COD-by-card shipment carries). No RSS or fuel.
    core:     ['awb', 'shipDate', 'dest', 'weight', 'deliveryCharges', 'codAmount', 'codFee', 'posAmount', 'posFee', 'tax'],
    required: ['weight', 'deliveryCharges'],
  },
  delivernow: {
    core:     ['awb', 'shipDate', 'dest', 'weight', 'deliveryCharges', 'codAmount', 'codFee', 'tax'],
    required: ['weight', 'deliveryCharges'],
  },
};

// Default schema when the carrier is unknown — show everything.
export const DEFAULT_FIELD_SCHEMA = {
  core: ['awb', 'shipDate', 'dest', 'destCity', 'weight', 'deliveryCharges', 'rss', 'fuelSurcharge', 'codAmount', 'codFee', 'posAmount', 'posFee', 'tax', 'serviceType', 'billingType', 'signingStatus'],
  required: ['weight', 'deliveryCharges'],
};

export function getFieldSchema(carrierId) {
  return CARRIER_FIELDS[carrierId] || DEFAULT_FIELD_SCHEMA;
}

// ─── Carrier identification from file structure ──────────────────────────────
// Each carrier file has a recognisable fingerprint — Aramex puts the
// AWB column right next to "Billing Type" with ZDOI/ZIBI codes; J&T
// has a "Settlement Weight" column and AWBs prefixed JTE; iMile uses
// "Delivery Fee"; SMSA uses an "EX" AWB prefix and "Ship Status".
//
// This walks the carriers list (each carrier's `file_signature` JSONB)
// PLUS a built-in fallback rules table for carriers whose signature
// hasn't been learned yet. Returns the best match + a 0..1 confidence.
//
// Falls back to null when nothing matches — the UI then prompts the
// user to pick manually (and we save the signature for next time).
const BUILT_IN_CARRIER_RULES = [
  {
    id: 'aramex',
    must_headers: [/billing.?type/i],
    awb_pattern: /^\d{8,}$/,
    sample_values: { col: /billing.?type/i, values: /^(ZDOI|ZIBI|ZOBI|ZDCF)/i },
    weight: 1.0,
  },
  {
    id: 'smsa',
    must_headers: [/^awb$/i, /(ship|delivery).?status/i],
    awb_pattern: /^\d{9,}$/,
    weight: 0.9,
  },
  {
    id: 'jt',
    // Real J&T file headers: "Tracking No.", "Settlement weight",
    // "Delivery Charge", "Signing status", "COD service charge".
    // We pick a quartet that's unlikely to appear together elsewhere.
    must_headers: [/tracking.?no/i, /settlement.?weight/i, /signing.?status/i, /cod.?service.?charge/i],
    awb_pattern: /^JTE\d+/i,
    weight: 0.95,
  },
  {
    id: 'imile',
    must_headers: [/delivery.?fee/i, /(tier|tracking)/i],
    awb_pattern: /^[A-Z]{0,4}\d{10,}$/,
    weight: 0.85,
  },
  {
    id: 'delivernow',
    must_headers: [/awb.?no/i, /cod.?amount/i],
    awb_pattern: /^DNL/i,
    weight: 0.85,
  },
];

function matchSignatureFromHeaders(headers, signature) {
  if (!signature?.header_must_contain?.length) return 0;
  const hdrs = headers.map(h => String(h).toLowerCase());
  let matched = 0;
  for (const needle of signature.header_must_contain) {
    const n = String(needle).toLowerCase();
    if (hdrs.some(h => h.includes(n))) matched++;
  }
  return matched / signature.header_must_contain.length;
}

function matchBuiltInRule(headers, rows, rule) {
  let score = 0;
  let max   = 0;

  // Header presence
  if (rule.must_headers) {
    max += rule.must_headers.length;
    for (const re of rule.must_headers) {
      if (headers.some(h => re.test(String(h)))) score++;
    }
  }

  // AWB prefix sample on first few data rows
  if (rule.awb_pattern && rows.length > 0) {
    max += 1;
    // Try to find an AWB column among first 5 rows
    let hits = 0, tries = 0;
    for (let r = 0; r < Math.min(5, rows.length); r++) {
      for (const v of rows[r] || []) {
        if (v == null || v === '') continue;
        tries++;
        if (rule.awb_pattern.test(String(v).trim())) { hits++; break; }
      }
      if (tries === 0) continue;
    }
    if (hits > 0) score += 1;
  }

  // Specific cell-value test (e.g. Aramex's ZDOI/ZIBI in the Billing Type column)
  if (rule.sample_values) {
    max += 1;
    const colIdx = headers.findIndex(h => rule.sample_values.col.test(String(h)));
    if (colIdx >= 0) {
      const hasMatch = rows
        .slice(0, 20)
        .some(r => r && rule.sample_values.values.test(String(r[colIdx] ?? '')));
      if (hasMatch) score += 1;
    }
  }

  if (max === 0) return 0;
  return (score / max) * (rule.weight ?? 1);
}

// Detect which carrier a file belongs to. Returns
//   { carrierId, confidence: 0..1, method: 'signature' | 'builtin' | null,
//     reasons: string[] }
// or null if nothing matched.
export function detectCarrierFromFile(allRows, carriers) {
  if (!allRows?.length || !carriers?.length) return null;
  const hdrIdx  = detectHeaderRow(allRows);
  const headers = buildHeaders(allRows[hdrIdx]);
  const dataRows = allRows.slice(hdrIdx + 1, hdrIdx + 25);

  let best = { carrierId: null, confidence: 0, method: null, reasons: [] };

  // Pass 1: learned signatures
  for (const c of carriers) {
    const sig = c.file_signature || {};
    const conf = matchSignatureFromHeaders(headers, sig);
    if (conf > best.confidence) {
      best = { carrierId: c.id, confidence: conf, method: 'signature', reasons: [`${Math.round(conf*100)}% توافق مع بصمة ${c.name}`] };
    }
  }

  // Pass 2: built-in carrier rules (only relevant for carriers actually in DB)
  const ids = new Set(carriers.map(c => c.id));
  for (const rule of BUILT_IN_CARRIER_RULES) {
    if (!ids.has(rule.id)) continue;
    const conf = matchBuiltInRule(headers, dataRows, rule);
    if (conf > best.confidence) {
      best = {
        carrierId: rule.id,
        confidence: conf,
        method: 'builtin',
        reasons: [`أعمدة ونمط AWB يطابق ${carriers.find(c => c.id === rule.id)?.name || rule.id}`],
      };
    }
  }

  return best.carrierId ? best : null;
}

export function detectColumns(headers, carrierId = null) {
  const schema = carrierId ? getFieldSchema(carrierId) : DEFAULT_FIELD_SCHEMA;
  const allowedFields = new Set(schema.core);
  const map = {};
  const used = new Set();
  // Iterate fields/patterns in declared order so specific patterns win.
  // Skip fields that aren't relevant for this carrier — keeps iMile
  // from grabbing "Remote Area" as RSS, etc.
  for (const [field, patterns] of Object.entries(COL_PATTERNS)) {
    if (carrierId && !allowedFields.has(field)) continue;
    for (const pattern of patterns) {
      const match = headers.find(h => {
        if (used.has(h)) return false;
        const kl = h.toLowerCase().trim();
        return pattern instanceof RegExp ? pattern.test(kl) : kl.includes(pattern);
      });
      if (match) {
        map[field] = match;
        used.add(match);
        break;
      }
    }
  }
  return map;
}

// ─── Country name normalizer ───────────────────────────────────────────────────
const COUNTRY_ALIASES = {
  // Saudi Arabia — domestic / inbound / alternate spellings
  'ksa': 'Saudi Arabia', 'k.s.a': 'Saudi Arabia', 'k.s.a.': 'Saudi Arabia',
  'sa': 'Saudi Arabia', 'saudi': 'Saudi Arabia',
  'المملكة العربية السعودية': 'Saudi Arabia', 'المملكة': 'Saudi Arabia',
  'السعودية': 'Saudi Arabia', 'السعوديه': 'Saudi Arabia',
  'local': 'Saudi Arabia', 'domestic': 'Saudi Arabia', 'محلي': 'Saudi Arabia',
  'داخلي': 'Saudi Arabia', 'داخل المملكة': 'Saudi Arabia',
  // UAE
  'uae': 'United Arab Emirates', 'u.a.e': 'United Arab Emirates',
  'u.a.e.': 'United Arab Emirates', 'emirates': 'United Arab Emirates',
  'ae': 'United Arab Emirates',
  'الامارات': 'United Arab Emirates', 'الإمارات': 'United Arab Emirates',
  'الإمارات العربية المتحدة': 'United Arab Emirates',
  // Other GCC (ISO codes + names + Arabic)
  'kw': 'Kuwait', 'kuwait': 'Kuwait', 'الكويت': 'Kuwait',
  'bh': 'Bahrain', 'bahrain': 'Bahrain', 'البحرين': 'Bahrain',
  'om': 'Oman', 'oman': 'Oman', 'عمان': 'Oman', 'سلطنة عمان': 'Oman',
  'qa': 'Qatar', 'qatar': 'Qatar', 'قطر': 'Qatar',
  // Levant / North Africa
  'eg': 'Egypt', 'egypt': 'Egypt', 'مصر': 'Egypt',
  'jo': 'Jordan', 'jordan': 'Jordan', 'الأردن': 'Jordan',
  'tr': 'Turkey', 'turkey': 'Turkey', 'تركيا': 'Turkey',
  'iq': 'Iraq', 'iraq': 'Iraq', 'العراق': 'Iraq',
  'lb': 'Lebanon', 'lebanon': 'Lebanon', 'لبنان': 'Lebanon',
  'ye': 'Yemen', 'yemen': 'Yemen', 'اليمن': 'Yemen',
};

// Saudi province names — matched as prefixes so we catch both
// "<Province> Province-City" (J&T's common format) and "<Province>-City"
// (J&T's remote-area format that omits the word "Province"). These are
// the 13 administrative regions of Saudi Arabia plus common spellings.
const SAUDI_PROVINCE_RE = /\b(riyadh|makkah|mecca|madinah|medina|al\s*madinah|eastern|al\s*qassim|qassim|asir|tabuk|najran|jazan|gizan|al\s*bahah|al\s*jawf|hail|ha'?il|northern\s*borders?)\b/i;

export function normalizeCountry(raw) {
  if (!raw) return '';
  const str = String(raw).trim();
  const key = str.toLowerCase();
  if (COUNTRY_ALIASES[key]) return COUNTRY_ALIASES[key];
  // Detect Saudi-domestic destinations even when the country name is
  // absent. J&T writes "<Province> Province-City" or "<Province>-City".
  // The leading word is always a Saudi administrative region.
  if (/\bprovince\b/i.test(str)) return 'Saudi Arabia';
  if (SAUDI_PROVINCE_RE.test(str)) return 'Saudi Arabia';
  return str;
}

// ─── Map raw rows using detected columns ───────────────────────────────────────
// Returns the filtered shipment array. The array gets a `taxRoundingAdjustment`
// property attached: a small SAR amount Aramex appends as a single
// "TAX Rounding Diff" row at the end of each file, reconciling the period's
// VAT collected from customers (per-receipt rounding) against the sum of
// per-shipment 15% tax (which can differ by a few SAR). We filter the row
// itself out (it isn't a shipment) but preserve the tax amount so the
// comparison against the carrier statement's gross total stays accurate.
export function mapRows(raw, colMap) {
  const allMapped = raw.map(row => {
    const awb         = String(row[colMap.awb] ?? '');
    const billingType = String(row[colMap.billingType] ?? '').trim();
    const rawDest     = row[colMap.dest] ?? '';
    const rawCity     = row[colMap.destCity] ?? rawDest;

    const isCod    = isCodFeeRow(billingType);
    // Domestic shipments (e.g. Aramex ZDOI): the "destination" column carries
    // a Saudi city, not a country. Route them to the Saudi pricing tier and
    // preserve the original city for display. COD-fee rows (ZDCF) are also
    // domestic by nature — the fee only applies to Saudi-domestic shipments.
    // Also probe the destination column directly: iMile / J&T / DeliverNow
    // don't have a Billing Type column and their AWBs don't follow Aramex's
    // 3/5 prefix rule, but every shipment carries Customer Country = KSA
    // or a Province name that normalizeCountry recognises as Saudi Arabia.
    // Without this probe those carriers' rows get tagged international.
    const destSaysKSA = normalizeCountry(rawDest) === 'Saudi Arabia';
    const domestic = isCod || isDomesticShipment(billingType, awb) || destSaysKSA;
    // When the file has no destination column at all (J&T, iMile when
    // they omit it), or the parsed destination doesn't match any known
    // country alias, default to Saudi Arabia. All four supported
    // carriers are KSA-based and 99% of shipments are domestic; this
    // gives the audit a chance at correct pricing instead of marking
    // every row "unknown".
    let dest;
    if (domestic) dest = 'Saudi Arabia';
    else if (!rawDest) dest = 'Saudi Arabia';
    else {
      const normalized = normalizeCountry(rawDest);
      // normalizeCountry returns the raw string when no alias matches;
      // treat that case as Saudi-domestic too rather than blowing up.
      dest = normalized || 'Saudi Arabia';
    }
    const destCity = domestic ? String(rawDest).trim() : String(rawCity).trim();

    // COD service fee routing — two patterns coexist:
    //   1. Aramex: COD has its own ZDCF billing-type row, with the 5 SAR
    //      fee sitting in the "Other Charge" column (mapped to
    //      fuelSurcharge). isCod=true → move that value to codFee and
    //      zero out the others.
    //   2. iMile / similar: COD fee sits on the SAME row as the
    //      shipment, in a dedicated "COD Service Fee" column (colMap.codFee).
    //      Read it directly; keep delivery + fuel for the same row.
    const baseDelivery = parseFloat(row[colMap.deliveryCharges] ?? 0) || 0;
    const baseRss      = parseFloat(row[colMap.rss] ?? 0) || 0;
    const baseFuel     = parseFloat(row[colMap.fuelSurcharge] ?? 0) || 0;
    const inlineCodFee = colMap.codFee
      ? (parseFloat(row[colMap.codFee] ?? 0) || 0)
      : 0;
    const codFee       = isCod ? baseFuel : inlineCodFee;
    const posAmount    = colMap.posAmount ? (parseFloat(row[colMap.posAmount] ?? 0) || 0) : 0;
    const posFee       = colMap.posFee    ? (parseFloat(row[colMap.posFee]    ?? 0) || 0) : 0;

    return {
      awb,
      shipDate:        parseDate(row[colMap.shipDate] ?? ''),
      origin:          normalizeCountry(row[colMap.origin] ?? '') || 'Saudi Arabia',
      dest,
      destCity,
      domestic,
      billingType,
      isCod,
      weight:          parseFloat(row[colMap.weight] ?? 0) || 0,
      deliveryCharges: isCod ? 0 : baseDelivery,
      rss:             isCod ? 0 : baseRss,
      fuelSurcharge:   isCod ? 0 : baseFuel,
      codFee,
      posAmount,
      posFee,
      // Verbatim tax from the carrier file. ZOBI rows ship with tax=0
      // (zero-rated export); ZDOI domestic ≈ 15%; ZDCF COD = 15% of fee.
      // Comparison against the carrier statement uses this directly.
      tax:             parseFloat(row[colMap.tax] ?? 0) || 0,
      codAmount:       parseFloat(row[colMap.codAmount] ?? 0) || 0,
      serviceType:     String(row[colMap.serviceType] ?? '').trim(),
      signingStatus:   String(row[colMap.signingStatus] ?? '').trim(),
    };
  });

  // Sweep over the un-filtered rows for "TAX Rounding Diff" / similar tax-
  // reconciliation lines. They have a label-style AWB (rejected by
  // isRealShipmentAwb) but a non-zero Tax Amount we want to keep in the
  // file's tax total. Aramex emits ONE such row per file in our samples;
  // summing is defensive in case the format ever changes.
  let taxRoundingAdjustment = 0;
  for (const r of allMapped) {
    if (isRealShipmentAwb(r.awb)) continue;
    const label = String(r.awb || '').toLowerCase();
    if (!/round|tax/i.test(label)) continue;
    const t = Number(r.tax) || 0;
    if (t !== 0) taxRoundingAdjustment += t;
  }

  const filtered = allMapped.filter(r => {
    if (!r.dest || !(r.weight > 0)) return false;
    if (!isRealShipmentAwb(r.awb)) return false;

    const totalBilled = (r.deliveryCharges || 0) + (r.rss || 0)
      + (r.fuelSurcharge || 0) + (r.codFee || 0);

    // Returns / failed deliveries: drop unbilled rows entirely. Two
    // independent signals — either works on its own because each
    // carrier file is different:
    //   1. signingStatus says "Return / Failed / Cancelled / Not Delivered"
    //      (J&T's "Return Sign", iMile when the status column is present)
    //   2. Zero-billed delivery (iMile's typical pattern: returns just
    //      have all charge columns blank with no status column at all)
    // A row that says "return" but still has a non-zero bill stays in
    // — that's a billing bug worth catching.
    if (r.signingStatus && /return|fail|cancel|not.?delivered/i.test(r.signingStatus)) {
      if (totalBilled <= 0.01) return false;
    }
    // Per the user's rule: returns don't count toward AP. If the
    // carrier didn't bill anything (and this isn't a COD-fee row that
    // legitimately has a 1 SAR fee waiting to apply), it's a return.
    if (!r.isCod && totalBilled <= 0.01) return false;

    return true;
  });
  // Attach as a property so the rest of the pipeline (auditAll →
  // buildSummary → save) can fold it into totalTax without changing
  // function signatures or breaking existing callers.
  filtered.taxRoundingAdjustment = +taxRoundingAdjustment.toFixed(2);
  return filtered;
}

// Carrier files include phantom rows like Aramex's "TAX Rounding Diff",
// "Total", subtotals, etc. — they sneak through every other filter
// (have a destination + weight). Real AWBs from every carrier we
// support follow one of these patterns:
//   Aramex:     pure digits      (e.g. 50676846194)
//   J&T:        JTE + digits     (e.g. JTE000913047830)
//   DeliverNow: DNL + digits     (e.g. DNL03559916127)
// The phantom labels are always natural-language strings with spaces.
// Heuristic: reject anything containing whitespace, accept anything
// with a 6+ digit contiguous run (covers all real formats).
function isRealShipmentAwb(awb) {
  if (!awb) return false;
  const trimmed = String(awb).trim();
  if (!trimmed) return false;
  // Phantom labels always contain spaces ("TAX Rounding Diff",
  // "Grand Total", "Bill Doc.", "Sub Total" ...).
  if (/\s/.test(trimmed)) return false;
  // Real AWBs always have a long digit run.
  if (!/\d{6,}/.test(trimmed)) return false;
  return true;
}

// ─── Core audit ────────────────────────────────────────────────────────────────
const TOLERANCE = 0.51; // SAR rounding tolerance

export function auditRow(row, contract) {
  // ── COD-fee branch (Aramex ZDCF) ──
  // Flat fee per shipment regardless of weight or destination. The expected
  // amount is `contract.codFee` (defaults to 5 SAR). We slot it into the
  // `delivery` bucket so the rest of the pipeline (totals, summary, exports)
  // keeps working with no further branching.
  if (row.isCod) {
    const expectedFee = Number(contract?.codFee ?? 5);
    const invoicedFee = Number(row.codFee || 0);
    const invoiced = { delivery: invoicedFee, rss: 0, fuel: 0, total: invoicedFee, tax: Number(row.tax) || 0 };
    const expected = { delivery: expectedFee, rss: 0, fuel: 0, total: expectedFee };
    const diffTotal = +(invoicedFee - expectedFee).toFixed(2);
    const diffs    = { delivery: diffTotal, rss: 0, fuel: 0, total: diffTotal };
    const issues   = Math.abs(diffTotal) > TOLERANCE
      ? [{ field: 'cod', label: 'رسوم تحصيل (COD)', invoiced: invoicedFee, expected: expectedFee, diff: diffTotal }]
      : [];
    let status;
    if (Math.abs(diffTotal) <= TOLERANCE) status = 'ok';
    else if (diffTotal < 0)               status = 'favorable';
    else                                  status = 'mismatch';
    return { ...row, status, invoiced, expected, diffs, issues };
  }

  const calc = calcTotal(contract, row.dest, row.weight, row.shipDate, row.serviceType, row.origin);

  if (!calc) {
    const route = row.origin && row.origin !== 'Saudi Arabia' ? `${row.origin} → ${row.dest}` : row.dest;
    return {
      ...row,
      status: 'unknown',
      expected: null,
      diff: null,
      issues: [`المسار غير موجود في العقد: ${route}${row.serviceType ? ` (${row.serviceType})` : ''}`],
    };
  }

  // Some carriers (e.g. Aramex) bundle RSS into the fuel-surcharge column on
  // the invoice. If the row didn't have a dedicated RSS amount but the contract
  // expects RSS, attribute the expected RSS portion out of the bundled fuel
  // value so per-component comparisons line up. The total is unchanged.
  let invoicedRss  = row.rss;
  let invoicedFuel = row.fuelSurcharge;
  if (row.rss === 0 && calc.rss > 0 && invoicedFuel > 0) {
    const split = Math.min(calc.rss, invoicedFuel);
    invoicedRss  = split;
    invoicedFuel = +(invoicedFuel - split).toFixed(4);
  }

  // Inline COD fee (iMile and similar): when the shipment row itself
  // carries a COD Service Fee, audit it alongside the delivery charge.
  // Expected = contract.codFee if the shipment had a non-zero COD amount
  // (otherwise the carrier shouldn't have billed any fee). We use
  // codAmount > 0 OR a non-zero invoicedCodFee as the signal that this
  // row is a COD shipment.
  const invoicedCodFee = Number(row.codFee || 0);
  const isCodShipment  = invoicedCodFee > 0 || (Number(row.codAmount) || 0) > 0;
  const expectedCodFee = isCodShipment ? Number(contract?.codFee ?? 0) : 0;

  // POS fee (card-acquiring): iMile charges a percentage of POS Amount
  // (typically 1%). Expected = posAmount * contract.posFeePct, rounded
  // to 4 decimals to match the carrier's column precision. Skip when
  // no POS amount on the row (the customer paid cash) — even if the
  // contract has a posFeePct, no POS amount = no fee owed.
  const invoicedPosFee = Number(row.posFee || 0);
  const posAmount      = Number(row.posAmount || 0);
  const posPct         = Number(contract?.posFeePct ?? 0);
  const expectedPosFee = posAmount > 0 && posPct > 0
    ? +(posAmount * posPct).toFixed(4)
    : 0;

  const invoiced = {
    delivery: row.deliveryCharges,
    rss:      invoicedRss,
    fuel:     invoicedFuel,
    codFee:   invoicedCodFee,
    posFee:   invoicedPosFee,
    total:    row.deliveryCharges + invoicedRss + invoicedFuel + invoicedCodFee + invoicedPosFee,
    // Pass through whatever Tax Amount the carrier file showed for this
    // row. We don't audit tax (the carrier's number is authoritative);
    // we just preserve it so totalTax sums correctly.
    tax:      Number(row.tax) || 0,
  };

  const expectedCalc = {
    delivery: calc.delivery,
    rss:      calc.rss,
    fuel:     calc.fuel,
    codFee:   expectedCodFee,
    posFee:   expectedPosFee,
    total:    calc.total + expectedCodFee + expectedPosFee,
  };

  const diffs = {
    delivery: +(invoiced.delivery - expectedCalc.delivery).toFixed(2),
    rss:      +(invoiced.rss      - expectedCalc.rss).toFixed(2),
    fuel:     +(invoiced.fuel     - expectedCalc.fuel).toFixed(2),
    codFee:   +(invoiced.codFee   - expectedCalc.codFee).toFixed(2),
    posFee:   +(invoiced.posFee   - expectedCalc.posFee).toFixed(2),
    total:    +(invoiced.total    - expectedCalc.total).toFixed(2),
  };

  const issues = [];
  if (Math.abs(diffs.delivery) > TOLERANCE)
    issues.push({ field: 'delivery', label: 'رسوم الشحن',  invoiced: invoiced.delivery, expected: expectedCalc.delivery, diff: diffs.delivery });
  if (Math.abs(diffs.rss) > TOLERANCE)
    issues.push({ field: 'rss',      label: 'RSS',          invoiced: invoiced.rss,      expected: expectedCalc.rss,      diff: diffs.rss });
  if (Math.abs(diffs.fuel) > TOLERANCE)
    issues.push({ field: 'fuel',     label: 'رسوم الوقود',  invoiced: invoiced.fuel,     expected: expectedCalc.fuel,     diff: diffs.fuel });
  if (Math.abs(diffs.codFee) > TOLERANCE)
    issues.push({ field: 'codFee',   label: 'رسوم COD',     invoiced: invoiced.codFee,   expected: expectedCalc.codFee,   diff: diffs.codFee });
  if (Math.abs(diffs.posFee) > TOLERANCE)
    issues.push({ field: 'posFee',   label: 'رسوم POS',     invoiced: invoiced.posFee,   expected: expectedCalc.posFee,   diff: diffs.posFee });

  // Status is driven by the NET total, not per-component. Carriers like Aramex
  // bundle RSS + fuel into a single "Other Charge" column on the invoice, so a
  // per-component split produces fake offsetting diffs (rss −7.5, fuel +7.5)
  // even when the total is exactly right. Only the total tells us whether
  // money actually changed hands.
  let status;
  if (Math.abs(diffs.total) <= TOLERANCE) status = 'ok';
  else if (diffs.total < 0)               status = 'favorable';
  else                                    status = 'mismatch';

  return {
    ...row,
    status,
    invoiced,
    expected: expectedCalc,
    diffs,
    issues,
  };
}

export function auditAll(rows, carrier, forDate) {
  // Some carriers (e.g. SMSA) keep separate contracts for domestic vs
  // international shipping. We need to consult every active contract,
  // not just the "newest" one, and pick the one whose pricing covers
  // the row's destination. Fallback to the active contract for COD /
  // unmatched rows so flat fees still apply.
  const dateKey = forDate || new Date().toISOString().slice(0, 10);
  const activeContracts = (carrier?.contracts ?? [])
    .filter(c => (c.startDate || '0000') <= dateKey && (!c.endDate || c.endDate >= dateKey));
  const primary = getActiveContract(carrier, forDate);
  if (!primary && !activeContracts.length) {
    const out = rows.map(r => ({ ...r, status: 'no_contract', issues: ['لا يوجد عقد ساري لهذه الفترة'] }));
    if (rows.taxRoundingAdjustment) out.taxRoundingAdjustment = rows.taxRoundingAdjustment;
    return out;
  }

  // Per-row contract resolver: prefer the contract that has explicit
  // pricing for the destination; otherwise fall back to the primary.
  const pickContract = (row) => {
    if (row.isCod) return primary;                       // COD uses carrier-wide codFee
    if (!row.dest) return primary;
    const match = activeContracts.find(c => c.pricing && c.pricing[row.dest]);
    return match || primary;
  };

  const results = rows.map(r => auditRow(r, pickContract(r)));
  flagDuplicateAwbs(results);
  if (rows.taxRoundingAdjustment) {
    results.taxRoundingAdjustment = rows.taxRoundingAdjustment;
  }
  return results;
}

// ─── Audit type derivation ──────────────────────────────────────────────────
// Single label that summarises what the user just uploaded, so the audits
// history list can show "محلي / دولي / دفع عند استلام / مختلط" without the
// caller having to scan all results.
export function deriveAuditType(results) {
  if (!Array.isArray(results) || !results.length) return 'unknown';
  let cod = 0, domestic = 0, international = 0;
  for (const r of results) {
    if (r.isCod) cod++;
    else if (r.domestic) domestic++;
    else international++;
  }
  const present = [cod && 'cod', domestic && 'domestic', international && 'international'].filter(Boolean);
  if (present.length === 1) return present[0];
  return 'mixed';
}

// ─── Duplicate-AWB detection ────────────────────────────────────────────────
// Within ONE upload, an AWB legitimately appears at most:
//   • once in the shipping invoice (ZDOI / international / unknown carriers)
//   • once in the COD-fee invoice (ZDCF)
// Anything beyond that means the carrier double-billed for the SAME charge
// type. We split rows by class (`cod` vs `ship`) so the COD pairing isn't
// flagged.
//
// First occurrence in each duplicate group keeps its original audit math
// and just gets an info issue tag. Subsequent copies are forced to status
// 'mismatch' with `expected = 0`, so the full invoiced amount registers as
// an overcharge in totalDiff. That way the operator sees both the duplicate
// signal AND the financial impact in one place.
export function flagDuplicateAwbs(results) {
  const groups = new Map();
  for (const r of results) {
    const awbKey = String(r.awb || '').trim();
    if (!awbKey) continue;
    const classKey = r.isCod ? 'cod' : 'ship';
    const key = `${awbKey}|${classKey}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  for (const [, group] of groups) {
    if (group.length <= 1) continue;
    // Earliest shipDate becomes the canonical charge; later copies = phantoms
    group.sort((a, b) => (a.shipDate || '').localeCompare(b.shipDate || ''));
    const total = group.length;
    const classLabel = group[0].isCod ? 'رسوم تحصيل (ZDCF)' : 'فاتورة الشحن (ZDOI)';
    for (let i = 0; i < group.length; i++) {
      const r = group[i];
      r.duplicateGroup = total;
      r.duplicateIndex = i + 1;
      if (i === 0) {
        // Keep math intact — this is the real shipment. Just inform.
        r.issues = [
          ...(r.issues || []),
          {
            field: 'duplicate',
            label: 'AWB له نسخ مكررة',
            invoiced: r.invoiced?.total ?? 0,
            expected: r.expected?.total ?? 0,
            diff: 0,
            note: `الـAWB ${r.awb} تكرر ${total} مرات في ${classLabel}. هذي النسخة الأصلية.`,
          },
        ];
        continue;
      }
      // Phantom charge: expected = 0, full invoiced is the overcharge.
      const inv = r.invoiced ?? { delivery: 0, rss: 0, fuel: 0, total: 0 };
      r.expected = { delivery: 0, rss: 0, fuel: 0, total: 0 };
      r.diffs = {
        delivery: inv.delivery,
        rss:      inv.rss,
        fuel:     inv.fuel,
        total:    inv.total,
      };
      r.status = inv.total > TOLERANCE ? 'mismatch' : 'ok';
      r.issues = [{
        field: 'duplicate',
        label: 'AWB مكرر',
        invoiced: inv.total,
        expected: 0,
        diff: inv.total,
        note: `النسخة ${i + 1} من ${total} لنفس الـAWB ${r.awb} في ${classLabel} — تكرار غير مشروع`,
      }];
    }
  }
}

// ─── Summary stats ─────────────────────────────────────────────────────────────
export function buildSummary(results) {
  const total     = results.length;
  const ok        = results.filter(r => r.status === 'ok').length;
  const mismatch  = results.filter(r => r.status === 'mismatch').length;
  const favorable = results.filter(r => r.status === 'favorable').length;
  const unknown   = results.filter(r => r.status === 'unknown' || r.status === 'no_contract').length;

  // Overcharges only — do not include favorable rows here; the user shouldn't
  // chase money back when the carrier under-billed.
  const mis = results.filter(r => r.status === 'mismatch');
  const totalDiff    = mis.reduce((s, r) => s + (r.diffs?.total    ?? 0), 0);
  const deliveryDiff = mis.reduce((s, r) => s + (r.diffs?.delivery ?? 0), 0);
  const rssDiff      = mis.reduce((s, r) => s + (r.diffs?.rss      ?? 0), 0);
  const fuelDiff     = mis.reduce((s, r) => s + (r.diffs?.fuel     ?? 0), 0);

  // Favorable variance — tracked separately for visibility, not added to totalDiff.
  const fav = results.filter(r => r.status === 'favorable');
  const favorableDiff = fav.reduce((s, r) => s + (r.diffs?.total ?? 0), 0);

  // By country (overcharges only)
  const byCountry = {};
  for (const r of mis) {
    if (!byCountry[r.dest]) byCountry[r.dest] = { count:0, diff:0 };
    byCountry[r.dest].count++;
    byCountry[r.dest].diff += r.diffs?.total ?? 0;
  }

  // Pre-VAT totals across ALL audited rows (including ok / favorable). Used
  // when matching the audit against a carrier_operations row, which carries
  // a post-VAT amount — see validateAuditLink in CarrierLedger.
  const totalBilled = +results.reduce(
    (s, r) => s + (Number(r.invoiced?.total) || 0), 0,
  ).toFixed(2);
  const totalExpected = +results.reduce(
    (s, r) => s + (Number(r.expected?.total) || 0), 0,
  ).toFixed(2);
  // Sum of "Tax Amount" verbatim from the carrier file. ZOBI international
  // rows carry tax=0 (zero-rated export); ZDOI domestic ≈ 15%; ZDCF COD
  // = 15% of fee. totalGross = what we expect the carrier statement
  // amount to equal — it removes the need for a hardcoded VAT rate.
  const taxFromShipments = +results.reduce(
    (s, r) => s + (Number(r.invoiced?.tax) || 0), 0,
  ).toFixed(2);
  // Aramex appends a single "TAX Rounding Diff" row per file that
  // reconciles the period's actual collected VAT against the sum of
  // per-shipment 15% (which can differ by a few SAR due to per-receipt
  // rounding). mapRows captures that amount and attaches it here. We
  // include it in totalTax so the gross total matches the carrier's
  // statement even when the per-row tax sum doesn't.
  const taxRoundingAdjustment = +(Number(results.taxRoundingAdjustment) || 0).toFixed(2);
  const totalTax   = +(taxFromShipments + taxRoundingAdjustment).toFixed(2);
  const totalGross = +(totalBilled + totalTax).toFixed(2);

  // Duplicate-AWB tally — independent of status so the user sees the count
  // even when the duplicates happen to be tiny (still worth disputing).
  const duplicates = results.filter(r => (r.duplicateGroup ?? 0) > 1).length;
  // Number of distinct AWBs that have at least one duplicate. Useful for the
  // headline "X AWBs مكررة" message.
  const duplicateAwbs = new Set(
    results.filter(r => (r.duplicateGroup ?? 0) > 1).map(r => String(r.awb || '').trim()),
  ).size;

  return {
    total, ok, mismatch, favorable, unknown,
    totalDiff, deliveryDiff, rssDiff, fuelDiff, favorableDiff,
    totalBilled, totalExpected, totalTax, totalGross,
    // Surfaced for the UI / debugging: how much of totalTax came from a
    // per-period rounding row vs from individual shipments.
    taxFromShipments, taxRoundingAdjustment,
    duplicates, duplicateAwbs,
    byCountry,
  };
}

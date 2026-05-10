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
  awb:             [/awb/i, /airway.?bill/i, /waybill/i, /tracking/i, /رقم.?الشحن/],
  shipDate:        [/ship.?date/i, /pick.?up.?date/i, /تاريخ/, /date/i],
  origin:          [/^origin$/i, /origin.?location/i, /^from$/i, /^from.?country$/i, /^source$/i, /مصدر/i, /^من$/],
  dest:            [/^dest$/i, /destination.?location/i, /destination/i, /^to$/i, /^to.?country$/i, /country/i, /دولة/i, /^الى$/],
  destCity:        [/dest.?city/i, /city/i, /مدين/i],
  // Prefer chargeable weight (used for billing) over net/actual weight,
  // because some carriers (e.g. Aramex) leave Net weight at 0.
  weight:          [/chargeable.?weight/i, /charge.?weight/i, /actual.?weight/i, /وزن/i, /^wt$/i, /weight/i],
  deliveryCharges: [/delivery.?charge/i, /shipping.?charge/i, /freight.?charge/i, /base.?charge/i, /رسوم.?الشحن/, /رسوم/i, /توصيل/i],
  rss:             [/^rss$/i, /remote/i],
  // "Other Charge" is the canonical Aramex column that bundles either fuel
  // surcharge (ZDOI rows) or the COD service fee (ZDCF rows). The audit
  // engine routes it correctly per row based on Billing Type.
  fuelSurcharge:   [/fuel.?surcharge/i, /fuel/i, /وقود/i, /surcharge/i, /other.?charge/i],
  codAmount:       [/cod.?amount/i, /cash.?on/i],
  serviceType:     [/service.?type/i, /نوع.?الخدمة/i, /نوع.?الشحن/i, /^type$/i, /^service$/i],
  billingType:     [/billing.?type/i],
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

export function detectColumns(headers) {
  const map = {};
  const used = new Set();
  // Iterate fields/patterns in declared order so specific patterns win.
  for (const [field, patterns] of Object.entries(COL_PATTERNS)) {
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

export function normalizeCountry(raw) {
  if (!raw) return '';
  const key = String(raw).trim().toLowerCase();
  return COUNTRY_ALIASES[key] ?? String(raw).trim();
}

// ─── Map raw rows using detected columns ───────────────────────────────────────
export function mapRows(raw, colMap) {
  return raw.map(row => {
    const awb         = String(row[colMap.awb] ?? '');
    const billingType = String(row[colMap.billingType] ?? '').trim();
    const rawDest     = row[colMap.dest] ?? '';
    const rawCity     = row[colMap.destCity] ?? rawDest;

    const isCod    = isCodFeeRow(billingType);
    // Domestic shipments (e.g. Aramex ZDOI): the "destination" column carries
    // a Saudi city, not a country. Route them to the Saudi pricing tier and
    // preserve the original city for display. COD-fee rows (ZDCF) are also
    // domestic by nature — the fee only applies to Saudi-domestic shipments.
    const domestic = isCod || isDomesticShipment(billingType, awb);
    const dest     = domestic ? 'Saudi Arabia' : normalizeCountry(rawDest);
    const destCity = domestic ? String(rawDest).trim() : String(rawCity).trim();

    // For COD-fee rows the regular delivery/fuel columns don't apply — the
    // 5 SAR fee sits in the "Other Charge" column (which our patterns map to
    // fuelSurcharge). Move it onto a dedicated `codFee` field and zero out
    // the others so the regular auditRow math sees a clean COD line.
    const baseDelivery = parseFloat(row[colMap.deliveryCharges] ?? 0) || 0;
    const baseRss      = parseFloat(row[colMap.rss] ?? 0) || 0;
    const baseFuel     = parseFloat(row[colMap.fuelSurcharge] ?? 0) || 0;
    const codFee       = isCod ? baseFuel : 0;

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
      codAmount:       parseFloat(row[colMap.codAmount] ?? 0) || 0,
      serviceType:     String(row[colMap.serviceType] ?? '').trim(),
    };
  }).filter(r => r.dest && r.weight > 0 && isRealShipmentAwb(r.awb));
}

// Aramex monthly Excels include phantom rows like "TAX Rounding Diff",
// "Total", subtotals, etc. They sneak through every other filter (they
// have a destination + a weight) but the AWB column carries a label
// instead of a tracking number. Real Aramex AWBs are pure-digit
// 10-character codes, so we drop anything with alphabetic content.
function isRealShipmentAwb(awb) {
  if (!awb) return false;
  const trimmed = String(awb).trim();
  if (!trimmed) return false;
  // Reject if the cell contains any letters (Latin or Arabic)
  if (/[a-z؀-ۿ]/i.test(trimmed)) return false;
  // Must contain at least one run of 4+ digits
  if (!/\d{4,}/.test(trimmed)) return false;
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
    const invoiced = { delivery: invoicedFee, rss: 0, fuel: 0, total: invoicedFee };
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

  const invoiced = {
    delivery: row.deliveryCharges,
    rss:      invoicedRss,
    fuel:     invoicedFuel,
    total:    row.deliveryCharges + invoicedRss + invoicedFuel,
  };

  const diffs = {
    delivery: +(invoiced.delivery - calc.delivery).toFixed(2),
    rss:      +(invoiced.rss      - calc.rss).toFixed(2),
    fuel:     +(invoiced.fuel     - calc.fuel).toFixed(2),
    total:    +(invoiced.total    - calc.total).toFixed(2),
  };

  const issues = [];
  if (Math.abs(diffs.delivery) > TOLERANCE)
    issues.push({ field: 'delivery', label: 'رسوم الشحن',  invoiced: invoiced.delivery, expected: calc.delivery, diff: diffs.delivery });
  if (Math.abs(diffs.rss) > TOLERANCE)
    issues.push({ field: 'rss',      label: 'RSS',          invoiced: invoiced.rss,      expected: calc.rss,      diff: diffs.rss });
  if (Math.abs(diffs.fuel) > TOLERANCE)
    issues.push({ field: 'fuel',     label: 'رسوم الوقود',  invoiced: invoiced.fuel,     expected: calc.fuel,     diff: diffs.fuel });

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
    expected: calc,
    diffs,
    issues,
  };
}

export function auditAll(rows, carrier, forDate) {
  const contract = getActiveContract(carrier, forDate);
  if (!contract) return rows.map(r => ({ ...r, status: 'no_contract', issues: ['لا يوجد عقد ساري لهذه الفترة'] }));

  return rows.map(r => auditRow(r, contract));
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

  return {
    total, ok, mismatch, favorable, unknown,
    totalDiff, deliveryDiff, rssDiff, fuelDiff, favorableDiff,
    totalBilled, totalExpected,
    byCountry,
  };
}

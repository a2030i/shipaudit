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
  // Weight column priority:
  //   • "Settlement weight" — J&T's billed weight (rounded up to next kg)
  //   • "Chargeable weight" — Aramex's billed weight
  //   • Fallback to actual / generic / Arabic
  // We always pick the column the carrier ACTUALLY billed against, since
  // that's what the contract math compares against.
  weight:          [/settlement.?weight/i, /chargeable.?weight/i, /charge.?weight/i, /actual.?weight/i, /وزن/i, /^wt$/i, /weight/i],
  deliveryCharges: [/delivery.?charge/i, /shipping.?charge/i, /freight.?charge/i, /base.?charge/i, /رسوم.?الشحن/, /رسوم/i, /توصيل/i],
  rss:             [/^rss$/i, /remote/i],
  // "Other Charge" is the canonical Aramex column that bundles either fuel
  // surcharge (ZDOI rows) or the COD service fee (ZDCF rows). The audit
  // engine routes it correctly per row based on Billing Type.
  fuelSurcharge:   [/fuel.?surcharge/i, /fuel/i, /وقود/i, /surcharge/i, /other.?charge/i],
  codAmount:       [/cod.?amount/i, /cash.?on/i],
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
    // Skip carrier-marked returns when they're billed at zero — they're
    // not part of the financial reconciliation (J&T marks these as
    // "Return Sign"; Aramex doesn't expose this column). Returns with
    // ANY non-zero charge stay in so we can catch the rare bug where a
    // return got billed by mistake.
    if (r.signingStatus && /return/i.test(r.signingStatus)) {
      const totalBilled = (r.deliveryCharges || 0) + (r.rss || 0)
        + (r.fuelSurcharge || 0) + (r.codFee || 0);
      if (totalBilled <= 0.01) return false;
    }
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

  const invoiced = {
    delivery: row.deliveryCharges,
    rss:      invoicedRss,
    fuel:     invoicedFuel,
    total:    row.deliveryCharges + invoicedRss + invoicedFuel,
    // Pass through whatever Tax Amount the carrier file showed for this
    // row. We don't audit tax (the carrier's number is authoritative);
    // we just preserve it so totalTax sums correctly.
    tax:      Number(row.tax) || 0,
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
  if (!contract) {
    const out = rows.map(r => ({ ...r, status: 'no_contract', issues: ['لا يوجد عقد ساري لهذه الفترة'] }));
    if (rows.taxRoundingAdjustment) out.taxRoundingAdjustment = rows.taxRoundingAdjustment;
    return out;
  }

  const results = rows.map(r => auditRow(r, contract));
  flagDuplicateAwbs(results);
  // Carry the file-level tax rounding adjustment through to summary stage.
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

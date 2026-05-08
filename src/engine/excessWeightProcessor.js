import * as XLSX from 'xlsx';
import { detectHeaderRow, buildHeaders, parseDate } from './audit.js';

// ─────────────────────────────────────────────────────────────────────────────
//  Customer excess-weight processor.
//
//  Reads any Excel that has at least a customer column and a weight column,
//  detects the relevant columns, computes excess = max(0, actual − declared),
//  and returns ready-to-save rows.
//
//  Columns auto-detected (Arabic + English keywords):
//    customer  → "العميل" / "اسم العميل" / "customer" / "shipper" / "consignee"
//    awb       → "الشحنة" / "رقم الشحنة" / "AWB" / "Airway Bill"
//    shipDate  → "تاريخ" / "Pick up" / "Date"
//    declared  → "الوزن المعلَن" / "declared" / "manifest" / "booking weight"
//    actual    → "الوزن الفعلي" / "Chargeable Weight" / "actual" / "billed"
// ─────────────────────────────────────────────────────────────────────────────

const COL_PATTERNS = {
  customer: [
    /العميل|اسم.?العميل|المرسل|الشاحن/i,
    /^customer/i, /customer.?name/i, /^shipper/i, /^consignee/i, /^client/i,
  ],
  awb: [
    /awb/i, /airway.?bill/i, /waybill/i, /tracking/i,
    /رقم.?الشحن|الشحنة|بوليصة/,
  ],
  shipDate: [
    /pick.?up.?date/i, /ship.?date/i, /^date$/i, /تاريخ/,
  ],
  declared: [
    /declared/i, /manifest/i, /booking.?weight/i, /quoted/i,
    /الوزن.?المعلَن|الوزن.?المعلن|الوزن.?المتفق|الوزن.?المُعلن/,
  ],
  actual: [
    // Carriers prefer "Chargeable Weight" since that's what they bill on.
    /chargeable.?weight/i, /charge.?weight/i, /actual.?weight/i, /billed.?weight/i,
    /الوزن.?الفعلي|الوزن.?الإجمالي|وزن.?الشحنة|الوزن.?الكلي|الوزن.?المُحاسَب/,
    // Generic 'weight' falls last so it's a final fallback.
    /^weight$/i, /^wt$/i, /وزن/,
  ],
};

export function detectExcessColumns(headers) {
  const map = {};
  const used = new Set();
  for (const [field, patterns] of Object.entries(COL_PATTERNS)) {
    for (const pattern of patterns) {
      const match = headers.find(h => {
        if (used.has(h)) return false;
        const kl = String(h).toLowerCase().trim();
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

const num = v => {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const cleaned = String(v).replace(/[^\d.\-]/g, '').trim();
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Read an Excel buffer and return:
 *   { headers, rawRows, headerRow }
 * The caller maps columns and computes excess.
 */
export function readExcelForExcess(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  if (!allRows.length) return { headers: [], rawRows: [], headerRow: 0 };

  const headerRow = detectHeaderRow(allRows);
  const headers   = buildHeaders(allRows[headerRow]);
  const rawRows   = allRows.slice(headerRow + 1)
    .filter(row => row && row.some(v => v !== null && v !== '' && v !== undefined))
    .map(row => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ''])));
  return { headers, rawRows, headerRow };
}

/**
 * Apply column mapping + rate to produce shipment records.
 *
 * @param {Array<object>} rawRows  rows keyed by header
 * @param {object} colMap          { customer, awb, shipDate, declared, actual }
 * @param {object} opts            { ratePerKg, defaultDeclared, carrierId, sourceFile }
 * @returns {Array<{customer_name, awb, ship_date, declared_weight, actual_weight,
 *                  excess_weight, rate_per_kg, amount_due, carrier_id, source_file}>}
 */
export function buildExcessShipments(rawRows, colMap, opts = {}) {
  const ratePerKg       = Number(opts.ratePerKg)       || 0;
  const defaultDeclared = Number(opts.defaultDeclared) || 0;
  const carrierId       = opts.carrierId || null;
  const sourceFile      = opts.sourceFile || null;

  const rows = [];
  for (const r of rawRows) {
    const customer = String(colMap.customer ? r[colMap.customer] ?? '' : '').trim();
    if (!customer) continue;
    const actual = num(r[colMap.actual]);
    if (actual <= 0) continue;
    const declared = colMap.declared ? num(r[colMap.declared]) : defaultDeclared;
    const excess   = Math.max(0, +(actual - declared).toFixed(3));
    if (excess <= 0) continue; // skip rows without excess

    const awb      = colMap.awb      ? String(r[colMap.awb] ?? '').trim() : null;
    const shipDate = colMap.shipDate ? parseDate(r[colMap.shipDate]) || null : null;

    rows.push({
      customer_name:   customer,
      awb:             awb || null,
      ship_date:       shipDate || null,
      declared_weight: +declared.toFixed(3),
      actual_weight:   +actual.toFixed(3),
      excess_weight:   excess,
      rate_per_kg:     +ratePerKg.toFixed(2),
      amount_due:      +(excess * ratePerKg).toFixed(2),
      carrier_id:      carrierId,
      source_file:     sourceFile,
    });
  }
  return rows;
}

/**
 * Group computed rows by customer for the preview pane.
 */
export function summariseByCustomer(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.customer_name)) {
      map.set(r.customer_name, {
        customer: r.customer_name,
        shipments: 0,
        totalExcess: 0,
        totalDue: 0,
      });
    }
    const acc = map.get(r.customer_name);
    acc.shipments  += 1;
    acc.totalExcess += r.excess_weight;
    acc.totalDue    += r.amount_due;
  }
  return [...map.values()].sort((a, b) => b.totalDue - a.totalDue);
}

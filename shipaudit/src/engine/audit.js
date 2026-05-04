import { calcTotal } from './pricing.js';
import { getActiveContract } from '../data/carriers.js';

// ─── Date parsing ──────────────────────────────────────────────────────────────
export function parseDate(v) {
  if (!v) return '';
  if (typeof v === 'number')
    return new Date(Math.round((v - 25569) * 86400 * 1000)).toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

// ─── Column auto-mapper ────────────────────────────────────────────────────────
const COL_PATTERNS = {
  awb:             [/awb/i, /waybill/i, /tracking/i, /رقم.?الشحن/],
  shipDate:        [/ship.?date/i, /date/i, /تاريخ/],
  dest:            [/^dest$/i, /destination/i, /country/i, /دولة/i],
  destCity:        [/dest.?city/i, /city/i, /مدين/i],
  weight:          [/weight/i, /وزن/i, /wt/i],
  deliveryCharges: [/delivery.?charge/i, /shipping.?charge/i, /رسوم/i, /توصيل/i],
  rss:             [/^rss$/i, /remote/i],
  fuelSurcharge:   [/fuel/i, /وقود/i, /surcharge/i],
  codAmount:       [/cod.?amount/i, /cash.?on/i],
};

export function detectColumns(headers) {
  const map = {};
  for (const header of headers) {
    const kl = header.toLowerCase().trim();
    for (const [field, patterns] of Object.entries(COL_PATTERNS)) {
      if (!map[field] && patterns.some(p => p instanceof RegExp ? p.test(kl) : kl.includes(p))) {
        map[field] = header;
        break;
      }
    }
  }
  return map;
}

// ─── Map raw rows using detected columns ───────────────────────────────────────
export function mapRows(raw, colMap) {
  return raw.map(row => ({
    awb:             String(row[colMap.awb]             ?? ''),
    shipDate:        parseDate(row[colMap.shipDate]     ?? ''),
    dest:            String(row[colMap.dest]            ?? ''),
    destCity:        String(row[colMap.destCity]        ?? ''),
    weight:          parseFloat(row[colMap.weight]      ?? 0) || 0,
    deliveryCharges: parseFloat(row[colMap.deliveryCharges] ?? 0) || 0,
    rss:             parseFloat(row[colMap.rss]         ?? 0) || 0,
    fuelSurcharge:   parseFloat(row[colMap.fuelSurcharge]   ?? 0) || 0,
    codAmount:       parseFloat(row[colMap.codAmount]   ?? 0) || 0,
    _raw:            row,
  })).filter(r => r.dest && r.weight > 0);
}

// ─── Core audit ────────────────────────────────────────────────────────────────
const TOLERANCE = 0.51; // SAR rounding tolerance

export function auditRow(row, contract) {
  const calc = calcTotal(contract, row.dest, row.weight, row.shipDate);

  if (!calc) {
    return {
      ...row,
      status: 'unknown',
      expected: null,
      diff: null,
      issues: [`الدولة غير موجودة في العقد: ${row.dest}`],
    };
  }

  const invoiced = {
    delivery: row.deliveryCharges,
    rss:      row.rss,
    fuel:     row.fuelSurcharge,
    total:    row.deliveryCharges + row.rss + row.fuelSurcharge,
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

  return {
    ...row,
    status: issues.length ? 'mismatch' : 'ok',
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
  const total    = results.length;
  const ok       = results.filter(r => r.status === 'ok').length;
  const mismatch = results.filter(r => r.status === 'mismatch').length;
  const unknown  = results.filter(r => r.status === 'unknown' || r.status === 'no_contract').length;

  const mis = results.filter(r => r.status === 'mismatch');

  const totalDiff     = mis.reduce((s, r) => s + (r.diffs?.total    ?? 0), 0);
  const deliveryDiff  = mis.reduce((s, r) => s + (r.diffs?.delivery ?? 0), 0);
  const rssDiff       = mis.reduce((s, r) => s + (r.diffs?.rss      ?? 0), 0);
  const fuelDiff      = mis.reduce((s, r) => s + (r.diffs?.fuel     ?? 0), 0);

  // By country
  const byCountry = {};
  for (const r of mis) {
    if (!byCountry[r.dest]) byCountry[r.dest] = { count:0, diff:0 };
    byCountry[r.dest].count++;
    byCountry[r.dest].diff += r.diffs?.total ?? 0;
  }

  return { total, ok, mismatch, unknown, totalDiff, deliveryDiff, rssDiff, fuelDiff, byCountry };
}

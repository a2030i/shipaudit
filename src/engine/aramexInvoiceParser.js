// ─────────────────────────────────────────────────────────────────────────────
//  Aramex detailed-invoice PDF parser (per-shipment line items)
//
//  Aramex emails the carrier invoice as a multi-page PDF — one row per
//  shipment: HAWB · Pickup Date · Origin · Destination · Prod Type ·
//  Weight · Shipping Charges · Other Transport · Net · VAT Rate ·
//  VAT Amount · Gross. The operator only ever receives the PDF (Excel is
//  on-request), so we read the PDF directly and hand the shipments to the
//  same audit engine the xlsx flow uses.
//
//  Public API:
//    parseAramexInvoice(arrayBuffer) → {
//      header: { invoiceNo, total, shipmentCount },
//      rows:   [{ awb, dest, weight, deliveryCharges, rss, fuelSurcharge,
//                 codAmount, codFee, posAmount, posFee, tax, serviceType,
//                 signingStatus, ... }]   // ready for auditAll()
//    }
//
//  Mapping to the audit row shape: `deliveryCharges` carries the per-shipment
//  GROSS (the full billed amount — for international export VAT=0 so net=gross,
//  and the figure already includes fuel+RSS). The contract's calcTotal()
//  computes the expected full charge, so a clean billed-vs-expected compare
//  works without splitting fuel/RSS back out.
// ─────────────────────────────────────────────────────────────────────────────

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerSrc from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

const Y_CLUSTER = 3;

// Aramex's abbreviated destination spellings → canonical country names
// the contract pricing is keyed by.
const DEST_ALIASES = {
  'utd.arab emir.': 'United Arab Emirates',
  'utd.arab':       'United Arab Emirates',
  'uae':            'United Arab Emirates',
  'saudi arabia':   'Saudi Arabia',
  'ksa':            'Saudi Arabia',
};

const isHawb   = (s) => /^\d{11}$/.test(String(s).trim());
const isNum    = (s) => /^-?[\d,]+\.\d{2}$/.test(String(s).trim());
const isWeight = (s) => /^\d+\.\d{3}$/.test(String(s).trim());
const isProd   = (s) => /^[A-Z]{3}$/.test(String(s).trim());
const isDate   = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s).trim()) || /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(String(s).trim());
const num      = (s) => parseFloat(String(s).replace(/,/g, '')) || 0;

function parseShipDate(s) {
  if (!s) return '';
  const t = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
}

function normDest(raw) {
  const t = String(raw || '').trim();
  return DEST_ALIASES[t.toLowerCase()] || t;
}

async function clusterRows(arrayBuffer) {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const rows = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const content = await (await pdf.getPage(p)).getTextContent();
    const items = content.items
      .map(it => ({ x: it.transform[4], y: it.transform[5], s: (it.str ?? '').trim() }))
      .filter(it => it.s);
    items.sort((a, b) => b.y - a.y);
    let cur = null;
    const pageRows = [];
    for (const it of items) {
      if (!cur || cur.y - it.y > Y_CLUSTER) { cur = { y: it.y, items: [] }; pageRows.push(cur); }
      cur.items.push(it);
    }
    for (const r of pageRows) { r.items.sort((a, b) => a.x - b.x); rows.push(r); }
  }
  return rows;
}

export async function parseAramexInvoice(arrayBuffer) {
  const rows = await clusterRows(arrayBuffer);

  // Header — invoice number + total.
  let invoiceNo = null, total = null;
  for (const r of rows) {
    const text = r.items.map(i => i.s).join(' ');
    if (!invoiceNo) {
      const m = text.match(/Tax\s*Invoice\s*Number[:\s]*([A-Z0-9/\-]+)/i);
      if (m) invoiceNo = m[1];
    }
    if (total == null && /Gross\s*Total\s*Amount/i.test(text)) {
      const m = text.match(/([\d,]+\.\d{2})/);
      if (m) total = num(m[1]);
    }
  }

  const rowsOut = [];
  for (let i = 0; i < rows.length; i++) {
    const c = rows[i].items.map(x => x.s);
    const hi = c.findIndex(isHawb);
    if (hi < 0) continue;
    const awb = c[hi];

    // Destination = tokens between the origin ("Saudi Arabia") and the
    // 3-letter product code.
    const si = c.findIndex((s, j) => j > hi && /saudi\s*arabia/i.test(s));
    const pi = c.findIndex((s, j) => j > hi && isProd(s));
    let dest = (si >= 0 && pi > si) ? c.slice(si + 1, pi).join(' ').trim() : null;
    dest = normDest(dest);

    // Weight — an X.XXX token on this row, else the row just above/below
    // (Aramex prints the chargeable weight on a separate y-line). Weight is
    // the audit's pricing key, so we look in all three positions.
    let weight = null;
    const wThis = c.find(isWeight);
    if (wThis) weight = num(wThis);
    else {
      const wPrev = (rows[i - 1]?.items || []).map(x => x.s).find(isWeight);
      const wNext = (rows[i + 1]?.items || []).map(x => x.s).find(isWeight);
      if (wPrev) weight = num(wPrev);
      else if (wNext) weight = num(wNext);
    }

    // Pickup date + product/service type (PPX / DGG / …).
    const shipDate    = parseShipDate(c.slice(hi + 1).find(isDate));
    const serviceType = pi >= 0 ? c[pi] : '';

    // Charges — trailing amounts; the LAST is Gross (full billed amount).
    const amts = c.filter(isNum).map(num);
    if (amts.length < 3 || !dest || !(weight > 0)) continue;
    const gross = amts[amts.length - 1];
    // VAT amount = 2nd-from-last when present (gross = net + vat).
    const vat = amts.length >= 2 ? amts[amts.length - 2] : 0;

    rowsOut.push({
      awb,
      shipDate,
      dest,
      destCity:        dest,
      weight,
      deliveryCharges: gross,   // full billed charge (incl fuel+RSS)
      rss:             0,
      fuelSurcharge:   0,
      codFee:          0,
      posAmount:       0,
      posFee:          0,
      codAmount:       0,
      tax:             vat,
      isCod:           false,
      billingType:     '',
      serviceType,
      signingStatus:   '',
      subCarrier:      '',
      codPaymentMethod: '',
    });
  }

  return {
    header: { invoiceNo, total, shipmentCount: rowsOut.length },
    rows:   rowsOut,
  };
}

// Content sniff: is this PDF an Aramex detailed shipment invoice?
export async function looksLikeAramexInvoice(arrayBuffer) {
  try {
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const text = (await (await pdf.getPage(1)).getTextContent()).items.map(i => i.str).join(' ');
    return /Aramex/i.test(text) && /(HAWB|Tax\s*Invoice\s*Number|Outbound\s*Invoice|Inbound\s*Invoice)/i.test(text);
  } catch { return false; }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Aramex Statement-of-Account PDF parser
//
//  Reads the PDF in the browser (pdfjs-dist), groups text items into rows by
//  Y-coordinate, then walks each row to extract:
//    • header fields  (account number, period, customer name, VAT)
//    • operations     (each invoice / debit memo / credit / adjustment line)
//    • totals         (closing balance + aging buckets)
//
//  Public API:
//    parseAramexStatement(arrayBuffer) → {
//      header:     { accountNumber, periodFrom, periodTo, customer, vatNo, … },
//      operations: [{ docNo, docType, referenceNo, docDate, dueDate, dr, cr,
//                     balance, shipmentType }, …],
//      totals:     { totalBalance, aging: { d0_30, d31_60, d61_90, over90 } },
//    }
// ─────────────────────────────────────────────────────────────────────────────

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
// Use the bundled worker so vite bundles it correctly.
import workerSrc from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

// Within this many vertical pixels we consider items to be on the same row.
// Aramex sometimes pushes a parenthesized negative amount onto its own
// y-line one pixel below the parent — clustering recovers them.
const Y_CLUSTER_TOLERANCE = 3;

// Recognised document types in the statement.
const DOC_TYPES = new Set(['RV', 'DG', 'DR', 'AB']);

// Suffix on the Reference No that identifies shipment type.
const SHIPMENT_TYPE_BY_SUFFIX = {
  DOI: 'domestic',          // مطابق ZDOI
  DCF: 'domestic_other',    // مطابق ZDCF
  IBI: 'international_in',  // مطابق ZIBI
  OBI: 'international_out', // مطابق ZOBI
};

const isDate   = (s) => /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(String(s).trim());
const isAmount = (s) => /^\(?\s*-?[\d,]+\.\d{2}\s*\)?$/.test(String(s).trim());
const isDocNo  = (s) => /^\d{6,}$/.test(String(s).trim());

function parseDate(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
}

function parseAmount(s) {
  if (s == null || s === '') return 0;
  const text = String(s).trim();
  const negative = /^\(.*\)$/.test(text); // (1,234.00) → negative
  const cleaned = text.replace(/[(),\s]/g, '');
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}

function shipmentTypeFromReference(ref) {
  if (!ref) return null;
  const m = String(ref).match(/-([A-Z]{3})$/);
  if (!m) return null;
  return SHIPMENT_TYPE_BY_SUFFIX[m[1]] ?? null;
}

// ─── Cluster page text items into rows ───────────────────────────────────────
async function getRowsFromPdf(arrayBuffer) {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const allItems = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    for (const item of content.items) {
      const str = (item.str ?? '').trim();
      if (!str) continue;
      allItems.push({
        page: i,
        x: item.transform[4],
        y: item.transform[5],
        str,
      });
    }
  }
  // Sort top-to-bottom across pages, then cluster.
  allItems.sort((a, b) => a.page - b.page || b.y - a.y);

  const rows = [];
  let currentRow = null;
  for (const it of allItems) {
    if (
      !currentRow
      || currentRow.page !== it.page
      || currentRow.y - it.y > Y_CLUSTER_TOLERANCE
    ) {
      currentRow = { page: it.page, y: it.y, items: [] };
      rows.push(currentRow);
    }
    currentRow.items.push(it);
  }
  // Sort each row's items left-to-right.
  for (const r of rows) r.items.sort((a, b) => a.x - b.x);
  return rows;
}

// ─── Header extraction ──────────────────────────────────────────────────────
function parseHeader(rows) {
  const header = {
    accountNumber: null,
    periodFrom:    null,
    periodTo:      null,
    customer:      null,
    vatNo:         null,
    creditTerms:   null,
  };
  for (const row of rows) {
    const text = row.items.map(i => i.str).join(' ');

    // Account Number 72728969
    if (header.accountNumber == null) {
      const m = text.match(/Account\s*Number[\s:|]*(\d+)/i);
      if (m) header.accountNumber = m[1];
    }

    // Statement Date 01.01.2026-04.05.2026
    if (header.periodFrom == null) {
      const m = text.match(/Statement\s*Date[\s:|]*(\d{1,2}\.\d{1,2}\.\d{4})\s*-\s*(\d{1,2}\.\d{1,2}\.\d{4})/i);
      if (m) {
        header.periodFrom = parseDate(m[1]);
        header.periodTo   = parseDate(m[2]);
      }
    }

    // Credit terms 30 days
    if (header.creditTerms == null) {
      const m = text.match(/Credit\s*terms[\s:|]*([\d]+\s*days?)/i);
      if (m) header.creditTerms = m[1];
    }

    // VAT Reg No
    if (header.vatNo == null) {
      const m = text.match(/VAT\s*Reg\s*No[\s:|]*(\d+)/i);
      if (m) header.vatNo = m[1];
    }

    // Customer name — use the cell that appears alongside "Account Number".
    // The customer name and the account-number row are clustered together.
    if (header.customer == null && /Account\s*Number/i.test(text)) {
      const before = row.items
        .filter(i => !/Account\s*Number/i.test(i.str) && !/^\d+$/.test(i.str))
        .map(i => i.str).join(' ').trim();
      if (before) header.customer = before;
    }
  }
  return header;
}

// ─── Operation row parser ────────────────────────────────────────────────────
function parseOperationRow(cells) {
  if (cells.length < 6) return null;
  if (!isDocNo(cells[0])) return null;
  if (!DOC_TYPES.has(cells[1])) return null;

  const docNo       = cells[0];
  const docType     = cells[1];
  const referenceNo = cells[2];
  const rest        = cells.slice(3);

  let docDate = null, dueDate = null;
  let i = 0;
  if (i < rest.length && isDate(rest[i])) { docDate = rest[i]; i++; }
  if (i < rest.length && isDate(rest[i])) { dueDate = rest[i]; i++; }

  const amountTokens = rest.slice(i).filter(isAmount);
  if (amountTokens.length < 3) return null;

  // After due-date comes DR, CR, Balance. Some rows may have extra noise after
  // the balance — take the last three numeric tokens defensively.
  const tail = amountTokens.slice(-3);
  const dr      = parseAmount(tail[0]);
  const cr      = parseAmount(tail[1]);
  const balance = parseAmount(tail[2]);

  return {
    docNo,
    docType,
    referenceNo,
    docDate:      parseDate(docDate),
    dueDate:      parseDate(dueDate),
    dr,
    cr,
    balance,
    shipmentType: shipmentTypeFromReference(referenceNo),
  };
}

// ─── Totals + aging ──────────────────────────────────────────────────────────
function parseTotals(rows) {
  const totals = {
    totalBalance: null,
    aging: { d0_30: null, d31_60: null, d61_90: null, over90: null },
  };
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const text = row.items.map(i => i.str).join(' ');

    // Total Balance 149,986.29 SAR  (sometimes the value sits on the next row)
    if (totals.totalBalance == null && /Total\s*Balance/i.test(text)) {
      // Try same row first
      const sameRowAmount = row.items.find(i => isAmount(i.str));
      if (sameRowAmount) totals.totalBalance = parseAmount(sameRowAmount.str);
      // Else look at the next row
      else if (rows[r + 1]) {
        const next = rows[r + 1].items.find(i => isAmount(i.str));
        if (next) totals.totalBalance = parseAmount(next.str);
      }
    }

    // Aging buckets header — values land on the next row right after `SAR`.
    if (/To\s*30Days/i.test(text) && /31\s*To\s*60Days/i.test(text)) {
      const next = rows[r + 1];
      if (next) {
        const nums = next.items
          .filter(i => isAmount(i.str))
          .map(i => parseAmount(i.str));
        if (nums.length >= 4) {
          const [a, b, c, d] = nums.slice(-4);
          totals.aging = { d0_30: a, d31_60: b, d61_90: c, over90: d };
        }
      }
    }
  }
  return totals;
}

// ─── Main entry ──────────────────────────────────────────────────────────────
export async function parseAramexStatement(arrayBuffer) {
  const rows = await getRowsFromPdf(arrayBuffer);
  const header = parseHeader(rows);

  const operations = [];
  for (const row of rows) {
    const cells = row.items.map(i => i.str);
    const op = parseOperationRow(cells);
    if (op) operations.push(op);
  }

  const totals = parseTotals(rows);
  return { header, operations, totals };
}

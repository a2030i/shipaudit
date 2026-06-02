// ─────────────────────────────────────────────────────────────────────────────
//  SMSA Express Statement-of-Account PDF parser
//
//  Mirrors aramexStatementParser.js — reads the PDF in the browser
//  (pdfjs-dist), clusters text into rows by Y-coordinate, and extracts
//  header / operations / totals into the SAME shape saveCarrierStatement
//  consumes:
//    { header:     { accountNumber, customer, vatNo, periodFrom, periodTo, creditTerms },
//      operations: [{ docNo, docType, referenceNo, docDate, dueDate, dr, cr, balance, shipmentType }],
//      totals:     { totalBalance, aging } }
//
//  SMSA layout (verified against the operator's sample, 2026-06):
//    • Header:  "STATEMENT OF ACCOUNT AS ON DD-MM-YYYY" + "Customer Number : RX####"
//    • Columns: Date | Doc Type | Document Number | Ref | Details | Amount | Amount Applied | Balance
//    • Doc types seen: COD (positive charge), CM (credit memo, negative)
//    • Dates are DD-MM-YYYY (dashes — Aramex uses dots)
//    • Negatives are EXPLICIT (-298.00), not parenthesised like Aramex
//    • No aging table.
//
//  DR/CR mapping — we key on the per-row **Balance** column (the open
//  amount after "Amount Applied"), NOT the gross "Amount", because the
//  statement's `Total Balance` equals the sum of the Balance column. This
//  makes the imported ledger reconcile to what SMSA says is still open,
//  and gives a meaningful month-over-month diff (a COD line whose balance
//  drops to 0 next statement = it got settled).
// ─────────────────────────────────────────────────────────────────────────────

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerSrc from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

const Y_CLUSTER_TOLERANCE = 3;

// Document types recognised in SMSA statements. Kept permissive — any
// 2-4 uppercase-letter token in the doc-type column is accepted, but we
// whitelist the known ones for confidence.
const KNOWN_DOC_TYPES = new Set(['COD', 'CM', 'INV', 'DN', 'CN', 'RV', 'PV']);

const isDate   = (s) => /^\d{1,2}-\d{1,2}-\d{4}$/.test(String(s).trim());
const isAmount = (s) => /^-?[\d,]+\.\d{2}$/.test(String(s).trim());
const isDocType = (s) => /^[A-Z]{2,4}$/.test(String(s).trim());

function parseDate(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function parseAmount(s) {
  if (s == null || s === '') return 0;
  const n = parseFloat(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
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
      allItems.push({ page: i, x: item.transform[4], y: item.transform[5], str });
    }
  }
  allItems.sort((a, b) => a.page - b.page || b.y - a.y);

  const rows = [];
  let currentRow = null;
  for (const it of allItems) {
    if (!currentRow || currentRow.page !== it.page || currentRow.y - it.y > Y_CLUSTER_TOLERANCE) {
      currentRow = { page: it.page, y: it.y, items: [] };
      rows.push(currentRow);
    }
    currentRow.items.push(it);
  }
  for (const r of rows) r.items.sort((a, b) => a.x - b.x);
  return rows;
}

// ─── Header extraction ──────────────────────────────────────────────────────
function parseHeader(rows) {
  const header = {
    accountNumber: null, customer: null, vatNo: null,
    periodFrom: null, periodTo: null, creditTerms: null,
  };
  for (const row of rows) {
    const text = row.items.map(i => i.str).join(' ');

    // Customer Number : RX8668
    if (header.accountNumber == null) {
      const m = text.match(/Customer\s*Number[\s:]*([A-Z0-9]+)/i);
      if (m) header.accountNumber = m[1];
    }
    // Customer Name : For Tech ...
    if (header.customer == null) {
      const m = text.match(/Customer\s*Name[\s:]*(.+?)\s*$/i);
      if (m && m[1].trim()) header.customer = m[1].trim();
    }
    // Customer VAT Number : 311862242600003 (prefer the customer's, not SMSA's)
    if (header.vatNo == null) {
      const m = text.match(/Customer\s*VAT\s*Number[\s:]*(\d+)/i);
      if (m) header.vatNo = m[1];
    }
    // STATEMENT OF ACCOUNT AS ON 02-06-2026 — single "as on" date.
    if (header.periodTo == null) {
      const m = text.match(/AS\s*ON\s*(\d{1,2}-\d{1,2}-\d{4})/i);
      if (m) header.periodTo = parseDate(m[1]);
    }
  }
  return header;
}

// ─── Operation row parser ────────────────────────────────────────────────────
// SMSA row shape: <date> <docType> <docNo> [ref/details…] <Amount> <Applied> <Balance>
function parseOperationRow(cells) {
  if (cells.length < 5) return null;
  if (!isDate(cells[0])) return null;
  if (!isDocType(cells[1])) return null;

  const docDate = cells[0];
  const docType = cells[1];
  const docNo   = String(cells[2] ?? '').trim();
  if (!docNo) return null;

  // The trailing three numeric tokens are Amount, Amount Applied, Balance.
  const amountTokens = cells.slice(3).filter(isAmount);
  if (amountTokens.length < 3) return null;
  const tail = amountTokens.slice(-3);
  const amount  = parseAmount(tail[0]);   // gross transaction (signed)
  const applied = parseAmount(tail[1]);   // payments/credits already applied
  const balance = parseAmount(tail[2]);   // open amount on this doc (signed)

  // Anything between docNo and the first amount is the Ref/Details text.
  const firstAmountIdx = cells.findIndex((c, i) => i >= 3 && isAmount(c));
  const referenceNo = cells.slice(3, firstAmountIdx > 3 ? firstAmountIdx : 3)
    .join(' ').trim() || null;

  // DR/CR keyed on the OPEN balance so the ledger reconciles to Total Balance.
  const dr = balance > 0 ? balance : 0;
  const cr = balance < 0 ? Math.abs(balance) : 0;

  return {
    docNo,
    docType: KNOWN_DOC_TYPES.has(docType) ? docType : docType,
    referenceNo,
    docDate: parseDate(docDate),
    dueDate: null,                     // SMSA prints one date; service derives due_date
    dr,
    cr,
    balance,
    shipmentType: null,
    // Extra detail preserved for traceability / future use (ignored by save).
    grossAmount: amount,
    appliedAmount: applied,
  };
}

// ─── Totals ──────────────────────────────────────────────────────────────────
function parseTotals(rows) {
  const totals = {
    totalBalance: null,
    aging: { d0_30: null, d31_60: null, d61_90: null, over90: null },
  };
  for (let r = 0; r < rows.length; r++) {
    const text = rows[r].items.map(i => i.str).join(' ');
    if (totals.totalBalance == null && /Total\s*Balance/i.test(text)) {
      const sameRow = rows[r].items.filter(i => isAmount(i.str));
      if (sameRow.length) {
        totals.totalBalance = parseAmount(sameRow[sameRow.length - 1].str);
      } else if (rows[r + 1]) {
        const next = rows[r + 1].items.filter(i => isAmount(i.str));
        if (next.length) totals.totalBalance = parseAmount(next[next.length - 1].str);
      }
    }
  }
  return totals;
}

// ─── Main entry ──────────────────────────────────────────────────────────────
export async function parseSmsaStatement(arrayBuffer) {
  const rows = await getRowsFromPdf(arrayBuffer);
  const header = parseHeader(rows);

  const operations = [];
  for (const row of rows) {
    const op = parseOperationRow(row.items.map(i => i.str));
    if (op) operations.push(op);
  }

  const totals = parseTotals(rows);
  return { header, operations, totals };
}

// Content-based carrier detection — reads page-1 text and identifies which
// carrier issued the statement, so the page routes to the right
// deterministic parser even if the operator picked the wrong carrier in
// the dropdown. Returns 'smsa' | 'aramex' | null.
export async function sniffStatementCarrier(arrayBuffer) {
  try {
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(1);
    const content = await page.getTextContent();
    const text = content.items.map(i => i.str).join(' ');
    if (/SMSA\s*Express/i.test(text) || /smsaexpress\.com/i.test(text)) return 'smsa';
    if (/Aramex/i.test(text)) return 'aramex';
  } catch { /* detection is best-effort */ }
  return null;
}

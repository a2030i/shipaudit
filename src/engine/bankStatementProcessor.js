import * as XLSX from 'xlsx';

// ─────────────────────────────────────────────────────────────────────────────
//  Bank-statement processor (tuned for Bank Alinma exports, but generic enough
//  for any sheet that has dated rows with separate Credit / Debit columns).
//
//  Public API:
//    parseExcelFile(arrayBuffer)  → { transactions, summary, hiddenFees }
//    generateCleanExcel(transactions, summary?)  → ArrayBuffer
// ─────────────────────────────────────────────────────────────────────────────

const VAT_RATE = 0.15;

// Column-header keyword map (Arabic + English fallbacks)
const HEADER_KEYWORDS = {
  date:        [/تاريخ/i, /^date$/i, /transaction.?date/i],
  ref:         [/رقم.?مرجعي/i, /مرجع/i, /reference/i, /^ref/i],
  desc:        [/وصف/i, /البيان/i, /description/i, /details/i, /narration/i],
  credit:      [/^دائن$/i, /credit/i, /^cr$/i],
  debit:       [/^مدين$/i, /debit/i, /^dr$/i],
  fees:        [/الرسوم/i, /^رسوم$/i, /fees?$/i, /charges/i],
  tax:         [/الضريبة/i, /^ضريبة$/i, /^vat$/i, /tax/i],
};

// Try to match an Excel header cell against a keyword group
function matchKeyword(cell, patterns) {
  const text = String(cell ?? '').trim();
  if (!text) return false;
  return patterns.some(p => p.test(text));
}

/**
 * Scan the first ~20 rows looking for the row that contains column headers.
 * Returns null if not found.
 */
export function detectColumnsByHeader(rows) {
  for (let i = 0; i < Math.min(20, rows.length); i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const map = { headerRow: i };
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (matchKeyword(cell, HEADER_KEYWORDS.date)   && map.dateCol   == null) map.dateCol   = c;
      if (matchKeyword(cell, HEADER_KEYWORDS.ref)    && map.refCol    == null) map.refCol    = c;
      if (matchKeyword(cell, HEADER_KEYWORDS.desc)   && map.descCol   == null) map.descCol   = c;
      if (matchKeyword(cell, HEADER_KEYWORDS.credit) && map.creditCol == null) map.creditCol = c;
      if (matchKeyword(cell, HEADER_KEYWORDS.debit)  && map.debitCol  == null) map.debitCol  = c;
      if (matchKeyword(cell, HEADER_KEYWORDS.fees)   && map.feesCol   == null) map.feesCol   = c;
      if (matchKeyword(cell, HEADER_KEYWORDS.tax)    && map.taxCol    == null) map.taxCol    = c;
    }
    // We need at least date + (credit or debit) to consider the row a header.
    if (map.dateCol != null && (map.creditCol != null || map.debitCol != null)) {
      return map;
    }
  }
  return null;
}

// ─── Summary extraction ───────────────────────────────────────────────────────
// Pull the closing balance and period (from – to dates) out of any header rows.
const CLOSING_PATTERNS = [
  /رصيد.?الإقفال/i, /رصيد.?الاقفال/i,
  /الرصيد.?الختامي/i, /الرصيد.?الحالي/i,
  /closing.?balance/i, /ending.?balance/i,
];
const PERIOD_PATTERNS = [
  /تاريخ.?كشف.?الحساب/i, /statement.?date/i, /statement.?period/i,
  /الفترة/i, /فترة/i, /period/i, /from/i, /إلى/i, /to/i,
];

// Extract every ISO-ish date from a string. Handles "2026-04-01 - 2026-04-30",
// "01/04/2026 to 30/04/2026", etc.
function findAllDatesInText(text) {
  const out = [];
  if (!text) return out;
  const s = String(text);
  // ISO YYYY-MM-DD or YYYY/MM/DD
  for (const m of s.matchAll(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/g)) {
    out.push(`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`);
  }
  // DMY: DD/MM/YYYY or DD-MM-YYYY
  for (const m of s.matchAll(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/g)) {
    out.push(`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`);
  }
  return out;
}

function parseDateCell(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    // Excel serial date → ISO date
    return new Date(Math.round((v - 25569) * 86400 * 1000)).toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  // Try common forms: 2026-04-01, 01/04/2026, 01-04-2026
  const isoMatch = s.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2].padStart(2,'0')}-${isoMatch[3].padStart(2,'0')}`;
  const dmyMatch = s.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmyMatch) return `${dmyMatch[3]}-${dmyMatch[2].padStart(2,'0')}-${dmyMatch[1].padStart(2,'0')}`;
  return s.length <= 10 ? s : null;
}

function parseNumber(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  // Strip currency symbols / Arabic digits / commas / spaces
  const cleaned = String(v)
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[^\d.\-]/g, '')
    .trim();
  if (!cleaned || cleaned === '-' || cleaned === '.') return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function extractSummaryFromRows(rows, headerRowIndex) {
  const summary = { closingBalance: null, periodFrom: null, periodTo: null };
  const limit = headerRowIndex != null ? headerRowIndex : Math.min(20, rows.length);

  for (let i = 0; i < limit; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const joined = row.map(c => String(c ?? '').trim()).join(' | ');

    // Closing balance — find the cell containing the label, then look in cells
    // *before* it (RTL layouts put the value to the left of the label).
    if (summary.closingBalance == null && CLOSING_PATTERNS.some(p => p.test(joined))) {
      let labelIdx = -1;
      for (let c = 0; c < row.length; c++) {
        const cell = String(row[c] ?? '');
        if (CLOSING_PATTERNS.some(p => p.test(cell))) { labelIdx = c; break; }
      }
      if (labelIdx > 0) {
        for (let c = labelIdx - 1; c >= 0; c--) {
          const n = parseNumber(row[c]);
          if (n != null && Math.abs(n) > 0.01) { summary.closingBalance = n; break; }
        }
      }
      // Fallback: first numeric on the row
      if (summary.closingBalance == null) {
        for (const cell of row) {
          const n = parseNumber(cell);
          if (n != null && Math.abs(n) > 0.01) { summary.closingBalance = n; break; }
        }
      }
    }

    // Period — extract every date in every cell text (handles both
    // "2026-04-01 - 2026-04-30" in one cell and dates in separate cells).
    if ((summary.periodFrom == null || summary.periodTo == null)
        && PERIOD_PATTERNS.some(p => p.test(joined))) {
      const dates = [];
      for (const cell of row) {
        if (cell == null) continue;
        if (typeof cell === 'number') {
          const d = parseDateCell(cell);
          if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) dates.push(d);
        } else {
          dates.push(...findAllDatesInText(cell));
        }
      }
      if (dates.length >= 2) {
        const sorted = [...dates].sort();
        summary.periodFrom = sorted[0];
        summary.periodTo   = sorted[sorted.length - 1];
      } else if (dates.length === 1) {
        summary.periodFrom = summary.periodFrom ?? dates[0];
      }
    }
  }
  return summary;
}

// ─── Fee + tax extraction from description ────────────────────────────────────
// Saudi banks write fees inline in several flavours:
//   "الرسوم SAR50.00 ضريبة القيمة المضافة SAR7.50"     ← Bank Alinma export
//   "رسوم: 8.70 ر.س ضريبة القيمة المضافة: 1.30 ر.س"    ← spec example
// The regex below tolerates an optional currency token (SAR / ر.س / SR / VAT)
// and any combination of separators (`:`, `،`, `-`, whitespace) between the
// keyword and the number.
const CURRENCY_TOKEN = '(?:SAR|SR|ر\\.?\\s?س|ر\\.?\\س|VAT|﷼)?';

function extractFeesFromDescription(desc) {
  if (!desc) return { fees: 0, tax: 0 };
  const text = String(desc);
  let fees = 0, tax = 0;

  // Match `الرسوم` only when it's the standalone fee marker, not when it
  // appears in phrases like `بغرض الرسوم...`. Anchor to a word break before it.
  const feeRe = new RegExp(`(?:^|[\\s\\(\\)،,])الرسوم\\s*${CURRENCY_TOKEN}\\s*[:،\\-]?\\s*([\\d.,]+)`, 'i');
  const feeMatch = text.match(feeRe);
  if (feeMatch) fees = parseNumber(feeMatch[1]) || 0;

  // VAT: prefer the explicit `ضريبة القيمة المضافة` phrase to avoid grabbing
  // unrelated `الضريبة` mentions elsewhere.
  const taxRe = new RegExp(`ضريبة(?:\\s+القيمة\\s+المضافة)?\\s*${CURRENCY_TOKEN}\\s*[:،\\-]?\\s*([\\d.,]+)`, 'i');
  const taxMatch = text.match(taxRe) || text.match(/vat\s*[:،\-]?\s*([\d.,]+)/i);
  if (taxMatch) tax = parseNumber(taxMatch[1]) || 0;

  return { fees, tax };
}

// ─── Main parser ──────────────────────────────────────────────────────────────
export function parseAlinmaFormat(rows, colMap) {
  const transactions = [];
  let hiddenFees = 0;

  for (let i = colMap.headerRow + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    if (row.every(c => c == null || c === '')) continue;

    const dateRaw = colMap.dateCol != null ? row[colMap.dateCol] : null;
    const date    = parseDateCell(dateRaw);
    const ref     = colMap.refCol  != null ? String(row[colMap.refCol]  ?? '').trim() : '';
    const desc    = colMap.descCol != null ? String(row[colMap.descCol] ?? '').trim() : '';
    // Banks often store debits as signed negatives (e.g. -155.25). Convert to
    // positive magnitude so totals and the "مدين" column read correctly.
    const creditRaw = colMap.creditCol != null ? parseNumber(row[colMap.creditCol]) : null;
    const debitRaw  = colMap.debitCol  != null ? parseNumber(row[colMap.debitCol])  : null;
    const credit  = creditRaw != null ? Math.abs(creditRaw) : null;
    const debit   = debitRaw  != null ? Math.abs(debitRaw)  : null;
    const colFees = colMap.feesCol   != null ? parseNumber(row[colMap.feesCol])   : null;
    const colTax  = colMap.taxCol    != null ? parseNumber(row[colMap.taxCol])    : null;

    // Skip rows with no money on either side
    if (credit == null && debit == null) continue;

    // Hidden-fees rule: rows with no description (or near-empty) get aggregated
    // separately and dropped from the displayed table.
    if (!desc || desc.length < 3) {
      hiddenFees += Math.abs((debit ?? 0) || (credit ?? 0));
      continue;
    }

    // Fee + tax: prefer dedicated columns, fall back to inline description.
    let fees = colFees ?? 0;
    let tax  = colTax  ?? 0;
    if (!fees && !tax) {
      const extracted = extractFeesFromDescription(desc);
      fees = extracted.fees;
      tax  = extracted.tax;
    }
    // If only fees present without tax, compute the 15% VAT.
    if (fees > 0 && tax === 0) tax = +(fees * VAT_RATE).toFixed(2);

    const feesRemoved = +(fees + tax).toFixed(2);

    // Net debit = gross debit minus the bundled fee+tax (if any).
    let netDebit = debit;
    if (debit != null && feesRemoved > 0) netDebit = +(debit - feesRemoved).toFixed(2);

    transactions.push({
      date:         date ?? '',
      reference:    ref,
      description:  desc,
      credit:       credit,
      debit:        netDebit,
      fees:         +fees.toFixed(2),
      tax:          +tax.toFixed(2),
      feesRemoved,
    });
  }

  // Sort: debit rows first (ascending date), then credit rows (ascending date).
  transactions.sort((a, b) => {
    const aDebit = a.debit != null && a.debit !== 0;
    const bDebit = b.debit != null && b.debit !== 0;
    if (aDebit !== bDebit) return aDebit ? -1 : 1;
    return (a.date || '').localeCompare(b.date || '');
  });

  return { transactions, hiddenFees };
}

/**
 * Top-level entry point.
 * @param {ArrayBuffer} arrayBuffer  the binary Excel/CSV content
 * @returns {{transactions: Array, summary: Object, hiddenFees: number}}
 */
export function parseExcelFile(arrayBuffer) {
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows  = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  const colMap = detectColumnsByHeader(rows);
  if (!colMap) {
    throw new Error('تعذّر التعرف على أعمدة كشف الحساب — تأكّد أن الملف من بنك الإنماء أو يحتوي على أعمدة: التاريخ، مرجع، وصف، دائن، مدين.');
  }

  const summary = extractSummaryFromRows(rows, colMap.headerRow);
  const { transactions, hiddenFees } = parseAlinmaFormat(rows, colMap);

  return { transactions, summary, hiddenFees };
}

// ─── Clean Excel export ───────────────────────────────────────────────────────
/**
 * Build an "كشف صافي" workbook from the parsed transactions.
 * Returns the raw bytes so the caller can wrap it in a Blob and download.
 */
export function generateCleanExcel(transactions, summary = {}) {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Summary
  const summaryRows = [
    ['ملخص الكشف'],
    ['الرصيد الختامي', summary.closingBalance ?? ''],
    ['الفترة من',      summary.periodFrom    ?? ''],
    ['الفترة إلى',     summary.periodTo      ?? ''],
    ['عدد العمليات',   transactions.length],
    [],
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, summarySheet, 'الملخص');

  // Sheet 2: Transactions
  const txRows = transactions.map(t => ({
    'التاريخ':       t.date,
    'الرقم المرجعي': t.reference,
    'الوصف':         t.description,
    'دائن':          t.credit,
    'مدين (صافي)':   t.debit,
    'الرسوم':        t.fees,
    'الضريبة (15%)': t.tax,
  }));
  const txSheet = XLSX.utils.json_to_sheet(txRows);
  XLSX.utils.book_append_sheet(wb, txSheet, 'العمليات');

  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}

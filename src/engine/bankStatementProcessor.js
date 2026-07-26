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
  date:        [/تاريخ/i, /date/i],
  ref:         [/رقم.?مرجعي/i, /مرجع/i, /reference/i, /^ref/i, /transaction.?id/i, /unique.?id/i],
  desc:        [/وصف/i, /البيان/i, /description/i, /details/i, /narration/i],
  credit:      [/^دائن$/i, /credit/i, /^cr$/i],
  debit:       [/^مدين$/i, /debit/i, /^dr$/i],
  fees:        [/الرسوم/i, /^رسوم$/i, /fees?$/i, /charges/i],
  tax:         [/الضريبة/i, /^ضريبة$/i, /^vat$/i, /tax/i],
  type:        [/transaction.?type/i, /نوع.?العملية/i, /^النوع$/i],
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
      if (matchKeyword(cell, HEADER_KEYWORDS.type)   && map.typeCol   == null) map.typeCol   = c;
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
// إجماليات البنك المطبوعة في الترويسة — تُستخدَم للتحقّق فقط (لا تُنسَخ كأرقامنا):
// نجمع العمليات بأنفسنا ونقارن الناتج بهذه لإثبات أننا التقطنا كل العملية.
const TOTAL_CREDIT_PATTERNS  = [/مجموع.?مبلغ.?الا?يداعات/i, /مجموع.?الإيداعات/i, /total.?credit/i];
const TOTAL_DEBIT_PATTERNS   = [/مجموع.?مبلغ.?الخصومات/i, /مجموع.?مبلغ.?السحوبات/i, /total.?debit/i];
const DEPOSIT_COUNT_PATTERNS  = [/عدد.?الإيداعات/i, /عدد.?الايداعات/i, /number.?of.?deposits/i];
const WITHDRAW_COUNT_PATTERNS = [/عدد.?السحوبات/i, /number.?of.?withdraw/i];

// القيمة قبل خلية العنوان (RTL: القيمة يسار العنوان = فهرس أقل).
function valueBeforeLabel(row, patterns, { integer = false } = {}) {
  let labelIdx = -1;
  for (let c = 0; c < row.length; c++) {
    if (patterns.some(p => p.test(String(row[c] ?? '')))) { labelIdx = c; break; }
  }
  if (labelIdx < 0) return null;
  // قبل العنوان (RTL) ثم بعده (LTR كـSiFi) — أرقام نظيفة فقط.
  for (let c = labelIdx - 1; c >= 0; c--) {
    const n = cleanNumber(row[c]);
    if (n != null && (integer ? Math.abs(n) >= 0 : Math.abs(n) > 0.01)) {
      if (integer && !Number.isInteger(n)) continue;
      return n;
    }
  }
  for (let c = labelIdx + 1; c < row.length; c++) {
    const n = cleanNumber(row[c]);
    if (n != null && (integer ? Math.abs(n) >= 0 : Math.abs(n) > 0.01)) {
      if (integer && !Number.isInteger(n)) continue;
      return n;
    }
  }
  return null;
}

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
  if (v instanceof Date) return v.toISOString().slice(0, 10);
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

// رقم «نظيف» فقط: خلية رقمية فعلية أو نصّ رقمي محض — لا يلتقط أرقاماً مدفونة في
// نصّ عنوان مثل «Closing Balance as of 26 Jul, 2026» (يمنع 262026 الوهمي).
function cleanNumber(cell) {
  if (typeof cell === 'number') return cell;
  const s = String(cell ?? '').replace(/\s/g, '').trim();
  if (/^-?[\d,]+(\.\d+)?$/.test(s)) return parseNumber(s);
  return null;
}

// الوقت الكامل (ISO) حين يوفّره الكشف: SiFi يضع الوقت في الجزء الكسري من الرقم
// التسلسلي. يُستخدَم لترتيب تسلسل العمليات داخل اليوم. null للتاريخ بلا وقت.
function parseDateTimeCell(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'number') {
    // كسر غير صفري = وقت فعلي؛ عدد صحيح = تاريخ فقط (لا وقت مفيد للترتيب)
    if (Number.isInteger(v)) return null;
    return new Date(Math.round((v - 25569) * 86400 * 1000)).toISOString();
  }
  return null;
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
  const summary = {
    closingBalance: null, periodFrom: null, periodTo: null,
    // إجماليات البنك المطبوعة (مرجع تحقّق فقط)
    bankTotalCredit: null, bankTotalDebit: null,
    bankDepositCount: null, bankWithdrawCount: null,
  };
  const limit = headerRowIndex != null ? headerRowIndex : Math.min(20, rows.length);

  for (let i = 0; i < limit; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const joined = row.map(c => String(c ?? '').trim()).join(' | ');

    // إجماليات البنك المطبوعة + العدّادات (للمطابقة مع مجموع عملياتنا)
    if (summary.bankTotalCredit == null && TOTAL_CREDIT_PATTERNS.some(p => p.test(joined)))
      summary.bankTotalCredit = valueBeforeLabel(row, TOTAL_CREDIT_PATTERNS);
    if (summary.bankTotalDebit == null && TOTAL_DEBIT_PATTERNS.some(p => p.test(joined)))
      summary.bankTotalDebit = valueBeforeLabel(row, TOTAL_DEBIT_PATTERNS);
    if (summary.bankDepositCount == null && DEPOSIT_COUNT_PATTERNS.some(p => p.test(joined)))
      summary.bankDepositCount = valueBeforeLabel(row, DEPOSIT_COUNT_PATTERNS, { integer: true });
    if (summary.bankWithdrawCount == null && WITHDRAW_COUNT_PATTERNS.some(p => p.test(joined)))
      summary.bankWithdrawCount = valueBeforeLabel(row, WITHDRAW_COUNT_PATTERNS, { integer: true });

    // Closing balance — find the cell containing the label, then look in cells
    // *before* it (RTL layouts put the value to the left of the label).
    if (summary.closingBalance == null && CLOSING_PATTERNS.some(p => p.test(joined))) {
      let labelIdx = -1;
      for (let c = 0; c < row.length; c++) {
        const cell = String(row[c] ?? '');
        if (CLOSING_PATTERNS.some(p => p.test(cell))) { labelIdx = c; break; }
      }
      // القيمة قبل العنوان (RTL كالإنماء) ثم بعده (LTR كـSiFi) — أرقام نظيفة فقط
      // (cleanNumber يتجاهل الأرقام المدفونة في نصّ العنوان مثل «26 Jul, 2026»).
      for (let c = labelIdx - 1; c >= 0 && summary.closingBalance == null; c--) {
        const n = cleanNumber(row[c]); if (n != null && Math.abs(n) > 0.01) summary.closingBalance = n;
      }
      for (let c = labelIdx + 1; c < row.length && summary.closingBalance == null; c++) {
        const n = cleanNumber(row[c]); if (n != null && Math.abs(n) > 0.01) summary.closingBalance = n;
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

  // كلمة الرسوم تختلف بين صيغ البنك: الرسوم (عربي) · Fees/Fee · Commission (SWIFT)
  // · charge/charges (SARIE variant). مربوطة بفاصل قبلها لتفادي «surcharge»/«بغرض الرسوم».
  const feeRe = new RegExp(`(?:^|[\\s\\(\\)،,])(?:الرسوم|fees?|commission|charges?)\\s*${CURRENCY_TOKEN}\\s*[:،\\-]?\\s*([\\d.,]+)`, 'i');
  const feeMatch = text.match(feeRe);
  if (feeMatch) fees = parseNumber(feeMatch[1]) || 0;

  // VAT: prefer the explicit `ضريبة القيمة المضافة` phrase to avoid grabbing
  // unrelated `الضريبة` mentions elsewhere. الفرع الإنجليزي يقبل «VAT SAR7.50»
  // (رمز العملة بين VAT والرقم) — كان يفشل بلا CURRENCY_TOKEN.
  const taxRe = new RegExp(`ضريبة(?:\\s+القيمة\\s+المضافة)?\\s*${CURRENCY_TOKEN}\\s*[:،\\-]?\\s*([\\d.,]+)`, 'i');
  const vatRe = new RegExp(`vat\\s*${CURRENCY_TOKEN}\\s*[:،\\-]?\\s*([\\d.,]+)`, 'i');
  const taxMatch = text.match(taxRe) || text.match(vatRe);
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
    const datetime = parseDateTimeCell(dateRaw);   // الوقت الكامل لترتيب التسلسل داخل اليوم
    const ref     = colMap.refCol  != null ? String(row[colMap.refCol]  ?? '').trim() : '';
    let   desc    = colMap.descCol != null ? String(row[colMap.descCol] ?? '').trim() : '';
    // نوع العملية (SiFi: «Local Transfer Fee»/«VAT»/…) يُصدَّر لأول الوصف ليتّضح أن
    // الصفّ رسوم تحويل أو ضريبتها (تتبع التحويل مباشرة بمراجع متتالية).
    const txnType = colMap.typeCol != null ? String(row[colMap.typeCol] ?? '').trim() : '';
    if (txnType && !desc.toLowerCase().includes(txnType.toLowerCase())) desc = desc ? `${txnType} · ${desc}` : txnType;
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

    // Hidden-fees rule: rows with no description (or near-empty) = bank fees
    // without a label. نخزّنها كصفوف رسوم (لا نُسقِطها) ليبقى المحفوظ مطابقاً
    // للمعروض ولا يضيع المبلغ عند الحفظ. hiddenFees يبقى للعرض التحذيري فقط.
    if (!desc || desc.length < 3) {
      const amt = +Math.abs((debit ?? 0) || (credit ?? 0)).toFixed(2);
      hiddenFees += amt;
      transactions.push({
        date: date ?? '', datetime, reference: ref, description: desc || 'رسوم بنكية (بلا وصف)',
        credit: null, debit: 0, fees: amt, tax: 0, feesRemoved: amt,
      });
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
      datetime,
      reference:    ref,
      description:  desc,
      credit:       credit,
      debit:        netDebit,
      fees:         +fees.toFixed(2),
      tax:          +tax.toFixed(2),
      feesRemoved,
    });
  }

  annotateRejected(transactions);

  // Sort: debit rows first (ascending date), then credit rows (ascending date).
  transactions.sort((a, b) => {
    const aDebit = a.debit != null && a.debit !== 0;
    const bDebit = b.debit != null && b.debit !== 0;
    if (aDebit !== bDebit) return aDebit ? -1 : 1;
    return (a.date || '').localeCompare(b.date || '');
  });

  return { transactions, hiddenFees };
}

// ─── Rejected / returned transfers ────────────────────────────────────────────
// When an outgoing transfer fails, the bank re-credits it under the SAME
// reference (e.g. "تم رفض التحويل الدولي بسبب ..."). Both legs net to zero but
// inflate the debit/credit totals. We flag BOTH the original debit and the
// return credit so the UI can mark them (المرفوض) and the user can see the
// net-zero noise for what it is. Works on freshly-parsed rows AND on saved rows
// (identical field names: reference/description/credit/debit).
const REJECT_PATTERNS = /تم\s*رفض|رفض\s*التحويل|مرتجع|عكس\s*قيد|إعادة\s*(?:مبلغ|القيمة)|اعادة\s*(?:مبلغ|القيمة)|رد\s*التحويل|reject|revers|refund|declin/i;
export function annotateRejected(list) {
  if (!Array.isArray(list)) return list;
  for (const t of list) {
    const credit = Number(t.credit) || 0;
    if (credit > 0 && REJECT_PATTERNS.test(t.description || '')) {
      t.rejected = true;
      const ref = String(t.reference ?? '').trim();
      if (ref) {
        const orig = list.find(d =>
          d !== t && String(d.reference ?? '').trim() === ref
          && ((Number(d.debit) || 0) + (Number(d.fees) || 0)) > 0);
        if (orig) orig.rejected = true;
      }
    }
  }
  return list;
}

/**
 * Top-level entry point.
 * @param {ArrayBuffer} arrayBuffer  the binary Excel/CSV content
 * @returns {{transactions: Array, summary: Object, hiddenFees: number}}
 */
// يكشف اسم البنك من محتوى الكشف — لدعم البنوك المتعددة (§multi-bank 2026-07-26).
// SiFi: كشف مبسّط إنجليزي بأعمدة بطاقة. الإنماء: الافتراضي.
export function detectBankName(rows) {
  const text = rows.slice(0, 18).map(r => Array.isArray(r) ? r.map(c => String(c ?? '')).join(' ') : '').join(' ');
  if (/Simplified Account Statement|Card Last 4 Digits|ساي ?فاي|\bsifi\b/i.test(text)) return 'بنك ساي فاي';
  return 'بنك الإنماء';
}

export function parseExcelFile(arrayBuffer) {
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows  = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  const colMap = detectColumnsByHeader(rows);
  if (!colMap) {
    throw new Error('تعذّر التعرف على أعمدة كشف الحساب — تأكّد أن الملف من بنك الإنماء/ساي فاي أو يحتوي على أعمدة: التاريخ، وصف، دائن/مدين (Debit/Credit).');
  }

  const bank = detectBankName(rows);
  const summary = extractSummaryFromRows(rows, colMap.headerRow);
  const { transactions, hiddenFees } = parseAlinmaFormat(rows, colMap);

  // الفترة = نطاق تواريخ العمليات الفعلي (أوثق من ترويسة قد تُخطئ استخراج التاريخ).
  if (transactions.length) {
    const ds = transactions.map(t => t.date).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    if (ds.length) { summary.periodFrom = ds[0]; summary.periodTo = ds[ds.length - 1]; }
  }

  return { transactions, summary, hiddenFees, bank };
}

// ─── Carrier-payment detection ────────────────────────────────────────────────
/**
 * Heuristically match an Arabic+English bank-statement description against a
 * known carrier name list. Returns the carrier_id of the best match, or null.
 *
 * The matcher tokenizes both sides, so "أرامكس" / "ارامكس" / "ARAMEX" /
 * "Aramex Saudi Limited" all light up the same carrier.
 */
function normaliseToken(s) {
  return String(s ?? '')
    .toLowerCase()
    // Strip Arabic diacritics
    .replace(/[ً-ْٰ]/g, '')
    // Normalise common alef variants
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');
}

const MIN_TOKEN_LEN = 3;

function tokensOf(s) {
  return normaliseToken(s).split(/[^\p{L}\p{N}]+/u).filter(t => t.length >= MIN_TOKEN_LEN);
}

export function detectCarrierFromText(text, carriers) {
  if (!text || !carriers?.length) return null;
  const haystack = ' ' + normaliseToken(text) + ' ';
  let best = null;
  for (const c of carriers) {
    const candidates = [c.name, c.id, ...(c.aliases ?? [])];
    let hits = 0;
    for (const cand of candidates) {
      const toks = tokensOf(cand);
      for (const t of toks) {
        if (haystack.includes(' ' + t)) hits += t.length; // longer tokens score higher
      }
    }
    if (hits > 0 && (!best || hits > best.score)) best = { carrierId: c.id, score: hits };
  }
  return best?.carrierId ?? null;
}

/**
 * Walk parsed bank transactions and return the ones that look like outgoing
 * payments to known carriers. Each gets a `matchedCarrier` tag.
 */
export function extractCarrierPayments(transactions, carriers) {
  const out = [];
  for (const t of transactions) {
    const debit = Number(t.debit) || 0;
    if (debit <= 0) continue; // we only care about money leaving the account
    const matchedCarrier = detectCarrierFromText(t.description, carriers);
    if (!matchedCarrier) continue;
    out.push({ ...t, matchedCarrier, grossAmount: debit + (Number(t.feesRemoved) || 0) });
  }
  return out;
}

// ─── Clean Excel export ───────────────────────────────────────────────────────
/**
 * Build an "كشف صافي" workbook from the parsed transactions.
 * Returns the raw bytes so the caller can wrap it in a Blob and download.
 */
export function generateCleanExcel(transactions, _summary = {}) {
  // Single-sheet export matching the layout the user's external
  // financial system parses. Column order, header names, and sheet
  // name are pinned exactly — the summary sheet that used to ride
  // along is gone because it broke their importer's "find header
  // row 0" assumption.
  //
  // Empty cells (vs explicit 0) are intentional: their system reads
  // a missing value as "not applicable" while 0 inflates totals.
  const wb = XLSX.utils.book_new();
  const headers = ['تاريخ العملية', 'وصف العملية', 'دائن', 'مدين', 'الرسوم', 'الضريبة', 'المرجع'];
  const blankIfZero = v => (v == null || Number(v) === 0) ? '' : Number(v);
  // التحويلات المرفوضة/المُرجَعة (قيد مدين + رفض بنفس المرجع) تُحذف من الكشف
  // الصافي — صافيها صفر ولا قيمة لها في النظام المحاسبي الخارجي.
  const rows = transactions.filter(t => !t.rejected).map(t => [
    t.date        ?? '',
    t.description ?? '',
    blankIfZero(t.credit),
    blankIfZero(t.debit),
    blankIfZero(t.fees),
    blankIfZero(t.tax),
    t.reference   ?? '',
  ]);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = [
    { wch: 14 },   // تاريخ العملية
    { wch: 80 },   // وصف العملية
    { wch: 14 },   // دائن
    { wch: 14 },   // مدين
    { wch: 12 },   // الرسوم
    { wch: 12 },   // الضريبة
    { wch: 22 },   // المرجع
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'كشف حساب صافي');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}

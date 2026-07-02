// Statement of Account → Excel exporter.
//
// Builds a single-sheet workbook for the given customer. Sheet
// layout:
//   Rows 1-6:   Header block (company, customer, period, contact)
//   Row 7:      Blank spacer
//   Row 8:      Column headers (التاريخ, البيان, مدين, دائن, الرصيد)
//   Rows 9+:    Transaction lines (oldest first, running balance)
//   Bottom:     Totals + aging breakdown + signature line
//
// One row per invoice (debit) and per write-off (credit). Pure
// data — no formulas — so the accountant can open it in any
// spreadsheet tool.

import * as XLSX from 'xlsx';
import { rtl } from './xlsxRtl.js';
import { loadCustomerSOA } from './customerReceivablesService.js';

const fmtMoney = (n) =>
  (n == null || Number.isNaN(n)) ? ''
  : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const arabicDate = (iso) => {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch { return iso; }
};

export async function exportCustomerSOA(customerName) {
  const soa = await loadCustomerSOA(customerName);
  const aoa = [];

  // ── Header block ───────────────────────────────────────────
  aoa.push(['كشف حساب عميل']);
  aoa.push([]);
  aoa.push(['اسم العميل', soa.header.customerName]);
  if (soa.header.storeId)  aoa.push(['رقم المتجر', soa.header.storeId]);
  if (soa.header.phone)    aoa.push(['رقم الهاتف', soa.header.phone]);
  aoa.push(['كما في تاريخ', arabicDate(soa.header.asOf)]);
  aoa.push(['السقف الائتماني', `${fmtMoney(soa.header.creditLimit)} ر.س`]);
  if (soa.header.creditLimitNote) {
    aoa.push(['ملاحظة على السقف', soa.header.creditLimitNote]);
  }
  aoa.push([]);

  // ── Transactions table ─────────────────────────────────────
  aoa.push(['التاريخ', 'البيان', 'مدين (ر.س)', 'دائن (ر.س)', 'الرصيد (ر.س)']);
  if (soa.lines.length === 0) {
    aoa.push(['', 'لا توجد حركات', '', '', '']);
  } else {
    for (const ln of soa.lines) {
      aoa.push([
        arabicDate(ln.date),
        ln.description,
        ln.debit  > 0 ? fmtMoney(ln.debit)  : '',
        ln.credit > 0 ? fmtMoney(ln.credit) : '',
        fmtMoney(ln.balance),
      ]);
    }
  }
  aoa.push([]);

  // ── Totals ─────────────────────────────────────────────────
  aoa.push(['إجمالي الفواتير',   `${fmtMoney(soa.summary.totalInvoices)} ر.س`]);
  if (soa.summary.totalWrittenOff > 0) {
    aoa.push(['إجمالي الديون المشطوبة', `${fmtMoney(soa.summary.totalWrittenOff)} ر.س`]);
  }
  aoa.push(['الرصيد المستحق', `${fmtMoney(soa.summary.effectiveBalance)} ر.س`]);
  if (soa.summary.overLimit) {
    aoa.push(['⚠ تجاوز السقف', 'الرصيد المستحق يتجاوز السقف الائتماني']);
  }
  aoa.push([]);

  // ── Aging ──────────────────────────────────────────────────
  aoa.push(['تقادم الذمم']);
  aoa.push(['حديث (0–30 يوم)',  fmtMoney(soa.aging.current)]);
  aoa.push(['31–60 يوم',         fmtMoney(soa.aging.d31_60)]);
  aoa.push(['61–90 يوم',         fmtMoney(soa.aging.d61_90)]);
  aoa.push(['+90 يوم',            fmtMoney(soa.aging.d90_plus)]);
  aoa.push([]);

  // ── Signature footer ───────────────────────────────────────
  aoa.push([]);
  aoa.push(['اعتُمد بواسطة:', '____________________']);
  aoa.push(['تاريخ الاعتماد:',  '____________________']);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Column widths — date a bit wider for Arabic month names
  ws['!cols'] = [
    { wch: 26 },  // التاريخ
    { wch: 40 },  // البيان
    { wch: 16 },  // مدين
    { wch: 16 },  // دائن
    { wch: 18 },  // الرصيد
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'كشف الحساب');
  const safeName = customerName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
  const dateStr = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(rtl(wb), `كشف_حساب_${safeName}_${dateStr}.xlsx`);

  return { rowCount: soa.lines.length, balance: soa.summary.effectiveBalance };
}

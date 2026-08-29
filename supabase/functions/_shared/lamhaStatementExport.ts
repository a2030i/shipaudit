type StatementRow = {
  storeId: string;
  storeName: string;
  storeStatus: string | null;
  accountStatus: string | null;
  debit: number | null;
  credit: number | null;
  balance: number | null;
  pending: number | null;
  lastTransactionAt: string | null;
};

const HEADER_ALIASES = {
  storeId: ['#', 'رقم المتجر', 'store id'],
  storeName: ['المتجر', 'اسم المتجر', 'store'],
  storeStatus: ['حالة المتجر', 'store status'],
  accountStatus: ['حالة الحساب', 'account status'],
  debit: ['مدين', 'debit'],
  credit: ['دائن', 'credit'],
  balance: ['الرصيد', 'balance'],
  pending: ['معلّق', 'معلق', 'pending'],
  lastTransactionAt: ['آخر عملية', 'اخر عملية', 'last transaction'],
} as const;

function normalized(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function findColumn(headers: unknown[], aliases: readonly string[]) {
  const normalizedHeaders = headers.map(normalized);
  for (const alias of aliases) {
    const exact = normalizedHeaders.indexOf(normalized(alias));
    if (exact >= 0) return exact;
  }
  return -1;
}

function numberOrNull(value: unknown) {
  if (value == null || String(value).trim() === '') return null;
  const parsed = typeof value === 'number'
    ? value
    : Number(String(value).replace(/[,،\s]/g, ''));
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null;
}

export function parseLamhaStatementExportRows(sheetRows: unknown[][]) {
  if (!Array.isArray(sheetRows) || !sheetRows.length) {
    throw new Error('lamha_statement_export_empty');
  }

  let headerRowIndex = -1;
  let columns: Record<keyof typeof HEADER_ALIASES, number> | null = null;
  for (let index = 0; index < Math.min(sheetRows.length, 15); index += 1) {
    const candidate = sheetRows[index] || [];
    const mapped = Object.fromEntries(
      Object.entries(HEADER_ALIASES).map(([key, aliases]) => [key, findColumn(candidate, aliases)]),
    ) as Record<keyof typeof HEADER_ALIASES, number>;
    if (mapped.storeId >= 0 && mapped.storeName >= 0 && mapped.balance >= 0) {
      headerRowIndex = index;
      columns = mapped;
      break;
    }
  }

  if (!columns) throw new Error('lamha_statement_export_contract_invalid');
  const missing = Object.entries(columns)
    .filter(([, index]) => index < 0)
    .map(([key]) => key);
  if (missing.length) {
    throw new Error(`lamha_statement_export_missing_columns:${missing.join(',')}`);
  }

  const rows: StatementRow[] = [];
  for (const sourceRow of sheetRows.slice(headerRowIndex + 1)) {
    const storeId = String(sourceRow?.[columns.storeId] ?? '').trim();
    const storeName = String(sourceRow?.[columns.storeName] ?? '').trim();
    if (!storeId || !storeName) continue;
    rows.push({
      storeId,
      storeName,
      storeStatus: String(sourceRow[columns.storeStatus] ?? '').trim() || null,
      accountStatus: String(sourceRow[columns.accountStatus] ?? '').trim() || null,
      debit: numberOrNull(sourceRow[columns.debit]),
      credit: numberOrNull(sourceRow[columns.credit]),
      balance: numberOrNull(sourceRow[columns.balance]),
      pending: numberOrNull(sourceRow[columns.pending]),
      lastTransactionAt: String(sourceRow[columns.lastTransactionAt] ?? '').trim() || null,
    });
  }
  if (!rows.length) throw new Error('lamha_statement_export_no_store_rows');

  return {
    headerRowIndex,
    headers: (sheetRows[headerRowIndex] || []).map(value => String(value ?? '').trim()),
    rows,
  };
}

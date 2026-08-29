type ExportRecord = Record<string, unknown>;

const FIELD_ALIASES: Record<string, string[]> = {
  id: ['رقم المتجر', 'store id', 'merchant id'],
  name: ['اسم المتجر', 'store name', 'merchant name'],
  phone: ['رقم الهاتف', 'هاتف', 'phone', 'mobile'],
  shipmentsCount: ['عدد الشحنات', 'shipments', 'shipment count'],
  lastShipmentDate: ['تاريخ اخر شحنة', 'تاريخ آخر شحنة', 'last shipment'],
  integrationType: ['نوع الربط', 'integration'],
  invoiceStatus: ['نوع الفاتورة', 'billing type', 'invoice status'],
  status: ['حالة المتجر', 'store status', 'merchant status'],
  profileStatus: ['حالة الملف الشخصي', 'profile status'],
  vatRegistered: ['مسجل في الضريبة', 'مسجل بالضريبة', 'vat registered', 'tax registered'],
  zatcaCompleted: ['مكمل بيانات زاتكا', 'بيانات زاتكا', 'zatca'],
  verificationStatus: ['حالة التوثيق', 'verification status', 'verified status'],
  joinDate: ['تاريخ الانشاء', 'تاريخ الإنشاء', 'created'],
  lastTopupAt: ['تاريخ اخر شحن رصيد', 'تاريخ آخر شحن رصيد', 'last topup'],
  walletBalance: ['الرصيد الحالي', 'wallet balance', 'wallet'],
};

export const LAMHA_EXPORT_REQUIRED_FIELDS = Object.freeze(Object.keys(FIELD_ALIASES));

function normalizeHeader(value: unknown) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[ـًٌٍَُِّْ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findColumn(header: unknown[], aliases: string[]) {
  const normalizedAliases = aliases.map(normalizeHeader);
  return header.findIndex(value => {
    const normalized = normalizeHeader(value);
    return normalizedAliases.some(alias => normalized === alias || normalized.includes(alias));
  });
}

function detectHeader(rows: unknown[][]) {
  let best = { index: -1, score: 0, columns: {} as Record<string, number> };
  for (let index = 0; index < Math.min(rows.length, 10); index += 1) {
    const header = rows[index] || [];
    const columns: Record<string, number> = {};
    let score = 0;
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      columns[field] = findColumn(header, aliases);
      if (columns[field] >= 0) score += 1;
    }
    if (columns.id >= 0 && columns.name >= 0 && score > best.score) {
      best = { index, score, columns };
    }
  }
  return best;
}

function text(value: unknown) {
  const result = String(value ?? '').trim();
  return result || null;
}

function storeId(value: unknown) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return /^\d+\.0+$/.test(raw) ? raw.replace(/\.0+$/, '') : raw;
}

function number(value: unknown) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function integer(value: unknown) {
  const parsed = number(value);
  return parsed == null ? 0 : Math.max(0, Math.trunc(parsed));
}

function date(value: unknown) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  const parsed = new Date(String(value).trim());
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function boolean(value: unknown) {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1') return true;
  if (value === 0 || value === '0') return false;
  const normalized = normalizeHeader(value);
  if (!normalized) return null;
  if (['نعم', 'yes', 'true', 'مسجل', 'مكتمل', 'موثق'].includes(normalized)) return true;
  if (['لا', 'no', 'false', 'غير مسجل', 'غير مكتمل', 'غير موثق'].includes(normalized)) return false;
  return null;
}

function phone(value: unknown) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
  return text(value);
}

function rawRow(header: unknown[], row: unknown[]) {
  const raw: ExportRecord = {};
  header.forEach((heading, index) => {
    const key = String(heading ?? '').trim();
    if (!key || row[index] == null || row[index] === '') return;
    const value = row[index];
    raw[key] = value instanceof Date ? value.toISOString() : value;
  });
  return raw;
}

export function parseLamhaStoreExportRows(rows: unknown[][]) {
  if (!Array.isArray(rows) || rows.length < 2) throw new Error('lamha_export_empty');
  const detected = detectHeader(rows);
  const missingColumns = LAMHA_EXPORT_REQUIRED_FIELDS.filter(field => detected.columns[field] == null || detected.columns[field] < 0);
  if (detected.index < 0 || missingColumns.length) {
    throw new Error(`lamha_export_missing_columns:${missingColumns.join(',') || 'header'}`);
  }

  const header = rows[detected.index] || [];
  const parsed: ExportRecord[] = [];
  const seen = new Set<string>();
  const duplicateIds = new Set<string>();
  let invalidRows = 0;
  for (let index = detected.index + 1; index < rows.length; index += 1) {
    const row = rows[index] || [];
    const id = storeId(row[detected.columns.id]);
    const name = text(row[detected.columns.name]);
    if (!id && !name) continue;
    if (!id || !name) {
      invalidRows += 1;
      continue;
    }
    if (seen.has(id)) duplicateIds.add(id);
    seen.add(id);
    parsed.push({
      id,
      name,
      phone: phone(row[detected.columns.phone]),
      shipmentsCount: integer(row[detected.columns.shipmentsCount]),
      lastShipmentDate: date(row[detected.columns.lastShipmentDate]),
      integrationType: text(row[detected.columns.integrationType]),
      invoiceStatus: text(row[detected.columns.invoiceStatus]),
      status: text(row[detected.columns.status]),
      profileStatus: text(row[detected.columns.profileStatus]),
      vatRegistered: boolean(row[detected.columns.vatRegistered]),
      zatcaCompleted: boolean(row[detected.columns.zatcaCompleted]),
      verificationStatus: text(row[detected.columns.verificationStatus]),
      joinDate: date(row[detected.columns.joinDate]),
      lastTopupAt: date(row[detected.columns.lastTopupAt]),
      walletBalance: number(row[detected.columns.walletBalance]),
      _export: rawRow(header, row),
    });
  }
  if (!parsed.length) throw new Error('lamha_export_no_store_rows');
  if (invalidRows) throw new Error(`lamha_export_invalid_rows:${invalidRows}`);
  if (duplicateIds.size) throw new Error(`lamha_export_duplicate_store_ids:${duplicateIds.size}`);
  return {
    rows: parsed,
    sourceRowCount: parsed.length,
    headerRow: detected.index,
    detectedColumns: detected.columns,
  };
}

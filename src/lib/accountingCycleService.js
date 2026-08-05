import * as XLSX from 'xlsx';
import { supabase } from './supabase.js';

const PAGE = 1000;
const ARABIC_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

export const ACCOUNTING_CYCLE_STAGES = [
  { id: 'carrier_audits', label: 'مراجعة فواتير شركات الشحن', permission: 'audits.create' },
  { id: 'weight_export', label: 'تصدير أوزان الفوترة إلى لمحة', permission: 'internal_exports.pull' },
  { id: 'lamha_shipments', label: 'استيراد شحنات لمحة', permission: 'uploads.upload_file' },
  { id: 'lamha_sources', label: 'تحديث كشف الحساب ودليل المتاجر', permission: 'uploads.upload_file' },
  { id: 'carrier_collections', label: 'رفع تحصيلات شركات الشحن', permission: 'cod.upload_in' },
  { id: 'lamha_collections', label: 'رفع تحصيل لمحة', permission: 'cod.upload_out' },
  { id: 'period_close', label: 'مراجعة وإقفال الشهر', permission: 'system.period_close' },
];

export function normalizeAccountingPeriod(value = new Date().toISOString().slice(0, 7)) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}$/.test(text)) throw new Error('الفترة يجب أن تكون بصيغة YYYY-MM');
  const month = Number(text.slice(5));
  if (month < 1 || month > 12) throw new Error('شهر غير صالح');
  return text;
}

export function accountingPeriodBounds(value) {
  const period = normalizeAccountingPeriod(value);
  const [year, month] = period.split('-').map(Number);
  const start = `${period}-01`;
  const endDate = new Date(Date.UTC(year, month, 1));
  const end = endDate.toISOString().slice(0, 10);
  return { period, periodDate: start, start, end };
}

export function accountingPeriodAliases(value) {
  const period = normalizeAccountingPeriod(value);
  const [year, month] = period.split('-').map(Number);
  return [period, `${ARABIC_MONTHS[month - 1]} ${year}`];
}

export function auditPeriodMatches(auditPeriod, selectedPeriod) {
  const raw = String(auditPeriod || '').trim();
  if (!raw) return false;
  return accountingPeriodAliases(selectedPeriod).includes(raw);
}

function normalizeHeader(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[ًٌٍَُِّْـ]/g, '')
    .replace(/[()\[\]{}._/\\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const FIELD_ALIASES = {
  orderNo: ['رقم الطلب', 'رقم الاوردر', 'order number', 'order no', 'order id'],
  storeName: ['المتجر', 'اسم المتجر', 'store', 'store name', 'merchant', 'merchant name'],
  orderDate: ['تاريخ الطلب', 'order date', 'created at', 'تاريخ الانشاء'],
  orderAmount: ['مبلغ الطلب', 'قيمه الطلب', 'قيمة الطلب', 'order amount', 'total amount'],
  paymentMethod: ['وسيله الدفع', 'وسيلة الدفع', 'payment method', 'payment type'],
  orderStatus: ['حاله الطلب', 'حالة الطلب', 'order status', 'status'],
  city: ['مدينه الطلب', 'مدينة الطلب', 'city', 'destination city'],
  carrierName: ['شركه الشحن', 'شركة الشحن', 'carrier', 'shipping company', 'courier'],
  customerPhone: ['هاتف العميل', 'رقم جوال العميل', 'customer phone', 'phone', 'mobile'],
  customerName: ['اسم العميل', 'customer name', 'recipient name', 'consignee name'],
  awb: ['رقم البوليصه', 'رقم البوليصة', 'رقم بوليصه', 'رقم الشحنه', 'رقم الشحنة', 'awb', 'tracking number', 'waybill'],
  pickupAt: ['pickup date', 'تاريخ الاستلام من المتجر', 'pickup'],
  deliveredAt: ['delivered date', 'تاريخ التسليم', 'delivery date'],
  shippingCost: ['تكلفه الشحن', 'تكلفة الشحن', 'shipping cost', 'delivery cost'],
};

const NORMALIZED_ALIASES = Object.fromEntries(
  Object.entries(FIELD_ALIASES).map(([key, aliases]) => [key, new Set(aliases.map(normalizeHeader))]),
);

function headerMap(row) {
  const map = {};
  (row || []).forEach((cell, index) => {
    const normalized = normalizeHeader(cell);
    for (const [field, aliases] of Object.entries(NORMALIZED_ALIASES)) {
      if (map[field] == null && aliases.has(normalized)) map[field] = index;
    }
  });
  return map;
}

function findHeader(rows) {
  let best = null;
  for (let index = 0; index < Math.min(rows.length, 30); index += 1) {
    const map = headerMap(rows[index]);
    const score = Object.keys(map).length;
    if (!best || score > best.score) best = { index, map, score, row: rows[index] };
  }
  if (!best || best.score < 5 || best.map.storeName == null || best.map.carrierName == null ||
      (best.map.awb == null && best.map.orderNo == null)) {
    throw new Error('لم أتعرف على أعمدة شحنات لمحة. يلزم: المتجر، شركة الشحن، ورقم الشحنة أو الطلب.');
  }
  return best;
}

function asText(value) {
  if (value == null) return '';
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
  return String(value).trim();
}

function asNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = String(value ?? '').replace(/,/g, '').replace(/[^0-9.+-]/g, '').trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function excelDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number') {
    const parts = XLSX.SSF.parse_date_code(value);
    if (!parts) return null;
    return new Date(Date.UTC(parts.y, parts.m - 1, parts.d, parts.H || 0, parts.M || 0, Math.floor(parts.S || 0)));
  }
  const text = String(value).trim();
  if (!text) return null;
  const parsed = new Date(text.replace(' ', 'T'));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function sourceDateKey(value, parsedDate) {
  if (typeof value === 'string') {
    const match = value.trim().match(/^(\d{4})[-/]([01]?\d)[-/]([0-3]?\d)/);
    if (match) return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}-${String(Number(match[3])).padStart(2, '0')}`;
  }
  if (typeof value === 'number') {
    const parts = XLSX.SSF.parse_date_code(value);
    if (parts) return `${parts.y}-${String(parts.m).padStart(2, '0')}-${String(parts.d).padStart(2, '0')}`;
  }
  return parsedDate ? [parsedDate.getFullYear(), String(parsedDate.getMonth() + 1).padStart(2, '0'), String(parsedDate.getDate()).padStart(2, '0')].join('-') : null;
}

function isoOrNull(value) {
  const date = excelDate(value);
  return date ? date.toISOString() : null;
}

function sheetRows(ws) {
  let maxRow = 0;
  let maxColumn = 0;
  for (const key of Object.keys(ws || {})) {
    if (key.startsWith('!')) continue;
    const cell = XLSX.utils.decode_cell(key);
    maxRow = Math.max(maxRow, cell.r);
    maxColumn = Math.max(maxColumn, cell.c);
  }
  if (maxRow || maxColumn) {
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRow, c: maxColumn } });
  }
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
}

function isSummaryRow(row) {
  const text = (row || []).map(asText).join(' ').trim();
  return /^(الاجمالي|الإجمالي|المجموع|total)\b/i.test(text);
}

export function mapLamhaShipmentRows(rows, selectedPeriod, { sheetName = 'Worksheet' } = {}) {
  const { period } = accountingPeriodBounds(selectedPeriod);
  const found = findHeader(rows);
  const originalHeaders = (found.row || []).map(asText);
  const mapped = [];
  const invalidRows = [];
  let summaryRows = 0;

  for (let index = found.index + 1; index < rows.length; index += 1) {
    const row = rows[index] || [];
    if (!row.some(cell => asText(cell))) continue;
    if (isSummaryRow(row)) {
      summaryRows += 1;
      continue;
    }
    const get = field => found.map[field] == null ? '' : row[found.map[field]];
    const orderNo = asText(get('orderNo'));
    const awb = asText(get('awb'));
    const storeName = asText(get('storeName'));
    const carrierName = asText(get('carrierName'));
    const orderDate = excelDate(get('orderDate'));
    const orderDateKey = sourceDateKey(get('orderDate'), orderDate);
    const reasons = [];
    if (!orderNo && !awb) reasons.push('لا يوجد رقم طلب أو شحنة');
    if (!storeName) reasons.push('اسم المتجر مفقود');
    if (!carrierName) reasons.push('شركة الشحن مفقودة');
    if (found.map.orderDate != null && asText(get('orderDate')) && !orderDate) reasons.push('تاريخ الطلب غير مفهوم');
    if (reasons.length) {
      invalidRows.push({ sheetName, rowNumber: index + 1, reasons, values: row.map(asText) });
      continue;
    }
    // فترة المحاسبة تُؤخذ من تاريخ المصدر نفسه، لا من UTC بعد تحويل
    // التوقيت؛ طلب الساعة 00:30 في الرياض يجب ألا ينقلب للشهر السابق.
    const rowPeriod = orderDateKey ? orderDateKey.slice(0, 7) : period;
    const raw = {};
    originalHeaders.forEach((header, column) => {
      if (header) raw[header] = row[column] instanceof Date ? row[column].toISOString() : row[column];
    });
    mapped.push({
      period: `${rowPeriod}-01`,
      order_no: orderNo || null,
      store_name: storeName || null,
      order_date: orderDate ? orderDate.toISOString() : null,
      order_amount: asNumber(get('orderAmount')),
      payment_method: asText(get('paymentMethod')) || null,
      order_status: asText(get('orderStatus')) || null,
      city: asText(get('city')) || null,
      carrier_name: carrierName || null,
      customer_phone: asText(get('customerPhone')) || null,
      customer_name: asText(get('customerName')) || null,
      awb: awb || null,
      pickup_at: isoOrNull(get('pickupAt')),
      delivered_at: isoOrNull(get('deliveredAt')),
      shipping_cost: asNumber(get('shippingCost')),
      raw,
      _orderDateKey: orderDateKey,
      _source: { sheetName, rowNumber: index + 1 },
    });
  }

  return { rows: mapped, invalidRows, summaryRows, headerRow: found.index + 1, headers: originalHeaders };
}

async function sha256(buffer) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function parseLamhaShipmentWorkbook(file, selectedPeriod) {
  if (!file) throw new Error('اختر ملف شحنات لمحة');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  const allRows = [];
  const invalidRows = [];
  const sheetResults = [];
  for (const sheetName of workbook.SheetNames) {
    const rawRows = sheetRows(workbook.Sheets[sheetName]);
    if (!rawRows.some(row => row.some(cell => asText(cell)))) continue;
    try {
      const parsed = mapLamhaShipmentRows(rawRows, selectedPeriod, { sheetName });
      allRows.push(...parsed.rows);
      invalidRows.push(...parsed.invalidRows);
      sheetResults.push({ sheetName, rowCount: parsed.rows.length, headerRow: parsed.headerRow, summaryRows: parsed.summaryRows });
    } catch (error) {
      const nonEmpty = rawRows.filter(row => row.some(cell => asText(cell)));
      const widest = nonEmpty.reduce((max, row) => Math.max(max, row.filter(cell => asText(cell)).length), 0);
      // تبويب غلاف/تعليمات قصير ليس جدول شحنات. نسجله كمتجاهَل
      // معلوم بدل تحويله إلى صف مفقود، بينما أي جدول حقيقي غير معروف يوقف الحفظ.
      if (nonEmpty.length <= 3 || widest < 4) {
        sheetResults.push({ sheetName, rowCount: 0, ignored: true, reason: 'تبويب معلومات غير جدولي' });
      } else {
        invalidRows.push({ sheetName, rowNumber: null, reasons: [error.message], values: [] });
      }
    }
  }
  if (!allRows.length) throw new Error(invalidRows[0]?.reasons?.[0] || 'لم تُستخرج أي شحنة صالحة من الملف');
  if (invalidRows.length) {
    const sample = invalidRows.slice(0, 5).map(item => `${item.sheetName}${item.rowNumber ? ` صف ${item.rowNumber}` : ''}: ${item.reasons.join('، ')}`);
    const error = new Error(`توقف الاستيراد حتى لا تُفقد بيانات: ${invalidRows.length} صف غير صالح. ${sample.join(' / ')}`);
    error.code = 'LAMHA_INVALID_ROWS';
    error.invalidRows = invalidRows;
    throw error;
  }

  const unique = new Map();
  let duplicateCount = 0;
  for (const row of allRows) {
    const key = row.awb ? `awb:${row.awb}` : `order:${row.order_no}`;
    if (unique.has(key)) {
      duplicateCount += 1;
      continue;
    }
    unique.set(key, row);
  }
  const rows = [...unique.values()];
  const period = normalizeAccountingPeriod(selectedPeriod);
  const dates = rows.map(row => row._orderDateKey).filter(Boolean).sort();
  return {
    fileName: file.name,
    sourceHash: await sha256(buffer),
    rows,
    rowCount: rows.length,
    duplicateCount,
    outsidePeriodCount: rows.filter(row => row.period.slice(0, 7) !== period).length,
    minOrderDate: dates[0] || null,
    maxOrderDate: dates.at(-1) || null,
    orderTotal: rows.reduce((sum, row) => sum + (Number(row.order_amount) || 0), 0),
    shippingCostTotal: rows.reduce((sum, row) => sum + (Number(row.shipping_cost) || 0), 0),
    sheetResults,
  };
}

export async function uploadLamhaShipmentSnapshot({ parsed, period, userId }) {
  if (!parsed?.rows?.length) throw new Error('لا توجد شحنات صالحة للحفظ');
  const bounds = accountingPeriodBounds(period);
  const { data: existing, error: findError } = await supabase
    .from('lamha_shipment_imports')
    .select('id, file_name, uploaded_at')
    .eq('source_hash', parsed.sourceHash)
    .maybeSingle();
  if (findError) throw findError;
  if (existing) throw new Error(`هذا الملف مرفوع سابقًا: ${existing.file_name}`);

  const { data: imported, error: importError } = await supabase
    .from('lamha_shipment_imports')
    .insert({
      period: bounds.periodDate,
      source_hash: parsed.sourceHash,
      file_name: parsed.fileName,
      row_count: parsed.rowCount,
      duplicate_count: parsed.duplicateCount,
      outside_period_count: parsed.outsidePeriodCount,
      min_order_date: parsed.minOrderDate,
      max_order_date: parsed.maxOrderDate,
      order_total: Number(parsed.orderTotal.toFixed(2)),
      shipping_cost_total: Number(parsed.shippingCostTotal.toFixed(2)),
      uploaded_by: userId,
    })
    .select('id')
    .single();
  if (importError) throw importError;

  try {
    const rows = parsed.rows.map(({ _source, _orderDateKey, ...row }) => ({ ...row, import_id: imported.id }));
    for (let index = 0; index < rows.length; index += PAGE) {
      const { error } = await supabase.from('lamha_shipments').insert(rows.slice(index, index + PAGE));
      if (error) throw error;
    }
  } catch (error) {
    await supabase.from('lamha_shipment_imports').delete().eq('id', imported.id);
    throw error;
  }

  try {
    await recordAccountingCycleEvent({
      period,
      stage: 'lamha_shipments',
      eventType: 'shipment_snapshot_uploaded',
      sourceKind: 'lamha_shipments',
      fileName: parsed.fileName,
      rowCount: parsed.rowCount,
      total: parsed.shippingCostTotal,
      result: {
        importId: imported.id,
        duplicateCount: parsed.duplicateCount,
        outsidePeriodCount: parsed.outsidePeriodCount,
        minOrderDate: parsed.minOrderDate,
        maxOrderDate: parsed.maxOrderDate,
      },
      userId,
    });
  } catch (error) {
    console.warn('accounting cycle event failed:', error.message);
  }
  return { importId: imported.id, ...parsed };
}

export async function recordAccountingCycleEvent({
  period, stage, eventType, status = 'success', sourceKind = null,
  fileName = null, rowCount = null, total = null, result = {}, userId,
}) {
  const { periodDate } = accountingPeriodBounds(period);
  const { error } = await supabase.from('accounting_cycle_events').insert({
    period: periodDate,
    stage,
    event_type: eventType,
    status,
    source_kind: sourceKind,
    file_name: fileName,
    row_count: rowCount,
    total,
    result,
    created_by: userId,
  });
  if (error) throw error;
}

async function safe(query, fallback = []) {
  const { data, error, count } = await query;
  if (error) return { data: fallback, count: 0, error };
  return { data: data ?? fallback, count: count ?? (Array.isArray(data) ? data.length : 0), error: null };
}

function latest(list, dateKey = 'created_at') {
  return [...(list || [])].sort((a, b) => String(b?.[dateKey] || '').localeCompare(String(a?.[dateKey] || '')))[0] || null;
}

function statusMeta(status, reason = null) {
  return { status, reason };
}

export function deriveAccountingCycleStages({
  period, audits = [], weightExports = [], shipmentImport = null,
  balanceSnapshot = null, merchantSnapshot = null, codIn = null, codOut = null,
  events = [], cycle = null,
}) {
  const approved = audits.filter(row => row.review_status === 'approved');
  const pending = audits.filter(row => row.review_status === 'pending');
  const rejected = audits.filter(row => row.review_status === 'rejected');
  const legacy = approved.filter(row => {
    const control = row.col_map?.__control;
    return !(Number(control?.version) >= 3 && control?.valid === true);
  });
  const exportedAuditIds = new Set(weightExports.flatMap(row => row.audit_ids || []));
  const weightPending = approved.filter(row => row.weight_billing_status === 'pending');
  const weightComplete = approved.filter(row =>
    ['exported', 'billed', 'skipped'].includes(row.weight_billing_status) || exportedAuditIds.has(row.id),
  );
  const eventFor = id => latest(events.filter(event => event.stage === id));

  const stages = [];
  let auditState = statusMeta('pending', 'لم تُرفع مراجعات لهذه الفترة');
  if (audits.length && pending.length) auditState = statusMeta('attention', `${pending.length} مراجعة تنتظر الاعتماد`);
  else if (audits.length && !approved.length && rejected.length) auditState = statusMeta('attention', 'كل المراجعات مرفوضة');
  else if (approved.length && legacy.length) auditState = statusMeta('attention', `${legacy.length} مراجعة قديمة بلا إثبات مصدر كامل`);
  else if (approved.length) auditState = statusMeta('complete', `اعتمدت ${approved.length} مراجعة موثقة`);
  stages.push({
    ...ACCOUNTING_CYCLE_STAGES[0], ...auditState,
    count: audits.length,
    completedCount: approved.length,
    last: latest(audits),
    detail: { approved: approved.length, pending: pending.length, rejected: rejected.length, legacy: legacy.length },
  });

  let weightState = statusMeta('blocked', 'اعتمد مراجعات شركات الشحن أولًا');
  if (approved.length && weightPending.length) weightState = statusMeta('ready', `${weightPending.length} مراجعة جاهزة للتصدير`);
  else if (approved.length && weightComplete.length === approved.length) weightState = statusMeta('complete', 'لا توجد أوزان معلقة لهذه الفترة');
  stages.push({
    ...ACCOUNTING_CYCLE_STAGES[1], ...weightState,
    count: weightPending.length,
    completedCount: weightComplete.length,
    last: eventFor('weight_export') || latest(weightExports, 'exported_at') || latest(weightExports),
    detail: { pending: weightPending.length, complete: weightComplete.length },
  });

  stages.push({
    ...ACCOUNTING_CYCLE_STAGES[2],
    ...(shipmentImport ? statusMeta('complete', `${shipmentImport.row_count || 0} شحنة محفوظة`) : statusMeta('pending', 'لم يُرفع ملف شحنات لمحة')),
    count: shipmentImport?.row_count || 0,
    completedCount: shipmentImport ? 1 : 0,
    last: shipmentImport,
    detail: shipmentImport || {},
  });

  const sourceCount = Number(!!balanceSnapshot) + Number(!!merchantSnapshot);
  stages.push({
    ...ACCOUNTING_CYCLE_STAGES[3],
    ...(sourceCount === 2
      ? statusMeta('complete', 'كشف الحساب ودليل المتاجر محدثان')
      : sourceCount === 1
        ? statusMeta('attention', balanceSnapshot ? 'بقي رفع دليل المتاجر' : 'بقي رفع كشف حساب لمحة')
        : statusMeta('pending', 'لم تُرفع ملفات لمحة المساندة')),
    count: sourceCount,
    completedCount: sourceCount,
    last: latest([balanceSnapshot, merchantSnapshot].filter(Boolean), 'uploaded_at'),
    detail: { balanceSnapshot, merchantSnapshot },
  });

  stages.push({
    ...ACCOUNTING_CYCLE_STAGES[4],
    ...(codIn?.count ? statusMeta('complete', `${codIn.count} عملية مستلمة`) : statusMeta('pending', 'لم تُرفع تحصيلات شركات الشحن')),
    count: codIn?.count || 0,
    completedCount: codIn?.count ? 1 : 0,
    last: codIn?.last || eventFor('carrier_collections'),
    detail: codIn || {},
  });

  stages.push({
    ...ACCOUNTING_CYCLE_STAGES[5],
    ...(codOut?.count ? statusMeta('complete', `${codOut.count} عملية من لمحة`) : statusMeta('pending', 'لم يُرفع تحصيل لمحة')),
    count: codOut?.count || 0,
    completedCount: codOut?.count ? 1 : 0,
    last: codOut?.last || eventFor('lamha_collections'),
    detail: codOut || {},
  });

  const prerequisiteComplete = stages.slice(0, 6).every(stage => stage.status === 'complete');
  stages.push({
    ...ACCOUNTING_CYCLE_STAGES[6],
    ...(cycle?.status === 'closed'
      ? statusMeta('complete', 'الفترة مقفلة')
      : prerequisiteComplete
        ? statusMeta('ready', 'كل مراحل التشغيل مكتملة وجاهزة للإقفال')
        : statusMeta('blocked', 'أكمل المراحل السابقة قبل الإقفال')),
    count: prerequisiteComplete ? 1 : 0,
    completedCount: cycle?.status === 'closed' ? 1 : 0,
    last: cycle?.closed_at ? { created_at: cycle.closed_at } : eventFor('period_close'),
    detail: cycle || {},
  });

  const completed = stages.filter(stage => stage.status === 'complete').length;
  const next = stages.find(stage => !['complete', 'blocked'].includes(stage.status)) || stages.find(stage => stage.status !== 'complete') || null;
  return { period, stages, completed, total: stages.length, next, prerequisiteComplete, cycle };
}

async function loadCodDirection(direction, start, end) {
  const countRes = await safe(supabase.from('cod_settlement')
    .select('id', { count: 'exact', head: true })
    .eq('direction', direction)
    .gte('upload_date', start)
    .lt('upload_date', end));
  const latestRes = await safe(supabase.from('cod_settlement')
    .select('upload_id, upload_date, source_file, settlement_ref, created_at, carrier_id')
    .eq('direction', direction)
    .gte('upload_date', start)
    .lt('upload_date', end)
    .order('created_at', { ascending: false })
    .limit(1));
  return { count: countRes.count, last: latestRes.data[0] || null };
}

export async function loadAccountingCycle(period) {
  const bounds = accountingPeriodBounds(period);
  const auditPeriods = accountingPeriodAliases(bounds.period);
  const [auditsRes, exportsRes, shipmentRes, balanceRes, merchantRes, eventsRes, cycleRes, codIn, codOut] = await Promise.all([
    safe(supabase.from('audits')
      .select('id, carrier_id, carrier_name, file_name, period, review_status, row_count, weight_billing_status, col_map, created_at, approved_at')
      .in('period', auditPeriods)
      .order('created_at', { ascending: false })),
    safe(supabase.from('weight_billing_exports')
      .select('id, audit_ids, row_count, file_name, status, exported_at, created_at')
      .order('created_at', { ascending: false })
      .limit(200)),
    safe(supabase.from('lamha_shipment_imports')
      .select('*')
      .eq('period', bounds.periodDate)
      .order('uploaded_at', { ascending: false })
      .limit(1)),
    safe(supabase.from('store_balance_snapshots')
      .select('id, file_name, row_count, matched_count, total_balance, uploaded_at')
      .eq('source', 'internal')
      .gte('uploaded_at', `${bounds.start}T00:00:00Z`)
      .lt('uploaded_at', `${bounds.end}T00:00:00Z`)
      .order('uploaded_at', { ascending: false })
      .limit(1)),
    safe(supabase.from('merchants')
      .select('snapshot_id, uploaded_at')
      .gte('uploaded_at', `${bounds.start}T00:00:00Z`)
      .lt('uploaded_at', `${bounds.end}T00:00:00Z`)
      .order('uploaded_at', { ascending: false })
      .limit(1)),
    safe(supabase.from('accounting_cycle_events')
      .select('*')
      .eq('period', bounds.periodDate)
      .order('created_at', { ascending: false })
      .limit(200)),
    safe(supabase.from('accounting_cycles')
      .select('*')
      .eq('period', bounds.periodDate)
      .maybeSingle(), null),
    loadCodDirection('in', bounds.start, bounds.end),
    loadCodDirection('out', bounds.start, bounds.end),
  ]);

  const relevantAuditIds = new Set(auditsRes.data.map(row => row.id));
  const relevantExports = exportsRes.data.filter(row => (row.audit_ids || []).some(id => relevantAuditIds.has(id)));
  return deriveAccountingCycleStages({
    period: bounds.period,
    audits: auditsRes.data,
    weightExports: relevantExports,
    shipmentImport: shipmentRes.data[0] || null,
    balanceSnapshot: balanceRes.data[0] || null,
    merchantSnapshot: merchantRes.data[0] || null,
    codIn,
    codOut,
    events: eventsRes.data,
    cycle: cycleRes.data || null,
  });
}

export async function closeAccountingCycle({ period, userId, note = null }) {
  const snapshot = await loadAccountingCycle(period);
  if (!snapshot.prerequisiteComplete) throw new Error('لا يمكن إقفال الشهر قبل اكتمال المراحل الست السابقة');
  const { periodDate } = accountingPeriodBounds(period);
  const now = new Date().toISOString();
  const { data, error } = await supabase.from('accounting_cycles').upsert({
    period: periodDate,
    status: 'closed',
    closed_at: now,
    closed_by: userId,
    close_note: note,
    updated_at: now,
  }, { onConflict: 'period' }).select('*').single();
  if (error) throw error;
  try {
    await recordAccountingCycleEvent({
      period,
      stage: 'period_close',
      eventType: 'period_closed',
      rowCount: snapshot.stages.slice(0, 6).reduce((sum, stage) => sum + (stage.count || 0), 0),
      result: { completedStages: 6 },
      userId,
    });
  } catch (eventError) {
    console.warn('accounting cycle event failed:', eventError.message);
  }
  return data;
}

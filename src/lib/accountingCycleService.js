import * as XLSX from 'xlsx';
import { supabase } from './supabase.js';
import { hasVerifiedAuditProof } from './auditProof.js';
import { REMITTANCE_PARSERS } from '../engine/codParsers/index.js';
import { expectedScheduleSlots, scheduleRequirementLabel } from './tasksService.js';

const PAGE = 1000;
const ARABIC_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

export const ACCOUNTING_CYCLE_STAGES = [
  { id: 'carrier_audits', label: 'مراجعة فواتير شركات الشحن', permission: 'audits.create' },
  { id: 'weight_export', label: 'تصدير أوزان الفوترة إلى لمحة', permission: 'internal_exports.pull' },
  { id: 'lamha_shipments', label: 'أرقام الشحنات واستيراد ملف لمحة', permission: 'uploads.upload_file' },
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

const HISTORY_PAGE_SIZE = 1000;

async function loadAll(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += HISTORY_PAGE_SIZE) {
    const { data, error } = await buildQuery(from, from + HISTORY_PAGE_SIZE - 1);
    if (error) return { data: [], count: 0, error };
    const page = data || [];
    rows.push(...page);
    if (page.length < HISTORY_PAGE_SIZE) break;
  }
  return { data: rows, count: rows.length, error: null };
}

function sourceError(stage, source, label, error) {
  if (!error) return null;
  return {
    stage,
    source,
    label,
    message: error.message || String(error),
  };
}

function mergeHistory(primary = [], fallback = [], isDuplicate = () => false) {
  const merged = [...primary];
  for (const record of fallback) {
    if (!merged.some(existing => isDuplicate(existing, record))) merged.push(record);
  }
  return latestFirst(merged);
}

function recordDate(record, preferredKey = null) {
  if (!record) return '';
  return String(
    (preferredKey && record[preferredKey])
    || record.created_at
    || record.uploaded_at
    || record.approved_at
    || record.exported_at
    || record.upload_date
    || '',
  );
}

function latestFirst(list, preferredKey = null) {
  return [...(list || [])].sort((a, b) => recordDate(b, preferredKey).localeCompare(recordDate(a, preferredKey)));
}

function latest(list, dateKey = null) {
  return latestFirst(list, dateKey)[0] || null;
}

function statusMeta(status, reason = null) {
  return { status, reason };
}

const MANUAL_COLLECTION_KINDS = new Set(['audit_and_cod_separate', 'cod_only']);
const COMPLETED_COLLECTION_STATUSES = new Set(['uploaded', 'automatic', 'not_required']);

function activeSchedulesFor(schedules, carrierId, taskKind) {
  return (schedules || []).filter(schedule => schedule.active
    && String(schedule.carrier_id) === String(carrierId)
    && schedule.task_kind === taskKind);
}

function carrierHasContractForPeriod(carrier, period) {
  const contracts = Array.isArray(carrier?.contracts) ? carrier.contracts : [];
  if (!contracts.length) return false;
  const { start, end } = accountingPeriodBounds(period);
  return contracts.some(contract => {
    const contractStart = String(contract?.startDate || '').slice(0, 10);
    const contractEnd = String(contract?.endDate || '').slice(0, 10);
    return (!contractStart || contractStart < end) && (!contractEnd || contractEnd >= start);
  });
}

function receivedEventBatchCount(events, carrierId) {
  const batches = new Set();
  for (const event of events || []) {
    if (event?.stage !== 'carrier_collections' || !['success', 'warning'].includes(event?.status)) continue;
    if (String(event?.result?.carrier || '') !== String(carrierId)) continue;
    if (Object.hasOwn(event.result || {}, 'savedCount') && Number(event.result.savedCount || 0) <= 0) continue;
    const files = String(event.file_name || '').split(' · ').map(value => value.trim()).filter(Boolean);
    if (files.length) {
      for (const file of files) batches.add(`file:${file}`);
      continue;
    }
    const count = Math.max(1, Number(event?.result?.fileCount || 1));
    const eventKey = event.id || event.created_at || `${carrierId}:${batches.size}`;
    for (let index = 0; index < count; index += 1) batches.add(`event:${eventKey}:${index}`);
  }
  return batches.size;
}

function receivedUploadBatchCount(uploads, carrierId) {
  return new Set((uploads || [])
    .filter(upload => String(upload?.carrier_id || '') === String(carrierId))
    .map(upload => upload.upload_id || `${upload.source_file || ''}:${upload.upload_date || ''}`)
    .filter(Boolean)).size;
}

function splitScheduleGap(slots, receivedCount, asOf = new Date().toISOString().slice(0, 10)) {
  const expectedCount = slots.length;
  const received = Math.max(0, Number(receivedCount || 0));
  const dueExpectedCount = slots.filter(slot => slot.dueDate <= asOf).length;
  const missingCount = Math.max(0, expectedCount - received);
  const dueMissingCount = Math.max(0, dueExpectedCount - received);
  return {
    expectedCount,
    missingCount,
    dueExpectedCount,
    dueMissingCount,
    upcomingMissingCount: Math.max(0, missingCount - dueMissingCount),
  };
}

export function deriveCarrierAuditChecklist({ period, audits = [], carriers = [], schedules = null, asOf } = {}) {
  if (!Array.isArray(schedules)) return [];
  const carrierById = new Map((carriers || []).map(carrier => [String(carrier.id), carrier]));
  const auditsByCarrier = new Map();
  for (const audit of audits || []) {
    const carrierId = String(audit?.carrier_id || '').trim();
    if (!carrierId) continue;
    const current = auditsByCarrier.get(carrierId) || [];
    current.push(audit);
    auditsByCarrier.set(carrierId, current);
  }
  const carrierIds = new Set([
    ...auditsByCarrier.keys(),
    ...schedules.filter(schedule => schedule.active && schedule.task_kind === 'invoice').map(schedule => String(schedule.carrier_id)),
    ...carriers.filter(carrier => carrierHasContractForPeriod(carrier, period)).map(carrier => String(carrier.id)),
  ]);

  return [...carrierIds].map(carrierId => {
    const carrier = carrierById.get(carrierId) || null;
    const carrierAudits = auditsByCarrier.get(carrierId) || [];
    const approvedCount = carrierAudits.filter(audit => audit.review_status === 'approved').length;
    const invoiceSchedules = activeSchedulesFor(schedules, carrierId, 'invoice');
    const base = {
      carrierId,
      carrierName: carrier?.label || carrier?.name || carrierAudits[0]?.carrier_name || carrierId,
      receivedCount: approvedCount,
      auditCount: carrierAudits.length,
    };
    if (!invoiceSchedules.length) {
      return { ...base, expectedCount: null, missingCount: null, status: 'unclassified', note: 'جدول استلام فاتورة الناقل غير محدد' };
    }
    const slots = invoiceSchedules.flatMap(schedule => expectedScheduleSlots(schedule, period));
    const invalidSchedule = invoiceSchedules.some(schedule => schedule.cadence !== 'on_demand'
      && expectedScheduleSlots(schedule, period).length === 0);
    const gap = splitScheduleGap(slots, approvedCount, asOf);
    const { expectedCount, missingCount } = gap;
    const scheduleText = invoiceSchedules.map(schedule => scheduleRequirementLabel(schedule, period)).join(' · ');
    if (invalidSchedule) {
      return { ...base, expectedCount: null, missingCount: null, status: 'unclassified', scheduleText,
        dueDates: [], note: 'جدول استلام الفاتورة موجود لكن موعده غير مكتمل' };
    }
    if (!expectedCount) {
      return { ...base, expectedCount, missingCount: 0, status: 'not_required', scheduleText, dueDates: [], note: 'لا توجد فاتورة مجدولة لهذه الفترة' };
    }
    return {
      ...base,
      expectedCount,
      missingCount,
      dueExpectedCount: gap.dueExpectedCount,
      dueMissingCount: gap.dueMissingCount,
      upcomingMissingCount: gap.upcomingMissingCount,
      extraCount: Math.max(0, approvedCount - expectedCount),
      status: missingCount ? 'pending' : 'complete',
      scheduleText,
      dueDates: slots.map(slot => slot.dueDate),
      note: missingCount
        ? `المطلوب ${expectedCount} · المعتمد ${approvedCount} · مستحق الآن ${gap.dueMissingCount} · لاحقًا ${gap.upcomingMissingCount}`
        : `اكتملت ${approvedCount} من ${expectedCount} فاتورة مجدولة`,
    };
  }).sort((a, b) => a.carrierName.localeCompare(b.carrierName, 'ar'));
}

// The monthly carrier checklist is the union of configured active schedules
// and carriers already present in the selected period. A single incoming file
// must never complete a weekly schedule or hide a carrier that has not uploaded
// its own required remittance batch yet.
export function deriveCarrierCollectionChecklist({
  period, approvedAudits = [], carriers = [], events = [], schedules = null, codUploads = [], asOf,
} = {}) {
  const carrierById = new Map((carriers || []).map(carrier => [String(carrier.id), carrier]));
  const auditsByCarrier = new Map();
  for (const audit of approvedAudits || []) {
    const carrierId = String(audit?.carrier_id || '').trim();
    if (!carrierId) continue;
    const current = auditsByCarrier.get(carrierId) || [];
    current.push(audit);
    auditsByCarrier.set(carrierId, current);
  }

  const uploadedByCarrier = new Map();
  for (const event of events || []) {
    if (event?.stage !== 'carrier_collections' || !['success', 'warning'].includes(event?.status)) continue;
    const carrierId = String(event?.result?.carrier || '').trim();
    if (!carrierId) continue;
    const current = uploadedByCarrier.get(carrierId) || [];
    current.push(event);
    uploadedByCarrier.set(carrierId, current);
  }

  const scheduleAware = Array.isArray(schedules);
  const carrierIds = new Set(auditsByCarrier.keys());
  if (scheduleAware) {
    for (const schedule of schedules) {
      if (schedule.active && ['cod_remittance', 'invoice'].includes(schedule.task_kind)) {
        carrierIds.add(String(schedule.carrier_id));
      }
    }
    for (const carrier of carriers) {
      if (carrierHasContractForPeriod(carrier, period)) carrierIds.add(String(carrier.id));
    }
  }

  return [...carrierIds].map(carrierId => {
    const carrierAudits = auditsByCarrier.get(carrierId) || [];
    const carrier = carrierById.get(carrierId) || null;
    const fileKind = String(carrier?.file_signature?.file_kind || '').trim() || null;
    const uploadEvents = uploadedByCarrier.get(carrierId) || [];
    const base = {
      carrierId,
      carrierName: carrier?.label || carrier?.name || carrierAudits[0]?.carrier_name || carrierId,
      fileKind,
      auditCount: carrierAudits.length,
      uploadCount: uploadEvents.length,
      lastUpload: latest(uploadEvents),
    };

    if (scheduleAware && fileKind !== 'audit_only') {
      const taskKind = fileKind === 'audit_with_cod' ? 'invoice' : 'cod_remittance';
      const matchingSchedules = activeSchedulesFor(schedules, carrierId, taskKind);
      if (!matchingSchedules.length) {
        return { ...base, status: 'unclassified', expectedCount: null, receivedCount: null, missingCount: null,
          note: fileKind === 'audit_with_cod' ? 'جدول الملف الموحّد (فاتورة + تحصيل) غير محدد' : 'جدول دفعات التحصيل غير محدد' };
      }
      const slots = matchingSchedules.flatMap(schedule => expectedScheduleSlots(schedule, period));
      const invalidSchedule = matchingSchedules.some(schedule => schedule.cadence !== 'on_demand'
        && expectedScheduleSlots(schedule, period).length === 0);
      const expectedCount = slots.length;
      const receivedCount = fileKind === 'audit_with_cod'
        ? carrierAudits.length
        : Math.max(receivedEventBatchCount(events, carrierId), receivedUploadBatchCount(codUploads, carrierId));
      const gap = splitScheduleGap(slots, receivedCount, asOf);
      const missingCount = gap.missingCount;
      const scheduleText = matchingSchedules.map(schedule => scheduleRequirementLabel(schedule, period)).join(' · ');
      const scheduled = {
        ...base,
        uploadCount: receivedCount,
        expectedCount,
        receivedCount,
        missingCount,
        dueExpectedCount: gap.dueExpectedCount,
        dueMissingCount: gap.dueMissingCount,
        upcomingMissingCount: gap.upcomingMissingCount,
        extraCount: Math.max(0, receivedCount - expectedCount),
        scheduleText,
        dueDates: slots.map(slot => slot.dueDate),
      };
      if (invalidSchedule) return { ...scheduled, status: 'unclassified', expectedCount: null, receivedCount,
        missingCount: null, note: 'جدول التحصيل موجود لكن موعده غير مكتمل' };
      if (!expectedCount) return { ...scheduled, status: 'not_required', note: 'لا توجد دفعة تحصيل مجدولة لهذه الفترة' };
      if (missingCount) {
        if (fileKind === 'audit_with_cod') {
          return { ...scheduled, status: 'pending', requiresManualUpload: false,
            note: `ملف موحد (فاتورة + تحصيل) · المطلوب ${expectedCount} · المعتمد ${receivedCount} · مستحق الآن ${gap.dueMissingCount} · لاحقًا ${gap.upcomingMissingCount} · يُرفع في مرحلة الفواتير` };
        }
        if (MANUAL_COLLECTION_KINDS.has(fileKind) && !REMITTANCE_PARSERS[carrierId]) {
          return { ...scheduled, status: 'unsupported', requiresManualUpload: false,
            note: `المطلوب ${expectedCount} · المستلم ${receivedCount} · مستحق الآن ${gap.dueMissingCount} · لاحقًا ${gap.upcomingMissingCount}، وقارئ الملف غير مهيأ` };
        }
        return { ...scheduled, status: 'pending', requiresManualUpload: true,
          note: `المطلوب ${expectedCount} · المستلم ${receivedCount} · مستحق الآن ${gap.dueMissingCount} · لاحقًا ${gap.upcomingMissingCount}` };
      }
      return fileKind === 'audit_with_cod'
        ? { ...scheduled, status: 'automatic', requiresManualUpload: false, note: `اكتملت ${receivedCount} من ${expectedCount} ملفات موحّدة (فاتورة + تحصيل)` }
        : { ...scheduled, status: 'uploaded', requiresManualUpload: true, note: `اكتملت ${receivedCount} من ${expectedCount} دفعات تحصيل` };
    }

    if (fileKind === 'audit_with_cod') {
      return { ...base, status: 'automatic', note: 'يُسجّل التحصيل تلقائيًا عند اعتماد المراجعة' };
    }
    if (fileKind === 'audit_only') {
      return { ...base, status: 'not_required', note: 'هذا الناقل لا يرسل تحصيلًا ضمن ملف المراجعة' };
    }
    if (uploadEvents.length) {
      return { ...base, status: 'uploaded', note: `تم رفع ${uploadEvents.length} ملف تحصيل` };
    }
    if (MANUAL_COLLECTION_KINDS.has(fileKind)) {
      return REMITTANCE_PARSERS[carrierId]
        ? { ...base, status: 'pending', note: 'بانتظار رفع ملف التحصيل المستلم من الناقل' }
        : { ...base, status: 'unsupported', note: 'طريقة التحصيل يدوية لكن قارئ ملف هذا الناقل غير مهيأ' };
    }
    return { ...base, status: 'unclassified', note: 'طريقة التحصيل غير محددة في إعدادات الناقل' };
  }).sort((a, b) => a.carrierName.localeCompare(b.carrierName, 'ar'));
}

export function deriveAccountingCycleStages({
  period, audits = [], weightExports = [], shipmentImport = null, shipmentImports = [],
  balanceSnapshot = null, merchantSnapshot = null, codIn = null, codOut = null,
  events = [], cycle = null, sourceErrors = [], carriers = [], schedules = null,
}) {
  const approved = audits.filter(row => row.review_status === 'approved');
  const pending = audits.filter(row => row.review_status === 'pending');
  const rejected = audits.filter(row => row.review_status === 'rejected');
  const verifiedApproved = approved.filter(hasVerifiedAuditProof);
  const verifiedIds = new Set(verifiedApproved.map(row => row.id));
  const legacy = approved.filter(row => !verifiedIds.has(row.id));
  const exportedAuditIds = new Set(weightExports.flatMap(row => row.audit_ids || []));
  const weightPending = verifiedApproved.filter(row => row.weight_billing_status === 'pending');
  const weightComplete = verifiedApproved.filter(row =>
    ['exported', 'billed', 'skipped'].includes(row.weight_billing_status) || exportedAuditIds.has(row.id),
  );
  const eventHistoryFor = id => latestFirst(events.filter(event => event.stage === id));
  const eventFor = id => eventHistoryFor(id)[0] || null;
  const auditChecklist = deriveCarrierAuditChecklist({ period, audits, carriers, schedules });
  const auditSetupCarriers = auditChecklist.filter(item => item.status === 'unclassified');
  const auditMissingCarriers = auditChecklist.filter(item => item.status === 'pending');
  const auditCompletedCarriers = auditChecklist.filter(item => ['complete', 'not_required'].includes(item.status));
  const auditDueMissing = auditMissingCarriers.reduce((sum, item) => sum + Number(item.dueMissingCount || 0), 0);
  const auditUpcomingMissing = auditMissingCarriers.reduce((sum, item) => sum + Number(item.upcomingMissingCount || 0), 0);

  const stages = [];
  let auditState = statusMeta('pending', 'لم تُرفع مراجعات لهذه الفترة');
  if (audits.length && pending.length) auditState = statusMeta('attention', `${pending.length} مراجعة تنتظر الاعتماد`);
  else if (audits.length && !approved.length && rejected.length) auditState = statusMeta('attention', 'كل المراجعات مرفوضة');
  else if (approved.length && legacy.length) auditState = statusMeta('attention', `${legacy.length} مراجعة قديمة بلا إثبات مصدر كامل`);
  else if (auditSetupCarriers.length) auditState = statusMeta('attention', `${auditSetupCarriers.length} ناقل يحتاج تحديد جدول استلام الفاتورة`);
  else if (auditMissingCarriers.length && auditDueMissing) auditState = statusMeta('attention', `متأخر ${auditDueMissing} فاتورة · ومجدول لاحقًا ${auditUpcomingMissing}`);
  else if (auditMissingCarriers.length) auditState = statusMeta('pending', `بقي ${auditUpcomingMissing} فاتورة مجدولة لاحقًا`);
  else if (approved.length) auditState = statusMeta('complete', `اعتمدت ${approved.length} مراجعة موثقة`);
  stages.push({
    ...ACCOUNTING_CYCLE_STAGES[0], ...auditState,
    count: audits.length,
    completedCount: approved.length,
    last: latest(audits),
    detail: {
      approved: approved.length, pending: pending.length, rejected: rejected.length, legacy: legacy.length,
      carriers: auditChecklist,
      requiredCarrierCount: auditChecklist.length,
      completedCarrierCount: auditCompletedCarriers.length,
      pendingCarrierCount: auditMissingCarriers.length,
      setupCarrierCount: auditSetupCarriers.length,
    },
    history: audits,
  });

  let weightState = statusMeta('blocked', 'اعتمد مراجعات شركات الشحن أولًا');
  if (approved.length && weightPending.length) weightState = statusMeta('ready', `${weightPending.length} مراجعة جاهزة للتصدير`);
  else if (approved.length && weightComplete.length === approved.length) weightState = statusMeta('complete', 'لا توجد أوزان معلقة لهذه الفترة');
  if (legacy.length) {
    weightState = statusMeta('blocked', `أعد رفع ${legacy.length} مراجعة قديمة بإثبات الملف والعقد قبل تصدير الأوزان`);
  }
  const latestWeightAttempt = eventFor('weight_export');
  if (latestWeightAttempt && latestWeightAttempt.status !== 'success') {
    weightState = statusMeta('attention', 'آخر محاولة لتصدير الأوزان لم تكتمل بنجاح');
  }
  stages.push({
    ...ACCOUNTING_CYCLE_STAGES[1], ...weightState,
    count: weightPending.length,
    completedCount: weightComplete.length,
    last: eventFor('weight_export') || latest(weightExports, 'exported_at') || latest(weightExports),
    detail: { pending: weightPending.length, complete: weightComplete.length, blockedLegacy: legacy.length },
    history: mergeHistory(eventHistoryFor('weight_export'), weightExports, (event, record) =>
      event?.result?.exportId === record?.id
      || (event?.file_name && event.file_name === record?.file_name && Number(event.row_count || 0) === Number(record.row_count || 0))),
  });

  const storedShipmentImports = shipmentImports.length ? shipmentImports : (shipmentImport ? [shipmentImport] : []);
  const shipmentEvents = eventHistoryFor('lamha_shipments');
  const shipmentHistory = mergeHistory(shipmentEvents, storedShipmentImports, (event, record) =>
    event?.result?.importId === record?.id
    || (event?.file_name && event.file_name === record?.file_name && Number(event.row_count || 0) === Number(record.row_count || 0)));
  const latestShipmentImport = latest(storedShipmentImports);
  const latestShipmentAttempt = shipmentEvents[0] || null;
  let shipmentState = latestShipmentImport
    ? statusMeta('complete', `${latestShipmentImport.row_count || 0} شحنة في أحدث ملف`)
    : statusMeta('pending', 'لم يُرفع ملف شحنات لمحة');
  if (latestShipmentAttempt && latestShipmentAttempt.status !== 'success') {
    shipmentState = statusMeta('attention', 'آخر محاولة لرفع شحنات لمحة لم تكتمل بنجاح');
  }
  stages.push({
    ...ACCOUNTING_CYCLE_STAGES[2], ...shipmentState,
    count: storedShipmentImports.reduce((sum, record) => sum + Number(record.row_count || 0), 0),
    completedCount: storedShipmentImports.length,
    last: latestShipmentAttempt || latestShipmentImport,
    detail: latestShipmentImport || {},
    history: shipmentHistory,
  });

  // The cycle event owns the accounting month; upload time may be weeks later.
  const sourceEvents = eventHistoryFor('lamha_sources');
  const balanceEvents = sourceEvents.filter(event => event.source_kind === 'internal_settlement');
  const merchantEvents = sourceEvents.filter(event => event.source_kind === 'merchants');
  const balanceEvent = balanceEvents.find(event => event.status === 'success') || null;
  const merchantEvent = merchantEvents.find(event => event.status === 'success') || null;
  const balanceSource = balanceEvent || balanceSnapshot;
  const merchantSource = merchantEvent || merchantSnapshot;
  const sourceCount = Number(!!balanceSource) + Number(!!merchantSource);
  const latestSourceFailure = [balanceEvents[0], merchantEvents[0]]
    .filter(event => event && event.status !== 'success')[0] || null;
  let sourceState = sourceCount === 2
    ? statusMeta('complete', 'كشف الحساب ودليل المتاجر محدثان')
    : sourceCount === 1
      ? statusMeta('attention', balanceSource ? 'بقي رفع دليل المتاجر' : 'بقي رفع كشف حساب لمحة')
      : statusMeta('pending', 'لم تُرفع ملفات لمحة المساندة');
  if (latestSourceFailure) sourceState = statusMeta('attention', 'آخر محاولة لرفع أحد ملفات لمحة لم تكتمل بنجاح');
  stages.push({
    ...ACCOUNTING_CYCLE_STAGES[3], ...sourceState,
    count: sourceCount,
    completedCount: sourceCount,
    last: sourceEvents[0]
      || latest([balanceSource, merchantSource].filter(Boolean), balanceEvent || merchantEvent ? 'created_at' : 'uploaded_at'),
    detail: {
      balanceSnapshot: balanceSource,
      merchantSnapshot: merchantSource,
    },
    history: mergeHistory(sourceEvents, [
      balanceSnapshot && { ...balanceSnapshot, source_kind: 'internal_settlement' },
      merchantSnapshot && { ...merchantSnapshot, source_kind: 'merchants' },
    ].filter(Boolean), (event, record) => event.source_kind === record.source_kind
      && event.status === 'success'
      && (!record.uploaded_at || recordDate(event).slice(0, 10) === recordDate(record).slice(0, 10))),
  });

  const allCarrierCollectionEvents = eventHistoryFor('carrier_collections');
  const carrierCollectionEvents = allCarrierCollectionEvents.filter(event => ['success', 'warning'].includes(event.status));
  const carrierCollectionCount = carrierCollectionEvents.length
    ? carrierCollectionEvents.reduce((sum, event) => sum + Number(event.row_count || 0), 0)
    : Number(codIn?.count || 0);
  const carrierChecklist = deriveCarrierCollectionChecklist({
    period,
    approvedAudits: approved,
    carriers,
    events,
    schedules,
    codUploads: codIn?.uploads || [],
  });
  const checklistAvailable = carrierChecklist.length > 0;
  const completedCarriers = carrierChecklist.filter(item => COMPLETED_COLLECTION_STATUSES.has(item.status));
  const pendingCarriers = carrierChecklist.filter(item => item.status === 'pending');
  const setupCarriers = carrierChecklist.filter(item => ['unsupported', 'unclassified'].includes(item.status));
  const dueCollectionMissing = pendingCarriers.reduce((sum, item) => sum + Number(item.dueMissingCount ?? 1), 0);
  const upcomingCollectionMissing = pendingCarriers.reduce((sum, item) => sum + Number(item.upcomingMissingCount ?? 0), 0);
  const carrierNameById = new Map(carrierChecklist.map(item => [String(item.carrierId), item.carrierName]));
  const carrierCollectionHistory = allCarrierCollectionEvents.map(event => ({
    ...event,
    carrier_name: carrierNameById.get(String(event?.result?.carrier || '')) || event.carrier_name || null,
  }));
  const legacyCarrierCollectionLast = codIn?.last ? {
    ...codIn.last,
    carrier_name: carrierNameById.get(String(codIn.last.carrier_id || '')) || codIn.last.carrier_name || null,
  } : null;
  let carrierCollectionState;
  if (checklistAvailable && completedCarriers.length === carrierChecklist.length) {
    carrierCollectionState = statusMeta('complete', `اكتملت معالجة تحصيلات ${carrierChecklist.length} ناقل`);
  } else if (checklistAvailable && setupCarriers.length) {
    carrierCollectionState = statusMeta('attention', `${setupCarriers.length} ناقل يحتاج ضبط طريقة التحصيل قبل الإقفال`);
  } else if (checklistAvailable && pendingCarriers.length) {
    carrierCollectionState = statusMeta(
      dueCollectionMissing ? (completedCarriers.length ? 'attention' : 'ready') : 'pending',
      dueCollectionMissing
        ? `متأخر ${dueCollectionMissing} دفعة · ومجدول لاحقًا ${upcomingCollectionMissing}`
        : `بقي ${upcomingCollectionMissing} دفعة تحصيل مجدولة لاحقًا`,
    );
  } else {
    // Historical fallback for old audits/events that predate carrier metadata.
    carrierCollectionState = carrierCollectionCount
      ? statusMeta('complete', `${carrierCollectionCount} عملية مستلمة`)
      : statusMeta('pending', 'لم تُرفع تحصيلات شركات الشحن');
  }
  if (eventFor('carrier_collections') && eventFor('carrier_collections').status !== 'success') {
    carrierCollectionState = statusMeta('attention', 'آخر محاولة لرفع تحصيل شركة شحن لم تكتمل بنجاح');
  }
  stages.push({
    ...ACCOUNTING_CYCLE_STAGES[4],
    ...carrierCollectionState,
    count: carrierCollectionCount,
    completedCount: checklistAvailable ? completedCarriers.length : (carrierCollectionCount ? 1 : 0),
    last: carrierCollectionHistory[0] || legacyCarrierCollectionLast,
    detail: {
      ...(codIn || {}),
      carriers: carrierChecklist,
      requiredCarrierCount: carrierChecklist.length,
      completedCarrierCount: completedCarriers.length,
      pendingCarrierCount: pendingCarriers.length,
      setupCarrierCount: setupCarriers.length,
    },
    history: carrierCollectionHistory.length
      ? carrierCollectionHistory
      : (legacyCarrierCollectionLast ? [legacyCarrierCollectionLast] : []),
  });

  const lamhaCollectionEvents = eventHistoryFor('lamha_collections').filter(event => event.status === 'success');
  const lamhaCollectionCount = lamhaCollectionEvents.length
    ? lamhaCollectionEvents.reduce((sum, event) => sum + Number(event.row_count || 0), 0)
    : Number(codOut?.count || 0);
  let lamhaCollectionState = lamhaCollectionCount
    ? statusMeta('complete', `${lamhaCollectionCount} عملية من لمحة`)
    : statusMeta('pending', 'لم يُرفع تحصيل لمحة');
  if (eventFor('lamha_collections') && eventFor('lamha_collections').status !== 'success') {
    lamhaCollectionState = statusMeta('attention', 'آخر محاولة لرفع تحصيل لمحة لم تكتمل بنجاح');
  }
  stages.push({
    ...ACCOUNTING_CYCLE_STAGES[5],
    ...lamhaCollectionState,
    count: lamhaCollectionCount,
    completedCount: lamhaCollectionCount ? 1 : 0,
    last: eventFor('lamha_collections') || codOut?.last,
    detail: codOut || {},
    history: eventHistoryFor('lamha_collections').length
      ? eventHistoryFor('lamha_collections')
      : (codOut?.last ? [codOut.last] : []),
  });

  const stageErrors = new Map();
  for (const error of sourceErrors.filter(Boolean)) {
    const current = stageErrors.get(error.stage) || [];
    current.push(error);
    stageErrors.set(error.stage, current);
  }
  for (const stage of stages.slice(0, 6)) {
    const errors = stageErrors.get(stage.id) || [];
    if (!errors.length) continue;
    stage.status = 'attention';
    stage.reason = `تعذر التحقق من ${errors.map(error => error.label).join(' و')}`;
    stage.detail = { ...(stage.detail || {}), sourceErrors: errors };
  }

  const prerequisiteComplete = sourceErrors.length === 0
    && stages.slice(0, 6).every(stage => stage.status === 'complete');
  stages.push({
    ...ACCOUNTING_CYCLE_STAGES[6],
    ...(cycle?.status === 'closed' && sourceErrors.length === 0
      ? statusMeta('complete', 'الفترة مقفلة')
      : prerequisiteComplete
        ? statusMeta('ready', 'كل مراحل التشغيل مكتملة وجاهزة للإقفال')
        : statusMeta('blocked', sourceErrors.length
          ? 'تعذر التحقق من كل المصادر؛ أعد المحاولة قبل الإقفال'
          : 'أكمل المراحل السابقة قبل الإقفال')),
    count: prerequisiteComplete ? 1 : 0,
    completedCount: cycle?.status === 'closed' ? 1 : 0,
    last: cycle?.closed_at ? { created_at: cycle.closed_at } : eventFor('period_close'),
    detail: cycle || {},
    history: eventHistoryFor('period_close').length
      ? eventHistoryFor('period_close')
      : (cycle ? [cycle] : []),
  });

  const completed = stages.filter(stage => stage.status === 'complete').length;
  const next = stages.find(stage => !['complete', 'blocked'].includes(stage.status)) || stages.find(stage => stage.status !== 'complete') || null;
  return { period, stages, completed, total: stages.length, next, prerequisiteComplete, cycle, sourceErrors };
}

async function loadCodDirection(direction, start, end) {
  const [countRes, uploadsRes] = await Promise.all([
    safe(supabase.from('cod_settlement')
      .select('id', { count: 'exact', head: true })
      .eq('direction', direction)
      .gte('upload_date', start)
      .lt('upload_date', end)),
    loadAll((from, to) => supabase.from('cod_settlement')
      .select('upload_id, upload_date, source_file, settlement_ref, created_at, carrier_id')
      .eq('direction', direction)
      .gte('upload_date', start)
      .lt('upload_date', end)
      .order('created_at', { ascending: false })
      .range(from, to)),
  ]);
  const uniqueUploads = new Map();
  for (const row of uploadsRes.data || []) {
    const key = row.upload_id || `${row.carrier_id || ''}:${row.source_file || ''}:${row.upload_date || ''}`;
    if (key && !uniqueUploads.has(key)) uniqueUploads.set(key, row);
  }
  const uploads = [...uniqueUploads.values()];
  return {
    count: countRes.count,
    uploads,
    last: uploads[0] || null,
    error: countRes.error || uploadsRes.error || null,
  };
}

async function loadWeightExportsForAudits(auditIds) {
  if (!auditIds.length) return { data: [], count: 0, error: null };
  const records = new Map();
  for (let index = 0; index < auditIds.length; index += 100) {
    const chunk = auditIds.slice(index, index + 100);
    const result = await loadAll((from, to) => supabase.from('weight_billing_exports')
      .select('id, audit_ids, row_count, file_name, file_path, storage_bucket, status, exported_at, created_at')
      .overlaps('audit_ids', chunk)
      .order('created_at', { ascending: false })
      .range(from, to));
    if (result.error) return result;
    for (const record of result.data) records.set(record.id, record);
  }
  const data = latestFirst([...records.values()]);
  return { data, count: data.length, error: null };
}

export async function loadAccountingCycle(period) {
  const bounds = accountingPeriodBounds(period);
  const auditPeriods = accountingPeriodAliases(bounds.period);
  const auditsPromise = loadAll((from, to) => supabase.from('audits')
      .select('id, carrier_id, carrier_name, file_name, period, review_status, row_count, weight_billing_status, col_map, created_at, approved_at')
      .in('period', auditPeriods)
      .order('created_at', { ascending: false })
      .range(from, to));
  const [auditsRes, shipmentRes, balanceRes, merchantRes, eventsRes, cycleRes, carriersRes, schedulesRes, codIn, codOut] = await Promise.all([
    auditsPromise,
    loadAll((from, to) => supabase.from('lamha_shipment_imports')
      .select('*')
      .eq('period', bounds.periodDate)
      .order('uploaded_at', { ascending: false })
      .range(from, to)),
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
    loadAll((from, to) => supabase.from('accounting_cycle_events')
      .select('*')
      .eq('period', bounds.periodDate)
      .order('created_at', { ascending: false })
      .range(from, to)),
    safe(supabase.from('accounting_cycles')
      .select('*')
      .eq('period', bounds.periodDate)
      .maybeSingle(), null),
    safe(supabase.from('carriers')
      .select('id, name, file_signature, contracts')
      .order('name')),
    safe(supabase.from('carrier_task_schedules')
      .select('*')
      .eq('active', true)
      .order('carrier_id')
      .order('task_kind')),
    loadCodDirection('in', bounds.start, bounds.end),
    loadCodDirection('out', bounds.start, bounds.end),
  ]);

  const auditIds = auditsRes.data.map(row => row.id);
  const exportsRes = await loadWeightExportsForAudits(auditIds);
  const sourceErrors = [
    sourceError('carrier_audits', 'audits', 'مراجعات شركات الشحن', auditsRes.error),
    sourceError('weight_export', 'weight_billing_exports', 'ملفات الأوزان', exportsRes.error),
    sourceError('lamha_shipments', 'lamha_shipment_imports', 'شحنات لمحة', shipmentRes.error),
    sourceError('lamha_sources', 'store_balance_snapshots', 'كشف حساب لمحة', balanceRes.error),
    sourceError('lamha_sources', 'merchants', 'دليل المتاجر', merchantRes.error),
    sourceError('carrier_collections', 'carriers', 'إعدادات تحصيل شركات الشحن', carriersRes.error),
    sourceError('carrier_audits', 'carrier_task_schedules', 'جداول استلام فواتير الناقلين', schedulesRes.error),
    sourceError('carrier_collections', 'carrier_task_schedules', 'جداول تحصيلات الناقلين', schedulesRes.error),
    sourceError('carrier_collections', 'cod_settlement_in', 'تحصيلات شركات الشحن', codIn.error),
    sourceError('lamha_collections', 'cod_settlement_out', 'تحصيل لمحة', codOut.error),
    sourceError('period_close', 'accounting_cycles', 'حالة إقفال الشهر', cycleRes.error),
  ];
  if (eventsRes.error) {
    for (const stage of ['weight_export', 'lamha_shipments', 'lamha_sources', 'carrier_collections', 'lamha_collections', 'period_close']) {
      sourceErrors.push(sourceError(stage, 'accounting_cycle_events', 'سجل تشغيل الدورة', eventsRes.error));
    }
  }
  return deriveAccountingCycleStages({
    period: bounds.period,
    audits: auditsRes.data,
    weightExports: exportsRes.data,
    shipmentImport: shipmentRes.data[0] || null,
    shipmentImports: shipmentRes.data,
    balanceSnapshot: balanceRes.data[0] || null,
    merchantSnapshot: merchantRes.data[0] || null,
    codIn,
    codOut,
    events: eventsRes.data,
    cycle: cycleRes.data || null,
    carriers: carriersRes.data,
    schedules: schedulesRes.data,
    sourceErrors: sourceErrors.filter(Boolean),
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

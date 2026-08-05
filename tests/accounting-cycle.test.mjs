import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  accountingPeriodBounds,
  accountingPeriodAliases,
  auditPeriodMatches,
  deriveAccountingCycleStages,
  mapLamhaShipmentRows,
} from '../src/lib/accountingCycleService.js';

test('حساب حدود الفترة الشهرية لا يتأثر بطول الشهر', () => {
  assert.deepEqual(accountingPeriodBounds('2026-08'), {
    period: '2026-08',
    periodDate: '2026-08-01',
    start: '2026-08-01',
    end: '2026-09-01',
  });
  assert.equal(accountingPeriodBounds('2026-12').end, '2027-01-01');
  assert.deepEqual(accountingPeriodAliases('2026-06'), ['2026-06', 'يونيو 2026']);
  assert.equal(auditPeriodMatches('يونيو 2026', '2026-06'), true);
  assert.equal(auditPeriodMatches('2026-06', '2026-06'), true);
  assert.equal(auditPeriodMatches('يوليو 2026', '2026-06'), false);
});

test('قارئ شحنات لمحة يعتمد أسماء الأعمدة لا ترتيبها ويحفظ الأعمدة الإضافية', () => {
  const rows = [
    ['عمود جديد', 'شركة الشحن', 'رقم البوليصه', 'تكلفة الشحن', 'المتجر', 'تاريخ الطلب', 'رقم الطلب', 'مبلغ الطلب'],
    ['قيمة مهمة', 'J&T Express', 'JTE000977436241', 19, 'كنوز حضرموت', '2026-06-25 20:57:29', 'knooz-268422990', 294],
  ];
  const parsed = mapLamhaShipmentRows(rows, '2026-06');
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.invalidRows.length, 0);
  assert.equal(parsed.rows[0].awb, 'JTE000977436241');
  assert.equal(parsed.rows[0].carrier_name, 'J&T Express');
  assert.equal(parsed.rows[0].shipping_cost, 19);
  assert.equal(parsed.rows[0].period, '2026-06-01');
  assert.equal(parsed.rows[0].raw['عمود جديد'], 'قيمة مهمة');
});

test('قارئ شحنات لمحة يعلن الصف غير الصالح ولا يسقطه بصمت', () => {
  const rows = [
    ['المتجر', 'شركة الشحن', 'رقم البوليصه', 'تاريخ الطلب', 'تكلفة الشحن'],
    ['متجر سليم', 'سمسا', '12345', '2026-08-01', 10],
    ['متجر ناقص', '', '', '2026-08-02', 12],
  ];
  const parsed = mapLamhaShipmentRows(rows, '2026-08');
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.invalidRows.length, 1);
  assert.equal(parsed.invalidRows[0].rowNumber, 3);
  assert.ok(parsed.invalidRows[0].reasons.includes('لا يوجد رقم طلب أو شحنة'));
  assert.ok(parsed.invalidRows[0].reasons.includes('شركة الشحن مفقودة'));
});

test('تاريخ لمحة قرب منتصف الليل يبقى في شهر المصدر ولا ينقلب بسبب UTC', () => {
  const rows = [
    ['المتجر', 'شركة الشحن', 'رقم البوليصه', 'تاريخ الطلب', 'تكلفة الشحن'],
    ['متجر الليل', 'سمسا', 'MIDNIGHT-1', '2026-08-01 00:30:00', 10],
  ];
  const parsed = mapLamhaShipmentRows(rows, '2026-08');
  assert.equal(parsed.rows[0].period, '2026-08-01');
  assert.equal(parsed.rows[0]._orderDateKey, '2026-08-01');
});

test('حالة دورة المحاسب مشتقة من السجلات وتمنع الإقفال قبل اكتمال المراحل', () => {
  const control = { version: 3, valid: true };
  const base = {
    period: '2026-08',
    audits: [{
      id: 'audit-1', review_status: 'approved', weight_billing_status: 'exported',
      col_map: { __control: control }, created_at: '2026-08-02T10:00:00Z',
    }],
    weightExports: [{ audit_ids: ['audit-1'], file_name: 'weights.xlsx', created_at: '2026-08-02T11:00:00Z' }],
    shipmentImport: { row_count: 100, uploaded_at: '2026-08-03T10:00:00Z' },
    balanceSnapshot: { uploaded_at: '2026-08-04T10:00:00Z' },
    merchantSnapshot: { uploaded_at: '2026-08-04T11:00:00Z' },
    codIn: { count: 20, last: { created_at: '2026-08-05T10:00:00Z' } },
    codOut: { count: 0, last: null },
  };
  const before = deriveAccountingCycleStages(base);
  assert.equal(before.stages[0].status, 'complete');
  assert.equal(before.stages[0].history.length, 1);
  assert.equal(before.stages[1].history[0].file_name, 'weights.xlsx');
  assert.equal(before.stages[2].history[0].row_count, 100);
  assert.equal(before.stages[3].history.length, 2);
  assert.equal(before.stages[5].status, 'pending');
  assert.equal(before.stages[6].status, 'blocked');
  assert.equal(before.prerequisiteComplete, false);

  const ready = deriveAccountingCycleStages({ ...base, codOut: { count: 18, last: {} } });
  assert.equal(ready.stages[6].status, 'ready');
  assert.equal(ready.prerequisiteComplete, true);

  const closed = deriveAccountingCycleStages({
    ...base,
    codOut: { count: 18, last: {} },
    cycle: { status: 'closed', closed_at: '2026-08-05T20:00:00Z' },
  });
  assert.equal(closed.stages[6].status, 'complete');
  assert.equal(closed.completed, 7);
});

test('ملفات لمحة المتأخرة تُنسب للشهر المختار من سجل الدورة', () => {
  const cycle = deriveAccountingCycleStages({
    period: '2026-06',
    events: [
      { stage: 'lamha_sources', source_kind: 'internal_settlement', status: 'success', created_at: '2026-08-05T10:00:00Z' },
      { stage: 'lamha_sources', source_kind: 'merchants', status: 'success', created_at: '2026-08-05T10:05:00Z' },
    ],
  });
  assert.equal(cycle.stages[3].status, 'complete');
  assert.equal(cycle.stages[3].count, 2);
  assert.deepEqual(cycle.stages[3].history.map(record => record.source_kind), ['merchants', 'internal_settlement']);
});

test('تحصيلات الشهر المتأخرة تعتمد سجل الدورة ولا تضيع بسبب تاريخ الرفع', () => {
  const cycle = deriveAccountingCycleStages({
    period: '2026-06',
    codIn: { count: 0, last: null },
    codOut: { count: 0, last: null },
    events: [
      { stage: 'carrier_collections', status: 'success', row_count: 25, created_at: '2026-08-05T10:00:00Z' },
      { stage: 'lamha_collections', status: 'success', row_count: 40, created_at: '2026-08-05T10:05:00Z' },
      { stage: 'lamha_collections', status: 'failed', row_count: 99, created_at: '2026-08-05T10:06:00Z' },
    ],
  });
  assert.equal(cycle.stages[4].status, 'complete');
  assert.equal(cycle.stages[4].count, 25);
  assert.equal(cycle.stages[5].status, 'attention');
  assert.equal(cycle.stages[5].count, 40);
  assert.equal(cycle.stages[5].history.length, 2);
  assert.equal(cycle.stages[5].history[0].status, 'failed');
});

test('سجل شحنات لمحة يعرض كل ملفات الشهر لا آخر ملف فقط', () => {
  const shipmentImports = Array.from({ length: 18 }, (_, index) => ({
    id: `shipment-${index}`,
    file_name: `lamha-${index}.xlsx`,
    row_count: index + 1,
    uploaded_at: `2026-08-${String(index + 1).padStart(2, '0')}T10:00:00Z`,
  }));
  const cycle = deriveAccountingCycleStages({ period: '2026-08', shipmentImports });
  const stage = cycle.stages[2];
  assert.equal(stage.status, 'complete');
  assert.equal(stage.history.length, 18);
  assert.equal(stage.last.file_name, 'lamha-17.xlsx');
  assert.equal(stage.count, 171);
});

test('فشل قراءة أي مصدر يظهر للمحاسب ويمنع إقفال الشهر', () => {
  const control = { version: 3, valid: true };
  const cycle = deriveAccountingCycleStages({
    period: '2026-08',
    audits: [{ id: 'a1', review_status: 'approved', weight_billing_status: 'skipped', col_map: { __control: control } }],
    shipmentImports: [{ row_count: 10, uploaded_at: '2026-08-01T10:00:00Z' }],
    balanceSnapshot: { uploaded_at: '2026-08-01T10:00:00Z' },
    merchantSnapshot: { uploaded_at: '2026-08-01T10:00:00Z' },
    codIn: { count: 2, last: {} },
    codOut: { count: 2, last: {} },
    sourceErrors: [{ stage: 'lamha_sources', source: 'merchants', label: 'دليل المتاجر', message: 'timeout' }],
  });
  assert.equal(cycle.stages[3].status, 'attention');
  assert.match(cycle.stages[3].reason, /تعذر التحقق/);
  assert.equal(cycle.prerequisiteComplete, false);
  assert.equal(cycle.stages[6].status, 'blocked');
  assert.equal(cycle.sourceErrors.length, 1);
});

test('المراجعة القديمة بلا إثبات مصدر لا تظهر كمكتملة بصمت', () => {
  const cycle = deriveAccountingCycleStages({
    period: '2026-08',
    audits: [{ id: 'legacy', review_status: 'approved', weight_billing_status: 'skipped', col_map: {}, created_at: '2026-08-01' }],
  });
  assert.equal(cycle.stages[0].status, 'attention');
  assert.match(cycle.stages[0].reason, /بلا إثبات مصدر/);
});

test('الشهر المختار للدورة ينتقل إلى نموذج مراجعة شركة الشحن', async () => {
  const [cyclePage, uploadWizard, cycleService] = await Promise.all([
    readFile(new URL('../src/pages/AccountingCycle.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/UploadWizard.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/accountingCycleService.js', import.meta.url), 'utf8'),
  ]);
  assert.match(cyclePage, /<UploadWizard key=\{period\}[^>]*initialPeriod=\{period\}/);
  assert.match(cyclePage, /compactLayout && selected\?\.id === stage\.id/);
  assert.match(cyclePage, /!compactLayout && <Card className="accounting-cycle-detail accounting-cycle-detail--desktop">/);
  assert.match(cyclePage, /<StageHistory stage=\{stage\}\/>/);
  assert.match(cyclePage, /<StageHistory stage=\{selected\}\/>/);
  assert.doesNotMatch(cyclePage, /history\.slice\(0,\s*12\)/);
  assert.match(cyclePage, /snapshot\.sourceErrors/);
  assert.match(cyclePage, /إعادة فحص المصادر/);
  assert.match(cyclePage, /data\.next\?\.id/);
  assert.match(cyclePage, /refresh\(\{ advance: true \}\)/);
  assert.match(cyclePage, /parseConsolidatedExpected/);
  assert.match(cyclePage, /saveConsolidatedExpected/);
  assert.match(cyclePage, /اختر ملف تحصيل لمحة المجمّع/);
  assert.match(cyclePage, /stage_attempt_failed/);
  assert.match(cyclePage, /onError=\{settlementFailed\}/);
  assert.match(cyclePage, /onApproved=\{auditApproved\}/);
  const auditResultsPage = await readFile(new URL('../src/pages/AuditResults.jsx', import.meta.url), 'utf8');
  assert.match(auditResultsPage, /onApproved\(result\)/);
  assert.match(auditResultsPage, /codExtractErr/);
  const settlementPage = await readFile(new URL('../src/pages/CodSettlements.jsx', import.meta.url), 'utf8');
  assert.match(settlementPage, /phase: 'parse'/);
  assert.match(settlementPage, /phase: 'save'/);
  assert.match(settlementPage, /ledgerError: ledgerErr/);
  assert.match(uploadWizard, /initialPeriodMatch/);
  assert.match(uploadWizard, /title: 'حدد الفترة'/);
  assert.match(cycleService, /const HISTORY_PAGE_SIZE = 1000/);
  assert.match(cycleService, /\.range\(from, to\)/);
  assert.doesNotMatch(cycleService, /accounting_cycle_events'[\s\S]{0,250}\.limit\(200\)/);
});

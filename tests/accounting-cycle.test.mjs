import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  accountingPeriodBounds,
  accountingPeriodAliases,
  auditPeriodMatches,
  deriveCarrierAuditChecklist,
  deriveCarrierCollectionChecklist,
  deriveAccountingCycleStages,
  deriveLamhaShipmentCoverage,
  mapLamhaShipmentRows,
} from '../src/lib/accountingCycleService.js';
import {
  expectedScheduleSlots,
  deriveDueState,
  deriveCarrierScheduleCoverage,
  normalizeScheduleTiming,
  parseScheduleDays,
  summarizeCarrierScheduleEvidence,
} from '../src/lib/tasksService.js';
import { filterMissingShipmentSearchRows } from '../src/lib/weightBillingService.js';

test('جداول الناقلين تحول الأسبوعي والشهري إلى دفعات صريحة داخل الشهر', () => {
  assert.deepEqual(
    expectedScheduleSlots({ id: 'weekly-fixed', active: true, cadence: 'weekly', day_of_period: 8 }, '2026-08').map(slot => slot.day),
    [8, 15, 22, 29],
  );
  assert.deepEqual(
    expectedScheduleSlots({ id: 'biweekly', active: true, cadence: 'biweekly', day_of_period: 5 }, '2026-08').map(slot => slot.day),
    [5, 20],
  );
  assert.deepEqual(
    expectedScheduleSlots({ id: 'monthly', active: true, cadence: 'monthly', day_of_period: 1 }, '2026-08').map(slot => slot.day),
    [1],
  );
  assert.deepEqual(
    expectedScheduleSlots({ id: 'weekly-missing', active: true, cadence: 'weekly', day_of_period: null }, '2026-08'),
    [],
  );
  assert.deepEqual(
    expectedScheduleSlots({ id: 'weekday', active: true, cadence: 'weekly', schedule_basis: 'weekday', due_days: [3] }, '2026-08').map(slot => slot.day),
    [5, 12, 19, 26],
  );
  assert.deepEqual(
    expectedScheduleSlots({ id: 'fixed', active: true, cadence: 'weekly', schedule_basis: 'month_days', due_days: [8, 15, 22, 29] }, '2026-08').map(slot => slot.day),
    [8, 15, 22, 29],
  );
  assert.deepEqual(
    expectedScheduleSlots({ id: 'month-end', active: true, cadence: 'monthly', schedule_basis: 'month_days', due_days: [31] }, '2026-02').map(slot => slot.day),
    [28],
  );
});

test('إعداد موعد الناقل صريح ولا يسمح بيوم غامض أو فاتورة شهرية بعدة مواعيد', () => {
  assert.deepEqual(parseScheduleDays('29، 8, 15 22 8'), [8, 15, 22, 29]);
  assert.deepEqual(
    normalizeScheduleTiming({ cadence: 'weekly', scheduleBasis: 'weekday', dueDays: [3] }),
    { scheduleBasis: 'weekday', dueDays: [3], dayOfPeriod: 3 },
  );
  assert.throws(
    () => normalizeScheduleTiming({ cadence: 'weekly', scheduleBasis: 'weekday', dueDays: [] }),
    /حدد موعد/,
  );
  assert.throws(
    () => normalizeScheduleTiming({ cadence: 'monthly', scheduleBasis: 'month_days', dueDays: [1, 15] }),
    /يوم استلام واحد/,
  );
});

test('دليل مواعيد الناقل يعرض الملفات الفعلية ولا يحولها إلى جدول تلقائي', () => {
  const evidence = summarizeCarrierScheduleEvidence({
    carrierIds: ['boleeseh', 'aymakan'],
    audits: [
      { id: 'audit-1', carrier_id: 'boleeseh', created_at: '2026-06-10T08:00:00+03:00' },
      { id: 'audit-1', carrier_id: 'boleeseh', created_at: '2026-06-10T08:00:00+03:00' },
    ],
    codRows: [
      { carrier_id: 'boleeseh', direction: 'in', upload_id: 'in-1', created_at: '2026-05-19T12:00:00+03:00' },
      { carrier_id: 'boleeseh', direction: 'in', upload_id: 'in-1', created_at: '2026-05-19T12:00:00+03:00' },
      { carrier_id: 'boleeseh', direction: 'in', upload_id: 'in-2', created_at: '2026-06-25T12:00:00+03:00' },
      { carrier_id: 'boleeseh', direction: 'out', upload_id: 'out-1', created_at: '2026-06-25T12:00:00+03:00' },
    ],
  });
  assert.deepEqual(evidence.boleeseh, {
    invoice: { batchCount: 1, dates: ['2026-06-10'] },
    cod: { batchCount: 2, dates: ['2026-05-19', '2026-06-25'] },
  });
  assert.deepEqual(evidence.aymakan, {
    invoice: { batchCount: 0, dates: [] },
    cod: { batchCount: 0, dates: [] },
  });
});

test('لوحة اكتمال الجداول تطلب جدولًا موحدًا أو جدولين منفصلين حسب طريقة الناقل', () => {
  const contract = [{ startDate: '2026-01-01', endDate: null }];
  const carriers = [
    { id: 'combined', name: 'موحد', contracts: contract, file_signature: { file_kind: 'audit_with_cod' } },
    { id: 'separate', name: 'منفصل', contracts: contract, file_signature: { file_kind: 'audit_and_cod_separate' } },
    { id: 'unknown', name: 'غير مصنف', contracts: contract, file_signature: {} },
    { id: 'expired', name: 'منتهي', contracts: [{ startDate: '2025-01-01', endDate: '2025-12-31' }], file_signature: { file_kind: 'audit_with_cod' } },
  ];
  const schedules = [
    { id: 'combined-invoice', carrier_id: 'combined', task_kind: 'invoice', active: true, cadence: 'weekly', schedule_basis: 'weekday', due_days: [3] },
    { id: 'separate-invoice', carrier_id: 'separate', task_kind: 'invoice', active: true, cadence: 'monthly', schedule_basis: 'month_days', due_days: [1] },
  ];
  const coverage = deriveCarrierScheduleCoverage({ carriers, schedules, period: '2026-08' });
  assert.equal(coverage.length, 3);
  assert.equal(coverage.find(row => row.carrierId === 'combined').status, 'complete');
  assert.deepEqual(coverage.find(row => row.carrierId === 'separate').missingKinds, ['cod_remittance']);
  assert.equal(coverage.find(row => row.carrierId === 'unknown').status, 'unclassified');
});

test('تنبيه الموعد يتبع تاريخ الشركة ولا يتحرك بسبب رفع الملف متأخرًا', () => {
  const monthly = {
    id: 'monthly', active: true, cadence: 'monthly', schedule_basis: 'month_days', due_days: [1],
    created_at: '2026-01-01T00:00:00+03:00', last_completed_at: '2026-07-10T12:00:00+03:00',
  };
  const monthlyState = deriveDueState(monthly, new Date('2026-08-02T12:00:00+03:00'));
  assert.equal(monthlyState.daysUntilDue, -1);
  assert.equal(monthlyState.isOverdue, true);

  const weekly = {
    id: 'weekly', active: true, cadence: 'weekly', schedule_basis: 'month_days', due_days: [8, 15, 22, 29],
    created_at: '2026-08-01T00:00:00+03:00', last_completed_at: '2026-08-08T18:00:00+03:00',
  };
  assert.equal(deriveDueState(weekly, new Date('2026-08-16T12:00:00+03:00')).daysUntilDue, -1);
  weekly.last_completed_at = '2026-08-15T18:00:00+03:00';
  assert.equal(deriveDueState(weekly, new Date('2026-08-16T12:00:00+03:00')).daysUntilDue, 6);

  const newlyCreated = { ...weekly, created_at: '2026-08-10T12:00:00+03:00', last_completed_at: null };
  assert.equal(deriveDueState(newlyCreated, new Date('2026-08-12T12:00:00+03:00')).daysUntilDue, 3);
});

test('الناقل ذو العقد الساري لا يختفي من الدورة عند غياب جدوله', () => {
  const carriers = [{
    id: 'missing-schedule', name: 'ناقل متعاقد',
    file_signature: { file_kind: 'audit_and_cod_separate' },
    contracts: [{ startDate: '2026-01-01', endDate: null }],
  }];
  const invoiceChecklist = deriveCarrierAuditChecklist({ period: '2026-08', carriers, schedules: [] });
  const collectionChecklist = deriveCarrierCollectionChecklist({ period: '2026-08', carriers, schedules: [] });
  assert.equal(invoiceChecklist.length, 1);
  assert.equal(invoiceChecklist[0].status, 'unclassified');
  assert.equal(collectionChecklist.length, 1);
  assert.equal(collectionChecklist[0].status, 'unclassified');

  const stages = deriveAccountingCycleStages({ period: '2026-08', carriers, schedules: [] });
  assert.equal(stages.stages[0].status, 'attention');
  assert.equal(stages.stages[4].status, 'attention');
  assert.equal(stages.prerequisiteComplete, false);
});

test('ناقل التحصيل فقط لا يُطلب منه جدول فاتورة ولا يمنع مرحلة مراجعات الناقلين', () => {
  const carriers = [{
    id: 'cod-only', name: 'ناقل تحصيل فقط',
    file_signature: { file_kind: 'cod_only' },
    contracts: [{ startDate: '2026-01-01', endDate: null }],
  }];
  const schedules = [{
    id: 'cod-weekly', carrier_id: 'cod-only', task_kind: 'cod_remittance', active: true,
    cadence: 'weekly', schedule_basis: 'weekday', due_days: [3],
  }];
  const invoiceChecklist = deriveCarrierAuditChecklist({ period: '2026-08', carriers, schedules });
  assert.equal(invoiceChecklist.length, 1);
  assert.equal(invoiceChecklist[0].status, 'not_required');
  assert.equal(invoiceChecklist[0].expectedCount, 0);
  assert.equal(invoiceChecklist[0].fileKind, 'cod_only');

  const stages = deriveAccountingCycleStages({ period: '2026-08', carriers, schedules });
  assert.equal(stages.stages[0].status, 'complete');
  assert.equal(stages.stages[0].detail.completedCarrierCount, 1);
  assert.equal(stages.stages[1].status, 'complete');
  assert.equal(stages.stages[2].status, 'complete');
  assert.notEqual(stages.stages[4].status, 'complete');
});

test('الناقل غير المصنف يبقى مانعًا للإقفال حتى لو أضيف له جدول فاتورة يدويًا', () => {
  const carriers = [{
    id: 'unknown', name: 'ناقل غير مصنف', file_signature: {},
    contracts: [{ startDate: '2026-01-01', endDate: null }],
  }];
  const schedules = [{
    id: 'invoice', carrier_id: 'unknown', task_kind: 'invoice', active: true,
    cadence: 'monthly', schedule_basis: 'month_days', due_days: [1],
  }];
  const checklist = deriveCarrierAuditChecklist({ period: '2026-08', carriers, schedules });
  assert.equal(checklist[0].status, 'unclassified');
  assert.match(checklist[0].note, /غير مصنفة/);
});

test('الجدول الأسبوعي بلا يوم يمنع الإقفال ولا يتحول إلى الأحد', () => {
  const carriers = [{ id: 'carrier-1', name: 'ناقل', file_signature: { file_kind: 'audit_with_cod' } }];
  const schedules = [{ id: 'bad', carrier_id: 'carrier-1', task_kind: 'invoice', active: true, cadence: 'weekly', day_of_period: null }];
  const invoiceChecklist = deriveCarrierAuditChecklist({ period: '2026-08', carriers, schedules });
  const collectionChecklist = deriveCarrierCollectionChecklist({ period: '2026-08', carriers, schedules });
  assert.equal(invoiceChecklist[0].status, 'unclassified');
  assert.equal(collectionChecklist[0].status, 'unclassified');
});

test('الفاتورة الشهرية لا تغطي تحصيلات الناقل الأسبوعية المنفصلة', () => {
  const schedules = [
    { id: 'invoice', carrier_id: 'jnt', task_kind: 'invoice', active: true, cadence: 'monthly', day_of_period: 1 },
    { id: 'cod', carrier_id: 'jnt', task_kind: 'cod_remittance', active: true, cadence: 'weekly', day_of_period: 8 },
  ];
  const audits = [{ id: 'invoice-1', carrier_id: 'jnt', carrier_name: 'J&T', review_status: 'approved' }];
  const carriers = [{ id: 'jnt', name: 'J&T', file_signature: { file_kind: 'audit_and_cod_separate' } }];

  const invoiceChecklist = deriveCarrierAuditChecklist({ period: '2026-08', audits, carriers, schedules });
  assert.equal(invoiceChecklist[0].status, 'complete');
  assert.equal(invoiceChecklist[0].expectedCount, 1);

  const collectionChecklist = deriveCarrierCollectionChecklist({
    period: '2026-08', approvedAudits: audits, carriers, schedules,
    asOf: '2026-08-16',
    events: [{ stage: 'carrier_collections', status: 'success', result: { carrier: 'jnt', fileCount: 1, scheduleSlot: '2026-08-08' } }],
  });
  assert.equal(collectionChecklist[0].status, 'pending');
  assert.equal(collectionChecklist[0].expectedCount, 4);
  assert.equal(collectionChecklist[0].receivedCount, 1);
  assert.equal(collectionChecklist[0].missingCount, 3);
  assert.equal(collectionChecklist[0].dueMissingCount, 1);
  assert.equal(collectionChecklist[0].upcomingMissingCount, 2);
});

test('إعادة رفع ملف تحصيل مكرر لا تُحسب دفعة أسبوعية جديدة', () => {
  const schedules = [{ id: 'cod', carrier_id: 'jnt', task_kind: 'cod_remittance', active: true, cadence: 'weekly', day_of_period: 8 }];
  const audits = [{ id: 'invoice-1', carrier_id: 'jnt', review_status: 'approved' }];
  const carriers = [{ id: 'jnt', name: 'J&T', file_signature: { file_kind: 'audit_and_cod_separate' } }];
  const checklist = deriveCarrierCollectionChecklist({
    period: '2026-08', approvedAudits: audits, carriers, schedules,
    events: [
      { id: 'ok', stage: 'carrier_collections', status: 'success', file_name: 'week-1.xlsx', result: { carrier: 'jnt', fileCount: 1, savedCount: 20, scheduleSlot: '2026-08-08' } },
      { id: 'duplicate', stage: 'carrier_collections', status: 'success', file_name: 'week-1.xlsx', result: { carrier: 'jnt', fileCount: 1, savedCount: 0, skippedCount: 20, scheduleSlot: '2026-08-08' } },
    ],
  });
  assert.equal(checklist[0].receivedCount, 1);
  assert.equal(checklist[0].missingCount, 3);
});

test('موعد التحصيل المخزن في صفوف COD يبقى إثباتاً للدورة إذا غاب من سجل الحدث', () => {
  const schedules = [{
    id: 'cod', carrier_id: 'jnt', task_kind: 'cod_remittance', active: true,
    cadence: 'weekly', schedule_basis: 'month_days', due_days: [8, 15, 22, 29],
  }];
  const carriers = [{ id: 'jnt', name: 'J&T', file_signature: { file_kind: 'audit_and_cod_separate' } }];
  const checklist = deriveCarrierCollectionChecklist({
    period: '2026-08', carriers, schedules,
    events: [{
      id: 'event-without-slot', stage: 'carrier_collections', status: 'success',
      file_name: 'week-1.xlsx', result: { carrier: 'jnt', fileCount: 1, savedCount: 20 },
    }],
    codUploads: [{
      carrier_id: 'jnt', upload_id: 'cod_in_1', source_file: 'week-1.xlsx',
      upload_date: '2026-09-02', schedule_slot: '2026-08-08',
    }],
  });
  assert.equal(checklist[0].receivedCount, 1);
  assert.deepEqual(checklist[0].receivedSlots, ['2026-08-08']);
  assert.equal(checklist[0].missingCount, 3);
});

test('ملفان مختلفان لنفس موعد التحصيل الأسبوعي لا يُكملان موعدين', () => {
  const schedules = [{
    id: 'cod', carrier_id: 'jnt', task_kind: 'cod_remittance', active: true,
    cadence: 'weekly', schedule_basis: 'month_days', due_days: [8, 15, 22, 29],
  }];
  const carriers = [{ id: 'jnt', name: 'J&T', file_signature: { file_kind: 'audit_and_cod_separate' } }];
  const events = ['first.xlsx', 'corrected.xlsx'].map((fileName, index) => ({
    id: `event-${index}`,
    stage: 'carrier_collections', status: 'success', file_name: fileName,
    result: { carrier: 'jnt', fileCount: 1, savedCount: 20, scheduleSlot: '2026-08-08' },
  }));
  const checklist = deriveCarrierCollectionChecklist({ period: '2026-08', carriers, schedules, events });
  assert.equal(checklist[0].receivedCount, 1);
  assert.equal(checklist[0].missingCount, 3);
  assert.equal(checklist[0].duplicateSlotCount, 1);
});

test('ملفان مختلفان لنفس موعد الفاتورة الأسبوعية لا يُكملان موعدين', () => {
  const schedules = [{
    id: 'combined', carrier_id: 'imile', task_kind: 'invoice', active: true,
    cadence: 'weekly', schedule_basis: 'month_days', due_days: [5, 12, 19, 26],
  }];
  const carriers = [{ id: 'imile', name: 'أي مايل', file_signature: { file_kind: 'audit_with_cod' } }];
  const audits = ['first.xlsx', 'corrected.xlsx'].map((fileName, index) => ({
    id: `audit-${index}`, carrier_id: 'imile', review_status: 'approved', file_name: fileName,
    col_map: { __control: { scheduleSlot: '2026-08-05' } },
  }));
  const invoiceChecklist = deriveCarrierAuditChecklist({ period: '2026-08', carriers, schedules, audits });
  const collectionChecklist = deriveCarrierCollectionChecklist({ period: '2026-08', carriers, schedules, approvedAudits: audits });
  assert.equal(invoiceChecklist[0].receivedCount, 1);
  assert.equal(invoiceChecklist[0].missingCount, 3);
  assert.equal(invoiceChecklist[0].duplicateSlotCount, 1);
  assert.equal(collectionChecklist[0].receivedCount, 1);
  assert.equal(collectionChecklist[0].missingCount, 3);
});

test('الملف الأسبوعي الموحّد يثبت الفاتورة والتحصيل معًا ولا يكتمل بملف واحد', () => {
  const schedules = [{ id: 'combined', carrier_id: 'imile', task_kind: 'invoice', active: true, cadence: 'weekly', day_of_period: 3 }];
  const carriers = [{ id: 'imile', name: 'أي مايل', file_signature: { file_kind: 'audit_with_cod' } }];
  const weeklySlots = ['2026-08-05', '2026-08-12', '2026-08-19'];
  const audits = Array.from({ length: 3 }, (_, index) => ({
    id: `a-${index}`, carrier_id: 'imile', carrier_name: 'أي مايل', review_status: 'approved',
    col_map: { __control: { scheduleSlot: weeklySlots[index] } },
  }));
  const expected = expectedScheduleSlots(schedules[0], '2026-08').length;
  assert.equal(expected, 4);
  const invoiceChecklist = deriveCarrierAuditChecklist({ period: '2026-08', audits, carriers, schedules });
  const collectionChecklist = deriveCarrierCollectionChecklist({ period: '2026-08', approvedAudits: audits, carriers, schedules });
  assert.equal(invoiceChecklist[0].missingCount, 1);
  assert.equal(collectionChecklist[0].missingCount, 1);
  assert.equal(collectionChecklist[0].status, 'pending');
  assert.equal(collectionChecklist[0].requiresManualUpload, false);
  assert.match(collectionChecklist[0].note, /يُرفع في مرحلة الفواتير/);
});

test('دورة شهر كاملة تقبل الأسبوعي الموحّد وتفصل الفاتورة الشهرية عن التحصيل الأسبوعي', () => {
  const controlFor = (fileName, scheduleSlot) => ({ version: 3, valid: true, fileName, contractLabels: ['عقد 2026'], scheduleSlot });
  const approvedAudit = (id, carrierId, scheduleSlot) => ({
    id,
    carrier_id: carrierId,
    carrier_name: carrierId,
    file_name: `${id}.xlsx`,
    review_status: 'approved',
    weight_billing_status: 'skipped',
    col_map: { __control: controlFor(`${id}.xlsx`, scheduleSlot) },
  });
  const audits = [
    ...['2026-08-05', '2026-08-12', '2026-08-19', '2026-08-26']
      .map((slot, index) => approvedAudit(`combined-${index + 1}`, 'combined', slot)),
    approvedAudit('separate-month', 'separate', '2026-08-01'),
  ];
  const carriers = [
    {
      id: 'combined', name: 'ملف موحد أسبوعي',
      file_signature: { file_kind: 'audit_with_cod' },
      contracts: [{ startDate: '2026-01-01', endDate: null }],
    },
    {
      id: 'separate', name: 'فاتورة شهرية وتحصيل أسبوعي',
      file_signature: { file_kind: 'audit_and_cod_separate' },
      contracts: [{ startDate: '2026-01-01', endDate: null }],
    },
    {
      id: 'cod-only', name: 'تحصيل فقط',
      file_signature: { file_kind: 'cod_only' },
      contracts: [{ startDate: '2026-01-01', endDate: null }],
    },
  ];
  const schedules = [
    { id: 'combined-weekly', carrier_id: 'combined', task_kind: 'invoice', active: true, cadence: 'weekly', schedule_basis: 'month_days', due_days: [5, 12, 19, 26] },
    { id: 'separate-invoice', carrier_id: 'separate', task_kind: 'invoice', active: true, cadence: 'monthly', schedule_basis: 'month_days', due_days: [1] },
    { id: 'separate-cod', carrier_id: 'separate', task_kind: 'cod_remittance', active: true, cadence: 'weekly', schedule_basis: 'month_days', due_days: [8, 15, 22, 29] },
    { id: 'cod-only-weekly', carrier_id: 'cod-only', task_kind: 'cod_remittance', active: true, cadence: 'weekly', schedule_basis: 'month_days', due_days: [8, 15, 22, 29] },
  ];
  const events = ['separate', 'cod-only'].flatMap(carrierId =>
    [8, 15, 22, 29].map((day, index) => ({
      id: `${carrierId}-${index + 1}`,
      stage: 'carrier_collections',
      status: 'success',
      file_name: `${carrierId}-week-${index + 1}.xlsx`,
      row_count: 10,
      result: { carrier: carrierId, savedCount: 10, fileCount: 1, scheduleSlot: `2026-08-${String(day).padStart(2, '0')}` },
    })),
  );
  const cycle = deriveAccountingCycleStages({
    period: '2026-08',
    audits,
    carriers,
    schedules,
    events,
    balanceSnapshot: { id: 'balance' },
    merchantSnapshot: { id: 'merchants' },
    codOut: { count: 1, last: { id: 'lamha-cod' } },
  });
  assert.equal(cycle.stages[0].status, 'complete');
  assert.equal(cycle.stages[0].detail.requiredCarrierCount, 3);
  assert.equal(cycle.stages[0].detail.completedCarrierCount, 3);
  assert.equal(cycle.stages[4].status, 'complete');
  assert.equal(cycle.stages[4].detail.requiredCarrierCount, 3);
  assert.equal(cycle.stages[4].detail.completedCarrierCount, 3);
  assert.equal(cycle.prerequisiteComplete, true);
  assert.equal(cycle.stages[6].status, 'ready');
});

test('قائمة تحصيل الناقلين تفصل التلقائي واليدوي وغير المهيأ لكل ناقل في الشهر', () => {
  const approvedAudits = [
    { id: 'a-auto', carrier_id: 'imile', carrier_name: 'أي مايل' },
    { id: 'a-uploaded', carrier_id: 'jnt', carrier_name: 'J&T' },
    { id: 'a-pending', carrier_id: 'smsa', carrier_name: 'سمسا' },
    { id: 'a-none', carrier_id: 'audit-only', carrier_name: 'ناقل بلا تحصيل' },
    { id: 'a-unsupported', carrier_id: 'manual-x', carrier_name: 'ناقل يدوي جديد' },
    { id: 'a-unknown', carrier_id: 'unknown-x', carrier_name: 'ناقل غير مصنف' },
  ];
  const carriers = [
    { id: 'imile', name: 'أي مايل', file_signature: { file_kind: 'audit_with_cod' } },
    { id: 'jnt', name: 'J&T', file_signature: { file_kind: 'audit_and_cod_separate' } },
    { id: 'smsa', name: 'سمسا', file_signature: { file_kind: 'cod_only' } },
    { id: 'audit-only', name: 'ناقل بلا تحصيل', file_signature: { file_kind: 'audit_only' } },
    { id: 'manual-x', name: 'ناقل يدوي جديد', file_signature: { file_kind: 'cod_only' } },
    { id: 'unknown-x', name: 'ناقل غير مصنف', file_signature: {} },
  ];
  const checklist = deriveCarrierCollectionChecklist({
    approvedAudits,
    carriers,
    events: [{ stage: 'carrier_collections', status: 'success', result: { carrier: 'jnt' }, created_at: '2026-08-05' }],
  });
  const byCarrier = Object.fromEntries(checklist.map(item => [item.carrierId, item.status]));

  assert.deepEqual(byCarrier, {
    imile: 'automatic',
    jnt: 'uploaded',
    smsa: 'pending',
    'audit-only': 'not_required',
    'manual-x': 'unsupported',
    'unknown-x': 'unclassified',
  });
});

test('ملف تحصيل ناقل واحد لا يكمل مرحلة تحصيلات كل الناقلين', () => {
  const control = { version: 3, valid: true, fileName: 'invoice.xlsx', contractLabels: ['عقد 2026'] };
  const audits = [
    { id: 'j1', carrier_id: 'jnt', review_status: 'approved', weight_billing_status: 'skipped', col_map: { __control: control } },
    { id: 's1', carrier_id: 'smsa', review_status: 'approved', weight_billing_status: 'skipped', col_map: { __control: control } },
  ];
  const carriers = [
    { id: 'jnt', name: 'J&T', file_signature: { file_kind: 'audit_and_cod_separate' } },
    { id: 'smsa', name: 'سمسا', file_signature: { file_kind: 'audit_and_cod_separate' } },
  ];
  const partial = deriveAccountingCycleStages({
    period: '2026-08', audits, carriers,
    events: [{ stage: 'carrier_collections', status: 'success', row_count: 20, result: { carrier: 'jnt' } }],
  });
  assert.equal(partial.stages[4].status, 'attention');
  assert.equal(partial.stages[4].detail.completedCarrierCount, 1);
  assert.equal(partial.stages[4].detail.pendingCarrierCount, 1);
  assert.equal(partial.stages[4].history[0].carrier_name, 'J&T');
  assert.equal(partial.prerequisiteComplete, false);

  const complete = deriveAccountingCycleStages({
    period: '2026-08', audits, carriers,
    events: [
      { stage: 'carrier_collections', status: 'success', row_count: 20, result: { carrier: 'jnt' } },
      { stage: 'carrier_collections', status: 'success', row_count: 18, result: { carrier: 'smsa' } },
    ],
  });
  assert.equal(complete.stages[4].status, 'complete');
  assert.equal(complete.stages[4].detail.completedCarrierCount, 2);
});

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
  const control = { version: 3, valid: true, fileName: 'invoice.xlsx', contractLabels: ['عقد 2026'] };
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
  const control = { version: 3, valid: true, fileName: 'invoice.xlsx', contractLabels: ['عقد 2026'] };
  const cycle = deriveAccountingCycleStages({
    period: '2026-08',
    audits: [{ id: 'a1', review_status: 'approved', weight_billing_status: 'skipped', col_map: { __control: control } }],
    shipmentImports,
    auditShipments: [{ audit_id: 'a1', awb: 'AWB-1', weight_kg: 2, is_cod: false }],
    lamhaShipments: [{ awb: 'AWB-1' }],
  });
  const stage = cycle.stages[2];
  assert.equal(stage.status, 'complete');
  assert.equal(stage.history.length, 18);
  assert.equal(stage.last.file_name, 'lamha-17.xlsx');
  assert.equal(stage.count, 1);
  assert.equal(stage.completedCount, 1);
});

test('ملف لمحة الجزئي لا يكمل المرحلة وتعود ناقصة عند اعتماد شحنة جديدة', () => {
  const control = { version: 3, valid: true, fileName: 'invoice.xlsx', contractLabels: ['عقد 2026'] };
  const base = {
    period: '2026-08',
    audits: [{ id: 'a1', review_status: 'approved', weight_billing_status: 'skipped', col_map: { __control: control } }],
    shipmentImports: [{ id: 'i1', file_name: 'lamha.xlsx', row_count: 2, uploaded_at: '2026-08-03T10:00:00Z' }],
    auditShipments: [
      { audit_id: 'a1', awb: 'AWB-1', weight_kg: 2, is_cod: false },
      { audit_id: 'a1', awb: 'AWB-2', weight_kg: 3, is_cod: false },
      { audit_id: 'a1', awb: 'AWB-3', weight_kg: 4, is_cod: false },
    ],
  };
  const partial = deriveAccountingCycleStages({ ...base, lamhaShipments: [{ awb: 'AWB-1' }, { awb: 'AWB-2' }] });
  assert.equal(partial.stages[2].status, 'attention');
  assert.equal(partial.stages[2].detail.coverage.missingCount, 1);

  const complete = deriveAccountingCycleStages({ ...base, lamhaShipments: [{ awb: 'AWB-1' }, { awb: 'AWB-2' }, { awb: 'AWB-3' }] });
  assert.equal(complete.stages[2].status, 'complete');
  assert.equal(complete.stages[2].detail.coverage.missingCount, 0);
});

test('مطابقة أرقام لمحة تستبعد صف الرسم والوزن الصفري والتكرار وتصدر المتبقي فقط', () => {
  const coverage = deriveLamhaShipmentCoverage({
    auditShipments: [
      { awb: 'A-1', weight_kg: 2, is_cod: false },
      { awb: 'A-1', weight_kg: 2, is_cod: false },
      { awb: 'A-2', weight_kg: 0, is_cod: false },
      { awb: 'A-3', weight_kg: 4, is_cod: true },
      { awb: 'A-4', weight_kg: 5, is_cod: false },
    ],
    lamhaShipments: [{ awb: 'A-1' }, { awb: 'EXTRA' }],
  });
  assert.deepEqual(coverage, {
    expectedCount: 2,
    importedExpectedCount: 1,
    missingCount: 1,
    extraCount: 1,
    missingAwbs: ['A-4'],
  });
  assert.deepEqual(
    filterMissingShipmentSearchRows([{ 'رقم الشحنة': 'A-1' }, { 'رقم الشحنة': 'A-4' }], ['A-1']),
    [{ 'رقم الشحنة': 'A-4' }],
  );
});

test('فشل قراءة أي مصدر يظهر للمحاسب ويمنع إقفال الشهر', () => {
  const control = { version: 3, valid: true, fileName: 'invoice.xlsx', contractLabels: ['عقد 2026'] };
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
  assert.equal(cycle.stages[1].status, 'blocked');
  assert.match(cycle.stages[1].reason, /قبل تصدير الأوزان/);
  assert.equal(cycle.stages[1].detail.blockedLegacy, 1);
});

test('الشهر المختار للدورة ينتقل إلى نموذج مراجعة شركة الشحن', async () => {
  const [cyclePage, uploadWizard, cycleService, settlementPage, settlementService, tasksPage, scheduleMigration, settlementSlotMigration] = await Promise.all([
    readFile(new URL('../src/pages/AccountingCycle.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/UploadWizard.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/accountingCycleService.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/CodSettlements.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/codSettlementService.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/Tasks.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/migrations/20260806193000_explicit_carrier_schedule_days.sql', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/migrations/20260806150248_add_cod_settlement_schedule_slot.sql', import.meta.url), 'utf8'),
  ]);
  assert.match(cyclePage, /<UploadWizard key=\{period\}[^>]*initialPeriod=\{period\} lockPeriod/);
  assert.match(cyclePage, /accounting-cycle-period-bar/);
  assert.match(cyclePage, /new URLSearchParams\(\{ period \}\)/);
  assert.match(cyclePage, /new URLSearchParams\(\{ period: nextPeriod \}\)/);
  assert.match(cyclePage, /المراحل والملفات والنتائج أدناه تتبع هذا الشهر فقط/);
  assert.ok(
    cyclePage.indexOf('accounting-cycle-period-bar') < cyclePage.indexOf('<PageHeader'),
    'محدد الشهر الموحد يجب أن يسبق هيدر الدورة وكل المراحل',
  );
  assert.match(cyclePage, /if \(isActive\) refresh\(\)/);
  const appPage = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(appPage, /<AccountingCycle carriers=\{carriers\} isActive=\{pathname==='\/accounting-cycle'\}\/>/);
  assert.match(appPage, /ACCOUNTING_CYCLE_STAGES/);
  assert.match(appPage, /accounting-stage-nav/);
  assert.match(cyclePage, /const requestedStage = params\.get\('stage'\)/);
  assert.match(cyclePage, /accounting-cycle-layout accounting-cycle-layout--contextual/);
  assert.doesNotMatch(cyclePage, /accounting-cycle-list/);
  assert.match(cyclePage, /<StageHistory stage=\{selected\}[^>]*onRedownload=\{redownloadWeights\}/);
  assert.doesNotMatch(cyclePage, /history\.slice\(0,\s*12\)/);
  assert.match(cyclePage, /snapshot\.sourceErrors/);
  assert.match(cyclePage, /إعادة فحص المصادر/);
  assert.match(cyclePage, /data\.next\?\.id/);
  assert.match(cyclePage, /refresh\(\{ advance: true \}\)/);
  assert.match(cyclePage, /parseConsolidatedExpected/);
  assert.match(cyclePage, /saveConsolidatedExpected/);
  assert.match(cyclePage, /اختر ملف تحصيل لمحة المجمّع/);
  assert.match(cyclePage, /stage_attempt_failed/);
  assert.match(cyclePage, /أرقام الشحنات المطلوب البحث عنها في لمحة/);
  assert.match(cyclePage, /1 — تنزيل أرقام الشحنات من النظام/);
  assert.match(cyclePage, /2 — تنزيل ملف الأوزان الجديد لرفعه إلى لمحة/);
  assert.ok(
    cyclePage.indexOf('1 — تنزيل أرقام الشحنات من النظام')
      < cyclePage.indexOf('2 — تنزيل ملف الأوزان الجديد لرفعه إلى لمحة'),
    'تنزيل أرقام الشحنات يجب أن يظهر قبل ملف الأوزان في مسار المحاسب',
  );
  assert.match(cyclePage, /missingShipmentCount/);
  assert.match(cyclePage, /كل أرقام الشحنات المعتمدة موجودة بالفعل/);
  assert.match(cyclePage, /item\.requiresManualUpload/);
  assert.match(cyclePage, /ضبط جداول الفواتير والتحصيل/);
  assert.match(cyclePage, /إعادة تنزيل آخر ملف أوزان/);
  assert.match(cyclePage, /تنزيل هذا الملف مرة أخرى/);
  assert.match(cyclePage, /لا توجد أوزان جديدة معلقة/);
  assert.match(cyclePage, /redownloadWeightExport/);
  assert.match(cycleService, /file_name, file_path, storage_bucket, status/);
  assert.match(cyclePage, /onError=\{settlementFailed\}/);
  assert.match(cyclePage, /onApproved=\{auditApproved\}/);
  const auditResultsPage = await readFile(new URL('../src/pages/AuditResults.jsx', import.meta.url), 'utf8');
  assert.match(auditResultsPage, /onApproved\(result\)/);
  assert.match(auditResultsPage, /codExtractErr/);
  assert.match(settlementPage, /phase: 'parse'/);
  assert.match(settlementPage, /phase: 'save'/);
  assert.match(settlementPage, /ledgerError: ledgerErr/);
  assert.match(settlementPage, /scheduleSlot,/);
  assert.match(settlementService, /schedule_slot:\s+slot/);
  assert.match(settlementService, /scheduleSlot: slot/);
  assert.match(cycleService, /schedule_slot, created_at, carrier_id/);
  assert.match(cycleService, /\.or\(periodFilter\)/);
  assert.match(cyclePage, /scheduleSlot=\{settlement\.scheduleSlot\}/);
  assert.match(cyclePage, /result\.scheduleSlot \|\| settlement\?\.scheduleSlot/);
  assert.match(uploadWizard, /const blockingPriors = priors\.filter\(prior => prior\?\.review_status !== 'rejected'\)/);
  assert.match(uploadWizard, /blockingPriors\.some\(prior => prior\?\.review_status === 'approved'/);
  assert.match(settlementSlotMigration, /add column if not exists schedule_slot date/);
  assert.match(settlementSlotMigration, /check \(schedule_slot is null or direction = 'in'\)/);
  assert.match(uploadWizard, /initialPeriodMatch/);
  assert.match(uploadWizard, /lockPeriod && inferred\.source === 'shipment_dates' && inferredPeriodKey !== periodKey/);
  assert.match(uploadWizard, /غيّر الشهر من أعلى الصفحة/);
  assert.match(uploadWizard, /title: 'حدد الفترة'/);
  assert.match(cycleService, /const HISTORY_PAGE_SIZE = 1000/);
  assert.match(cycleService, /\.range\(from, to\)/);
  assert.match(cycleService, /deriveLamhaShipmentCoverage/);
  assert.match(cycleService, /loadAuditShipmentsForAudits/);
  assert.match(tasksPage, /طريقة مواعيد الأسبوع/);
  assert.match(tasksPage, /ملف موحّد — كل ملف معتمد يثبت الفاتورة والتحصيل معًا/);
  assert.match(tasksPage, /اكتمال جداول الناقلين/);
  assert.match(tasksPage, /الجدول الناقص يمنع إقفال الشهر/);
  assert.match(tasksPage, /تسجيل استلام/);
  assert.match(tasksPage, /إقفال الدورة يعتمد الملف الفعلي/);
  assert.match(tasksPage, /طريقة الشركة: تحصيل COD فقط/);
  assert.match(tasksPage, /requiredScheduleKindsForCarrier/);
  assert.match(tasksPage, /allowedTaskKinds\.has\(key\)/);
  assert.match(scheduleMigration, /add column if not exists schedule_basis/);
  assert.match(scheduleMigration, /add column if not exists due_days/);
  assert.doesNotMatch(cycleService, /accounting_cycle_events'[\s\S]{0,250}\.limit\(200\)/);
});

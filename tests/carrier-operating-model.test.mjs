import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CARRIER_INVOICE_ONLY_SINCE,
  carrierCollectionRequirement,
  carrierHasOutstandingLegacyCod,
  carrierRequiredScheduleKinds,
} from '../src/lib/carrierOperatingModel.js';
import { requiredScheduleKindsForCarrier } from '../src/lib/tasksService.js';
import { deriveCarrierCollectionChecklist } from '../src/lib/accountingCycleService.js';

test('كل شركات الشحن تعمل بمراجعة فاتورة فقط من تاريخ القرار', () => {
  assert.equal(CARRIER_INVOICE_ONLY_SINCE, '2026-08-19');
  assert.deepEqual(carrierRequiredScheduleKinds(), ['invoice']);
  for (const fileKind of ['audit_with_cod', 'audit_and_cod_separate', 'audit_only', 'cod_only', null]) {
    assert.deepEqual(requiredScheduleKindsForCarrier({ file_signature: { file_kind: fileKind } }), ['invoice']);
  }
});

test('تحصيل COD التاريخي لا ينشئ متطلبًا تشغيليًا جديدًا', () => {
  assert.deepEqual(carrierCollectionRequirement(), {
    status: 'not_required',
    requiresManualUpload: false,
    note: 'توقف إنشاء تحصيل COD جديد منذ 2026-08-19؛ تظهر الأرصدة التاريخية المتبقية في مسار التصفية فقط',
  });

  const checklist = deriveCarrierCollectionChecklist({
    period: '2026-08',
    carriers: [{ id: 'smsa', name: 'سمسا', contracts: [{ startDate: '2026-01-01' }] }],
    schedules: [{ id: 'old-cod', carrier_id: 'smsa', task_kind: 'cod_remittance', active: true }],
    events: [{ stage: 'carrier_collections', status: 'success', result: { carrier: 'smsa' } }],
  });

  assert.equal(checklist.length, 1);
  assert.equal(checklist[0].status, 'not_required');
  assert.equal(checklist[0].requiresManualUpload, false);
});

test('قائمة التصفية تعرض الرصيد الحقيقي فقط وتخفي الصفر والفروق التقريبية', () => {
  assert.equal(carrierHasOutstandingLegacyCod(0), false);
  assert.equal(carrierHasOutstandingLegacyCod(0.009), false);
  assert.equal(carrierHasOutstandingLegacyCod(-0.009), false);
  assert.equal(carrierHasOutstandingLegacyCod(0.011), true);
  assert.equal(carrierHasOutstandingLegacyCod(-10), true);
});

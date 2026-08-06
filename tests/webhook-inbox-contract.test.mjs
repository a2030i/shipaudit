import test from 'node:test';
import assert from 'node:assert/strict';

import {
  countWebhookStatuses,
  effectiveWebhookStatus,
  inferCarrierDocumentKind,
} from '../src/lib/webhookService.js';

test('حالة processed القادمة من الاستقبال لا تخفي ملفًا لم يُرحّل فعليًا', () => {
  assert.equal(effectiveWebhookStatus({
    status: 'processed', detected_carrier_id: 'jnt', audit_id: null, processed_at: null,
  }), 'pending');
  assert.equal(effectiveWebhookStatus({
    status: 'processed', detected_carrier_id: 'jnt', processed_at: '2026-07-06T10:00:00Z',
  }), 'processed');
  assert.equal(effectiveWebhookStatus({
    status: 'processed', detected_carrier_id: 'jnt', actioned_by_source: true,
  }), 'processed');
});

test('عداد الوارد يستخدم الحالة الفعلية بعد مطابقة ملف التحصيل الموجود', () => {
  assert.deepEqual(countWebhookStatuses([
    { status: 'processed', detected_carrier_id: 'jnt', actioned_by_source: true },
    { status: 'processed', detected_carrier_id: 'jnt' },
  ]), {
    pending: 1,
    processing: 0,
    processed: 1,
    failed: 0,
    awaiting_assignment: 0,
  });
});

test('ملفات J&T الشهرية وكشوف COD تتجه للمسار الصحيح فقط', () => {
  assert.equal(inferCarrierDocumentKind({
    file_name: 'WestBr202607190021_Date19-07-2026_For Tech.xlsx',
  }), 'cod');
  assert.equal(inferCarrierDocumentKind({
    file_name: 'For Tech_31913.27_2026-06-01 ~ 2026-06-30.XLSX',
  }), 'audit');
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveContractReadiness } from '../src/lib/contractHistoryService.js';

test('جاهزية العقد تفصل وجود التسعير عن نوع الملف والمستند الرسمي', () => {
  const rows = deriveContractReadiness([
    {
      id: 'ready', name: 'جاهز', contract_pdf_path: 'contracts/ready.pdf',
      file_signature: { file_kind: 'audit_with_cod' },
      contracts: [{ id: 'c1', startDate: '2026-01-01', endDate: null }],
    },
    {
      id: 'missing', name: 'ناقص', contract_pdf_path: null,
      file_signature: {}, contracts: [],
    },
  ], '2026-08-06');

  assert.equal(rows[0].operationallyConfigured, true);
  assert.equal(rows[0].hasOfficialDocument, true);
  assert.equal(rows[1].operationallyConfigured, false);
  assert.equal(rows[1].hasContract, false);
  assert.equal(rows[1].hasFileKind, false);
  assert.equal(rows[1].hasOfficialDocument, false);
});

test('العقد المنتهي لا يجهز تدقيق النصف الثاني', () => {
  const [row] = deriveContractReadiness([{
    id: 'expired', name: 'منتهي',
    file_signature: { file_kind: 'audit_and_cod_separate' },
    contracts: [{ id: 'old', startDate: '2025-01-01', endDate: '2026-06-30' }],
  }], '2026-08-06');
  assert.equal(row.contractCount, 1);
  assert.equal(row.activeContractCount, 0);
  assert.equal(row.hasContract, false);
  assert.equal(row.operationallyConfigured, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const overview = readFileSync(new URL('../src/pages/ContractsOverview.jsx', import.meta.url), 'utf8');
const historyService = readFileSync(new URL('../src/lib/contractHistoryService.js', import.meta.url), 'utf8');
const coreService = readFileSync(new URL('../src/lib/coreService.js', import.meta.url), 'utf8');

test('صفحة العقود تعرض إجراءات مستند العقد من نفس الجدول', () => {
  assert.match(overview, /مستند العقد/);
  assert.match(overview, /رفع PDF/);
  assert.match(overview, /استبدال/);
  assert.match(overview, /handleDocumentView/);
  assert.match(overview, /handleDocumentDownload/);
  assert.match(overview, /accept="application\/pdf,\.pdf"/);
});

test('بيانات العقود تحمل مسار المستند وتستخدم روابط خاصة مؤقتة', () => {
  assert.match(historyService, /contract_pdf_path/);
  assert.match(historyService, /contractPdfPath: c\.contract_pdf_path/);
  assert.match(coreService, /createSignedUrl\(path, expiresInSec, \{ download: true \}\)/);
  assert.match(coreService, /setCarrierContractPdfPath/);
  assert.match(coreService, /\.select\('id'\)\s*\.single\(\)/);
});

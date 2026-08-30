import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const commandCenter = await readFile(new URL('../src/components/operations/FigmaCommandCenter.jsx', import.meta.url), 'utf8');
const customerMoney = await readFile(new URL('../src/pages/CustomerMoney.jsx', import.meta.url), 'utf8');
const lamhaReview = await readFile(new URL('../src/components/LamhaDecisionActionReview.jsx', import.meta.url), 'utf8');
const zohoData = await readFile(new URL('../src/pages/ZohoData.jsx', import.meta.url), 'utf8');
const customerWatch = await readFile(new URL('../src/pages/CustomerWatch.jsx', import.meta.url), 'utf8');

test('overview decision cards open explicit, returnable result drill-downs', () => {
  assert.match(commandCenter, /customer-money\?decision=stop&decisionMin=\$\{DEFAULT_SUSPENSION_MIN_OVERDUE\}&returnTo=%2Foverview/);
  assert.match(commandCenter, /customer-money\?decision=deduct&returnTo=%2Foverview/);
  assert.match(customerMoney, /decisionKey\(searchParams\.get\('decision'\)\)/);
  assert.match(customerMoney, /loadAllCustomerReceivablesRows/);
  assert.match(customerMoney, /customerDecisionMatch/);
  assert.match(customerMoney, /source: 'overview-decision'/);
  assert.match(commandCenter, /loadCachedLamhaStoreStatuses/);
  assert.match(commandCenter, /financialHoldStoreIds/);
});

test('executive work lists open exact result sets without losing the flexible path', () => {
  assert.match(commandCenter, /zoho-data\?tab=customers&type=invoices&focus=zatca/);
  assert.match(commandCenter, /\/customer-money\?worklist=1&returnTo=%2Foverview/);
  assert.match(commandCenter, /أنشئ قائمة تنفيذ بشروطك/);
  assert.match(commandCenter, /لا توجد شروط مفروضة/);
  assert.doesNotMatch(commandCenter, /WORKLIST_DEFAULTS/);
  assert.match(customerMoney, /searchParams\.get\('worklist'\) !== '1'/);
  assert.match(customerMoney, /\.aging-operations/);
  assert.match(customerMoney, /matchesCustomerOperationalQuery\(row, agingFilterState\)/);
  assert.match(zohoData, /einvoice_status \|\| ''/);
  assert.match(zohoData, /yet_to_be_pushed/);
  assert.match(customerWatch, /recentShipmentRows/);
  assert.match(customerWatch, /شحنوا خلال آخر/);
});

test('opening decision results is read-only and Lamha mutation remains a reviewed second step', () => {
  assert.match(customerMoney, /فتح النتائج للقراءة فقط ولا ينفذ خصمًا أو إيقافًا/);
  assert.match(customerMoney, /فحص حالة لمحة ومراجعة الإيقاف/);
  assert.match(customerMoney, /<LamhaDecisionActionReview rows=\{decisionScopeRows\}/);
  assert.match(lamhaReview, /evaluateLamhaStopPreflight/);
  assert.match(lamhaReview, /actionContext = 'financial_policy'/);
  assert.match(lamhaReview, /createSubmissionGuard/);
  assert.doesNotMatch(customerMoney, /runLamhaStoreOperation/);
});

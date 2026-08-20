import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('campaign panel keeps hook order stable across loading and loaded renders', () => {
  const source = read('src/pages/WhatsAppSettings.jsx');
  const effect = source.indexOf("const next = allowedViews.includes(requestedView)");
  const earlyReturn = source.indexOf("if (rows == null) return");
  assert.ok(effect > 0, 'requested campaign view synchronization must exist');
  assert.ok(earlyReturn > effect, 'all CampaignsTab hooks must run before the loading return');
});

test('collection campaign entry explains selection and opens review rather than sending', () => {
  const money = read('src/pages/CustomerMoney.jsx');
  const queue = read('src/components/operations/AgingOperationsQueue.jsx');
  assert.match(money, /اختر شريحة، ثم حدّد النتائج/);
  assert.match(queue, /Draft حملة/);
  assert.match(queue, /مراجعة الجمهور دون إرسال مباشر|مراجعة المؤهل والمستبعد قبل أي إرسال/);
});

test('quick actions expose marketing without bypassing audience review', () => {
  const source = read('src/components/QuickActionLauncher.jsx');
  assert.match(source, /إنشاء حملة تسويقية/);
  assert.match(source, /\/retargeting\?view=external/);
});

test('bank upload copy separates internal comparison from manual Zoho upload', () => {
  const source = read('src/pages/BankStatement.jsx');
  assert.match(source, /داخل ShipAudit/);
  assert.match(source, /داخل Zoho Books/);
  assert.match(source, /لا يرسل كشفًا بنكيًا/);
});

test('carrier hub treats COD as historical wind-down work', () => {
  const source = read('src/pages/CarriersHub.jsx');
  assert.match(source, /رصيد COD تاريخي يحتاج تصفية/);
  assert.match(source, /مراجعة الفواتير هي المسار التشغيلي الحالي/);
});

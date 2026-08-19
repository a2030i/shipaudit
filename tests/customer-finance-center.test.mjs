import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('مركز العملاء المالي يجمع القرار والتحصيل والتواصل دون إرسال تلقائي', async () => {
  const page = await read('src/pages/CustomerMoney.jsx');
  assert.match(page, /مركز العملاء المالي/);
  assert.match(page, /ابدأ التحصيل/);
  assert.match(page, /جهّز حملة تحصيل/);
  assert.match(page, /هاتف وWhatsApp/);
  assert.match(page, /مراجعة IVR/);
  assert.match(page, /مطابقة الأرصدة/);
  assert.match(page, /can\('campaigns\.send'\)/);
  assert.match(page, /can\('campaigns\.ivr'\)/);
  assert.match(page, /returnTo/);
  assert.doesNotMatch(page, /sendWhatsApp\(/);
});

test('نشاط لمحة تحميل تدريجي ولا يعطل أرقام التحصيل عند فشل المصدر', async () => {
  const page = await read('src/pages/CustomerMoney.jsx');
  assert.match(page, /loadCustomerActivationCommandCenter/);
  assert.match(page, /نشاط لمحة غير متاح/);
  assert.match(page, /بقيت الأرقام المالية وإجراءات التحصيل متاحة/);
});

test('التنقل يضع المالية أولًا ويُبقي هاتف والحملات للعملاء خارج المنصة', async () => {
  const navigation = await read('src/lib/navigation.js');
  const financeIndex = navigation.indexOf("id: 'finance'");
  const customersIndex = navigation.indexOf("id: 'customers'");
  const salesIndex = navigation.indexOf("id: 'sales'");
  assert.ok(financeIndex >= 0 && financeIndex < customersIndex && customersIndex < salesIndex);
  assert.match(navigation, /label: 'مركز العملاء المالي'/);
  assert.match(navigation, /label: 'العملاء خارج المنصة'/);
  assert.match(navigation, /label: 'التواصل'/);
  assert.match(navigation, /\/whatsapp-settings\?tab=overview/);
});

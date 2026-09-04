import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('automation center keeps one route and preserves specialized system agents', async () => {
  const [page, center, navigation] = await Promise.all([
    read('src/pages/WorkAgents.jsx'),
    read('src/components/automation/AutomationControlCenter.jsx'),
    read('src/lib/navigation.js'),
  ]);
  assert.match(page, /AutomationControlCenter/);
  assert.match(page, /LegacySystemAgents/);
  assert.match(center, /وكلاء النظام/);
  assert.match(center, /LegacyPanel/);
  assert.match(navigation, /label:\s*'مركز الأتمتة'/);
  assert.doesNotMatch(navigation, /path:\s*'\/automation'/);
});
test('rule builder exposes the complete decision path without a send button', async () => {
  const center = await read('src/components/automation/AutomationControlCenter.jsx');
  for (const label of [
    'التعريف', 'المحفز والشروط', 'الجمهور والاستثناءات', 'القالب والمتغيرات',
    'التوقيت والحماية', 'المعاينة والتفعيل', 'معاينة بدون إرسال',
  ]) assert.match(center, new RegExp(label));
  assert.doesNotMatch(center, />إرسال الآن</);
  assert.match(center, /رسالة واحدة للجوال/);
  assert.match(center, /لا تنفذ المعاينة إرسالًا/);
  assert.match(center, /حالة القاعدة/);
  assert.match(center, /نطاق منع التكرار/);
  assert.match(center, /once_per_snapshot_phone/);
  assert.match(center, /متجر جديد في فحص لاحق/);
});

test('template variables are manager-entered fixed values', async () => {
  const center = await read('src/components/automation/AutomationControlCenter.jsx');
  assert.match(center, /template_variables/);
  assert.match(center, /mode:\s*'fixed'/);
  assert.match(center, /تُرسل القيم المكتوبة كما هي لكل مستلم/);
  assert.match(center, /لا يستنتج النظام اسم موظف أو متجر/);
});

test('automation migration is preview-only and applies the current business contracts', async () => {
  const migration = await read('supabase/migrations/20260903192632_automation_rules_control_center.sql');
  assert.match(migration, /deliberately does not schedule or send messages/);
  assert.match(migration, /'welcome_new_customer'/);
  assert.match(migration, /'invoice_overdue_15'/);
  assert.match(migration, /'account_deactivated'/);
  assert.match(migration, /'stopped_shipping_5d'/);
  assert.match(migration, /'never_shipped'/);
  assert.match(migration, /event_type='new_customer' then 'registered' else 'deactivated'/);
  assert.match(migration, /public\.lamha_account_enabled\(m\.status\)/);
  assert.match(migration, /coalesce\(z\.balance,0\)>v_min_amount/);
  assert.match(migration, /lower\(coalesce\(z\.status,''\)\) not in \('draft','void','cancelled','paid'\)/);
  assert.doesNotMatch(migration, /insert into public\.campaign_queue/i);
  assert.doesNotMatch(migration, /hatif-send|lamha-store-status/);
});

test('automation schema is versioned, least-privilege and blocks automatic unknown retries', async () => {
  const migration = await read('supabase/migrations/20260903192632_automation_rules_control_center.sql');
  assert.match(migration, /automation_rule_versions/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /app_has_any_permission\(array\['agents\.manage'\]\)/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /blockUnknownDeliveryRetry/);
  assert.match(migration, /maxMessagesPerPhonePerDay/);
  assert.match(migration, /audienceIdentity":"normalized_phone/);
});

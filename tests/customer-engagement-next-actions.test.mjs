import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/20260815190229_customer_engagement_next_actions.sql', import.meta.url), 'utf8');
const service = readFileSync(new URL('../src/lib/nextActionsService.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/pages/NextActions.jsx', import.meta.url), 'utf8');

test('محرك التفاعل يجمع رحلات الجدد والمتوقفين والمتابعات والتحصيل', () => {
  assert.match(migration, /customer_engagement_next_actions/);
  for (const reason of ['new_registered', 'new_ready', 'stopped_recent', 'stopped_long', 'wallet_neg', 'debt']) {
    assert.match(migration, new RegExp(`'${reason}'`));
  }
  assert.match(migration, /v_crm_retargeting/);
  assert.match(migration, /hatif_call_log/);
});

test('القرار محمي بالصلاحيات وحواجز التواصل ولا يرسل تلقائيا', () => {
  assert.match(migration, /security definer/);
  assert.match(migration, /app_has_any_permission/);
  assert.match(migration, /campaign_phone_blocklist/);
  assert.match(migration, /recent_campaign/);
  assert.match(migration, /recent_call/);
  assert.match(migration, /stale_source/);
  assert.doesNotMatch(migration, /hatif-send/);
});

test('الواجهة تعرض خطة تجريبية بلا أي مسار إرسال', () => {
  assert.match(service, /customer_engagement_next_actions/);
  assert.match(service, /recommendedTemplateKey/);
  assert.match(page, /مؤهل مبدئيًا/);
  assert.match(page, /محمي من التواصل/);
  assert.match(page, /وضع تجريبي — الإرسال غير مفعّل/);
  assert.match(page, /محاكاة فقط — لا يوجد زر إرسال/);
  assert.match(page, /EngagementPlanPreview/);
  assert.doesNotMatch(page, /WhatsAppSendModal/);
  assert.doesNotMatch(page, /sendWhatsAppCampaign/);
  assert.match(page, /الجدد/);
  assert.match(page, /المتوقفون/);
});

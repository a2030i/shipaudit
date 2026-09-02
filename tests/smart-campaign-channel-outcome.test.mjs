import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveSmartCampaignChannelOutcome } from '../src/lib/smartCampaignService.js';

const completedAt = '2026-08-31T16:00:00.000Z';

test('يقفل إرسال واتساب الناجح كمكتمل', () => {
  assert.deepEqual(resolveSmartCampaignChannelOutcome({ sent: 10, failed: 0 }, 'whatsapp', completedAt), {
    status: 'completed',
    scheduledAt: null,
    launchedAt: completedAt,
    completedAt,
    eventType: 'channel_completed',
  });
});

test('يصنف فشل واتساب الجزئي كحملة تحتاج قراراً', () => {
  assert.deepEqual(resolveSmartCampaignChannelOutcome({ sent: 8, failed: 2 }, 'whatsapp', completedAt), {
    status: 'needs_decision',
    scheduledAt: null,
    launchedAt: completedAt,
    completedAt,
    eventType: 'channel_partial_failure',
  });
});

test('تبقى جدولة القناة مجدولة ولا تسجل اكتمالاً', () => {
  assert.deepEqual(resolveSmartCampaignChannelOutcome({ scheduled: true, scheduledAt: '2026-09-01T00:00:00.000Z' }, 'whatsapp', completedAt), {
    status: 'scheduled',
    scheduledAt: '2026-09-01T00:00:00.000Z',
    launchedAt: null,
    completedAt: null,
    eventType: 'channel_scheduled',
  });
});

test('يبقى IVR الفوري قيد التشغيل حتى اكتمال المزود', () => {
  assert.deepEqual(resolveSmartCampaignChannelOutcome({ queued: 10 }, 'ivr', completedAt), {
    status: 'running',
    scheduledAt: null,
    launchedAt: completedAt,
    completedAt: null,
    eventType: 'channel_launched',
  });
});

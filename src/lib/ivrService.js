// ivrService — مكالمات آلية (Outbound IVR) عبر Voxa/Hatif.
// الإطلاق والحالة عبر edge function hatif-ivr؛ النتائج والضغطات في جدول ivr_calls
// (يحدّثها ivr-webhook). مصمَّم أساساً للوصول لمن لا يملك واتساب (§IVR).
import { supabase } from './supabase.js';

const IVR_FN = 'hatif-ivr';

// متغيّرات النص المنطوق — تُدرَج بزر، وتُملأ لكل عميل من بيانات الحملة (fillTts).
export const IVR_VARS = [
  { token: '{name}', label: 'الاسم' },
  { token: '{amount}', label: 'المبلغ/المديونية' },
  { token: '{wallet}', label: 'رصيد المحفظة' },
  { token: '{overdue}', label: 'المتأخّر' },
  { token: '{shipments}', label: 'عدد الشحنات' },
  { token: '{last_shipment}', label: 'آخر شحنة' },
  { token: '{days_since}', label: 'أيام منذ آخر شحنة' },
  { token: '{invoices_count}', label: 'عدد الفواتير' },
  { token: '{oldest_days}', label: 'عمر أقدم فاتورة' },
  { token: '{city}', label: 'المدينة' },
];

export const IVR_ACTIONS = [
  { key: 'send_template', label: 'إرسال قالب واتساب (اختر القالب ⬅)' },
  { key: 'followup', label: 'متابعة مبيعات/تحصيل (مهمة للفريق)' },
  { key: 'callback', label: 'طلب معاودة اتصال' },
  { key: 'dnc',      label: 'إيقاف الاتصالات (لا تتصل به)' },
  { key: 'none',     label: 'بلا إجراء (تسجيل فقط)' },
];

const DEFAULT_CFG = {
  enabled: false, ttsVoice: 'Female', channelId: '',
  maxAudioRetries: 2, inputTimeoutMs: 6000, digitTimeoutMs: 3000,
  defaultScript: '', scripts: [],
  callHours: { start: 9, end: 21 },                                    // نافذة الاتصال بتوقيت السعودية
  retry: { enabled: false, afterHours: 3, maxAttempts: 2, onResults: ['NoAnswer', 'Busy'] },
};

export async function loadIvrConfig() {
  const { data } = await supabase.from('app_settings').select('value').eq('key', 'ivr_config').maybeSingle();
  if (!data?.value) return { ...DEFAULT_CFG };
  try { return { ...DEFAULT_CFG, ...JSON.parse(data.value) }; } catch { return { ...DEFAULT_CFG }; }
}

export async function saveIvrConfig(cfg) {
  const clean = {
    enabled: !!cfg.enabled,
    ttsVoice: cfg.ttsVoice === 'Male' ? 'Male' : 'Female',
    channelId: cfg.channelId || '',
    maxAudioRetries: Math.max(0, Math.min(5, Number(cfg.maxAudioRetries ?? 2))),
    inputTimeoutMs: Math.max(1000, Math.min(30000, Number(cfg.inputTimeoutMs ?? 6000))),
    digitTimeoutMs: Math.max(1000, Math.min(10000, Number(cfg.digitTimeoutMs ?? 3000))),
    defaultScript: cfg.defaultScript || (cfg.scripts?.[0]?.key || ''),
    callHours: {
      start: Math.max(0, Math.min(23, Number(cfg.callHours?.start ?? 9))),
      end: Math.max(1, Math.min(24, Number(cfg.callHours?.end ?? 21))),
    },
    retry: {
      enabled: !!cfg.retry?.enabled,
      afterHours: Math.max(1, Math.min(72, Number(cfg.retry?.afterHours ?? 3))),
      maxAttempts: Math.max(1, Math.min(5, Number(cfg.retry?.maxAttempts ?? 2))),
      onResults: ['NoAnswer', 'Busy'],
    },
    scripts: (Array.isArray(cfg.scripts) ? cfg.scripts : []).map(s => ({
      key: s.key, label: s.label || s.key, ttsText: s.ttsText || '',
      audioUrl: s.audioUrl || '',                 // صوت مرفوع (WAV) — يُشغَّل بدل TTS إن وُجد
      successAudioUrl: s.successAudioUrl || '',    // رسالة ختام (WAV) — تُشغَّل بعد الضغط ثم يُقفل
      onAnswerTemplate: s.onAnswerTemplate || '',  // قالب واتساب يُرسَل تلقائياً إن رُدّ على المكالمة
      options: (Array.isArray(s.options) ? s.options : []).map(o => ({
        digit: String(o.digit), description: o.description || '', action: o.action || 'none',
        template: o.template || '',                // قالب واتساب يُرسَل عند ضغط هذا الرقم
      })),
    })),
  };
  const { error } = await supabase.from('app_settings').upsert({ key: 'ivr_config', value: JSON.stringify(clean) }, { onConflict: 'key' });
  if (error) throw error;
  return clean;
}

// رفع ملف صوتي (WAV) لسكربت — يُرجِع الرابط العام ليُشغّله Voxa. Voxa يقبل WAV فقط.
export async function uploadIvrAudio(file, scriptKey, kind = 'main') {
  if (!file) throw new Error('لا ملف');
  const name = String(file.name || '').toLowerCase();
  if (!name.endsWith('.wav')) throw new Error('Voxa يقبل WAV فقط — حوّل الملف إلى .wav');
  const path = `${scriptKey || 'script'}_${kind}_${Date.now()}.wav`;   // مفتاح ASCII آمن
  const { error } = await supabase.storage.from('ivr-audio').upload(path, file, { contentType: 'audio/wav', upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from('ivr-audio').getPublicUrl(path);
  return data?.publicUrl || '';
}

export async function verifyIvr() {
  const { data, error } = await supabase.functions.invoke(IVR_FN, { body: { action: 'verify' } });
  if (error) return { ok: false, error: error.message };
  return data;
}

// إطلاق حملة مكالمات — recipients: [{ phone, name, fields? }]
export async function launchIvrCampaign({ recipients, scriptKey, campaignName, ttsOverride = null }) {
  const { data, error } = await supabase.functions.invoke(IVR_FN, {
    body: { action: 'call', recipients, script_key: scriptKey, campaign_name: campaignName, tts_override: ttsOverride },
  });
  if (error) throw new Error(error.message || 'فشل إطلاق المكالمات');
  if (data && data.ok === false) throw new Error(data.error || 'فشل إطلاق المكالمات');
  return data;
}

// جدولة مكالمات — تُدرَج في الطابور ليعالجها ivr-runner في run_at (ضمن ساعات الاتصال)
export async function scheduleIvrQueue({ recipients, scriptKey, campaignName, runAt, userId = null }) {
  const rows = (recipients || []).filter(r => r && r.phone).map(r => ({
    phone: String(r.phone).replace(/\D/g, ''), name: r.name || null, fields: r.fields || null,
    script_key: scriptKey, campaign_name: campaignName || null, run_at: runAt,
    status: 'queued', attempts: 0, max_attempts: 1, created_by: userId,
  }));
  if (!rows.length) return { queued: 0 };
  // دفعات 500
  let queued = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from('ivr_queue').insert(rows.slice(i, i + 500));
    if (error) throw error;
    queued += Math.min(500, rows.length - i);
  }
  return { queued };
}

export async function loadIvrCalls({ campaign = null, phone = null, limit = 300 } = {}) {
  let q = supabase.from('ivr_calls').select('*').order('created_at', { ascending: false }).limit(limit);
  if (campaign) q = q.eq('campaign_name', campaign);
  if (phone) q = q.eq('phone', phone);
  const { data, error } = await q;
  if (error) return [];
  return data || [];
}

// ملخّص لكل حملة (عُدّت/رُدّ عليها/ضغطات)
// ملاحظة: Voxa يرسل status/result **أرقاماً** لا نصوصاً — فالإشارات الموثوقة =
// answered_at (رُدّ) + pressed_digit (تفاعل) + الحالة النهائية (اكتملت/فشلت).
export async function loadIvrCampaigns({ limit = 40 } = {}) {
  const { data } = await supabase.from('ivr_calls')
    .select('campaign_name, status, pressed_digit, answered_at, duration_seconds, created_at')
    .order('created_at', { ascending: false }).limit(4000);
  const rows = data || [];
  const byC = new Map();
  for (const r of rows) {
    const k = r.campaign_name || '—';
    if (!byC.has(k)) byC.set(k, { campaign: k, total: 0, answered: 0, pressed: 0, failed: 0, last: r.created_at });
    const c = byC.get(k);
    c.total++;
    const answered = !!r.answered_at || (Number(r.duration_seconds) > 0);
    const terminal = isTerminalStatus(r.status);
    if (answered) c.answered++;
    if (r.pressed_digit) c.pressed++;
    if (!answered && (terminal || String(r.status || '') === 'Failed')) c.failed++;
    if (r.created_at > c.last) c.last = r.created_at;
  }
  return Array.from(byC.values()).slice(0, limit);
}

// الحالة النهائية: Voxa يرسل 4 (اكتملت) رقماً؛ نقبل النصّي أيضاً احتياطاً.
function isTerminalStatus(s) {
  const v = String(s ?? '');
  return v === '4' || v === '3' || v === 'Completed' || v === 'Failed';
}

// شارة الحالة — بالإشارات الموثوقة لا بالأكواد الرقمية الغامضة.
export function ivrStatusBadge(row) {
  if (row.pressed_digit) return { t: `ضغط ${row.pressed_digit}`, c: '#16A34A' };
  const answered = !!row.answered_at || (Number(row.duration_seconds) > 0);
  if (answered) return { t: 'رُدّ — بلا ضغطة', c: '#3B82F6' };
  if (isTerminalStatus(row.status)) return { t: 'لم يُردّ', c: '#9CA3AF' };
  if (String(row.status || '') === 'pending') return { t: 'قيد الإطلاق', c: '#9CA3AF' };
  return { t: 'جارية', c: '#3B82F6' };
}

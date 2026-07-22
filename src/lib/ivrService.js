// ivrService — مكالمات آلية (Outbound IVR) عبر Voxa/Hatif.
// الإطلاق والحالة عبر edge function hatif-ivr؛ النتائج والضغطات في جدول ivr_calls
// (يحدّثها ivr-webhook). مصمَّم أساساً للوصول لمن لا يملك واتساب (§IVR).
import { supabase } from './supabase.js';

const IVR_FN = 'hatif-ivr';

export const IVR_ACTIONS = [
  { key: 'followup', label: 'متابعة مبيعات/تحصيل (مهمة للفريق)' },
  { key: 'callback', label: 'طلب معاودة اتصال' },
  { key: 'dnc',      label: 'إيقاف الاتصالات (لا تتصل به)' },
  { key: 'none',     label: 'بلا إجراء (تسجيل فقط)' },
];

const DEFAULT_CFG = {
  enabled: false, ttsVoice: 'Female', channelId: '',
  maxAudioRetries: 2, inputTimeoutMs: 6000, digitTimeoutMs: 3000,
  defaultScript: '', scripts: [],
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
    scripts: (Array.isArray(cfg.scripts) ? cfg.scripts : []).map(s => ({
      key: s.key, label: s.label || s.key, ttsText: s.ttsText || '',
      options: (Array.isArray(s.options) ? s.options : []).map(o => ({
        digit: String(o.digit), description: o.description || '', action: o.action || 'none',
      })),
    })),
  };
  const { error } = await supabase.from('app_settings').upsert({ key: 'ivr_config', value: JSON.stringify(clean) }, { onConflict: 'key' });
  if (error) throw error;
  return clean;
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

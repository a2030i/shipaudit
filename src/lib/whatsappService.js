// واتساب عبر Hatif/Voxa — يستدعي edge function hatif-send فقط (استُبدل Respondly).
// الأسرار (client_id/secret) لا تلمس المتصفح إطلاقاً؛ تبقى في الدالة.
// الإعدادات (channel/template) في app_settings (key/value).

import { supabase } from './supabase.js';

const CFG_KEY = 'whatsapp_config';

export const DEFAULT_WA_CONFIG = {
  templates:        [],    // قائمة القوالب المعتمدة — يُختار أحدها عند إطلاق الحملة
  templateName:     '',    // آخر قالب مستخدَم (افتراضي في المُنتقي)
  templateLanguage: 'ar',  // ثابتة
  channelId:        '',    // اختياري — يُجلَب آلياً من Hatif (get-channels) إن فُرِّغ
};

// كل إرسال واتساب عبر Hatif/Voxa (استُبدل Respondly كلياً).
const WA_FN = 'hatif-send';

export async function loadWhatsAppConfig() {
  const { data } = await supabase.from('app_settings').select('value').eq('key', CFG_KEY).maybeSingle();
  let cfg = { ...DEFAULT_WA_CONFIG };
  if (data?.value) { try { cfg = { ...DEFAULT_WA_CONFIG, ...JSON.parse(data.value) }; } catch { /* */ } }
  if (!Array.isArray(cfg.templates)) cfg.templates = [];
  if (!cfg.templates.length && cfg.templateName) cfg.templates = [cfg.templateName];  // ترحيل القالب المفرد القديم
  return cfg;
}

export async function saveWhatsAppConfig(cfg) {
  const templates = Array.isArray(cfg.templates) ? [...new Set(cfg.templates.map(t => String(t).trim()).filter(Boolean))] : [];
  const value = JSON.stringify({
    templates,
    templateName:     cfg.templateName?.trim() || templates[0] || '',
    templateLanguage: 'ar',
    channelId:        cfg.channelId?.trim() || '',
  });
  const { error } = await supabase.from('app_settings')
    .upsert({ key: CFG_KEY, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
}

// Saudi phone normalization → international digits, no '+'.
//   05XXXXXXXX (10) → 9665XXXXXXXX · 5XXXXXXXX (9) → 9665XXXXXXXX
//   already 9665… → as-is · anything else → digits as-is (best effort)
export function normalizeSaudiPhone(raw) {
  let d = String(raw || '').replace(/[^\d]/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('966')) return d;
  if (d.length === 10 && d.startsWith('05')) return '966' + d.slice(1);
  if (d.length === 9  && d.startsWith('5'))  return '966' + d;
  return d;
}

// Verify the stored key works (and the plan allows API). Returns
// { ok, org } | { ok:false, error }.
export async function verifyWhatsAppKey() {
  const { data, error } = await supabase.functions.invoke(WA_FN, { body: { action: 'verify' } });
  if (error) return { ok: false, error: error.message };
  return data;
}

// Send a template campaign. items: [{ to, vars:[], name, amount }].
// Returns { ok, total, sent, failed, results, campaignId } | { ok:false, error }.
export async function sendWhatsAppCampaign({ templateName, templateLanguage = 'ar', channelId, items, campaign = {} }) {
  const { data, error } = await supabase.functions.invoke(WA_FN, {
    body: {
      action: 'send',
      template_name: templateName,
      template_language: templateLanguage,
      channel_id: channelId || null,
      items,
      campaign,
    },
  });
  if (error) return { ok: false, error: error.message };
  return data;
}

// حالة آخر حملة لكل عميل (بالهاتف): آخر إرسال + التسليم/القراءة + هل ردّ + هل سدّد بعدها.
// يُرجِع Map مفتاحها الهاتف المطبَّع (9665…) لعرضها على بطاقات العملاء.
export async function loadWhatsAppCampaignStatus() {
  const { data, error } = await supabase.rpc('whatsapp_campaign_status');
  const map = new Map();
  if (error || !Array.isArray(data)) return map;
  for (const r of data) {
    if (!r.phone) continue;
    map.set(r.phone, {
      lastTemplate: r.last_template, lastCampaign: r.last_campaign,
      lastSentAt: r.last_sent_at, status: r.last_status,
      delivered: !!r.delivered, read: !!r.read_flag,
      replied: !!r.replied, replyAt: r.reply_at,
      sends: r.sends_count || 1,
      paidAfter: !!r.paid_after, paidAt: r.paid_at,
    });
  }
  return map;
}

// ── تنبيه زاتكا المسائي — إعداد + معاينة + إرسال تجريبي ──────────────
// app_settings['zatca_alert'] تقرؤه edge function zatca-alert (cron 21:00 KSA).
const ZATCA_ALERT_KEY = 'zatca_alert';
export async function loadZatcaAlertConfig() {
  const def = { enabled: false, phone: '', templateName: '' };
  const { data } = await supabase.from('app_settings').select('value').eq('key', ZATCA_ALERT_KEY).maybeSingle();
  if (!data?.value) return def;
  try { const v = JSON.parse(data.value); return { enabled: !!v.enabled, phone: v.phone || '', templateName: v.template_name || '' }; }
  catch { return def; }
}
export async function saveZatcaAlertConfig(cfg) {
  const value = JSON.stringify({
    enabled: !!cfg.enabled, phone: normalizeSaudiPhone(cfg.phone), template_name: cfg.templateName?.trim() || '',
  });
  const { error } = await supabase.from('app_settings')
    .upsert({ key: ZATCA_ALERT_KEY, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
}
export async function previewZatcaAlert() {
  const { data, error } = await supabase.functions.invoke('zatca-alert', { body: { action: 'preview' } });
  if (error) return { ok: false, error: error.message };
  return data;
}
export async function sendZatcaAlertNow() {
  const { data, error } = await supabase.functions.invoke('zatca-alert', { body: {} });
  if (error) return { ok: false, error: error.message };
  return data;
}

// ── ملخّص الصباح — إعداد + معاينة + إرسال فوري ──────────────────────
// الإعداد في app_settings key='morning_brief' (تقرؤه edge function
// morning-brief التي يستدعيها pg_cron يومياً 7:15 صباحاً KSA).
const BRIEF_KEY = 'morning_brief';
export const DEFAULT_BRIEF_CONFIG = {
  enabled: false, phone: '', templateName: '', templateLanguage: 'ar', channelId: '',
};

export async function loadMorningBriefConfig() {
  const { data } = await supabase.from('app_settings').select('value').eq('key', BRIEF_KEY).maybeSingle();
  if (!data?.value) return { ...DEFAULT_BRIEF_CONFIG };
  try {
    const v = JSON.parse(data.value);
    return {
      enabled: !!v.enabled, phone: v.phone || '',
      templateName: v.template_name || '', templateLanguage: v.template_language || 'ar',
      channelId: v.channel_id || '',
    };
  } catch { return { ...DEFAULT_BRIEF_CONFIG }; }
}

export async function saveMorningBriefConfig(cfg) {
  const value = JSON.stringify({
    enabled: !!cfg.enabled,
    phone: normalizeSaudiPhone(cfg.phone),
    template_name: cfg.templateName?.trim() || '',
    template_language: cfg.templateLanguage?.trim() || 'ar',
    channel_id: cfg.channelId?.trim() || '',
  });
  const { error } = await supabase.from('app_settings')
    .upsert({ key: BRIEF_KEY, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
}

// معاينة نص الرسالة (بلا إرسال) / إرسال الآن يدوياً
export async function previewMorningBrief() {
  const { data, error } = await supabase.functions.invoke('morning-brief', { body: { action: 'preview' } });
  if (error) return { ok: false, error: error.message };
  return data;
}
export async function sendMorningBriefNow() {
  const { data, error } = await supabase.functions.invoke('morning-brief', { body: {} });
  if (error) return { ok: false, error: error.message };
  return data;
}

export async function loadWhatsAppCampaigns({ limit = 50 } = {}) {
  const { data, error } = await supabase
    .from('whatsapp_campaigns').select('*')
    .order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

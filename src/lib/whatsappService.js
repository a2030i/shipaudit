// واتساب عبر Respondly — يستدعي edge function whatsapp-send فقط.
// المفتاح (x-api-key) لا يلمس المتصفح إطلاقاً؛ يبقى سرّاً في الدالة.
// الإعدادات (channel/template) في app_settings (key/value).

import { supabase } from './supabase.js';

const CFG_KEY = 'whatsapp_config';

export const DEFAULT_WA_CONFIG = {
  channelId:        '',
  templateName:     '',
  templateLanguage: 'ar',
};

export async function loadWhatsAppConfig() {
  const { data } = await supabase.from('app_settings').select('value').eq('key', CFG_KEY).maybeSingle();
  if (!data?.value) return { ...DEFAULT_WA_CONFIG };
  try { return { ...DEFAULT_WA_CONFIG, ...JSON.parse(data.value) }; }
  catch { return { ...DEFAULT_WA_CONFIG }; }
}

export async function saveWhatsAppConfig(cfg) {
  const value = JSON.stringify({
    channelId:        cfg.channelId?.trim() || '',
    templateName:     cfg.templateName?.trim() || '',
    templateLanguage: cfg.templateLanguage?.trim() || 'ar',
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
  const { data, error } = await supabase.functions.invoke('whatsapp-send', { body: { action: 'verify' } });
  if (error) return { ok: false, error: error.message };
  return data;
}

// Send a template campaign. items: [{ to, vars:[], name, amount }].
// Returns { ok, total, sent, failed, results, campaignId } | { ok:false, error }.
export async function sendWhatsAppCampaign({ templateName, templateLanguage = 'ar', channelId, items, campaign = {} }) {
  const { data, error } = await supabase.functions.invoke('whatsapp-send', {
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

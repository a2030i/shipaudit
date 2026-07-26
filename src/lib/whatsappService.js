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
    // فخّ: السيريالايزر كان يُسقط المفاتيح غير المعروفة — drip كان يضيع مع كل حفظ
    drip:             cfg.drip || null,
    // ربط متغيرات القوالب (2026-07-21): { [templateName]: [{src, text?}, ...] }
    templateVars:     cfg.templateVars || {},
    // ربط القالب بموظف مسؤول (2026-07-22): { [templateName]: <supabase user id> } —
    // ردّ العميل على هذا القالب يُسند لهذا الموظف (مهمة + محادثة هاتف).
    templateAgents:   cfg.templateAgents || {},
  });
  const { error } = await supabase.from('app_settings')
    .upsert({ key: CFG_KEY, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
}

// حفظ ربط متغيرات قالب واحد (يُستدعى من مودال الإرسال بعد التخصيص) —
// قراءة-دمج-كتابة حتى لا تُمسّ بقية الإعدادات.
export async function saveTemplateVarMap(templateName, map) {
  const cfg = await loadWhatsAppConfig();
  const templateVars = { ...(cfg.templateVars || {}), [templateName]: map };
  await saveWhatsAppConfig({ ...cfg, templateVars });
}

// ── نظام الحملات الاحترافي (2026-07-21) ─────────────────────────────
// أسماء الحملات السابقة (للاستثناء عند إطلاق حملة جديدة) — تجميع محلي
// (لا group-by في PostgREST والجدول صغير). قاعدة §6: order('id') لكل range.
export async function loadCampaignNames() {
  const out = new Map();
  for (let from = 0; from < 50000; from += 1000) {
    const { data, error } = await supabase.from('whatsapp_campaign_sends')
      .select('campaign_name, sent_at')
      .order('id', { ascending: true }).range(from, from + 999);
    if (error) throw error;
    for (const r of data || []) {
      const k = (r.campaign_name || '').trim() || '(بلا اسم)';
      const cur = out.get(k) || { name: k, sends: 0, lastAt: null };
      cur.sends++;
      if (!cur.lastAt || (r.sent_at && r.sent_at > cur.lastAt)) cur.lastAt = r.sent_at;
      out.set(k, cur);
    }
    if (!data || data.length < 1000) break;
  }
  return [...out.values()].sort((a, b) => String(b.lastAt || '').localeCompare(String(a.lastAt || '')));
}

// أرقام بلا واتساب (فشل «الرقم غير موجود») — تُستثنى آلياً من كل حملة قادمة.
export async function loadNoWhatsappSet() {
  const set = new Set();
  const { data } = await supabase.rpc('no_whatsapp_phones');
  for (const r of data || []) if (r.phone) set.add(r.phone);
  return set;
}
// أرقام يتواصل معهم الفريق مباشرة في هاتف الآن (محادثتهم مُسنَدة لموظف بشري خلال
// آخر p_days يوماً) — تُستبعَد آلياً من حملات القوالب حتى لا نقاطع تواصل الموظف
// (خوف المستخدم 2026-07-26). يرجع Map(هاتف → آخر إسناد) لعرض السبب في المودال.
export async function loadHatifTouchedPhones(days = 30) {
  const map = new Map();
  const { data, error } = await supabase.rpc('hatif_touched_phones', { p_days: days });
  if (error || !Array.isArray(data)) return map;
  for (const r of data) if (r.phone) map.set(r.phone, r.last_touch || null);
  return map;
}
// تقرير كامل (للاتصال بهم / التصدير) — رقم/اسم/آخر محاولة/الحملات.
export async function loadNoWhatsappList() {
  const { data, error } = await supabase.rpc('no_whatsapp_report');
  if (error || !Array.isArray(data)) return [];
  return data.map(r => ({ phone: r.phone, name: r.name, lastAttempt: r.last_attempt, attempts: Number(r.attempts) || 1, campaigns: r.campaigns }));
}

// صحة التسليم عبر كل الحملات (إجماليات + أسباب الرفض) — لبطاقة «سجل الحملات».
export async function loadWhatsAppDeliveryHealth() {
  const { data, error } = await supabase.rpc('whatsapp_delivery_health');
  if (error || !data) return null;
  return {
    total: Number(data.total) || 0, delivered: Number(data.delivered) || 0,
    read: Number(data.read) || 0, replied: Number(data.replied) || 0,
    auto: Number(data.auto) || 0, failed: Number(data.failed) || 0, pending: Number(data.pending) || 0,
    reasons: Array.isArray(data.reasons) ? data.reasons.map(r => ({ reason: r.reason, n: Number(r.n) || 0 })) : [],
  };
}

// قائمة الحظر الدائمة (رقم شخصي/منصّة/رقم خاطئ لمتجر لا يمكن حذفه) — تُستبعَد
// من كل حملة تلقائياً (مدموجة في no_whatsapp_phones). إدارة يدوية.
export async function loadBlocklist() {
  const { data, error } = await supabase.rpc('campaign_blocklist_report');
  if (error || !Array.isArray(data)) return [];
  return data.map(r => ({ phone: r.phone, name: r.name, reason: r.reason, addedAt: r.added_at }));
}
function normSaPhoneJs(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('966')) return d;
  if (d.length === 10 && d.startsWith('05')) return '966' + d.slice(1);
  if (d.length === 9 && d.startsWith('5')) return '966' + d;
  return d;
}
export async function addToBlocklist({ phone, name, reason, userId }) {
  const p = normSaPhoneJs(phone);
  if (!p || p.length < 11) throw new Error('رقم غير صالح');
  const { error } = await supabase.from('campaign_phone_blocklist')
    .upsert({ phone: p, name: name || null, reason: reason || null, added_by: userId || null }, { onConflict: 'phone' });
  if (error) throw error;
  return p;
}
export async function removeFromBlocklist(phone) {
  const p = normSaPhoneJs(phone);
  const { data, error } = await supabase.from('campaign_phone_blocklist').delete().eq('phone', p).select('phone');
  if (error) throw error;
  return (data || []).length;
}

// أرقام مستلمي حملات بعينها — لاستثنائهم من الحملة الجديدة
export async function loadCampaignPhones(names) {
  const phones = new Set();
  if (!names?.length) return phones;
  for (let from = 0; from < 100000; from += 1000) {
    // الفاشلون لا يُعدّون «تم التواصل» فلا يُستثنَون (يمكن إعادة استهدافهم)
    const { data, error } = await supabase.from('whatsapp_campaign_sends')
      .select('phone').in('campaign_name', names).neq('status', 'Failed')
      .order('id', { ascending: true }).range(from, from + 999);
    if (error) throw error;
    for (const r of data || []) if (r.phone) phones.add(r.phone);
    if (!data || data.length < 1000) break;
  }
  return phones;
}

// سياق المستلمين لمتغيرات القالب (2026-07-21): RPC campaign_recipient_context v2 —
// **صف لكل متجر على الرقم** (لا الأعلى شحناً فقط — حادثة TREVU/farnearapp:
// رقم واحد بمتجرين أعطى تاريخ متجر آخر). يُرجِع Map(phone → [مصفوفة متاجر])
// وكل عنصر يحمل `_store`/`_storeCount` للمطابقة بالاسم في المودال.
// الفشل صامت (المودال يشتغل بحقول الصفحة وحدها). دفعات 400 (سقف 1000 صف §1.34).
export async function loadCampaignRecipientContext(phones) {
  const map = new Map();
  const uniq = [...new Set((phones || []).filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 400) {
    try {
      const { data, error } = await supabase.rpc('campaign_recipient_context', { p_phones: uniq.slice(i, i + 400) });
      if (error || !Array.isArray(data)) continue;
      for (const r of data) {
        const f = { _store: r.store_name || '', _storeCount: Number(r.store_count || 1) };
        if (r.shipments != null) f.shipments = r.shipments;
        if (r.last_shipment) {
          f.last_shipment = r.last_shipment;
          f.days_since = Math.floor((Date.now() - new Date(r.last_shipment).getTime()) / 86_400_000);
        }
        if (r.wallet != null) f.wallet = Number(r.wallet);
        if (r.billing_type) f.billing_type = r.billing_type;
        if (r.store_status) f.store_status = r.store_status;
        if (r.zoho_due != null) f.zoho_due = Number(r.zoho_due);
        if (r.zoho_open_count != null) f.zoho_open_count = Number(r.zoho_open_count);
        if (r.zoho_last_invoice) f.zoho_last_invoice = r.zoho_last_invoice;
        if (r.zoho_last_payment) f.zoho_last_payment = r.zoho_last_payment;
        const arr = map.get(r.phone) || [];
        arr.push(f);
        map.set(r.phone, arr);
      }
    } catch { /* اختياري — لا يُفشل المودال */ }
  }
  return map;
}

// تطبيع الهاتف السعودي — موحّد مع norm_sa_phone (SQL) وnormalizeSaudiPhone
// (crmLeadsService) وnorm (hatif-send) — §1.31 ينص على تطابقها. كان هذا الأبسط
// يُبقي '9660…' مشوّهاً ويحذف الأرقام العربية. الآن: أرقام عربية/فارسية + قصّ
// 9660 و00 والصفر البادئ. يُرجِع '' للمشوَّه (توافق الـcallers القديمة).
export function normalizeSaudiPhone(raw) {
  let s = String(raw ?? '')
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/\D/g, '');
  if (!s) return '';
  if (s.startsWith('00')) s = s.slice(2);
  if (s.startsWith('9660')) s = '966' + s.slice(4);
  else if (s.startsWith('0')) s = '966' + s.slice(1);
  else if (!s.startsWith('966')) s = '966' + s;
  return /^966\d{8,10}$/.test(s) ? s : '';
}

// Verify the stored key works (and the plan allows API). Returns
// { ok, org } | { ok:false, error }.
export async function verifyWhatsAppKey() {
  const { data, error } = await supabase.functions.invoke(WA_FN, { body: { action: 'verify' } });
  if (error) return { ok: false, error: error.message };
  return data;
}

// موظفو هاتف (Workspace) — لربط القالب بمسؤوله مباشرة (الفريق في هاتف لا عندنا).
export async function loadHatifUsers() {
  const { data, error } = await supabase.functions.invoke(WA_FN, { body: { action: 'hatif_users' } });
  if (error || !data?.ok) return [];
  return (data.users || []).map(u => ({ userId: u.userId, name: u.name, email: u.email || null }));
}

// نشاط وإسناد الموظفين من hatif_events (أحداث webhook مساحة العمل) — أساس أداء الفريق.
export async function loadHatifAgentActivity(days = 30) {
  const { data, error } = await supabase.rpc('hatif_agent_activity', { p_days: days });
  if (error) return [];
  return data || [];
}

// تاقات هاتف — سرد المتاح + تطبيق يدوي على محادثة العميل (بالهاتف)
export async function loadHatifTags() {
  const { data, error } = await supabase.functions.invoke('hatif-tags', { body: { action: 'list' } });
  if (error || !data?.ok) return [];
  return (data.tags || []).filter(t => t.id);
}
export async function applyConversationTags(phone, tagIds) {
  const { data, error } = await supabase.functions.invoke('hatif-tags', { body: { action: 'apply', phone, tagIds } });
  if (error) throw new Error(error.message || 'فشل الوسم');
  if (data && data.ok === false) throw new Error(data.error || 'فشل الوسم');
  return data;
}
// نظام التاقات المؤتمت — تشغيل دفعة مزامنة يدوياً (المدير) + حالة ما طُبِّق
export async function runHatifTagSync(limit = 120) {
  const { data, error } = await supabase.functions.invoke('hatif-tag-sync', { body: { limit } });
  if (error) throw new Error(error.message || 'فشل المزامنة');
  if (data && data.ok === false) throw new Error(data.error || 'فشل المزامنة');
  return data;
}
export async function loadTagSyncStatus() {
  const { count: applied } = await supabase.from('hatif_conversation_tags').select('phone', { count: 'exact', head: true });
  let desired = 0, tagged = 0;
  try {
    // تصفّح كامل — RPC يقفه PostgREST عند 1000 صف (§1.34)
    for (let off = 0; off < 20000; off += 1000) {
      const { data } = await supabase.rpc('hatif_phone_tags').range(off, off + 999);
      const rows = data || [];
      desired += rows.length;
      tagged += rows.filter(r => (r.tags || []).length > 0).length;
      if (rows.length < 1000) break;
    }
  } catch { desired = null; tagged = null; }
  return { applied: applied || 0, desired, tagged };
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
  const map = new Map();
  // ترقيم صفحات (فخّ سقف PostgREST 1000): الدالة set-returning صفّ لكل هاتف —
  // حملة إعادة استهداف كاملة تتجاوز 1000 هاتف مميّز فتُبتَر صامتاً وتُعطَّل حماية
  // الإرسال المزدوج. نصفّح بـorder('phone')+range حتى النفاد.
  const rows = [];
  for (let from = 0; from < 100000; from += 1000) {
    const { data, error } = await supabase.rpc('whatsapp_campaign_status')
      .order('phone', { ascending: true }).range(from, from + 999);
    if (error || !Array.isArray(data)) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  for (const r of rows) {
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

// شارة حالة آخر رسالة حملة على بطاقة العميل — لون مميّز واضح لكل حالة (نقطة الحقيقة
// الوحيدة، تُستعمَل في كل الصفحات بدل ألوان مضمّنة متفرّقة). الترتيب: سدّد > ردّ > فشل
// > قُرئت > وصلت > أُرسلت.
export function waStatusBadge(w) {
  if (!w) return null;
  if (w.paidAfter) return { t: '✅ سدّد', c: '#16A34A' };            // أخضر قوي
  if (w.replied) return { t: '💬 ردّ', c: '#2563EB' };              // أزرق
  if (/fail|undeliver/i.test(String(w.status || ''))) return { t: '⚠️ فشل', c: '#DC2626' };  // أحمر
  if (w.read) return { t: '👁 قُرئت', c: '#7C3AED' };               // بنفسجي
  if (w.delivered) return { t: '✓ وصلت', c: '#0891B2' };            // سماوي
  return { t: '➤ أُرسلت', c: '#6B7280' };                           // رمادي
}

// تقرير الحملات المجمَّع (2026-07-21): صف لكل حملة — مستهدفون/وصلت/قُرئت/ردود/فشل.
// الحالات يغذّيها hatif-webhook — بلا ضبطه في هاتف تبقى «أُرسلت» فقط.
export async function loadWhatsAppCampaignReport() {
  const { data, error } = await supabase.rpc('whatsapp_campaign_report');
  if (error || !Array.isArray(data)) return [];
  return data.map(r => ({
    name: r.campaign_name, template: r.template_name,
    firstSent: r.first_sent, lastSent: r.last_sent,
    targets: Number(r.targets || 0), delivered: Number(r.delivered || 0),
    read: Number(r.read_count || 0), replied: Number(r.replied || 0), failed: Number(r.failed || 0),
  }));
}

// أرقام حملة فشلت (لإعادة استهدافهم) — الفاشلون مسجَّلون بحالة Failed + سبب.
// دفعات 1000 (سقف PostgREST). يُرجِع [{to, name, reason}] بلا تكرار بالهاتف.
export async function loadCampaignFailures(campaignName) {
  const map = new Map();
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await supabase.from('whatsapp_campaign_sends')
      .select('phone, name, error_reason, status')
      .eq('campaign_name', campaignName)
      .or('status.eq.Failed,error_reason.not.is.null')
      .order('id', { ascending: true }).range(from, from + 999);
    if (error || !Array.isArray(data)) break;
    for (const r of data) if (r.phone && !map.has(r.phone)) map.set(r.phone, { to: r.phone, name: r.name || r.phone, vars: [r.name || ''], reason: r.error_reason || 'فشل' });
    if (data.length < 1000) break;
  }
  return [...map.values()];
}

// سجل الحملات المرجعي — كل رسالة مع اسم المُرسِل والحالة. phone لتاريخ عميل واحد،
// campaign لتفاصيل حملة بعينها (حالة كل رقم).
export async function loadWhatsAppLog({ phone = null, limit = 300, campaign = null } = {}) {
  const { data, error } = await supabase.rpc('whatsapp_campaign_log', { p_phone: phone, p_limit: limit, p_campaign: campaign });
  if (error || !Array.isArray(data)) return [];
  return data.map(r => ({
    id: r.id, phone: r.phone, name: r.name, template: r.template_name,
    campaign: r.campaign_name, bucket: r.campaign_bucket, amount: r.amount,
    status: r.status, sentAt: r.sent_at, sentBy: r.sent_by_name,
    deliveredAt: r.delivered_at, readAt: r.read_at, repliedAt: r.replied_at,
    replyBody: r.reply_body, error: r.error_reason,
  }));
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

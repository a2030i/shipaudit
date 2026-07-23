// campaign-runner v5 (محرك المبيعات §1.37 + نظام الحملات §1.29) — كرون كل 15 دقيقة:
//  v5 (2026-07-23، خطة هاتف البند 4): تحصين ضد الفشل الصامت — تسجيل كل فشل إرسال
//  بـstatus='failed'+error_reason، جلب قائمة الحظر (فشلها يوقف الإرسال fail-safe)
//  وتخطّي المحظور، وإدراج السجل بإعادة محاولة (لا ابتلاع صامت).
//  v4 (2026-07-21): استرداد الطابور العالق ('sending' +10د → pending) +
//  drip بالعميل لا بالصف (استبعاد من ردّ + إزالة تكرار الهاتف + تعليم كل صفوفه).
// campaign-runner v3 — كرون كل 15 دقيقة:
//  (١) يرسل الحملات المجدولة المستحقة من campaign_queue — v2: يعالج **عدة صفوف**
//      ضمن ميزانية وقت (من مهلة 150ث) لأن الجدولة الكبيرة تُقسَّم صفوف 100 مستلم.
//      اسم الحملة في السجل = bucket_label (اسم الحملة الذي كتبه المستخدم) لا «مجدولة».
//      v3: تسجيل فوري رسالة-برسالة + تقدير واقعي 1.1ث/رسالة (نفس إصلاح hatif-send v11).
//  (٢) متابعة غير المتجاوبين (drip): إن فُعّلت في إعدادات واتساب — من لم يرد
//      خلال N يوم يُرسَل له قالب المتابعة مرة واحدة (followed_up يمنع التكرار).
// الحماية: X-Cron-Key ضد zoho_auth.cron_key (نمط morning-brief). verify_jwt=false.
// الإرسال مرآة منطق hatif-send (نفس sendTemplate + التسجيل في whatsapp_campaign_sends).
import { createClient } from 'npm:@supabase/supabase-js@2';

const svc = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const env = (...names: string[]) => { for (const n of names) { const v = Deno.env.get(n); if (v && v.trim()) return v.trim(); } return ''; };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const TOKEN_URL = 'https://api.voxa.sa/connect/token';
const SEND_URL  = 'https://api.voxa.sa/v1/whatsapp/service-account/sendTemplate';
const CHANNELS_URL = 'https://api.voxa.sa/v1/channels/service-account';

let tokenCache: { token: string; exp: number } | null = null;
async function accessToken() {
  if (tokenCache && tokenCache.exp > Date.now()) return tokenCache.token;
  const id = env('client_id', 'HATIF_CLIENT_ID'), secret = env('secret', 'HATIF_CLIENT_SECRET');
  if (!id || !secret) throw new Error('أسرار Hatif غير مضبوطة');
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret, scope: 'VoxaAPI' }) });
  const j = await r.json();
  if (!j.access_token) throw new Error('token failed');
  tokenCache = { token: j.access_token, exp: Date.now() + ((Number(j.expires_in) || 3600) * 1000) - 60000 };
  return tokenCache.token;
}
async function getChannelId(token: string) {
  const fixed = env('hatif_channel_id', 'HATIF_CHANNEL_ID');
  if (fixed) return fixed;
  const r = await fetch(CHANNELS_URL, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json().catch(() => ({}));
  return (Array.isArray(j.items) ? j.items : [])[0]?.id || '';
}
function norm(raw: unknown) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('966')) return d;
  if (d.length === 10 && d.startsWith('05')) return '966' + d.slice(1);
  if (d.length === 9 && d.startsWith('5')) return '966' + d;
  return d;
}
async function sendTemplate(token: string, o: { channelId: string; templateName: string; to: string; vars: unknown[] }) {
  const payload = {
    ChannelId: o.channelId, TemplateName: o.templateName, Language: 'ar', ToNumber: o.to,
    Parameters: (o.vars && o.vars.length)
      ? [{ Type: 'Body', Values: o.vars.map(v => ({ Type: 'text', Text: String(v ?? '') })) }]
      : [],
  };
  const r = await fetch(SEND_URL, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const j = await r.json().catch(() => ({}));
  const ok = r.ok && (j.status === 'accepted' || !!j.contactId || !!j.conversationEventId);
  return { ok, id: j.conversationEventId || j.contactId || null, contactId: j.contactId || null, conversationId: j.conversationId || null,
           status: j.status || null, error: ok ? null : (j.message || j.title || `http ${r.status}`) };
}
// قائمة الحظر كاملة (مصفّحة — تجاوز سقف 1000). فشل الجلب يوقف الإرسال (fail-safe).
async function loadBlocklist(db: ReturnType<typeof svc>): Promise<Set<string>> {
  const set = new Set<string>();
  for (let off = 0; off < 100000; off += 1000) {
    const { data, error } = await db.from('campaign_phone_blocklist').select('phone').range(off, off + 999);
    if (error) throw error;
    for (const r of (data || [])) if (r.phone) set.add(String(r.phone));
    if (!data || data.length < 1000) break;
  }
  return set;
}
// إدراج سجل الإرسال مع إعادة محاولة واحدة — لا نبتلع الفشل صامتاً (فقدان السجل = خطر
// ازدواج إرسال عند الاستئناف، وفقدان تتبّع الفشل).
async function logSend(db: ReturnType<typeof svc>, r: Record<string, unknown>) {
  for (let i = 0; i < 2; i++) {
    const { error } = await db.from('whatsapp_campaign_sends').insert(r);
    if (!error) return true;
    if (i === 0) await sleep(400);
    else console.error('campaign-runner log insert failed:', error.message, r.phone);
  }
  return false;
}

Deno.serve(async (req) => {
  const started = Date.now();
  // مهلة الدالة 150ث — لا نلتقط دفعة إلا إذا كان وقتها المقدَّر يسع قبل 130ث.
  // القياس الفعلي ≈ 1.1ث/رسالة (sleep 300 + استدعاء Voxa ~500-700ms + التسجيل الفوري)
  // — تقدير 800ms السابق كان متفائلاً وكاد يُدخل دفعة تُقتل منتصفها.
  const HARD_MS = 130_000;
  const estJobMs = (n: number) => n * 1_100 + 5_000;
  const db = svc();
  const cronKey = req.headers.get('X-Cron-Key') || req.headers.get('x-cron-key') || '';
  const { data: za } = await db.from('zoho_auth').select('cron_key').eq('id', 1).maybeSingle();
  if (!za?.cron_key || cronKey !== za.cron_key) return new Response('forbidden', { status: 403 });

  const out: Record<string, unknown> = { jobs: 0, queue_sent: 0, queue_failed: 0, drip_sent: 0 };

  // استرداد الطابور العالق: صف 'sending' أقدم من 10 دقائق = قُتلت الدالة منتصفه
  // (crash/deploy/504) — يُعاد لـpending. المُرسَل لهم فعلاً موجودون في
  // whatsapp_campaign_sends فيُستبعدون عند إعادة الإرسال (نمط «استثناء حملات سابقة»).
  try {
    const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
    const { data: stuck } = await db.from('campaign_queue')
      .update({ status: 'pending' }).eq('status', 'sending').lt('processed_at', cutoff).select('id');
    if (stuck?.length) out.recovered = stuck.length;
  } catch { /* غير قاتل */ }

  // قائمة الحظر مرة واحدة — فشل جلبها = لا نرسل هذه التشغيلة (كي لا نراسل محظوراً).
  let blockSet = new Set<string>(); let canSend = true;
  try { blockSet = await loadBlocklist(db); }
  catch (e) { out.blocklist_error = String((e as Error).message || e); canSend = false; }

  let token = '', channelId = '';
  const ensureHatif = async () => {
    if (!token) token = await accessToken();
    if (!channelId) channelId = await getChannelId(token);
    if (!channelId) throw new Error('لا قناة Hatif');
  };

  // ── (١) الحملات المجدولة: صفوف طابور متتالية ضمن ميزانية الوقت ──
  // الجدولة تكتب صفوف 150 مستلم (§1.29) — كل صف ≈ 55ث إرسالاً، فنمرّر ما يسعه الوقت.
  if (canSend) try {
    while (true) {
      const { data: due } = await db.from('campaign_queue')
        .select('*').eq('status', 'pending').lte('scheduled_at', new Date().toISOString())
        .order('scheduled_at').order('id').limit(1);
      const job = due?.[0];
      if (!job) break;
      const jobLen = Array.isArray(job.recipients) ? job.recipients.length : 0;
      if (Date.now() - started + estJobMs(jobLen) > HARD_MS) { out.deferred = true; break; }
      // احجز الصف فوراً + ختم processed_at كعلامة «بدأ الآن» (يُدهَس عند الاكتمال)
      // — استرداد الطابور العالق يعتمد عليها (صف 'sending' قديم = قُتلت الدالة).
      const { data: claimed } = await db.from('campaign_queue')
        .update({ status: 'sending', processed_at: new Date().toISOString() })
        .eq('id', job.id).eq('status', 'pending').select('id');
      if (!claimed?.length) continue;
      (out.jobs as number)++;
      await ensureHatif();
      const recipients: any[] = Array.isArray(job.recipients) ? job.recipients : [];
      let sent = 0, failed = 0, skipped = 0;
      const campaignName = (job.bucket_label || '').trim() || 'مجدولة';
      for (const it of recipients.slice(0, 200)) {
        const to = norm(it.to);
        if (!to || to.length < 11) { failed++; continue; }
        if (blockSet.has(to)) { skipped++; continue; }   // محظور — لا نراسله
        const base: Record<string, unknown> = { phone: to, name: it.name || null, template_name: job.template_name,
          channel_id: channelId, campaign_name: campaignName, campaign_bucket: job.bucket_label || null,
          amount: it.amount ?? null, sent_at: new Date().toISOString(), sent_by: job.created_by || 'scheduler' };
        try {
          const res = await sendTemplate(token, { channelId, templateName: job.template_name, to, vars: it.vars || [] });
          if (res.ok) {
            sent++;
            // تسجيل فوري (نفس إصلاح hatif-send v11) — الانقطاع لا يضيع السجل
            await logSend(db, { ...base, contact_id: res.contactId, conversation_id: res.conversationId, message_id: res.id, status: res.status || 'accepted' });
          } else {
            // البند 4: نسجّل الفشل بسببه — كان يُبتلع فلا يظهر في «فشل الحملات»
            failed++;
            await logSend(db, { ...base, status: 'failed', error_reason: String(res.error || 'send failed').slice(0, 300) });
          }
        } catch (e) {
          failed++;
          await logSend(db, { ...base, status: 'failed', error_reason: String((e as Error).message || e).slice(0, 300) });
        }
        await sleep(300);   // مع الإرسال والتسجيل ≈ ثانية/رسالة — تحت حصة Voxa
      }
      await db.from('campaign_queue').update({
        status: failed && !sent ? 'failed' : 'sent',
        result: { sent, failed, skipped }, processed_at: new Date().toISOString(),
      }).eq('id', job.id);
      (out.queue_sent as number) += sent; (out.queue_failed as number) += failed;
      out.queue_skipped = (Number(out.queue_skipped) || 0) + skipped;
    }
  } catch (e) { out.queue_error = String((e as Error).message || e); }

  // ── (٢) متابعة غير المتجاوبين (drip) — إن مُفعّلة في whatsapp_config.drip ──
  if (canSend) try {
    if (Date.now() - started < HARD_MS - 25_000) {   // الـdrip ≈ 25ث لثلاثين رسالة
      const { data: cfgRow } = await db.from('app_settings').select('value').eq('key', 'whatsapp_config').maybeSingle();
      const drip = (cfgRow?.value as Record<string, any>)?.drip || {};
      if (drip.enabled && drip.template && Number(drip.afterDays) > 0) {
        const after = Number(drip.afterDays);
        const from = new Date(Date.now() - 30 * 86_400_000).toISOString();   // لا نلاحق القديم جداً
        const to   = new Date(Date.now() - after * 86_400_000).toISOString();
        const { data: coldRaw } = await db.from('whatsapp_campaign_sends')
          .select('id, phone, name, replied_at')
          .eq('followed_up', false)
          .neq('template_name', drip.template)
          .gte('sent_at', from).lte('sent_at', to)
          .order('sent_at').limit(120);
        // إزالة تكرار بالهاتف + استبعاد من له أي صف ردّ (drip بالعميل لا بالصف):
        // hatif-webhook يكتب replied_at على أحدث صف فقط، فصفوف الرقم الأقدم تبقى
        // null — بلا هذا الفلتر يُلاحَق من ردّ فعلاً، ويستلم رقم واحد عدة رسائل.
        const repliedPhones = new Set((coldRaw || []).filter(r => r.replied_at).map(r => r.phone));
        const seenPhones = new Set<string>();
        const cold = (coldRaw || []).filter(r => {
          if (r.replied_at || repliedPhones.has(r.phone) || seenPhones.has(r.phone)) return false;
          seenPhones.add(r.phone); return true;
        }).slice(0, 30);
        if (cold?.length) {
          await ensureHatif();
          const logRows: Record<string, unknown>[] = [];
          const donePhones: string[] = [];
          const sentAt = new Date().toISOString();
          for (const c of cold) {
            if (blockSet.has(c.phone)) { donePhones.push(c.phone); continue; }   // محظور — لا نلاحقه
            try {
              const res = await sendTemplate(token, { channelId, templateName: drip.template, to: c.phone, vars: [c.name || ''] });
              donePhones.push(c.phone);   // نعلّم كل صفوف الرقم — لا نلاحقه ثانية
              if (res.ok) {
                (out.drip_sent as number)++;
                logRows.push({ phone: c.phone, name: c.name, template_name: drip.template, channel_id: channelId,
                  contact_id: res.contactId, conversation_id: res.conversationId, message_id: res.id,
                  campaign_name: 'متابعة تلقائية', campaign_bucket: `بعد ${after} يوم بلا رد`,
                  status: res.status || 'accepted', sent_at: sentAt, sent_by: 'auto-drip', followed_up: true });
              }
            } catch { donePhones.push(c.phone); }
            await sleep(350);
          }
          if (logRows.length) { try { await db.from('whatsapp_campaign_sends').insert(logRows); } catch { /* */ } }
          // علّم followed_up على **كل صفوف الرقم** (لا الصف الملتقَط فقط) حتى لا
          // يُلاحَق الرقم ثانية عبر صفّ آخر له في تشغيلة قادمة.
          if (donePhones.length) { try { await db.from('whatsapp_campaign_sends').update({ followed_up: true }).in('phone', donePhones); } catch { /* */ } }
        }
      }
    }
  } catch (e) { out.drip_error = String((e as Error).message || e); }

  return json({ ok: true, ...out });
});

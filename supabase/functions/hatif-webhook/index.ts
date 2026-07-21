// hatif-webhook v5 — يستقبل أحداث رسائل Hatif/Voxa (حالة التسليم + الردود)
// ويحدّث whatsapp_campaign_sends. verify_jwt=false — الحماية عبر ?key= ضد
// zoho_auth.webhook_key (نفس نمط zoho-webhook). لا استدعاء زوهو/Hatif هنا.
// v2 (محرك المبيعات §1.37): أول رد وارد = أحرّ فرصة — يحدّث المتابعة
// الموحّدة لـ needs_followup ويُنشئ مهمة crm_task لمالك المتابعة/المُرسِل.
// v3 (2026-07-21): **مطابقة متسلسلة** — الإرسال يرجع contact_id بلا
// conversation_id، والإشعار يحمل conversation_id؛ المطابقة بأحدهما فقط كانت
// تُسقط كل إشعارات التسليم (delivered/read بقيت صفراً). الآن: محادثة ثم جهة،
// ويُخزَّن conversation_id على الصف عند أول مطابقة فالأحداث التالية مباشرة.
import { createClient } from 'npm:@supabase/supabase-js@2';

const svc = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok');
  const db = svc();
  const url = new URL(req.url);

  const key = url.searchParams.get('key') || '';
  const { data: za } = await db.from('zoho_auth').select('webhook_key').eq('id', 1).maybeSingle();
  if (!za?.webhook_key || key !== za.webhook_key) return new Response('forbidden', { status: 403 });

  let p: Record<string, any> = {};
  try { p = await req.json(); } catch { return ok(); }

  const conversationId = p.conversationId || p.ConversationId || null;
  const contactId      = p.contactId || p.ContactId || null;
  const direction      = String(p.direction || p.Direction || '').toLowerCase();
  const status         = String(p.status || p.Status || '');
  const body           = p.body || p.Body || null;
  const when           = p.creationTime || p.CreationTime || new Date().toISOString();
  if (!conversationId && !contactId) return ok();

  // مطابقة متسلسلة (v3): بالمحادثة أولاً، وإلا بالجهة — لا أحدهما حصراً
  const SEL = 'id, phone, replied_at, sent_by, name, conversation_id';
  let row: Record<string, any> | null = null;
  if (conversationId) {
    const { data } = await db.from('whatsapp_campaign_sends').select(SEL)
      .eq('conversation_id', conversationId).order('sent_at', { ascending: false }).limit(1);
    row = data?.[0] || null;
  }
  if (!row && contactId) {
    const { data } = await db.from('whatsapp_campaign_sends').select(SEL)
      .eq('contact_id', contactId).order('sent_at', { ascending: false }).limit(1);
    row = data?.[0] || null;
  }
  if (!row) return ok();

  const patch: Record<string, any> = {};
  // خزّن معرّف المحادثة عند أول مطابقة — الأحداث القادمة تطابق مباشرة
  if (conversationId && !row.conversation_id) patch.conversation_id = conversationId;
  let firstReply = false;
  if (direction === 'inbound') {
    if (!row.replied_at) {
      patch.replied_at = when;
      patch.reply_body = body ? String(body).slice(0, 500) : null;
      firstReply = true;
    }
  } else {
    if (status) patch.status = status;
    if (status === 'Delivered') patch.delivered_at = when;
    if (status === 'Read')      { patch.read_at = when; patch.delivered_at = when; }
    if (status === 'Failed')    patch.error_reason = p.errorReason || p.ErrorReason || String(p.errorCode || 'failed');
  }
  if (Object.keys(patch).length) {
    try { await db.from('whatsapp_campaign_sends').update(patch).eq('id', row.id); } catch { /* */ }
  }

  // أول رد = فرصة حارة: متابعة needs_followup + مهمة للمالك (لا تُفشل الـwebhook)
  if (firstReply && row.phone) {
    try {
      // لا ندهس حالة نهائية (تحوّل/عاد/مستبعَد)
      const { data: fu } = await db.from('retargeting_followups')
        .select('phone, status, owner_id').eq('phone', row.phone).maybeSingle();
      const FINAL = new Set(['converted', 'returned', 'supplier', 'noise', 'blacklist', 'test']);
      if (!fu || !FINAL.has(fu.status)) {
        await db.from('retargeting_followups').upsert({
          phone: row.phone,
          status: 'needs_followup',
          owner_id: fu?.owner_id ?? (row.sent_by && row.sent_by.length > 20 ? row.sent_by : null),
          last_touch_at: when,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'phone' });
      }
      // مهمة لمالك المتابعة أو لمُرسِل الحملة — مرة لكل رد أول
      const assignee = fu?.owner_id ?? (row.sent_by && row.sent_by.length > 20 ? row.sent_by : null);
      if (assignee) {
        const { error: taskErr } = await db.from('crm_tasks').insert({
          title: `↩️ ردّ وارد من ${row.name || row.phone} — تابِعه الآن`,
          kind: 'followup',
          entity_type: 'retargeting',
          entity_ref: row.phone,
          assigned_to: assignee,
          due_at: new Date().toISOString(),
          priority: 'high',
          status: 'open',
        });
        // لا تبتلع فشل إدراج المهمة صامتاً — كان قيد entity_type يرفض 'retargeting'
        // فتضيع كل الردود بلا أثر (أُصلح القيد؛ نُبقي التسجيل لأي فشل مستقبلي)
        if (taskErr) console.error('crm_task insert failed on reply:', taskErr.message);
      }
    } catch (e) { console.error('reply→task handler failed:', (e as Error).message); }
  }
  return ok();
});

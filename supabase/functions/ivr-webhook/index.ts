// ivr-webhook v1 (2026-07-22) — يستقبل نتيجة مكالمة IVR من Voxa/Hatif ويحدّث ivr_calls،
// ثم ينفّذ الإجراء المرتبط بالرقم الذي ضغطه العميل (press→action):
//   followup → متابعة needs_followup + مهمة CRM لمُطلِق المكالمة
//   dnc      → إضافة الرقم لقائمة حظر الاتصال (طلب العميل إيقاف الاتصالات)
//   callback → مهمة «طلب معاودة اتصال»
// verify_jwt=false — الحماية ?key= ضد zoho_auth.webhook_key (نمط hatif-webhook §1.29).
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

  const externalId  = p.externalId || p.ExternalId || null;   // = ivr_calls.id
  const voxaCallId  = p.callId || p.CallId || p.id || p.Id || null;
  const status      = p.status || p.Status || null;           // Pending|InProgress|Completed|Failed
  const result      = p.result || p.Result || null;           // Success|NoAnswer|Busy|Failed|DtmfTimeout
  const pressed     = (p.pressedDigit ?? p.PressedDigit ?? null);
  if (!externalId && !voxaCallId) return ok();

  // طابِق الصف بالـexternalId (الأوثق) ثم بمعرّف مكالمة Voxa
  let row: Record<string, any> | null = null;
  if (externalId) {
    const { data } = await db.from('ivr_calls').select('id, phone, name, script_key, initiated_by, pressed_digit, action_taken')
      .eq('external_id', externalId).limit(1);
    row = data?.[0] || null;
  }
  if (!row && voxaCallId) {
    const { data } = await db.from('ivr_calls').select('id, phone, name, script_key, initiated_by, pressed_digit, action_taken')
      .eq('voxa_call_id', voxaCallId).limit(1);
    row = data?.[0] || null;
  }
  if (!row) return ok();

  const patch: Record<string, any> = {};
  if (status)     patch.status = String(status);
  if (result)     patch.result = String(result);
  if (pressed != null && pressed !== '') patch.pressed_digit = String(pressed);
  if (voxaCallId) patch.voxa_call_id = String(voxaCallId);
  if (p.callDurationSeconds != null) patch.duration_seconds = Number(p.callDurationSeconds) || null;
  if (p.errorMessage) patch.error_message = String(p.errorMessage).slice(0, 300);
  if (p.hangupCause)  patch.hangup_cause = String(p.hangupCause).slice(0, 120);
  for (const [src, col] of [['initiatedAt', 'initiated_at'], ['ringingAt', 'ringing_at'], ['answeredAt', 'answered_at'], ['completedAt', 'completed_at']] as [string, string][]) {
    if (p[src]) patch[col] = p[src];
  }

  // press→action — مرة واحدة (لا يُعاد التنفيذ إن وصل الـwebhook مرتين).
  const digit = (pressed != null && pressed !== '') ? String(pressed) : null;
  const isCompleted = String(status || '') === 'Completed';
  if (isCompleted && digit && !row.action_taken) {
    try {
      const { data: cfgRow } = await db.from('app_settings').select('value').eq('key', 'ivr_config').maybeSingle();
      let cfg: Record<string, any> = {};
      try { cfg = cfgRow?.value ? JSON.parse(cfgRow.value) : {}; } catch { /* */ }
      const scripts = Array.isArray(cfg.scripts) ? cfg.scripts : [];
      const script = scripts.find((s: Record<string, any>) => s.key === row!.script_key) || null;
      const opt = script && Array.isArray(script.options) ? script.options.find((o: Record<string, any>) => String(o.digit) === digit) : null;
      const action = opt?.action || 'none';
      const owner = (row.initiated_by && String(row.initiated_by).length > 20) ? row.initiated_by : null;
      const when = new Date().toISOString();

      if (action === 'followup' || action === 'callback') {
        if (row.phone) {
          const { data: fu } = await db.from('retargeting_followups').select('phone, status, owner_id').eq('phone', row.phone).maybeSingle();
          const FINAL = new Set(['converted', 'returned', 'supplier', 'noise', 'blacklist', 'test']);
          if (!fu || !FINAL.has(fu.status)) {
            await db.from('retargeting_followups').upsert({
              phone: row.phone, status: 'needs_followup', owner_id: fu?.owner_id ?? owner,
              last_touch_at: when, updated_at: when,
            }, { onConflict: 'phone' });
          }
          const assignee = (fu?.owner_id ?? owner);
          if (assignee) {
            const title = action === 'callback'
              ? `📞 طلب معاودة اتصال من ${row.name || row.phone} (ضغط ${digit})`
              : `📞 ${row.name || row.phone} ضغط ${digit} في مكالمة آلية — تابِعه`;
            await db.from('crm_tasks').insert({
              title, kind: 'followup', entity_type: 'retargeting', entity_ref: row.phone,
              assigned_to: assignee, due_at: when, priority: 'high', status: 'open',
            });
          }
        }
      } else if (action === 'dnc') {
        if (row.phone) {
          await db.from('campaign_phone_blocklist').upsert({
            phone: row.phone, name: row.name || null, reason: 'طلب إيقاف الاتصالات (IVR)', added_at: when,
          }, { onConflict: 'phone' });
        }
      }
      patch.action_taken = action;
    } catch (e) { console.error('ivr press→action failed:', (e as Error).message); }
  }

  if (Object.keys(patch).length) {
    try { await db.from('ivr_calls').update(patch).eq('id', row.id); } catch { /* */ }
  }
  return ok();
});

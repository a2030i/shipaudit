// يربط contactId (من أحداث هاتف AssignedUserIdChanged) → رقم الهاتف بجلب الجهة
// من هاتف (GET /v1/contacts/{id}.phoneNumber) وتخزينه في hatif_contact_phones.
// يغطّي التواصل المباشر البارد الذي لا نملك ربطه من سجلّ الحملات/مزامنة المتاجر
// (خوف المستخدم 2026-07-26). حارس: X-Cron-Key (كرون) أو مدير. verify_jwt=false.
// cron jobid 16 كل 10 دقائق. الرقم يُخزَّن خاماً (+966…) والـRPC يطبّعه بـ norm_sa_phone.
import { createClient } from 'npm:@supabase/supabase-js@2';
const env = (...n: string[]) => { for (const k of n) { const v = Deno.env.get(k); if (v && v.trim()) return v.trim(); } return ''; };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  const supa = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  // ── حارس ──
  const { data: authRow } = await supa.from('zoho_auth').select('cron_key').limit(1).maybeSingle();
  let authed = false;
  const cronKey = req.headers.get('x-cron-key');
  if (cronKey && authRow?.cron_key && cronKey === authRow.cron_key) authed = true;
  if (!authed) {
    const jwt = (req.headers.get('authorization') || '').replace('Bearer ', '').trim();
    if (jwt) {
      const { data: u } = await supa.auth.getUser(jwt);
      if (u?.user) {
        const { data: p } = await supa.from('profiles').select('role').eq('id', u.user.id).maybeSingle();
        if (p?.role === 'admin') authed = true;
      }
    }
  }
  if (!authed) return json({ error: 'forbidden' }, 403);

  // ── توكن Voxa ──
  const tr = await fetch('https://api.voxa.sa/connect/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env('client_id', 'HATIF_CLIENT_ID'), client_secret: env('secret', 'HATIF_CLIENT_SECRET'), scope: 'VoxaAPI' }),
  });
  const token = (await tr.json())?.access_token;
  if (!token) return json({ error: 'token' }, 502);

  // ── جهات مُسنَدة لموظف بلا ربط رقم بعد ──
  const { data: evs } = await supa.from('hatif_events')
    .select('contact_id')
    .eq('event_type', 'AssignedUserIdChanged')
    .not('assigned_user_id', 'is', null)
    .not('contact_id', 'is', null);
  const ids = [...new Set((evs || []).map((e: { contact_id: string }) => e.contact_id))];
  if (!ids.length) return json({ ok: true, todo: 0, resolved: 0 });
  const { data: known } = await supa.from('hatif_contact_phones').select('contact_id').in('contact_id', ids);
  const knownSet = new Set((known || []).map((k: { contact_id: string }) => k.contact_id));
  const todo = ids.filter((id) => !knownSet.has(id)).slice(0, 200);

  let resolved = 0;
  for (const cid of todo) {
    try {
      const r = await fetch(`https://api.voxa.sa/v1/contacts/${cid}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) {
        // 404 = جهة اختفت → خزّن null كي لا نعيد جلبها كل تشغيلة
        if (r.status === 404) await supa.from('hatif_contact_phones').upsert({ contact_id: cid, phone: null, name: null, synced_at: new Date().toISOString() }, { onConflict: 'contact_id' });
        continue;
      }
      const c = await r.json();
      const phone = c?.phoneNumber || null;
      await supa.from('hatif_contact_phones').upsert({ contact_id: cid, phone, name: c?.name || null, synced_at: new Date().toISOString() }, { onConflict: 'contact_id' });
      if (phone) resolved++;
    } catch { /* skip */ }
    await new Promise((res) => setTimeout(res, 150)); // حصة Voxa
  }
  return json({ ok: true, todo: todo.length, resolved });
});

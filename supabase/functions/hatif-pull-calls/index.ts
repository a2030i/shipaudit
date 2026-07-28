// يسحب سجلّ مكالمات هاتف (GET /v1/call/list) إلى hatif_call_log — تسجيل + ملخّص
// AI + مشاعر + أوقات لكل مكالمة (مصدر لوحة أداء الفريق). تصفّح newest-first
// ويتوقّف عند صفحة كلّها معروفة (تحديث) أو نهاية القائمة (backfill).
// حارس: X-Cron-Key أو مدير. verify_jwt=false. cron كل 30د.
import { createClient } from 'npm:@supabase/supabase-js@2';
const env = (...n: string[]) => { for (const k of n) { const v = Deno.env.get(k); if (v && v.trim()) return v.trim(); } return ''; };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const secs = (a: string | null, b: string | null) => { if (!a || !b) return null; const d = (new Date(b).getTime() - new Date(a).getTime()) / 1000; return (isFinite(d) && d >= 0) ? Math.round(d) : null; };

Deno.serve(async (req) => {
  const supa = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  const { data: authRow } = await supa.from('zoho_auth').select('cron_key').limit(1).maybeSingle();
  let authed = false;
  const cronKey = req.headers.get('x-cron-key');
  if (cronKey && authRow?.cron_key && cronKey === authRow.cron_key) authed = true;
  if (!authed) {
    const jwt = (req.headers.get('authorization') || '').replace('Bearer ', '').trim();
    if (jwt) { const { data: u } = await supa.auth.getUser(jwt); if (u?.user) { const { data: p } = await supa.from('profiles').select('role').eq('id', u.user.id).maybeSingle(); if (p?.role === 'admin') authed = true; } }
  }
  if (!authed) return json({ error: 'forbidden' }, 403);

  const tr = await fetch('https://api.voxa.sa/connect/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env('client_id', 'HATIF_CLIENT_ID'), client_secret: env('secret', 'HATIF_CLIENT_SECRET'), scope: 'VoxaAPI' }),
  });
  const token = (await tr.json())?.access_token;
  if (!token) return json({ error: 'token' }, 502);

  const url = new URL(req.url);
  const SIZE = 100;
  const MAX_PAGES = Number(url.searchParams.get('maxPages')) || 40;
  let fetched = 0, inserted = 0, page = 0;
  for (; page < MAX_PAGES; page++) {
    const r = await fetch(`https://api.voxa.sa/v1/call/list?skipCount=${page * SIZE}&maxResultCount=${SIZE}&sorting=creationTime%20desc`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) break;
    const body = await r.json();
    const items = Array.isArray(body?.items) ? body.items : [];
    if (!items.length) break;
    fetched += items.length;
    const ids = items.map((c: Record<string, unknown>) => c.id as string);
    const { data: known } = await supa.from('hatif_call_log').select('id').in('id', ids);
    const knownSet = new Set((known || []).map((k: { id: string }) => k.id));
    const rows = items.map((c: Record<string, any>) => ({
      id: c.id,
      user_id: c.userId || null,
      user_name: c.userName || null,
      phone_number_id: c.phoneNumberId || null,
      contact_number: c.contactNumber || c.contactNumberFormatted || null,
      call_type: c.callType ?? null,
      status: c.status ?? null,
      creation_time: c.creationTime || null,
      pickup_time: c.pickupTime || null,
      hangup_time: c.hangupTime || null,
      ringing_duration: c.ringingDuration || null,
      talk_seconds: secs(c.pickupTime || null, c.hangupTime || null),
      recording_url: c.recordingUrl || null,
      ai_summary: c.aiSummary ?? null,
      sentiment: c.aiSummary?.sentiment ?? null,
      synced_at: new Date().toISOString(),
    }));
    await supa.from('hatif_call_log').upsert(rows, { onConflict: 'id' });
    const newCount = ids.filter((id: string) => !knownSet.has(id)).length;
    inserted += newCount;
    if (items.length < SIZE) break;      // نهاية القائمة
    if (newCount === 0) break;           // لحقنا المخزّن (تشغيلة تحديث)
    await new Promise((res) => setTimeout(res, 120));
  }
  return json({ ok: true, pages: page, fetched, inserted });
});

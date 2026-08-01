// يسحب سجلّ مكالمات هاتف (GET /v1/call/list) إلى hatif_call_log — تسجيل + ملخّص
// AI + مشاعر + أوقات لكل مكالمة (مصدر لوحة أداء الفريق). تصفّح newest-first
// ويتوقّف عند صفحة كلّها معروفة (تحديث) أو نهاية القائمة (backfill).
// حارس: X-Cron-Key أو مدير. verify_jwt=false. cron كل 5د.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { extractHatifCallbackCommitment } from '../_shared/hatifCommitments.ts';
const env = (...n: string[]) => { for (const k of n) { const v = Deno.env.get(k); if (v && v.trim()) return v.trim(); } return ''; };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const secs = (a: string | null, b: string | null) => { if (!a || !b) return null; const d = (new Date(b).getTime() - new Date(a).getTime()) / 1000; return (isFinite(d) && d >= 0) ? Math.round(d) : null; };
const norm = (raw: unknown) => {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('966')) return d;
  if (d.length === 10 && d.startsWith('05')) return '966' + d.slice(1);
  if (d.length === 9 && d.startsWith('5')) return '966' + d;
  return d;
};

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
  const tokenBody = await tr.json().catch(() => ({}));
  const token = tokenBody?.access_token;
  if (!tr.ok || !token) return json({ error: 'hatif_token_failed', status: tr.status }, 502);

  const url = new URL(req.url);
  const SIZE = 100;
  const MAX_PAGES = Math.min(100, Math.max(1, Number(url.searchParams.get('maxPages')) || 40));
  // التشغيل المجدول يبقى خفيفاً ويتوقف عند أول صفحة معروفة. المدير يستطيع
  // تشغيل مزامنة تاريخية محدودة عمداً لإعادة استخراج الالتزامات من السجل القديم.
  const backfillCommitments = url.searchParams.get('backfillCommitments') === 'true';
  let fetched = 0, inserted = 0, commitmentsCaptured = 0, page = 0;
  let latestCall: string | null = null;
  for (; page < MAX_PAGES; page++) {
    const r = await fetch(`https://api.voxa.sa/v1/call/list?skipCount=${page * SIZE}&maxResultCount=${SIZE}&sorting=creationTime%20desc`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return json({ error: 'hatif_calls_failed', status: r.status, page }, 502);
    const body = await r.json().catch(() => ({}));
    const items = Array.isArray(body?.items) ? body.items : [];
    if (!items.length) break;
    if (!latestCall && items[0]?.creationTime) latestCall = String(items[0].creationTime);
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
      contact_phone: norm(c.contactNumber || c.contactNumberFormatted) || null,
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
    const { error: upsertError } = await supa.from('hatif_call_log').upsert(rows, { onConflict: 'id' });
    if (upsertError) return json({ error: 'hatif_call_log_upsert_failed', detail: upsertError.message, page }, 500);
    const commitments = items.flatMap((c: Record<string, any>, index: number) => {
      const phone = rows[index]?.contact_phone;
      const sourceAt = c.creationTime ? String(c.creationTime) : '';
      if (!c.id || !phone || !sourceAt) return [];
      const extracted = extractHatifCallbackCommitment(c.aiSummary, sourceAt);
      if (!extracted) return [];
      return [{
        source_call_id: String(c.id),
        phone,
        source_call_at: sourceAt,
        expected_agent_id: c.userId ? String(c.userId) : null,
        expected_agent_name: c.userName ? String(c.userName) : null,
        window_start: extracted.windowStart,
        window_end: extracted.windowEnd,
        extraction_confidence: extracted.confidence,
        source_text: extracted.sourceText,
        status: extracted.status,
      }];
    });
    if (commitments.length) {
      const { error: commitmentError } = await supa.from('hatif_call_commitments')
        .upsert(commitments, { onConflict: 'source_call_id', ignoreDuplicates: true });
      if (commitmentError) return json({ error: 'hatif_commitment_capture_failed', detail: commitmentError.message, page }, 500);
      commitmentsCaptured += commitments.length;
    }
    const newCount = ids.filter((id: string) => !knownSet.has(id)).length;
    inserted += newCount;
    if (items.length < SIZE) break;      // نهاية القائمة
    if (newCount === 0 && !backfillCommitments) break; // لحقنا المخزّن (تشغيلة تحديث)
    await new Promise((res) => setTimeout(res, 120));
  }
  const { data: evaluation, error: evaluationError } = await supa.rpc('evaluate_hatif_call_commitments');
  if (evaluationError) return json({ error: 'hatif_commitment_evaluation_failed', detail: evaluationError.message }, 500);
  return json({ ok: true, pages: page, fetched, inserted, commitmentsCaptured, backfillCommitments, evaluation, latestCall, syncedAt: new Date().toISOString() });
});

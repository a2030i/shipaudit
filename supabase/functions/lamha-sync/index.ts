// lamha-sync v0 (ping) — فحص قراءة-فقط لواجهة لمحة الداخلية.
import { createClient } from 'npm:@supabase/supabase-js@2';

const svc = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const BASE = 'https://app.lamha.sa/api/v2';
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b, null, 2), { status: s, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  const db = svc();
  const url = new URL(req.url);
  const key = url.searchParams.get('key') || req.headers.get('x-probe-key') || '';
  const { data: za } = await db.from('zoho_auth').select('webhook_key').eq('id', 1).maybeSingle();
  if (!za?.webhook_key || key !== za.webhook_key) return new Response('forbidden', { status: 403 });

  const token = (Deno.env.get('LAMHA_API_TOKEN') || '').trim();
  if (!token) return j({ error: 'LAMHA_API_TOKEN غير مضبوط' });

  // تشخيص: طول التوكن وبادئته (بلا كشف القيمة الكاملة) + محاولة صيغتي ترويسة
  const path = url.searchParams.get('path') || '/orders?page=1';
  const style = url.searchParams.get('style') || 'x';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (style === 'x') headers['X-LAMHA-TOKEN'] = token;
  else if (style === 'bearer') headers['Authorization'] = `Bearer ${token}`;
  else if (style === 'token') headers['token'] = token;
  else if (style === 'apikey') headers['api-key'] = token;

  try {
    const r = await fetch(`${BASE}${path}`, { headers });
    const text = await r.text();
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch { /* */ }
    return j({
      http: r.status,
      token_len: token.length,
      token_prefix: token.slice(0, 6),
      style,
      body: parsed ?? text.slice(0, 800),
    });
  } catch (e) {
    return j({ error: String((e as Error).message || e) }, 200);
  }
});

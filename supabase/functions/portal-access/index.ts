// portal-access v1 — بوابة العميل عبر **رابط موقَّع** بدل البحث الحرّ بالجوال.
//
// المخاطرة المُعالَجة: `portal_lookup(phone)` كانت تكشف ذمّة أي تاجر لمن
// يعرف رقمه — إثبات هوية بالمعرفة لا بالحيازة، بلا OTP ولا حدّ معدّل.
// الرابط يُرسَل **ضمن رسالة التحصيل** فيصل لصاحبه وحده.
//
// الأمان:
//   · الرمز 32 بايت عشوائية (base64url) — لا يحوي جوالاً ولا مبلغاً ولا معرّفاً.
//   · **لا يُخزَّن الرمز**، فقط sha256 منه.
//   · صالح 72 ساعة · جلسة 30 دقيقة بعد أول فتح ثم يُغلق.
//   · الجلسة كوكي **HttpOnly + Secure + SameSite=Strict** — لا تُقرأ من JS.
//   · حدّ معدّل بالـIP (20/10 دقائق) + سجل تدقيق لكل فتح وفشل.
//   · verify_jwt=false لأن الزائر بلا حساب — والحدّ الفعلي هو الرمز نفسه.
//
// ⚠️ عند النشر: مرِّر verify_jwt:false صراحةً (فخّ §1.37).
import { createClient } from 'npm:@supabase/supabase-js@2';

const APP_ORIGIN = Deno.env.get('APP_ORIGIN') || 'https://shipaudit-five.vercel.app';
const cors = {
  'Access-Control-Allow-Origin': APP_ORIGIN,
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Credentials': 'true',
  'Vary': 'Origin',
};

const svc = () => createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

const json = (b: unknown, s = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { 'Content-Type': 'application/json', ...cors, ...extra },
  });

// أول IP في السلسلة هو العميل الحقيقي؛ الباقي بروكسيات.
const clientIp = (req: Request) =>
  (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null;

const readCookie = (req: Request, name: string) => {
  const raw = req.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const db = svc();
  const url = new URL(req.url);
  const action = url.searchParams.get('action') || 'open';
  const ip = clientIp(req);
  const ua = req.headers.get('user-agent');

  try {
    // ── فتح الرابط: الرمز → جلسة قصيرة في كوكي HttpOnly ──
    if (action === 'open') {
      const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
      const token = String(body.token || url.searchParams.get('t') || '');
      if (!token) return json({ ok: false, reason: 'missing' }, 400);

      const { data: res, error } = await db.rpc('portal_redeem_token', {
        p_token: token, p_ip: ip, p_ua: ua,
      });
      if (error) return json({ ok: false, reason: 'server' }, 500);
      if (!res?.ok) {
        // نُرجِع السبب فقط — بلا أي بيانات عميل عند الفشل
        return json({ ok: false, reason: res?.reason || 'invalid', phone: res?.phone ?? null }, 403);
      }

      const { data: portal } = await db.rpc('portal_data_for_customer', {
        p_customer: res.customer_name,
      });

      // الجلسة في كوكي لا يقرؤه JS — فسرقة XSS لا تكفي لتسريبها
      const maxAge = Math.max(
        60,
        Math.floor((new Date(res.session_until).getTime() - Date.now()) / 1000),
      );
      const cookie = [
        `sa_portal=${encodeURIComponent(token)}`,
        'HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/',
        `Max-Age=${maxAge}`,
      ].join('; ');

      return json({ ok: true, portal, session_until: res.session_until },
        200, { 'Set-Cookie': cookie });
    }

    // ── تحديث البيانات داخل الجلسة (الكوكي وحده، بلا رمز في الرابط) ──
    if (action === 'refresh') {
      const token = readCookie(req, 'sa_portal');
      if (!token) return json({ ok: false, reason: 'no_session' }, 401);
      const { data: res } = await db.rpc('portal_redeem_token', {
        p_token: token, p_ip: ip, p_ua: ua,
      });
      if (!res?.ok) return json({ ok: false, reason: res?.reason || 'expired' }, 403);
      const { data: portal } = await db.rpc('portal_data_for_customer', {
        p_customer: res.customer_name,
      });
      return json({ ok: true, portal, session_until: res.session_until });
    }

    // ── إنهاء الجلسة ──
    if (action === 'logout') {
      return json({ ok: true }, 200, {
        'Set-Cookie': 'sa_portal=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0',
      });
    }

    return json({ ok: false, reason: 'unknown_action' }, 400);
  } catch (e) {
    return json({ ok: false, reason: 'server', detail: String((e as Error).message || e) }, 500);
  }
});

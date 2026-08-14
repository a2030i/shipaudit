const ALLOWED_ORIGINS = new Set([
  'https://shipaudit-five.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

function cors(req: Request) {
  const origin = req.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://shipaudit-five.vercel.app',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors(req),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function validSaudiPoint(lat: number, lon: number) {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= 16 && lat <= 33 && lon >= 34 && lon <= 56;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, { ok: false, error: 'method_not_allowed' }, 405);

  const origin = req.headers.get('origin') || '';
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return json(req, { ok: false, error: 'origin_not_allowed' }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(req, { ok: false, error: 'invalid_json' }, 400);
  }

  // Honeypot for automated submissions.
  if (body.website) return json(req, { ok: true, data: null });

  const lat = Number(body.lat);
  const lon = Number(body.lon);
  if (!validSaudiPoint(lat, lon)) {
    return json(req, { ok: false, error: 'الموقع يجب أن يكون داخل المملكة العربية السعودية.' }, 400);
  }

  const secret = String(Deno.env.get('HUDHUD_SECRET_KEY') || '').trim();
  if (!secret) return json(req, { ok: false, error: 'خدمة العناوين غير مهيأة بعد.' }, 503);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const upstream = await fetch('https://b.hudhud.sa/v1/geocoding/reverse', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Accept-Language': 'ar',
      },
      body: JSON.stringify({ lat, lon }),
      signal: controller.signal,
    });
    const payload = await upstream.json().catch(() => null);
    if (!upstream.ok || !payload?.ok) {
      const safeError = upstream.status === 404
        ? 'لم نعثر على عنوان لهذا الموقع.'
        : 'تعذرت قراءة العنوان من المزود.';
      return json(req, { ok: false, error: safeError }, upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502);
    }
    const data = payload.data || {};
    return json(req, {
      ok: true,
      data: {
        shortcode: data.shortcode || data.short_address || data.address?.shortcode || null,
        address_ar: data.address_ar || data.display_name || null,
        display_name: data.display_name || null,
        address: data.address || null,
        place_id: data.place_id || null,
        lat,
        lon,
      },
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'AbortError';
    return json(req, {
      ok: false,
      error: timedOut
        ? 'انتهت مهلة خدمة العناوين. حاول مجددًا.'
        : 'تعذر الاتصال بخدمة العناوين.',
    }, 502);
  } finally {
    clearTimeout(timeout);
  }
});

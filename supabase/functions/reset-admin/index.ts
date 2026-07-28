// معطَّلة (2026-07-21) — كانت ثغرة حرجة: verify_jwt=false + تصفّر كلمة مرور
// المدير إلى قيمة ثابتة معروفة بلا أي مصادقة (استيلاء كامل من الإنترنت).
// أُبطلت أثناء تقييم أمني. verify_jwt=true الآن + الجسم يرفض دائماً.
// لا تُعِد تفعيل منطق تصفير كلمة المرور إطلاقاً.
Deno.serve(() => new Response(
  JSON.stringify({ ok: false, error: 'disabled' }),
  { status: 410, headers: { 'Content-Type': 'application/json' } },
))

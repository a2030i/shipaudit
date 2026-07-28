// whatsapp-send — مُهمَل. استُبدل Respondly كلياً بـHatif/Voxa (دالة hatif-send).
// يردّ 410 دائماً — لا يرسل شيئاً.
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
Deno.serve((req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  return new Response(JSON.stringify({ ok: false, error: 'deprecated — استخدم hatif-send (استُبدل Respondly)' }),
    { status: 410, headers: { ...CORS, 'Content-Type': 'application/json' } });
});

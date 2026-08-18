// zoho-intake — مُزالة (2026-07-03). قناة إيميل زوهو حُذفت بالكامل
// — الربط المباشر (zoho-sync) يغطي كل شيء. هذا شاهد قبر يردّ 410
// لأي تحويل إيميل متبقٍّ حتى يحذف المستخدم قاعدة التوجيه + يحذف الدالة.
Deno.serve(() => new Response(
  JSON.stringify({ error: 'gone', message: 'قناة إيميل زوهو أُزيلت — البيانات تأتي من الربط المباشر' }),
  { status: 410, headers: { 'Content-Type': 'application/json' } },
));


// ⛔ مُوقَفة — تكامل Gmail أُلغي بالكامل (2026-07-29، قرار المستخدم).
//
// السبب: آخر صفّ كتبته المزامنة بتاريخ 6 مايو (12 أسبوعاً بلا إنتاج)، وصفر
// استدعاء من الواجهة، والفواتير تصل عبر InboxDone → webhook-intake لا Gmail.
//
// السرّ GOOGLE_CLIENT_SECRET حُذف من قاعدة البيانات، والكرون أُوقف، وتوكن
// التحديث المخزَّن حُذف. تُحذف هذه الدوال نهائياً من لوحة Supabase.
Deno.serve(() =>
  new Response(
    JSON.stringify({ error: 'gone', message: 'تكامل Gmail مُوقَف — الفواتير تصل عبر InboxDone' }),
    { status: 410, headers: { 'Content-Type': 'application/json' } },
  )
);


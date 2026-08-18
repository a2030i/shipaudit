// ⛔ مُوقَفة — تكامل Gmail أُلغي بالكامل (2026-07-29، قرار المستخدم).
// كرون `gmail-auto-sync-6h` أُوقف — كان يعمل 4 مرات يومياً ويُبلّغ «نجاح»
// بينما لم يكتب صفاً واحداً منذ 6 مايو (عمى الكرونات §1.49).
Deno.serve(() =>
  new Response(
    JSON.stringify({ error: 'gone', message: 'تكامل Gmail مُوقَف — الفواتير تصل عبر InboxDone' }),
    { status: 410, headers: { 'Content-Type': 'application/json' } },
  )
);


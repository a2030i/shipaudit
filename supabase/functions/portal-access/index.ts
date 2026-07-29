// ⛔ مُوقَفة — بوابة التاجر للدفع أُلغيت بالكامل (2026-07-29، قرار المستخدم:
// «ماعاد احتاجها، حتى ميسر ماعاد نحتاجها»).
//
// التحصيل يتم عبر حملات واتساب والتحويل البنكي المباشر. حُذفت معها:
// صفحة /portal · شاشة طلبات السداد · مفتاح ميسر · جداول
// portal_access_tokens/portal_access_log/portal_otp/payment_requests ·
// ودوال portal_lookup/get_payment_config/attach_moyasar_payment.
//
// **ما لم يُمَسّ**: جدولا `payments` و`payment_allocations` — دفعات
// الناقلين، عصب المحاسبة، ولا علاقة لها بالبوابة رغم تشابه الاسم.
//
// تُحذف نهائياً من لوحة Supabase مع بقية شواهد القبر (§1.51).
Deno.serve(() =>
  new Response(
    JSON.stringify({ error: 'gone', message: 'بوابة التاجر للدفع مُلغاة' }),
    { status: 410, headers: { 'Content-Type': 'application/json' } },
  )
);

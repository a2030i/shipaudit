-- نقطة الحقيقة الواحدة لدين العميل.
--
-- ⚠️ الفخّ: جمع `zoho_invoices` **لا يساوي** دين العميل. الرصيد الافتتاحي
-- الذي أُدخل في زوهو عند التأسيس يُنشئ ذمّة مدينة **بلا مستند فاتورة**،
-- فيسقط من أي جمع للفواتير.
--
-- مقيس على الإنتاج (2026-07-29): 68 عميلاً مديناً · زوهو يقول 171,351 ر.س
-- ومجموع فواتيرنا 112,086 → **59,265 ر.س دين مخفي على 27 عميلاً**.
-- مثال «لارسا»: زوهو 6,201.42 · فواتيره المفتوحة 79.96 · الفارق 6,121.46
-- وهو حرفياً «مستحق الدفع الرصيد الافتتاحي» في شاشة زوهو.
--
-- القاعدة: **`zoho_contacts.outstanding_receivable` هو الإجمالي** (يحسبه
-- زوهو نفسه ويشمل كل شيء)، والفواتير تبقى للتفصيل «من أين جاء الدين»
-- لا للإجمالي. أي شاشة تعرض دين عميل تقرأ من هنا.
--
-- ملاحظة: `zoho_invoices` بلا عمود due_date — التقادم يُقاس من `date`
-- (تاريخ الفاتورة) كما تفعل بقية الدوال.
create or replace view public.customer_ar as
select
  c.contact_name,
  c.zoho_id,
  c.outstanding_receivable                        as total_due,      -- الإجمالي الصحيح
  coalesce(inv.invoiced_due, 0)                   as invoiced_due,   -- ما تغطّيه فواتير
  round(c.outstanding_receivable
        - coalesce(inv.invoiced_due, 0), 2)       as opening_due,    -- رصيد افتتاحي/بلا مستند
  coalesce(inv.open_count, 0)                     as open_invoices,
  inv.oldest_invoice_date,
  coalesce(inv.days_oldest, 0)                    as days_oldest,
  c.unused_credits_receivable                     as unused_credits,
  c.status
from public.zoho_contacts c
left join lateral (
  select sum(i.balance)                                   as invoiced_due,
         count(*)                                         as open_count,
         min(i.date)                                      as oldest_invoice_date,
         (current_date - min(i.date))                     as days_oldest
  from public.zoho_invoices i
  where i.customer_name = c.contact_name and i.balance > 0.5
) inv on true
where c.contact_type = 'customer';

comment on view public.customer_ar is
  'دين العميل — الإجمالي من zoho_contacts (يشمل الرصيد الافتتاحي)، والتفصيل من الفواتير. ممنوع حساب دين عميل بجمع zoho_invoices وحدها.';

grant select on public.customer_ar to authenticated;

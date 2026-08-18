-- تبويب «مطابقة لمحة الداخلية»: عمود زوهو صار من المرآة الحية (2026-07-17)
-- كان يقرأ من ميزان مراجعة مرفوع يدوياً (store_balance_snapshots source='zoho')
-- فيتقادم أسابيع — «زوهو API مفروض ما عاد فيه ملفات» (قرار المستخدم).
-- المصدر الكامل مُطبَّق على FIN عبر MCP باسم balance_reconciliation_zoho_live:
-- zoho_rows = zoho_invoices (balance>0.5) مجمّعة بالعميل، المرساة =
-- customer_merchant_links ثم normalize_arabic_name ضد أسماء المتاجر.
-- latest_zoho/store_balance_snapshots(source='zoho') لم يعد يُقرأ.
select 1;

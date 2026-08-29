# عقد مصادر بيانات لمحة

## القرار

Lamha Employee API هو مصدر الحقيقة للهوية وحالة الحساب والنشاط والفوترة
والشحنات والتوثيق والربط. ملف stores.xlsx مصدر إثراء فقط، ولا ينشئ لقطة
تشغيلية أحدث من API ولا يستطيع تغيير أهلية الإيقاف أو التشغيل.

## الحقول التي يملكها API

- id, name, status, invoiceStatus, joinDate
- shipmentsCount, lastShipmentDate, monthlyAvgOrders, online
- verified, photo
- حقول التفاصيل عند توفرها: phone, email, city, integrationType,
  storeType, ownerActivated, codStatusLabel, codStatusTone,
  hasWalletTransactions, accountingProvider, accountingUrl,
  identityNumber, warehouseAddress, website, pendingCosts,
  pendingRevenue, lamhaProfit, monthlyTargetPct

أي قيمة مشتركة من Excel تبقى داخل _excel للتدقيق فقط، ولا تدخل الملف
الفعّال ولا اللقطة التشغيلية.

## إثراء Excel المسموح

تدخل الحقول التالية فقط لأنها غير متاحة حاليًا كقيم مكافئة من API:

- profileStatus
- vatRegistered
- zatcaCompleted
- lastTopupAt
- walletBalance

الخلايا الفارغة لا تتحول إلى رصيد محفظة صفري. وتبقى الأعمدة الأصلية في
_excel لتتبع المصدر دون منحها أولوية تشغيلية.

القيمة غير الموجودة في آخر إثراء تبقى `null` في اللقطة التشغيلية؛ لا تحمل
المزامنة قيمة Excel قديمة ولا تصنع صفرًا ماليًا بدل «غير متوفر».

## حالة الحساب

- inactive فقط يعني أن الحساب موقوف.
- active وidle وstopped تعني أن الحساب يعمل.
- stopped شريحة نشاط وليست أمر إيقاف إداري.
- إجراءات التحصيل والإيقاف والتشغيل لا تقرأ حالة Excel.

## التوثيق

verified القادم من API هو المصدر المعتمد. يحول نموذج القراءة القيمة إلى
موثق أو غير موثق للتوافق مع الواجهة، ولا يستخدم verificationStatus القادم
من Excel.

## المزامنة

- دليل المتاجر الكامل: يوميًا الساعة 00:00 بتوقيت السعودية
  (21:00 UTC).
- تفاصيل المتاجر: دفعات قراءة فقط من 24 متجرًا عند الدقائق
  07 و22 و37 و52 من كل ساعة.
- الأولوية للمتاجر التي لم تُقرأ تفاصيلها، ثم أقدم تفصيل تجاوز سبعة أيام.
- بعد اكتمال التغطية لا يرسل العامل طلبات حتى تصبح تفاصيل قديمة.
- كل الطلبات تمر عبر محدد Lamha المشترك، وتترك ستة طلبات احتياطًا من حد
  30 طلبًا.
- العامل لا يحتوي أي PATCH في مسار المزامنة ولا ينفذ إيقافًا أو تشغيلًا.

## التخزين والمصدر

lamha_store_profiles.api_data يحتفظ بكل الحقول التي ترجعها Lamha، بما
في ذلك الحقول المستقبلية غير المعروفة مسبقًا. excel_data يقتصر على
الإثراء المسموح ونسخة _excel الخام. دالة lamha_store_profile تعيد
المصدر لكل مجموعة حقول، مع أوقات فحص القائمة والتفاصيل واستيراد Excel.

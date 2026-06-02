# صيغ كشوف حساب الناقلين (Account Statements) — مرجع

> هذه **كشوف حساب** (Statement of Account) على مستوى الرصيد — تُظهر القيود
> المالية (فواتير، تحصيلات COD، إشعارات دائنة) والرصيد الجاري. تختلف عن
> ملفات الفواتير التفصيلية per-AWB التي تُرفع في `/upload`.
> مكانها الطبيعي: `carrier_statements` / الدفتر `carrier_operations`.
>
> عيّنات محفوظة بتاريخ 2026-06-02 من ملفات المستخدم.

---

## 1. سمسا SMSA — Statement of Account

**ترويسة التعرّف:**
- `SMSA Express Trans. Co. Ltd.`
- VAT Number: `300057426910003`
- العنوان: صناديق بريد الرياض/جدة/الدمام
- `STATEMENT OF ACCOUNT AS ON DD-MM-YYYY`

**حقول العميل:**
| الحقل | مثال |
|---|---|
| Customer Number | `RX8668` (بادئة `RX` + أرقام) |
| Customer Name | `For Tech For Information Techenology-B2c` |
| Customer VAT Number | `311862242600003` |
| Currency | `SAR` |

**أعمدة الجدول:**
```
Date | Doc Type | Document Number | Ref | Details | Amount | Amount Applied | Balance
```

**أنواع المستندات (Doc Type):**
- `COD` — تحصيل COD محوّل (موجب، مثل `586832  19,560.88`)
- `CM` — Credit Memo / إشعار دائن (سالب، مثل `ECM89826  -298.00`)
  - رقم الإشعار إمّا `ECM#####` أو رقم طويل `2915#########`

**ملاحظات parsing:**
- السالب يُكتب بإشارة ناقص صريحة: `-298.00` (ليس أقواس).
- `Total Balance` في الأسفل (مثال: `28,052.87`).
- IBAN السداد: `SA0610000065900000224807` (البنك الأهلي السعودي SNB).
- بوابة الدفع: `www.mybill.smsaexpress.com` / دعم `ruhsupport@smsaexpress.com`.

---

## 2. أرامكس Aramex — Statement of Account

**ترويسة التعرّف:**
- `Aramex Saudi Limited One Person Company`
- `Al Olaya, King Khalid International Airport — RIYADH`
- `Statement of Account`

**حقول العميل:**
| الحقل | مثال |
|---|---|
| Account Number | `72728969` (أرقام فقط) |
| Customer | `Speed Pillars Information Technology Est.` |
| Credit terms | `30 days` |
| Statement Date | `31.05.2026` (نقاط فاصلة، DD.MM.YYYY) |
| VAT Reg No | `310876321800003` |

**أعمدة الجدول:**
```
Document No | Reference No. | Business Area | Assignment | Doc Date | Due Date | Amount | Curr
```

**أنواع المستندات** — اللاحقة في `Document No` (`RUH/<رقم>-XXX`):
- `-IBI` — فاتورة (inbound)
- `-OBI` — فاتورة (outbound)
- `-DOI` — فاتورة COD/توصيل (الأكبر قيمة عادةً، مثل `30,384.70`)
- `-DCF` — رسوم (COD fee?)
- أسطر خاصة بدون لاحقة:
  - `FRDM CHARGES` (رقم `26022#####`)
  - `APR_COD Online Fee` — رسوم COD أونلاين (Assignment = `APR_COD ONLINE F`)

**ملاحظات parsing:**
- **السالب يُكتب بأقواس**: `(8,288.70)` — مهم: يختلف عن سمسا (ناقص صريح).
- `Business Area` = `RUH` (الرياض).
- `Total Balance` (مثال: `42,130.92 SAR`) + المبلغ بالكلمات.
- **جدول أعمار الدين (Aging)** في الأسفل:
  ```
  Curr. | To 30Days | 31 To 60Days | 61 To 90 Days | Over 90 Days
  SAR   | 207.00    | 41,923.92    | 0.00          | 0.00
  ```

---

## 3. الفروق الرئيسية (لأي parser مستقبلي)

| | سمسا SMSA | أرامكس Aramex |
|---|---|---|
| معرّف العميل | `RX####` نصّي | `########` رقمي |
| تنسيق التاريخ | `DD-MM-YYYY` (شرطات) | `DD.MM.YYYY` (نقاط) |
| السالب | `-298.00` صريح | `(8,288.70)` أقواس |
| نوع المستند | عمود `Doc Type` مستقل (`COD`/`CM`) | لاحقة في `Document No` (`-IBI`/`-OBI`/`-DOI`/`-DCF`) |
| جدول الأعمار | ❌ لا يوجد | ✅ في الأسفل |
| الرصيد | `Total Balance` | `Total Balance ... SAR` |

> **للتعرّف التلقائي (webhook/upload):** سمسا تُعرَف بـ `SMSA Express` + VAT
> `300057426910003`؛ أرامكس بـ `Aramex Saudi Limited` + بنية `RUH/####-XXX`.

---

## 4. حالة الـ parsers في النظام (2026-06-02)

| الناقل | parser | الحالة |
|---|---|---|
| سمسا SMSA | `src/engine/smsaStatementParser.js` (`parseSmsaStatement`) | ✅ **جديد** — مُتحقَّق على العيّنة: 13 عملية، DR/CR من عمود Balance، `SUM(dr-cr)=Total Balance=28,052.87` ✓ |
| أرامكس Aramex (صيغة DR/CR/Balance) | `aramexStatementParser.js` | ✅ موجود سابقاً |
| أرامكس Aramex (صيغة عمود Amount واحد + لاحقة `-IBI/-OBI/-DOI`) | — | ⚠️ القارئ السريع يلتقط **0 عملية** لهذه الصيغة → يسقط لـ AI (`parseStatementWithAI`). بناء parser مخصّص لها مهمة مستقبلية |

**التعرّف التلقائي:** `sniffStatementCarrier(arrayBuffer)` في `smsaStatementParser.js`
يقرأ نص الصفحة الأولى ويُرجِع `'smsa'`/`'aramex'`/`null`. `CarrierStatements.jsx`
يوجّه للـ parser المطابق حتى لو اختار المستخدم ناقلاً خاطئاً في القائمة.

**ملاحظة DR/CR لسمسا:** المفتاح هو عمود **Balance** (المتبقّي بعد Amount Applied)
وليس Amount الإجمالي — لأن `Total Balance = SUM(Balance)`. هذا يجعل الدفتر
يطابق ما تعتبره سمسا مفتوحاً، ويعطي إشارة diff شهرية صحيحة (قيد رصيده ينزل
لصفر = تمّت تسويته).

# AGENTS.md — ShipAudit Pro

هذا الملف هو نقطة البدء الإلزامية لأي جلسة Codex. وهو دليل عمل، لا سجل تغييرات. الحقائق المفصلة موجودة في `docs/` والعقد الأقرب إلى الكود هو المرجع عند التعارض.

## قبل أي تعديل

1. اقرأ هذا الملف كاملًا.
2. اقرأ الوثيقة المرتبطة بالمسار الذي ستعدله:
   - [بنية المنتج والتطبيق](docs/project-architecture.md)
   - [البيانات والتكاملات والأمان](docs/data-integrations-security.md)
   - [قواعد العمل والحواجز](docs/business-invariants.md)
   - [التطوير والاختبار والتشغيل](docs/development-operations.md)
3. افحص الكود الفعلي، وأقرب الاختبارات، وآخر migrations ذات الصلة. لا تعتمد على اسم ملف أو وثيقة قديمة وحدها.
4. إن لم تكن المعلومة مثبتة في الكود أو الاختبارات أو migration أو عقد موثق، اكتب `NEEDS_CONFIRMATION` ولا تخمّن.

## ترتيب مصادر الحقيقة

عند التعارض استخدم هذا الترتيب:

1. السلوك الحالي المثبت بالكود والاختبارات.
2. migrations والعقود التنفيذية في `src/lib/` و`supabase/functions/`.
3. الوثائق المتخصصة الحالية المشار إليها من هذا الملف.
4. الوثائق التاريخية وسجلات الإصدارات، وهي سياق وليست عقدًا تنفيذيًا.

لا يُثبت وجود Capability أو route أو عمود أن استخدامه مسموح؛ يجب أن تسمح به قواعد العمل والصلاحيات والحواجز أيضًا.

## لقطة المشروع

- تطبيق React 18 أحادي الصفحة، يبنيه Vite، ويستخدم Supabase للمصادقة والبيانات والتخزين وEdge Functions.
- الواجهة منظّمة في ثمانية مداخل رئيسية: الرئيسية، العملاء، المبيعات، الحملات، المالية، التشغيل، التقارير، الإدارة.
- التكاملات الأساسية تشمل Zoho Books وLamha Employee API وHatif/Voxa، إضافة إلى Hudhud وTahseel وDaftra ومصادر leads وwebhooks بحسب المسار.
- قاعدة البيانات تراكمية؛ مجلد migrations الحالي ليس مثبتًا أنه bootstrap كامل من قاعدة فارغة.
- مدير الحزم هو npm (`package-lock.json`). CI يستخدم Node 24. لا يوجد حاليًا `engines` أو `.nvmrc` يثبت نسخة محلية أخرى.

## قواعد ثابتة لـCodex

- اقرأ `AGENTS.md` والوثائق ذات الصلة قبل التعديل.
- لا تخمّن؛ علّم أي معلومة غير مثبتة بـ `NEEDS_CONFIRMATION`.
- لا تعرض أو تعدّل أو ترفع الأسرار. اذكر أسماء متغيرات البيئة فقط.
- لا تعمل deploy ولا تغيّر Production إلا بطلب صريح من المستخدم.
- لا تنفذ migrations مدمرة أو تغييرات بيانات إنتاجية دون موافقة صريحة.
- لا تستخدم force push أو rebase أو reset مدمر.
- حافظ على السلوك الحالي ما لم تتطلب المهمة تغييره صراحةً.
- قبل التعديل افهم المسار المتأثر ومصادر الحقيقة والاختبارات المرتبطة به.
- لا تعتبر إخفاء عنصر في الواجهة حاجز صلاحية؛ طبّق الحماية في قاعدة البيانات/Edge Function أيضًا.
- لا تستخدم `service_role` في الواجهة، ولا تسجل tokens أو headers أو payloads سرية.
- أي إرسال، إجراء حساب، قيد مالي، أو تغيير حالة خارجي يحتاج تفويضًا صريحًا وحواجز وتدقيقًا؛ preview/review لا يساوي execute.
- بعد أي تطوير شغّل الفحوص المناسبة و`git diff --check`، ثم راجع `git status` وdiff للتأكد من عدم وجود تغييرات جانبية.
- لا تعمل commit أو push أو deploy إلا إذا طلب المستخدم ذلك صراحةً.

### Financial & Production Safety

- أي رقم مالي يجب أن يُنسب إلى Source of Truth محدد ومثبت قبل استخدامه.
- لا تعِد حساب **Accounting Outstanding** من invoices إذا كان المصدر المعتمد للمسار هو Zoho/`customer_ar`.
- لا تخلط **Accounting Outstanding** و**Operational Collectible** و**Residual Balance** في الحساب أو العرض أو القرار.
- لا تستخدم tolerance أو rounding لإخفاء فروقات المطابقة ما لم توجد قاعدة عمل موثقة تسمح بذلك.
- لا تعدّل أرصدة Zoho أو الفواتير أو المدفوعات أو Credit Notes أو Opening Balances تلقائيًا.
- أي write action إلى Zoho أو Lamha أو Supabase Production أو أي نظام خارجي يحتاج طلبًا صريحًا من المستخدم.
- عمليات bulk actions والحملات والإيقاف والتحصيل يجب أن تمر Preview/Preflight قبل التنفيذ.
- لا تعتبر UI permissions حاجزًا أمنيًا؛ تحقق من RLS وbackend authorization للعملية نفسها.
- لا تنفذ migrations أو destructive SQL أو backfills أو data repair على Production دون موافقة صريحة.
- لا تعرض secrets أو tokens أو بيانات حساسة في logs أو التقارير.
- عند تعارض documentation أو الكود أو migration أو البيانات الحية، لا تخمّن ولا تنفذ كتابة؛ أوقف التنفيذ وحدد التعارض بوضوح.

### Regression Protection

- قبل تعديل أي business invariant، حدد الاختبارات التي تجمّد السلوك الحالي واقرأها.
- لا تحدّث fingerprint أو baseline أو snapshot فقط لجعل الاختبار ينجح؛ أثبت أولًا أن التغيير المقصود صحيح.
- بعد التغييرات المهمة شغّل targeted tests ثم Full Suite متى كان ذلك عمليًا، ووثّق ما تعذر تشغيله.
- نجاح build وحده لا يثبت صحة السلوك المالي أو التشغيلي.

### UI/UX للأنظمة التشغيلية والمالية

- في مهام الواجهات، اعمل أولًا كـSenior Product Designer وDesign Systems Engineer متخصص في enterprise operations وfinancial dashboards، ثم كمبرمج. ابدأ بقرار المستخدم أو الإجراء المطلوب، وابنِ Information Hierarchy قبل JSX/CSS.
- قبل redesign كبير، حلّل الشاشة الحالية وuser task وhierarchy وdensity وlayout، وحدد ما سيبقى أو يندمج أو يُحذف قبل كتابة الكود.
- حافظ على كثافة مهنية؛ لا تحوّل كل KPI أو حالة إلى Card، ولا تستخدم مساحات أو cards ضخمة لمعلومة صغيرة، ولا تكرر المعلومة نفسها في Card وChart وTable بلا سبب. استخدم progressive disclosure للتفاصيل الثانوية.
- **No rainbow dashboards:** اجعل neutral surfaces أساس الواجهة، واستخدم اللون للحالة والمعنى فقط. لا تعتمد على اللون وحده للأرقام الموجبة/السالبة أو التحذير أو المطابقة؛ أضف label أو icon أو text.
- الجداول عنصر أساسي للمسح والمقارنة: رتّب أولوية الأعمدة، حاذِ الأرقام، ثبّت تنسيق العملات والتواريخ، واستخدم sticky headers عند الحاجة.
- اعرض لكل رقم مالي مهم label واضحًا ومصدره أو تعريفه عند احتمال الالتباس. ميّز بصريًا ودلاليًا بين **Accounting Outstanding** و**Operational Collectible** و**Residual Balance** حتى لا تبدو مفهومًا واحدًا.
- اعرض حالات **Matched / Mismatch / Needs Review / Blocked** نصيًا ودلاليًا لا باللون وحده، وأظهر source freshness وdata quality عندما يؤثران على القرار.
- قبل bulk action وضّح **Eligible / Ineligible / Requires Review**. اجعل Preview/Preflight ونتيجة التنفيذ مراحل مرئية ومفهومة.
- أعطِ الإجراءات الحساسة أو irreversible hierarchy وconfirmation مناسبين، ولا تجعل destructive action ينافس Primary Action.
- صمّم Desktop وMobile عمدًا؛ على Mobile أعد ترتيب الأولويات والإجراءات بدل ضغط الجدول كاملًا.
- صمّم حالات Loading وEmpty وError وPartial Data وStale Data وPermission Denied، مع سلوك واضح وقابل للوصول.
- التزم بالمكونات والـtokens الموجودة؛ لا تخترع Design System جديدًا لكل شاشة.
- بعد التنفيذ نفّذ Visual/UX Review مستقلة تشمل hierarchy وspacing وalignment وtypography وnumeric readability وdensity وcontrast وresponsive behavior وaccessibility وconsistency وحالات البيانات. نجاح build/tests لا يعني نجاح التصميم.
- في المهمات الكبيرة، إذا كانت Agents متاحة، استخدم Product Design reviewer مستقلًا قبل التنفيذ وUI/UX reviewer مستقلًا بعده.

## سير العمل الموصى به

1. حدّد الوحدة والمسار ومصدر الحقيقة والأنظمة الخارجية المتأثرة.
2. اقرأ الاختبارات الأقرب قبل تغيير العقد.
3. افحص migrations من الأحدث إلى الأقدم ولا تفترض أن schema المحلي يساوي Production.
4. نفّذ أصغر تغيير يحافظ على العقود الحالية.
5. شغّل الاختبارات المستهدفة، ثم المجموعة الأوسع المناسبة، ثم build و`git diff --check` بحسب نوع التغيير.
6. اذكر بوضوح ما لم تستطع التحقق منه أو ما يحتاج تحققًا حيًا.

## أوامر سريعة

```bash
npm ci
npm run build
node --test tests/<relevant-test>.test.mjs
node --test --test-reporter=spec tests/*.test.mjs
git diff --check
```

لا يوجد script أو إعداد lint مثبت حاليًا؛ لا تدّع نجاح lint. راجع [دليل التطوير والتشغيل](docs/development-operations.md) للتفاصيل وخط CI الفعلي.

## مناطق عالية الحساسية

- الحسابات المالية، الأرصدة، المطابقة البنكية، الإقفال، ومصادر الحقيقة المحاسبية.
- حالة حساب Lamha، الإيقاف/التشغيل، والمزامنة الكاملة للدليل.
- carrier audits، إثبات العقد، AWB/weight exports، وCOD التاريخي.
- RLS وgrants و`SECURITY DEFINER` وEdge Functions التي تستخدم `service_role`.
- webhooks، الرسائل، المكالمات، الحملات، الأتمتة، وidempotency.
- migrations، storage policies، cron/Vault، وإعدادات النشر.
- `src/App.jsx` وآلية إبقاء الصفحات mounted، و`src/main.jsx` وترتيب CSS/تهيئة التوقيت.

أي تغيير في هذه المناطق يحتاج اختبارات عقد/أمان مناسبة ومراجعة الوثيقة المتخصصة قبل التنفيذ.

# التطوير والاختبار والتشغيل

## المتطلبات ومدير الحزم

- مدير الحزم: npm، مثبت بـ`package-lock.json` lockfileVersion 3.
- CI يستخدم Node.js 24.
- لا يوجد `engines` في `package.json` ولا `.nvmrc` أو `.node-version`: النسخة المحلية الرسمية خارج CI هي `NEEDS_CONFIRMATION`.
- بعض الاختبارات تفحص ملفات المصدر والعقود مباشرة ولا تحتاج اتصالًا خارجيًا؛ الاختبارات الحية، إن وجدت، يجب ألا تشغّل دون فهم آثارها.

## التثبيت والتشغيل المحلي

```bash
npm ci
npm run dev
```

`npm ci` هو الاختيار القابل لإعادة الإنتاج في CI والجلسات النظيفة. `npm run dev` يشغل Vite للتطوير فقط؛ لا يشغل Production.

## build وlint والاختبارات

```bash
npm run build
node --test tests/<relevant-test>.test.mjs
node --test --test-reporter=spec tests/*.test.mjs
npm run test:security
npm run test:security-current
git diff --check
```

- `npm run build` ينتج static bundle في `dist/`.
- لا يوجد حاليًا script باسم `lint` ولا dependency/configuration واضحة لأداة lint. نتيجة lint الصحيحة هي **غير متاح** حتى يضاف عقد lint صريح: `NEEDS_CONFIRMATION` لما يجب اعتماده مستقبلًا.
- شغّل targeted tests أولًا ثم full suite عندما يؤثر التغيير في عقد مشترك أو قبل تسليم تغيير واسع.
- آخر Full Suite تم التحقق منه على commit الموثق أعلى هذه الوثائق وتحت Node 24: 562 اختبارًا؛ 561 pass، 0 fail، 1 skipped. هذه baseline تاريخية وليست بديلًا لإعادة التشغيل بعد تغييرات تشغيلية.
- لا تحدّث snapshots أو fingerprint baselines لمجرد جعل الاختبار أخضر؛ أثبت سبب اختلاف العقد أولًا.

## الفحص قبل التسليم

```bash
git status --short
git diff --name-only
git diff --check
git diff
```

تحقق من:

- أن الملفات المعدلة تقع داخل النطاق المطلوب.
- عدم دخول `.env` أو tokens أو exports أو artifacts مولدة.
- عدم تغير migrations أو lockfile عرضًا.
- أن فشل اختبار أو skip مفسر، لا مخفي.
- أن الوثائق والعقود تغيرت إذا تغير السلوك المقصود.

## CI الحالي

الworkflow الوحيد الموجود هو `.github/workflows/product-quality-gate.yml`. يعمل على pull requests وpush إلى `main` والتشغيل اليدوي، ويستخدم Node 24 ثم:

1. `npm ci`
2. `git diff --check`
3. Full Node test suite
4. `npm run build`

لا يحتوي workflow الحالي على deploy. حماية الفروع أو required checks في مزود Git: `NEEDS_CONFIRMATION` لأنها ليست مثبتة داخل المستودع.

## البيئات والنشر

- الواجهة static SPA مبنية بـVite.
- `vercel.json` يعرّف rewrite إلى `index.html` ورؤوس أمان/CSP، ما يثبت أن Vercel target مدعوم.
- Supabase يوفر قاعدة البيانات والمصادقة والتخزين وEdge Functions.
- بعض Edge Functions تقيد CORS/redirects على origin الإنتاجي الحالي؛ افحصها عند إضافة بيئة جديدة.
- لا يوجد تعريف Infrastructure-as-Code كامل للبيئات، ولا `supabase/config.toml` محلي: إعداد local/staging الرسمي `NEEDS_CONFIRMATION`.
- علاقة فروع Git ببيئات Vercel/Supabase وسياسة promotion/rollback الفعلية: `NEEDS_CONFIRMATION`.

### ما لا يجوز فعله ضمن تطوير عادي

- لا تشغل `vercel deploy` أو `supabase functions deploy` أو `supabase db push` دون طلب نشر صريح.
- لا تربط CLI بمشروع آخر، ولا تغيّر secrets أو cron/Vault أو Production data ضمن مهمة كود عادية.
- لا تفترض أن `supabase/functions/DEPLOYED_BASELINE.md` هو الوضع الحي؛ الملف أقدم من وظائف موجودة حاليًا. قائمة الوظائف المنشورة وإصداراتها و`verify_jwt` الحالية: `NEEDS_CONFIRMATION`.
- عند نشر Edge Function مستقبلًا، تحقق صراحةً من `verify_jwt`; بعض webhooks/cron تحتاج عقدًا مختلفًا، والخيار الافتراضي قد يغيّر السلوك.

## migrations وإدارة البيانات

قبل إنشاء migration:

1. ابحث عن كل تعريف واستخدام للكائن في migrations والكود والاختبارات.
2. تحقق أن baseline المستهدف موجود في البيئة المقصودة.
3. صمّم forward migration وrollback/تعافي، وقيّم الأقفال والحجم.
4. أضف RLS/policies/grants واختبارات العزل مع الكائن.
5. لا تنفذ DDL مدمرًا أو backfill إنتاجيًا دون موافقة صريحة.

لا تعدّل migration مطبقة تاريخيًا لتغيير Production؛ أضف migration أمامية جديدة عندما تكون المهمة مخولة بذلك.

## Git والتسليم

- حافظ على worktree المستخدم؛ لا تمس تغييرات ليست لك.
- ممنوع force push و`reset --hard` وأي تنظيف مدمر.
- لا commit ولا push إلا بطلب صريح.
- عند طلب push: تحقق من الفرع، upstream، الملفات المتغيرة، الاختبارات، و`git diff --check` قبل commit.
- لا تُنشئ release أو tag أو deploy كنتيجة ضمنية للـpush.

## عناصر تحتاج تأكيدًا قبل التشغيل الحي

- تطابق migrations/schema بين المستودع وكل بيئة.
- القائمة الحية لـEdge Functions وإصداراتها و`verify_jwt`.
- إعدادات Vercel/Supabase، متغيرات كل بيئة، وسياسة promotion/rollback.
- سبب تتبع `supabase/.temp/` والسياسة المطلوبة له.
- أداة lint المراد اعتمادها.
- نسخة Node المحلية الرسمية إن كانت تختلف عن CI.
- حالة buckets والcron/Vault والwebhooks في كل بيئة.

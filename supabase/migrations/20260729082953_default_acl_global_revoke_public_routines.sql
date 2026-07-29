-- الجذر الحقيقي (مراجعة خارجية — محقّة وموثّقة):
-- محاولاتي السابقة استعملت `IN SCHEMA public`، و**PostgreSQL ينصّ صراحةً**
-- أن السحب المقيَّد بمخطط **لا يستطيع إزالة منح PUBLIC الافتراضي العالمي**
-- — فالسجلّ في `pg_default_acl` بدا نظيفاً بينما الدالة الجديدة تولد بـ`=X`،
-- وهو بالضبط ما رصدتُه بالاختبار ولم أفسّره فعالجتُه بطبقة أعقد
-- (event trigger). العلاج الصحيح سطر واحد **بلا `IN SCHEMA`**:
alter default privileges for role postgres
  revoke execute on routines from public;

-- ويبقى المنح الصريح داخل `public` للأدوار التي تحتاجه فعلاً
alter default privileges for role postgres in schema public
  grant execute on routines to authenticated, service_role;

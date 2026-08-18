-- التزاماً بقاعدة §1.49: أي مهمة كرون جديدة تُضاف لـ`cron_health` بإشارة أثر.
-- إشارة `hatif-contacts-audit` = آخر `last_seen` في `hatif_unknown_contacts`
-- (المهمة تكتبه لكل جهة تراها). المهمة يومية فالعتبة **يومان** — تسمح بتشغيلة
-- فائتة واحدة قبل الإنذار، فلا تصرخ من تأخّر ساعة.
do $$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='cron_health';

  d := replace(d,
    E'    union all select ''hatif-contacts-sync'', ''مزامنة جهات الاتصال'',\n           (select max(synced_at) from hatif_contact_sync), 480, ''آخر جهة اتصال مُزامَنة''',
    E'    union all select ''hatif-contacts-sync'', ''مزامنة جهات الاتصال'',\n           (select max(synced_at) from hatif_contact_sync), 480, ''آخر جهة اتصال مُزامَنة''\n    union all select ''hatif-contacts-audit'', ''تدقيق جهات هاتف (المجهولون)'',\n           (select max(last_seen) from hatif_unknown_contacts), 2880,\n           ''آخر مسح كامل لجهات هاتف — يملأ «فرص هاتف»''');

  execute d;
end $$;

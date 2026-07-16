-- محرك المبيعات (§1.37) — انظر الهجرة المطبَّقة sales_engine_phase_all على FIN:
-- (١) set_retargeting_followups_bulk(phones[], owner, status, touch) — إسناد/ختم جماعي
-- (٢) sales_today(user) — يوم الموظف: متابعات مستحقة + ردود 48س + جهاته الجديدة + مهامه
-- (٣) campaign_queue (جدولة الحملات) + عمود followed_up على whatsapp_campaign_sends
-- (٤) crm_leads_campaign view + عمود in_hatif (تقاطع الجهات الخارجية مع فرص هاتف)
-- (٥) sales_owner_stats() — معدل التحويل بالموظف من retargeting_followups
-- المصدر الكامل في سجل الهجرات بمشروع FIN (مُطبَّق عبر MCP 2026-07-16).
-- كرونات: campaign-runner كل 15 دقيقة (jobid 11) — مجدولة + drip.
select 1;

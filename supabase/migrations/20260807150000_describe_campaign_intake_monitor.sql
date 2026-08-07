update public.work_agents
set description = 'يراقب حداثة مزامنة زوهو وهاتف وبيانات المنصة، وجاهزية استقبال عملاء الحملات، وأخطاء Webhooks وتشغيلات زوهو والمهام المجدولة، ويسجل سبب أي تأخير دون تنفيذ إصلاح تلقائي.',
    sources = '["Zoho Books", "هاتف", "المنصة", "عملاء الحملات", "Webhooks", "Cron"]'::jsonb,
    updated_at = now()
where agent_key = 'integration_health';

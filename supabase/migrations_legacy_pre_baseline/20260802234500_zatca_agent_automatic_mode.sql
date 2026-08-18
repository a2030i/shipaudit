-- ZATCA invoices must be submitted before midnight. The approved scheduled
-- agent runs automatically at 23:45 Asia/Riyadh; approval is only required
-- for an ad-hoc manual run from the UI.
alter table public.work_agents
  drop constraint if exists work_agents_safety_level_check;

alter table public.work_agents
  add constraint work_agents_safety_level_check
  check (safety_level in ('monitor', 'limited', 'approval', 'sensitive', 'automatic'));

update public.work_agents
set safety_level = 'automatic',
    cadence_label = 'يوميًا، 11:45 م بتوقيت السعودية',
    description = 'يفحص الحالة الحية في Zoho ويرسل تلقائيًا عند 11:45 م الفواتير غير المرسلة إلى زاتكا، دون انتظار موافقة، مع منع التكرار وسجل مستقل لكل فاتورة.',
    config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
      'hour', 23,
      'minute', 45,
      'scheduled_execution', 'automatic',
      'exclude_opening_balances', true,
      'show_opening_balances_in_preview', false,
      'live_check_before_push', true
    ),
    updated_at = now()
where agent_key = 'zatca_nightly';

select cron.alter_job(
  (select jobid from cron.job where jobname = 'zatca-auto-push-2345-riyadh'),
  schedule => '45 20 * * *',
  active => true
);

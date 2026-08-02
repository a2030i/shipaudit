import { supabase } from './supabase.js';

export async function loadWorkAgents() {
  const { data, error } = await supabase
    .from('work_agents')
    .select('id, agent_key, name, description, category, status, cadence_label, cron_expression, timezone, safety_level, sources, config, last_run_at, next_run_at, created_at, updated_at')
    .order('status', { ascending: true }).order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function configureOverdueSadadAgent(values) {
  const { data, error } = await supabase.rpc('configure_overdue_sadad_agent', {
    p_enabled: !!values.enabled,
    p_day_of_week: Number(values.dayOfWeek),
    p_hour: Number(values.hour),
    p_minute: Number(values.minute),
    p_min_days: Number(values.minDays),
    p_min_balance: Number(values.minBalance),
    p_max_recipients: Number(values.maxRecipients),
  });
  if (error) throw error;
  return data;
}

export async function previewOverdueSadadAgent() {
  const { data, error } = await supabase.functions.invoke('work-agent-overdue-sadad', { body: { action: 'preview' } });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error || 'تعذرت معاينة المستحقين');
  return data;
}

export async function runOverdueSadadAgent() {
  const { data, error } = await supabase.functions.invoke('work-agent-overdue-sadad', { body: { action: 'run', trigger: 'manual' } });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error || 'تعذر تشغيل الوكيل');
  return data;
}

export async function configureZatcaWorkAgent(values) {
  const { data, error } = await supabase.rpc('configure_zatca_work_agent', {
    p_enabled: !!values.enabled, p_hour: Number(values.hour), p_minute: Number(values.minute),
    p_max_invoices: Number(values.maxInvoices),
  });
  if (error) throw error;
  return data;
}

export async function previewZatcaWorkAgent() {
  const { data, error } = await supabase.functions.invoke('zatca-auto-push', { body: { action: 'preview' } });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error || 'تعذرت معاينة فواتير زاتكا');
  return data;
}

export async function runZatcaWorkAgent() {
  const { data, error } = await supabase.functions.invoke('zatca-auto-push', { body: { action: 'run', trigger: 'manual_agent' } });
  if (error) throw error;
  if (data?.ok === false || data?.error) throw new Error(data?.error || 'تعذر تشغيل وكيل زاتكا');
  return data;
}

export async function configureManagementReportAgent(values) {
  const { data, error } = await supabase.rpc('configure_management_report_agent', { p_enabled:!!values.enabled,p_hour:Number(values.hour),p_minute:Number(values.minute) });
  if (error) throw error; return data;
}
export async function previewManagementReportAgent() {
  const { data, error } = await supabase.functions.invoke('work-agent-management-report',{body:{action:'preview'}});
  if (error) throw error; if(!data?.ok) throw new Error(data?.error||'تعذرت معاينة تقرير الإدارة'); return data;
}
export async function runManagementReportAgent() {
  const { data, error } = await supabase.functions.invoke('work-agent-management-report',{body:{action:'run',trigger:'manual'}});
  if (error) throw error; if(!data?.ok) throw new Error(data?.error||'تعذر إنشاء تقرير الإدارة'); return data;
}
export async function configureIntegrationHealthAgent(v){const{data,error}=await supabase.rpc('configure_integration_health_agent',{p_enabled:!!v.enabled,p_interval_minutes:Number(v.intervalMinutes),p_zoho_minutes:Number(v.zohoMinutes),p_hatif_minutes:Number(v.hatifMinutes),p_platform_hours:Number(v.platformHours)});if(error)throw error;return data;}
export async function previewIntegrationHealthAgent(){const{data,error}=await supabase.functions.invoke('work-agent-integration-health',{body:{action:'preview'}});if(error)throw error;if(!data?.ok)throw new Error(data?.error||'تعذر فحص التكاملات');return data;}
export async function runIntegrationHealthAgent(){const{data,error}=await supabase.functions.invoke('work-agent-integration-health',{body:{action:'run',trigger:'manual'}});if(error)throw error;if(!data?.ok)throw new Error(data?.error||'تعذر تشغيل فحص التكاملات');return data;}

export async function loadRecentAgentRuns(limit = 12) {
  const { data, error } = await supabase
    .from('work_agent_runs')
    .select('id, agent_id, status, trigger_type, started_at, finished_at, checked_count, action_count, failed_count, summary')
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

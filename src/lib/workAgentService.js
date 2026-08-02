import { supabase } from './supabase.js';

export const WORK_AGENT_BLUEPRINTS = [
  { key: 'new_leads', name: 'وكيل العملاء الجدد', cadence: 'كل 5 دقائق', category: 'المبيعات', safety_level: 'limited', summary: 'يستقبل المهتمين، يمنع التكرار، يطابق المنصة ثم يوزعهم على الموظفين.', sources: ['Google Sheets', 'المنصة', 'هاتف'] },
  { key: 'zatca_nightly', name: 'وكيل زاتكا الليلي', cadence: 'يوميًا 11:45 م', category: 'المالية', safety_level: 'approval', summary: 'يفحص فواتير اليوم غير المرسلة ويجهز الإرسال من خلال Zoho.', sources: ['Zoho Books', 'زاتكا'] },
  { key: 'integration_health', name: 'وكيل صحة التكاملات', cadence: 'كل ساعة', category: 'الرقابة', safety_level: 'monitor', summary: 'يراقب Zoho وهاتف والمنصة والويب هوك وينبه عند توقف أي مصدر.', sources: ['Zoho Books', 'هاتف', 'المنصة', 'Webhooks'] },
  { key: 'daily_collections', name: 'وكيل التحصيل اليومي', cadence: 'يوميًا 9:00 ص', category: 'التحصيل', safety_level: 'approval', summary: 'يرتب الديون والوعود المستحقة ويقترح قائمة اتصال لكل موظف.', sources: ['Zoho Books', 'هاتف', 'ملف العميل'] },
  { key: 'bank_reconciliation', name: 'وكيل المطابقة البنكية', cadence: 'عند وصول كشف', category: 'البنوك', safety_level: 'approval', summary: 'يستبعد المراجع المكررة ويقترح تصنيف ومطابقة العمليات الجديدة.', sources: ['البنوك', 'Zoho Books'] },
  { key: 'weekly_team', name: 'وكيل تقرير الفريق', cadence: 'أسبوعيًا', category: 'الإدارة', safety_level: 'monitor', summary: 'يلخص التوزيع وزمن أول تواصل والمتابعات المتأخرة وأداء كل فريق.', sources: ['هاتف', 'المبيعات', 'سجل النشاط'] },
  { key: 'monthly_close', name: 'وكيل الإقفال الشهري', cadence: 'نهاية كل شهر', category: 'المالية', safety_level: 'approval', summary: 'يجمع فحوص الإقفال ويمنع اعتماده قبل معالجة الفروقات.', sources: ['Zoho Books', 'البنوك', 'الناقلون', 'زاتكا'] },
];

export async function loadWorkAgents() {
  const { data, error } = await supabase
    .from('work_agents')
    .select('id, agent_key, name, description, category, status, cadence_label, safety_level, sources, last_run_at, next_run_at, created_at, updated_at')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function loadRecentAgentRuns(limit = 12) {
  const { data, error } = await supabase
    .from('work_agent_runs')
    .select('id, agent_id, status, trigger_type, started_at, finished_at, checked_count, action_count, failed_count, summary')
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

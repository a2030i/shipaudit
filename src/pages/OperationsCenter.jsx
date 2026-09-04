import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Activity, AlertTriangle, Bot, CheckCircle2, Clock3, Database,
  ExternalLink, FileInput, Landmark, Link2,
  MessageCircle, PhoneCall, RefreshCw, RotateCcw,
  ShieldCheck, SlidersHorizontal, UploadCloud, Webhook, Workflow, XCircle,
} from 'lucide-react';
import {
  Alert, Button as Btn, DataTable, FilterBar, PageHeader, SelectInput,
  StatStrip, StatusBadge, LoadingState,
} from '../design-system/EnterpriseUI.jsx';
import AdminWorkspaceNav from '../components/enterprise/AdminWorkspaceNav.jsx';
import { useAuth } from '../lib/auth.jsx';
import { loadZohoWebhookHealth } from '../lib/pnlService.js';
import { loadLamhaDirectorySyncState, loadUploadsOverview } from '../lib/uploadsHubService.js';
import { loadHatifCallSyncHealth, loadWhatsAppDeliveryHealth } from '../lib/whatsappService.js';
import { loadWebhookEvents, countWebhookStatuses } from '../lib/webhookService.js';
import { loadCronHealth } from '../lib/integrityService.js';
import { loadRecentAgentRuns, loadWorkAgents } from '../lib/workAgentService.js';
import { probeTahseelConnection } from '../lib/tahseelService.js';

const HOUR = 60 * 60 * 1000;

const currentRiyadhPeriod = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  return `${year}-${month}`;
};

const safeDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const relativeTime = (value) => {
  const date = safeDate(value);
  if (!date) return 'لا يوجد أثر مسجل';
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 2) return 'الآن';
  if (minutes < 60) return `قبل ${minutes} دقيقة`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `قبل ${hours} ساعة`;
  const days = Math.round(hours / 24);
  return `قبل ${days} يوم`;
};

const statusMeta = {
  healthy: { label: 'سليم', icon: CheckCircle2 },
  attention: { label: 'يحتاج متابعة', icon: AlertTriangle },
  unavailable: { label: 'غير متاح', icon: XCircle },
};

const eventSourceMeta = {
  zoho: { label: 'زوهو', icon: Database },
  lamha: { label: 'لمحة', icon: FileInput },
  hatif: { label: 'هاتف وواتساب', icon: MessageCircle },
  webhooks: { label: 'وارد الشحن', icon: Webhook },
  agents: { label: 'وكلاء العمل', icon: Bot },
  schedules: { label: 'المهام المجدولة', icon: Clock3 },
};

const eventStatusOptions = [
  { id: 'all', label: 'الكل' },
  { id: 'attention', label: 'تحتاج إجراء' },
  { id: 'success', label: 'مكتملة' },
];

export default function OperationsCenter({ isActive = true, embedded = false }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { can, canAny, isAdmin } = useAuth();
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(false);
  const [eventStatus, setEventStatus] = useState(() => eventStatusOptions.some(option => option.id === searchParams.get('status')) ? searchParams.get('status') : 'all');
  const [eventSource, setEventSource] = useState(() => Object.hasOwn(eventSourceMeta, searchParams.get('source')) ? searchParams.get('source') : 'all');
  const period = useMemo(currentRiyadhPeriod, []);

  useEffect(() => {
    const nextStatus = searchParams.get('status');
    const nextSource = searchParams.get('source');
    setEventStatus(eventStatusOptions.some(option => option.id === nextStatus) ? nextStatus : 'all');
    setEventSource(Object.hasOwn(eventSourceMeta, nextSource) ? nextSource : 'all');
  }, [searchParams]);

  const updateEventFilter = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (!value || value === 'all') next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  };

  const allowed = useCallback((permission) => isAdmin || can(permission), [can, isAdmin]);

  const load = useCallback(async () => {
    setLoading(true);
    const tasks = {
      zoho: allowed('zoho.view') ? loadZohoWebhookHealth() : Promise.resolve(null),
      lamha: allowed('uploads.view') ? loadUploadsOverview() : Promise.resolve([]),
      lamhaDirectory: allowed('uploads.view') ? loadLamhaDirectorySyncState() : Promise.resolve(null),
      hatifDelivery: allowed('whatsapp.view_log') ? loadWhatsAppDeliveryHealth() : Promise.resolve(null),
      hatifSync: allowed('whatsapp.view_log') ? loadHatifCallSyncHealth() : Promise.resolve(null),
      webhooks: allowed('webhook.view') ? loadWebhookEvents({ limit: 200 }) : Promise.resolve([]),
      crons: allowed('system.view_audit_log') ? loadCronHealth() : Promise.resolve([]),
      agents: allowed('agents.view') ? loadWorkAgents() : Promise.resolve([]),
      runs: allowed('agents.view') ? loadRecentAgentRuns(16) : Promise.resolve([]),
      tahseel: allowed('system.view_settings') ? probeTahseelConnection() : Promise.resolve(null),
    };
    const keys = Object.keys(tasks);
    const results = await Promise.allSettled(Object.values(tasks));
    const next = { errors: [] };
    results.forEach((result, index) => {
      const key = keys[index];
      if (result.status === 'fulfilled') next[key] = result.value;
      else {
        next[key] = null;
        next.errors.push({ key, message: result.reason?.message || 'تعذّر تحميل المصدر' });
      }
    });
    setState(next);
    setLoading(false);
  }, [allowed]);

  useEffect(() => { if (isActive) load(); }, [isActive, load]);

  const model = useMemo(() => {
    if (!state) return null;
    const cards = [];
    const actions = [];
    const gateways = [];

    if (allowed('zoho.view')) {
      gateways.push({
        key: 'zoho-gateway', title: 'Zoho Books', icon: Database, tone: 'blue', mode: 'مزامنة وقراءة',
        description: 'الفواتير والعملاء وزاتكا والحسابات البنكية من مصدرها المحاسبي.',
        actions: [
          { label: 'مزامنة زوهو', path: '/zoho-data?tab=overview' },
          { label: 'البنوك والمطابقة', path: '/zoho-data?tab=banks' },
        ],
        note: 'المزامنة تحدّث النسخة المحلية؛ لا تُنشئ فاتورة أو دفعة من تلقاء نفسها.',
      });
    }

    if (allowed('uploads.view')) {
      gateways.push({
        key: 'lamha-gateway', title: 'منصة لمحة', icon: UploadCloud, tone: 'green', mode: 'مزامنة آلية',
        description: 'دليل المتاجر وكشف الحساب يتزامنان يوميًا؛ ملفات الشحنات فقط تبقى ضمن دورة الشهر.',
        actions: [
          { label: 'حالة مزامنة لمحة', path: `/accounting-cycle?period=${period}&stage=lamha_sources` },
          { label: 'رفع شحنات لمحة', path: `/accounting-cycle?period=${period}&stage=lamha_shipments` },
        ],
        note: `الفترة التشغيلية الحالية ${period}، ويمكن تغييرها من رأس دورة المحاسب.`,
      });
    }

    if (allowed('whatsapp.view_log') || allowed('whatsapp.configure') || allowed('campaigns.ivr')) {
      const communicationActions = [];
      if (allowed('campaigns.ivr') || allowed('whatsapp.configure')) {
        communicationActions.push({ label: 'حملات IVR', path: '/whatsapp-settings?tab=ivr' });
      }
      if (allowed('whatsapp.configure')) {
        communicationActions.push({ label: 'إعدادات هاتف', path: '/settings/hatif' });
      }
      if (!communicationActions.length) {
        communicationActions.push({ label: 'مركز الحملات', path: '/campaigns' });
      }
      gateways.push({
        key: 'hatif-gateway', title: 'هاتف وIVR', icon: PhoneCall, tone: 'purple', mode: 'قنوات وحملات',
        description: 'إدارة حملات الاتصال الآلي، القوالب، القنوات، وقراءة نتائج التواصل.',
        actions: communicationActions.slice(0, 2),
        note: 'تظهر إجراءات الإعداد أو التشغيل حسب صلاحيات الموظف الفعلية.',
      });
    }

    if (allowed('system.view_settings')) {
      gateways.push({
        key: 'tahseel-gateway', title: 'منصة تحصيل', icon: Link2, tone: 'gold', mode: 'قراءة فقط',
        description: 'اختبر الاتصال واقرأ العملاء والفواتير للمقارنة دون إنشاء أو تعديل أي سجل.',
        actions: [
          { label: 'اختبار وربط تحصيل', path: '/settings/data#tahseel-integration' },
          { label: 'مراجعة بيانات التحصيل', path: '/customer-money' },
        ],
        note: 'الاتصال الحالي GET فقط، والمفاتيح محفوظة في أسرار الخادم.',
      });
    }

    if (allowed('zoho.view')) {
      const syncAt = state.zoho?.lastSyncAt;
      const syncAge = safeDate(syncAt) ? Date.now() - safeDate(syncAt).getTime() : Infinity;
      const healthy = Boolean(state.zoho?.webhookReady) && syncAge <= 2 * HOUR;
      cards.push({
        key: 'zoho', title: 'Zoho Books', subtitle: 'الفواتير والحسابات وزاتكا', icon: Database,
        status: state.zoho ? (healthy ? 'healthy' : 'attention') : 'unavailable', path: '/zoho-data', action: 'فتح زوهو',
        facts: [
          { label: 'المزامنة الدورية', value: relativeTime(syncAt), tone: syncAge > 2 * HOUR ? 'gold' : 'green' },
          { label: 'آخر Webhook', value: relativeTime(state.zoho?.webhookLastAt) },
          { label: 'الاستقبال الفوري', value: state.zoho?.webhookReady ? 'مفعّل' : 'غير مؤكد', tone: state.zoho?.webhookReady ? 'green' : 'red' },
        ],
        note: 'زوهو هو المرجع المحاسبي؛ لا تنشئ هذه الشاشة فواتير أو دفعات.',
      });
      if (!healthy) actions.push({ title: 'راجع مزامنة زوهو وصلاحيات Webhook', path: '/zoho-data', tone: 'red' });
    }

    if (allowed('uploads.view')) {
      const sources = state.lamha || [];
      const stale = sources.filter((source) => source.stale || !source.last);
      const directory = state.lamhaDirectory;
      const directoryNeedsAttention = !directory?.lastAt || directory.stale;
      cards.push({
        key: 'lamha', title: 'منصة لمحة', subtitle: 'دليل المتاجر وكشوف التشغيل', icon: FileInput,
        status: directoryNeedsAttention || stale.length ? 'attention' : 'healthy',
        path: '/uploads', action: 'فتح المصادر',
        facts: [
          { label: 'آخر مزامنة للدليل', value: relativeTime(directory?.lastAt), tone: directoryNeedsAttention ? 'gold' : 'green' },
          { label: 'الجدولة', value: '9:00 ص و6:00 م يوميًا' },
          { label: 'مصادر يدوية متأخرة', value: stale.length, tone: stale.length ? 'gold' : 'green' },
        ],
        note: 'دليل المتاجر يُسحب آليًا من لمحة؛ الملفات الإضافية تبقى منفصلة ولا تستبدل حالة الحساب.',
      });
      if (directoryNeedsAttention) actions.push({ title: 'راجع مزامنة دليل متاجر لمحة', path: '/uploads', tone: 'gold' });
      if (stale.length) actions.push({ title: `حدّث ${stale.length} من مصادر لمحة`, path: '/uploads', tone: 'gold' });
    }

    if (allowed('whatsapp.view_log')) {
      const syncAt = state.hatifSync?.synced_at;
      const syncAge = safeDate(syncAt) ? Date.now() - safeDate(syncAt).getTime() : Infinity;
      const delivery = state.hatifDelivery || {};
      const total = Number(delivery.total) || 0;
      const observed = Math.max(0, total - (Number(delivery.pending) || 0));
      const coverage = total ? Math.round((observed / total) * 100) : null;
      const failedMessages = Number(delivery.failed) || 0;
      const failureRate = total ? Math.round((failedMessages / total) * 100) : null;
      const healthy = syncAge <= 12 * HOUR && (failureRate == null || failureRate <= 10);
      cards.push({
        key: 'hatif', title: 'هاتف وواتساب', subtitle: 'المحادثات والمكالمات والحملات', icon: MessageCircle,
        status: syncAt || total ? (healthy ? 'healthy' : 'attention') : 'unavailable',
        path: '/campaigns', action: 'فتح مركز الحملات',
        facts: [
          { label: 'آخر سحب مكالمات', value: relativeTime(syncAt), tone: syncAge > 12 * HOUR ? 'gold' : 'green' },
          { label: 'تغطية حالات الرسائل', value: coverage == null ? 'لا توجد عينة' : `${coverage}%`, tone: coverage != null && coverage < 60 ? 'gold' : 'green' },
          { label: 'نسبة الفشل المسجلة', value: failureRate == null ? 'لا توجد عينة' : `${failureRate}%`, tone: failureRate != null && failureRate > 10 ? 'red' : 'green' },
        ],
        note: 'المحادثات تظل داخل هاتف؛ ShipAudit يراقب الحالة والأثر فقط.',
      });
      if (!healthy) actions.push({
        title: 'راجع ربط هاتف ونتائج التسليم',
        path: allowed('whatsapp.configure') ? '/settings/hatif' : '/campaigns',
        tone: 'gold',
      });
    }

    if (allowed('webhook.view')) {
      const counts = countWebhookStatuses(state.webhooks || []);
      const waiting = Number(counts.pending || 0) + Number(counts.awaiting_assignment || 0);
      const failed = Number(counts.failed) || 0;
      cards.push({
        key: 'webhooks', title: 'وارد شركات الشحن', subtitle: 'الملفات المستلمة عبر Webhooks', icon: Webhook,
        status: failed || waiting ? 'attention' : 'healthy', path: '/webhook', action: 'فتح صندوق الوارد',
        facts: [
          { label: 'بانتظار إجراء', value: waiting, tone: waiting ? 'gold' : 'green' },
          { label: 'تحت المعالجة', value: Number(counts.processing) || 0 },
          { label: 'فشل', value: failed, tone: failed ? 'red' : 'green' },
        ],
        note: 'الملف لا يُعد مكتملًا حتى يتحول إلى مراجعة أو تحصيل فعلي.',
      });
      if (failed || waiting) actions.push({ title: `عالج ${failed + waiting} ملفًا في صندوق الوارد`, path: '/webhook', tone: failed ? 'red' : 'gold' });
    }

    if (allowed('system.view_settings')) {
      const tahseelReady = Boolean(state.tahseel);
      cards.push({
        key: 'tahseel', title: 'منصة تحصيل', subtitle: 'العملاء والفواتير وروابط بوابة السداد', icon: Landmark,
        status: tahseelReady ? 'healthy' : 'unavailable', path: '/settings/data#tahseel-integration', action: 'فتح إعدادات تحصيل',
        facts: [
          { label: 'حالة الاتصال', value: tahseelReady ? 'متصل' : 'تعذّر التحقق', tone: tahseelReady ? 'green' : 'red' },
          { label: 'العملاء المتاحون', value: tahseelReady ? Number(state.tahseel?.count || 0).toLocaleString('en-US') : '—' },
          { label: 'نطاق الاتصال', value: 'قراءة فقط', tone: 'green' },
        ],
        note: 'ShipAudit لا ينشئ عميلاً أو فاتورة أو رابط دفع داخل تحصيل.',
      });
      if (!tahseelReady) actions.push({ title: 'راجع مفاتيح واتصال منصة تحصيل', path: '/settings/data#tahseel-integration', tone: 'red' });
    }

    const crons = state.crons || [];
    const agents = state.agents || [];
    const runs = state.runs || [];
    const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
    const lateCrons = crons.filter((cron) => !cron.healthy);
    const failedRuns = runs.filter((run) => Number(run.failed_count) > 0 || run.status === 'failed');
    if (lateCrons.length) actions.push({ title: `راجع ${lateCrons.length} مهمة مجدولة متأخرة`, path: '/integrity', tone: 'red' });
    if (failedRuns.length) actions.push({ title: `راجع ${failedRuns.length} تشغيلات وكلاء فاشلة`, path: '/work-agents', tone: 'red' });

    const events = [];
    if (allowed('zoho.view') && state.zoho) {
      if (state.zoho.lastSyncAt) events.push({
        id: 'zoho-sync', source: 'zoho', status: 'success', statusLabel: 'مزامنة مكتملة',
        title: 'اكتملت آخر مزامنة دورية لزوهو', detail: 'تحديث بيانات الفواتير والحسابات والحالات المحاسبية.',
        at: state.zoho.lastSyncAt, path: '/zoho-data',
      });
      if (state.zoho.webhookLastAt) events.push({
        id: 'zoho-webhook', source: 'zoho', status: state.zoho.webhookReady ? 'success' : 'attention',
        statusLabel: state.zoho.webhookReady ? 'استقبال سليم' : 'تحتاج مراجعة',
        title: 'آخر حدث فوري من Zoho Books', detail: state.zoho.webhookReady ? 'وصل الحدث وسُجل ضمن قناة الاستقبال الفوري.' : 'راجع إعدادات Webhook وصلاحيات الاتصال.',
        at: state.zoho.webhookLastAt, path: '/zoho-data',
      });
    }
    if (allowed('uploads.view')) {
      for (const source of state.lamha || []) {
        events.push({
          id: `lamha-${source.id}`, source: 'lamha', status: source.stale || !source.last ? 'attention' : 'success',
          statusLabel: source.stale || !source.last ? 'تحتاج تحديث' : 'ملف مستورد',
          title: source.last ? `تحديث ${source.label}` : `لم يُرفع ${source.label}`,
          detail: source.last ? `${source.last.fileName || 'آخر ملف محفوظ'} · ${Number(source.last.rowCount) || 0} صف` : 'لا يوجد ملف مسجل لهذا المصدر حتى الآن.',
          at: source.last?.lastAt, path: '/uploads',
        });
      }
    }
    if (allowed('whatsapp.view_log') && state.hatifSync?.synced_at) {
      const syncDate = safeDate(state.hatifSync.synced_at);
      const syncAge = syncDate ? Date.now() - syncDate.getTime() : Infinity;
      events.push({
        id: 'hatif-sync', source: 'hatif', status: syncAge <= 12 * HOUR ? 'success' : 'attention',
        statusLabel: syncAge <= 12 * HOUR ? 'مزامنة مكتملة' : 'متأخرة',
        title: 'آخر سحب لسجل المكالمات', detail: 'تحديث أثر التواصل وربطه بملفات العملاء المتاحة.',
        at: state.hatifSync.synced_at, path: '/campaigns',
      });
    }
    if (allowed('webhook.view')) {
      for (const event of (state.webhooks || []).slice(0, 16)) {
        const status = event.status === 'processed' ? 'success' : event.status === 'failed' ? 'attention' : 'attention';
        const labels = {
          processed: 'تمت المعالجة', failed: 'فشل', processing: 'قيد المعالجة',
          awaiting_assignment: 'يحتاج تحديد شركة', pending: 'ينتظر الإجراء',
        };
        events.push({
          id: `webhook-${event.id}`, source: 'webhooks', status, statusLabel: labels[event.status] || 'وصل حديثًا',
          title: event.file_name || event.subject || 'ملف وارد من شركة شحن',
          detail: event.error_message || event.sender || 'وصل عبر قناة الاستقبال الآلي.',
          at: event.processed_at || event.received_at || event.created_at, path: '/webhook',
        });
      }
    }
    if (allowed('agents.view')) {
      for (const run of runs) {
        const failed = Number(run.failed_count) > 0 || run.status === 'failed';
        const running = run.status === 'running';
        events.push({
          id: `agent-${run.id}`, source: 'agents', status: failed || running ? 'attention' : 'success',
          statusLabel: failed ? 'فشل جزئي أو كامل' : running ? 'يعمل الآن' : 'اكتمل',
          title: agentsById.get(run.agent_id)?.name || 'تشغيل وكيل عمل',
          detail: run.summary || `فحص ${Number(run.checked_count) || 0} · نفّذ ${Number(run.action_count) || 0}`,
          at: run.started_at, path: '/work-agents',
        });
      }
    }
    if (allowed('system.view_audit_log')) {
      for (const cron of crons) {
        events.push({
          id: `cron-${cron.job}`, source: 'schedules', status: cron.healthy ? 'success' : 'attention',
          statusLabel: cron.status || (cron.healthy ? 'سليمة' : 'تحتاج مراجعة'),
          title: cron.label, detail: cron.detail || `الجدولة: ${cron.schedule || 'غير محددة'}`,
          at: cron.lastEffect, path: '/integrity',
        });
      }
    }
    events.sort((a, b) => (safeDate(b.at)?.getTime() || 0) - (safeDate(a.at)?.getTime() || 0));

    const healthyCards = cards.filter((card) => card.status === 'healthy').length;
    return { cards, gateways, actions, crons, agents, runs, events, lateCrons, failedRuns, healthyCards };
  }, [allowed, period, state]);

  if (!model) return <LoadingState title="جارٍ تحميل حالة التكاملات…" description="تُقرأ المصادر المتاحة بالتوازي حسب صلاحيات الحساب."/>;

  const agentsById = new Map((model?.agents || []).map((agent) => [agent.id, agent]));
  const visibleRuns = model?.runs?.slice(0, 8) || [];
  const availableEventSources = Object.entries(eventSourceMeta).filter(([id]) => model.events.some((event) => event.source === id));
  const visibleEvents = model.events.filter((event) => (
    (eventStatus === 'all' || event.status === eventStatus)
    && (eventSource === 'all' || event.source === eventSource)
  )).slice(0, 24);

  const integrationColumns = [
    { key: 'title', label: 'التكامل', className: 'mobile-identity', render: item => <div><strong>{item.title}</strong><small>{item.subtitle}</small></div> },
    { key: 'status', label: 'الحالة', render: item => <StatusBadge tone={item.status === 'healthy' ? 'success' : item.status === 'attention' ? 'warning' : 'neutral'}>{statusMeta[item.status]?.label || 'غير معروف'}</StatusBadge> },
    { key: 'facts', label: 'آخر أثر وملخص الحالة', className: 'mobile-wide', render: item => <div className="admin-integration-facts">{item.facts.map(fact => <span key={fact.label}><small>{fact.label}</small><bdi>{fact.value}</bdi></span>)}</div> },
    { key: 'action', label: 'الإجراء المتاح', render: item => <Btn size="sm" onClick={() => navigate(item.path)}>{item.action}</Btn> },
  ];
  const gatewayColumns = [
    { key: 'title', label: 'البوابة', className: 'mobile-identity', render: item => <div><strong>{item.title}</strong><small>{item.description}</small></div> },
    { key: 'mode', label: 'نطاق العمل', render: item => <StatusBadge dot={false} tone="neutral">{item.mode}</StatusBadge> },
    { key: 'note', label: 'حاجز الأمان', className: 'mobile-wide', render: item => <small>{item.note}</small> },
    { key: 'action', label: 'الوصول', render: item => <div className="admin-row-actions">{item.actions.map(action => <Btn key={action.path} size="sm" onClick={() => navigate(action.path)}>{action.label}</Btn>)}</div> },
  ];
  const eventColumns = [
    { key: 'title', label: 'الحدث', className: 'mobile-identity', render: event => <div><strong>{event.title}</strong><small>{event.detail}</small></div> },
    { key: 'source', label: 'المصدر', render: event => eventSourceMeta[event.source]?.label || 'النظام' },
    { key: 'status', label: 'الحالة', render: event => <StatusBadge tone={event.status === 'success' ? 'success' : 'warning'}>{event.statusLabel}</StatusBadge> },
    { key: 'at', label: 'آخر أثر', render: event => <bdi>{relativeTime(event.at)}</bdi> },
  ];
  const cronColumns = [
    { key: 'label', label: 'المهمة المجدولة', className: 'mobile-identity', render: cron => <div><strong>{cron.label}</strong><small>{cron.detail}</small></div> },
    { key: 'status', label: 'الحالة', render: cron => <StatusBadge tone={cron.healthy ? 'success' : 'warning'}>{cron.status || (cron.healthy ? 'سليم' : 'يحتاج مراجعة')}</StatusBadge> },
    { key: 'schedule', label: 'الجدولة', render: cron => <bdi dir="ltr">{cron.schedule || '—'}</bdi> },
  ];
  const runColumns = [
    { key: 'agent', label: 'التشغيل', className: 'mobile-identity', render: run => <div><strong>{agentsById.get(run.agent_id)?.name || 'مهمة تشغيل'}</strong><small>{run.summary || 'لا يوجد ملخص'}</small></div> },
    { key: 'status', label: 'الحالة', render: run => <StatusBadge tone={Number(run.failed_count) > 0 || run.status === 'failed' ? 'danger' : run.status === 'running' ? 'warning' : 'success'}>{run.status || 'مكتمل'}</StatusBadge> },
    { key: 'counts', label: 'النتيجة', render: run => <bdi dir="ltr">{Number(run.checked_count) || 0} / {Number(run.action_count) || 0} / {Number(run.failed_count) || 0}</bdi> },
    { key: 'at', label: 'الوقت', render: run => <bdi>{relativeTime(run.started_at)}</bdi> },
  ];

  return (
    <div className={`operations-center admin-integrations-view${embedded ? ' is-embedded' : ''}`}>
      <PageHeader title="التكاملات" description="حالة الاتصال وآخر مزامنة وفشل مسجل، مع فصل القراءة عن إجراءات الربط والكتابة." actions={<Btn size="sm" variant="primary" icon={<RefreshCw size={14}/>} onClick={load} disabled={loading}>{loading ? 'جارٍ التحديث…' : 'تحديث الحالة'}</Btn>}/>
      {!embedded ? <AdminWorkspaceNav active="integrations"/> : null}

      <StatStrip items={[
        { label: 'التكاملات المتاحة', value: model.cards.length, note: 'حسب الصلاحيات' },
        { label: 'حالة سليمة', value: model.healthyCards, note: 'آخر أثر مسجل', tone: 'success' },
        { label: 'تحتاج إجراء', value: model.actions.length, note: 'Result Sets واضحة', tone: model.actions.length ? 'warning' : undefined },
        { label: 'مهام متأخرة', value: model.lateCrons.length, note: 'من جدولة النظام', tone: model.lateCrons.length ? 'danger' : undefined },
      ]}/>
      {state?.errors?.length > 0 ? <Alert tone="warning" title="مصادر غير متاحة">تعذّر تحديث {state.errors.length} مصدر. لم تُحوّل المصادر الغائبة إلى حالة سليمة.</Alert> : null}

      <section className="admin-data-section" aria-labelledby="operations-integrations-title">
        <header><div><h2 id="operations-integrations-title">حالة التكاملات</h2><p>الحالة، آخر نجاح أو فشل، ثم الإجراء المتاح لكل تكامل.</p></div></header>
        <DataTable caption="حالة التكاملات" columns={integrationColumns} rows={model.cards} getRowKey={item => item.key} onRowClick={item => navigate(item.path)} empty="لا توجد تكاملات متاحة لهذه الصلاحية"/>
      </section>

      {model.actions.length ? <section className="admin-data-section" aria-labelledby="operations-actions-title">
        <header><div><h2 id="operations-actions-title">يحتاج إجراء الآن</h2><p>الاستثناءات مرتبة كقائمة عمل، وليست مؤشرات مغلقة.</p></div></header>
        <DataTable caption="استثناءات التكاملات" columns={[
          { key: 'title', label: 'الاستثناء', className: 'mobile-identity', render: action => <strong>{action.title}</strong> },
          { key: 'tone', label: 'الأولوية', render: action => <StatusBadge tone={action.tone === 'red' ? 'danger' : 'warning'}>{action.tone === 'red' ? 'عالية' : 'مراجعة'}</StatusBadge> },
          { key: 'action', label: 'الوصول', render: action => <Btn size="sm" onClick={() => navigate(action.path)}>فتح التفاصيل</Btn> },
        ]} rows={model.actions} getRowKey={(action, index) => `${action.path}-${index}`} onRowClick={action => navigate(action.path)}/>
      </section> : null}

      <section className="admin-data-section" aria-labelledby="operations-gateways-title">
        <header><div><h2 id="operations-gateways-title">إجراءات التكامل</h2><p>القراءة والتحديث والربط والكتابة تبقى مسارات منفصلة بصلاحياتها الحالية.</p></div></header>
        <DataTable caption="إجراءات التكامل" columns={gatewayColumns} rows={model.gateways} getRowKey={item => item.key} empty="لا توجد بوابات تشغيل متاحة"/>
      </section>

      <section className="admin-data-section" aria-labelledby="operations-activity-title">
        <header><div><h2 id="operations-activity-title">آخر ما حدث في النظام</h2><p>فتح الصف ينقل إلى مصدر الحدث مع بقاء الفلاتر في الرابط.</p></div></header>
        <FilterBar>
          <SelectInput aria-label="تصفية أحداث التكاملات حسب الحالة" value={eventStatus} onChange={event => updateEventFilter('status', event.target.value)}>{eventStatusOptions.map(option => <option value={option.id} key={option.id}>{option.label}</option>)}</SelectInput>
          <SelectInput aria-label="تصفية أحداث التكاملات حسب المصدر" value={eventSource} onChange={event => updateEventFilter('source', event.target.value)}><option value="all">كل المصادر</option>{availableEventSources.map(([id, meta]) => <option key={id} value={id}>{meta.label}</option>)}</SelectInput>
        </FilterBar>
        <DataTable caption="أحداث التكاملات" columns={eventColumns} rows={visibleEvents} getRowKey={event => event.id} onRowClick={event => navigate(event.path)} empty="لا توجد أحداث مطابقة للفلاتر"/>
      </section>

      <section className="admin-runtime-grid" aria-label="الجدولة والوكلاء">
        <div className="admin-data-section"><header><div><h2>المهام المجدولة</h2><p>الحالة الحالية كما يعيدها فحص الجدولة.</p></div>{allowed('system.view_audit_log') ? <Btn size="sm" onClick={() => navigate('/integrity')}>تفاصيل السلامة</Btn> : null}</header><DataTable caption="المهام المجدولة" columns={cronColumns} rows={model.crons.slice(0, 8)} getRowKey={cron => cron.job} empty="لا توجد بيانات جدولة متاحة"/></div>
        <div className="admin-data-section"><header><div><h2>آخر تشغيلات الوكلاء</h2><p>الفحص والإجراء والفشل دون منح صلاحية تشغيل.</p></div>{canAny(['agents.view']) ? <Btn size="sm" onClick={() => navigate('/work-agents')}>إدارة الوكلاء</Btn> : null}</header><DataTable caption="آخر تشغيلات الوكلاء" columns={runColumns} rows={visibleRuns} getRowKey={run => run.id} empty="لا توجد تشغيلات مسجلة"/></div>
      </section>
    </div>
  );
}

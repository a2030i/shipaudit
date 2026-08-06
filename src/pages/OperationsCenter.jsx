import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity, AlertTriangle, Bot, CheckCircle2, Clock3, Database,
  ExternalLink, FileInput, MessageCircle, RefreshCw, RotateCcw,
  ShieldCheck, SlidersHorizontal, Webhook, Workflow, XCircle,
} from 'lucide-react';
import { Btn, Card, PageHeader, Spinner } from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import { loadZohoWebhookHealth } from '../lib/pnlService.js';
import { loadUploadsOverview } from '../lib/uploadsHubService.js';
import { loadHatifCallSyncHealth, loadWhatsAppDeliveryHealth } from '../lib/whatsappService.js';
import { loadWebhookEvents, countWebhookStatuses } from '../lib/webhookService.js';
import { loadCronHealth } from '../lib/integrityService.js';
import { loadRecentAgentRuns, loadWorkAgents } from '../lib/workAgentService.js';
import './OperationsCenter.css';

const HOUR = 60 * 60 * 1000;

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

function IntegrationCard({ item, onOpen }) {
  const meta = statusMeta[item.status] || statusMeta.unavailable;
  const StatusIcon = meta.icon;
  const Icon = item.icon;
  return (
    <Card className={`operations-integration-card is-${item.status}`}>
      <div className="operations-integration-card__head">
        <span className="operations-integration-card__icon"><Icon size={20}/></span>
        <div>
          <h3>{item.title}</h3>
          <p>{item.subtitle}</p>
        </div>
        <span className={`operations-status is-${item.status}`}>
          <StatusIcon size={13}/>{meta.label}
        </span>
      </div>
      <div className="operations-integration-card__facts">
        {item.facts.map((fact) => (
          <div key={fact.label}>
            <span>{fact.label}</span>
            <strong className={fact.tone ? `tone-${fact.tone}` : ''}>{fact.value}</strong>
          </div>
        ))}
      </div>
      <div className="operations-integration-card__foot">
        <span>{item.note}</span>
        <Btn size="sm" variant="ghost" onClick={() => onOpen(item.path)}>
          {item.action} <ExternalLink size={13}/>
        </Btn>
      </div>
    </Card>
  );
}

function RunRow({ run, agentsById }) {
  const failed = Number(run.failed_count) || 0;
  const status = failed > 0 || run.status === 'failed' ? 'failed' : run.status === 'running' ? 'running' : 'success';
  const name = agentsById.get(run.agent_id)?.name || 'مهمة تشغيل';
  return (
    <div className="operations-run-row">
      <span className={`operations-run-dot is-${status}`}/>
      <div className="operations-run-row__main">
        <strong>{name}</strong>
        <span>{run.summary || (status === 'success' ? 'اكتمل التشغيل بلا ملاحظات' : 'راجع نتيجة التشغيل')}</span>
      </div>
      <div className="operations-run-row__numbers">
        <span>فحص {Number(run.checked_count) || 0}</span>
        <span>إجراء {Number(run.action_count) || 0}</span>
        {failed > 0 && <span className="tone-red">فشل {failed}</span>}
      </div>
      <time>{relativeTime(run.started_at)}</time>
    </div>
  );
}

function ActivityRow({ event, onOpen }) {
  const source = eventSourceMeta[event.source] || eventSourceMeta.schedules;
  const SourceIcon = source.icon;
  return (
    <button className={`operations-activity-row is-${event.status}`} onClick={() => onOpen(event.path)}>
      <span className="operations-activity-row__icon"><SourceIcon size={16}/></span>
      <span className="operations-activity-row__body">
        <span className="operations-activity-row__source">{source.label}</span>
        <strong>{event.title}</strong>
        <small>{event.detail}</small>
      </span>
      <span className="operations-activity-row__meta">
        <span className={`operations-event-status is-${event.status}`}>{event.statusLabel}</span>
        <time>{relativeTime(event.at)}</time>
      </span>
      <ExternalLink size={14}/>
    </button>
  );
}

export default function OperationsCenter({ isActive = true }) {
  const navigate = useNavigate();
  const { can, canAny, isAdmin } = useAuth();
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(false);
  const [eventStatus, setEventStatus] = useState('all');
  const [eventSource, setEventSource] = useState('all');

  const allowed = useCallback((permission) => isAdmin || can(permission), [can, isAdmin]);

  const load = useCallback(async () => {
    setLoading(true);
    const tasks = {
      zoho: allowed('zoho.view') ? loadZohoWebhookHealth() : Promise.resolve(null),
      lamha: allowed('uploads.view') ? loadUploadsOverview() : Promise.resolve([]),
      hatifDelivery: allowed('whatsapp.view_log') ? loadWhatsAppDeliveryHealth() : Promise.resolve(null),
      hatifSync: allowed('whatsapp.view_log') ? loadHatifCallSyncHealth() : Promise.resolve(null),
      webhooks: allowed('webhook.view') ? loadWebhookEvents({ limit: 200 }) : Promise.resolve([]),
      crons: allowed('system.view_audit_log') ? loadCronHealth() : Promise.resolve([]),
      agents: allowed('agents.view') ? loadWorkAgents() : Promise.resolve([]),
      runs: allowed('agents.view') ? loadRecentAgentRuns(16) : Promise.resolve([]),
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
      const latest = sources.map((source) => source.last?.lastAt).filter(Boolean).sort().at(-1);
      cards.push({
        key: 'lamha', title: 'منصة لمحة', subtitle: 'دليل المتاجر وكشوف التشغيل', icon: FileInput,
        status: sources.length && stale.length === 0 ? 'healthy' : stale.length ? 'attention' : 'unavailable',
        path: '/uploads', action: 'فتح المصادر',
        facts: [
          { label: 'المصادر المتابعة', value: sources.length },
          { label: 'تحتاج تحديثًا', value: stale.length, tone: stale.length ? 'gold' : 'green' },
          { label: 'آخر ملف', value: relativeTime(latest) },
        ],
        note: 'الملفات اليدوية فقط؛ بيانات زوهو لا تُرفع كملفات Excel.',
      });
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
        path: '/whatsapp-settings', action: 'فتح مركز هاتف',
        facts: [
          { label: 'آخر سحب مكالمات', value: relativeTime(syncAt), tone: syncAge > 12 * HOUR ? 'gold' : 'green' },
          { label: 'تغطية حالات الرسائل', value: coverage == null ? 'لا توجد عينة' : `${coverage}%`, tone: coverage != null && coverage < 60 ? 'gold' : 'green' },
          { label: 'نسبة الفشل المسجلة', value: failureRate == null ? 'لا توجد عينة' : `${failureRate}%`, tone: failureRate != null && failureRate > 10 ? 'red' : 'green' },
        ],
        note: 'المحادثات تظل داخل هاتف؛ ShipAudit يراقب الحالة والأثر فقط.',
      });
      if (!healthy) actions.push({ title: 'راجع نبض هاتف ونتائج التسليم', path: '/whatsapp-settings', tone: 'gold' });
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
        at: state.hatifSync.synced_at, path: '/whatsapp-settings',
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
    return { cards, actions, crons, agents, runs, events, lateCrons, failedRuns, healthyCards };
  }, [allowed, state]);

  if (!model) return <div className="operations-loading"><Spinner size={28}/></div>;

  const agentsById = new Map((model?.agents || []).map((agent) => [agent.id, agent]));
  const visibleRuns = model?.runs?.slice(0, 8) || [];
  const availableEventSources = Object.entries(eventSourceMeta).filter(([id]) => model.events.some((event) => event.source === id));
  const visibleEvents = model.events.filter((event) => (
    (eventStatus === 'all' || event.status === eventStatus)
    && (eventSource === 'all' || event.source === eventSource)
  )).slice(0, 24);

  return (
    <div className="operations-center">
      <PageHeader
        icon={<Workflow size={22}/>}
        iconColor="var(--accent)"
        title="مركز التكاملات والتشغيل"
        subtitle="اعرف ما يعمل الآن، وما تأخر، وافتح الإجراء الصحيح دون البحث بين الصفحات"
        actions={<Btn size="sm" variant="primary" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spin' : ''}/> {loading ? 'جارٍ التحديث…' : 'تحديث الحالة الآن'}
        </Btn>}
      />

      {state?.errors?.length > 0 && (
        <div className="operations-source-error">
          <AlertTriangle size={17}/>
          <span>تعذّر تحديث {state.errors.length} مصدر. بقيت المصادر الأخرى ظاهرة ويمكن إعادة المحاولة.</span>
        </div>
      )}

      <section className={`operations-verdict ${model.actions.length ? 'is-attention' : 'is-healthy'}`}>
        <div className="operations-verdict__icon">
          {model.actions.length ? <AlertTriangle size={26}/> : <ShieldCheck size={26}/>}
        </div>
        <div className="operations-verdict__copy">
          <span>الحالة التشغيلية الآن</span>
          <h2>{model.actions.length ? `${model.actions.length} نقاط تحتاج تدخلك` : 'كل القنوات المتاحة تعمل دون تنبيه حالي'}</h2>
          <p>{model.healthyCards} من {model.cards.length} تكاملات متاحة حالتها سليمة حسب آخر أثر تشغيلي مسجل.</p>
        </div>
        <div className="operations-verdict__stats">
          <div><strong>{model.cards.length}</strong><span>تكاملات</span></div>
          <div><strong>{model.agents.filter((agent) => agent.status === 'active').length}</strong><span>وكلاء نشطون</span></div>
          <div><strong>{model.lateCrons.length}</strong><span>مهام متأخرة</span></div>
        </div>
      </section>

      {model.actions.length > 0 && (
        <section className="operations-actions" aria-labelledby="operations-actions-title">
          <div className="operations-section-title">
            <div><span>الأولوية</span><h2 id="operations-actions-title">يحتاج إجراء الآن</h2></div>
          </div>
          <div className="operations-actions__list">
            {model.actions.map((action, index) => (
              <button key={`${action.path}-${index}`} className={`is-${action.tone}`} onClick={() => navigate(action.path)}>
                <span>{index + 1}</span><strong>{action.title}</strong><ExternalLink size={15}/>
              </button>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="operations-integrations-title">
        <div className="operations-section-title">
          <div><span>المصادر</span><h2 id="operations-integrations-title">حالة التكاملات</h2></div>
          <p>تعتمد الحالة على آخر مزامنة أو حدث أو ملف وصل فعليًا، لا على وجود إعداد محفوظ فقط.</p>
        </div>
        <div className="operations-integrations-grid">
          {model.cards.map((item) => <IntegrationCard key={item.key} item={item} onOpen={navigate}/>) }
        </div>
      </section>

      <section className="operations-activity" aria-labelledby="operations-activity-title">
        <div className="operations-section-title">
          <div><span>سجل موحد</span><h2 id="operations-activity-title">آخر ما حدث في النظام</h2></div>
          <p>الأحداث مرتبة زمنيًا من كل مصدر متاح لك، والنقر على أي صف يفتح مكان معالجته.</p>
        </div>
        <Card className="operations-activity-panel">
          <div className="operations-activity-filters">
            <div className="operations-filter-group" aria-label="تصفية حسب الحالة">
              <SlidersHorizontal size={15}/>
              {eventStatusOptions.map((option) => (
                <button key={option.id} className={eventStatus === option.id ? 'is-active' : ''} onClick={() => setEventStatus(option.id)}>
                  {option.label}
                  <span>{option.id === 'all' ? model.events.length : model.events.filter((event) => event.status === option.id).length}</span>
                </button>
              ))}
            </div>
            <label className="operations-source-filter">
              <span>المصدر</span>
              <select value={eventSource} onChange={(event) => setEventSource(event.target.value)}>
                <option value="all">كل المصادر</option>
                {availableEventSources.map(([id, meta]) => <option key={id} value={id}>{meta.label}</option>)}
              </select>
            </label>
          </div>
          <div className="operations-activity-list">
            {visibleEvents.length ? visibleEvents.map((event) => <ActivityRow key={event.id} event={event} onOpen={navigate}/>) : (
              <div className="operations-empty-state">
                <CheckCircle2 size={24}/><strong>لا توجد أحداث مطابقة</strong><span>غيّر الحالة أو المصدر لعرض بقية السجل.</span>
              </div>
            )}
          </div>
          {visibleEvents.length > 0 && <div className="operations-activity-summary">يعرض {visibleEvents.length} من {model.events.length} حدثًا متاحًا حسب صلاحياتك.</div>}
        </Card>
      </section>

      <section className="operations-runtime" aria-labelledby="operations-runtime-title">
        <div className="operations-section-title">
          <div><span>الأتمتة</span><h2 id="operations-runtime-title">الجدولة والوكلاء</h2></div>
          <div className="operations-section-actions">
            {canAny(['agents.view']) && <Btn size="sm" variant="ghost" onClick={() => navigate('/work-agents')}><Bot size={13}/> إدارة الوكلاء</Btn>}
            {allowed('system.view_audit_log') && <Btn size="sm" variant="ghost" onClick={() => navigate('/integrity')}><Activity size={13}/> سلامة المهام</Btn>}
          </div>
        </div>

        <div className="operations-runtime-grid">
          <Card className="operations-runtime-panel">
            <div className="operations-runtime-panel__head"><Clock3 size={18}/><h3>المهام المجدولة</h3><span>{model.crons.length}</span></div>
            {model.crons.length === 0 ? <p className="operations-empty">لا توجد بيانات جدولة متاحة لهذه الصلاحية.</p> : (
              <div className="operations-cron-list">
                {model.crons.slice(0, 8).map((cron) => (
                  <div key={cron.job} className={cron.healthy ? 'is-healthy' : 'is-attention'}>
                    <span>{cron.healthy ? <CheckCircle2 size={15}/> : <AlertTriangle size={15}/>}</span>
                    <div><strong>{cron.label}</strong><small>{cron.detail}</small></div>
                    <time>{cron.schedule}</time>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="operations-runtime-panel">
            <div className="operations-runtime-panel__head"><RotateCcw size={18}/><h3>آخر التشغيلات</h3><span>{visibleRuns.length}</span></div>
            {visibleRuns.length === 0 ? <p className="operations-empty">لا توجد تشغيلات مسجلة لهذه الصلاحية.</p> : (
              <div className="operations-runs-list">
                {visibleRuns.map((run) => <RunRow key={run.id} run={run} agentsById={agentsById}/>) }
              </div>
            )}
          </Card>
        </div>
      </section>
    </div>
  );
}

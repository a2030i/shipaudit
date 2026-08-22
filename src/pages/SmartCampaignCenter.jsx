import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ClipboardList,
  Download,
  ExternalLink,
  FileDown,
  Megaphone,
  MessageCircle,
  MoreHorizontal,
  PhoneCall,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Target,
  UserRound,
  Users,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { Btn, Spinner, toast } from '../components/UI.jsx';
import WhatsAppSendModal from '../components/WhatsAppSendModal.jsx';
import IvrCampaignModal from '../components/IvrCampaignModal.jsx';
import { useAuth } from '../lib/auth.jsx';
import { persistAndDownloadExport } from '../lib/internalExportsService.js';
import {
  createSmartCampaignTasks,
  defaultAudienceDefinition,
  filterSmartAudience,
  loadSmartAudienceUniverse,
  loadSmartCampaignProtections,
  loadSmartCampaigns,
  saveSmartCampaign,
  SMART_CAMPAIGN_CHANNELS,
  SMART_CAMPAIGN_OBJECTIVES,
  updateSmartCampaignOutcome,
} from '../lib/smartCampaignService.js';
import { loadHatifUsers, loadOutreachImpact, loadWhatsAppCampaignReport } from '../lib/whatsappService.js';
import {
  prepareWhatsAppAudienceRows,
  summarizeWhatsAppAudience,
  whatsappAudienceExclusionBreakdown,
} from '../lib/whatsappAudience.js';
import './smart-campaign-center.css';
import { readAudienceHandoff } from '../lib/agingOperations.js';
import { campaignBucketLabel } from '../lib/customerCampaignBuckets.js';

const STEPS = ['الهدف', 'الجمهور', 'الحماية', 'القناة', 'المراجعة'];
const COLLECTION_BUCKETS = [
  ['inv1_15', '1–15 يوم'],
  ['inv16_30', '16–30 يوم'],
  ['inv31_60', '31–60 يوم'],
  ['inv61_90', '61–90 يوم'],
  ['inv90p', 'أكثر من 90 يوم'],
  ['opening', 'الرصيد الافتتاحي'],
];
const RETARGETING_SEGMENTS = [
  ['stopped_recent', 'توقّف حديثاً'],
  ['stopped_long', 'توقّف قديماً'],
];
const SALES_SEGMENTS = [
  ['new_active', 'جديد نشط'],
  ['topped_no_ship', 'شحن رصيد ولم يشحن'],
  ['linked_no_ship', 'ربط ولم يشحن'],
  ['registered_no_ship', 'سجّل ولم يشحن'],
  ['active', 'نشط قابل للنمو'],
];
const STATUS_META = {
  draft: ['مسودة', 'neutral'],
  review: ['تحت المراجعة', 'warning'],
  ready: ['جاهزة', 'blue'],
  scheduled: ['مجدولة', 'warning'],
  running: ['تعمل الآن', 'success'],
  completed: ['مكتملة', 'success'],
  needs_decision: ['تحتاج قراراً', 'danger'],
  cancelled: ['ملغاة', 'neutral'],
};

const fmt0 = value => Number(value || 0).toLocaleString('en-US');
const fmtMoney = value => Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const dateStamp = () => new Date().toLocaleDateString('en-CA');

function suggestedName(objective) {
  const base = {
    general: 'حملة عامة',
    collection: 'حملة سداد مركزة',
    reactivation: 'إعادة تنشيط المتوقفين',
    sales: 'فرص نمو العملاء',
    service: 'تنبيه خدمة العملاء',
  }[objective] || 'حملة ذكية';
  return `${base} — ${dateStamp()}`;
}

const manualRowsToText = rows => (rows || [])
  .map(row => [row.name || row['الاسم'] || '', row.phone || row.to || row.mobile || row['رقم الجوال'] || ''].filter(Boolean).join(','))
  .join('\n');

const parseManualAudienceText = text => String(text || '')
  .split(/\r?\n/)
  .map(line => line.trim())
  .filter(Boolean)
  .map(line => {
    const parts = line.split(/[\t,;،]/).map(value => value.trim()).filter(Boolean);
    if (parts.length === 1) return { phone: parts[0] };
    const phoneIndex = parts.findIndex(value => /(?:\+?966|00966|05|5)?\d{8,9}/.test(value.replace(/\D/g, '')));
    const phone = phoneIndex >= 0 ? parts[phoneIndex] : parts.at(-1);
    return { phone, name: parts.filter((_, index) => index !== phoneIndex).join(' ') };
  });

function ManualAudienceEditor({ definition, onChange }) {
  const currentRows = definition.manualRows || [];
  const [draft, setDraft] = useState(() => definition.manualText || manualRowsToText(currentRows));
  const [fileName, setFileName] = useState('');

  useEffect(() => {
    setDraft(definition.manualText || manualRowsToText(definition.manualRows || []));
  }, [definition.manualText, definition.manualRows]);

  const updateText = value => {
    setDraft(value);
    onChange({ ...definition, manualText: value, manualRows: parseManualAudienceText(value).slice(0, 5000) });
  };

  const importExcel = async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const imported = workbook.SheetNames.flatMap(sheetName => XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' }))
        .map(row => {
          const entries = Object.entries(row || {});
          const get = aliases => entries.find(([key]) => aliases.includes(String(key).trim().toLowerCase()))?.[1] || '';
          return {
            name: get(['name', 'customer', 'customer name', 'الاسم', 'العميل', 'اسم العميل']),
            phone: get(['phone', 'mobile', 'whatsapp', 'phone number', 'الجوال', 'رقم الجوال', 'الهاتف', 'رقم الهاتف']),
            amount: get(['amount', 'المبلغ']),
          };
        })
        .filter(row => row.phone)
        .slice(0, 5000);
      if (!imported.length) throw new Error('لم أجد عمود جوال واضحاً في الملف');
      const nextText = manualRowsToText(imported);
      setDraft(nextText);
      setFileName(file.name);
      onChange({ ...definition, manualText: nextText, manualRows: imported });
      toast(`تمت قراءة ${fmt0(imported.length)} صف من ${file.name}`, 'success');
    } catch (error) {
      toast(`تعذّرت قراءة الجمهور: ${error.message}`, 'error');
    } finally {
      event.target.value = '';
    }
  };

  return (
    <div className="scc-manual-audience">
      <label>
        <span>الأسماء والأرقام</span>
        <textarea
          value={draft}
          onChange={event => updateText(event.target.value)}
          placeholder={'اسم العميل, 05XXXXXXXX\nأو الصق رقماً واحداً في كل سطر'}
          rows={6}
        />
      </label>
      <div className="scc-manual-audience__actions">
        <label className="scc-file-button">
          <FileDown size={15}/>
          <span>رفع Excel</span>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={importExcel}/>
        </label>
        <span>{fileName || `${fmt0(currentRows.length)} صف قبل إزالة التكرار والأرقام غير الصالحة`}</span>
      </div>
      <small>الأعمدة المقبولة: الاسم، الجوال. يمكن إضافة المبلغ اختيارياً. لا تُنشأ أي سجلات في تحصيل أو زوهو.</small>
    </div>
  );
}

function SummaryStrip({ campaigns }) {
  const counts = campaigns.reduce((acc, campaign) => {
    if (campaign.status === 'draft' || campaign.status === 'review' || campaign.status === 'ready') acc.draft += 1;
    if (campaign.status === 'scheduled') acc.scheduled += 1;
    if (campaign.status === 'running') acc.running += 1;
    if (campaign.status === 'needs_decision') acc.decision += 1;
    return acc;
  }, { draft: 0, scheduled: 0, running: 0, decision: 0 });
  return (
    <div className="scc-summary" aria-label="ملخص تشغيل الحملات">
      <SummaryItem label="مسودات" value={counts.draft}/>
      <SummaryItem label="مجدولة" value={counts.scheduled}/>
      <SummaryItem label="تعمل الآن" value={counts.running} tone="success"/>
      <SummaryItem label="تحتاج قراراً" value={counts.decision} tone="warning"/>
    </div>
  );
}

function SummaryItem({ label, value, tone = 'default' }) {
  return <div className={`scc-summary__item is-${tone}`}><span>{label}</span><strong>{fmt0(value)}</strong></div>;
}

function StepRail({ step, onStep }) {
  return (
    <div className="scc-step-rail" aria-label="مراحل إنشاء الحملة">
      {STEPS.map((label, index) => {
        const number = index + 1;
        return (
          <button key={label} type="button" className={number === step ? 'is-active' : number < step ? 'is-done' : ''} onClick={() => onStep(number)}>
            <i>{number < step ? <Check size={12}/> : number}</i><span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

function ToggleGroup({ items, selected, onToggle }) {
  const selectedSet = new Set(selected || []);
  return (
    <div className="scc-toggle-group">
      {items.map(([key, label]) => (
        <button type="button" key={key} className={selectedSet.has(key) ? 'is-selected' : ''} onClick={() => onToggle(key)}>
          <span className="scc-check">{selectedSet.has(key) ? <Check size={12}/> : null}</span>{label}
        </button>
      ))}
    </div>
  );
}

function ObjectiveSelector({ objective, onChange }) {
  return (
    <div className="scc-objectives">
      {Object.entries(SMART_CAMPAIGN_OBJECTIVES).map(([key, meta]) => (
        <button type="button" key={key} className={objective === key ? 'is-selected' : ''} onClick={() => onChange(key)}>
          <span>{meta.label}</span><small>{meta.description}</small>
        </button>
      ))}
    </div>
  );
}

function AudienceFilters({ objective, definition, onChange }) {
  const toggle = (field, key) => {
    const current = new Set(definition[field] || []);
    current.has(key) ? current.delete(key) : current.add(key);
    onChange({ ...definition, [field]: [...current] });
  };
  if (objective === 'general') {
    return <ManualAudienceEditor definition={definition} onChange={onChange}/>;
  }
  if (objective === 'collection') {
    return (
      <>
        <ToggleGroup items={COLLECTION_BUCKETS} selected={definition.buckets} onToggle={key => toggle('buckets', key)}/>
        <label className="scc-inline-field">حالة المتجر
          <select value={definition.platformStatus || 'all'} onChange={event => onChange({ ...definition, platformStatus: event.target.value })}>
            <option value="all">كل الحالات</option><option value="active">نشط</option><option value="inactive">غير نشط</option><option value="unknown">غير معروف</option>
          </select>
        </label>
      </>
    );
  }
  if (objective === 'reactivation') {
    return (
      <>
        <ToggleGroup items={RETARGETING_SEGMENTS} selected={definition.segments} onToggle={key => toggle('segments', key)}/>
        <label className="scc-inline-field">الحد الأدنى منذ آخر شحنة
          <select value={definition.minimumIdleDays || 60} onChange={event => onChange({ ...definition, minimumIdleDays: Number(event.target.value) })}>
            <option value="30">30 يومًا</option><option value="60">60 يومًا</option><option value="90">90 يومًا</option><option value="180">180 يومًا</option>
          </select>
        </label>
      </>
    );
  }
  if (objective === 'sales') {
    return (
      <>
        <ToggleGroup items={SALES_SEGMENTS} selected={definition.segments} onToggle={key => toggle('segments', key)}/>
        <label className="scc-switch"><input type="checkbox" checked={!!definition.highValueOnly} onChange={event => onChange({ ...definition, highValueOnly: event.target.checked })}/><span>عالية القيمة فقط</span></label>
      </>
    );
  }
  return (
    <div className="scc-service-filters">
      <label className="scc-inline-field">حالة المتجر
        <select value={definition.platformStatus || 'active'} onChange={event => onChange({ ...definition, platformStatus: event.target.value })}>
          <option value="active">نشط</option><option value="inactive">غير نشط</option><option value="all">كل الحالات</option><option value="unknown">غير معروف</option>
        </select>
      </label>
      <label className="scc-switch"><input type="checkbox" checked={!!definition.profileIncompleteOnly} onChange={event => onChange({ ...definition, profileIncompleteOnly: event.target.checked })}/><span>الملف غير مكتمل فقط</span></label>
    </div>
  );
}

function CampaignList({ rows, loading, onOpen, onOpenLegacy }) {
  if (loading) return <div className="scc-list-loading"><Spinner/></div>;
  return (
    <div className="scc-table-wrap">
      <table className="scc-table">
        <thead><tr><th>الحملة</th><th>الهدف</th><th>الجمهور</th><th>القناة</th><th>الحالة</th><th>النتيجة</th><th>الإجراء</th></tr></thead>
        <tbody>
          {rows.slice(0, 12).map(row => {
            const status = STATUS_META[row.status] || STATUS_META.draft;
            const result = row.resultSummary || {};
            return (
              <tr key={row.id || row.name}>
                <td data-label="الحملة"><strong>{row.name}</strong><small>{row.legacy ? 'سجل تاريخي' : `CMP-${String(row.id || '').slice(0, 8).toUpperCase()}`}</small></td>
                <td data-label="الهدف">{SMART_CAMPAIGN_OBJECTIVES[row.objective]?.label || 'حملة سابقة'}</td>
                <td data-label="الجمهور"><strong>{fmt0(row.readyCount || result.targets)}</strong><small>{row.financialAmount ? `${fmtMoney(row.financialAmount)} ر.س` : `${fmt0(row.audienceCount || result.targets)} نتيجة`}</small></td>
                <td data-label="القناة">{SMART_CAMPAIGN_CHANNELS[row.channel]?.label || (row.legacy ? 'واتساب عبر هاتف' : 'غير محددة')}</td>
                <td data-label="الحالة"><span className={`scc-status is-${status[1]}`}>{status[0]}</span></td>
                <td data-label="النتيجة">{result.replied != null ? `${fmt0(result.replied)} ردّ` : result.tasks != null ? `${fmt0(result.tasks)} مهمة` : '—'}</td>
                <td data-label="الإجراء"><button type="button" className="scc-row-action" onClick={() => row.legacy ? onOpenLegacy(row) : onOpen(row)} aria-label={`فتح ${row.name}`}><MoreHorizontal size={17}/></button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!rows.length && <div className="scc-empty">لا توجد حملات بعد. ابدأ بحملة جديدة أو احفظ أول مسودة.</div>}
    </div>
  );
}

export default function SmartCampaignCenter({ isActive = true }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const audienceContextToken = searchParams.get('audienceContext');
  const { user, can } = useAuth();
  const canWhatsApp = can('campaigns.send');
  const canIvr = can('campaigns.ivr');
  const canManage = canWhatsApp || canIvr;
  const [campaigns, setCampaigns] = useState([]);
  const [historical, setHistorical] = useState([]);
  const [impact, setImpact] = useState([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);
  const [objective, setObjective] = useState('collection');
  const [definition, setDefinition] = useState(() => defaultAudienceDefinition('collection'));
  const [universe, setUniverse] = useState(null);
  const [universeLoading, setUniverseLoading] = useState(true);
  const [universeError, setUniverseError] = useState('');
  const [protections, setProtections] = useState(null);
  const [protectionsError, setProtectionsError] = useState('');
  const [step, setStep] = useState(2);
  const [channel, setChannel] = useState('whatsapp');
  const [name, setName] = useState(() => suggestedName('collection'));
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [waCampaign, setWaCampaign] = useState(null);
  const [ivrCampaign, setIvrCampaign] = useState(null);
  const [hatifUsers, setHatifUsers] = useState([]);
  const [hatifUsersLoading, setHatifUsersLoading] = useState(false);
  const [assignedHatifUserId, setAssignedHatifUserId] = useState('');
  const [audienceHandoff, setAudienceHandoff] = useState(null);

  useEffect(() => {
    if (!isActive) return;
    const context = readAudienceHandoff(audienceContextToken);
    if (!context || context.source !== 'aging_operations') return;
    setAudienceHandoff(context);
    setObjective('collection');
    setDefinition({
      ...defaultAudienceDefinition('collection'),
      buckets: Array.isArray(context.aging) ? context.aging : [],
      selectionKeys: Array.isArray(context.selectionKeys) ? context.selectionKeys : [],
      audienceContext: {
        source: context.source,
        filters: context.filters || {},
        snapshotAt: context.snapshotAt,
        count: context.count,
        totalAmount: context.totalAmount,
        returnTo: context.returnTo,
      },
    });
    const requestedChannel = searchParams.get('channel');
    setChannel(requestedChannel === 'ivr' ? 'ivr' : 'whatsapp');
    const agingLabel = campaignBucketLabel(new Set(Array.isArray(context.aging) ? context.aging : [])) || 'كل المستحقات';
    setName(`تحصيل ${agingLabel} — ${dateStamp()}`);
    setStep(5);
  }, [isActive, audienceContextToken]);

  const refreshCampaigns = useCallback(async () => {
    setLoadingCampaigns(true);
    try {
      const [smartRows, reportRows, impactRows] = await Promise.all([
        loadSmartCampaigns(),
        loadWhatsAppCampaignReport(),
        loadOutreachImpact(120),
      ]);
      setCampaigns(smartRows); setHistorical(reportRows); setImpact(impactRows);
    } catch (error) {
      toast(`تعذّر تحميل مركز الحملات: ${error.message}`, 'error');
    } finally { setLoadingCampaigns(false); }
  }, []);

  useEffect(() => {
    if (!isActive) return;
    refreshCampaigns();
    setProtectionsError('');
    loadSmartCampaignProtections().then(setProtections).catch(error => setProtectionsError(error.message || 'تعذّر فحص الحماية'));
  }, [isActive, refreshCampaigns]);

  useEffect(() => {
    if (!isActive || !canWhatsApp) return undefined;
    let live = true;
    setHatifUsersLoading(true);
    loadHatifUsers()
      .then(rows => { if (live) setHatifUsers(rows || []); })
      .catch(() => { if (live) setHatifUsers([]); })
      .finally(() => { if (live) setHatifUsersLoading(false); });
    return () => { live = false; };
  }, [isActive, canWhatsApp]);

  useEffect(() => {
    if (!isActive) return;
    let live = true;
    setUniverseLoading(true); setUniverseError('');
    loadSmartAudienceUniverse(objective)
      .then(result => { if (live) setUniverse(result); })
      .catch(error => { if (live) { setUniverse(null); setUniverseError(error.message || 'تعذّر تحميل الجمهور'); } })
      .finally(() => { if (live) setUniverseLoading(false); });
    return () => { live = false; };
  }, [isActive, objective]);

  const audience = useMemo(() => filterSmartAudience(universe, objective, definition), [universe, objective, definition]);
  const preparedRows = useMemo(() => prepareWhatsAppAudienceRows(audience), [audience]);
  const debtorPhones = useMemo(() => objective === 'sales'
    ? new Set(audience.filter(row => row.debtor).map(row => row.to).filter(Boolean))
    : new Set(), [audience, objective]);
  const audienceSummary = useMemo(() => summarizeWhatsAppAudience({
    rows: preparedRows,
    noWhatsapp: channel === 'whatsapp' || channel === 'ivr' ? (protections?.noWhatsapp || new Set()) : new Set(),
    hatifTouched: channel === 'export' || channel === 'employee_task' ? new Map() : (protections?.hatifTouched || new Map()),
    weakPhones: channel === 'whatsapp' ? (protections?.weakPhones || new Set()) : new Set(),
    debtorPhones,
  }), [preparedRows, protections, channel, debtorPhones]);
  const exclusionReasons = useMemo(() => whatsappAudienceExclusionBreakdown(audienceSummary.counts), [audienceSummary.counts]);
  const financialAmount = useMemo(() => audience.reduce((sum, row) => sum + (Number(row.amount) || 0), 0), [audience]);
  const assignedHatifUser = useMemo(
    () => hatifUsers.find(row => row.userId === assignedHatifUserId) || null,
    [hatifUsers, assignedHatifUserId],
  );

  const campaignRows = useMemo(() => {
    const smartByName = new Map(campaigns.map(row => [row.name, row]));
    const impactByName = new Map(impact.map(row => [row.campaign, row]));
    const merged = campaigns.map(row => {
      const report = historical.find(item => item.name === row.name) || null;
      const linkedImpact = impactByName.get(row.name) || null;
      return {
        ...row,
        resultSummary: {
          ...row.resultSummary,
          ...(report || {}),
          ...(linkedImpact ? { collected: linkedImpact.collected, paid: linkedImpact.paid } : {}),
        },
      };
    });
    for (const report of historical) {
      if (smartByName.has(report.name)) continue;
      merged.push({
        id: `legacy:${report.name}`, name: report.name, legacy: true, objective: null,
        status: report.failed > 0 ? 'needs_decision' : 'completed', channel: 'whatsapp',
        audienceCount: report.targets, readyCount: report.targets, financialAmount: 0,
        resultSummary: report, updatedAt: report.lastSent,
      });
    }
    return merged.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  }, [campaigns, historical, impact]);

  const changeObjective = next => {
    setObjective(next); setDefinition(defaultAudienceDefinition(next)); setEditingId(null);
    setName(suggestedName(next)); setStep(1);
  };
  const resetComposer = (draft = false) => {
    setEditingId(null); setObjective('collection'); setDefinition(defaultAudienceDefinition('collection'));
    setName(suggestedName('collection')); setChannel('whatsapp'); setAssignedHatifUserId(''); setStep(draft ? 1 : 2);
    document.querySelector('.scc-composer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const openCampaign = campaign => {
    setEditingId(campaign.id); setObjective(campaign.objective);
    setDefinition({ ...defaultAudienceDefinition(campaign.objective), ...campaign.audienceDefinition });
    setName(campaign.name); setChannel(campaign.channel || 'whatsapp');
    setAssignedHatifUserId(campaign.assignedHatifUserId || ''); setStep(2);
    document.querySelector('.scc-composer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const goToStep = nextStep => {
    const safeStep = Math.max(1, Math.min(5, Number(nextStep) || 1));
    setStep(safeStep);
    const targets = {
      1: '.scc-name-field',
      2: '.scc-audience-block',
      3: '.scc-protection',
      4: '.scc-channels',
      5: '.scc-composer__footer',
    };
    requestAnimationFrame(() => {
      document.querySelector(targets[safeStep])?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  const campaignPayload = status => ({
    id: editingId,
    name,
    objective,
    status,
    audienceDefinition: definition,
    sourceKeys: universe?.sources || [],
    channel,
    assignedHatifUserId: channel === 'whatsapp' ? (assignedHatifUser?.userId || null) : null,
    assignedHatifUserName: channel === 'whatsapp' ? (assignedHatifUser?.name || null) : null,
    protectionSnapshot: {
      checked_at: new Date().toISOString(),
      source: audienceSummary.source,
      ready: audienceSummary.ready.length,
      excluded: audienceSummary.excluded,
      reasons: exclusionReasons,
    },
    audienceCount: audienceSummary.source,
    readyCount: audienceSummary.ready.length,
    excludedCount: audienceSummary.excluded,
    financialAmount,
  });

  const persistCampaign = async (status = 'draft', quiet = false) => {
    if (!canManage) throw new Error('لا تملك صلاحية إنشاء أو تعديل الحملات');
    if (!name.trim()) throw new Error('اكتب اسم الحملة');
    if (!audience.length) throw new Error('لا يوجد جمهور مطابق للفلاتر المختارة');
    if (protectionsError || !protections) throw new Error('فحص الحماية غير مكتمل');
    setSaving(true);
    try {
      const saved = await saveSmartCampaign(campaignPayload(status), user?.id || null);
      setEditingId(saved.id);
      if (!quiet) toast(status === 'draft' ? 'حُفظت المسودة' : 'حُفظت مراجعة الحملة', 'success');
      await refreshCampaigns();
      return saved;
    } finally { setSaving(false); }
  };

  const saveDraft = async () => {
    try { await persistCampaign('draft'); }
    catch (error) { toast(error.code === '23505' ? 'اسم الحملة مستخدم؛ غيّر الاسم أو افتح الحملة القائمة' : error.message, 'error'); }
  };

  const exportAudience = async (saved) => {
    const headers = ['الاسم', 'الجوال', 'رقم المتجر', 'المبلغ', 'المصدر', 'آخر شحنة'];
    const rows = audienceSummary.ready.map(row => [row.name, row.to, row.storeId || '', row.amount || 0, row.source || '', row.lastShipmentAt || '']);
    const worksheet = XLSX.utils.aoa_to_sheet([[saved.name], [], headers, ...rows]);
    worksheet['!cols'] = [{ wch: 28 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 20 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'الجمهور');
    await persistAndDownloadExport({
      wb: workbook,
      fileName: `${saved.name.replace(/[\\/:*?"<>|]/g, '_')}.xlsx`,
      kind: 'smart_campaign_audience',
      rowCount: rows.length,
      total: financialAmount || null,
      userId: user?.id || null,
    });
    await updateSmartCampaignOutcome(saved.id, {
      status: 'completed', channel: 'export', completedAt: new Date().toISOString(), resultSummary: { exported: rows.length },
    }, user?.id || null, 'audience_exported');
    toast(`تم تصدير ${fmt0(rows.length)} مستلم`, 'success');
    refreshCampaigns();
  };

  const launch = async () => {
    if (universe?.sourceState?.status === 'stale' || universe?.sourceState?.status === 'empty') {
      toast(universe.sourceState.message, 'error'); return;
    }
    if (channel === 'whatsapp' && !canWhatsApp) { toast('تحتاج صلاحية إطلاق حملة واتساب', 'error'); return; }
    if (channel === 'whatsapp' && !assignedHatifUser) { toast('اختر الموظف المسؤول عن ردود الحملة في هاتف', 'error'); return; }
    if (channel === 'ivr' && !canIvr) { toast('تحتاج صلاحية إطلاق IVR', 'error'); return; }
    try {
      const saved = await persistCampaign('ready', true);
      if (channel === 'whatsapp') setWaCampaign(saved);
      else if (channel === 'ivr') setIvrCampaign(saved);
      else if (channel === 'employee_task') {
        const count = await createSmartCampaignTasks(saved.id, audienceSummary.ready, user?.id || null);
        await updateSmartCampaignOutcome(saved.id, {
          status: 'running', channel: 'employee_task', launchedAt: new Date().toISOString(), resultSummary: { tasks: count },
        }, user?.id || null, 'employee_tasks_created');
        toast(`أُنشئت ${fmt0(count)} مهمة باسم الحملة`, 'success'); refreshCampaigns();
      } else await exportAudience(saved);
    } catch (error) {
      toast(error.code === '23505' ? 'اسم الحملة مستخدم؛ استخدم اسماً فريداً' : error.message, 'error');
    }
  };

  const handleChannelDone = async (campaign, result, selectedChannel) => {
    try {
      const scheduled = !!result?.scheduled;
      await updateSmartCampaignOutcome(campaign.id, {
        status: scheduled ? 'scheduled' : 'running',
        channel: selectedChannel,
        scheduledAt: scheduled ? (result?.scheduledAt || null) : null,
        launchedAt: scheduled ? null : new Date().toISOString(),
        resultSummary: result || {},
      }, user?.id || null, scheduled ? 'channel_scheduled' : 'channel_launched');
      refreshCampaigns();
    } catch (error) { toast(`تم تنفيذ القناة وتعذّر تحديث سجل المركز: ${error.message}`, 'warn'); }
  };

  if (!isActive) return null;
  return (
    <div className="smart-campaign-center workspace-page" dir="rtl">
      <header className="scc-header">
        <div><h1>مركز الحملات الذكي</h1><p>أنشئ الجمهور، راجع الحماية، ثم فعّل القناة من مكان واحد.</p></div>
        <div className="scc-header__actions">
          <Btn variant="primary" icon={<Plus size={16}/>} onClick={() => resetComposer(false)} disabled={!canManage}>حملة جديدة</Btn>
          <Btn variant="ghost" icon={<Save size={15}/>} onClick={() => resetComposer(true)} disabled={!canManage}>مسودة جديدة</Btn>
        </div>
      </header>

      {audienceHandoff && (
        <div className="scc-audience-handoff">
          <div><strong>جمهور من Aging Operations</strong><span>Snapshot: {new Date(audienceHandoff.snapshotAt).toLocaleString('ar-SA')} · لا توجد هواتف أو أسماء في الرابط</span></div>
          <div className={(audienceHandoff.eligibleCount ?? audienceHandoff.count) === audience.length ? 'is-same' : 'is-changed'}>
            <span>المحدد في التحصيل <b>{fmt0(audienceHandoff.selectedCount ?? audienceHandoff.count)}</b></span>
            <span>غير مؤهل قبل القناة <b>{fmt0(audienceHandoff.excludedBeforeChannelCount || 0)}</b></span>
            <span>دخل فحص القناة <b>{fmt0(audienceHandoff.eligibleCount ?? audienceHandoff.count)}</b></span>
            <span>إعادة الاحتساب الآن <b>{fmt0(audience.length)}</b></span>
            <span>مبلغ المحدد <b>{fmtMoney(audienceHandoff.totalAmount)} ر.س</b></span>
            <span>مبلغ المؤهل <b>{fmtMoney(audienceHandoff.eligibleTotalAmount ?? financialAmount)} ر.س</b></span>
          </div>
          {!!audienceHandoff.eligibilityExclusions?.length && (
            <div className="scc-audience-handoff__reasons">
              استبعادات ما قبل القناة: {audienceHandoff.eligibilityExclusions.map(item => `${item.reason} ${fmt0(item.count)}`).join(' · ')}
            </div>
          )}
          <button type="button" onClick={() => navigate(audienceHandoff.returnTo || '/customer-money')}>العودة إلى Aging</button>
        </div>
      )}

      <div className="scc-workspace">
        <aside className="scc-composer">
          <div className="scc-composer__head">
            <div><h2>منشئ الحملة</h2><span>{editingId ? 'تعديل حملة قائمة' : 'حملة جديدة غير مرسلة'}</span></div>
            {editingId && <button type="button" onClick={() => resetComposer(false)}>بدء أخرى</button>}
          </div>
          <StepRail step={step} onStep={goToStep}/>

          <label className="scc-name-field"><span>اسم الحملة</span><input value={name} onChange={event => setName(event.target.value)} disabled={!canManage}/></label>

          <div className="scc-block scc-objective-block">
            <div className="scc-block__title"><Target size={16}/><span>الهدف</span></div>
            <ObjectiveSelector objective={objective} onChange={changeObjective}/>
          </div>

          <div className="scc-block scc-audience-block">
            <div className="scc-block__title"><Users size={16}/><span>مصادر الجمهور</span></div>
            <div className="scc-source-list">{(universe?.sources || []).map(source => <span key={source}>{source}</span>)}</div>
            <div className="scc-block__title is-sub"><ClipboardList size={15}/><span>فلاتر الجمهور</span></div>
            {universeLoading ? <div className="scc-inline-loading"><Spinner/> يحمّل الجمهور الحي…</div>
              : universeError ? <div className="scc-alert is-danger"><AlertTriangle size={15}/>{universeError}</div>
                : <AudienceFilters objective={objective} definition={definition} onChange={setDefinition}/>}
          </div>

          <div className="scc-equation" aria-label="معادلة جمهور الحملة">
            <AudienceNumber label="نتيجة الفلتر" value={audienceSummary.source} tone="source"/>
            <span className="scc-equation__operator">−</span>
            <AudienceNumber label="مستبعد تلقائياً" value={audienceSummary.excluded} tone="excluded"/>
            <span className="scc-equation__operator">=</span>
            <AudienceNumber label="جاهز" value={audienceSummary.ready.length} tone="ready"/>
          </div>
          {!!financialAmount && <div className="scc-financial-total">مبلغ الجمهور المحدد <strong>{fmtMoney(financialAmount)} ر.س</strong></div>}

          <div className="scc-protection">
            <div className="scc-block__title"><ShieldCheck size={16}/><span>الحماية</span></div>
            {protectionsError ? <div className="scc-alert is-danger"><AlertTriangle size={15}/>{protectionsError} — التنفيذ متوقف</div>
              : !protections ? <div className="scc-inline-loading"><Spinner/> يفحص قوائم الحماية…</div>
                : exclusionReasons.length ? <div className="scc-reasons">{exclusionReasons.map(reason => <span key={reason.key}>{reason.label} <b>{fmt0(reason.count)}</b></span>)}</div>
                  : <div className="scc-alert is-success"><Check size={15}/>لا توجد استبعادات في الجمهور الحالي</div>}
            {universe?.sourceState && universe.sourceState.status !== 'fresh' && <div className="scc-alert is-warning"><AlertTriangle size={15}/>{universe.sourceState.message}</div>}
          </div>

          <div className="scc-channels">
            <div className="scc-block__title"><Megaphone size={16}/><span>القناة</span></div>
            <div className="scc-channel-grid">
              <ChannelButton id="whatsapp" icon={MessageCircle} selected={channel === 'whatsapp'} disabled={!canWhatsApp} onClick={setChannel}/>
              <ChannelButton id="ivr" icon={PhoneCall} selected={channel === 'ivr'} disabled={!canIvr} onClick={setChannel}/>
              <ChannelButton id="employee_task" icon={ClipboardList} selected={channel === 'employee_task'} disabled={!canManage} onClick={setChannel}/>
              <ChannelButton id="export" icon={Download} selected={channel === 'export'} disabled={!canManage} onClick={setChannel}/>
            </div>
            {channel === 'whatsapp' && (
              <div className="scc-hatif-owner">
                <div className="scc-hatif-owner__heading">
                  <UserRound size={17}/>
                  <div>
                    <strong>الموظف المسؤول في هاتف</strong>
                    <span>كل رد على هذه الحملة سيتجه إليه تلقائياً، حتى لو كان للقالب مسؤول افتراضي مختلف.</span>
                  </div>
                </div>
                <select
                  value={assignedHatifUserId}
                  onChange={event => setAssignedHatifUserId(event.target.value)}
                  disabled={hatifUsersLoading || !canWhatsApp}
                  aria-label="الموظف المسؤول في هاتف"
                >
                  <option value="">{hatifUsersLoading ? 'يجري تحميل موظفي هاتف…' : 'اختر الموظف المسؤول'}</option>
                  {hatifUsers.map(row => <option key={row.userId} value={row.userId}>{row.name}{row.email ? ` — ${row.email}` : ''}</option>)}
                </select>
                {!hatifUsersLoading && !hatifUsers.length && (
                  <button type="button" className="scc-hatif-owner__settings" onClick={() => navigate('/whatsapp-settings?tab=connection')}>
                    لم يظهر موظفو هاتف — افتح إعدادات الربط
                  </button>
                )}
              </div>
            )}
          </div>

          {!canManage && <div className="scc-alert is-warning"><AlertTriangle size={15}/>يمكنك قراءة المركز، لكن إنشاء الحملة يتطلب صلاحية واتساب أو IVR.</div>}
          <div className="scc-composer__footer">
            <Btn variant="ghost" icon={<Save size={14}/>} onClick={saveDraft} disabled={!canManage || saving || universeLoading}>حفظ كمسودة</Btn>
            <Btn variant="primary" icon={step < 5 ? <ChevronLeft size={15}/> : <FileDown size={15}/>} onClick={() => step < 5 ? goToStep(step + 1) : launch()}
              disabled={!canManage || saving || universeLoading || !audience.length || !!protectionsError || !protections}>
              {step < 3 ? 'متابعة إلى الحماية' : step < 4 ? 'متابعة إلى القناة' : step < 5 ? 'مراجعة الحملة' : channel === 'employee_task' ? 'إنشاء مهام الفريق' : channel === 'export' ? 'تصدير الجمهور' : 'فتح مراجعة القناة'}
            </Btn>
          </div>
        </aside>

        <SummaryStrip campaigns={campaignRows}/>

        <section className="scc-campaign-list">
          <div className="scc-section-head">
            <div><h2>قائمة الحملات</h2><span>{fmt0(campaignRows.length)} حملة موحدة وسجل تاريخي</span></div>
            <div className="scc-section-actions">
              <Btn size="sm" variant="ghost" icon={<RefreshCw size={14}/>} onClick={refreshCampaigns} disabled={loadingCampaigns}>تحديث</Btn>
              <Btn size="sm" variant="ghost" icon={<ExternalLink size={14}/>} onClick={() => navigate('/whatsapp-settings?tab=campaigns')}>سجل القنوات</Btn>
            </div>
          </div>
          <CampaignList rows={campaignRows} loading={loadingCampaigns} onOpen={openCampaign} onOpenLegacy={() => navigate('/whatsapp-settings?tab=campaigns')}/>
        </section>
      </div>

      <WhatsAppSendModal
        open={!!waCampaign}
        onClose={() => setWaCampaign(null)}
        recipients={waCampaign ? audience : []}
        bucketLabel={waCampaign?.name || ''}
        lockedCampaignName={waCampaign?.name || null}
        assignedHatifUser={waCampaign ? {
          userId: waCampaign.assignedHatifUserId,
          name: waCampaign.assignedHatifUserName,
        } : null}
        salesAudience={objective === 'sales' || objective === 'reactivation'}
        onSent={result => handleChannelDone(waCampaign, result, 'whatsapp')}
      />
      <IvrCampaignModal
        open={!!ivrCampaign}
        onClose={() => setIvrCampaign(null)}
        recipients={ivrCampaign ? audience.map(row => ({ phone: row.to, name: row.name, fields: row.fields })) : []}
        bucketLabel={ivrCampaign?.name || ''}
        lockedCampaignName={ivrCampaign?.name || null}
        onDone={result => handleChannelDone(ivrCampaign, result, 'ivr')}
      />
    </div>
  );
}

function AudienceNumber({ label, value, tone }) {
  return <div className={`scc-audience-number is-${tone}`}><span>{label}</span><strong>{fmt0(value)}</strong></div>;
}

function ChannelButton({ id, icon: Icon, selected, disabled, onClick }) {
  return (
    <button type="button" className={selected ? 'is-selected' : ''} disabled={disabled} onClick={() => onClick(id)}>
      <Icon size={16}/><span>{SMART_CAMPAIGN_CHANNELS[id].label}</span>
    </button>
  );
}

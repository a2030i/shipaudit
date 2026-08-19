import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import {
  Activity, AlertTriangle, CalendarClock, CheckCircle2, Clock3,
  Download, History, Link2Off, MessageSquareText, PhoneCall, RefreshCw, RotateCcw,
  Search, ShieldAlert, Store, Target, TrendingUp, UserRoundCheck, UserRoundX,
  UserRoundPlus, UsersRound, WalletCards, Zap,
} from 'lucide-react';
import {
  Btn, Card, Empty, Input, Modal, PageHeader, Select, Spinner, toast,
} from '../components/UI.jsx';
import WaActions from '../components/WaActions.jsx';
import { useAuth } from '../lib/auth.jsx';
import { loadEmployees } from '../lib/employeeService.js';
import {
  assignPlatformSalesAccounts,
  loadAllPlatformSalesPipelineRows,
  loadPlatformSalesAccount,
  loadPlatformSalesPipeline,
  recordPlatformSalesActivity,
} from '../lib/retargetingService.js';
import { persistAndDownloadExport } from '../lib/internalExportsService.js';
import { rtl } from '../lib/xlsxRtl.js';
import {
  hatifInboxUrl,
  loadCustomerCommTimeline,
} from '../lib/whatsappService.js';
import './PlatformSalesCrm.css';

const SALES_STAGES = {
  new: { label: 'جديد', color: 'var(--brand)' },
  contacted: { label: 'تم التواصل', color: 'var(--accent3)' },
  qualified: { label: 'مؤهّل', color: 'var(--green)' },
  proposal: { label: 'عرض مقدّم', color: 'var(--purple)' },
  negotiation: { label: 'تفاوض', color: 'var(--gold)' },
  nurture: { label: 'إعادة تواصل', color: 'var(--brand-navy)' },
  won: { label: 'تم الاتفاق', color: 'var(--green)' },
  lost: { label: 'خسرناه', color: 'var(--red)' },
  disqualified: { label: 'مستبعد', color: 'var(--muted2)' },
};

const OUTCOMES = {
  new: 'بلا نتيجة بعد',
  contacted: 'تم الرد',
  whatsapp_sent: 'أُرسلت رسالة',
  no_answer: 'لم يرد',
  interested: 'مهتم',
  needs_followup: 'يحتاج متابعة',
  price_issue: 'اعتراض على السعر',
  support_issue: 'مشكلة خدمة',
  integration_issue: 'مشكلة ربط',
  competitor: 'انتقل لمنافس',
  closed_business: 'أغلق نشاطه',
  not_interested: 'غير مهتم',
  finance: 'يحتاج معالجة مالية',
  returned: 'عاد للشحن',
  converted: 'تحوّل لعميل',
};

const ACTIVITY_TYPES = {
  note: 'ملاحظة إدارية',
  call: 'مكالمة',
  whatsapp: 'متابعة واتساب',
  meeting: 'اجتماع',
  email: 'بريد إلكتروني',
};

const NEXT_TYPES = {
  call: 'اتصال',
  whatsapp: 'واتساب',
  meeting: 'اجتماع',
  email: 'بريد',
  other: 'إجراء آخر',
};

const LOSS_REASONS = [
  ['price', 'السعر'],
  ['competitor', 'اختار منافسًا'],
  ['no_need', 'لا توجد حاجة حاليًا'],
  ['no_response', 'تعذّر الوصول بعد المحاولات'],
  ['closed_business', 'توقّف النشاط'],
  ['product_gap', 'الخدمة لا تغطي احتياجه'],
  ['other', 'سبب آخر'],
];

const PIPELINE_BUCKETS = [
  { id: 'new', label: 'الجدد', icon: Store },
  { id: 'in_progress', label: 'قيد المتابعة', icon: Activity },
  { id: 'won', label: 'تم الاتفاق', icon: UserRoundCheck },
  { id: 'lost', label: 'خسرناهم', icon: UserRoundX },
  { id: 'all', label: 'الكل', icon: UsersRound },
];

const SMART_BUCKETS = [
  { id: 'hot_live_new', label: 'لايف جديد عالي النية', icon: Zap },
  { id: 'recent_stop', label: 'تجاوز 5 أيام بلا شحن', icon: PhoneCall },
  { id: 'wallet_stranded', label: 'رصيد يحتاج حلًا', icon: WalletCards },
  { id: 'live_inactive', label: 'ربط لايف غير نشط', icon: Link2Off },
];

const PLATFORM_BUCKETS = [
  { id: 'active', label: 'بدأوا ويعملون', icon: TrendingUp },
  { id: 'stopped', label: 'اشتغلوا ثم توقفوا', icon: RotateCcw },
  { id: 'reactivated', label: 'عادوا للنشاط', icon: CheckCircle2 },
];

const SCHEDULE_BUCKETS = [
  { id: 'recontact_due', label: 'مستحق ومتأخر', icon: AlertTriangle },
  { id: 'scheduled', label: 'مجدول قادمًا', icon: CalendarClock },
  { id: 'unscheduled', label: 'متابعة بلا موعد', icon: Clock3 },
];

const WORK_FILTERS = [
  { id: 'all', label: 'كل الحالات' },
  { id: 'action_now', label: 'يحتاج إجراء الآن' },
  { id: 'never_contacted', label: 'لم نتواصل' },
  { id: 'no_answer', label: 'لم يرد' },
  { id: 'due', label: 'متابعة مستحقة' },
  { id: 'contacted_no_next', label: 'تواصل بلا موعد' },
  { id: 'scheduled', label: 'موعد قادم' },
  { id: 'contacted', label: 'تم التواصل' },
  { id: 'unassigned', label: 'بلا مسؤول' },
];

const PIPELINE_BUCKET_IDS = new Set([
  ...SMART_BUCKETS,
  ...PIPELINE_BUCKETS,
  ...PLATFORM_BUCKETS,
  ...SCHEDULE_BUCKETS,
].map(item => item.id));
const WORK_FILTER_IDS = new Set(WORK_FILTERS.map(item => item.id));

const SORT_OPTIONS = [
  ['recommended', 'الترتيب المقترح'],
  ['recent_first', 'الأقرب للتوقف أولًا'],
  ['action_first', 'الإجراء العاجل أولًا'],
  ['largest', 'الأعلى شحنًا أولًا'],
  ['least_contacted', 'الأقل تواصلًا أولًا'],
];

const stageMeta = key => SALES_STAGES[key] || { label: key || 'جديد', color: 'var(--muted)' };
const fmtNumber = value => Number(value || 0).toLocaleString('en-US');
const fmtMoney = value => `${Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} ر.س`;
const fmtDate = value => {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('ar-SA', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return String(value);
  }
};
const fmtShortDate = value => {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString('ar-SA', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch {
    return String(value);
  }
};
const toLocalInput = value => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

const platformState = row => {
  if (row.platform_state === 'active') return { label: 'يعمل الآن', color: 'var(--green)' };
  if (row.platform_state === 'stopped') return { label: 'اشتغل ثم توقف', color: 'var(--gold)' };
  if (row.platform_state === 'financial_hold') return { label: 'موقوف ماليًا', color: 'var(--red)' };
  if (row.live_inactive) return { label: 'ربط مباشر غير نشط', color: 'var(--purple)' };
  return { label: 'لم ينفّذ أول شحنة', color: 'var(--brand)' };
};

const signalMeta = row => {
  const map = {
    hot_live_topped: { label: 'جاهز لأول شحنة', color: 'var(--green)' },
    hot_live_new: { label: 'لايف جديد', color: 'var(--brand)' },
    recent_stop: { label: 'متوقف +5 أيام', color: 'var(--gold)' },
    wallet_stranded: { label: 'رصيد عالق', color: 'var(--accent3)' },
    live_inactive: { label: 'فكّ الربط', color: 'var(--purple)' },
    live_no_first_shipment: { label: 'لايف بلا شحنة', color: 'var(--brand-navy)' },
    manual_trial: { label: 'تجربة يدوية', color: 'var(--muted2)' },
    collections_hold: { label: 'للتحصيل', color: 'var(--red)' },
  };
  return map[row.commercial_signal] || { label: 'متابعة', color: 'var(--muted)' };
};

const workMeta = row => {
  const days = Number(row.days_since_last) || 0;
  const urgentStop = row.commercial_signal === 'recent_stop' && days >= 6 && days <= 14;
  const map = {
    due: {
      label: 'نفّذ المتابعة الآن',
      detail: 'الموعد مستحق أو متأخر',
      color: 'var(--red)',
    },
    no_answer: {
      label: 'أعد المحاولة',
      detail: `${fmtNumber(row.contact_attempts)} محاولة بلا رد`,
      color: 'var(--gold)',
    },
    scheduled: {
      label: 'موعد قادم',
      detail: fmtDate(row.next_action_at),
      color: 'var(--accent3)',
    },
    contacted_no_next: {
      label: 'حدّد الخطوة التالية',
      detail: 'تم التواصل ولا يوجد موعد قادم',
      color: 'var(--gold)',
    },
    contacted: {
      label: 'تم التواصل',
      detail: OUTCOMES[row.last_outcome] || 'المتابعة مسجلة',
      color: 'var(--green)',
    },
    unassigned: {
      label: 'يحتاج مسؤولًا',
      detail: 'لم تُسند المتابعة بعد',
      color: 'var(--red)',
    },
  };
  if (row.work_state === 'never_contacted') {
    return urgentStop
      ? {
          label: 'اتصل الآن',
          detail: `دخل يومه ${days} بلا شحن`,
          color: 'var(--red)',
        }
      : {
          label: 'لم نتواصل بعد',
          detail: 'لا توجد محاولة مسجلة',
          color: 'var(--brand)',
        };
  }
  return map[row.work_state] || {
    label: 'راجع الحالة',
    detail: 'حدّد الإجراء التالي',
    color: 'var(--muted)',
  };
};

const integrationLabel = account => {
  if (account.direct_live) return 'ربط مباشر (سلة/زد)';
  if (account.integration_class === 'automation') return `تكامل آلي (${account.integration_type || 'API'})`;
  if (account.integration_class === 'manual') return 'تسجيل يدوي بلا ربط';
  return account.integration_type || 'غير مربوط';
};

const lifecycleLabels = {
  registered: 'سُجّل في المنصّة',
  profile_completed: 'أكمل بيانات المتجر',
  verified: 'اكتمل التوثيق',
  integration_connected: 'ربط المتجر',
  integration_changed: 'غيّر نوع الربط',
  wallet_topped: 'شحن المحفظة',
  first_shipment: 'نفّذ أول شحنة',
  shipping_resumed: 'استأنف الشحن',
  deactivated: 'توقّف حسابه',
  reactivated: 'عاد حسابه للنشاط',
};

function SummaryCard({ icon, label, value, tone, active, onClick, hint }) {
  return (
    <button
      type="button"
      className={`psc-summary-card${active ? ' active' : ''}`}
      style={{ '--psc-tone': tone }}
      onClick={onClick}
    >
      <span className="psc-summary-icon">{icon}</span>
      <span>
        <small>{label}</small>
        <strong>{fmtNumber(value)}</strong>
        {hint && <em>{hint}</em>}
      </span>
    </button>
  );
}

function BucketTabs({ items, current, summary, onPick }) {
  return (
    <div className="psc-bucket-tabs" role="tablist">
      {items.map(item => {
        const Icon = item.icon;
        return (
          <button
            type="button"
            role="tab"
            aria-selected={current === item.id}
            className={current === item.id ? 'active' : ''}
            key={item.id}
            onClick={() => onPick(item.id)}
          >
            <Icon size={14}/>
            <span>{item.label}</span>
            <b>{fmtNumber(item.id === 'all' ? summary.total : summary[item.id])}</b>
          </button>
        );
      })}
    </div>
  );
}

function TimelineItem({ item }) {
  const isLifecycle = item.source === 'platform';
  const isHatif = item.source === 'hatif';
  const icon = isLifecycle
    ? <Store size={14}/>
    : isHatif
      ? <MessageSquareText size={14}/>
      : <History size={14}/>;
  return (
    <div className={`psc-timeline-item ${item.source}`}>
      <span className="psc-timeline-icon">{icon}</span>
      <div>
        <strong>{item.title}</strong>
        {item.detail && <p>{item.detail}</p>}
        <small>{fmtDate(item.at)}{item.by ? ` · ${item.by}` : ''}</small>
        {item.href && (
          <a href={item.href} target="_blank" rel="noreferrer">
            فتح المحادثة في هاتف
          </a>
        )}
      </div>
    </div>
  );
}

function AccountDrawer({ phone, employees, onClose, onSaved }) {
  const { user, can, isAdmin } = useAuth();
  const [payload, setPayload] = useState(null);
  const [hatif, setHatif] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    stage: 'new',
    outcome: 'new',
    activityType: 'note',
    nextAt: '',
    nextType: 'call',
    note: '',
    ownerId: '',
    lossReason: '',
  });

  const load = async () => {
    setLoading(true);
    try {
      const [accountData, comms] = await Promise.all([
        loadPlatformSalesAccount(phone),
        loadCustomerCommTimeline(phone),
      ]);
      setPayload(accountData);
      setHatif(comms);
      const account = accountData.account || {};
      setForm(current => ({
        ...current,
        stage: account.sales_stage || 'new',
        outcome: account.last_outcome || 'new',
        nextAt: toLocalInput(account.next_action_at),
        nextType: account.next_action_type || 'call',
        ownerId: account.owner_id || user?.id || '',
        lossReason: account.loss_reason || '',
      }));
    } catch (error) {
      toast(`تعذّر فتح ملف العميل: ${error.message}`, 'error');
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [phone]); // eslint-disable-line react-hooks/exhaustive-deps

  const timeline = useMemo(() => {
    const activities = (payload?.activities || []).map(item => ({
      source: 'sales',
      at: item.occurred_at,
      title: item.summary || ACTIVITY_TYPES[String(item.kind || '').replace('sales_', '')] || 'نشاط مبيعات',
      detail: [OUTCOMES[item.disposition], item.body].filter(Boolean).join(' · '),
      by: item.created_by_name,
    }));
    const lifecycle = (payload?.lifecycle || []).map(item => ({
      source: 'platform',
      at: item.observed_at,
      title: lifecycleLabels[item.event_type] || item.event_type,
      detail: [
        item.store_name,
        Number(item.shipment_delta) > 0 ? `+${fmtNumber(item.shipment_delta)} شحنة` : null,
      ].filter(Boolean).join(' · '),
    }));
    const comms = (hatif || []).map(item => ({
      source: 'hatif',
      at: item.occurred_at,
      title: item.kind === 'campaign' ? (item.title || 'رسالة واتساب') : item.kind === 'ivr' ? 'مكالمة هاتفية' : 'إسناد محادثة في هاتف',
      detail: [item.status, item.reply_body || item.detail].filter(Boolean).join(' · '),
      href: item.conversation_id ? hatifInboxUrl(item.conversation_id) : null,
    }));
    return [...activities, ...lifecycle, ...comms]
      .filter(item => item.at)
      .sort((a, b) => new Date(b.at) - new Date(a.at));
  }, [payload, hatif]);

  const save = async () => {
    if (payload?.account?.financial_hold) {
      toast('هذا العميل محوّل للتحصيل، ولا تُسجّل له متابعة مبيعات حتى تُحل المعلّقات المالية', 'warning');
      return;
    }
    const touch = form.activityType !== 'note';
    const openStage = !['won', 'lost', 'disqualified'].includes(form.stage);
    if (touch && openStage && !form.nextAt) {
      toast('بعد أي تواصل مفتوح حدّد موعد الإجراء التالي', 'warning');
      return;
    }
    if (form.stage === 'lost' && !form.lossReason) {
      toast('اختر سبب خسارة العميل حتى نستطيع تحليل الخسائر', 'warning');
      return;
    }
    if (!form.note.trim() && form.activityType === 'note') {
      toast('اكتب الملاحظة التي تريد حفظها', 'warning');
      return;
    }
    setSaving(true);
    try {
      await recordPlatformSalesActivity({
        phone,
        stage: form.stage,
        outcome: form.outcome,
        activityType: form.activityType,
        nextAt: form.nextAt ? new Date(form.nextAt).toISOString() : null,
        nextType: form.nextType,
        note: form.note.trim(),
        ownerId: form.ownerId || user?.id || null,
        lossReason: form.stage === 'lost' ? form.lossReason : null,
        touch,
      });
      toast('حُفظت المتابعة وسجل العميل', 'success');
      setForm(current => ({ ...current, note: '', activityType: 'note' }));
      await load();
      onSaved?.();
    } catch (error) {
      const messages = {
        next_action_required: 'موعد الإجراء التالي مطلوب بعد التواصل',
        loss_reason_required: 'سبب الخسارة مطلوب',
        assign_not_allowed: 'ليست لديك صلاحية إسناد العميل لموظف آخر',
        financial_hold: 'العميل محوّل للتحصيل بسبب معلّقات مالية، وأُوقفت متابعة المبيعات',
      };
      toast(messages[error.message] || `تعذّر الحفظ: ${error.message}`, 'error');
    }
    setSaving(false);
  };

  const account = payload?.account || {};
  const state = platformState({
    platform_state: account.financial_hold
      ? 'financial_hold'
      : account.total_shipments === 0
        ? 'pending_first_shipment'
        : account.segment === 'active'
          ? 'active'
          : 'stopped',
    live_inactive: account.live_inactive,
  });
  const signal = signalMeta(account);

  return (
    <Modal title="ملف متابعة العميل" onClose={onClose} width={1160}>
      {loading ? (
        <div className="psc-drawer-loading"><Spinner size={28}/></div>
      ) : (
        <div className="psc-drawer m-flow">
          <section className="psc-account-hero">
            <div>
              <small>متجر من المنصّة</small>
              <h2>{account.primary_store || phone}</h2>
              <p>{phone}{Number(account.store_count) > 1 ? ` · ${account.store_count} متاجر على الحساب` : ''}</p>
            </div>
            <div className="psc-account-actions">
              <span style={{ '--pill-tone': state.color }}>{state.label}</span>
              <WaActions phone={phone} name={account.primary_store} campaignLabel="متابعة مبيعات" size={18}/>
            </div>
          </section>

          <div className="psc-facts">
            <div><small>إجمالي الشحنات</small><strong>{fmtNumber(account.total_shipments)}</strong></div>
            <div><small>آخر شحنة</small><strong>{fmtDate(account.last_shipment).split('،')[0]}</strong></div>
            <div><small>الرصيد المتاح</small><strong>{fmtMoney(account.positive_wallet)}</strong></div>
            <div><small>مديونية زوهو</small><strong>{fmtMoney(account.debt)}</strong></div>
            <div><small>الربط</small><strong>{integrationLabel(account)}</strong></div>
            <div><small>محاولات التواصل</small><strong>{fmtNumber(account.contact_attempts)}</strong></div>
            <div><small>المسؤول</small><strong>{account.owner_name || 'بلا مسؤول'}</strong></div>
            <div><small>درجة الأولوية</small><strong>{fmtNumber(account.signal_score)} / 100</strong></div>
          </div>

          <section
            className={`psc-routing-brief${account.financial_hold ? ' blocked' : ''}`}
            style={{ '--route-tone': account.financial_hold ? 'var(--red)' : signal.color }}
          >
            <span className="psc-routing-icon">
              {account.financial_hold ? <ShieldAlert size={19}/> : <Target size={19}/>}
            </span>
            <div>
              <small>{account.financial_hold ? 'توجيه إلزامي' : 'لماذا هذا العميل مهم الآن؟'}</small>
              <strong>{account.financial_hold ? 'التحصيل قبل أي تواصل مبيعات' : signal.label}</strong>
              <p>{account.signal_reason || account.next_step || 'راجع حالة العميل وحدّد الإجراء التالي.'}</p>
              {account.financial_hold && (
                <em>
                  {fmtMoney(account.debt)} مديونية زوهو · {fmtMoney(account.negative_wallet)} محفظة سالبة
                </em>
              )}
            </div>
          </section>

          <div className="psc-drawer-grid">
            {account.financial_hold ? (
              <div className="psc-financial-block">
              <Card style={{ padding: 18 }}>
                <div className="psc-card-heading">
                  <ShieldAlert size={18}/>
                  <div>
                    <strong>متابعة المبيعات متوقفة</strong>
                    <small>يعود العميل للمبيعات تلقائيًا بعد تصفير مديونية زوهو والمحفظة السالبة.</small>
                  </div>
                </div>
                <p>
                  لم نحذف سجل المبيعات أو ملاحظاته، لكن منعنا الاتصال والاستلام والجدولة حتى لا يُعاد
                  تنشيط عميل لديه معلّقات مالية.
                </p>
              </Card>
              </div>
            ) : (
              <div className="psc-editor-card">
            <Card style={{ padding: 18 }}>
              <div className="psc-card-heading">
                <Target size={17}/>
                <div>
                  <strong>سجّل ما حدث وحدّد الخطوة التالية</strong>
                  <small>واتساب في هاتف قناة تواصل فقط؛ المرحلة لا تتغيّر تلقائيًا.</small>
                </div>
              </div>

              <div className="psc-form-grid">
                <Select
                  label="نوع النشاط"
                  value={form.activityType}
                  onChange={event => setForm({ ...form, activityType: event.target.value })}
                >
                  {Object.entries(ACTIVITY_TYPES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </Select>
                <Select
                  label="مرحلة البيع"
                  value={form.stage}
                  onChange={event => setForm({ ...form, stage: event.target.value })}
                >
                  {Object.entries(SALES_STAGES).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}
                </Select>
                <Select
                  label="نتيجة التواصل"
                  value={form.outcome}
                  onChange={event => setForm({ ...form, outcome: event.target.value })}
                >
                  {Object.entries(OUTCOMES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </Select>
                {(isAdmin || can('crm.assign')) ? (
                  <Select
                    label="المسؤول"
                    value={form.ownerId}
                    onChange={event => setForm({ ...form, ownerId: event.target.value })}
                  >
                    <option value="">أنا</option>
                    {employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
                  </Select>
                ) : (
                  <div className="ui-field">
                    <span className="ui-label">المسؤول</span>
                    <div className="psc-static-field">{account.owner_name || 'أنت'}</div>
                  </div>
                )}
                <Input
                  label="موعد التواصل القادم"
                  type="datetime-local"
                  value={form.nextAt}
                  onChange={event => setForm({ ...form, nextAt: event.target.value })}
                  hint={form.activityType === 'note' ? 'اختياري للملاحظة' : 'إلزامي إذا بقيت الفرصة مفتوحة'}
                />
                <Select
                  label="نوع الإجراء القادم"
                  value={form.nextType}
                  onChange={event => setForm({ ...form, nextType: event.target.value })}
                >
                  {Object.entries(NEXT_TYPES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </Select>
                {form.stage === 'lost' && (
                  <Select
                    label="سبب الخسارة *"
                    value={form.lossReason}
                    onChange={event => setForm({ ...form, lossReason: event.target.value })}
                  >
                    <option value="">اختر السبب</option>
                    {LOSS_REASONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                  </Select>
                )}
              </div>

              <div className="ui-field">
                <label className="ui-label" htmlFor="platform-sales-note">ملاحظة العميل / تفاصيل التواصل</label>
                <textarea
                  id="platform-sales-note"
                  rows={4}
                  value={form.note}
                  onChange={event => setForm({ ...form, note: event.target.value })}
                  placeholder="ماذا قال العميل؟ ما اعتراضه؟ وما الذي اتفقتم عليه؟"
                />
              </div>

              <div className="psc-editor-footer">
                <small>لن تُحتسب رسالة أو رد من هاتف كـ Lead أو تواصل مبيعات إلا إذا سجّلها الموظف هنا.</small>
                {can('sales.manage') ? (
                  <Btn variant="accent" onClick={save} disabled={saving}>
                    {saving ? 'جارٍ الحفظ…' : 'حفظ المتابعة'}
                  </Btn>
                ) : (
                  <span className="psc-readonly">عرض فقط</span>
                )}
              </div>
            </Card>
              </div>
            )}

            <Card style={{ padding: 18 }}>
              <div className="psc-card-heading">
                <History size={17}/>
                <div>
                  <strong>تاريخ العميل الموحّد</strong>
                  <small>ملاحظات الفريق + أحداث المنصّة + سجل هاتف للقراءة فقط</small>
                </div>
              </div>
              <div className="psc-timeline">
                {!timeline.length
                  ? <Empty icon="🗒️" title="لا يوجد سجل بعد" sub="أول متابعة تحفظها ستظهر هنا"/>
                  : timeline.map((item, index) => <TimelineItem key={`${item.source}-${item.at}-${index}`} item={item}/>)}
              </div>
            </Card>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function PlatformSalesCrm({ isActive = true }) {
  const { can, isAdmin, user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const routeBucket = searchParams.get('bucket');
  const routeWork = searchParams.get('work');
  const initialBucket = PIPELINE_BUCKET_IDS.has(routeBucket) ? routeBucket : 'hot_live_new';
  const [lens, setLens] = useState(SCHEDULE_BUCKETS.some(item => item.id === initialBucket) ? 'schedule' : 'pipeline');
  const [bucket, setBucket] = useState(initialBucket);
  const [data, setData] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [owner, setOwner] = useState('');
  const [workFilter, setWorkFilter] = useState(WORK_FILTER_IDS.has(routeWork) ? routeWork : 'all');
  const [sort, setSort] = useState('recommended');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [selectedPhone, setSelectedPhone] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkOwner, setBulkOwner] = useState('');
  const [bulkRows, setBulkRows] = useState([]);
  const [bulkBusy, setBulkBusy] = useState(false);

  const refresh = async ({ resetPage = false } = {}) => {
    const targetPage = resetPage ? 0 : page;
    if (resetPage) setPage(0);
    setBusy(true);
    try {
      setData(await loadPlatformSalesPipeline({
        bucket,
        ownerId: owner && owner !== 'unassigned' ? owner : null,
        unassigned: owner === 'unassigned',
        workFilter,
        sort,
        search: appliedSearch,
        page: targetPage,
        limit: 40,
      }));
    } catch (error) {
      toast(`تعذّر تحميل مسار العملاء: ${error.message}`, 'error');
    }
    setBusy(false);
  };

  useEffect(() => {
    if (!isActive) return;
    refresh();
  }, [isActive, bucket, owner, workFilter, sort, appliedSearch, page]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isActive) return;
    const nextBucket = searchParams.get('bucket');
    const nextWork = searchParams.get('work');
    if (PIPELINE_BUCKET_IDS.has(nextBucket)) {
      setLens(SCHEDULE_BUCKETS.some(item => item.id === nextBucket) ? 'schedule' : 'pipeline');
      setBucket(nextBucket);
    }
    if (WORK_FILTER_IDS.has(nextWork)) setWorkFilter(nextWork);
    setPage(0);
  }, [isActive, searchParams]);

  useEffect(() => {
    if (!isActive || (!isAdmin && !can('crm.view_all') && !can('crm.assign'))) return;
    loadEmployees().then(setEmployees).catch(() => setEmployees([]));
  }, [isActive, isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  const summary = data?.summary || {};
  const workSummary = data?.workSummary || {};
  const lensItems = lens === 'schedule'
    ? SCHEDULE_BUCKETS
    : [...SMART_BUCKETS, ...PIPELINE_BUCKETS, ...PLATFORM_BUCKETS];

  const chooseLens = nextLens => {
    setLens(nextLens);
    setWorkFilter('all');
    setSort('recommended');
    setBucket(nextLens === 'schedule' ? 'recontact_due' : 'hot_live_new');
  };

  const chooseBucket = nextBucket => {
    setBucket(nextBucket);
    setWorkFilter('all');
    setSort('recommended');
    setPage(0);
  };

  const chooseWorkFilter = nextFilter => {
    setWorkFilter(nextFilter);
    setPage(0);
  };

  const runSearch = event => {
    event?.preventDefault();
    setPage(0);
    setAppliedSearch(search.trim());
  };

  const hasNext = (page + 1) * (data?.limit || 40) < Number(data?.count || 0);

  const activeFilters = {
    bucket,
    ownerId: owner && owner !== 'unassigned' ? owner : null,
    unassigned: owner === 'unassigned',
    workFilter,
    sort,
    search: appliedSearch,
  };

  const eligibleEmployees = useMemo(() => employees.filter(employee => (
    employee.role !== 'admin'
    && employee.permissions?.['sales.view'] === true
    && employee.permissions?.['sales.manage'] === true
  )), [employees]);

  const readAllFilteredRows = async () => {
    const result = await loadAllPlatformSalesPipelineRows(activeFilters);
    if (result.rows.length !== result.count) {
      throw new Error('تغيّرت النتائج أثناء القراءة. حدّث الصفحة ثم أعد المحاولة.');
    }
    return result.rows;
  };

  const exportFilteredRows = async () => {
    setBulkBusy(true);
    try {
      const rows = await readAllFilteredRows();
      if (!rows.length) throw new Error('لا توجد نتائج لتصديرها');
      const exportRows = rows.map(row => ({
        'العميل / المتجر': row.primary_store || '—',
        'رقم الجوال': row.phone || '—',
        'عدد المتاجر': Number(row.store_count) || 1,
        'إجمالي الشحنات': Number(row.total_shipments) || 0,
        'آخر شحنة': row.last_shipment || '—',
        'أيام منذ آخر شحنة': row.days_since_last ?? '—',
        'حالة المنصة': platformState(row).label,
        'سبب الفرصة': signalMeta(row).label,
        'تفصيل الفرصة': row.signal_reason || row.next_step || '—',
        'أولوية البيع': Number(row.signal_score) || 0,
        'الإجراء المطلوب الآن': workMeta(row).label,
        'مرحلة البيع': stageMeta(row.sales_stage).label,
        'نتيجة آخر تواصل': OUTCOMES[row.last_outcome] || row.last_outcome || 'بلا نتيجة',
        'المسؤول': row.owner_name || 'بلا مسؤول',
        'نوع الإجراء القادم': NEXT_TYPES[row.next_action_type] || '—',
        'موعد المتابعة': row.next_action_at || '—',
        'عدد محاولات التواصل': Number(row.contact_attempts) || 0,
        'آخر تواصل': row.last_touch_at || '—',
        'رصيد المحفظة': Number(row.wallet) || 0,
        'ملاحظة': row.notes || '—',
      }));
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(exportRows);
      worksheet['!cols'] = [
        { wch: 32 }, { wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 14 },
        { wch: 18 }, { wch: 18 }, { wch: 20 }, { wch: 44 }, { wch: 14 },
        { wch: 24 }, { wch: 18 }, { wch: 22 }, { wch: 20 }, { wch: 20 },
        { wch: 22 }, { wch: 18 }, { wch: 22 }, { wch: 16 }, { wch: 44 },
      ];
      XLSX.utils.book_append_sheet(workbook, worksheet, 'عملاء المنصة');
      await persistAndDownloadExport({
        wb: rtl(workbook),
        fileName: `مسار-عملاء-المنصة-${new Date().toISOString().slice(0, 10)}.xlsx`,
        kind: 'platform_sales_pipeline',
        rowCount: exportRows.length,
        userId: user?.id || null,
      });
      toast(`تم تصدير ${exportRows.length} عميل إلى Excel`, 'success');
    } catch (error) {
      toast(`تعذّر التصدير: ${error.message}`, 'error');
    }
    setBulkBusy(false);
  };

  const openBulkAssignment = async () => {
    setBulkBusy(true);
    try {
      const rows = await readAllFilteredRows();
      if (!rows.length) throw new Error('لا توجد نتائج لإسنادها');
      setBulkRows(rows);
      setBulkOwner('');
      setBulkOpen(true);
    } catch (error) {
      toast(`تعذّر تجهيز الإسناد: ${error.message}`, 'error');
    }
    setBulkBusy(false);
  };

  const confirmBulkAssignment = async () => {
    if (!bulkOwner) return toast('اختر الموظف المسؤول', 'warning');
    setBulkBusy(true);
    try {
      const result = await assignPlatformSalesAccounts(bulkRows.map(row => row.phone), bulkOwner);
      toast(`تم إسناد ${Number(result.assigned_count) || bulkRows.length} عميل للموظف`, 'success');
      setBulkOpen(false);
      setBulkRows([]);
      setBulkOwner('');
      await refresh({ resetPage: true });
    } catch (error) {
      const messages = {
        assignee_not_sales_operator: 'الموظف لا يملك صلاحيات تشغيل المبيعات المطلوبة',
        selection_changed_refresh_required: 'تغيّرت قائمة العملاء. حدّث النتائج ثم أعد الإسناد',
        not_allowed: 'لا تملك صلاحية إسناد العملاء',
      };
      toast(`تعذّر الإسناد: ${messages[error.message] || error.message}`, 'error');
    }
    setBulkBusy(false);
  };

  return (
    <div className="psc-page">
      <PageHeader
        icon={<Target size={22}/>}
        iconColor="var(--gold)"
        title="مسار عملاء المنصّة"
        subtitle="من التسجيل إلى أول شحنة، ثم الاستمرار أو التوقف أو العودة — مع مسؤول وموعد وسجل لكل عميل"
        meta="حالة المنصّة موضوعية · مرحلة البيع يحدّثها الفريق"
        actions={(
          <>
            {(isAdmin || can('sales.export')) && (
              <Btn size="sm" variant="ghost" icon={<Download size={14}/>} onClick={exportFilteredRows} disabled={busy || bulkBusy || !data?.count}>
                تصدير Excel ({fmtNumber(data?.count)})
              </Btn>
            )}
            {(isAdmin || can('crm.assign')) && (
              <Btn size="sm" variant="primary" icon={<UserRoundPlus size={14}/>} onClick={openBulkAssignment} disabled={busy || bulkBusy || !data?.count}>
                إسناد كل النتائج ({fmtNumber(data?.count)})
              </Btn>
            )}
            <Btn
              size="sm"
              variant="ghost"
              icon={<RefreshCw size={14} className={busy ? 'spin' : ''}/>}
              onClick={() => refresh()}
              disabled={busy}
            >
              تحديث
            </Btn>
          </>
        )}
      />

      <div className="psc-summary-grid">
        <SummaryCard
          icon={<Zap size={18}/>}
          label="لايف جديد عالي النية"
          value={summary.hot_live_new}
          tone="var(--brand)"
          active={bucket === 'hot_live_new'}
          onClick={() => { setLens('pipeline'); chooseBucket('hot_live_new'); }}
          hint="ربط مباشر خلال 5 أيام"
        />
        <SummaryCard
          icon={<PhoneCall size={18}/>}
          label="تجاوز 5 أيام بلا شحن"
          value={summary.recent_stop}
          tone="var(--gold)"
          active={bucket === 'recent_stop'}
          onClick={() => { setLens('pipeline'); chooseBucket('recent_stop'); }}
          hint="يبدأ من اليوم السادس"
        />
        <SummaryCard
          icon={<WalletCards size={18}/>}
          label="رصيد يحتاج حلًا"
          value={summary.wallet_stranded}
          tone="var(--accent3)"
          active={bucket === 'wallet_stranded'}
          onClick={() => { setLens('pipeline'); chooseBucket('wallet_stranded'); }}
          hint="رصيد موجب بلا شحن حديث"
        />
        <SummaryCard
          icon={<Link2Off size={18}/>}
          label="ربط لايف غير نشط"
          value={summary.live_inactive}
          tone="var(--purple)"
          active={bucket === 'live_inactive'}
          onClick={() => { setLens('pipeline'); chooseBucket('live_inactive'); }}
          hint="يحتاج فهم سبب فك الربط"
        />
        <SummaryCard
          icon={<ShieldAlert size={18}/>}
          label="محوّلون للتحصيل"
          value={summary.collections_hold}
          tone="var(--red)"
          active={false}
          onClick={() => navigate('/customer-money')}
          hint="لا يظهرون لقوائم المبيعات"
        />
      </div>

      <div className="psc-workspace">
      <Card style={{ padding: 0 }}>
        <div className="psc-toolbar">
          <div className="psc-lens-toggle">
            <button type="button" className={lens === 'pipeline' ? 'active' : ''} onClick={() => chooseLens('pipeline')}>
              <Target size={15}/> مسار العملاء
            </button>
            <button type="button" className={lens === 'schedule' ? 'active' : ''} onClick={() => chooseLens('schedule')}>
              <CalendarClock size={15}/> جدول التواصل
            </button>
          </div>

          <form className="psc-search" onSubmit={runSearch}>
            <Search size={15}/>
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="اسم المتجر أو رقم الجوال"
            />
            <button type="submit">بحث</button>
          </form>

          {(isAdmin || can('crm.view_all')) && (
            <select value={owner} onChange={event => { setPage(0); setOwner(event.target.value); }} aria-label="فلتر المسؤول">
              <option value="">كل المسؤولين</option>
              <option value="unassigned">بلا مسؤول</option>
              {employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
            </select>
          )}
        </div>

        <div className="psc-bucket-groups">
          {lens === 'pipeline' ? (
            <>
              <div>
                <small>إشارات البيع الذكية</small>
                <BucketTabs items={SMART_BUCKETS} current={bucket} summary={summary} onPick={chooseBucket}/>
              </div>
              <div>
                <small>مرحلة البيع</small>
                <BucketTabs items={PIPELINE_BUCKETS} current={bucket} summary={summary} onPick={chooseBucket}/>
              </div>
              <div>
                <small>سلوك العميل في المنصّة</small>
                <BucketTabs items={PLATFORM_BUCKETS} current={bucket} summary={summary} onPick={chooseBucket}/>
              </div>
            </>
          ) : (
            <div>
              <small>جدول الفريق</small>
              <BucketTabs items={SCHEDULE_BUCKETS} current={bucket} summary={summary} onPick={chooseBucket}/>
            </div>
          )}
        </div>

        <div className="psc-work-controls">
          <div className="psc-work-controls-copy">
            <Target size={17}/>
            <div>
              <strong>من يحتاج ماذا الآن؟</strong>
              <small>فلترة تشغيلية لكل النتائج قبل تقسيم الصفحات</small>
            </div>
          </div>
          <div className="psc-work-filter-list" role="group" aria-label="فلتر حالة التواصل">
            {WORK_FILTERS.map(item => (
              <button
                type="button"
                key={item.id}
                className={workFilter === item.id ? 'active' : ''}
                aria-pressed={workFilter === item.id}
                onClick={() => chooseWorkFilter(item.id)}
              >
                <span>{item.label}</span>
                <b>{fmtNumber(workSummary[item.id === 'all' ? 'total' : item.id])}</b>
              </button>
            ))}
          </div>
          <label className="psc-sort-control">
            <span>الترتيب</span>
            <select value={sort} onChange={event => { setPage(0); setSort(event.target.value); }}>
              {SORT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>

        {summary.unscheduled > 0 && lens === 'schedule' && (
          <button type="button" className="psc-discipline-alert" onClick={() => chooseBucket('unscheduled')}>
            <AlertTriangle size={16}/>
            <span><b>{fmtNumber(summary.unscheduled)}</b> متابعة مفتوحة بلا موعد قادم — هذه فجوة إدارية وليست «قائمة فارغة».</span>
          </button>
        )}

        <div className="psc-table-head">
          <div>
            <strong>{lensItems.find(item => item.id === bucket)?.label || 'كل العملاء'}</strong>
            <small>
              عرض {fmtNumber(data?.count)} من {fmtNumber(workSummary.total)} عميل
              {workFilter !== 'all' ? ` · ${WORK_FILTERS.find(item => item.id === workFilter)?.label}` : ''}
            </small>
          </div>
          {busy && <Spinner size={17}/>}
        </div>

        {!busy && !data?.rows?.length ? (
          <Empty
            icon="🧭"
            title="لا يوجد عملاء في هذا التصنيف"
            sub={bucket === 'lost' ? 'عند تسجيل خسارة وسببها ستظهر هنا.' : 'غيّر الفلتر أو ابحث باسم آخر.'}
          />
        ) : (
          <div className="psc-table-wrap">
            <table className="m-cards psc-table">
              <thead>
                <tr>
                  <th>العميل</th>
                  <th>الإجراء الآن</th>
                  <th>سبب الفرصة</th>
                  <th>حالة التواصل</th>
                  <th>المسؤول والمتابعة</th>
                  <th>ملاحظة</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(data?.rows || []).map(row => {
                  const stage = stageMeta(row.sales_stage);
                  const state = platformState(row);
                  const signal = signalMeta(row);
                  const work = workMeta(row);
                  const due = row.next_action_at && new Date(row.next_action_at) <= new Date();
                  const daysSinceLast = Number(row.days_since_last) || 0;
                  const daysOverThreshold = Math.max(0, daysSinceLast - 5);
                  return (
                    <tr
                      key={row.phone}
                      className={Number(row.work_rank) <= 2 ? 'psc-row-urgent' : ''}
                    >
                      <td data-label="العميل">
                        <button type="button" className="psc-customer-link" onClick={() => setSelectedPhone(row.phone)}>
                          <strong>{row.primary_store || row.phone}</strong>
                          <small>{row.phone}{Number(row.store_count) > 1 ? ` · ${row.store_count} متاجر` : ''}</small>
                        </button>
                        <span className="psc-state-pill" style={{ '--pill-tone': state.color }}>{state.label}</span>
                        <small className="psc-cell-sub">
                          {fmtNumber(row.total_shipments)} شحنة · {integrationLabel(row)}
                        </small>
                      </td>
                      <td data-label="الإجراء الآن">
                        <span className="psc-action-pill" style={{ '--pill-tone': work.color }}>
                          {work.label}
                        </span>
                        <strong className="psc-action-detail">{work.detail}</strong>
                        <small className="psc-priority-score">أولوية {fmtNumber(row.signal_score)} / 100</small>
                      </td>
                      <td data-label="سبب الفرصة">
                        <span className="psc-signal-pill" style={{ '--pill-tone': signal.color }}>{signal.label}</span>
                        <small className="psc-signal-reason">{row.signal_reason || row.next_step || '—'}</small>
                        {daysSinceLast > 0 && (
                          <small className="psc-age-detail">
                            آخر شحنة قبل {fmtNumber(daysSinceLast)} يومًا
                            {row.commercial_signal === 'recent_stop' && ` · تجاوز الحد بـ${fmtNumber(daysOverThreshold)} يوم`}
                          </small>
                        )}
                      </td>
                      <td data-label="حالة التواصل">
                        <span className="psc-stage-pill" style={{ '--pill-tone': stage.color }}>{stage.label}</span>
                        <strong className="psc-contact-outcome">{OUTCOMES[row.last_outcome] || row.last_outcome || 'بلا نتيجة بعد'}</strong>
                        <small className="psc-cell-sub">
                          {fmtNumber(row.contact_attempts)} محاولة · آخر تواصل {fmtShortDate(row.last_touch_at)}
                        </small>
                      </td>
                      <td data-label="المسؤول والمتابعة">
                        <strong className={row.owner_name ? 'psc-owner-name' : 'psc-unassigned'}>
                          {row.owner_name || 'بلا مسؤول'}
                        </strong>
                        {row.next_action_at ? (
                          <small className={due ? 'psc-due' : 'psc-next-date'}>
                            {NEXT_TYPES[row.next_action_type] || 'إجراء'} · {fmtDate(row.next_action_at)}
                          </small>
                        ) : <small className="psc-missing-date">لا يوجد موعد قادم</small>}
                      </td>
                      <td
                        data-label="ملاحظة"
                        className={`psc-note-cell${row.notes ? '' : ' is-empty'}`}
                      >
                        <span className={`psc-note-preview${row.notes ? '' : ' empty'}`}>
                          {row.notes || 'لا توجد ملاحظة مسجلة'}
                        </span>
                      </td>
                      <td data-label="إجراءات">
                        <div className="psc-row-actions">
                          <WaActions phone={row.phone} name={row.primary_store} campaignLabel="متابعة مبيعات" size={16}/>
                          <Btn size="sm" variant="ghost" onClick={() => setSelectedPhone(row.phone)}>التفاصيل</Btn>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="psc-pagination">
          <Btn size="sm" variant="ghost" disabled={page === 0 || busy} onClick={() => setPage(current => Math.max(0, current - 1))}>السابق</Btn>
          <span>صفحة {page + 1}</span>
          <Btn size="sm" variant="ghost" disabled={!hasNext || busy} onClick={() => setPage(current => current + 1)}>التالي</Btn>
        </div>
      </Card>
      </div>

      {selectedPhone && (
        <AccountDrawer
          phone={selectedPhone}
          employees={employees}
          onClose={() => setSelectedPhone('')}
          onSaved={() => refresh()}
        />
      )}

      {bulkOpen && (
        <Modal title="إسناد كل نتائج الفلتر" onClose={() => !bulkBusy && setBulkOpen(false)} width={560}>
          <div className="psc-bulk-assignment">
            <div className="psc-bulk-summary">
              <UserRoundPlus size={22}/>
              <div>
                <strong>{fmtNumber(bulkRows.length)} عميل سيُسندون دفعة واحدة</strong>
                <small>
                  {fmtNumber(bulkRows.filter(row => !row.owner_id).length)} بلا مسؤول · {' '}
                  {fmtNumber(bulkRows.filter(row => row.owner_id).length)} مسندون حاليًا
                </small>
              </div>
            </div>

            <label className="psc-bulk-field">
              <span>الموظف المسؤول</span>
              <Select value={bulkOwner} onChange={event => setBulkOwner(event.target.value)}>
                <option value="">اختر موظف المبيعات…</option>
                {eligibleEmployees.map(employee => (
                  <option key={employee.id} value={employee.id}>{employee.name || employee.email}</option>
                ))}
              </Select>
            </label>

            <div className="psc-bulk-safety">
              سيُغيّر الإسناد اسم المسؤول فقط. لن يغيّر مرحلة العميل أو نتيجة التواصل أو الموعد أو الملاحظات أو أي مبلغ مالي.
            </div>

            <div className="psc-bulk-actions">
              <Btn variant="ghost" onClick={() => setBulkOpen(false)} disabled={bulkBusy}>إلغاء</Btn>
              <Btn variant="primary" icon={<UserRoundPlus size={15}/>} onClick={confirmBulkAssignment} disabled={bulkBusy || !bulkOwner}>
                {bulkBusy ? 'جارٍ الإسناد…' : `تأكيد إسناد ${fmtNumber(bulkRows.length)} عميل`}
              </Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

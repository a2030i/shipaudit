import { useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, CalendarClock, CheckCircle2, Clock3,
  History, MessageSquareText, PhoneCall, RefreshCw, RotateCcw,
  Search, Store, Target, TrendingUp, UserRoundCheck, UserRoundX,
  UsersRound, WalletCards,
} from 'lucide-react';
import {
  Btn, Card, Empty, Input, Modal, PageHeader, Select, Spinner, toast,
} from '../components/UI.jsx';
import WaActions from '../components/WaActions.jsx';
import { useAuth } from '../lib/auth.jsx';
import { loadEmployees } from '../lib/employeeService.js';
import {
  loadPlatformSalesAccount,
  loadPlatformSalesPipeline,
  recordPlatformSalesActivity,
} from '../lib/retargetingService.js';
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
  return { label: 'لم ينفّذ أول شحنة', color: 'var(--brand)' };
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
      };
      toast(messages[error.message] || `تعذّر الحفظ: ${error.message}`, 'error');
    }
    setSaving(false);
  };

  const account = payload?.account || {};
  const state = platformState({
    platform_state: account.segment === 'negative_balance'
      ? 'financial_hold'
      : account.total_shipments === 0
        ? 'pending_first_shipment'
        : account.segment === 'active'
          ? 'active'
          : 'stopped',
  });

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
            <div><small>المحفظة</small><strong>{fmtMoney(account.wallet)}</strong></div>
            <div><small>الربط</small><strong>{account.integration_type || 'غير مربوط'}</strong></div>
            <div><small>محاولات التواصل</small><strong>{fmtNumber(account.contact_attempts)}</strong></div>
            <div><small>المسؤول</small><strong>{account.owner_name || 'بلا مسؤول'}</strong></div>
          </div>

          <div className="psc-drawer-grid">
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
  const { can, isAdmin } = useAuth();
  const [lens, setLens] = useState('pipeline');
  const [bucket, setBucket] = useState('new');
  const [data, setData] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [owner, setOwner] = useState('');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [selectedPhone, setSelectedPhone] = useState('');

  const refresh = async ({ resetPage = false } = {}) => {
    const targetPage = resetPage ? 0 : page;
    if (resetPage) setPage(0);
    setBusy(true);
    try {
      setData(await loadPlatformSalesPipeline({
        bucket,
        ownerId: owner && owner !== 'unassigned' ? owner : null,
        unassigned: owner === 'unassigned',
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
  }, [isActive, bucket, owner, appliedSearch, page]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isActive || (!isAdmin && !can('crm.view_all') && !can('crm.assign'))) return;
    loadEmployees().then(setEmployees).catch(() => setEmployees([]));
  }, [isActive, isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  const summary = data?.summary || {};
  const lensItems = lens === 'schedule'
    ? SCHEDULE_BUCKETS
    : [...PIPELINE_BUCKETS, ...PLATFORM_BUCKETS];

  const chooseLens = nextLens => {
    setLens(nextLens);
    setBucket(nextLens === 'schedule' ? 'recontact_due' : 'new');
  };

  const chooseBucket = nextBucket => {
    setBucket(nextBucket);
    setPage(0);
  };

  const runSearch = event => {
    event?.preventDefault();
    setPage(0);
    setAppliedSearch(search.trim());
  };

  const hasNext = (page + 1) * (data?.limit || 40) < Number(data?.count || 0);

  return (
    <div className="psc-page">
      <PageHeader
        icon={<Target size={22}/>}
        iconColor="var(--gold)"
        title="مسار عملاء المنصّة"
        subtitle="من التسجيل إلى أول شحنة، ثم الاستمرار أو التوقف أو العودة — مع مسؤول وموعد وسجل لكل عميل"
        meta="حالة المنصّة موضوعية · مرحلة البيع يحدّثها الفريق"
        actions={(
          <Btn
            size="sm"
            variant="ghost"
            icon={<RefreshCw size={14} className={busy ? 'spin' : ''}/>}
            onClick={() => refresh()}
            disabled={busy}
          >
            تحديث
          </Btn>
        )}
      />

      <div className="psc-summary-grid">
        <SummaryCard
          icon={<Store size={18}/>}
          label="جدد خلال 30 يومًا"
          value={summary.new}
          tone="var(--brand)"
          active={bucket === 'new'}
          onClick={() => { setLens('pipeline'); chooseBucket('new'); }}
          hint="لم ينفّذوا أول شحنة"
        />
        <SummaryCard
          icon={<CalendarClock size={18}/>}
          label="إعادة تواصل مستحقة"
          value={summary.recontact_due}
          tone="var(--red)"
          active={bucket === 'recontact_due'}
          onClick={() => { setLens('schedule'); chooseBucket('recontact_due'); }}
          hint="موعدها الآن أو متأخر"
        />
        <SummaryCard
          icon={<RotateCcw size={18}/>}
          label="اشتغلوا ثم توقفوا"
          value={summary.stopped}
          tone="var(--gold)"
          active={bucket === 'stopped'}
          onClick={() => { setLens('pipeline'); chooseBucket('stopped'); }}
          hint="لهم شحنات سابقة"
        />
        <SummaryCard
          icon={<UserRoundX size={18}/>}
          label="خسرناهم"
          value={summary.lost}
          tone="var(--red)"
          active={bucket === 'lost'}
          onClick={() => { setLens('pipeline'); chooseBucket('lost'); }}
          hint="بسبب مسجل وقابل للتحليل"
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

        {summary.unscheduled > 0 && lens === 'schedule' && (
          <button type="button" className="psc-discipline-alert" onClick={() => chooseBucket('unscheduled')}>
            <AlertTriangle size={16}/>
            <span><b>{fmtNumber(summary.unscheduled)}</b> متابعة مفتوحة بلا موعد قادم — هذه فجوة إدارية وليست «قائمة فارغة».</span>
          </button>
        )}

        <div className="psc-table-head">
          <div>
            <strong>{lensItems.find(item => item.id === bucket)?.label || 'كل العملاء'}</strong>
            <small>{fmtNumber(data?.count)} عميل مطابق</small>
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
                  <th>حالة المنصّة</th>
                  <th>مرحلة البيع</th>
                  <th>المسؤول</th>
                  <th>آخر تواصل</th>
                  <th>التواصل القادم</th>
                  <th>ملاحظة</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(data?.rows || []).map(row => {
                  const stage = stageMeta(row.sales_stage);
                  const state = platformState(row);
                  const due = row.next_action_at && new Date(row.next_action_at) <= new Date();
                  return (
                    <tr key={row.phone}>
                      <td data-label="العميل">
                        <button type="button" className="psc-customer-link" onClick={() => setSelectedPhone(row.phone)}>
                          <strong>{row.primary_store || row.phone}</strong>
                          <small>{row.phone}{Number(row.store_count) > 1 ? ` · ${row.store_count} متاجر` : ''}</small>
                        </button>
                      </td>
                      <td data-label="حالة المنصّة">
                        <span className="psc-state-pill" style={{ '--pill-tone': state.color }}>{state.label}</span>
                        <small className="psc-cell-sub">{fmtNumber(row.total_shipments)} شحنة</small>
                      </td>
                      <td data-label="مرحلة البيع">
                        <span className="psc-stage-pill" style={{ '--pill-tone': stage.color }}>{stage.label}</span>
                        <small className="psc-cell-sub">{OUTCOMES[row.last_outcome] || row.last_outcome || '—'}</small>
                      </td>
                      <td data-label="المسؤول">{row.owner_name || <span className="psc-unassigned">بلا مسؤول</span>}</td>
                      <td data-label="آخر تواصل">{fmtDate(row.last_touch_at)}</td>
                      <td data-label="التواصل القادم">
                        {row.next_action_at ? (
                          <span className={due ? 'psc-due' : ''}>
                            {NEXT_TYPES[row.next_action_type] || 'إجراء'} · {fmtDate(row.next_action_at)}
                          </span>
                        ) : <span className="psc-missing-date">غير مجدول</span>}
                      </td>
                      <td data-label="ملاحظة">
                        <span className="psc-note-preview">{row.notes || '—'}</span>
                      </td>
                      <td>
                        <Btn size="sm" variant="ghost" onClick={() => setSelectedPhone(row.phone)}>فتح الملف</Btn>
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
    </div>
  );
}

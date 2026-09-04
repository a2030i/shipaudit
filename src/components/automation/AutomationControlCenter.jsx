import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, Bot, Check, ChevronLeft, ChevronRight,
  Database, Eye, Filter, History, MoreVertical,
  PauseCircle, Plus, RefreshCw, Search, Settings2, ShieldCheck, SlidersHorizontal,
  Sparkles, Users, X,
} from 'lucide-react';
import { Btn, Card, Spinner } from '../UI.jsx';
import { useAuth } from '../../lib/auth.jsx';
import {
  loadAutomationRules, loadAutomationRuns, previewAutomationRule, saveAutomationRule,
} from '../../lib/workAgentService.js';
import { loadWhatsAppConfig } from '../../lib/whatsappService.js';

const CATEGORY = {
  sales: 'المبيعات', retention: 'الحفاظ على العملاء', collections: 'التحصيل', operations: 'التشغيل',
};
const SOURCE = { lamha: 'لمحة', zoho: 'Zoho Books', hatif: 'هاتف', manual: 'يدوي' };
const EVENT = {
  new_customer: 'ظهور عميل جديد', invoice_overdue: 'بلوغ عمر فاتورة',
  account_deactivated: 'انتقال الحساب إلى inactive', stopped_shipping: 'تجاوز مدة منذ آخر شحنة',
  never_shipped: 'لم ينفذ أي شحنة', manual: 'تشغيل يدوي',
};
const STATUS = {
  draft: ['مسودة', 'neutral'], preview: ['معاينة', 'info'], review: ['تحتاج مراجعة', 'warning'],
  active: ['نشطة', 'success'], paused: ['متوقفة', 'warning'], error: ['تحتاج تدخلًا', 'danger'], archived: ['مؤرشفة', 'neutral'],
};
const MODE = { preview: 'معاينة فقط', review: 'مراجعة قبل التنفيذ', automatic: 'تنفيذ تلقائي' };
const DEDUPE_MODE = {
  once_per_snapshot_phone: 'مرة واحدة للجوال في كل فحص مزامنة',
  within_hours: 'منع تكرار الجوال خلال مدة محددة',
};
const STEPS = [
  ['identity', 'التعريف', 'اسم الوكيل وهدفه'],
  ['trigger', 'المحفز والشروط', 'متى يظهر العميل'],
  ['audience', 'الجمهور والاستثناءات', 'من يدخل ومن يُستبعد'],
  ['template', 'القالب والمتغيرات', 'محتوى هاتف'],
  ['safety', 'التوقيت والحماية', 'التكرار وحدود التشغيل'],
  ['review', 'المعاينة والتفعيل', 'قرار قبل الاعتماد'],
];
const EXCLUSION_LABELS = {
  invalid_phone: 'رقم جوال غير صالح', blocked_phone: 'رقم محظور أو غير قابل للتسليم',
  duplicate_phone: 'تكرار الجوال داخل الجمهور', previous_same_template: 'سبق إرسال القالب ضمن مدة الحماية',
  draft_invoice: 'فاتورة مسودة', residual_balance_only: 'رصيد هامشي فقط',
  recent_collection_message: 'تواصل تحصيل حديث', unknown_transition: 'انتقال حالة غير مؤكد',
  inactive_account: 'الحساب موقوف في لمحة', recent_retention_contact: 'تواصل احتفاظ حديث',
  recent_sales_contact: 'تواصل مبيعات حديث',
};
const EMPTY_RULE = {
  name: '', objective: '', category: 'sales', status: 'draft', execution_mode: 'preview',
  event_type: 'new_customer', trigger_source: 'lamha', trigger_config: { lookbackHours: 24 },
  conditions: [], exclusions: ['invalid_phone', 'blocked_phone', 'duplicate_phone'],
  template_name: '', template_language: 'ar',
  template_variables: [{ position: 1, mode: 'fixed', value: '' }, { position: 2, mode: 'fixed', value: '' }],
  schedule_config: {
    afterSuccessfulSync: true,
    delayMinutes: 10,
    sendWindowStart: '09:00',
    sendWindowEnd: '20:00',
    deferFridayMorning: false,
    fridayMorningCutoff: '12:00',
    fridayDeferredUntil: '18:00',
  },
  safeguards: { audienceIdentity: 'normalized_phone', dedupeMode: 'within_hours', dedupeHours: 336, maxMessagesPerPhonePerDay: 1, maxRecipientsPerRun: 500, requireFreshSources: true, retryConfirmedFailures: 1, blockUnknownDeliveryRetry: true },
};

const dateTime = value => value ? new Date(value).toLocaleString('ar-SA', { dateStyle: 'short', timeStyle: 'short' }) : 'لم يعمل بعد';
const number = value => Number(value || 0).toLocaleString('en-US');
const clone = value => JSON.parse(JSON.stringify(value));
const timeMinutes = value => {
  const [hour, minute] = String(value || '').split(':').map(Number);
  return Number.isInteger(hour) && Number.isInteger(minute) ? (hour * 60) + minute : Number.NaN;
};
const validateSchedule = rule => {
  if (rule.rule_key !== 'welcome_new_customer' || !rule.schedule_config?.deferFridayMorning) return '';
  const start = timeMinutes(rule.schedule_config.sendWindowStart);
  const end = timeMinutes(rule.schedule_config.sendWindowEnd);
  const cutoff = timeMinutes(rule.schedule_config.fridayMorningCutoff);
  const deferred = timeMinutes(rule.schedule_config.fridayDeferredUntil);
  if (![start, end, cutoff, deferred].every(Number.isFinite) || start >= end) return 'تحقق من بداية ونهاية نافذة الإرسال.';
  if (deferred <= cutoff || deferred < start || deferred > end) return 'وقت الإرسال المؤجل يجب أن يكون بعد فترة الصباح وداخل نافذة الإرسال.';
  return '';
};

function Status({ value }) {
  const [label, tone] = STATUS[value] || STATUS.draft;
  return <span className={`automation-status ${tone}`}><i />{label}</span>;
}

function SummaryStrip({ rules, runs }) {
  const latest = runs[0];
  const values = [
    ['القواعد الجاهزة', rules.filter(rule => ['active', 'review'].includes(rule.status)).length, 'من إجمالي القواعد', Bot],
    ['بانتظار المراجعة', runs.reduce((sum, run) => sum + Number(run.review_count || 0), 0), 'في سجل المعاينات', Users],
    ['إجراءات اليوم', runs.filter(run => new Date(run.started_at).toDateString() === new Date().toDateString()).reduce((sum, run) => sum + Number(run.action_count || 0), 0), 'لا تشمل المعاينات', Activity],
    ['الإخفاقات', latest?.failed_count || 0, latest ? `آخر تشغيل ${dateTime(latest.started_at)}` : 'لا يوجد تشغيل', AlertTriangle],
    ['سلامة المصادر', 'مقيدة', 'لا تنفيذ ببيانات قديمة', Database],
  ];
  return <div className="automation-summary" aria-label="ملخص تشغيل الأتمتة">
    {values.map(([label, value, note, Icon]) => <div key={label} className="automation-summary-item">
      <Icon size={17}/><span><small>{label}</small><strong>{typeof value === 'number' ? number(value) : value}</strong><em>{note}</em></span>
    </div>)}
  </div>;
}

function RuleRow({ rule, onOpen }) {
  return <button type="button" className="automation-rule-row" onClick={() => onOpen(rule)}>
    <span className="rule-status"><Status value={rule.status}/></span>
    <span className="rule-name"><strong>{rule.name}</strong><small>{rule.objective}</small></span>
    <span><b>{EVENT[rule.event_type] || rule.event_type}</b><small>{SOURCE[rule.trigger_source] || rule.trigger_source}</small></span>
    <span className="rule-audience"><strong>{rule.last_preview_count == null ? '—' : number(rule.last_preview_count)}</strong><small>{rule.last_preview_at ? `معاينة ${dateTime(rule.last_preview_at)}` : 'لم تُعاين'}</small></span>
    <span><b dir="ltr">{rule.template_name || 'غير محدد'}</b><small>{MODE[rule.execution_mode]}</small></span>
    <span><b>{dateTime(rule.last_run_at)}</b><small>{rule.next_run_at ? `القادم ${dateTime(rule.next_run_at)}` : rule.schedule_config?.afterSuccessfulSync ? 'بعد مزامنة المصدر الناجحة' : 'لا يوجد موعد معتمد'}</small></span>
    <span className="rule-open"><MoreVertical size={18}/></span>
  </button>;
}

function Field({ label, hint, children }) {
  return <label className="automation-field"><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
}

function VariableEditor({ variables, onChange, minimum = 1, maximum = Number.POSITIVE_INFINITY }) {
  const update = (index, patch) => onChange(variables.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  const add = () => onChange([...variables, { position: variables.length + 1, mode: 'fixed', value: '' }]);
  const remove = index => onChange(variables.filter((_, itemIndex) => itemIndex !== index).map((item, itemIndex) => ({ ...item, position: itemIndex + 1 })));
  return <div className="automation-vars">
    {variables.map((item, index) => <div className="automation-var" key={`${item.position}-${index}`}>
      <code>{`{{${index + 1}}}`}</code>
      <input value={item.value || ''} onChange={event => update(index, { value: event.target.value, mode: 'fixed' })} placeholder={index === 0 ? 'مثال: أحمد من قسم المبيعات' : 'اكتب قيمة المتغير'}/>
      <button type="button" onClick={() => remove(index)} aria-label={`حذف المتغير ${index + 1}`} disabled={variables.length <= minimum}><X size={15}/></button>
    </div>)}
    {variables.length < maximum ? <button type="button" className="automation-inline-action" onClick={add}><Plus size={15}/> إضافة متغير</button> : null}
    <p className="automation-note">تُرسل القيم المكتوبة كما هي لكل مستلم. لا يستنتج النظام اسم موظف أو متجر دون اختيارك.</p>
  </div>;
}

function AudiencePreview({ preview, loading }) {
  if (loading) return <div className="automation-preview-loading"><Spinner/><span>جارٍ فحص البيانات الحقيقية دون إرسال…</span></div>;
  if (!preview) return <div className="automation-empty compact"><Eye size={22}/><strong>لم تُجر معاينة بعد</strong><span>المعاينة قراءة فقط، وتعرض المؤهلين والاستثناءات قبل أي اعتماد.</span></div>;
  return <div className="automation-preview">
    <div className="automation-preview-counts">
      <span><small>المطابقون</small><strong>{number(preview.total)}</strong></span>
      <span className="success"><small>مؤهل</small><strong>{number(preview.eligible)}</strong></span>
      <span className="warning"><small>يحتاج مراجعة</small><strong>{number(preview.review)}</strong></span>
      <span className="danger"><small>مستبعد</small><strong>{number(preview.ineligible)}</strong></span>
    </div>
    <div className="automation-preview-source"><Database size={15}/><span>المصدر: {preview.source || 'غير محدد'}</span></div>
    {preview.notice ? <div className="automation-warning"><AlertTriangle size={16}/>{preview.notice}</div> : null}
    <div className="automation-preview-list">
      {(preview.items || []).slice(0, 20).map((item, index) => <div key={`${item.phone || item.storeId || index}`}>
        <span><b>{item.name || item.customerName || 'بلا اسم'}</b><small dir="ltr">{item.phone || 'بلا جوال'}</small></span>
        <span><b>{item.amount != null ? `${Number(item.amount).toLocaleString('en-US', { maximumFractionDigits: 2 })} ر.س` : item.storeCount > 1 ? `${item.storeCount} متاجر` : item.lastShipment ? dateTime(item.lastShipment) : '—'}</b><small className={item.decision}>{item.reason}</small></span>
      </div>)}
      {preview.total > 20 ? <p>تعرض المعاينة أول 20 سجلًا من أصل {number(preview.total)}.</p> : null}
    </div>
  </div>;
}

function RuleDrawer({ rule, templates, canManage, onClose, onSaved }) {
  const [draft, setDraft] = useState(() => clone(rule || EMPTY_RULE));
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState(null);
  const [notice, setNotice] = useState('');
  const patch = value => setDraft(current => ({ ...current, ...value }));
  const current = STEPS[step][0];
  const save = async (statusOverride) => {
    const scheduleError = validateSchedule(draft);
    if (scheduleError) { setNotice(scheduleError); setStep(STEPS.findIndex(([key]) => key === 'safety')); return null; }
    setSaving(true); setNotice('');
    try {
      const saved = await saveAutomationRule({ ...draft, status: statusOverride || draft.status }, rule ? 'تحديث من مركز الأتمتة' : 'إنشاء من مركز الأتمتة');
      setDraft(saved); setNotice('تم حفظ نسخة جديدة من القاعدة. لا يوجد إرسال ناتج عن الحفظ.');
      await onSaved(saved);
      return saved;
    } catch (error) { setNotice(error?.message || 'تعذر حفظ القاعدة'); return null; }
    finally { setSaving(false); }
  };
  const runPreview = async () => {
    setPreviewing(true); setNotice('');
    try {
      const saved = draft.id ? await save() : await save('preview');
      if (!saved?.id) return;
      const result = await previewAutomationRule(saved.id);
      setPreview(result); setDraft(saved); setStep(STEPS.length - 1);
    } catch (error) { setNotice(error?.message || 'تعذرت المعاينة'); }
    finally { setPreviewing(false); }
  };
  const toggleExclusion = key => patch({ exclusions: draft.exclusions.includes(key) ? draft.exclusions.filter(item => item !== key) : [...draft.exclusions, key] });
  return <div className="automation-drawer-backdrop" role="dialog" aria-modal="true" aria-label="إعداد قاعدة الأتمتة" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <aside className="automation-drawer">
      <header><div><small>{draft.id ? `الإصدار ${draft.version}` : 'قاعدة جديدة'}</small><h2>{draft.name || 'قاعدة أتمتة جديدة'}</h2><p>إعداد القرار والجمهور والقالب والحماية في سياق واحد.</p></div><button type="button" onClick={onClose} aria-label="إغلاق"><X size={19}/></button></header>
      <div className="automation-builder">
        <nav aria-label="مراحل إنشاء القاعدة">
          <div className="automation-mobile-progress" aria-live="polite">
            <span><b>{STEPS[step][1]}</b><small>{step + 1} من {STEPS.length}</small></span>
            <progress max={STEPS.length} value={step + 1}/>
          </div>
          {STEPS.map(([key, label, hint], index) => <button type="button" key={key} className={index === step ? 'active' : index < step ? 'done' : ''} onClick={() => setStep(index)}>
            <i>{index < step ? <Check size={14}/> : index + 1}</i><span><b>{label}</b><small>{hint}</small></span>
          </button>)}
        </nav>
        <main>
          {current === 'identity' ? <section>
            <h3>تعريف الوكيل</h3><p>اجعل الاسم يصف النتيجة التي يملكها الوكيل، لا التقنية المستخدمة.</p>
            <Field label="اسم القاعدة"><input value={draft.name} onChange={event => patch({ name: event.target.value })} placeholder="مثال: ترحيب العميل الجديد"/></Field>
            <Field label="الهدف التشغيلي"><textarea rows="3" value={draft.objective} onChange={event => patch({ objective: event.target.value })} placeholder="ما النتيجة التي يجب أن يحققها الوكيل؟"/></Field>
            <div className="automation-form-grid"><Field label="الفريق المسؤول"><select value={draft.category} onChange={event => patch({ category: event.target.value })}>{Object.entries(CATEGORY).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="طريقة العمل"><select value={draft.execution_mode} onChange={event => patch({ execution_mode: event.target.value })}>{Object.entries(MODE).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="حالة القاعدة" hint="نشطة + تنفيذ تلقائي يعني العمل بعد المزامنة القادمة."><select value={draft.status || 'draft'} onChange={event => patch({ status: event.target.value })}><option value="draft">مسودة</option><option value="preview">معاينة</option><option value="review">تحتاج مراجعة</option><option value="active">نشطة</option><option value="paused">متوقفة</option></select></Field></div>
            <div className="automation-info"><Bot size={18}/><span><b>حدود الوكيل</b> يقرأ ويجهز الجمهور ويطبق الحماية. هذه الصفحة لا تمنحه صلاحية إيقاف حساب أو تعديل Zoho.</span></div>
          </section> : null}
          {current === 'trigger' ? <section>
            <h3>المحفز والشروط</h3><p>الوكيل يعمل عند حدوث إشارة واضحة، وليس بمجرد مرور الوقت دون مصدر حديث.</p>
            <div className="automation-form-grid"><Field label="المصدر"><select value={draft.trigger_source} onChange={event => patch({ trigger_source: event.target.value })}>{Object.entries(SOURCE).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="الحدث"><select value={draft.event_type} onChange={event => patch({ event_type: event.target.value })}>{Object.entries(EVENT).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field></div>
            {['invoice_overdue', 'stopped_shipping', 'never_shipped'].includes(draft.event_type) ? <div className="automation-form-grid"><Field label={draft.event_type === 'invoice_overdue' ? 'عمر الفاتورة بالأيام' : 'عدد الأيام'}><input type="number" min="1" max="3650" value={draft.trigger_config?.days ?? 5} onChange={event => patch({ trigger_config: { ...draft.trigger_config, days: Number(event.target.value) } })}/></Field>{draft.event_type === 'invoice_overdue' ? <Field label="الحد الأدنى التشغيلي"><input type="number" min="0" step="0.01" value={draft.trigger_config?.minAmount ?? 0.5} onChange={event => patch({ trigger_config: { ...draft.trigger_config, minAmount: Number(event.target.value) } })}/><small>يستخدم الفواتير القابلة للتحصيل، ولا يعد الرصيد الهامشي دينًا تشغيليًا.</small></Field> : <Field label="آلية القياس"><input value="عند عبور الحد مرة واحدة" disabled/></Field>}</div> : <Field label="نافذة التقاط الحدث (ساعة)"><input type="number" min="1" max="720" value={draft.trigger_config?.lookbackHours ?? 24} onChange={event => patch({ trigger_config: { ...draft.trigger_config, lookbackHours: Number(event.target.value) } })}/></Field>}
            <div className="automation-condition-list"><h4>الشروط الحالية</h4>{(draft.conditions || []).length ? draft.conditions.map((condition, index) => <div key={`${condition.field}-${index}`}><SlidersHorizontal size={15}/><code>{condition.field}</code><span>{condition.operator}</span><b>{String(condition.value ?? '')}</b></div>) : <p>تُبنى الشروط من المحفز المختار عند الحفظ.</p>}</div>
          </section> : null}
          {current === 'audience' ? <section>
            <h3>الجمهور والاستثناءات</h3><p>هوية الجمهور هي رقم الجوال السعودي المطبّع، ويحدد نطاق المنع متى يسمح برسالة جديدة.</p>
            <div className="automation-identity-rule"><Users size={18}/><span><b>{draft.safeguards?.dedupeMode === 'once_per_snapshot_phone' ? 'رسالة واحدة للجوال داخل الفحص نفسه' : 'رسالة واحدة للجوال خلال مدة الحماية'}</b><small>{draft.safeguards?.dedupeMode === 'once_per_snapshot_phone' ? 'متجر جديد في فحص لاحق يستحق ترحيبًا جديدًا، ولو كان جواله مرتبطًا بمتجر سابق.' : 'تُدمج المتاجر المشتركة في رقم واحد خلال مدة الحماية المحددة.'}</small></span></div>
            <div className="automation-exclusions">{Object.entries(EXCLUSION_LABELS).map(([key, label]) => <label key={key}><input type="checkbox" checked={draft.exclusions.includes(key)} onChange={() => toggleExclusion(key)}/><span>{label}</span></label>)}</div>
            <div className="automation-warning"><AlertTriangle size={17}/><span>{draft.safeguards?.dedupeMode === 'once_per_snapshot_phone' ? 'إذا ظهر متجران جديدان بالجوال نفسه في لقطة المزامنة نفسها، يرسل النظام رسالة واحدة فقط. ظهور متجر جديد بالجوال نفسه في لقطة لاحقة يسمح برسالة جديدة.' : 'إذا كان للجوال عدة متاجر والقالب يذكر متجرًا بعينه، تنتقل الحالة للمراجعة بدل اختيار اسم قد يكون مضللًا.'}</span></div>
          </section> : null}
          {current === 'template' ? <section>
            <h3>القالب والمتغيرات</h3><p>كل قالب ظاهر هنا مسجل ضمن القوالب المعتمدة في إعدادات هاتف.</p>
            <Field label="قالب هاتف"><select value={draft.template_name || ''} onChange={event => patch({ template_name: event.target.value })}><option value="">اختر القالب</option>{templates.map(template => <option value={template} key={template}>{template}</option>)}</select></Field>
            <Field label="لغة القالب"><input value="العربية" disabled/></Field>
            <h4 className="automation-subtitle">قيم المتغيرات</h4>
            <VariableEditor variables={draft.template_variables || []} minimum={draft.template_name === 'masrah' ? 2 : 1} maximum={draft.template_name === 'masrah' ? 2 : Number.POSITIVE_INFINITY} onChange={template_variables => patch({ template_variables })}/>
            <div className="automation-template-preview"><small>معاينة الربط</small><strong dir="ltr">{draft.template_name || 'template_name'}</strong>{(draft.template_variables || []).map(variable => <p key={variable.position}><code>{`{{${variable.position}}}`}</code><span>{variable.value || 'لم تُكتب القيمة'}</span></p>)}</div>
          </section> : null}
          {current === 'safety' ? <section>
            <h3>التوقيت والحماية</h3><p>التشغيل بعد نجاح المصدر؛ تعطل هاتف لا يلغي مزامنة لمحة أو Zoho.</p>
            <label className="automation-switch"><input type="checkbox" checked={!!draft.schedule_config?.afterSuccessfulSync} onChange={event => patch({ schedule_config: { ...draft.schedule_config, afterSuccessfulSync: event.target.checked } })}/><span><b>بعد نجاح المزامنة</b><small>لا يعمل على لقطة جزئية أو فاشلة.</small></span></label>
            <Field label="نطاق منع التكرار"><select value={draft.safeguards?.dedupeMode || 'within_hours'} onChange={event => patch({ safeguards: { ...draft.safeguards, dedupeMode: event.target.value } })}>{Object.entries(DEDUPE_MODE).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
            {draft.safeguards?.dedupeMode === 'once_per_snapshot_phone' ? <div className="automation-info"><ShieldCheck size={18}/><span><b>قاعدة الترحيب الحالية</b> نفس الجوال داخل الفحص = رسالة واحدة. متجر جديد في فحص لاحق = رسالة جديدة.</span></div> : null}
            {draft.rule_key === 'welcome_new_customer' ? <>
              <label className="automation-switch"><input type="checkbox" checked={!!draft.schedule_config?.deferFridayMorning} onChange={event => patch({ schedule_config: { ...draft.schedule_config, deferFridayMorning: event.target.checked } })}/><span><b>منع الإرسال صباح الجمعة</b><small>يحفظ جمهور فحص الصباح كما هو ويؤجل رسائله إلى دفعة المساء؛ لا يعيد بناء الجمهور ولا يفقد العملاء الجدد.</small></span></label>
              {draft.schedule_config?.deferFridayMorning ? <div className="automation-form-grid automation-friday-policy"><Field label="نهاية فترة صباح الجمعة" hint="أي فحص يوم الجمعة قبل هذا الوقت يُؤجل."><input type="time" value={draft.schedule_config?.fridayMorningCutoff || '12:00'} onChange={event => patch({ schedule_config: { ...draft.schedule_config, fridayMorningCutoff: event.target.value } })}/></Field><Field label="وقت الإرسال المؤجل"><input type="time" value={draft.schedule_config?.fridayDeferredUntil || '18:00'} onChange={event => patch({ schedule_config: { ...draft.schedule_config, fridayDeferredUntil: event.target.value } })}/></Field></div> : null}
              {draft.schedule_config?.deferFridayMorning ? <div className="automation-info"><History size={18}/><span><b>سياسة الجمعة الحالية</b> لا إرسال في دفعة الصباح. الجمهور المحفوظ ينتظر حتى {draft.schedule_config?.fridayDeferredUntil || '18:00'} بتوقيت السعودية، ثم يدخل مسار الإرسال المعتاد.</span></div> : null}
            </> : null}
            <div className="automation-form-grid"><Field label="الانتظار بعد المزامنة (دقيقة)"><input type="number" min="0" max="180" value={draft.schedule_config?.delayMinutes ?? 10} onChange={event => patch({ schedule_config: { ...draft.schedule_config, delayMinutes: Number(event.target.value) } })}/></Field>{draft.safeguards?.dedupeMode !== 'once_per_snapshot_phone' ? <Field label="منع تكرار القالب (ساعة)" hint="المقترح: 168 للتحصيل و336 للاحتفاظ."><input type="number" min="1" max="8760" value={draft.safeguards?.dedupeHours ?? 336} onChange={event => patch({ safeguards: { ...draft.safeguards, dedupeHours: Number(event.target.value) } })}/></Field> : null}<Field label="بداية نافذة الإرسال"><input type="time" value={draft.schedule_config?.sendWindowStart || '09:00'} onChange={event => patch({ schedule_config: { ...draft.schedule_config, sendWindowStart: event.target.value } })}/></Field><Field label="نهاية نافذة الإرسال"><input type="time" value={draft.schedule_config?.sendWindowEnd || '20:00'} onChange={event => patch({ schedule_config: { ...draft.schedule_config, sendWindowEnd: event.target.value } })}/></Field><Field label="حد المستلمين في التشغيل" hint={draft.rule_key === 'welcome_new_customer' ? 'الحد التشغيلي الفعلي لدفعة الترحيب: 200.' : undefined}><input type="number" min="1" max={draft.rule_key === 'welcome_new_customer' ? 200 : 2000} value={draft.safeguards?.maxRecipientsPerRun ?? 500} onChange={event => patch({ safeguards: { ...draft.safeguards, maxRecipientsPerRun: Number(event.target.value) } })}/></Field><Field label="رسائل الجوال في اليوم"><input type="number" min="1" max="5" value={draft.safeguards?.maxMessagesPerPhonePerDay ?? 1} onChange={event => patch({ safeguards: { ...draft.safeguards, maxMessagesPerPhonePerDay: Number(event.target.value) } })}/></Field></div>
            <div className="automation-safety-list"><span><ShieldCheck size={16}/> منع التنفيذ المزدوج</span><span><ShieldCheck size={16}/> إعادة الفشل المؤكد فقط</span><span><ShieldCheck size={16}/> حظر إعادة الحالة المجهولة</span><span><ShieldCheck size={16}/> اشتراط حداثة المصادر</span></div>
          </section> : null}
          {current === 'review' ? <section>
            <h3>المعاينة والاعتماد</h3><p>هذه آخر شاشة قرار. لا تنفذ المعاينة إرسالًا ولا تغييرًا خارجيًا.</p>
            <AudiencePreview preview={preview} loading={previewing}/>
            <div className="automation-review-summary"><p><span>القاعدة</span><b>{draft.name || 'غير مسماة'}</b></p><p><span>الحالة</span><b>{STATUS[draft.status]?.[0] || draft.status}</b></p><p><span>المحفز</span><b>{EVENT[draft.event_type]}</b></p><p><span>القالب</span><b dir="ltr">{draft.template_name || 'غير محدد'}</b></p><p><span>طريقة التنفيذ</span><b>{MODE[draft.execution_mode]}</b></p><p><span>منع التكرار</span><b>{draft.safeguards?.dedupeMode === 'once_per_snapshot_phone' ? DEDUPE_MODE.once_per_snapshot_phone : `${number(draft.safeguards?.dedupeHours)} ساعة`}</b></p>{draft.rule_key === 'welcome_new_customer' ? <p><span>سياسة الجمعة</span><b>{draft.schedule_config?.deferFridayMorning ? `الصباح مؤجل إلى ${draft.schedule_config?.fridayDeferredUntil || '18:00'}` : 'الإرسال ضمن النافذة المعتادة'}</b></p> : null}</div>
            {draft.execution_mode === 'automatic' ? <div className="automation-warning"><AlertTriangle size={17}/><span>اختيار «تلقائي» يحفظ سياسة التشغيل، لكنه لا يرسل أثناء هذه الجلسة. يجب أن تكون القاعدة بحالة نشطة ضمن محرك التشغيل المعتمد.</span></div> : null}
          </section> : null}
          {notice ? <div className={`automation-notice ${notice.includes('تعذر') || notice.includes('invalid') || notice.includes('يجب') ? 'error' : ''}`}>{notice}</div> : null}
        </main>
      </div>
      <footer>
        <Btn variant="ghost" onClick={onClose}>إغلاق</Btn>
        <div><Btn variant="ghost" disabled={step === 0} onClick={() => setStep(value => Math.max(0, value - 1))} icon={<ChevronRight size={16}/>}>السابق</Btn>{step < STEPS.length - 1 ? <Btn variant="primary" onClick={() => setStep(value => Math.min(STEPS.length - 1, value + 1))} icon={<ChevronLeft size={16}/>}>التالي</Btn> : <><Btn variant="ghost" disabled={previewing || saving || !draft.name || !canManage} onClick={runPreview} icon={<Eye size={16}/>}>معاينة بدون إرسال</Btn><Btn variant="primary" disabled={saving || !draft.name || !canManage} onClick={() => save()} icon={<Check size={16}/>}>{draft.status === 'active' && draft.execution_mode === 'automatic' ? 'حفظ وتفعيل' : 'حفظ السياسة'}</Btn></>}</div>
      </footer>
    </aside>
  </div>;
}

function Runs({ runs, rules }) {
  const rulesById = new Map(rules.map(rule => [rule.id, rule]));
  if (!runs.length) return <div className="automation-empty"><History size={28}/><strong>لا يوجد سجل تشغيل للقواعد الجديدة</strong><span>ستظهر المعاينات والتنفيذات هنا مع نسخة القاعدة والأعداد والنتيجة.</span></div>;
  return <div className="automation-runs">{runs.map(run => <div key={run.id}><span className={`automation-run-state ${run.status}`}>{run.status}</span><span><b>{rulesById.get(run.rule_id)?.name || 'قاعدة مؤرشفة'}</b><small>الإصدار {run.rule_version} · {dateTime(run.started_at)}</small></span><span><b>{number(run.eligible_count)} مؤهل</b><small>{number(run.excluded_count)} مستبعد · {number(run.review_count)} مراجعة</small></span><span><b>{number(run.action_count)} إجراء</b><small>{number(run.failed_count)} فشل</small></span></div>)}</div>;
}

export default function AutomationControlCenter({ LegacyPanel, isActive = true }) {
  const { can } = useAuth();
  const [rules, setRules] = useState([]);
  const [runs, setRuns] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('rules');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [selected, setSelected] = useState(undefined);
  const load = useCallback(async () => {
    if (!isActive) return;
    setLoading(true); setError('');
    try {
      const [ruleRows, runRows, config] = await Promise.all([loadAutomationRules(), loadAutomationRuns(), loadWhatsAppConfig()]);
      setRules(ruleRows); setRuns(runRows); setTemplates(config?.templates || []);
    } catch (loadError) { setError(loadError?.message || 'تعذر تحميل مركز الأتمتة'); }
    finally { setLoading(false); }
  }, [isActive]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (selected !== undefined) { const previous = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = previous; }; } return undefined; }, [selected]);
  const filtered = useMemo(() => rules.filter(rule => (category === 'all' || rule.category === category) && (!query || `${rule.name} ${rule.objective} ${rule.template_name}`.toLowerCase().includes(query.toLowerCase()))), [rules, category, query]);
  const canManage = can('agents.manage');
  if (!can('agents.view')) return null;
  return <div className="automation-page">
    <header className="automation-page-header"><div><h1>مركز الأتمتة</h1><p>وكلاء يراقبون الإشارات، يبنون الجمهور، يطبقون الحماية، ثم يتركون نتيجة قابلة للتدقيق.</p></div><div><Btn variant="ghost" disabled title="لا توجد قاعدة تلقائية نشطة ضمن المحرك الجديد" icon={<PauseCircle size={17}/>}>إيقاف الكل</Btn><Btn variant="primary" disabled={!canManage} onClick={() => setSelected(null)} icon={<Plus size={17}/>}>قاعدة أتمتة جديدة</Btn></div></header>
    {loading ? <div className="automation-loading"><Spinner/></div> : error ? <Card accent="var(--red)" className="automation-error"><AlertTriangle size={20}/><div><strong>تعذر فتح قواعد الأتمتة</strong><p>{error}</p><Btn size="sm" variant="ghost" onClick={load}>إعادة المحاولة</Btn></div></Card> : <>
      <SummaryStrip rules={rules} runs={runs}/>
      <nav className="automation-tabs"><button className={tab === 'rules' ? 'active' : ''} onClick={() => setTab('rules')}><SlidersHorizontal size={16}/>القواعد <span>{rules.length}</span></button><button className={tab === 'review' ? 'active' : ''} onClick={() => setTab('review')}><Users size={16}/>بانتظار المراجعة</button><button className={tab === 'runs' ? 'active' : ''} onClick={() => setTab('runs')}><History size={16}/>السجل والنتائج</button><button className={tab === 'system' ? 'active' : ''} onClick={() => setTab('system')}><Settings2 size={16}/>وكلاء النظام</button></nav>
      {tab === 'rules' ? <section className="automation-workspace"><div className="automation-toolbar"><div className="automation-search"><Search size={16}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="بحث في القواعد والقوالب…"/></div><div className="automation-filter"><Filter size={16}/><select value={category} onChange={event => setCategory(event.target.value)}><option value="all">كل الفرق</option>{Object.entries(CATEGORY).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><button type="button" onClick={load} aria-label="تحديث"><RefreshCw size={17}/></button></div><div className="automation-table"><div className="automation-table-head"><span>الحالة</span><span>القاعدة</span><span>المحفز</span><span>الجمهور</span><span>القالب وطريقة التنفيذ</span><span>التشغيل</span><span/></div>{filtered.map(rule => <RuleRow rule={rule} key={rule.id} onOpen={setSelected}/>)}</div>{!filtered.length ? <div className="automation-empty compact"><Filter size={23}/><strong>لا توجد قواعد مطابقة</strong><span>غيّر البحث أو الفريق المحدد.</span></div> : null}</section> : null}
      {tab === 'review' ? <section className="automation-workspace"><div className="automation-empty"><Users size={28}/><strong>طابور المراجعة هادئ</strong><span>لا توجد عمليات إرسال معلقة. سيظهر هنا المؤهلون والاستثناءات عند تشغيل قواعد بوضع المراجعة.</span></div></section> : null}
      {tab === 'runs' ? <section className="automation-workspace"><Runs runs={runs} rules={rules}/></section> : null}
      {tab === 'system' && LegacyPanel ? <section className="automation-legacy"><div className="automation-section-note"><Sparkles size={17}/><span>هذه الوكلاء المتخصصة القائمة مثل زاتكا وصحة التكاملات. تبقى إعداداتها الحالية مستقلة عن قواعد التواصل الجديدة.</span></div><LegacyPanel isActive={isActive}/></section> : null}
    </>}
    {selected !== undefined ? <RuleDrawer rule={selected} templates={templates} canManage={canManage} onClose={() => setSelected(undefined)} onSaved={async saved => { setRules(current => current.some(rule => rule.id === saved.id) ? current.map(rule => rule.id === saved.id ? saved : rule) : [...current, saved]); }}/>: null}
    <style>{`
      .automation-page{max-width:1480px;margin:0 auto;padding:22px clamp(14px,2.3vw,30px) calc(108px + env(safe-area-inset-bottom));color:var(--text)}
      .automation-page-header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:18px}.automation-page-header h1{margin:0;font-size:clamp(25px,3vw,34px);letter-spacing:-.03em}.automation-page-header p{margin:7px 0 0;color:var(--muted);font-size:13px;line-height:1.75;max-width:760px}.automation-page-header>div:last-child{display:flex;gap:9px;flex-wrap:wrap}
      .automation-summary{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));border:1px solid var(--border);border-radius:14px;background:var(--card);overflow:hidden;margin-bottom:14px}.automation-summary-item{display:flex;gap:10px;align-items:flex-start;padding:13px 15px;border-inline-end:1px solid var(--border2)}.automation-summary-item:last-child{border-inline-end:0}.automation-summary-item>svg{color:var(--accent);margin-top:2px}.automation-summary-item span{display:grid;min-width:0}.automation-summary-item small{font-size:10.5px;color:var(--muted)}.automation-summary-item strong{font-size:19px;margin-top:2px}.automation-summary-item em{font-style:normal;color:var(--muted);font-size:9.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .automation-tabs{display:flex;gap:4px;border-bottom:1px solid var(--border);margin-bottom:14px;overflow-x:auto;scrollbar-width:none}.automation-tabs button{display:flex;align-items:center;gap:7px;border:0;background:transparent;color:var(--muted);padding:10px 13px;border-bottom:2px solid transparent;font:inherit;font-size:12px;font-weight:800;white-space:nowrap;cursor:pointer}.automation-tabs button.active{color:var(--accent);border-bottom-color:var(--accent)}.automation-tabs span{min-width:20px;padding:2px 6px;border-radius:999px;background:var(--surface2);font-size:10px}
      .automation-workspace{border:1px solid var(--border);border-radius:14px;background:var(--card);overflow:hidden}.automation-toolbar{display:flex;align-items:center;gap:8px;padding:10px;border-bottom:1px solid var(--border2)}.automation-search,.automation-filter{display:flex;align-items:center;gap:8px;border:1px solid var(--border);border-radius:9px;background:var(--surface);padding:0 10px;height:38px}.automation-search{width:min(360px,45vw)}.automation-search svg,.automation-filter svg{color:var(--muted);flex:0 0 auto}.automation-search input,.automation-filter select{border:0;outline:0;background:transparent;color:var(--text);font:inherit;font-size:12px;width:100%}.automation-filter select{width:130px}.automation-toolbar>button{width:38px;height:38px;border:1px solid var(--border);border-radius:9px;background:var(--surface);color:var(--text2);display:grid;place-items:center;cursor:pointer}
      .automation-table{min-width:1040px}.automation-table-head,.automation-rule-row{display:grid;grid-template-columns:110px minmax(230px,1.3fr) minmax(170px,1fr) 125px minmax(170px,1fr) minmax(175px,1fr) 38px;gap:12px;align-items:center;text-align:start}.automation-table-head{padding:9px 13px;color:var(--muted);font-size:10.5px;font-weight:800;background:var(--surface2);border-bottom:1px solid var(--border2)}.automation-rule-row{width:100%;border:0;border-bottom:1px solid var(--border2);background:var(--card);padding:11px 13px;color:var(--text);font:inherit;cursor:pointer;transition:background .15s ease}.automation-rule-row:last-child{border-bottom:0}.automation-rule-row:hover,.automation-rule-row:focus-visible{background:var(--surface2);outline:none}.automation-rule-row>span{display:grid;gap:3px;min-width:0;text-align:start}.automation-rule-row b,.automation-rule-row strong{font-size:11.5px;overflow:hidden;text-overflow:ellipsis}.automation-rule-row small{font-size:9.8px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.rule-name strong{font-size:12.5px}.rule-name small{white-space:normal;line-height:1.45;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical}.rule-open{place-items:center;color:var(--muted)}.automation-status{display:inline-flex!important;grid-auto-flow:column;align-items:center;justify-content:start;gap:6px;width:max-content;font-size:10.5px;font-weight:900;color:var(--text2)}.automation-status i{width:7px;height:7px;border-radius:50%;background:var(--muted)}.automation-status.success i{background:var(--green)}.automation-status.warning i{background:var(--gold)}.automation-status.danger i{background:var(--red)}.automation-status.info i{background:var(--accent)}
      .automation-loading{display:grid;place-items:center;min-height:340px}.automation-error{display:flex;gap:12px;align-items:flex-start}.automation-error p{color:var(--muted);margin:5px 0 10px}.automation-empty{min-height:310px;display:grid;place-content:center;justify-items:center;text-align:center;gap:8px;color:var(--muted);padding:30px}.automation-empty strong{color:var(--text);font-size:15px}.automation-empty span{font-size:12px;max-width:470px;line-height:1.8}.automation-empty.compact{min-height:170px}.automation-legacy>.automation-page{padding:0}.automation-section-note{display:flex;gap:9px;align-items:center;padding:11px 13px;border:1px solid var(--border);border-radius:12px;background:var(--accent-dim);color:var(--text2);font-size:12px}.automation-runs>div{display:grid;grid-template-columns:100px minmax(220px,1fr) 180px 150px;gap:16px;align-items:center;padding:12px 14px;border-bottom:1px solid var(--border2)}.automation-runs>div>span{display:grid;gap:3px}.automation-runs b{font-size:12px}.automation-runs small{font-size:10px;color:var(--muted)}.automation-run-state{font-size:10px;font-weight:900;color:var(--accent)}
      .automation-drawer-backdrop{position:fixed;inset:0;z-index:1300;background:rgba(15,23,42,.54);display:flex;justify-content:flex-start;overscroll-behavior:contain}.automation-drawer{width:min(860px,94vw);height:100dvh;background:var(--card);box-shadow:14px 0 40px rgba(15,23,42,.2);display:grid;grid-template-rows:auto minmax(0,1fr) auto;animation:automation-in .18s ease-out}.automation-drawer>header{display:flex;justify-content:space-between;gap:16px;padding:19px 22px 16px;border-bottom:1px solid var(--border)}.automation-drawer>header small{color:var(--accent);font-weight:900;font-size:10px}.automation-drawer>header h2{margin:4px 0;font-size:20px}.automation-drawer>header p{margin:0;color:var(--muted);font-size:11.5px}.automation-drawer>header button{width:38px;height:38px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--muted);display:grid;place-items:center;cursor:pointer}.automation-builder{display:grid;grid-template-columns:210px minmax(0,1fr);min-height:0}.automation-builder>nav{padding:12px;border-inline-end:1px solid var(--border);background:var(--surface2);overflow-y:auto}.automation-mobile-progress{display:none}.automation-builder>nav button{width:100%;display:grid;grid-template-columns:26px minmax(0,1fr);gap:9px;align-items:center;text-align:start;border:0;border-radius:9px;background:transparent;padding:9px;color:var(--muted);font:inherit;cursor:pointer}.automation-builder>nav button.active{background:var(--card);color:var(--accent);box-shadow:0 0 0 1px var(--border)}.automation-builder>nav button.done{color:var(--text2)}.automation-builder>nav i{width:24px;height:24px;border-radius:50%;border:1px solid var(--border);display:grid;place-items:center;font-style:normal;font-size:10px;background:var(--card)}.automation-builder>nav .active i{background:var(--accent);border-color:var(--accent);color:white}.automation-builder>nav .done i{color:var(--green)}.automation-builder>nav span{display:grid;gap:2px}.automation-builder>nav b{font-size:11.5px}.automation-builder>nav small{font-size:9.5px}.automation-builder>main{padding:21px 24px 30px;overflow-y:auto;min-width:0}.automation-builder section>h3{font-size:18px;margin:0}.automation-builder section>p{margin:5px 0 18px;color:var(--muted);font-size:11.5px;line-height:1.7}.automation-subtitle{font-size:12px;margin:18px 0 8px}.automation-field{display:grid;gap:6px;margin-bottom:13px;color:var(--text2);font-size:11.5px;font-weight:850}.automation-field>small{font-size:9.5px;color:var(--muted);font-weight:500;line-height:1.6}.automation-field input,.automation-field select,.automation-field textarea{width:100%;min-height:41px;border:1px solid var(--border);border-radius:9px;background:var(--surface);color:var(--text);padding:8px 10px;font:inherit;font-size:12px;outline:none}.automation-field textarea{resize:vertical}.automation-field input:focus,.automation-field select:focus,.automation-field textarea:focus,.automation-var input:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-dim)}.automation-field input:disabled{color:var(--muted);background:var(--surface2)}.automation-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}.automation-info,.automation-warning,.automation-identity-rule{display:flex;gap:10px;align-items:flex-start;padding:12px;border:1px solid var(--border);border-radius:10px;background:var(--surface2);font-size:11px;line-height:1.75;color:var(--text2)}.automation-info svg,.automation-identity-rule svg{color:var(--accent);flex:none}.automation-warning{border-inline-start:3px solid var(--gold);background:var(--gold-soft);margin-top:12px}.automation-warning svg{color:var(--gold-ink);flex:none}.automation-info span,.automation-identity-rule span{display:grid}.automation-info b,.automation-identity-rule b{font-size:11.5px}.automation-identity-rule small{color:var(--muted)}
      .automation-condition-list{margin-top:8px;border-top:1px solid var(--border2);padding-top:12px}.automation-condition-list h4{font-size:11.5px;margin:0 0 8px}.automation-condition-list>div{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;gap:8px;align-items:center;padding:8px;border-bottom:1px solid var(--border2);font-size:10.5px}.automation-condition-list code{direction:ltr;text-align:start;color:var(--accent)}.automation-condition-list p{font-size:11px;color:var(--muted)}.automation-exclusions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:14px}.automation-exclusions label{display:flex;align-items:center;gap:8px;padding:9px;border:1px solid var(--border2);border-radius:9px;font-size:10.5px;color:var(--text2);cursor:pointer}.automation-exclusions input{accent-color:var(--accent)}
      .automation-vars{display:grid;gap:8px}.automation-var{display:grid;grid-template-columns:52px minmax(0,1fr) 34px;gap:7px;align-items:center}.automation-var code{height:38px;display:grid;place-items:center;border:1px solid var(--border);border-radius:8px;background:var(--surface2);direction:ltr;color:var(--accent);font-weight:900}.automation-var input{height:38px;border:1px solid var(--border);border-radius:8px;background:var(--surface);padding:7px 9px;font:inherit;font-size:11.5px;outline:none}.automation-var button{height:34px;border:0;background:transparent;color:var(--muted);display:grid;place-items:center;cursor:pointer}.automation-inline-action{display:flex;align-items:center;gap:5px;width:max-content;border:0;background:transparent;color:var(--accent);font:inherit;font-size:11px;font-weight:900;cursor:pointer}.automation-note{margin:2px 0!important;font-size:10px!important}.automation-template-preview{margin-top:14px;border:1px solid var(--border);border-radius:10px;padding:12px;background:var(--surface2)}.automation-template-preview>small{display:block;color:var(--muted);font-size:9.5px}.automation-template-preview>strong{display:block;margin:3px 0 10px}.automation-template-preview p{display:grid;grid-template-columns:45px minmax(0,1fr);gap:8px;margin:5px 0!important;padding-top:5px;border-top:1px solid var(--border2)}.automation-template-preview code{direction:ltr;color:var(--accent)}.automation-switch{display:flex;gap:10px;align-items:center;border:1px solid var(--border);border-radius:10px;padding:11px;margin-bottom:13px}.automation-switch input{accent-color:var(--accent)}.automation-switch span{display:grid;gap:2px}.automation-switch b{font-size:11.5px}.automation-switch small{font-size:9.5px;color:var(--muted)}.automation-safety-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:4px}.automation-safety-list span{display:flex;gap:7px;align-items:center;padding:8px;border-radius:8px;background:var(--green-soft);color:var(--green);font-size:10.5px;font-weight:800}.automation-preview-loading{min-height:170px;display:grid;place-content:center;justify-items:center;gap:10px;color:var(--muted);font-size:11px}.automation-preview-counts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid var(--border);border-radius:10px;overflow:hidden}.automation-preview-counts span{display:grid;gap:2px;padding:10px;border-inline-end:1px solid var(--border2)}.automation-preview-counts span:last-child{border:0}.automation-preview-counts small{font-size:9.5px;color:var(--muted)}.automation-preview-counts strong{font-size:20px}.automation-preview-counts .success strong{color:var(--green)}.automation-preview-counts .warning strong{color:var(--gold-ink)}.automation-preview-counts .danger strong{color:var(--red)}.automation-preview-source{display:flex;align-items:center;gap:6px;color:var(--muted);font-size:10px;margin:9px 0}.automation-preview-list{border:1px solid var(--border);border-radius:9px;max-height:240px;overflow-y:auto}.automation-preview-list>div{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;padding:8px 10px;border-bottom:1px solid var(--border2)}.automation-preview-list>div:last-child{border:0}.automation-preview-list span{display:grid;gap:2px}.automation-preview-list span:last-child{text-align:end}.automation-preview-list b{font-size:10.5px}.automation-preview-list small{font-size:9px;color:var(--muted)}.automation-preview-list small.eligible{color:var(--green)}.automation-preview-list small.review{color:var(--gold-ink)}.automation-preview-list small.ineligible{color:var(--red)}.automation-preview-list>p{font-size:9.5px;color:var(--muted);padding:7px 10px;margin:0}.automation-review-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 16px;margin-top:14px}.automation-review-summary p{display:flex;justify-content:space-between;gap:10px;border-bottom:1px solid var(--border2);padding:8px 0;margin:0!important}.automation-review-summary span{font-size:10px;color:var(--muted)}.automation-review-summary b{font-size:10.5px}.automation-notice{margin-top:13px;padding:10px;border-radius:9px;background:var(--green-soft);color:var(--green);font-size:11px;font-weight:800}.automation-notice.error{background:var(--red-soft);color:var(--red)}
      .automation-drawer>footer{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 18px calc(12px + env(safe-area-inset-bottom));border-top:1px solid var(--border);background:var(--card)}.automation-drawer>footer>div{display:flex;gap:8px;flex-wrap:wrap}
      @keyframes automation-in{from{transform:translateX(-18px);opacity:.7}to{transform:none;opacity:1}}
      @media(max-width:1100px){.automation-summary{grid-template-columns:repeat(3,minmax(0,1fr))}.automation-summary-item:nth-child(3){border-inline-end:0}.automation-summary-item:nth-child(n+4){border-top:1px solid var(--border2)}.automation-workspace{overflow-x:auto}}
      @media(max-width:720px){.automation-page{padding:14px 12px calc(104px + env(safe-area-inset-bottom))}.automation-page-header{display:grid}.automation-page-header>div:last-child{display:grid;grid-template-columns:1fr 1fr}.automation-summary{grid-template-columns:repeat(2,minmax(0,1fr));border-radius:12px}.automation-summary-item{padding:10px}.automation-summary-item:nth-child(2n){border-inline-end:0}.automation-summary-item:nth-child(n+3){border-top:1px solid var(--border2)}.automation-summary-item:last-child{grid-column:1/-1}.automation-summary-item strong{font-size:17px}.automation-toolbar{position:sticky;right:0;width:100vw;max-width:calc(100vw - 24px)}.automation-search{width:100%;min-width:0}.automation-filter{display:none}.automation-table{min-width:0;width:100%}.automation-table-head{display:none}.automation-rule-row{grid-template-columns:minmax(0,1fr) auto;gap:7px;padding:11px}.automation-rule-row .rule-name{grid-column:1;grid-row:1}.automation-rule-row .rule-status{grid-column:2;grid-row:1}.automation-rule-row>span:nth-child(3){grid-column:1;grid-row:2}.automation-rule-row .rule-audience{grid-column:2;grid-row:2;text-align:end}.automation-rule-row>span:nth-child(5){grid-column:1;grid-row:3}.automation-rule-row>span:nth-child(6){grid-column:2;grid-row:3;text-align:end}.automation-rule-row .rule-open{display:none}.automation-rule-row small{white-space:normal}.automation-rule-row b,.automation-rule-row strong{font-size:11px}.rule-name strong{font-size:13px}.automation-drawer-backdrop{align-items:flex-end;padding-top:52px}.automation-drawer{width:100%;height:calc(100dvh - 52px);border-radius:18px 18px 0 0;animation:none}.automation-drawer>header{padding:15px 15px 12px}.automation-drawer>header h2{font-size:17px}.automation-builder{grid-template-columns:1fr;grid-template-rows:auto minmax(0,1fr)}.automation-builder>nav{overflow:visible;border-inline-end:0;border-bottom:1px solid var(--border);padding:10px 14px}.automation-builder>nav button{display:none}.automation-mobile-progress{display:grid;gap:7px}.automation-mobile-progress span{display:flex;align-items:center;justify-content:space-between;gap:10px}.automation-mobile-progress b{font-size:12px;color:var(--text)}.automation-mobile-progress small{font-size:10px;color:var(--muted)}.automation-mobile-progress progress{width:100%;height:4px;border:0;border-radius:999px;overflow:hidden;background:var(--border2)}.automation-mobile-progress progress::-webkit-progress-bar{background:var(--border2)}.automation-mobile-progress progress::-webkit-progress-value{background:var(--accent)}.automation-mobile-progress progress::-moz-progress-bar{background:var(--accent)}.automation-builder>main{padding:17px 14px 24px}.automation-form-grid,.automation-exclusions,.automation-safety-list,.automation-review-summary{grid-template-columns:1fr}.automation-preview-counts{grid-template-columns:repeat(2,1fr)}.automation-preview-counts span:nth-child(2){border-inline-end:0}.automation-preview-counts span:nth-child(n+3){border-top:1px solid var(--border2)}.automation-drawer>footer{padding:9px 10px calc(9px + env(safe-area-inset-bottom))}.automation-drawer>footer>div{justify-content:flex-end}.automation-runs>div{grid-template-columns:90px minmax(0,1fr)}.automation-runs>div>span:nth-child(n+3){display:none}.automation-legacy .automation-page{padding-inline:0}}
    `}</style>
  </div>;
}

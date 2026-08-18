// شاشة الفعل التالي — «آلة القرار» التي تجعل مركز العمليات أقوى من هاتف:
// قائمة مرتّبة لكل عميل تحتاج إجراءً اليوم، بسبب واضح (ردّ/دين/محفظة/توقّف) +
// الإجراء المقترح + أزرار تنفيذه (اتصال IVR / حملة واتساب / عرض العميل).
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  RefreshCw, Phone, Eye, ShieldCheck, ListChecks, Activity, Target,
  Link2, CalendarClock, User, ExternalLink, CircleDollarSign,
} from 'lucide-react';
import { Card, Btn, Spinner, Empty, Modal, PageHeader, toast } from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import { loadEmployees } from '../lib/employeeService.js';
import {
  loadNextBestActions, loadCustomerGrowthSnapshot, loadCustomerGrowthProfile,
  recordCustomerGrowthOutcome, NBA_META, TEMPLATE_INTENT_LABELS,
} from '../lib/nextActionsService.js';

// نتائج المتابعة السريعة (إغلاق الحلقة) — تُسجَّل في retargeting_followups + تلمس آخر تواصل.
const OUTCOMES = [
  ['contacted', 'تم التواصل'], ['interested', 'مهتم'], ['no_answer', 'لم يرد'],
  ['needs_followup', 'يحتاج متابعة'], ['returned', 'عاد للشحن'], ['converted', 'تحوّل ✅'],
  ['not_interested', 'غير مهتم'], ['price_issue', 'مشكلة سعر'],
];
const TERMINAL_OUTCOMES = new Set(['returned', 'converted', 'not_interested']);
const OUTCOME_LABELS = new Map(OUTCOMES);
const STAGE_LABELS = {
  registered: 'مسجل', ready_first_shipment: 'جاهز لأول شحنة', active: 'نشط',
  at_risk: 'مهدد بالتوقف', stopped: 'متوقف', contacted: 'تم التواصل',
  qualified: 'مؤهل', nurture: 'متابعة', won: 'مكتسب', lost: 'مغلق',
};
const ACTIVITY_TYPES = [
  ['call', 'مكالمة'], ['whatsapp', 'واتساب يدوي'], ['meeting', 'اجتماع'],
  ['email', 'بريد'], ['note', 'ملاحظة'],
];
import IvrCallButton from '../components/IvrCallButton.jsx';

const fmt0 = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const daysAgo = (d) => d ? Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000) : null;
const fmtMoney = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const fmtDateTime = (value) => value ? new Date(value).toLocaleString('ar-SA', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const tomorrowInput = () => {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  date.setHours(10, 0, 0, 0);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export default function NextActions({ isActive = true }) {
  const navigate = useNavigate();
  const { user, canAny } = useAuth();
  const [rows, setRows] = useState(null);
  const [growth, setGrowth] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [mine, setMine] = useState(false);
  const [group, setGroup] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [previewRows, setPreviewRows] = useState(null);
  const [outcomeRow, setOutcomeRow] = useState(null);
  const [profileRow, setProfileRow] = useState(null);
  const [profileData, setProfileData] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);

  const refresh = useCallback(async () => {
    setRows(null);
    try {
      const [list, emp, growthSnapshot] = await Promise.all([
        loadNextBestActions({ owner: mine ? user?.id || null : null, limit: 1000 }),
        loadEmployees().catch(() => []),
        loadCustomerGrowthSnapshot(30),
      ]);
      setRows(list); setEmployees(emp); setGrowth(growthSnapshot); setSelected(new Set());
    } catch (e) { toast(`تعذّر التحميل: ${e.message}`, 'error'); setRows([]); }
  }, [mine, user?.id]);
  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh]);

  const nameById = useMemo(() => { const m = new Map(); employees.forEach(e => m.set(e.id, e.name || e.email)); return m; }, [employees]);
  const filtered = useMemo(() => (rows || []).filter(r => !group || NBA_META[r.reasonCode]?.group === group), [rows, group]);
  const totals = useMemo(() => {
    const t = { count: filtered.length, money: 0, ready: 0, held: 0, byGroup: {} };
    for (const r of filtered) {
      t.money += r.amount || 0;
      if (r.sendEligible) t.ready += 1; else t.held += 1;
      const g = NBA_META[r.reasonCode]?.group || '—';
      t.byGroup[g] = (t.byGroup[g] || 0) + 1;
    }
    return t;
  }, [filtered]);
  const selectedRows = useMemo(() => {
    if (!selected.size) return [];
    return (rows || []).filter(r => selected.has(actionKey(r)));
  }, [rows, selected]);

  if (!canAny(['collections.view', 'sales.view', 'overview.view'])) return <Pad><Empty icon="🔒" title="لا صلاحية"/></Pad>;

  const toggleSelected = (r) => setSelected(prev => {
    const next = new Set(prev);
    const key = actionKey(r);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const selectFiltered = () => setSelected(prev => {
    const next = new Set(prev);
    filtered.forEach(r => next.add(actionKey(r)));
    return next;
  });

  const openGrowthProfile = async (row) => {
    setProfileRow(row); setProfileData(null); setProfileLoading(true);
    try {
      setProfileData(await loadCustomerGrowthProfile(row.phone));
    } catch (e) { toast(`تعذّر فتح ملف النمو: ${e.message}`, 'error'); }
    setProfileLoading(false);
  };

  return (
    <Pad>
      <PageHeader icon={<Phone size={22}/>} title="مهام العملاء اليوم" subtitle="قائمة تنفيذ موحّدة — من تتصل به، ولماذا، وما الخطوة المقترحة الآن"
        actions={<Btn size="sm" variant="ghost" onClick={refresh} disabled={rows == null}><RefreshCw size={14} className={rows == null ? 'spin' : ''}/></Btn>}/>

      <Card style={{ padding: '11px 14px', marginBottom: 12, borderColor: 'color-mix(in srgb, #2563EB 35%, var(--border2))', background: 'color-mix(in srgb, #2563EB 7%, var(--card))' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <ShieldCheck size={18} color="#2563EB"/>
          <div style={{ flex: 1, minWidth: 220 }}>
            <b style={{ fontSize: 13 }}>وضع تجريبي — الإرسال غير مفعّل</b>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>النظام يبني الجمهور والقالب والحواجز للمعاينة فقط، ولا ترتبط هذه الشاشة بأي دالة إرسال واتساب.</div>
          </div>
          <Btn size="sm" variant="outline" icon={<Eye size={13}/>} disabled={!filtered.length} onClick={() => setPreviewRows(filtered)}>معاينة نتائج الفلتر</Btn>
        </div>
      </Card>

      {growth ? <GrowthOperatingPulse growth={growth}/> : null}

      {/* شريط الملخّص */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
        <Kpi label="إجراءات مطلوبة" value={fmt0(totals.count)} color="#06B6D4"/>
        <Kpi label="مال معرّض (دين+محفظة)" value={`${fmt0(totals.money)} ر.س`} color="var(--red)"/>
        <Kpi label="تحصيل" value={fmt0(totals.byGroup['تحصيل'] || 0)} color="var(--red)"/>
        <Kpi label="مؤهل مبدئيًا" value={fmt0(totals.ready)} color="#16A34A"/>
        <Kpi label="متابعة بشرية/محمي" value={fmt0(totals.held)} color="var(--gold)"/>
      </div>

      {/* الفلاتر */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12.5, color: 'var(--muted)' }}>
          <input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)}/> المسندة لي فقط
        </label>
        {['', 'الجدد', 'المتوقفون', 'متابعة', 'تحصيل', 'تواصل'].map(g => (
          <Btn key={g || 'all'} size="sm" variant={group === g ? 'primary' : 'outline'} onClick={() => setGroup(g)}>{g || 'الكل'}</Btn>
        ))}
        <span style={{ flex: 1 }}/>
        <Btn size="sm" variant="outline" icon={<ListChecks size={13}/>} disabled={!filtered.length} onClick={selectFiltered}>تحديد نتائج الفلتر</Btn>
        {selected.size ? <Btn size="sm" variant="ghost" onClick={() => setSelected(new Set())}>إلغاء التحديد ({selected.size})</Btn> : null}
        <Btn size="sm" variant="primary" icon={<Eye size={13}/>} disabled={!selectedRows.length} onClick={() => setPreviewRows(selectedRows)}>معاينة المحدد ({selectedRows.length})</Btn>
      </div>

      {rows == null ? <div style={{ padding: 40, textAlign: 'center' }}><Spinner/></div>
        : !filtered.length ? <Empty icon="✅" title="لا إجراءات مطلوبة" sub="لا عميل يحتاج فعلاً الآن بهذا الفلتر."/>
        : (
          <div style={{ display: 'grid', gap: 8 }}>
            {filtered.map((r, i) => {
              const m = NBA_META[r.reasonCode] || { icon: '•', label: r.reasonCode, color: 'var(--muted)' };
              return (
                <Card key={`${r.phone}-${i}`} style={{ padding: '10px 14px', borderInlineStart: `4px solid ${m.color}`, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input type="checkbox" checked={selected.has(actionKey(r))} onChange={() => toggleSelected(r)} aria-label={`تحديد ${r.name}`}/>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 16 }}>{m.icon}</span>
                      <b style={{ fontSize: 13.5 }}>{r.name}</b>
                      <span style={{ padding: '1px 8px', borderRadius: 20, fontSize: 10.5, fontWeight: 700, background: `color-mix(in srgb, ${m.color} 15%, transparent)`, color: m.color }}>{m.label}</span>
                      {r.ownerId && <span style={{ fontSize: 10.5, color: 'var(--muted2)' }}>👤 {nameById.get(r.ownerId) || '—'}</span>}
                      <span style={{ padding: '1px 8px', borderRadius: 20, fontSize: 10.5, fontWeight: 700,
                        background: r.sendEligible ? 'color-mix(in srgb, #16A34A 14%, transparent)' : 'color-mix(in srgb, var(--gold) 14%, transparent)',
                        color: r.sendEligible ? '#16A34A' : 'var(--gold)' }}>
                        {r.sendEligible ? 'مؤهل مبدئيًا' : 'محمي من التواصل'}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
                      {r.reason} → <b style={{ color: 'var(--text)' }}>{r.action}</b>
                      {r.amount ? <span style={{ color: 'var(--red)', fontWeight: 700 }}> · {fmt0(r.amount)} ر.س</span> : null}
                      {r.lastTouch ? <span> · آخر تواصل قبل {daysAgo(r.lastTouch)} يوم</span> : null}
                    </div>
                    <div style={{ fontSize: 11, color: r.sendEligible ? '#16A34A' : 'var(--muted2)', marginTop: 4 }}>
                      {r.guardReason}
                      {r.recommendedTemplateKey ? ` · ${TEMPLATE_INTENT_LABELS[r.recommendedTemplateKey] || r.recommendedTemplateKey}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <IvrCallButton phone={r.phone} name={r.name} fields={{ name: r.name, amount: r.amount }} label size={13}
                      style={{ borderRadius: 999, padding: '7px 12px', background: 'var(--accent)', color: '#fff', border: 'none', fontSize: 12, cursor: 'pointer' }}/>
                    <Btn size="sm" variant="outline" icon={<Eye size={12}/>} onClick={() => setPreviewRows([r])}>معاينة</Btn>
                    <Btn size="sm" variant="ghost" icon={<User size={12}/>} onClick={() => openGrowthProfile(r)}>ملف 360</Btn>
                    <Btn size="sm" variant="primary" onClick={() => setOutcomeRow(r)}
                      disabled={!canAny(r.reasonCode === 'debt' || r.reasonCode === 'wallet_neg' ? ['collections.update_stage'] : ['sales.manage'])}>
                      تسجيل النتيجة
                    </Btn>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

      {previewRows ? <EngagementPlanPreview rows={previewRows} onClose={() => setPreviewRows(null)}/> : null}
      {outcomeRow ? <OutcomeModal row={outcomeRow} onClose={() => setOutcomeRow(null)} onSaved={async () => {
        setOutcomeRow(null);
        await refresh();
      }}/> : null}
      {profileRow ? <CustomerGrowthProfile row={profileRow} data={profileData} loading={profileLoading}
        onClose={() => { setProfileRow(null); setProfileData(null); }}
        onOpenFull={() => navigate(`/customer-360?q=${encodeURIComponent(profileRow.phone)}&open=1`)}/> : null}
    </Pad>
  );
}

const actionKey = (row) => `${row.phone}|${row.reasonCode}`;

function EngagementPlanPreview({ rows, onClose }) {
  const summary = useMemo(() => {
    const out = { ready: 0, held: 0, templates: new Map(), guards: new Map(), journeys: new Map() };
    for (const row of rows) {
      if (row.sendEligible) out.ready += 1; else out.held += 1;
      const template = TEMPLATE_INTENT_LABELS[row.recommendedTemplateKey] || 'متابعة بشرية بلا قالب';
      out.templates.set(template, (out.templates.get(template) || 0) + 1);
      out.guards.set(row.guardReason || 'تحتاج مراجعة', (out.guards.get(row.guardReason || 'تحتاج مراجعة') || 0) + 1);
      const journey = NBA_META[row.reasonCode]?.group || 'أخرى';
      out.journeys.set(journey, (out.journeys.get(journey) || 0) + 1);
    }
    return out;
  }, [rows]);

  return (
    <Modal title={`معاينة خطة التواصل — ${rows.length} عميل`} onClose={onClose} width={760}>
      <div style={{ display: 'grid', gap: 14 }}>
        <div style={{ padding: '10px 12px', borderRadius: 10, background: 'color-mix(in srgb, #2563EB 8%, var(--surface))', border: '1px solid color-mix(in srgb, #2563EB 30%, var(--border2))' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: '#2563EB', fontWeight: 800, fontSize: 13 }}><ShieldCheck size={16}/> محاكاة فقط — لا يوجد زر إرسال</div>
          <div style={{ color: 'var(--muted)', fontSize: 11.5, marginTop: 4 }}>هذه النافذة تعرض ما سيحدث لو فُعّل المسار مستقبلًا. لا تنشئ حملة ولا تستدعي هاتف ولا تسجل أي إرسال.</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
          <Kpi label="إجمالي الخطة" value={fmt0(rows.length)} color="#2563EB"/>
          <Kpi label="مؤهل مبدئيًا" value={fmt0(summary.ready)} color="#16A34A"/>
          <Kpi label="محمي/بشري" value={fmt0(summary.held)} color="var(--gold)"/>
        </div>

        <PreviewBreakdown title="الرحلات" values={summary.journeys}/>
        <PreviewBreakdown title="القوالب المقترحة" values={summary.templates}/>
        <PreviewBreakdown title="حواجز التواصل" values={summary.guards}/>

        {rows.length === 1 ? (
          <Card style={{ padding: 12 }}>
            <b>{rows[0].name}</b>
            <div style={{ marginTop: 5, fontSize: 12, color: 'var(--muted)' }}>{rows[0].reason} → {rows[0].action}</div>
            <div style={{ marginTop: 5, fontSize: 11.5, color: rows[0].sendEligible ? '#16A34A' : 'var(--gold)' }}>{rows[0].guardReason}</div>
          </Card>
        ) : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}><Btn variant="primary" onClick={onClose}>إغلاق المعاينة</Btn></div>
      </div>
    </Modal>
  );
}

function PreviewBreakdown({ title, values }) {
  return (
    <div>
      <b style={{ fontSize: 12.5 }}>{title}</b>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 7 }}>
        {[...values.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => (
          <span key={label} style={{ padding: '5px 9px', borderRadius: 999, background: 'var(--surface)', border: '1px solid var(--border2)', fontSize: 11.5 }}>{label} · <b>{fmt0(count)}</b></span>
        ))}
      </div>
    </div>
  );
}

function GrowthOperatingPulse({ growth }) {
  const identity = growth.identity || {};
  const lifecycle = growth.lifecycle || {};
  const execution = growth.execution || {};
  const outcomes = growth.outcomes || {};
  const metrics = [
    { label: 'اكتمال الهوية', value: `${identity.coverage_pct || 0}%`, note: `${fmt0(identity.linked_to_zoho)} متجر مرتبط بزوهو`, color: '#2563EB', icon: Link2 },
    { label: 'جاهزون لأول شحنة', value: fmt0(lifecycle.ready_first_shipment), note: `${fmt0(lifecycle.registered)} ما زالوا في التسجيل`, color: '#06B6D4', icon: Target },
    { label: 'بلا مسؤول', value: fmt0(execution.unassigned), note: `${fmt0(execution.missing_next_action)} بلا موعد تالٍ`, color: 'var(--gold)', icon: User },
    { label: 'تحولوا لأول شحنة', value: fmt0(outcomes.first_shipments), note: `معدل تفعيل الجدد ${outcomes.activation_rate_pct || 0}%`, color: 'var(--green)', icon: Activity },
    { label: 'سددوا بعد تواصل', value: `${fmtMoney(outcomes.paid_after_touch)} ر.س`, note: `${fmt0(outcomes.customers_paid_after_touch)} عميل · ارتباط زمني`, color: 'var(--red)', icon: CircleDollarSign },
  ];
  return (
    <Card style={{ padding: '14px 16px', marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 11 }}>
        <div><b style={{ fontSize: 13.5 }}>حلقة نمو العملاء — آخر {growth.period_days || 30} يومًا</b><div style={{ color: 'var(--muted)', fontSize: 11.5, marginTop: 2 }}>هوية ← مرحلة ← مسؤول ← إجراء ← نتيجة موضوعية</div></div>
        <span style={{ fontSize: 11, color: '#2563EB', fontWeight: 800 }}>مراجعة بشرية · الإرسال متوقف</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8 }}>
        {metrics.map(({ label, value, note, color, icon: Icon }) => <div key={label} style={{ border: '1px solid var(--border2)', borderRadius: 10, padding: '10px 11px', background: 'var(--surface)' }}>
          <div style={{ display: 'flex', gap: 6, color, alignItems: 'center', fontSize: 11.5, fontWeight: 700 }}><Icon size={14}/>{label}</div>
          <strong style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 20, marginTop: 6 }}>{value}</strong>
          <small style={{ color: 'var(--muted2)', fontSize: 10.5 }}>{note}</small>
        </div>)}
      </div>
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 10, fontSize: 11 }}>
        <span>نشط <b>{fmt0(lifecycle.active)}</b></span><span>مهدد <b>{fmt0(lifecycle.at_risk)}</b></span><span>متوقف <b>{fmt0(lifecycle.stopped)}</b></span><span>عاد للنشاط <b>{fmt0(lifecycle.reactivated_period)}</b></span><span>نتائج مسجلة <b>{fmt0(execution.outcomes_recorded)}</b></span>
      </div>
    </Card>
  );
}

function OutcomeModal({ row, onClose, onSaved }) {
  const [form, setForm] = useState({ outcome: 'contacted', activityType: 'call', nextAt: tomorrowInput(), note: '' });
  const [saving, setSaving] = useState(false);
  const terminal = TERMINAL_OUTCOMES.has(form.outcome);
  const save = async () => {
    if (!terminal && !form.nextAt) { toast('حدّد موعد الإجراء التالي حتى لا تضيع المتابعة', 'warning'); return; }
    if (form.outcome === 'not_interested' && !form.note.trim()) { toast('اكتب سبب عدم الاهتمام لقياس أسباب الفقد', 'warning'); return; }
    setSaving(true);
    try {
      await recordCustomerGrowthOutcome({
        phone: row.phone, reasonCode: row.reasonCode, outcome: form.outcome,
        nextAt: terminal ? null : new Date(form.nextAt).toISOString(),
        activityType: form.activityType, note: form.note.trim() || null,
      });
      toast(`سُجّلت النتيجة: ${OUTCOME_LABELS.get(form.outcome)}`, 'success');
      await onSaved();
    } catch (error) {
      const messages = { next_action_required: 'موعد الإجراء التالي مطلوب', loss_reason_required: 'سبب عدم الاهتمام مطلوب', not_allowed: 'ليست لديك صلاحية تسجيل هذه النتيجة' };
      toast(messages[error.message] || `تعذّر التسجيل: ${error.message}`, 'error');
    }
    setSaving(false);
  };
  return <Modal title={`تسجيل نتيجة — ${row.name}`} onClose={onClose} width={560}>
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ padding: 10, borderRadius: 9, background: 'var(--surface)', color: 'var(--muted)', fontSize: 12 }}>{row.reason} ← {row.action}</div>
      <label style={fieldLabel}>النتيجة<select value={form.outcome} onChange={e => setForm(current => ({ ...current, outcome: e.target.value }))} style={fieldInput}>{OUTCOMES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label style={fieldLabel}>قناة التواصل<select value={form.activityType} onChange={e => setForm(current => ({ ...current, activityType: e.target.value }))} style={fieldInput}>{ACTIVITY_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {!terminal ? <label style={fieldLabel}>موعد الإجراء التالي<input type="datetime-local" value={form.nextAt} onChange={e => setForm(current => ({ ...current, nextAt: e.target.value }))} style={fieldInput}/></label> : null}
      <label style={fieldLabel}>ملاحظة{form.outcome === 'not_interested' ? ' وسبب الفقد' : ''}<textarea rows={3} value={form.note} onChange={e => setForm(current => ({ ...current, note: e.target.value }))} style={{ ...fieldInput, resize: 'vertical' }}/></label>
      <div style={{ fontSize: 11, color: 'var(--muted2)' }}>سيُحفظ المسؤول والموعد والنتيجة في سجل العميل. لن تُرسل أي رسالة أو حملة.</div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}><Btn variant="ghost" onClick={onClose}>إلغاء</Btn><Btn variant="primary" onClick={save} disabled={saving}>{saving ? 'يحفظ…' : 'حفظ النتيجة'}</Btn></div>
    </div>
  </Modal>;
}

function CustomerGrowthProfile({ row, data, loading, onClose, onOpenFull }) {
  const finance = data?.finance || {};
  const followup = data?.followup || {};
  const impact = data?.impact_after_last_touch || {};
  const stores = data?.identity?.stores || [];
  const zoho = data?.identity?.zoho_customers || [];
  return <Modal title={`ملف النمو 360 — ${data?.name || row.name}`} onClose={onClose} width={860}>
    {loading ? <div style={{ padding: 45, textAlign: 'center' }}><Spinner/></div> : !data ? <Empty icon="⚠️" title="تعذر تحميل الملف"/> : <div style={{ display: 'grid', gap: 13 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}><div><b>{data.phone}</b><div style={{ color: 'var(--muted)', fontSize: 11 }}>{data.customer_key}</div></div><span style={{ padding: '5px 10px', borderRadius: 999, background: 'var(--surface)', fontSize: 12, fontWeight: 800 }}>{STAGE_LABELS[data.stage] || data.stage}</span></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(145px,1fr))', gap: 8 }}>
        <Kpi label="المتاجر المرتبطة" value={fmt0(stores.length)} color="#2563EB"/><Kpi label="حسابات زوهو" value={fmt0(zoho.length)} color="#8B5CF6"/><Kpi label="المستحق" value={`${fmtMoney(finance.total_due)} ر.س`} color="var(--red)"/><Kpi label="محاولات التواصل" value={fmt0(followup.contact_attempts)} color="var(--gold)"/>
      </div>
      <Card style={{ padding: 12 }}><b style={{ fontSize: 12.5 }}>الهوية الموحدة</b><div style={{ display: 'grid', gap: 6, marginTop: 8 }}>{stores.map(store => <div key={store.store_id} style={{ fontSize: 11.5 }}>متجر <b>{store.store_id}</b> · {store.store_name} · {fmt0(store.shipments)} شحنة</div>)}{zoho.map(customer => <div key={customer.zoho_id || customer.name} style={{ fontSize: 11.5 }}>زوهو: <b>{customer.name}</b> · {customer.balance_status || '—'}</div>)}</div></Card>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 10 }}>
        <Card style={{ padding: 12 }}><b style={{ fontSize: 12.5 }}>المتابعة الحالية</b><div style={{ marginTop: 8, fontSize: 11.5, lineHeight: 1.8 }}>المسؤول: <b>{followup.owner_name || 'بلا مسؤول'}</b><br/>المرحلة: <b>{STAGE_LABELS[followup.sales_stage] || followup.sales_stage || 'لم تبدأ'}</b><br/>الإجراء التالي: <b>{fmtDateTime(followup.next_action_at)}</b></div></Card>
        <Card style={{ padding: 12 }}><b style={{ fontSize: 12.5 }}>أثر بعد آخر تواصل</b><div style={{ marginTop: 8, fontSize: 11.5, lineHeight: 1.8 }}>سداد: <b>{fmtMoney(impact.paid_amount)} ر.س</b><br/>أحداث شحن: <b>{fmt0(impact.shipment_events)}</b><br/><small style={{ color: 'var(--muted2)' }}>ارتباط زمني، وليس إثباتًا أن التواصل هو السبب.</small></div></Card>
      </div>
      <Card style={{ padding: 12 }}><b style={{ fontSize: 12.5 }}>آخر تحولات العميل</b><div style={{ display: 'grid', gap: 6, marginTop: 8 }}>{(data.lifecycle || []).slice(0, 6).map(event => <div key={event.id} style={{ fontSize: 11.5, display: 'flex', justifyContent: 'space-between', gap: 10 }}><span>{event.store_name} · {event.event_type}</span><span style={{ color: 'var(--muted2)' }}>{fmtDateTime(event.observed_at)}</span></div>)}{!(data.lifecycle || []).length ? <span style={{ color: 'var(--muted2)', fontSize: 11.5 }}>لا توجد تحولات مسجلة بعد.</span> : null}</div></Card>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><Btn variant="outline" icon={<ExternalLink size={13}/>} onClick={onOpenFull}>فتح ملف العميل الكامل</Btn></div>
    </div>}
  </Modal>;
}

const fieldLabel = { display: 'grid', gap: 6, fontSize: 12, fontWeight: 700 };
const fieldInput = { width: '100%', border: '1px solid var(--border2)', borderRadius: 9, background: 'var(--surface)', color: 'var(--text)', padding: '9px 10px', font: 'inherit' };

function Pad({ children }) { return <div style={{ padding: '24px 28px 80px', maxWidth: 1320, margin: '0 auto' }}>{children}</div>; }
function Kpi({ label, value, color }) {
  return (
    <div className="stat-card" style={{
      background: 'var(--card)', border: '1px solid var(--border2)',
      borderRadius: 'var(--r-lg)', padding: '12px 14px',
      '--sc-tone': color || 'var(--accent)',
    }}>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'var(--font-mono)', color: color || 'var(--text)' }}>{value}</div>
    </div>
  );
}

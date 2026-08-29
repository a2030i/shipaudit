// "مهام الأسبوع" — recurring tasks scheduler.
//
// Top: a 3-column "overdue / due this week / later" board so the
// operator can see at a glance what's late and what's coming.
// Below: a CRUD table of every schedule (carrier × task-kind) where
// the operator sets cadence + day-of-period.
//
// The "due" state is derived from the contractual calendar slots and
// last_completed_at. A late completion never moves the next agreed date.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  RefreshCw, CheckCircle2, Plus, Calendar, AlertTriangle,
  Clock, X, Trash2, ListTodo,
} from 'lucide-react';
import {
  Card, Btn, Spinner, Empty, Modal, toast, PageHeader, Select,
} from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  listSchedules, upsertSchedule, markTaskDone, deleteSchedule,
  partitionByDueness, scheduleRequirementLabel, legacyScheduleDays,
  parseScheduleDays, deriveCarrierScheduleCoverage, requiredScheduleKindsForCarrier,
  listCarrierScheduleEvidence,
  TASK_KIND_META, CADENCE_META, WEEKDAY_META,
} from '../lib/tasksService.js';

const fmtDate = (iso) => {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
  } catch { return iso; }
};

const displayedScheduleNote = (schedule) => {
  if (schedule?.task_kind === 'cod_remittance') {
    return 'سجل تاريخي محفوظ؛ لا ينشئ التزامًا تشغيليًا جديدًا.';
  }

  const note = String(schedule?.notes || '').trim();
  if (!note) return '—';

  // لا نعدّل السجل التاريخي، لكننا نعرض وصف المهمة وفق نموذج التشغيل الحالي.
  return note.replace(/ملف موحّد\s*\(فاتورة\s*\+\s*تحصيل\)/g, 'فاتورة ناقل');
};

export default function Tasks({ carriers = [], isActive = true }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [schedules, setSchedules] = useState([]);
  const [scheduleEvidence, setScheduleEvidence] = useState({});
  const [evidenceError, setEvidenceError] = useState('');
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorRow, setEditorRow] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const carrierIds = (carriers || []).map(carrier => carrier.id).filter(Boolean);
      const [nextSchedules, evidenceResult] = await Promise.all([
        listSchedules({ activeOnly: false }),
        listCarrierScheduleEvidence(carrierIds)
          .then(value => ({ value, error: null }))
          .catch(error => ({ value: {}, error })),
      ]);
      setSchedules(nextSchedules);
      setScheduleEvidence(evidenceResult.value);
      setEvidenceError(evidenceResult.error?.message || '');
    } catch (e) {
      toast(`فشل التحميل: ${e.message}`, 'error');
    }
    setLoading(false);
  }, [carriers]);

  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh, location.pathname]);

  const operationalSchedules = useMemo(
    () => schedules.filter(schedule => schedule.task_kind !== 'cod_remittance'),
    [schedules],
  );
  const groups = useMemo(() => partitionByDueness(operationalSchedules), [operationalSchedules]);
  const carrierNameById = useMemo(
    () => new Map((carriers || []).map(c => [c.id, c.name])),
    [carriers],
  );
  const currentPeriod = new Date().toISOString().slice(0, 7);
  const scheduleCoverage = useMemo(
    () => deriveCarrierScheduleCoverage({ carriers, schedules, period: currentPeriod }),
    [carriers, schedules, currentPeriod],
  );

  const handleMarkDone = async (s) => {
    try {
      await markTaskDone(s.id, profile?.id || null);
      toast(`تم تسجيل استلام "${TASK_KIND_META[s.task_kind]?.label}" في لوحة التذكير فقط؛ إقفال الدورة يعتمد الملف الفعلي`, 'success');
      refresh();
    } catch (e) { toast(`فشل: ${e.message}`, 'error'); }
  };

  const handleDelete = async (id) => {
    if (!confirm('حذف المهمة المتكررة نهائياً؟')) return;
    try {
      await deleteSchedule(id);
      toast('تم الحذف', 'success');
      refresh();
    } catch (e) { toast(`فشل: ${e.message}`, 'error'); }
  };

  const openEditor = (row = null) => {
    setEditorRow(row);
    setEditorOpen(true);
  };

  const configureCoverage = row => {
    if (row.status === 'unclassified') {
      navigate(`/carriers?id=${encodeURIComponent(row.carrierId)}`);
      return;
    }
    const kind = row.invalidKinds[0] || row.missingKinds[0];
    const existing = schedules.find(schedule => schedule.active
      && String(schedule.carrier_id) === row.carrierId
      && schedule.task_kind === kind);
    openEditor(existing || {
      carrier_id: row.carrierId,
      task_kind: kind,
      cadence: kind === 'invoice' ? 'monthly' : 'weekly',
      schedule_basis: 'month_days',
      due_days: [],
    });
  };

  return (
    <div style={{ padding: '24px 28px 80px', maxWidth: 1320, margin: '0 auto' }}>
      <PageHeader
        icon={<ListTodo size={22}/>}
        title="جداول استلام الناقلين"
        subtitle="اضبط موعد استلام فاتورة كل ناقل؛ COD القديم يظهر للتتبع فقط ولا ينشئ موعدًا جديدًا"
        meta={`${groups.overdue.length} متأخّر · ${groups.dueThisWeek.length} مستحق هذا الأسبوع`}
        actions={
          <>
            <Btn size="md" variant="ghost" icon={<RefreshCw size={14} className={loading ? 'spin' : ''}/>} onClick={refresh} disabled={loading}>
              تحديث
            </Btn>
            <Btn size="md" variant="primary" icon={<Plus size={14}/>} onClick={() => openEditor(null)}>
              مهمة جديدة
            </Btn>
          </>
        }
      />

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Spinner size={28}/></div>
      ) : schedules.length === 0 ? (
        <>
          <ScheduleCoveragePanel rows={scheduleCoverage} evidence={scheduleEvidence} evidenceError={evidenceError} onConfigure={configureCoverage}/>
          <Card>
            <Empty
              icon="📅"
              title="لم تُضف أي مهمة متكررة بعد"
              sub='اضغط "مهمة جديدة" لإضافة موعد استلام فاتورة شركة الشحن'
            />
          </Card>
        </>
      ) : (
        <>
          <ScheduleCoveragePanel rows={scheduleCoverage} evidence={scheduleEvidence} evidenceError={evidenceError} onConfigure={configureCoverage}/>
          {/* Due-status board */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 14, marginBottom: 22,
          }}>
            <DueColumn
              accent="#EF4444"
              icon={<AlertTriangle size={16}/>}
              title="متأخّر"
              hint="فاتك موعد التسليم"
              rows={groups.overdue}
              empty="ولا مهمة متأخّرة"
              carrierNameById={carrierNameById}
              onDone={handleMarkDone}
              onEdit={openEditor}
            />
            <DueColumn
              accent="var(--gold)"
              icon={<Clock size={16}/>}
              title="مستحق هذا الأسبوع"
              hint="استعد لاستلامها"
              rows={groups.dueThisWeek}
              empty="ولا مهمة مستحقة هذا الأسبوع"
              carrierNameById={carrierNameById}
              onDone={handleMarkDone}
              onEdit={openEditor}
            />
            <DueColumn
              accent="var(--green)"
              icon={<Calendar size={16}/>}
              title="لاحقاً"
              hint="ضمن الأسبوعين القادمين"
              rows={groups.later}
              empty="لا توجد مهام منتظمة قادمة"
              carrierNameById={carrierNameById}
              onDone={handleMarkDone}
              onEdit={openEditor}
            />
          </div>

          {/* On-demand list — separate because no due-date logic */}
          {groups.onDemand.length > 0 && (
            <Card style={{ padding: '18px 22px', marginBottom: 18 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--font-mono)', letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: 600, marginBottom: 10 }}>
                عند الطلب ({groups.onDemand.length})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {groups.onDemand.map(s => (
                  <span key={s.id} style={{
                    padding: '6px 12px', borderRadius: 999,
                    background: 'var(--surface)', border: '1px solid var(--border)',
                    fontSize: 12, color: 'var(--text2)', fontWeight: 500,
                  }}>
                    {TASK_KIND_META[s.task_kind]?.icon} {carrierNameById.get(s.carrier_id) || s.carrier_id} · {TASK_KIND_META[s.task_kind]?.label}
                  </span>
                ))}
              </div>
            </Card>
          )}

          {/* Full schedule table */}
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
              <h3 style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text)', margin: 0 }}>
                كل المهام المُسجَّلة ({schedules.length})
              </h3>
            </div>
            <table className="tasks-schedule-table" style={{ fontSize: 12.5, width: '100%' }}>
              <thead>
                <tr>
                  <th>الشركة</th>
                  <th>نوع المهمة</th>
                  <th>التكرار</th>
                  <th>آخر تنفيذ</th>
                  <th>ملاحظة</th>
                  <th style={{ textAlign: 'left' }}>إجراء</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map(s => {
                  const kindMeta = TASK_KIND_META[s.task_kind] || {};
                  const cadMeta  = CADENCE_META[s.cadence] || {};
                  const isHistoricalCod = s.task_kind === 'cod_remittance';
                  return (
                    <tr key={s.id} style={{ opacity: s.active ? 1 : 0.5 }}>
                      <td className="tasks-schedule-carrier" style={{ fontWeight: 600 }}>{carrierNameById.get(s.carrier_id) || s.carrier_id}</td>
                      <td className="tasks-schedule-kind">
                        <span style={{
                          padding: '3px 9px', borderRadius: 999,
                          background: isHistoricalCod ? 'var(--surface)' : `color-mix(in srgb, ${kindMeta.color} 14%, transparent)`,
                          color: isHistoricalCod ? 'var(--muted)' : kindMeta.color,
                          border: isHistoricalCod ? '1px solid var(--border)' : '1px solid transparent',
                          fontWeight: 600, fontSize: 11.5,
                        }}>
                          {kindMeta.icon} {kindMeta.label}
                        </span>
                      </td>
                      <td className="tasks-schedule-cadence" data-label="التكرار">{s.active ? scheduleRequirementLabel(s, currentPeriod) : cadMeta.label}</td>
                      <td className="tasks-schedule-completed" data-label="آخر تنفيذ" style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--muted)' }}>
                        {s.last_completed_at ? fmtDate(s.last_completed_at) : '— لم يُسجَّل'}
                      </td>
                      <td className="tasks-schedule-note" data-label="ملاحظة" style={{ fontSize: 11.5, color: 'var(--muted)' }}>{displayedScheduleNote(s)}</td>
                      <td className="tasks-schedule-action" style={{ textAlign: 'left' }}>
                        <div style={{ display: 'inline-flex', gap: 6 }}>
                          {isHistoricalCod ? (
                            <span style={{ color: 'var(--muted)', fontSize: 11 }}>تاريخي للقراءة فقط</span>
                          ) : (
                            <>
                              <Btn size="sm" variant="ghost" onClick={() => openEditor(s)}>تعديل</Btn>
                              <Btn size="sm" variant="ghost" icon={<Trash2 size={12}/>} onClick={() => handleDelete(s.id)} style={{ color: 'var(--red)' }}/>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </>
      )}

      {editorOpen && (
        <ScheduleEditor
          row={editorRow}
          carriers={carriers}
          onClose={() => { setEditorOpen(false); setEditorRow(null); }}
          onSaved={() => { setEditorOpen(false); setEditorRow(null); refresh(); }}
        />
      )}
    </div>
  );
}

function evidenceSummary(row, evidence) {
  if (!evidence) return 'لا يوجد سجل تاريخي كافٍ داخل النظام لاقتراح موعد؛ يلزم تأكيد الموعد الفعلي من العقد أو الشركة.';
  const parts = [];
  const needsInvoice = [...row.missingKinds, ...row.invalidKinds].includes('invoice');
  if (needsInvoice) {
    parts.push(evidence.invoice.batchCount
      ? `الفواتير: ${evidence.invoice.batchCount} ملفات محفوظة (${evidence.invoice.dates.join('، ') || 'بلا تاريخ'})`
      : 'الفواتير: لا يوجد ملف تاريخي محفوظ');
  }
  return `${parts.join(' · ')}. هذه قرائن فقط ولا تُحفظ كموعد تلقائي.`;
}

function ScheduleCoveragePanel({ rows, evidence, evidenceError, onConfigure }) {
  const incomplete = (rows || []).filter(row => row.status !== 'complete');
  const completeCount = (rows || []).length - incomplete.length;
  return (
    <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 18 }}>
      <div style={{ padding: '15px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 15, color: 'var(--text)' }}>اكتمال جداول الناقلين</h3>
          <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 11.5, lineHeight: 1.6 }}>
            كل ناقل متعاقد يحتاج جدول فاتورة واحدًا صالحًا. تصنيفات COD القديمة لا تنشئ جدولًا أو متطلب إقفال جديدًا.
          </p>
        </div>
        <span style={{ padding: '5px 10px', borderRadius: 999, background: incomplete.length ? 'color-mix(in srgb, var(--gold) 14%, transparent)' : 'color-mix(in srgb, var(--green) 14%, transparent)', color: incomplete.length ? 'var(--gold)' : 'var(--green)', fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap' }}>
          {completeCount} / {(rows || []).length} مكتمل
        </span>
      </div>
      {incomplete.length === 0 ? (
        <div style={{ padding: 16, color: 'var(--green)', fontSize: 12.5, fontWeight: 700 }}>
          ✓ كل ناقل ذي عقد ساري يملك جدول الفاتورة المطلوب.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8, padding: 12 }}>
          {evidenceError && (
            <div style={{ padding: '9px 11px', borderRadius: 9, background: 'color-mix(in srgb, var(--red) 8%, var(--surface2))', color: 'var(--red)', fontSize: 11.5 }}>
              تعذرت قراءة دليل الوصول التاريخي؛ لم يُفترض أي موعد: {evidenceError}
            </div>
          )}
          {incomplete.map(row => {
            const missing = [...row.missingKinds, ...row.invalidKinds]
              .filter((kind, index, all) => all.indexOf(kind) === index);
            const firstKind = missing[0];
            return (
              <div key={row.carrierId} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', alignItems: 'center', gap: 10, padding: '11px 12px', border: '1px solid color-mix(in srgb, var(--gold) 30%, var(--border))', borderRadius: 11, background: 'color-mix(in srgb, var(--gold) 7%, var(--surface2))' }}>
                <div style={{ minWidth: 0 }}>
                  <strong style={{ display: 'block', color: 'var(--text)', fontSize: 13 }}>{row.carrierName}</strong>
                  <span style={{ display: 'block', marginTop: 3, color: 'var(--muted)', fontSize: 11.5 }}>
                    {row.status === 'unclassified'
                      ? 'طريقة ملفات الشركة غير محددة؛ صنّفها قبل إنشاء الجداول.'
                      : `ناقص: ${missing.map(kind => TASK_KIND_META[kind]?.label || kind).join(' + ')}`}
                  </span>
                  {row.status !== 'unclassified' && !evidenceError && (
                    <span style={{ display: 'block', marginTop: 5, color: 'var(--text2)', fontSize: 11, lineHeight: 1.7 }}>
                      {evidenceSummary(row, evidence?.[row.carrierId])}
                    </span>
                  )}
                </div>
                <Btn size="sm" variant="ghost" onClick={() => onConfigure(row)}>
                  {row.status === 'unclassified' ? 'تصنيف الشركة' : `ضبط ${TASK_KIND_META[firstKind]?.label || 'الجدول'}`}
                </Btn>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ── Due column ─────────────────────────────────────────────────
function DueColumn({ accent, icon, title, hint, rows, empty, carrierNameById, onDone, onEdit }) {
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{
        padding: '14px 18px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8,
          background: `color-mix(in srgb, ${accent} 14%, transparent)`,
          color: accent,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>{title}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{hint}</div>
        </div>
        <span style={{
          padding: '3px 9px', borderRadius: 999,
          background: `color-mix(in srgb, ${accent} 14%, transparent)`,
          color: accent, fontSize: 11.5, fontFamily: 'var(--font-mono)', fontWeight: 700,
        }}>
          {rows.length}
        </span>
      </div>
      <div style={{ maxHeight: 360, overflowY: 'auto' }}>
        {rows.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: 'var(--muted)' }}>{empty}</div>
        ) : rows.map((s, i) => {
          const kindMeta = TASK_KIND_META[s.task_kind] || {};
          return (
            <div key={s.id} onClick={() => onEdit(s)} style={{
              display: 'grid', gridTemplateColumns: '1fr auto', gap: 10,
              padding: '12px 16px', alignItems: 'center', cursor: 'pointer',
              borderBottom: i === rows.length - 1 ? 'none' : '1px solid var(--border)',
              transition: 'background .12s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>{kindMeta.icon}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {carrierNameById.get(s.carrier_id) || s.carrier_id}
                  </span>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
                  {kindMeta.label} · {s._state.label}
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onDone(s); }}
                title="يسجل الاستلام في لوحة التذكير فقط؛ إقفال الشهر يعتمد رفع الملف واعتماده"
                style={{
                  background: 'transparent', color: accent, border: `1.5px solid ${accent}`,
                  padding: '6px 12px', borderRadius: 999,
                  fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  fontFamily: 'inherit', whiteSpace: 'nowrap',
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}
              >
                <CheckCircle2 size={12}/> تسجيل استلام
              </button>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── Editor modal ───────────────────────────────────────────────
function ScheduleEditor({ row, carriers, onClose, onSaved }) {
  const [carrierId, setCarrierId] = useState(row?.carrier_id || '');
  const [taskKind, setTaskKind] = useState(row?.task_kind || 'invoice');
  const [cadence, setCadence] = useState(row?.cadence || 'monthly');
  const [scheduleBasis, setScheduleBasis] = useState(
    row?.schedule_basis || (row?.cadence === 'weekly' && Number(row?.day_of_period) <= 6 ? 'weekday' : 'month_days'),
  );
  const initialDays = legacyScheduleDays(row || {});
  const [weekday, setWeekday] = useState(
    String(row?.schedule_basis === 'weekday' || (row?.cadence === 'weekly' && Number(row?.day_of_period) <= 6)
      ? (initialDays[0] ?? '') : ''),
  );
  const [dueDaysText, setDueDaysText] = useState(
    row?.schedule_basis === 'weekday' || (row?.cadence === 'weekly' && Number(row?.day_of_period) <= 6)
      ? '' : initialDays.join('، '),
  );
  const [notes, setNotes] = useState(row?.notes || '');
  const [active, setActive] = useState(row?.active ?? true);
  const [saving, setSaving] = useState(false);
  const selectedCarrier = (carriers || []).find(carrier => String(carrier.id) === String(carrierId));
  const fileKind = selectedCarrier?.file_signature?.file_kind || null;
  const requiredCycleKinds = requiredScheduleKindsForCarrier(selectedCarrier);
  const allowedTaskKinds = new Set([...requiredCycleKinds, 'statement', 'weight_report']);

  const changeCadence = (value) => {
    setCadence(value);
    setScheduleBasis(value === 'weekly' ? 'weekday' : 'month_days');
    setWeekday('');
    setDueDaysText('');
  };

  const changeCarrier = (value) => {
    setCarrierId(value);
    const carrier = (carriers || []).find(item => String(item.id) === String(value));
    const requiredKinds = requiredScheduleKindsForCarrier(carrier);
    if (['invoice', 'cod_remittance'].includes(taskKind) && !requiredKinds.includes(taskKind)) {
      setTaskKind(requiredKinds[0] || 'statement');
    }
  };

  const handleSave = async () => {
    if (!carrierId) return toast('اختر الشركة', 'warn');
    if (taskKind === 'cod_remittance') return toast('توقف إنشاء جداول COD جديدة؛ استخدم جدول الفاتورة للمسار التشغيلي الحالي', 'warn');
    setSaving(true);
    try {
      const dueDays = cadence === 'on_demand'
        ? []
        : scheduleBasis === 'weekday'
          ? parseScheduleDays([weekday])
          : parseScheduleDays(dueDaysText);
      await upsertSchedule({
        id: row?.id || null,
        carrierId,
        taskKind,
        cadence,
        scheduleBasis,
        dueDays,
        notes,
        active,
      });
      toast('✓ تم الحفظ', 'success');
      onSaved();
    } catch (e) { toast(`فشل: ${e.message}`, 'error'); }
    setSaving(false);
  };

  return (
    <Modal title={row?.id ? 'تعديل مهمة متكررة' : 'مهمة متكررة جديدة'} onClose={onClose} width={520}>
      <div style={{ display: 'grid', gap: 12 }}>
        <Select label="الشركة" value={carrierId} onChange={e => changeCarrier(e.target.value)}>
          <option value="">اختر…</option>
          {(carriers || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>

        {carrierId && (
          <div style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--surface2)', color: 'var(--text2)', fontSize: 12.5 }}>
            التشغيل الحالي يتطلب جدول فاتورة فقط. تصنيف الملف التاريخي
            {fileKind ? ` (${fileKind})` : ''} محفوظ للتتبع ولا ينشئ جدول COD جديدًا.
          </div>
        )}

        <div>
          <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginBottom: 5, fontWeight: 600 }}>نوع المهمة</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
            {Object.entries(TASK_KIND_META).filter(([key]) => allowedTaskKinds.has(key)).map(([k, m]) => (
              <button key={k} onClick={() => setTaskKind(k)} style={{
                padding: '10px 12px', borderRadius: 10,
                background: taskKind === k ? `color-mix(in srgb, ${m.color} 12%, transparent)` : 'transparent',
                border: `1px solid ${taskKind === k ? m.color : 'var(--border2)'}`,
                color: taskKind === k ? m.color : 'var(--text2)',
                fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                fontFamily: 'inherit',
                display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'center',
              }}>
                <span>{m.icon}</span> {m.label}
              </button>
            ))}
          </div>
        </div>

        <Select label="التكرار" value={cadence} onChange={e => changeCadence(e.target.value)}>
          {Object.entries(CADENCE_META).map(([k, m]) => (
            <option key={k} value={k}>{m.label}</option>
          ))}
        </Select>

        {cadence === 'weekly' && (
          <div>
            <Select label="طريقة مواعيد الأسبوع" value={scheduleBasis} onChange={e => {
              setScheduleBasis(e.target.value);
              setWeekday('');
              setDueDaysText('');
            }}>
              <option value="weekday">يوم ثابت من كل أسبوع</option>
              <option value="month_days">تواريخ محددة داخل الشهر</option>
            </Select>
            {scheduleBasis === 'weekday' ? (
              <Select label="يوم الاستلام الأسبوعي" value={weekday} onChange={e => setWeekday(e.target.value)}>
                <option value="">اختر اليوم…</option>
                {WEEKDAY_META.map(day => <option key={day.value} value={day.value}>{day.label}</option>)}
              </Select>
            ) : (
              <ScheduleDaysInput value={dueDaysText} onChange={setDueDaysText} label="تواريخ الاستلام داخل الشهر" placeholder="مثال: 8، 15، 22، 29" />
            )}
          </div>
        )}

        {cadence === 'biweekly' && (
          <ScheduleDaysInput value={dueDaysText} onChange={setDueDaysText} label="موعدا الاستلام داخل الشهر" placeholder="مثال: 5، 20" />
        )}

        {cadence === 'monthly' && (
          <ScheduleDaysInput value={dueDaysText} onChange={setDueDaysText} label="يوم استلام الفاتورة الشهرية" placeholder="مثال: 1" />
        )}

        <div>
          <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginBottom: 5, fontWeight: 600 }}>ملاحظة (اختياري)</label>
          <textarea
            value={notes} onChange={e => setNotes(e.target.value)}
            rows={2}
            placeholder="مثلاً: التحصيل عبر بريد العمل المالي"
            style={{ width: '100%', padding: '10px 12px', borderRadius: 10, fontSize: 13, resize: 'vertical' }}
          />
        </div>

        {row?.id && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} style={{ accentColor: 'var(--accent)' }}/>
            مهمة نشطة (إلغاء التحديد = إيقاف بدون حذف)
          </label>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <Btn size="md" variant="ghost" onClick={onClose}>إلغاء</Btn>
          <Btn size="md" variant="accent" onClick={handleSave} disabled={saving}>
            {saving ? 'جارٍ الحفظ…' : 'حفظ'}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

function ScheduleDaysInput({ value, onChange, label, placeholder }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginBottom: 5, fontWeight: 600 }}>{label}</label>
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        style={{ width: '100%', padding: '8px 12px', borderRadius: 10, fontSize: 13 }}
      />
      <div style={{ marginTop: 5, color: 'var(--muted)', fontSize: 11 }}>افصل بين التواريخ بفاصلة. سيعرض النظام المواعيد الفعلية قبل الإقفال.</div>
    </div>
  );
}

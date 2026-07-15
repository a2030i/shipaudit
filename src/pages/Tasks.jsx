// "مهام الأسبوع" — recurring tasks scheduler.
//
// Top: a 3-column "overdue / due this week / later" board so the
// operator can see at a glance what's late and what's coming.
// Below: a CRUD table of every schedule (carrier × task-kind) where
// the operator sets cadence + day-of-period.
//
// The "due" state isn't tracked in the DB beyond last_completed_at —
// derived in JS via deriveDueState() from the cadence + last done
// date. Marking a task done resets the clock.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
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
  partitionByDueness, TASK_KIND_META, CADENCE_META,
} from '../lib/tasksService.js';

const fmtDate = (iso) => {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
  } catch { return iso; }
};

export default function Tasks({ carriers = [], isActive = true }) {
  const location = useLocation();
  const { profile } = useAuth();
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorRow, setEditorRow] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSchedules(await listSchedules({ activeOnly: false }));
    } catch (e) {
      toast(`فشل التحميل: ${e.message}`, 'error');
    }
    setLoading(false);
  }, []);

  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh, location.pathname]);

  const groups = useMemo(() => partitionByDueness(schedules), [schedules]);
  const carrierNameById = useMemo(
    () => new Map((carriers || []).map(c => [c.id, c.name])),
    [carriers],
  );

  const handleMarkDone = async (s) => {
    try {
      await markTaskDone(s.id, profile?.id || null);
      toast(`✓ تم تعليم "${TASK_KIND_META[s.task_kind]?.label}" كمنجَز`, 'success');
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

  return (
    <div style={{ padding: '24px 28px 80px', maxWidth: 1320, margin: '0 auto' }}>
      <PageHeader
        icon={<ListTodo size={22}/>}
        title="مهام الأسبوع"
        subtitle="تتبّع مواعيد استلام الفواتير والتحصيلات لكل شركة — أسبوعي · شهري · حسب الطلب"
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
        <Card>
          <Empty
            icon="📅"
            title="لم تُضف أي مهمة متكررة بعد"
            sub='اضغط "مهمة جديدة" لإضافة موعد استلام فاتورة أو تحصيل من شركة'
          />
        </Card>
      ) : (
        <>
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
                ON-DEMAND ({groups.onDemand.length})
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
            <table style={{ fontSize: 12.5, width: '100%' }}>
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
                  return (
                    <tr key={s.id} style={{ opacity: s.active ? 1 : 0.5 }}>
                      <td style={{ fontWeight: 600 }}>{carrierNameById.get(s.carrier_id) || s.carrier_id}</td>
                      <td>
                        <span style={{
                          padding: '3px 9px', borderRadius: 999,
                          background: `color-mix(in srgb, ${kindMeta.color} 14%, transparent)`,
                          color: kindMeta.color, fontWeight: 600, fontSize: 11.5,
                        }}>
                          {kindMeta.icon} {kindMeta.label}
                        </span>
                      </td>
                      <td>{cadMeta.label}{s.day_of_period != null ? ` · يوم ${s.day_of_period}` : ''}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--muted)' }}>
                        {s.last_completed_at ? fmtDate(s.last_completed_at) : '— لم يُسجَّل'}
                      </td>
                      <td style={{ fontSize: 11.5, color: 'var(--muted)' }}>{s.notes || '—'}</td>
                      <td style={{ textAlign: 'left' }}>
                        <div style={{ display: 'inline-flex', gap: 6 }}>
                          <Btn size="sm" variant="ghost" onClick={() => openEditor(s)}>تعديل</Btn>
                          <Btn size="sm" variant="ghost" icon={<Trash2 size={12}/>} onClick={() => handleDelete(s.id)} style={{ color: 'var(--red)' }}/>
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
                title="اضغط لتعليم المهمة كمنجَزة — تُعاد جدولتها تلقائياً للموعد الجاي"
                style={{
                  background: 'transparent', color: accent, border: `1.5px solid ${accent}`,
                  padding: '6px 12px', borderRadius: 999,
                  fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  fontFamily: 'inherit', whiteSpace: 'nowrap',
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}
              >
                <CheckCircle2 size={12}/> أنجزتها
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
  const [taskKind, setTaskKind] = useState(row?.task_kind || 'cod_remittance');
  const [cadence, setCadence] = useState(row?.cadence || 'monthly');
  const [dayOfPeriod, setDayOfPeriod] = useState(row?.day_of_period ?? '');
  const [notes, setNotes] = useState(row?.notes || '');
  const [active, setActive] = useState(row?.active ?? true);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!carrierId) return toast('اختر الشركة', 'warn');
    setSaving(true);
    try {
      await upsertSchedule({
        id: row?.id || null,
        carrierId,
        taskKind,
        cadence,
        dayOfPeriod: dayOfPeriod === '' ? null : Number(dayOfPeriod),
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
        <Select label="الشركة" value={carrierId} onChange={e => setCarrierId(e.target.value)}>
          <option value="">اختر…</option>
          {(carriers || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>

        <div>
          <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginBottom: 5, fontWeight: 600 }}>نوع المهمة</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
            {Object.entries(TASK_KIND_META).map(([k, m]) => (
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

        <Select label="التكرار" value={cadence} onChange={e => setCadence(e.target.value)}>
          {Object.entries(CADENCE_META).map(([k, m]) => (
            <option key={k} value={k}>{m.label}</option>
          ))}
        </Select>

        {cadence !== 'on_demand' && (
          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginBottom: 5, fontWeight: 600 }}>
              يوم محدد {cadence === 'weekly' ? '(0=الأحد، 6=السبت)' : cadence === 'monthly' ? '(1-28)' : '(اختياري)'}
            </label>
            <input
              type="number" min="0" max="28"
              value={dayOfPeriod}
              onChange={e => setDayOfPeriod(e.target.value)}
              placeholder="اختياري"
              style={{ width: '100%', padding: '8px 12px', borderRadius: 10, fontSize: 13 }}
            />
          </div>
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

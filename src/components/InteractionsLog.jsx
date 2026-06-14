// Shared CRM activity-log component. Drop it inside any modal that
// shows a customer/merchant — it loads, renders, and lets the user
// add interactions tied to the customer_name and/or store_id.
//
// Self-contained: loads on mount + reloads on identifier change,
// shows a sticky banner with the most actionable signal (overdue
// promise > active promise > last interaction), and exposes a quick-
// add form with the 5 supported kinds (reminder, promise, call,
// visit, free-text note).

import { useState, useEffect, useCallback } from 'react';
import { Calendar, Activity, X } from 'lucide-react';
import { Btn, Spinner, toast } from './UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  listInteractions, addInteraction, deleteInteraction, interactionKindMeta,
} from '../lib/customerInteractionsService.js';

const fmtDate = (iso) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return iso; }
};
const daysAgo = (iso) => {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso)) / 86_400_000);
};

export default function InteractionsLog({ customerName, storeId }) {
  const { profile } = useAuth();
  const [interactions, setInteractions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newKind, setNewKind] = useState('reminder_sent');
  const [newNote, setNewNote] = useState('');
  const [newDueDate, setNewDueDate] = useState('');
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    if (!customerName && !storeId) { setInteractions([]); setLoading(false); return; }
    setLoading(true);
    try {
      const rows = await listInteractions({ customerName, storeId });
      setInteractions(rows);
    } catch (e) {
      console.warn('interactions load failed:', e.message);
      setInteractions([]);
    }
    setLoading(false);
  }, [customerName, storeId]);

  useEffect(() => { reload(); }, [reload]);

  const handleAdd = async () => {
    if (newKind === 'note' && !newNote.trim()) {
      toast('اكتب الملاحظة أولاً', 'warn');
      return;
    }
    if (newKind === 'promise_to_pay' && !newDueDate) {
      toast('اختر تاريخ الوعد', 'warn');
      return;
    }
    setSaving(true);
    try {
      await addInteraction({
        customerName, storeId,
        kind:    newKind,
        note:    newNote.trim() || null,
        dueDate: newDueDate || null,
        userId:   profile?.id || null,
        userName: profile?.name || null,
      });
      toast('✓ تم الحفظ', 'success');
      setNewNote('');
      setNewDueDate('');
      setShowAddForm(false);
      reload();
    } catch (e) {
      toast(`فشل الحفظ: ${e.message}`, 'error');
    }
    setSaving(false);
  };

  const handleDelete = async (id) => {
    if (!confirm('حذف هذه الحركة؟')) return;
    try {
      await deleteInteraction(id);
      toast('تم الحذف', 'success');
      reload();
    } catch (e) {
      toast(`فشل: ${e.message}`, 'error');
    }
  };

  const last = interactions[0] || null;
  const todayISO = new Date().toISOString().slice(0, 10);
  const openPromise = interactions.find(i => i.kind === 'promise_to_pay' && i.due_date);
  const promiseOverdue = openPromise && openPromise.due_date < todayISO;

  return (
    <div>
      {/* Sticky summary banner */}
      {(openPromise || last) && (
        <div style={{
          padding: '12px 14px', marginBottom: 12,
          background: promiseOverdue
            ? 'rgba(239,68,68,.06)'
            : openPromise
              ? 'rgba(245,158,11,.07)'
              : 'rgba(59,130,246,.05)',
          borderRadius: 12,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          {openPromise ? (
            <>
              <Calendar size={16} color={promiseOverdue ? 'var(--red)' : '#F59E0B'}/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>
                  {promiseOverdue ? 'وعد متأخّر · انقضى تاريخه' : 'وعد بالدفع'}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
                  {fmtDate(openPromise.due_date)}
                  {openPromise.note ? ` — ${openPromise.note}` : ''}
                  {openPromise.created_by_name ? ` · ${openPromise.created_by_name}` : ''}
                </div>
              </div>
            </>
          ) : (
            <>
              <Activity size={16} color="#3B82F6"/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>
                  آخر تواصل: {interactionKindMeta(last.kind).label}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
                  {fmtDate(last.created_at)} · {daysAgo(last.created_at)}ي
                  {last.created_by_name ? ` · ${last.created_by_name}` : ''}
                  {last.note ? ` — ${last.note}` : ''}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Section header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 10, marginBottom: 10,
      }}>
        <div>
          <div style={{
            fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)',
            letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4, fontWeight: 600,
          }}>
            ACTIVITY LOG
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
            سجل المتابعة {interactions.length > 0 ? `(${interactions.length})` : ''}
          </div>
        </div>
        {!showAddForm && (
          <Btn size="sm" variant="accent" onClick={() => setShowAddForm(true)}>
            + إضافة حركة
          </Btn>
        )}
      </div>

      {/* Quick-add form */}
      {showAddForm && (
        <div style={{
          padding: '14px 16px', marginBottom: 12,
          background: 'var(--bg2)', borderRadius: 12,
        }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            {Object.entries({
              reminder_sent:  '📨 تذكير',
              promise_to_pay: '📅 وعد دفع',
              call_made:      '☎ مكالمة',
              visit:          '🏃 زيارة',
              note:           '✍ ملاحظة',
            }).map(([k, label]) => (
              <button key={k} onClick={() => setNewKind(k)} style={{
                padding: '6px 12px', borderRadius: 999,
                background: newKind === k ? interactionKindMeta(k).color : 'transparent',
                border: `1px solid ${newKind === k ? interactionKindMeta(k).color : 'var(--border2)'}`,
                color: newKind === k ? '#fff' : 'var(--text2)',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
                transition: 'all .15s',
              }}>{label}</button>
            ))}
          </div>

          {newKind === 'promise_to_pay' && (
            <div style={{ marginBottom: 8 }}>
              <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginBottom: 4, fontWeight: 600 }}>
                تاريخ الوعد *
              </label>
              <input type="date" value={newDueDate} onChange={e => setNewDueDate(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 10, fontSize: 13 }}/>
            </div>
          )}

          <textarea
            value={newNote}
            onChange={e => setNewNote(e.target.value)}
            placeholder={
              newKind === 'reminder_sent'  ? 'مثال: أرسلت تذكير واتساب · ما رد' :
              newKind === 'promise_to_pay' ? 'تفاصيل الوعد (اختياري)' :
              newKind === 'call_made'      ? 'مثال: رد، طلب مهلة أسبوع' :
              newKind === 'visit'          ? 'مثال: زرته في المعرض' :
                                              'اكتب ملاحظتك…'
            }
            rows={3}
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 10, fontSize: 13,
              resize: 'vertical', fontFamily: 'var(--font-sans)',
            }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
            <Btn size="sm" variant="ghost" onClick={() => { setShowAddForm(false); setNewNote(''); setNewDueDate(''); }}>
              إلغاء
            </Btn>
            <Btn size="sm" variant="accent" onClick={handleAdd} disabled={saving}>
              {saving ? 'جارٍ الحفظ…' : 'حفظ الحركة'}
            </Btn>
          </div>
        </div>
      )}

      {/* Timeline */}
      {loading ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
          <Spinner size={20}/>
        </div>
      ) : interactions.length === 0 ? (
        <div style={{
          padding: '22px 18px', textAlign: 'center', fontSize: 12.5,
          color: 'var(--muted)',
          border: '1px dashed var(--border2)', borderRadius: 12,
        }}>
          لا توجد حركات بعد — أضف أول تذكير أو ملاحظة
        </div>
      ) : (
        <div style={{
          border: '1px solid var(--border)', borderRadius: 12,
          maxHeight: 320, overflowY: 'auto',
        }}>
          {interactions.map((it, i) => {
            const km = interactionKindMeta(it.kind);
            const isOverdue = it.kind === 'promise_to_pay' && it.due_date && it.due_date < todayISO;
            return (
              <div key={it.id} style={{
                display: 'grid', gridTemplateColumns: '32px 1fr auto', gap: 12,
                padding: '12px 14px', alignItems: 'flex-start',
                borderBottom: i === interactions.length - 1 ? 'none' : '1px solid var(--border)',
                background: isOverdue ? 'rgba(239,68,68,.04)' : 'transparent',
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 9,
                  background: `color-mix(in srgb, ${km.color} 14%, transparent)`,
                  color: km.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 700,
                }}>
                  {km.label[0]}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: km.color }}>{km.label}</span>
                    {it.due_date && (
                      <span style={{
                        fontSize: 10.5, padding: '2px 8px', borderRadius: 999,
                        background: isOverdue ? 'rgba(239,68,68,.14)' : 'rgba(245,158,11,.12)',
                        color: isOverdue ? 'var(--red)' : '#F59E0B',
                        fontFamily: 'var(--font-mono)', fontWeight: 700,
                      }}>
                        {isOverdue ? 'متأخّر · ' : 'يستحق · '}{fmtDate(it.due_date)}
                      </span>
                    )}
                  </div>
                  {it.note && (
                    <div style={{ fontSize: 12.5, color: 'var(--text)', marginTop: 4, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                      {it.note}
                    </div>
                  )}
                  <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                    {fmtDate(it.created_at)} · {daysAgo(it.created_at)}ي
                    {it.created_by_name ? ` · ${it.created_by_name}` : ''}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(it.id)}
                  title="حذف الحركة"
                  style={{
                    background: 'transparent', border: 'none', color: 'var(--muted2)',
                    cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center',
                    transition: 'color .15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.color = 'var(--red)'}
                  onMouseLeave={e => e.currentTarget.style.color = 'var(--muted2)'}
                >
                  <X size={14}/>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

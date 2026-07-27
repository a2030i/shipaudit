// "إقفال الفترات" — month-end period closing.
//
// One row per month that has any financial activity. The operator
// can close (lock) or reopen any month. Closed months show:
//   - per-table row counts (what's locked)
//   - who closed + when + optional note
//   - reopen audit trail (who reopened + when + note) if applicable
//
// Closing is irreversible only in spirit — reopening is allowed but
// requires a written note so the audit trail tells the story.
//
// DB triggers attached to carrier_operations / cod_settlement /
// audits / payments block all writes (insert/update/delete) into
// closed periods. The UI here can't bypass them — it's just the
// operator-facing control surface.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import {
  RefreshCw, Lock, Unlock, Calendar, AlertTriangle,
  CheckCircle2, Info, FileText, Banknote, CreditCard, Receipt,
} from 'lucide-react';
import {
  Card, Btn, Spinner, Empty, Modal, toast, PageHeader,
} from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  listPeriods, getMonthsWithActivity, closePeriod, reopenPeriod, refreshClosedSet,
} from '../lib/periodsService.js';

const fmtMonth = (period) => {
  if (!period) return '—';
  const [y, m] = period.split('-');
  const months = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  return `${months[Number(m) - 1] || m} ${y}`;
};

const fmtDateTime = (iso) => {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  } catch { return iso; }
};

export default function Periods({ isActive = true }) {
  const location = useLocation();
  const { profile, can } = useAuth();
  const canClosePeriod = can('system.period_close');
  const [loading, setLoading] = useState(true);
  const [months, setMonths]   = useState([]);   // activity rows
  const [closes, setCloses]   = useState([]);   // period_closes rows
  const [actionTarget, setActionTarget] = useState(null);  // { period, kind: 'close'|'reopen' }

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [m, c] = await Promise.all([
        getMonthsWithActivity().catch(() => []),
        listPeriods().catch(() => []),
      ]);
      setMonths(m);
      setCloses(c);
      await refreshClosedSet();
    } catch (e) {
      toast(`فشل التحميل: ${e.message}`, 'error');
    }
    setLoading(false);
  }, []);

  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh, location.pathname]);

  // Combined row set — every month appears once with either an
  // existing close row or a synthetic "open" placeholder.
  const rows = useMemo(() => {
    const byPeriod = new Map(closes.map(c => [c.period, c]));
    // First, every month with activity (sorted DESC by getMonthsWithActivity)
    const seen = new Set();
    const out = [];
    for (const m of months) {
      const close = byPeriod.get(m.period);
      out.push({
        period:  m.period,
        counts:  m,
        close:   close || null,
        status:  close?.status || 'open',
      });
      seen.add(m.period);
    }
    // Then any close rows for months that have NO activity (rare —
    // e.g., the operator closed a month preemptively)
    for (const c of closes) {
      if (seen.has(c.period)) continue;
      out.push({
        period: c.period,
        counts: { ops_count: 0, cod_count: 0, audits_count: 0, payments_count: 0, total_count: 0 },
        close:  c,
        status: c.status,
      });
    }
    return out;
  }, [months, closes]);

  const handleAction = async (period, kind, note) => {
    try {
      const fn = kind === 'close' ? closePeriod : reopenPeriod;
      await fn({ period, note, userId: profile?.id || null });
      toast(kind === 'close' ? `تم إقفال ${fmtMonth(period)}` : `تم فتح ${fmtMonth(period)}`, 'success');
      setActionTarget(null);
      await refresh();
    } catch (e) {
      toast(`فشل: ${e.message}`, 'error');
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 320 }}>
          <Spinner size={28}/>
        </div>
      </div>
    );
  }

  const closedCount = rows.filter(r => r.status === 'closed').length;

  return (
    <div style={{ padding: '24px 28px 80px', maxWidth: 1100, margin: '0 auto' }}>
      <PageHeader
        icon={<Lock size={22}/>}
        iconColor="var(--brand)"
        title="إقفال الفترات"
        subtitle="اقفل الشهور المنتهية حتى لا يُعدّل عليها أحد. الفتح متاح لكن يترك أثراً في السجل."
        meta={`${closedCount} مقفل · ${rows.length - closedCount} مفتوح`}
        actions={
          <Btn size="sm" variant="ghost" icon={<RefreshCw size={13}/>} onClick={refresh}>
            تحديث
          </Btn>
        }
      />

      {/* Educational banner — explains what closing does, once */}
      <Card style={{ marginBottom: 18, background: 'color-mix(in srgb, var(--brand) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--brand) 22%, transparent)' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <Info size={18} color="var(--brand)" style={{ flexShrink: 0, marginTop: 2 }}/>
          <div style={{ fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.7 }}>
            عند إقفال شهر يتم منع أي إضافة / تعديل / حذف على:
            <strong style={{ color: 'var(--text)' }}> العمليات المحاسبية، تسويات COD، المراجعات، والدفعات</strong> داخل ذلك الشهر — على مستوى قاعدة البيانات (لا يمكن تجاوزه من الواجهة). فتح الشهر مجدداً ممكن لكن يجب إدخال سبب يبقى في السجل.
          </div>
        </div>
      </Card>

      {rows.length === 0 ? (
        <Empty
          icon="📅"
          title="لا يوجد نشاط مالي بعد"
          sub="بمجرد ما تظهر أول عملية / مراجعة / تسوية يظهر شهرها هنا."
        />
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <table className="m-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                {['الشهر', 'الحالة', 'الحركات المحاسبية', 'COD', 'مراجعات', 'دفعات', 'الإقفال / الفتح', 'إجراء'].map(h => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.period} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td data-label="" style={{ ...tdStyle, fontWeight: 700, color: 'var(--text)' }}>
                    {fmtMonth(r.period)}
                    <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                      {r.period}
                    </div>
                  </td>
                  <td data-label="الحالة" style={tdStyle}>
                    {r.status === 'closed' ? (
                      <span style={statusPill('var(--red)')}>
                        <Lock size={11}/> مقفل
                      </span>
                    ) : (
                      <span style={statusPill('var(--green)')}>
                        <Unlock size={11}/> مفتوح
                      </span>
                    )}
                  </td>
                  <td data-label="الحركات المحاسبية" style={countCell(r.counts.ops_count)}>{r.counts.ops_count.toLocaleString('en-US')}</td>
                  <td data-label="COD" style={countCell(r.counts.cod_count)}>{r.counts.cod_count.toLocaleString('en-US')}</td>
                  <td data-label="مراجعات" style={countCell(r.counts.audits_count)}>{r.counts.audits_count.toLocaleString('en-US')}</td>
                  <td data-label="دفعات" style={countCell(r.counts.payments_count)}>{r.counts.payments_count.toLocaleString('en-US')}</td>
                  <td data-label="الإقفال / الفتح" style={{ ...tdStyle, fontSize: 11.5 }}>
                    {r.close ? (
                      <div style={{ color: 'var(--muted)' }}>
                        {r.status === 'closed' ? (
                          <>
                            <div>أُقفل: {fmtDateTime(r.close.closed_at)}</div>
                            {r.close.closed_note && (
                              <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text2)' }}>
                                «{r.close.closed_note}»
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            <div>فُتح: {fmtDateTime(r.close.reopened_at)}</div>
                            {r.close.reopened_note && (
                              <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text2)' }}>
                                «{r.close.reopened_note}»
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    ) : (
                      <span style={{ color: 'var(--muted2)', fontSize: 11 }}>—</span>
                    )}
                  </td>
                  <td data-label="إجراء" style={tdStyle}>
                    {!canClosePeriod ? (
                      <span style={{ fontSize: 11, color: 'var(--muted2)', fontFamily: 'var(--font-mono)' }}>
                        🔒 صلاحية إغلاق الفترات للمدير فقط
                      </span>
                    ) : r.status === 'closed' ? (
                      <Btn size="sm" variant="ghost" icon={<Unlock size={12}/>} onClick={() => setActionTarget({ period: r.period, kind: 'reopen' })}>
                        افتح
                      </Btn>
                    ) : (
                      <Btn size="sm" variant="primary" icon={<Lock size={12}/>} onClick={() => setActionTarget({ period: r.period, kind: 'close' })}>
                        أقفل
                      </Btn>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {actionTarget && (
        <ActionDialog
          target={actionTarget}
          row={rows.find(r => r.period === actionTarget.period)}
          onCancel={() => setActionTarget(null)}
          onConfirm={(note) => handleAction(actionTarget.period, actionTarget.kind, note)}
        />
      )}
    </div>
  );
}

// ── subcomponents ──────────────────────────────────────────────
const thStyle = {
  padding: '12px 14px', textAlign: 'right',
  fontSize: 11, fontWeight: 600, color: 'var(--muted)',
  whiteSpace: 'nowrap', letterSpacing: .3,
};
const tdStyle = {
  padding: '14px', verticalAlign: 'top', fontSize: 12.5,
};
const countCell = (n) => ({
  ...tdStyle, textAlign: 'center',
  fontFamily: 'var(--font-mono)', fontWeight: 600,
  color: n > 0 ? 'var(--text)' : 'var(--muted2)',
});
const statusPill = (color) => ({
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '3px 9px', borderRadius: 999,
  background: `color-mix(in srgb, ${color} 14%, transparent)`,
  color, fontSize: 11, fontWeight: 700,
});

function ActionDialog({ target, row, onCancel, onConfirm }) {
  const [note, setNote] = useState('');
  const isClose = target.kind === 'close';
  return (
    <Modal title={isClose ? `إقفال ${fmtMonth(target.period)}` : `فتح ${fmtMonth(target.period)}`} onClose={onCancel} width={520}>
      <form
        autoComplete="off"
        onSubmit={(e) => { e.preventDefault(); onConfirm(note); }}
        style={{ padding: '4px 4px 0' }}
      >
        {/* What's about to change */}
        {isClose && row && (
          <div style={{
            padding: 12, marginBottom: 14, borderRadius: 10,
            background: 'color-mix(in srgb, var(--gold) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--gold) 24%, transparent)',
            fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.6,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <AlertTriangle size={14} color="var(--gold)"/>
              <strong style={{ color: 'var(--text)' }}>سيُقفل عليه ما يلي:</strong>
            </div>
            <ul style={{ margin: 0, paddingInlineStart: 18 }}>
              <li>{row.counts.ops_count.toLocaleString('en-US')} حركة محاسبية</li>
              <li>{row.counts.cod_count.toLocaleString('en-US')} صف تسوية COD</li>
              <li>{row.counts.audits_count.toLocaleString('en-US')} مراجعة</li>
              <li>{row.counts.payments_count.toLocaleString('en-US')} دفعة</li>
            </ul>
            <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--muted)' }}>
              بعد الإقفال لن يتمكّن أحد من التعديل عليها — حتى أنت — إلا بعد فتح الفترة مجدداً.
            </div>
          </div>
        )}
        {!isClose && (
          <div style={{
            padding: 12, marginBottom: 14, borderRadius: 10,
            background: 'color-mix(in srgb, var(--accent3) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--accent3) 24%, transparent)',
            fontSize: 12.5, color: 'var(--text2)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Info size={14} color="var(--accent3)"/>
              <strong style={{ color: 'var(--text)' }}>سبب الفتح يُحفظ في السجل</strong>
            </div>
            اكتب سبباً موجزاً يبقى في الـ activity_log كي يستطيع المراجع الخارجي تتبّع لماذا أُعيد فتح الشهر.
          </div>
        )}

        <label style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
            ملاحظة {isClose ? '(اختيارية)' : '(مطلوبة)'}
          </span>
          <textarea
            name="period_note"
            autoComplete="off"
            spellCheck={false}
            data-form-type="other"
            data-lpignore="true"
            data-1p-ignore="true"
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={isClose
              ? 'مثال: إقفال شهري بعد مطابقة الكشف البنكي'
              : 'مثال: تصحيح فاتورة معتمدة بقيمة خاطئة، صادرة من X'}
            rows={3}
            style={{
              width: '100%', padding: '10px 12px', fontSize: 13,
              border: '1px solid var(--border)', borderRadius: 8,
              background: 'var(--surface)', color: 'var(--text)',
              fontFamily: 'var(--font-sans)', boxSizing: 'border-box',
              resize: 'vertical',
            }}
          />
        </label>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-start' }}>
          <Btn size="md" variant="primary"
               icon={isClose ? <Lock size={13}/> : <Unlock size={13}/>}
               onClick={() => onConfirm(note)}
               disabled={!isClose && !note.trim()}>
            {isClose ? 'تأكيد الإقفال' : 'تأكيد الفتح'}
          </Btn>
          <Btn size="md" variant="ghost" onClick={onCancel}>إلغاء</Btn>
        </div>
      </form>
    </Modal>
  );
}

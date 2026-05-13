import { useState, useEffect, useMemo, useCallback } from 'react';
import { Upload, RefreshCw, Search, AlertCircle, CheckCircle2, XCircle, MessageSquare, Trash2, Download, ChevronDown, ChevronLeft } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Card, Btn, Input, Select, Modal, Empty, Spinner, toast } from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  loadReconciliation, summarizeReconciliation, ageOutstanding, ageOverRemit,
  saveSettlementUpload, setReconciliationAction, clearReconciliationAction,
  loadSettlementUploads, deleteSettlementUpload,
} from '../lib/codSettlementService.js';
import { INTERNAL_PARSER, REMITTANCE_PARSERS, listSupportedCarriers } from '../engine/codParsers/index.js';

// ─── Status meta ──────────────────────────────────────────────────────────
// over_remit splits visually: recent (≤ 30d, blue) is just sequencing —
// the matching outgoing settlement hasn't been uploaded yet, totally
// normal. Aged (> 30d, red) is a real anomaly worth investigating.
const STATUS_META = {
  matched:          { label: '✓ مسوّاة',                 color: 'var(--green)' },
  approved:         { label: '✓ مُعتمَدة',               color: 'var(--green)' },
  resolved:         { label: '✓ تم الحل',                color: 'var(--green)' },
  outstanding:      { label: '🔴 متبقّي',                color: 'var(--red)'   },
  pending_review:   { label: '🟡 فرق غير مراجَع',         color: 'var(--gold)'  },
  disputed:         { label: '⚠️ اعتراض مفتوح',           color: '#f59e0b'      },
  over_remit:       { label: '🔵 وارد · بانتظار المطابقة', color: '#3b82f6'      },
  over_remit_aged:  { label: '🔴 وارد قديم بدون مقابل',   color: 'var(--red)'   },
};

function statusKey(r) {
  return (r.status === 'over_remit' && r.isOverRemitAged) ? 'over_remit_aged' : r.status;
}

const fmt = n => (n == null || Number.isNaN(n))
  ? '—'
  : Number(n).toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function CodSettlements({ isActive = true }) {
  const { user } = useAuth();
  const carriers = listSupportedCarriers();
  const [carrier, setCarrier] = useState(carriers[0]?.id || 'aramex');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('outstanding'); // outstanding|pending|disputed|matched|all
  const [search, setSearch] = useState('');
  const [actionModal, setActionModal] = useState(null);  // { row, kind:'approve'|'dispute'|'edit'|'resolve' }
  const [uploadModal, setUploadModal] = useState(null);  // { direction:'out'|'in' }
  const [uploads, setUploads] = useState([]);
  const [uploadsOpen, setUploadsOpen] = useState(false);
  const [confirmDeleteUpload, setConfirmDeleteUpload] = useState(null);

  const refresh = useCallback(async () => {
    if (!carrier) return;
    setLoading(true);
    try {
      const [data, uploadsList] = await Promise.all([
        loadReconciliation(carrier),
        loadSettlementUploads({ carrierId: carrier }),
      ]);
      setRows(data);
      setUploads(uploadsList);
    } catch (e) {
      toast(`فشل التحميل: ${e.message}`, 'error');
    }
    setLoading(false);
  }, [carrier]);

  const handleDeleteUpload = async (uploadId) => {
    try {
      await deleteSettlementUpload(uploadId);
      toast('تم حذف التسوية', 'info');
      setConfirmDeleteUpload(null);
      refresh();
    } catch (e) {
      toast(`فشل: ${e.message}`, 'error');
    }
  };

  // Export the outstanding (متبقّي) list as Excel — what the carrier still
  // owes us, ready to send back to them as a follow-up list.
  const handleExportOutstanding = () => {
    const outstanding = rows.filter(r => r.status === 'outstanding');
    if (!outstanding.length) {
      toast('لا توجد شحنات متبقّية للتصدير', 'info');
      return;
    }
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const wb = XLSX.utils.book_new();
    const headers = ['رقم الشحنة (AWB)', 'المبلغ (ر.س)', 'تاريخ التسوية مع المتجر', 'الأيام منذ التسوية'];
    const data = outstanding
      .sort((a, b) => (a.firstOutDate || '').localeCompare(b.firstOutDate || ''))
      .map(r => {
        const days = r.firstOutDate
          ? Math.floor((today - new Date(r.firstOutDate)) / 86_400_000)
          : '—';
        return [r.awb, +r.diff.toFixed(2), r.firstOutDate || '—', days];
      });
    const totalRow = ['الإجمالي', outstanding.reduce((s, r) => s + r.diff, 0).toFixed(2), '', ''];
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data, [], totalRow]);
    ws['!cols'] = [{ wch: 24 }, { wch: 16 }, { wch: 22 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws, 'متبقّي عند الناقل');
    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `متبقي_عند_الناقل_${carrier}_${dateStr}.xlsx`);
    toast(`تم تصدير ${outstanding.length} شحنة`, 'success');
  };

  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh]);

  const summary    = useMemo(() => summarizeReconciliation(rows), [rows]);
  const aging      = useMemo(() => ageOutstanding(rows), [rows]);
  const agingOver  = useMemo(() => ageOverRemit(rows), [rows]);

  const counts = useMemo(() => {
    const c = {
      all: rows.length, outstanding: 0, pending: 0,
      disputed: 0, matched: 0, overRemit: 0,
    };
    for (const r of rows) {
      if (r.status === 'outstanding')    c.outstanding++;
      else if (r.status === 'pending_review') c.pending++;
      else if (r.status === 'disputed')  c.disputed++;
      else if (r.status === 'over_remit') c.overRemit++;
      else c.matched++;
    }
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    let pool = rows;
    if (tab === 'outstanding')   pool = pool.filter(r => r.status === 'outstanding');
    else if (tab === 'pending')  pool = pool.filter(r => r.status === 'pending_review');
    else if (tab === 'disputed') pool = pool.filter(r => r.status === 'disputed');
    else if (tab === 'matched')  pool = pool.filter(r => ['matched','approved','resolved'].includes(r.status));
    else if (tab === 'over')     pool = pool.filter(r => r.status === 'over_remit');
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      pool = pool.filter(r => r.awb.toLowerCase().includes(q));
    }
    // Outstanding first by oldest, then disputed by oldest, others alphabetical
    return [...pool].sort((a, b) => {
      const o = (r) => r.firstOutDate || '';
      return (o(a) || '').localeCompare(o(b) || '');
    });
  }, [rows, tab, search]);

  const openAction = (row, kind) => setActionModal({ row, kind });

  const submitAction = async ({ status, notes }) => {
    try {
      await setReconciliationAction({
        carrierId: carrier, awb: actionModal.row.awb,
        status, notes, userId: user?.id,
      });
      toast('تم الحفظ', 'success');
      setActionModal(null);
      refresh();
    } catch (e) {
      toast(`فشل: ${e.message}`, 'error');
    }
  };

  const reopenAction = async (row) => {
    try {
      await clearReconciliationAction(carrier, row.awb);
      toast('تم إعادة الفتح', 'info');
      refresh();
    } catch (e) {
      toast(`فشل: ${e.message}`, 'error');
    }
  };

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1400 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <h2 style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', margin: 0 }}>
            💰 تسويات الدفع عند الاستلام
          </h2>
          <select value={carrier} onChange={e => setCarrier(e.target.value)}
            style={{
              padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              background: 'var(--card)', border: '1px solid var(--accent)',
              color: 'var(--text)', cursor: 'pointer', minWidth: 160,
            }}>
            {carriers.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Btn size="sm" variant="ghost" icon={<RefreshCw size={14}/>} onClick={refresh}>تحديث</Btn>
          {summary.outstandingCount > 0 && (
            <Btn size="sm" variant="ghost" icon={<Download size={14}/>}
              onClick={handleExportOutstanding}
              title="تصدير المتبقي عند الناقل كـExcel لإرساله لهم">
              📤 صدّر المتبقي
            </Btn>
          )}
          <Btn size="sm" variant="primary" icon={<Upload size={14}/>}
            onClick={() => setUploadModal({ direction: 'out' })}>
            📤 تسوية صادرة
          </Btn>
          <Btn size="sm" variant="success" icon={<Upload size={14}/>}
            onClick={() => setUploadModal({ direction: 'in' })}>
            📥 تسوية واردة
          </Btn>
        </div>
      </div>

      <p style={{ color: 'var(--muted)', fontSize: 12, margin: 0, marginBottom: 16 }}>
        التدفق: نظامكم يُصدر &laquo;تسوية صادرة&raquo; للمتاجر، الناقل يُحوّل &laquo;تسوية واردة&raquo; إليكم. الفرق = ما تبقى عند الناقل.
      </p>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner size={22}/></div>
      ) : rows.length === 0 ? (
        <Card style={{ padding: 44, textAlign: 'center' }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>💰</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>لا توجد تسويات بعد</div>
          <div style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.7, marginBottom: 22 }}>
            ارفع &laquo;تسوية صادرة&raquo; من نظامكم الداخلي، ثم &laquo;تسوية واردة&raquo; من {carriers.find(c => c.id === carrier)?.label || 'الناقل'}.
            النظام يُطابق رقم الشحنة (AWB) ويعرض الفرق.
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <Btn variant="primary" icon={<Upload size={14}/>} onClick={() => setUploadModal({ direction: 'out' })}>
              ارفع تسوية صادرة
            </Btn>
            <Btn variant="success" icon={<Upload size={14}/>} onClick={() => setUploadModal({ direction: 'in' })}>
              ارفع تسوية واردة
            </Btn>
          </div>
        </Card>
      ) : (
        <>
          {/* Headline metrics */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
            <Hero label="المتبقي عند الناقل" value={fmt(summary.outstandingAmount)}
              suffix="ر.س" hint={`${summary.outstandingCount} شحنة لم تُحوَّل`} color="var(--red)" big/>
            <Hero label="فروق تنتظر مراجعة" value={summary.pendingReviewCount}
              hint={`${fmt(summary.pendingReviewAmount)} ر.س قيمة الفروق`} color="var(--gold)"/>
            <Hero label="اعتراضات مفتوحة" value={summary.disputedCount}
              hint={summary.disputedCount > 0 ? `أقدم اعتراض: ${summary.oldestDisputeDays} يوم` : 'لا اعتراضات'}
              color="#f59e0b"/>
            {summary.overRemitAgedCount > 0
              ? <Hero label="🚨 وارد قديم بدون مقابل" value={summary.overRemitAgedCount}
                  hint={`${fmt(summary.overRemitAgedAmount)} ر.س · مضى +30 يوم`} color="var(--red)"/>
              : <Hero label="مسوّاة" value={summary.matchedCount}
                  hint={`${rows.length} شحنة بإجمالي`} color="var(--green)"/>
            }
          </div>

          {/* Aging of outstanding (we paid merchant, carrier hasn't paid us yet) */}
          {summary.outstandingCount > 0 && (
            <Card style={{ padding: 14, marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--accent)', fontFamily: 'var(--font-mono)', marginBottom: 10 }}>
                📅 أعمار المتبقي (من تاريخ التسوية مع المتجر)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                <AgingCard label="0–14 يوم"   color="var(--green)" {...aging.d0_14}/>
                <AgingCard label="15–30 يوم"  color="var(--gold)"  {...aging.d15_30}/>
                <AgingCard label="31–60 يوم"  color="#f59e0b"      {...aging.d31_60}/>
                <AgingCard label="+60 يوم"    color="var(--red)"   {...aging.d61}/>
              </div>
            </Card>
          )}

          {/* Aging of over_remit (carrier paid us, no matching outgoing yet) */}
          {summary.overRemitCount > 0 && (
            <Card style={{ padding: 14, marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: '#3b82f6', fontFamily: 'var(--font-mono)', marginBottom: 10 }}>
                📥 أعمار الوارد بدون مقابل (من تاريخ تحويل الناقل)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                <AgingCard label="0–30 يوم · طبيعي"   color="#3b82f6"   {...agingOver.d0_30}/>
                <AgingCard label="31–60 يوم · انتبه"  color="#f59e0b"   {...agingOver.d31_60}/>
                <AgingCard label="+60 يوم · حقّق"    color="var(--red)" {...agingOver.d61}/>
              </div>
            </Card>
          )}

          {/* Uploads history — one row per file, with per-file totals so
              the user can see exactly which incoming file contributed
              which amount. Collapsible to keep the page compact. */}
          {uploads.length > 0 && (
            <Card style={{ padding: 0, marginBottom: 14, overflow: 'hidden' }}>
              <button onClick={() => setUploadsOpen(o => !o)}
                style={{
                  width: '100%', padding: '12px 16px',
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: 'var(--surface)', border: 'none',
                  borderBottom: uploadsOpen ? '1px solid var(--border)' : 'none',
                  cursor: 'pointer', color: 'inherit', fontFamily: 'inherit', textAlign: 'right',
                }}>
                {uploadsOpen ? <ChevronDown size={16} color="var(--accent)"/> : <ChevronLeft size={16} color="var(--muted)"/>}
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent)' }}>
                  📑 الملفات المرفوعة ({uploads.length})
                </span>
                <span style={{ marginRight: 'auto', fontSize: 11, color: 'var(--muted)' }}>
                  📥 {uploads.filter(u => u.direction === 'in').length} واردة ·
                  {' '}📤 {uploads.filter(u => u.direction === 'out').length} صادرة
                </span>
              </button>
              {uploadsOpen && (
                <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                  {uploads.map(u => (
                    <div key={u.uploadId} style={{
                      display: 'grid',
                      gridTemplateColumns: 'auto 1fr auto auto auto',
                      gap: 12, alignItems: 'center',
                      padding: '10px 16px', borderBottom: '1px solid var(--border)22',
                    }}>
                      <span style={{
                        padding: '2px 8px', borderRadius: 999,
                        fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)',
                        background: u.direction === 'in' ? 'rgba(34,197,94,.15)' : 'rgba(56,189,248,.15)',
                        color: u.direction === 'in' ? 'var(--green)' : 'var(--accent)',
                        whiteSpace: 'nowrap',
                      }}>
                        {u.direction === 'in' ? '📥 واردة' : '📤 صادرة'}
                      </span>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>
                          {u.sourceFile || '(بدون اسم ملف)'}
                          {u.settlementRef && (
                            <span style={{ marginRight: 8, fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                              · رقم {u.settlementRef}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                          {u.uploadDate}
                        </div>
                      </div>
                      <div style={{ textAlign: 'center', minWidth: 70 }}>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700 }}>
                          {u.count}
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--muted)' }}>شحنة</div>
                      </div>
                      <div style={{ textAlign: 'left', minWidth: 110 }}>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: u.direction === 'in' ? 'var(--green)' : 'var(--text)' }}>
                          {fmt(u.amount)}
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--muted)' }}>ر.س</div>
                      </div>
                      <Btn size="sm" variant="ghost" onClick={() => setConfirmDeleteUpload(u)} title="حذف الملف">
                        <Trash2 size={12}/>
                      </Btn>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* Tabs */}
          <Card style={{ padding: 0, marginBottom: 14, overflow: 'hidden' }}>
            <div style={{ display: 'flex', gap: 0, padding: 6, background: 'var(--surface)', flexWrap: 'wrap' }}>
              <Tab id="outstanding" label="🔴 متبقّي"        n={counts.outstanding} active={tab} onClick={setTab}/>
              <Tab id="pending"     label="🟡 فروق"          n={counts.pending}     active={tab} onClick={setTab}/>
              <Tab id="disputed"    label="⚠️ اعتراضات"      n={counts.disputed}    active={tab} onClick={setTab}/>
              <Tab id="over"        label="🔵 وارد بانتظار"   n={counts.overRemit}   active={tab} onClick={setTab}/>
              <Tab id="matched"     label="✓ مسوّاة"         n={counts.matched}     active={tab} onClick={setTab}/>
              <Tab id="all"         label="الكل"             n={counts.all}         active={tab} onClick={setTab}/>
            </div>
            <div style={{ padding: 10, borderTop: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}>
              <Search size={14} color="var(--muted)"/>
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="بحث برقم الشحنة (AWB)..."
                style={{ flex: 1, padding: '7px 10px', borderRadius: 7, fontSize: 12, fontFamily: 'var(--font-mono)' }}/>
            </div>
          </Card>

          {/* Helpful explainer when looking at the over_remit tab — most of
              the time these aren't anomalies, they're just sequencing. */}
          {tab === 'over' && counts.overRemit > 0 && (
            <div style={{
              marginBottom: 12, padding: '10px 14px',
              background: 'rgba(59,130,246,.08)',
              border: '1px solid rgba(59,130,246,.35)',
              borderRadius: 11, fontSize: 12, lineHeight: 1.7, color: 'var(--text)',
            }}>
              💡 هذي شحنات استلمت تحويلها من الناقل ولم يطابقها أي AWB في تسوياتك الصادرة بعد.
              غالباً تسلسل رفع طبيعي — ارفع التسوية الصادرة من نظامكم وستتم المطابقة تلقائياً.
              {summary.overRemitAgedCount > 0 && (
                <div style={{ marginTop: 6, color: 'var(--red)', fontWeight: 600 }}>
                  ⚠️ منها {summary.overRemitAgedCount} شحنة بمبلغ {summary.overRemitAgedAmount.toFixed(2)} ر.س
                  مضى عليها +{30} يوم بدون مقابل — تحتاج تحقيق.
                </div>
              )}
            </div>
          )}

          {/* Table */}
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ maxHeight: 600, overflowY: 'auto' }}>
              {filtered.length === 0
                ? <Empty icon="✓" title="لا شيء في هذي الحالة" sub="غيّر التبويب أعلاه"/>
                : (
                  <table style={{ fontSize: 12, width: '100%' }}>
                    <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
                      <tr>
                        <th style={{ minWidth: 130 }}>AWB</th>
                        <th style={{ minWidth: 110 }}>دفعنا للمتجر</th>
                        <th style={{ minWidth: 110 }}>استلمنا من الناقل</th>
                        <th style={{ minWidth: 100 }}>الفرق</th>
                        <th style={{ minWidth: 110 }}>تاريخ الصادرة</th>
                        <th style={{ minWidth: 130 }}>الحالة</th>
                        <th style={{ minWidth: 240 }}>إجراء / ملاحظات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(r => <Row key={r.awb} r={r} onAction={openAction} onReopen={reopenAction}/>)}
                    </tbody>
                  </table>
                )
              }
            </div>
          </Card>
        </>
      )}

      {actionModal && (
        <ActionModal
          row={actionModal.row}
          kind={actionModal.kind}
          onClose={() => setActionModal(null)}
          onSubmit={submitAction}
        />
      )}

      {uploadModal && (
        <UploadModal
          direction={uploadModal.direction}
          carrier={carrier}
          onClose={() => setUploadModal(null)}
          onDone={() => { setUploadModal(null); refresh(); }}
          userId={user?.id}
        />
      )}

      {confirmDeleteUpload && (
        <Modal title="⚠️ حذف الملف" onClose={() => setConfirmDeleteUpload(null)} width={420}>
          <div style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 14 }}>
            سيتم حذف الملف <strong>{confirmDeleteUpload.sourceFile || `#${confirmDeleteUpload.uploadId.slice(0, 16)}`}</strong>
            {' '}({confirmDeleteUpload.count} صف، {fmt(confirmDeleteUpload.amount)} ر.س).
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 16 }}>
            هذا الإجراء يحذف فقط هذي الدفعة من السجل — أي مطابقات أُعتمدت أو نزاعات أُغلقت بناءً عليها قد تعود للحالة "غير مراجعة".
          </div>
          <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end' }}>
            <Btn variant="ghost" onClick={() => setConfirmDeleteUpload(null)}>إلغاء</Btn>
            <Btn variant="danger" onClick={() => handleDeleteUpload(confirmDeleteUpload.uploadId)}>تأكيد الحذف</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Row ────────────────────────────────────────────────────────────────
function Row({ r, onAction, onReopen }) {
  const meta = STATUS_META[statusKey(r)] ?? STATUS_META.matched;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const daysOpen = r.actionDate
    ? Math.floor((today - new Date(r.actionDate)) / 86400000)
    : 0;
  return (
    <tr>
      <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontSize: 11 }}>{r.awb}</td>
      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
        {r.hasOut ? Number(r.paid).toFixed(2) : <span style={{ color: 'var(--muted)' }}>—</span>}
      </td>
      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
        {r.hasIn ? Number(r.received).toFixed(2) : <span style={{ color: 'var(--muted)' }}>—</span>}
      </td>
      <td style={{
        fontFamily: 'var(--font-mono)', fontWeight: 700,
        color: Math.abs(r.diff) < 0.01 ? 'var(--green)' : (r.diff > 0 ? 'var(--red)' : 'var(--accent)'),
      }}>
        {r.diff > 0 ? '+' : ''}{Number(r.diff).toFixed(2)}
      </td>
      <td style={{ fontSize: 11, color: 'var(--muted)' }}>{r.firstOutDate || '—'}</td>
      <td>
        <span style={{
          background: `${meta.color}20`, border: `1px solid ${meta.color}40`,
          color: meta.color, fontSize: 10, fontWeight: 700,
          padding: '2px 8px', borderRadius: 12, fontFamily: 'var(--font-mono)',
          whiteSpace: 'nowrap',
        }}>{meta.label}</span>
        {r.status === 'disputed' && daysOpen > 0 && (
          <div style={{ marginTop: 3, fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
            مفتوح منذ {daysOpen} يوم
          </div>
        )}
      </td>
      <td>
        {/* Mismatched diffs awaiting decision */}
        {r.status === 'pending_review' && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <Btn size="sm" variant="success" onClick={() => onAction(r, 'approve')}>✓ اعتماد</Btn>
            <Btn size="sm" variant="ghost"  onClick={() => onAction(r, 'dispute')}>⚠️ اعتراض</Btn>
          </div>
        )}
        {/* Active dispute — show note + resolve/edit */}
        {r.status === 'disputed' && (
          <>
            {r.notes && (
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4, lineHeight: 1.5 }}>
                💬 {r.notes}
              </div>
            )}
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              <Btn size="sm" variant="success" onClick={() => onAction(r, 'resolve')}>✓ تم الحل</Btn>
              <Btn size="sm" variant="ghost"  onClick={() => onAction(r, 'edit')}>✏️ تحديث</Btn>
            </div>
          </>
        )}
        {/* Approved/Resolved — show note + reopen */}
        {(r.status === 'approved' || r.status === 'resolved') && (
          <>
            {r.notes && (
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4, lineHeight: 1.5 }}>
                💬 {r.notes}
              </div>
            )}
            <Btn size="sm" variant="ghost" onClick={() => onReopen(r)}>↩ إعادة فتح</Btn>
          </>
        )}
        {r.status === 'outstanding' && (() => {
          const today = new Date(); today.setHours(0, 0, 0, 0);
          const days = r.firstOutDate
            ? Math.floor((today - new Date(r.firstOutDate)) / 86_400_000)
            : null;
          const ageColor = days == null ? 'var(--muted)'
            : days > 60 ? 'var(--red)' : days > 30 ? 'var(--gold)' : 'var(--muted)';
          return (
            <div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                بانتظار التحويل من الناقل
              </div>
              {days != null && (
                <div style={{ fontSize: 10, color: ageColor, marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                  ⏱ {days} يوم منذ التسوية
                </div>
              )}
            </div>
          );
        })()}
        {r.status === 'over_remit' && (
          <>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4, fontFamily: 'var(--font-mono)' }}>
              مرّ {r.daysReceived ?? 0} يوم على الاستلام بدون مقابل
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              <Btn size="sm" variant="success" onClick={() => onAction(r, 'approve')}>✓ اعتماد</Btn>
              <Btn size="sm" variant="ghost"  onClick={() => onAction(r, 'dispute')}>⚠️ اعتراض</Btn>
            </div>
          </>
        )}
        {r.status === 'matched' && (
          <span style={{ fontSize: 11, color: 'var(--green)' }}>—</span>
        )}
      </td>
    </tr>
  );
}

// ── ActionModal ────────────────────────────────────────────────────────
function ActionModal({ row, kind, onClose, onSubmit }) {
  const initialNotes = (kind === 'edit' || kind === 'resolve') ? (row.notes ?? '') : '';
  const [notes, setNotes] = useState(initialNotes);
  const titles = {
    approve: 'اعتماد الفرق', dispute: 'فتح اعتراض',
    resolve: 'إغلاق الاعتراض (تم الحل)', edit: 'تحديث ملاحظة الاعتراض',
  };
  const submit = () => {
    let status;
    if (kind === 'approve') status = 'approved';
    else if (kind === 'dispute' || kind === 'edit') status = 'disputed';
    else if (kind === 'resolve') status = 'resolved';
    if (kind !== 'approve' && !notes.trim()) {
      toast('لازم تكتب ملاحظة', 'error');
      return;
    }
    onSubmit({ status, notes: notes.trim() || null });
  };
  return (
    <Modal title={titles[kind] || 'إجراء'} onClose={onClose} width={460}>
      <div style={{ marginBottom: 14, fontSize: 13, color: 'var(--muted)' }}>
        AWB: <span style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>{row.awb}</span>
        {' · '}الفرق: <span style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
          {row.diff > 0 ? '+' : ''}{Number(row.diff).toFixed(2)} ر.س
        </span>
      </div>
      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder={kind === 'approve'
          ? 'سبب الاعتماد (اختياري)... مثلاً: فرق رسوم تحصيل، سبق مناقشته'
          : kind === 'resolve'
            ? 'وش حصل؟ (مطلوب)... مثلاً: أرامكس صحّحت وحوّلت 10 ر.س الناقصة بتاريخ ...'
            : 'تفاصيل الاعتراض (مطلوب)... مثلاً: تواصلت مع مدير حساب أرامكس بتاريخ ...'
        }
        rows={5}
        style={{
          width: '100%', padding: '9px 12px', borderRadius: 9, fontSize: 13,
          fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.7,
        }}
      />
      <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end', marginTop: 18 }}>
        <Btn variant="ghost" onClick={onClose}>إلغاء</Btn>
        <Btn variant={kind === 'approve' || kind === 'resolve' ? 'success' : 'primary'}
          onClick={submit}>تأكيد</Btn>
      </div>
    </Modal>
  );
}

// ── UploadModal ────────────────────────────────────────────────────────
function UploadModal({ direction, carrier, onClose, onDone, userId }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null); // { rows, parserId }
  const [uploadDate, setUploadDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [settlementRef, setSettlementRef] = useState('');
  const [busy, setBusy] = useState(false);

  const handleFile = async (f) => {
    if (!f) return;
    setFile(f);
    setBusy(true);
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

      const parser = direction === 'out'
        ? INTERNAL_PARSER
        : REMITTANCE_PARSERS[carrier];
      if (!parser) throw new Error(`لا يوجد parser للناقل ${carrier}`);

      const rows = parser.parse(allRows);
      if (!rows.length) throw new Error('لم تُستخرج أي صفوف صالحة من الملف');
      setPreview({ rows, parserId: parser.id, parserLabel: parser.label });
    } catch (e) {
      toast(e.message, 'error');
      setFile(null);
      setPreview(null);
    }
    setBusy(false);
  };

  const handleSave = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const { count } = await saveSettlementUpload({
        direction, carrierId: carrier, rows: preview.rows,
        uploadDate, sourceFile: file?.name,
        settlementRef: settlementRef.trim() || null,
        userId,
      });
      toast(`تم حفظ ${count} صف${settlementRef ? ` (تسوية #${settlementRef.trim()})` : ''}`, 'success');
      onDone();
    } catch (e) {
      toast(`فشل: ${e.message}`, 'error');
    }
    setBusy(false);
  };

  const total = preview?.rows.reduce((s, r) => s + r.amount, 0) ?? 0;
  const isIn = direction === 'in';

  return (
    <Modal
      title={isIn ? `📥 رفع تسوية واردة (من الناقل)` : `📤 رفع تسوية صادرة (من نظامكم)`}
      onClose={onClose} width={560}
    >
      {!preview && (
        <>
          <div style={{ marginBottom: 14, fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
            {isIn
              ? 'الملف من ' + (REMITTANCE_PARSERS[carrier]?.label || carrier) +
                ' — يجب أن يحتوي على عمودَي AWB و CollectedAmount.'
              : 'الملف من نظامكم الداخلي — يجب أن يحتوي على عمودَي "رقم الشحنة" و"إجمالي الاستحقاق".'
            }
          </div>
          <input
            type="file" accept=".xlsx,.xls"
            onChange={e => handleFile(e.target.files?.[0])}
            disabled={busy}
            style={{ width: '100%', padding: 8 }}
          />
          {busy && <div style={{ marginTop: 10, textAlign: 'center' }}><Spinner size={16}/></div>}
        </>
      )}
      {preview && (
        <>
          <div style={{
            padding: '10px 14px', marginBottom: 12,
            background: 'rgba(34,197,94,.08)',
            border: '1px solid rgba(34,197,94,.3)',
            borderRadius: 9, fontSize: 12,
          }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>
              ✓ تم تحليل الملف ({preview.parserLabel})
            </div>
            <div style={{ color: 'var(--muted)' }}>
              {preview.rows.length} صف ·{' '}
              <span style={{ color: 'var(--text)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                {fmt(total)} ر.س
              </span>
            </div>
          </div>
          <Input label="تاريخ التسوية" type="date" value={uploadDate}
            onChange={e => setUploadDate(e.target.value)}/>
          <div style={{ marginTop: 6, fontSize: 10, color: 'var(--muted)' }}>
            افتراضي = اليوم. عدّله إذا الملف يخصّ فترة سابقة.
          </div>
          <div style={{ marginTop: 12 }}>
            <Input label="رقم التسوية (اختياري)" value={settlementRef}
              onChange={e => setSettlementRef(e.target.value)}
              placeholder={direction === 'out' ? 'مثلاً: تسوية 18102026' : 'رقم الفاتورة/التحويل من الناقل'}/>
            <div style={{ marginTop: 6, fontSize: 10, color: 'var(--muted)' }}>
              يساعد على ربط التسوية بسجلاتك الداخلية أو فاتورة الناقل.
            </div>
          </div>
          <div style={{
            marginTop: 12, maxHeight: 200, overflowY: 'auto',
            border: '1px solid var(--border)', borderRadius: 9,
          }}>
            <table style={{ fontSize: 11, width: '100%' }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)' }}>
                <tr><th>AWB</th><th style={{ textAlign: 'left' }}>المبلغ</th></tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 50).map((r, i) => (
                  <tr key={i}>
                    <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{r.awb}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', textAlign: 'left' }}>{r.amount.toFixed(2)}</td>
                  </tr>
                ))}
                {preview.rows.length > 50 && (
                  <tr><td colSpan={2} style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 10 }}>
                    +{preview.rows.length - 50} صف إضافية…
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end', marginTop: 18 }}>
        <Btn variant="ghost" onClick={onClose}>إلغاء</Btn>
        {preview && (
          <Btn variant="success" onClick={handleSave} disabled={busy}>
            {busy ? <Spinner size={13}/> : `تأكيد حفظ ${preview.rows.length} صف`}
          </Btn>
        )}
      </div>
    </Modal>
  );
}

// ── Bits ───────────────────────────────────────────────────────────────
function Tab({ id, label, n, active, onClick }) {
  const isActive = active === id;
  return (
    <button onClick={() => onClick(id)}
      style={{
        flex: 1, minWidth: 110,
        padding: '8px 12px', borderRadius: 7, border: 'none',
        background: isActive ? 'var(--card)' : 'transparent',
        color: isActive ? 'var(--text)' : 'var(--muted)',
        fontWeight: isActive ? 700 : 500, fontSize: 12, cursor: 'pointer',
        boxShadow: isActive ? '0 1px 4px rgba(0,0,0,.3)' : 'none',
      }}>
      {label} {n != null && <span style={{ opacity: 0.7, fontFamily: 'var(--font-mono)', fontSize: 10 }}>({n})</span>}
    </button>
  );
}

function Hero({ label, value, suffix, hint, color, big }) {
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '14px 18px',
      borderTop: `3px solid ${color}`,
    }}>
      <div style={{ color: 'var(--muted)', fontSize: 11, fontFamily: 'var(--font-mono)', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{
        color, fontSize: big ? 24 : 22,
        fontFamily: 'var(--font-mono)', fontWeight: 700, whiteSpace: 'nowrap',
      }}>
        {value}
        {suffix && <span style={{ fontSize: 11, color: 'var(--muted)', marginRight: 5 }}> {suffix}</span>}
      </div>
      {hint && <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function AgingCard({ label, count, amount, color }) {
  const dim = !count;
  return (
    <div style={{
      background: dim ? 'var(--card)' : `linear-gradient(135deg, ${color}14, transparent)`,
      border: `1px solid ${dim ? 'var(--border)' : color + '55'}`,
      borderRadius: 11, padding: '10px 14px',
      borderTop: `3px solid ${color}`,
      opacity: dim ? 0.55 : 1,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ color: 'var(--muted)', fontSize: 10, fontFamily: 'var(--font-mono)' }}>{label}</span>
        <span style={{ color, fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{count}</span>
      </div>
      <div style={{ color, fontSize: 15, fontFamily: 'var(--font-mono)', fontWeight: 700, marginTop: 3, whiteSpace: 'nowrap' }}>
        {fmt(amount)}
        <span style={{ fontSize: 9, color: 'var(--muted)', marginRight: 4 }}> ر.س</span>
      </div>
    </div>
  );
}

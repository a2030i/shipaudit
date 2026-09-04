// Weight-billing workspace.
//
// Top: hero card with "X مراجعة جديدة" + a giant pull button.
// Middle: history of previous exports (download, mark billed, void).
// The pull button is the daily driver — one click and the merchant
// billing system gets a fresh Excel.

import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, Download, CheckCircle2, XCircle, Clock, FileSpreadsheet,
  AlertCircle, Sparkles, ChevronDown,
} from 'lucide-react';
import { Badge } from '../components/UI.jsx';
import { Button as Btn, DataTable, Dialog as Modal, EmptyState as Empty, PageHeader, Panel as Card, Spinner } from '../design-system/EnterpriseUI.jsx';
import { toast } from '../lib/toast.js';
import OperationsWorkspaceNav from '../components/enterprise/OperationsWorkspaceNav.jsx';
import { Scale } from 'lucide-react';
import {
  loadPendingAuditsForBilling, loadBlockedUnverifiedAuditsForBilling,
  loadBillingExports, loadAwaitingApproval,
  exportPendingExcessWeights, markExportBilled, voidExport, downloadExport,
} from '../lib/weightBillingService.js';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';

const fmtDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-US', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
};

const STATUS_META = {
  exported: { color: 'var(--gold)',   label: '⏳ بانتظار الفوترة', bg: 'rgba(251,191,36,.10)' },
  billed:   { color: 'var(--green)',  label: '✓ مفوتر',           bg: 'color-mix(in srgb, var(--accent) 10%, transparent)' },
  voided:   { color: 'var(--muted)',  label: '✗ ملغي',            bg: 'rgba(122,130,196,.10)' },
};

export default function WeightBilling({ carriers, isActive = true }) {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [pending,  setPending]  = useState([]);
  const [exports,  setExports]  = useState([]);
  const [awaiting, setAwaiting] = useState([]); // pending review (need approval)
  const [blocked, setBlocked] = useState([]); // historical approvals without v3 proof
  const [loading,  setLoading]  = useState(true);
  const [pulling,  setPulling]  = useState(false);
  const [voiding,  setVoiding]  = useState(null); // export row being voided
  const [voidReason, setVoidReason] = useState('');
  const [expanded, setExpanded] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [p, b, e, a] = await Promise.all([
        loadPendingAuditsForBilling(),
        loadBlockedUnverifiedAuditsForBilling(),
        loadBillingExports({ limit: 50 }),
        loadAwaitingApproval(),
      ]);
      setPending(p);
      setBlocked(b);
      setExports(e);
      setAwaiting(a);
    } catch (err) {
      toast(`فشل التحميل: ${err.message}`, 'error');
    }
    setLoading(false);
  }, []);

  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh]);

  const handlePull = async () => {
    if (pulling) return;
    setPulling(true);
    try {
      const result = await exportPendingExcessWeights({
        carriers,
        userId: profile?.id,
        trigger: 'manual',
      });
      if (result.ok) {
        toast(`تم تصدير ${result.count} شحنة من ${result.auditCount} مراجعة ✓`, 'success');
        refresh();
      } else if (result.reason === 'empty') {
        toast('لا توجد مراجعات جديدة بانتظار التصدير', 'info');
      } else if (result.reason === 'no_shipments') {
        toast('المراجعات المُعلّقة لا تحتوي على شحنات صالحة للفوترة', 'info');
      }
    } catch (err) {
      toast(`فشل التصدير: ${err.message}`, 'error');
    }
    setPulling(false);
  };

  const handleMarkBilled = async (exportRow) => {
    try {
      await markExportBilled(exportRow.id, profile?.id);
      toast('تم تعليم التصدير كـ "مفوتر"', 'success');
      refresh();
    } catch (err) {
      toast(`فشلت العملية: ${err.message}`, 'error');
    }
  };

  const handleVoidConfirm = async () => {
    if (!voiding) return;
    try {
      await voidExport(voiding.id, voidReason.trim() || null);
      toast('تم إلغاء التصدير وإرجاع المراجعات لقائمة الانتظار', 'success');
      setVoiding(null);
      setVoidReason('');
      refresh();
    } catch (err) {
      toast(`فشل الإلغاء: ${err.message}`, 'error');
    }
  };

  const handleDownload = async (exportRow) => {
    try {
      await downloadExport(exportRow);
      toast('جاري تنزيل الملف...', 'info');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  // Aggregate stats from pending audits
  const pendingStats = {
    audits: pending.length,
    rows:   pending.reduce((s, a) => s + (a.row_count || 0), 0),
    carriers: new Set(pending.map(a => a.carrier_id)).size,
  };

  return (
    <div style={{ padding: '24px 28px 80px', maxWidth: 1280, margin: '0 auto' }}>
      <PageHeader
        icon={<Scale size={22}/>}
        title="تصدير الأوزان الزائدة"
        subtitle="تصدير أوزان كل الشحنات في المراجعات المعتمدة بضغطة واحدة. الملف بعمودين (رقم + الوزن) ونظامك يحسب الفرق"
        meta={loading ? null : `${pendingStats.audits} مراجعة جديدة · ${pendingStats.rows.toLocaleString('en-US')} شحنة · ${pendingStats.carriers} شركة`}
        actions={
          <Btn
            size="md"
            variant="accent"
            icon={pulling ? <Spinner size={14}/> : <Sparkles size={14}/>}
            onClick={handlePull}
            disabled={pulling || pendingStats.audits === 0}
          >
            {pulling ? 'جاري التصدير…' : 'تصدير الأوزان الآن'}
          </Btn>
        }
      />
      <OperationsWorkspaceNav active="billing"/>

      {blocked.length > 0 && (
        <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 14, border: '1px solid rgba(239,68,68,.28)' }}>
          <div style={{
            padding: '14px 18px',
            background: 'linear-gradient(135deg, rgba(239,68,68,.10), rgba(239,68,68,.03))',
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          }}>
            <AlertCircle size={20} color="var(--red)" style={{ flexShrink: 0 }}/>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--text)' }}>
                {blocked.length} مراجعة قديمة مستبعدة من ملف الأوزان
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                ينقصها اسم ملف المصدر والعقد المستخدم في التدقيق. أعد رفع الملف من مسار المراجعة الآمن؛ لن تُفوَّتر أوزانها تلقائيًا.
              </div>
            </div>
            <Btn size="sm" variant="outline" onClick={() => navigate('/audits')}>
              عرض المراجعات المستبعدة
            </Btn>
          </div>
        </Card>
      )}

      {/* ── AWAITING APPROVAL CARD ───────────────────────────────────── */}
      {awaiting.length > 0 && (
        <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 14, border: '1px solid rgba(251,191,36,.32)' }}>
          <div style={{
            padding: '14px 18px',
            background: 'linear-gradient(135deg, rgba(251,191,36,.14), rgba(251,191,36,.04))',
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          }}>
            <AlertCircle size={20} color="var(--gold)" style={{ flexShrink: 0 }}/>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--text)' }}>
                {awaiting.length} مراجعة بانتظار الاعتماد
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                هذي المراجعات ما تظهر في "تصدير الأوزان" حتى تفتحها وتضغط <strong>اعتماد المراجعة</strong>.
                {awaiting.length > 0 && (
                  <> · شركات: {[...new Set(awaiting.map(a => a.carrier_name))].slice(0, 5).join(' · ')}</>
                )}
              </div>
            </div>
            <Btn size="sm" variant="accent" onClick={() => navigate('/audits')}>
              فتح السجل
            </Btn>
          </div>
        </Card>
      )}

      {/* ── PENDING LIST (collapsible) ───────────────────────────────── */}
      {pendingStats.audits > 0 && (
        <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 22 }}>
          <button
            onClick={() => setExpanded(e => e === 'pending' ? null : 'pending')}
            style={{
              width: '100%', padding: '14px 20px', background: 'transparent',
              border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              borderBottom: expanded === 'pending' ? '1px solid var(--border)' : 'none',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--gold)' }}>
              <Clock size={15}/> المراجعات المُعلّقة ({pendingStats.audits})
            </span>
            <ChevronDown size={14} style={{ transition: 'transform .2s', transform: expanded === 'pending' ? 'rotate(0)' : 'rotate(-90deg)', opacity: .65 }}/>
          </button>
          {expanded === 'pending' && (
            <div style={{ maxHeight: 320, overflowY: 'auto' }}>
              {pending.map(a => (
                <div key={a.id} style={{
                  padding: '10px 20px', borderBottom: '1px solid var(--border)',
                  display: 'grid', gridTemplateColumns: '1.4fr 1fr auto auto', gap: 12, alignItems: 'center',
                  fontSize: 12,
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {a.carrier_name} <span style={{ color: 'var(--muted)' }}>· {a.period}</span>
                    </div>
                    <div className="long-identifier" title={a.file_name} style={{ color: 'var(--muted)', fontSize: 11, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {a.file_name}
                    </div>
                  </div>
                  <div style={{ color: 'var(--muted)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                    {a.row_count?.toLocaleString('en-US')} شحنة
                  </div>
                  <div style={{ color: 'var(--muted)', fontSize: 11 }}>
                    {fmtDate(a.created_at)}
                  </div>
                  <Badge status="no_contract" label="بانتظار التصدير"/>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ── EXPORTS HISTORY ──────────────────────────────────────────── */}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{
          padding: '14px 20px', borderBottom: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--accent)' }}>
            <FileSpreadsheet size={15}/> سجل التصديرات ({exports.length})
          </span>
          <Btn size="sm" variant="ghost" icon={<RefreshCw size={13}/>} onClick={refresh} disabled={loading}>
            تحديث سجل التصدير
          </Btn>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><Spinner size={24}/></div>
        ) : exports.length === 0 ? (
          <Empty
            icon="📦"
            title="ما فيه تصديرات سابقة"
            sub="اضغط زر التصدير أعلاه لتوليد أول ملف فوترة"
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <DataTable className="m-cards weight-billing-history" caption="سجل ملفات فوترة الأوزان">
              <thead>
                <tr>
                  <th style={{ minWidth: 130 }}>التاريخ</th>
                  <th style={{ minWidth: 240 }}>اسم الملف</th>
                  <th style={{ minWidth: 80 }}>الشحنات</th>
                  <th style={{ minWidth: 80 }}>المراجعات</th>
                  <th style={{ minWidth: 100 }}>الحالة</th>
                  <th style={{ minWidth: 80 }}>المصدر</th>
                  <th style={{ minWidth: 200 }}>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {exports.map(e => {
                  const meta = STATUS_META[e.status] || STATUS_META.exported;
                  return (
                    <tr key={e.id}>
                      <td data-label="التاريخ" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>
                        {fmtDate(e.exported_at)}
                      </td>
                      <td data-label="اسم الملف" className="long-identifier" title={e.file_name} style={{ fontSize: 11.5, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260 }}>
                        {e.file_name}
                      </td>
                      <td data-label="الشحنات" style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontWeight: 700 }}>{e.row_count}</td>
                      <td data-label="المراجعات" style={{ fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>{e.audit_ids?.length ?? 0}</td>
                      <td data-label="الحالة">
                        <span style={{
                          padding: '3px 9px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                          background: meta.bg, color: meta.color, fontFamily: 'var(--font-mono)',
                          border: `1px solid ${meta.color}40`,
                        }}>
                          {meta.label}
                        </span>
                      </td>
                      <td data-label="المصدر" style={{ fontSize: 10.5, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                        {e.trigger === 'cron' ? '🤖 تلقائي' : '👤 يدوي'}
                      </td>
                      <td data-label="إجراءات">
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {e.file_path && (
                            <Btn size="sm" variant="ghost" icon={<Download size={12}/>} onClick={() => handleDownload(e)}>
                              تنزيل
                            </Btn>
                          )}
                          {e.status === 'exported' && (
                            <>
                              <Btn size="sm" variant="accent" icon={<CheckCircle2 size={12}/>} onClick={() => handleMarkBilled(e)}>
                                مفوتر
                              </Btn>
                              <Btn size="sm" variant="ghost" icon={<XCircle size={12}/>} onClick={() => { setVoiding(e); setVoidReason(''); }}>
                                إلغاء
                              </Btn>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
          </div>
        )}
      </Card>

      {/* ── Void confirm modal ──────────────────────────────────────── */}
      {voiding && (
        <Modal title="إلغاء التصدير" onClose={() => setVoiding(null)}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 10, padding: '12px 14px', background: 'rgba(248,113,113,.08)', border: '1px solid rgba(248,113,113,.25)', borderRadius: 10, marginBottom: 14 }}>
              <AlertCircle size={18} color="var(--red)" style={{ flexShrink: 0, marginTop: 2 }}/>
              <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>
                سيتم إرجاع <strong>{voiding.audit_ids?.length ?? 0}</strong> مراجعة لقائمة الانتظار، وراح تطلع مرة ثانية في زر التصدير. لا تستخدمها إلا لو الملف لم يُفوتر فعلياً.
              </div>
            </div>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginBottom: 6, fontFamily: 'var(--font-mono)' }}>
              السبب (اختياري)
            </label>
            <input
              type="text"
              value={voidReason}
              onChange={e => setVoidReason(e.target.value)}
              placeholder="مثال: تم تصديره بالخطأ"
              style={{ width: '100%', padding: '9px 12px', borderRadius: 8, fontSize: 13 }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Btn variant="ghost" onClick={() => setVoiding(null)}>إلغاء</Btn>
            <Btn variant="danger" onClick={handleVoidConfirm}>تأكيد الإلغاء</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

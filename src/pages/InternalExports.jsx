// "سحب للنظام الداخلي" — bulk-export workspace.
//
// Two cards side-by-side. Each one shows N pending rows + a giant
// pull button. Click → Excel downloads + the source rows get marked
// as "pulled" so the next click doesn't re-export them.
//
// Mirrors /weight-billing in spirit but consolidates the two new
// flows (COD receipts + customer invoicing) on one page.

import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, Download, FileSpreadsheet, Receipt, Banknote,
  CheckCircle2, Sparkles,
} from 'lucide-react';
import {
  Card, Btn, Spinner, Empty, toast, PageHeader,
} from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  loadPendingCodReceipts, pullCodReceipts,
  loadPendingInvoicingAudits, pullCustomerInvoicing,
  loadExportHistory, downloadExportFile,
} from '../lib/internalExportsService.js';
import {
  loadPendingAuditsForBilling, exportPendingExcessWeights,
} from '../lib/weightBillingService.js';
import { Scale, Layers } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

const fmt = (n) => (n == null || Number.isNaN(n)) ? '—'
  : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (iso) => {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
  } catch { return iso; }
};

export default function InternalExports({ carriers = [], isActive = true }) {
  const { profile, can } = useAuth();
  const canPull = can('internal_exports.pull');
  const location = useLocation();
  const navigate = useNavigate();

  // COD receipts state
  const [codPending, setCodPending] = useState([]);
  const [codLoading, setCodLoading] = useState(true);
  const [codPulling, setCodPulling] = useState(false);

  // Customer invoicing state
  const [invPending, setInvPending] = useState([]);
  const [invLoading, setInvLoading] = useState(true);
  const [invPulling, setInvPulling] = useState(false);
  const [selectedAuditIds, setSelectedAuditIds] = useState(new Set());

  // Excess weight billing state — pulled from the existing
  // weightBillingService so we share one source of truth on
  // "what's pending" between this page and /weight-billing.
  const [weightPending, setWeightPending] = useState([]);
  const [weightLoading, setWeightLoading] = useState(true);
  const [weightPulling, setWeightPulling] = useState(false);

  // Master "اسحب الكل" state
  const [pullingAll, setPullingAll] = useState(false);

  // Pull history — past exports saved to storage, re-downloadable.
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState(null);

  const refresh = useCallback(async () => {
    setCodLoading(true);
    setInvLoading(true);
    setWeightLoading(true);
    setHistoryLoading(true);
    try {
      const [cod, inv, weight, hist] = await Promise.all([
        loadPendingCodReceipts(),
        loadPendingInvoicingAudits(),
        loadPendingAuditsForBilling(),
        loadExportHistory().catch(() => []),
      ]);
      setCodPending(cod);
      setInvPending(inv);
      setWeightPending(weight);
      setHistory(hist);
    } catch (e) {
      toast(`فشل التحميل: ${e.message}`, 'error');
    }
    setCodLoading(false);
    setInvLoading(false);
    setWeightLoading(false);
    setHistoryLoading(false);
  }, []);

  const handleDownloadPast = async (rec) => {
    setDownloadingId(rec.id);
    try {
      await downloadExportFile({ bucket: rec.bucket, filePath: rec.filePath, fileName: rec.fileName });
    } catch (e) {
      toast(`تعذّر التحميل: ${e.message}`, 'error');
    }
    setDownloadingId(null);
  };

  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh, location.pathname]);

  // ── COD receipts pull ───────────────────────────────────────
  const handleCodPull = async () => {
    if (!codPending.length) {
      toast('لا توجد تحصيلات جديدة للسحب', 'info');
      return;
    }
    setCodPulling(true);
    try {
      const r = await pullCodReceipts({ userId: profile?.id || null });
      if (r.ok) {
        toast(`تم سحب ${r.count} شحنة من ${r.carriers} شركة ✓`, 'success');
        refresh();
      } else if (r.reason === 'empty') {
        toast('لا توجد تحصيلات جديدة', 'info');
      }
    } catch (e) {
      toast(`فشل السحب: ${e.message}`, 'error');
    }
    setCodPulling(false);
  };

  // ── Customer invoicing pull ─────────────────────────────────
  const toggleAudit = (id) => {
    setSelectedAuditIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAllAudits = () => {
    if (selectedAuditIds.size === invPending.length) {
      setSelectedAuditIds(new Set());
    } else {
      setSelectedAuditIds(new Set(invPending.map(a => a.id)));
    }
  };

  const handleInvoicingPull = async (mode = 'selected') => {
    if (!invPending.length) {
      toast('لا توجد مراجعات جديدة للسحب', 'info');
      return;
    }
    const auditIds = mode === 'all' ? null : [...selectedAuditIds];
    if (mode === 'selected' && !auditIds.length) {
      toast('حدد مراجعة واحدة على الأقل', 'warn');
      return;
    }
    setInvPulling(true);
    try {
      const r = await pullCustomerInvoicing({ userId: profile?.id || null, auditIds });
      if (r.ok) {
        toast(`تم سحب ${r.count} شحنة من ${r.auditCount} مراجعة ✓`, 'success');
        setSelectedAuditIds(new Set());
        refresh();
      } else if (r.reason === 'empty') {
        toast('لا توجد مراجعات جديدة', 'info');
      } else if (r.reason === 'no_shipments') {
        toast('المراجعات المحدّدة لا تحتوي على شحنات صالحة للفوترة', 'info');
      }
    } catch (e) {
      toast(`فشل السحب: ${e.message}`, 'error');
    }
    setInvPulling(false);
  };

  // ── Excess weight billing pull ──────────────────────────────
  const handleWeightPull = async () => {
    if (!weightPending.length) {
      toast('لا توجد مراجعات جديدة لفوترة الأوزان', 'info');
      return;
    }
    setWeightPulling(true);
    try {
      const r = await exportPendingExcessWeights({
        carriers, userId: profile?.id || null, trigger: 'internal-exports',
      });
      if (r.ok) {
        toast(`تم سحب ${r.count} شحنة من ${r.auditCount} مراجعة (أوزان) ✓`, 'success');
        refresh();
      } else if (r.reason === 'empty') {
        toast('لا توجد مراجعات جديدة', 'info');
      } else if (r.reason === 'no_shipments') {
        toast('المراجعات لا تحتوي على شحنات بأوزان زائدة', 'info');
      }
    } catch (e) {
      toast(`فشل السحب: ${e.message}`, 'error');
    }
    setWeightPulling(false);
  };

  // ── Master pull-everything button ───────────────────────────
  // Runs all three pulls in sequence (not parallel — so each file
  // gets a unique filename + the toasts don't stomp on each other).
  // If one pull fails the others still run; the operator sees a
  // per-pull toast for each result.
  const handlePullAll = async () => {
    const totalPending = codPending.length + invPending.length + weightPending.length;
    if (!totalPending) {
      toast('لا توجد بيانات جديدة في أي ملف', 'info');
      return;
    }
    setPullingAll(true);
    let pulled = 0;
    let failed = 0;
    try {
      if (codPending.length) {
        try {
          const r = await pullCodReceipts({ userId: profile?.id || null });
          if (r.ok) { pulled++; toast(`✓ تحصيلات COD: ${r.count} شحنة`, 'success'); }
        } catch (e) { failed++; toast(`فشل COD: ${e.message}`, 'error'); }
      }
      if (invPending.length) {
        try {
          const r = await pullCustomerInvoicing({ userId: profile?.id || null, auditIds: null });
          if (r.ok) { pulled++; toast(`✓ فواتير العملاء: ${r.count} شحنة من ${r.auditCount} مراجعة`, 'success'); }
        } catch (e) { failed++; toast(`فشل الفواتير: ${e.message}`, 'error'); }
      }
      if (weightPending.length) {
        try {
          const r = await exportPendingExcessWeights({
            carriers, userId: profile?.id || null, trigger: 'pull-all',
          });
          if (r.ok) { pulled++; toast(`✓ الأوزان الزائدة: ${r.count} شحنة من ${r.auditCount} مراجعة`, 'success'); }
        } catch (e) { failed++; toast(`فشل الأوزان: ${e.message}`, 'error'); }
      }
      if (pulled > 0) {
        toast(`اكتمل سحب ${pulled} ملف${failed ? ` · فشل ${failed}` : ''}`, pulled > failed ? 'success' : 'warn');
      }
      refresh();
    } finally {
      setPullingAll(false);
    }
  };

  const codTotal = codPending.reduce((s, r) => s + (r.amount || 0), 0);
  const codCarriers = new Set(codPending.map(r => r.carrierId).filter(Boolean)).size;
  const invShipments = invPending.reduce((s, a) => s + (a.row_count || 0), 0);
  const weightShipments = weightPending.reduce((s, a) => s + (a.row_count || 0), 0);

  const totalFiles    = (codPending.length > 0 ? 1 : 0)
                      + (invPending.length > 0 ? 1 : 0)
                      + (weightPending.length > 0 ? 1 : 0);
  const totalRows     = codPending.length
                      + invShipments
                      + weightShipments;
  const anyLoading    = codLoading || invLoading || weightLoading;

  return (
    <div style={{ padding: '32px 40px 80px', maxWidth: 1440 }}>
      <PageHeader
        icon={<FileSpreadsheet size={22}/>}
        title="سحب للنظام الداخلي"
        subtitle="ملفات Excel جاهزة لإدخالها في النظام المالي / نظام الفوترة الخارجي"
        actions={
          <Btn size="md" variant="ghost" icon={<RefreshCw size={14} className={anyLoading ? 'spin' : ''}/>} onClick={refresh} disabled={anyLoading}>
            تحديث
          </Btn>
        }
      />

      {/* Master pull-all card — the single button the operator clicks
          when they're catching up on the week. Visible only when
          there's actually something to pull. */}
      {!anyLoading && totalFiles > 0 && (
        <div className="pull-everything" style={{
          padding: '22px 26px', marginBottom: 22,
          background: 'linear-gradient(135deg, #0A0A0B 0%, #18181B 100%)',
          color: '#fff', borderRadius: 'var(--r-xl)',
          boxShadow: 'var(--shadow-lg)',
          display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 22, alignItems: 'center',
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16,
            background: 'rgba(16,185,129,.18)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#10B981', flexShrink: 0,
          }}><Layers size={26}/></div>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: 11, color: 'rgba(255,255,255,.55)',
              fontFamily: 'var(--font-mono)', letterSpacing: 1.5, textTransform: 'uppercase',
              fontWeight: 600, marginBottom: 4,
            }}>
              PULL EVERYTHING
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: -0.4, marginBottom: 6 }}>
              {totalFiles} ملف جاهز للسحب
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,.65)' }}>
              {[
                codPending.length    && `تحصيلات COD (${codPending.length})`,
                invPending.length    && `فواتير عملاء (${invShipments})`,
                weightPending.length && `أوزان زائدة (${weightShipments})`,
              ].filter(Boolean).join(' · ')}
            </div>
          </div>
          <button
            onClick={handlePullAll}
            disabled={pullingAll}
            style={{
              padding: '16px 28px', borderRadius: 14,
              background: pullingAll ? 'rgba(16,185,129,.5)' : '#10B981',
              color: '#fff', border: 'none',
              fontSize: 15, fontWeight: 700, cursor: pullingAll ? 'wait' : 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 10,
              fontFamily: 'inherit',
              boxShadow: '0 8px 24px rgba(16,185,129,.32)',
              whiteSpace: 'nowrap',
            }}
          >
            {pullingAll ? <Spinner size={18}/> : <Layers size={18}/>}
            {pullingAll ? `جارٍ السحب…` : `اسحب الكل (${totalRows.toLocaleString('en-US')} شحنة)`}
          </button>
        </div>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
        gap: 18, marginBottom: 24,
      }}>
        {/* ── COD receipts card ─────────────────────────────── */}
        <Card style={{ padding: '24px 28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: 'rgba(16,185,129,.10)', color: '#10B981',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}><Banknote size={20}/></div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)', letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: 600, marginBottom: 3 }}>
                COD RECEIPTS
              </div>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', margin: 0, letterSpacing: -0.3 }}>
                تحصيلات مُستلَمة جديدة
              </h3>
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0, marginTop: 4, lineHeight: 1.6 }}>
                شحنات وصلت من شركات الشحن وبعدها غير مطابقة — تظهر هنا حتى تُربط بمراجعة
              </p>
            </div>
          </div>

          {codLoading ? (
            <div style={{ padding: 32, textAlign: 'center' }}><Spinner size={24}/></div>
          ) : codPending.length === 0 ? (
            <div style={{
              padding: '32px 20px', textAlign: 'center', fontSize: 13.5, color: 'var(--muted)',
              background: 'rgba(16,185,129,.04)', borderRadius: 12, marginBottom: 14,
            }}>
              ✓ لا توجد تحصيلات بانتظار — كل الشحنات الواردة مطابقة لمراجعاتها
            </div>
          ) : (
            <>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16,
              }}>
                <BigStat label="شحنة جديدة" value={fmt(codPending.length).replace('.00', '')} color="#10B981"/>
                <BigStat label="إجمالي المبالغ" value={`${fmt(codTotal)} ر.س`} color="#10B981"/>
                <BigStat label="شركات الشحن" value={codCarriers} color="#10B981"/>
              </div>
              <Btn
                size="lg"
                variant="accent"
                icon={codPulling ? <Spinner size={16}/> : <Sparkles size={16}/>}
                onClick={handleCodPull}
                disabled={codPulling || !canPull}
                title={canPull ? '' : 'تحتاج صلاحية internal_exports.pull'}
                style={{ width: '100%', justifyContent: 'center' }}
              >
                {codPulling ? 'جارٍ السحب…' : (canPull ? 'اسحب التحصيلات الآن' : '🔒 لا تملك صلاحية السحب')}
              </Btn>
            </>
          )}

          <div style={{
            marginTop: 12, padding: '10px 12px',
            background: 'var(--bg2)', borderRadius: 10,
            fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.7,
          }}>
            <strong style={{ color: 'var(--text2)' }}>الأعمدة المسحوبة:</strong>{' '}
            رقم الشحنة · المبلغ · شركة الشحن · تاريخ التحصيل
          </div>
        </Card>

        {/* ── Customer invoicing card ───────────────────────── */}
        <Card style={{ padding: '24px 28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: 'rgba(139,92,246,.10)', color: '#8B5CF6',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}><Receipt size={20}/></div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)', letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: 600, marginBottom: 3 }}>
                CUSTOMER INVOICING
              </div>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', margin: 0, letterSpacing: -0.3 }}>
                فواتير العملاء
              </h3>
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0, marginTop: 4, lineHeight: 1.6 }}>
                مراجعات معتمدة جاهزة لفوترة العميل (شركة الشحن + رقم الشحنة)
              </p>
            </div>
          </div>

          {invLoading ? (
            <div style={{ padding: 32, textAlign: 'center' }}><Spinner size={24}/></div>
          ) : invPending.length === 0 ? (
            <div style={{
              padding: '32px 20px', textAlign: 'center', fontSize: 13.5, color: 'var(--muted)',
              background: 'rgba(139,92,246,.04)', borderRadius: 12, marginBottom: 14,
            }}>
              ✓ كل المراجعات المعتمدة مسحوبة — لا يوجد جديد
            </div>
          ) : (
            <>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 14,
              }}>
                <BigStat label="مراجعة جاهزة" value={invPending.length} color="#8B5CF6"/>
                <BigStat label="إجمالي شحنات" value={fmt(invShipments).replace('.00', '')} color="#8B5CF6"/>
              </div>

              {/* Audit selection list */}
              <div style={{
                marginBottom: 12, border: '1px solid var(--border)', borderRadius: 12,
                maxHeight: 240, overflowY: 'auto',
              }}>
                <div style={{
                  padding: '10px 14px', borderBottom: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: 'var(--surface2)',
                }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>
                    المراجعات المتاحة ({selectedAuditIds.size}/{invPending.length} محدّد)
                  </span>
                  <button onClick={toggleAllAudits} style={{
                    background: 'transparent', border: '1px solid var(--border2)', color: 'var(--text2)',
                    padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600,
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                    {selectedAuditIds.size === invPending.length ? 'إلغاء التحديد' : 'تحديد الكل'}
                  </button>
                </div>
                {invPending.map((a, i) => {
                  const checked = selectedAuditIds.has(a.id);
                  return (
                    <label key={a.id} style={{
                      display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 12,
                      padding: '11px 14px', alignItems: 'center', cursor: 'pointer',
                      borderBottom: i === invPending.length - 1 ? 'none' : '1px solid var(--border)',
                      background: checked ? 'rgba(139,92,246,.04)' : 'transparent',
                    }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAudit(a.id)}
                        style={{ width: 16, height: 16, accentColor: '#8B5CF6', cursor: 'pointer' }}
                      />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {a.carrier_name || a.carrier_id || '—'} · {a.period || a.file_name || '—'}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                          {a.row_count || 0} شحنة · {fmtDate(a.created_at)}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Btn
                  size="lg"
                  variant="primary"
                  onClick={() => handleInvoicingPull('selected')}
                  disabled={invPulling || !selectedAuditIds.size || !canPull}
                  title={canPull ? '' : 'تحتاج صلاحية internal_exports.pull'}
                  icon={invPulling ? <Spinner size={16}/> : <Download size={16}/>}
                  style={{ justifyContent: 'center' }}
                >
                  {canPull ? 'اسحب المحدّد' : '🔒 محظور'}
                </Btn>
                <Btn
                  size="lg"
                  variant="ghost"
                  onClick={() => handleInvoicingPull('all')}
                  disabled={invPulling}
                  icon={<Sparkles size={16}/>}
                  style={{ justifyContent: 'center' }}
                >
                  اسحب الكل
                </Btn>
              </div>
            </>
          )}

          <div style={{
            marginTop: 12, padding: '10px 12px',
            background: 'var(--bg2)', borderRadius: 10,
            fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.7,
          }}>
            <strong style={{ color: 'var(--text2)' }}>الأعمدة المسحوبة:</strong>{' '}
            شركة الشحن · رقم الشحنة (صف لكل شحنة)
          </div>
        </Card>

        {/* ── Weight billing card ──────────────────────────── */}
        <Card style={{ padding: '24px 28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: 'rgba(245,158,11,.10)', color: '#F59E0B',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}><Scale size={20}/></div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)', letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: 600, marginBottom: 3 }}>
                EXCESS WEIGHTS
              </div>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', margin: 0, letterSpacing: -0.3 }}>
                الأوزان الزائدة
              </h3>
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0, marginTop: 4, lineHeight: 1.6 }}>
                شحنات تجاوزت الوزن الأساسي — للنظام يفوتر العميل بالفرق
              </p>
            </div>
          </div>

          {weightLoading ? (
            <div style={{ padding: 32, textAlign: 'center' }}><Spinner size={24}/></div>
          ) : weightPending.length === 0 ? (
            <div style={{
              padding: '32px 20px', textAlign: 'center', fontSize: 13.5, color: 'var(--muted)',
              background: 'rgba(245,158,11,.04)', borderRadius: 12, marginBottom: 14,
            }}>
              ✓ كل المراجعات مسحوبة — لا يوجد أوزان جديدة
            </div>
          ) : (
            <>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 14,
              }}>
                <BigStat label="مراجعة جاهزة" value={weightPending.length} color="#F59E0B"/>
                <BigStat label="إجمالي شحنات" value={fmt(weightShipments).replace('.00', '')} color="#F59E0B"/>
              </div>
              <Btn
                size="lg"
                variant="gold"
                icon={weightPulling ? <Spinner size={16}/> : <Sparkles size={16}/>}
                onClick={handleWeightPull}
                disabled={weightPulling}
                style={{ width: '100%', justifyContent: 'center' }}
              >
                {weightPulling ? 'جارٍ السحب…' : 'اسحب الأوزان الآن'}
              </Btn>
            </>
          )}

          <div style={{
            marginTop: 12, padding: '10px 12px',
            background: 'var(--bg2)', borderRadius: 10,
            fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.7,
          }}>
            <strong style={{ color: 'var(--text2)' }}>الأعمدة المسحوبة:</strong>{' '}
            رقم الشحنة · الوزن (مدمج لكل الشركات){' '}
            <button onClick={() => navigate('/weight-billing')} style={{
              background: 'transparent', border: 'none', color: 'var(--accent)',
              cursor: 'pointer', fontSize: 11, padding: 0, textDecoration: 'underline',
              fontFamily: 'inherit',
            }}>
              السجل الكامل ↗
            </button>
          </div>
        </Card>
      </div>

      {/* Pull history — every export is saved to storage so it can be
          re-downloaded here later (no more "where did my file go"). */}
      <Card style={{ padding: '20px 24px', marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <Download size={18} style={{ color: 'var(--muted)' }}/>
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>السحبات السابقة</h3>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            (كل ملف محفوظ — اضغط لإعادة تحميله)
          </span>
        </div>
        {historyLoading ? (
          <div style={{ padding: 24, textAlign: 'center' }}><Spinner size={20}/></div>
        ) : history.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>
            لا توجد سحبات محفوظة بعد — أول ملف تسحبه سيظهر هنا قابلاً لإعادة التحميل.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ color: 'var(--muted)', textAlign: 'right', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '8px 10px', fontWeight: 600 }}>التاريخ</th>
                  <th style={{ padding: '8px 10px', fontWeight: 600 }}>النوع</th>
                  <th style={{ padding: '8px 10px', fontWeight: 600 }}>الملف</th>
                  <th style={{ padding: '8px 10px', fontWeight: 600 }}>الصفوف</th>
                  <th style={{ padding: '8px 10px', fontWeight: 600 }}></th>
                </tr>
              </thead>
              <tbody>
                {history.map(rec => {
                  const KIND_LABEL = { cod: '💰 تحصيلات', invoicing: '🧾 فواتير عملاء', weight: '⚖️ أوزان' };
                  return (
                    <tr key={rec.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '9px 10px', whiteSpace: 'nowrap' }}>{fmtDate(rec.pulledAt)}</td>
                      <td style={{ padding: '9px 10px', whiteSpace: 'nowrap' }}>{KIND_LABEL[rec.kind] || rec.kind}</td>
                      <td style={{ padding: '9px 10px', color: 'var(--muted)', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rec.fileName}</td>
                      <td style={{ padding: '9px 10px', fontFamily: 'var(--font-mono)' }}>{rec.rowCount ?? '—'}</td>
                      <td style={{ padding: '9px 10px', textAlign: 'left' }}>
                        <Btn size="sm" variant="ghost"
                          icon={downloadingId === rec.id ? <Spinner size={12}/> : <Download size={12}/>}
                          onClick={() => handleDownloadPast(rec)}
                          disabled={!rec.filePath || downloadingId === rec.id}
                          title={rec.filePath ? 'إعادة تحميل الملف' : 'سحبة قديمة غير محفوظة في التخزين'}>
                          تحميل
                        </Btn>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* How-it-works strip */}
      <div style={{
        padding: '14px 18px', background: 'var(--surface)',
        border: '1px solid var(--border)', borderRadius: 12,
        fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.8,
      }}>
        <strong style={{ color: 'var(--text2)' }}>كيف يعمل:</strong>{' '}
        <strong>تحصيلات COD</strong>: تظل تظهر كل مرة طالما حالتها "مُستلَم بانتظار" (وصلت من الناقل ولم تُطابق مراجعة بعد).
        فور إنشاء صف <code>out</code> مطابق على نفس AWB (عند اعتماد مراجعة لها) تختفي من تلقاء نفسها.
        &nbsp;
        <strong>فواتير العملاء + الأوزان</strong>: كل مراجعة تُسحب مرّة واحدة — يُحدَّث الـ <code>customer_invoicing_status</code>
        أو <code>weight_billing_status</code> وما تظهر مجدداً.
      </div>
    </div>
  );
}

function BigStat({ label, value, color }) {
  return (
    <div style={{
      padding: '12px 14px',
      background: `color-mix(in srgb, ${color} 6%, transparent)`,
      borderRadius: 12, textAlign: 'center',
    }}>
      <div style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 600, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{
        fontSize: 22, fontWeight: 700, color, fontFamily: 'var(--font-mono)',
        letterSpacing: -0.4, lineHeight: 1, whiteSpace: 'nowrap',
      }}>
        {value}
      </div>
    </div>
  );
}

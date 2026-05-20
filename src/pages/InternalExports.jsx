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
} from '../lib/internalExportsService.js';
import { useLocation } from 'react-router-dom';

const fmt = (n) => (n == null || Number.isNaN(n)) ? '—'
  : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (iso) => {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
  } catch { return iso; }
};

export default function InternalExports({ isActive = true }) {
  const { profile } = useAuth();
  const location = useLocation();

  // COD receipts state
  const [codPending, setCodPending] = useState([]);
  const [codLoading, setCodLoading] = useState(true);
  const [codPulling, setCodPulling] = useState(false);

  // Customer invoicing state
  const [invPending, setInvPending] = useState([]);
  const [invLoading, setInvLoading] = useState(true);
  const [invPulling, setInvPulling] = useState(false);
  const [selectedAuditIds, setSelectedAuditIds] = useState(new Set());

  const refresh = useCallback(async () => {
    setCodLoading(true);
    setInvLoading(true);
    try {
      const [cod, inv] = await Promise.all([
        loadPendingCodReceipts(),
        loadPendingInvoicingAudits(),
      ]);
      setCodPending(cod);
      setInvPending(inv);
    } catch (e) {
      toast(`فشل التحميل: ${e.message}`, 'error');
    }
    setCodLoading(false);
    setInvLoading(false);
  }, []);

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

  const codTotal = codPending.reduce((s, r) => s + (r.amount || 0), 0);
  const codCarriers = new Set(codPending.map(r => r.carrierId).filter(Boolean)).size;
  const invShipments = invPending.reduce((s, a) => s + (a.row_count || 0), 0);

  return (
    <div style={{ padding: '32px 40px 80px', maxWidth: 1440 }}>
      <PageHeader
        icon={<FileSpreadsheet size={22}/>}
        title="سحب للنظام الداخلي"
        subtitle="ملفات Excel جاهزة لإدخالها في النظام المالي / نظام الفوترة الخارجي — كل شحنة تُسحب مرّة واحدة فقط"
        actions={
          <Btn size="md" variant="ghost" icon={<RefreshCw size={14} className={(codLoading || invLoading) ? 'spin' : ''}/>} onClick={refresh} disabled={codLoading || invLoading}>
            تحديث
          </Btn>
        }
      />

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
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
                شحنات وصلت من شركات الشحن ولم تُسجَّل بعد في النظام المالي
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
              ✓ كل التحصيلات مسحوبة — لا توجد شحنات جديدة
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
                disabled={codPulling}
                style={{ width: '100%', justifyContent: 'center' }}
              >
                {codPulling ? 'جارٍ السحب…' : 'اسحب التحصيلات الآن'}
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
                  disabled={invPulling || !selectedAuditIds.size}
                  icon={invPulling ? <Spinner size={16}/> : <Download size={16}/>}
                  style={{ justifyContent: 'center' }}
                >
                  اسحب المحدّد
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
      </div>

      {/* How-it-works strip */}
      <div style={{
        padding: '14px 18px', background: 'var(--surface)',
        border: '1px solid var(--border)', borderRadius: 12,
        fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.8,
      }}>
        <strong style={{ color: 'var(--text2)' }}>كيف يعمل:</strong>{' '}
        كل شحنة تُسحب مرّة واحدة فقط — بعد السحب يُحدَّث الـ <code>pulled_at</code>
        على صف الـ COD أو الـ <code>customer_invoicing_status</code> على المراجعة، وما تظهر مرة ثانية.
        لو فيه مشكلة في الملف وتحتاج إعادة السحب،
        تواصل مع المسؤول التقني لإعادة تعيين الحالة على الصفوف المعنية.
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

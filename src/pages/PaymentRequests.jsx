// Admin / accountant view for incoming payment requests from /portal.
//
// Workflow: pending → contacted → paid (or cancelled). Each transition
// stamps handled_by + handled_at + handled_by_name on the row so we
// know who closed it.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import * as XLSX from 'xlsx';
import {
  RefreshCw, Phone, ShoppingBag, Receipt, CheckCircle2, XCircle,
  Clock, MessageSquare, Trash2, Filter, X, Download, Info,
} from 'lucide-react';
import {
  Card, Btn, Spinner, Empty, Modal, toast,
  PageHeader,
} from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  listPaymentRequests, updatePaymentRequest, deletePaymentRequest,
  STATUS_META, receiptUrl,
} from '../lib/paymentRequestsService.js';

const fmt = (n) => (n == null || Number.isNaN(n)) ? '—'
  : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (iso) => {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
  } catch { return iso; }
};
const daysAgo = (iso) => {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso)) / 86_400_000);
};
const fmtRelative = (iso) => {
  const d = daysAgo(iso);
  if (d == null) return '—';
  if (d === 0) return 'اليوم';
  if (d === 1) return 'أمس';
  return `قبل ${d} يوم`;
};

export default function PaymentRequests({ isActive = true }) {
  const location = useLocation();
  const { profile } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [openRow, setOpenRow] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listPaymentRequests({ status: statusFilter === 'all' ? null : statusFilter });
      setRows(data);
    } catch (e) {
      toast(`فشل التحميل: ${e.message}`, 'error');
    }
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh, location.pathname]);

  // Status pill counts (for tab badges) — quick aggregate from one
  // unfiltered load. Done on the page-load only, not per re-render.
  const [counts, setCounts] = useState({ pending: 0, contacted: 0, paid: 0, cancelled: 0 });
  useEffect(() => {
    if (!isActive) return;
    listPaymentRequests({ limit: 1000 }).then(all => {
      const c = { pending: 0, contacted: 0, paid: 0, cancelled: 0 };
      for (const r of all) c[r.status] = (c[r.status] || 0) + 1;
      setCounts(c);
    }).catch(() => {});
  }, [isActive, rows.length]);

  const total = useMemo(() => rows.reduce((s, r) => s + (Number(r.amount_total) || 0), 0), [rows]);

  // Excel export — exactly the 4 columns the accountant types into
  // the external system, plus phone for follow-up if needed. Targets
  // the CURRENT filter (so filtering by 'paid' before exporting gives
  // you a clean sadadat list).
  const handleExport = () => {
    if (!rows.length) { toast('لا توجد بيانات للتصدير', 'info'); return; }
    const headers = ['اسم المتجر', 'المبلغ (ر.س)', 'تاريخ السداد', 'طريقة الدفع', 'رقم الجوال', 'حالة الطلب'];
    const data = rows.map(r => [
      r.store_name || r.customer_name || '—',
      Number(r.amount_total || 0).toFixed(2),
      r.paid_at
        ? fmtDate(r.paid_at)
        : r.handled_at
          ? fmtDate(r.handled_at)
          : fmtDate(r.created_at),
      r.payment_type === 'bank_transfer'
        ? 'حوالة بنكية' + (r.receipt_path ? ' + إيصال' : '')
        : r.moyasar_payment_id
          ? `Moyasar · ${r.payment_method || 'card'}`
          : r.payment_type === 'online'
            ? 'أون لاين (لم يكتمل)'
            : 'تحويل / يدوي',
      r.phone || '',
      STATUS_META[r.status]?.label || r.status,
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws['!cols'] = [{ wch: 32 }, { wch: 14 }, { wch: 14 }, { wch: 22 }, { wch: 16 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    const sheetName = statusFilter === 'paid' ? 'السدادات' : 'طلبات السداد';
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `${sheetName}_${dateStr}.xlsx`);
    toast(`تم تصدير ${rows.length} سطر`, 'success');
  };

  return (
    <div style={{ padding: '32px 40px 80px', maxWidth: 1440 }}>
      <PageHeader
        icon={<Receipt size={22}/>}
        title="طلبات السداد"
        subtitle="طلبات واردة من بوابة العميل — قائمة بالفواتير اللي يبغى يسددها"
        meta={`إجمالي عرض حالي: ${fmt(total)} ر.س`}
        actions={
          <>
            <PortalLinkButton/>
            <Btn size="md" variant="ghost" icon={<Download size={14}/>} onClick={handleExport} disabled={!rows.length}>
              تصدير Excel
            </Btn>
            <Btn size="md" variant="ghost" icon={<RefreshCw size={14} className={loading ? 'spin' : ''}/>} onClick={refresh} disabled={loading}>
              تحديث
            </Btn>
          </>
        }
      />

      {/* Operational note — this page is informational only. The
          actual AR balance lives in the external accounting system;
          re-upload a new receivables snapshot to reflect cleared
          invoices in /receivables. */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 10,
        padding: '12px 14px', marginBottom: 18,
        background: 'rgba(59,130,246,.05)',
        border: '1px solid rgba(59,130,246,.18)',
        borderRadius: 12,
      }}>
        <Info size={16} color="#3B82F6" style={{ marginTop: 2, flexShrink: 0 }}/>
        <div style={{ fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.7 }}>
          <strong style={{ color: '#3B82F6' }}>هذي مجرد سجل — لا تؤثّر على الفواتير.</strong>{' '}
          المحاسب يرصد السداد في النظام المالي الخارجي، ثم يرفع كشف فواتير جديد في صفحة المديونيات
          عشان الأرصدة تتحدّث تلقائياً.
        </div>
      </div>

      {/* Status filter pills */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        {[
          { k: 'pending',   l: '⏳ في الانتظار', c: counts.pending },
          { k: 'contacted', l: '☎ تم التواصل',  c: counts.contacted },
          { k: 'paid',      l: '✓ تم السداد',   c: counts.paid },
          { k: 'cancelled', l: '✗ ملغية',       c: counts.cancelled },
          { k: 'all',       l: 'الكل',           c: counts.pending + counts.contacted + counts.paid + counts.cancelled },
        ].map(t => (
          <button key={t.k} onClick={() => setStatusFilter(t.k)} style={{
            background: statusFilter === t.k ? 'var(--text)' : 'var(--surface)',
            border: `1px solid ${statusFilter === t.k ? 'var(--text)' : 'var(--border2)'}`,
            color: statusFilter === t.k ? '#fff' : 'var(--text2)',
            borderRadius: 999, padding: '9px 16px', cursor: 'pointer',
            fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 600,
            display: 'inline-flex', alignItems: 'center', gap: 8,
          }}>
            {t.l}
            <span style={{
              background: statusFilter === t.k ? 'rgba(255,255,255,.18)' : 'var(--bg2)',
              color: statusFilter === t.k ? '#fff' : 'var(--text2)',
              fontSize: 11, padding: '2px 8px', borderRadius: 999, fontFamily: 'var(--font-mono)',
              fontWeight: 700,
            }}>{t.c}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Spinner size={28}/></div>
      ) : rows.length === 0 ? (
        <Card>
          <Empty
            icon="📬"
            title={statusFilter === 'pending' ? 'لا توجد طلبات معلّقة' : 'لا توجد طلبات في هذا التصنيف'}
            sub="طلبات العملاء عبر /portal راح تظهر هنا"
          />
        </Card>
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {rows.map((r, i) => {
            const meta = STATUS_META[r.status] || STATUS_META.pending;
            return (
              <div
                key={r.id}
                onClick={() => setOpenRow(r)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '40px minmax(0, 1fr) minmax(120px, auto) minmax(120px, auto) auto auto',
                  gap: 14, padding: '16px 20px', alignItems: 'center', cursor: 'pointer',
                  borderBottom: i === rows.length - 1 ? 'none' : '1px solid var(--border)',
                  transition: 'background .12s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: `color-mix(in srgb, ${meta.color} 14%, transparent)`,
                  color: meta.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}><Receipt size={16}/></div>

                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.store_name || r.customer_name || '—'}
                    </span>
                    {r.payment_type === 'bank_transfer' && (
                      <span title="حوالة بنكية" style={{
                        fontSize: 9.5, padding: '2px 7px', borderRadius: 999,
                        background: 'rgba(59,130,246,.14)', color: '#3B82F6',
                        fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
                      }}>🏦 حوالة</span>
                    )}
                    {r.payment_type === 'online' && (
                      <span title="دفع أون لاين" style={{
                        fontSize: 9.5, padding: '2px 7px', borderRadius: 999,
                        background: 'rgba(16,185,129,.14)', color: '#10B981',
                        fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
                      }}>💳 أون لاين</span>
                    )}
                    {r.is_partial && (
                      <span title="سداد جزئي" style={{
                        fontSize: 9.5, padding: '2px 7px', borderRadius: 999,
                        background: 'rgba(245,158,11,.14)', color: '#F59E0B',
                        fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
                      }}>جزئي</span>
                    )}
                    {r.receipt_path && (
                      <span title="فيه إيصال مرفق" style={{
                        fontSize: 9.5, padding: '2px 7px', borderRadius: 999,
                        background: 'rgba(139,92,246,.14)', color: '#8B5CF6',
                        fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
                      }}>📎 إيصال</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 12, fontSize: 11.5, color: 'var(--muted)', marginTop: 3, fontFamily: 'var(--font-mono)', flexWrap: 'wrap' }}>
                    <span style={{ direction: 'ltr' }}><Phone size={11} style={{ verticalAlign: 'middle', marginInlineEnd: 3 }}/>{r.phone}</span>
                    <span>{r.invoice_count} فاتورة</span>
                    <span style={{ fontFamily: 'var(--font-sans)' }}>{fmtRelative(r.created_at)}</span>
                  </div>
                </div>

                <div style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                  <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-mono)', letterSpacing: -0.3 }}>
                    {fmt(r.amount_total)}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>ر.س</div>
                </div>

                <span style={{
                  padding: '5px 12px', borderRadius: 999,
                  background: `color-mix(in srgb, ${meta.color} 14%, transparent)`,
                  color: meta.color, fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap',
                }}>
                  {meta.label}
                </span>

                {r.handled_by_name && (
                  <span style={{ fontSize: 10.5, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                    {r.handled_by_name}
                  </span>
                )}
              </div>
            );
          })}
        </Card>
      )}

      {openRow && (
        <PaymentRequestModal
          row={openRow}
          profile={profile}
          onClose={() => setOpenRow(null)}
          onChanged={() => { setOpenRow(null); refresh(); }}
        />
      )}
    </div>
  );
}

// ── Detail / workflow modal ─────────────────────────────────────
function PaymentRequestModal({ row, profile, onClose, onChanged }) {
  const [adminNotes, setAdminNotes] = useState(row.admin_notes || '');
  const [busy, setBusy] = useState(false);

  const handleStatus = async (status) => {
    setBusy(true);
    try {
      await updatePaymentRequest(row.id, {
        status,
        adminNotes: adminNotes.trim() || null,
        userId:   profile?.id || null,
        userName: profile?.name || null,
      });
      toast(`✓ تم تحديث الحالة إلى "${STATUS_META[status].label}"`, 'success');
      onChanged();
    } catch (e) {
      toast(`فشل: ${e.message}`, 'error');
    }
    setBusy(false);
  };

  const handleDelete = async () => {
    if (!confirm('حذف الطلب نهائياً؟')) return;
    setBusy(true);
    try {
      await deletePaymentRequest(row.id);
      toast('تم الحذف', 'success');
      onChanged();
    } catch (e) {
      toast(`فشل: ${e.message}`, 'error');
    }
    setBusy(false);
  };

  const meta = STATUS_META[row.status] || STATUS_META.pending;
  const invoices = Array.isArray(row.invoice_refs) ? row.invoice_refs : [];

  return (
    <Modal title={`طلب سداد · ${String(row.id).slice(0, 8)}`} onClose={onClose} width={680}>
      {/* Identity */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 14,
        padding: '14px 16px', marginBottom: 14,
        background: 'var(--bg2)', borderRadius: 12,
        alignItems: 'center',
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: 'var(--accent-dim)', color: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}><ShoppingBag size={20}/></div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
            {row.store_name || row.customer_name || '—'}
          </div>
          <div style={{ display: 'flex', gap: 14, marginTop: 4, fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--font-mono)', flexWrap: 'wrap' }}>
            <span style={{ direction: 'ltr' }}>{row.phone}</span>
            {row.store_id && <span>#{row.store_id}</span>}
          </div>
        </div>
        {row.phone && (
          <a href={`tel:${row.phone}`} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 999,
            background: 'var(--accent)', color: '#fff',
            fontSize: 12.5, fontWeight: 600, textDecoration: 'none',
            boxShadow: '0 1px 2px rgba(16,185,129,.22)',
          }}>
            <Phone size={13}/> اتصل
          </a>
        )}
      </div>

      {/* Current status + meta */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{
          padding: '5px 14px', borderRadius: 999,
          background: `color-mix(in srgb, ${meta.color} 14%, transparent)`,
          color: meta.color, fontSize: 12.5, fontWeight: 700,
        }}>{meta.label}</span>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          أُنشئ {fmtRelative(row.created_at)} · {fmtDate(row.created_at)}
        </span>
        {row.handled_at && (
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            معالج بواسطة <strong style={{ color: 'var(--text2)' }}>{row.handled_by_name || '—'}</strong> · {fmtRelative(row.handled_at)}
          </span>
        )}
      </div>

      {/* Headline amount */}
      <div style={{
        padding: '18px 20px', marginBottom: 14,
        background: '#0A0A0B', borderRadius: 14, color: '#fff',
      }}>
        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', letterSpacing: 1.5, textTransform: 'uppercase', color: 'rgba(255,255,255,.55)', fontWeight: 600, marginBottom: 6 }}>
          المبلغ المطلوب سداده
        </div>
        <div style={{ fontSize: 32, fontWeight: 700, fontFamily: 'var(--font-mono)', letterSpacing: -0.8 }}>
          {fmt(row.amount_total)} <span style={{ fontSize: 14, color: 'rgba(255,255,255,.5)', fontWeight: 500 }}>ر.س</span>
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,.65)', marginTop: 6 }}>
          {row.invoice_count} فاتورة مختارة
        </div>
      </div>

      {/* Moyasar payment hint — the customer paid via the portal's
          card form. This is NOT a confirmation (client callbacks can
          be faked); verify in Moyasar dashboard before تم السداد. */}
      {row.moyasar_payment_id && (
        <div style={{
          padding: '14px 16px', marginBottom: 14,
          background: 'rgba(16,185,129,.08)',
          border: '1px solid rgba(16,185,129,.22)',
          borderRadius: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8,
              background: 'rgba(16,185,129,.16)', color: '#10B981',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>💳</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
              العميل دفع عبر Moyasar
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginInlineStart: 38, fontFamily: 'var(--font-mono)', direction: 'ltr', textAlign: 'right' }}>
            <div>Payment ID: <strong style={{ color: 'var(--text2)' }}>{row.moyasar_payment_id}</strong></div>
            {row.payment_method && <div>طريقة الدفع: {row.payment_method}</div>}
            {row.paid_at && <div>وقت الدفع: {fmtDate(row.paid_at)}</div>}
          </div>
          <a href={`https://dashboard.moyasar.com/payments/${row.moyasar_payment_id}`} target="_blank" rel="noopener noreferrer" style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            marginTop: 10, marginInlineStart: 38,
            padding: '6px 12px', borderRadius: 999,
            background: '#10B981', color: '#fff',
            fontSize: 11.5, fontWeight: 600, textDecoration: 'none',
          }}>
            افتح في لوحة Moyasar ↗
          </a>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, marginInlineStart: 38 }}>
            ⚠ تحقّق من حالة الدفع في Moyasar قبل ضغط "تم السداد"
          </div>
        </div>
      )}

      {/* Bank transfer receipt — when the customer chose the bank
          transfer path, they uploaded a receipt. Show it inline as a
          preview when it's an image, otherwise a link. Verify the
          transfer in your bank statement before تم السداد. */}
      {row.payment_type === 'bank_transfer' && (
        <div style={{
          padding: '14px 16px', marginBottom: 14,
          background: 'rgba(59,130,246,.06)',
          border: '1px solid rgba(59,130,246,.20)',
          borderRadius: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8,
              background: 'rgba(59,130,246,.14)', color: '#3B82F6',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>🏦</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
              العميل حوّل بنكياً
            </div>
          </div>
          {row.receipt_path ? (() => {
            const url = receiptUrl(row.receipt_path);
            const isPdf = /\.pdf$/i.test(row.receipt_path);
            return (
              <div style={{ marginInlineStart: 38 }}>
                {isPdf ? (
                  <a href={url} target="_blank" rel="noopener noreferrer" style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '8px 14px', borderRadius: 999,
                    background: '#3B82F6', color: '#fff', textDecoration: 'none',
                    fontSize: 12.5, fontWeight: 600,
                  }}>
                    📎 افتح إيصال التحويل (PDF) ↗
                  </a>
                ) : (
                  <a href={url} target="_blank" rel="noopener noreferrer" style={{
                    display: 'block', borderRadius: 10, overflow: 'hidden',
                    border: '1px solid rgba(59,130,246,.28)',
                    maxWidth: 320,
                  }}>
                    <img src={url} alt="إيصال" style={{ width: '100%', height: 'auto', display: 'block' }}/>
                  </a>
                )}
              </div>
            );
          })() : (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginInlineStart: 38 }}>
              لم يُرفق إيصال
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10, marginInlineStart: 38 }}>
            ⚠ تحقّق من وصول التحويل في كشف البنك قبل ضغط "تم السداد"
          </div>
        </div>
      )}

      {/* Invoices list — grouped by store when the request spans
          multiple stores (invoice_refs items carry store_id). */}
      {invoices.length > 0 && (() => {
        // Group by store_id; preserve insertion order
        const groups = new Map();
        for (const inv of invoices) {
          const key = inv.store_id || '__single__';
          if (!groups.has(key)) {
            groups.set(key, { storeId: inv.store_id || null, storeName: inv.store_name || row.store_name || null, items: [] });
          }
          groups.get(key).items.push(inv);
        }
        const groupArr = [...groups.values()];
        const isMulti = groupArr.length > 1;

        return (
          <div style={{ marginBottom: 14 }}>
            <div style={{
              fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)',
              letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8, fontWeight: 600,
            }}>
              الفواتير المختارة ({invoices.length}) {isMulti && `· ${groupArr.length} متاجر`}
            </div>
            <div style={{ border: '1px solid var(--border)', borderRadius: 12, maxHeight: 280, overflowY: 'auto' }}>
              {groupArr.map((g, gi) => {
                const groupTotal = g.items.reduce((s, x) => s + (Number(x.amount) || 0), 0);
                return (
                  <div key={g.storeId || gi}>
                    {isMulti && (
                      <div style={{
                        padding: '10px 14px',
                        background: 'var(--bg2)',
                        borderTop: gi > 0 ? '1px solid var(--border)' : 'none',
                        borderBottom: '1px solid var(--border)',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                          <ShoppingBag size={13} color="var(--accent)"/>
                          <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {g.storeName || g.storeId || '—'}
                          </span>
                          <span style={{ fontSize: 10.5, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                            · {g.items.length} فاتورة
                          </span>
                        </div>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text2)', fontFamily: 'var(--font-mono)' }}>
                          {fmt(groupTotal)} <span style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 500 }}>ر.س</span>
                        </span>
                      </div>
                    )}
                    {g.items.map((inv, i, arr) => (
                      <div key={inv.id || `${gi}-${i}`} style={{
                        display: 'grid', gridTemplateColumns: '1fr auto', gap: 12,
                        padding: '10px 14px', alignItems: 'center',
                        borderBottom: i === arr.length - 1 ? 'none' : '1px solid var(--border)',
                      }}>
                        <div style={{ fontSize: 12, color: 'var(--text2)', fontFamily: 'var(--font-mono)' }}>
                          {fmtDate(inv.date)}
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
                          {fmt(inv.amount)} <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 500 }}>ر.س</span>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Customer note */}
      {row.notes && (
        <div style={{
          padding: '12px 14px', marginBottom: 14,
          background: 'rgba(59,130,246,.05)', borderRadius: 12,
          display: 'flex', gap: 10, alignItems: 'flex-start',
        }}>
          <MessageSquare size={15} color="#3B82F6" style={{ marginTop: 2, flexShrink: 0 }}/>
          <div>
            <div style={{ fontSize: 11.5, color: '#3B82F6', fontWeight: 600, marginBottom: 4 }}>ملاحظة العميل</div>
            <div style={{ fontSize: 13, color: 'var(--text)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{row.notes}</div>
          </div>
        </div>
      )}

      {/* Admin notes (editable) */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', fontWeight: 600, marginBottom: 5 }}>
          ملاحظات داخلية
        </label>
        <textarea
          value={adminNotes}
          onChange={e => setAdminNotes(e.target.value)}
          rows={3}
          placeholder="مثلاً: تواصلت معه واتس، وعد بتحويل يوم الأحد"
          style={{ width: '100%', padding: '10px 12px', borderRadius: 10, fontSize: 13, resize: 'vertical' }}
        />
      </div>

      {/* Status workflow buttons */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <Btn size="md" variant="ghost" icon={<Trash2 size={14}/>} onClick={handleDelete} disabled={busy} style={{ color: 'var(--red)' }}>
          حذف
        </Btn>
        {row.status !== 'cancelled' && (
          <Btn size="md" variant="ghost" icon={<XCircle size={14}/>} onClick={() => handleStatus('cancelled')} disabled={busy}>
            إلغاء الطلب
          </Btn>
        )}
        {row.status !== 'contacted' && row.status === 'pending' && (
          <Btn size="md" variant="primary" icon={<Phone size={14}/>} onClick={() => handleStatus('contacted')} disabled={busy}>
            تم التواصل
          </Btn>
        )}
        {row.status !== 'paid' && (
          <Btn size="md" variant="accent" icon={<CheckCircle2 size={14}/>} onClick={() => handleStatus('paid')} disabled={busy}>
            تم السداد
          </Btn>
        )}
      </div>
    </Modal>
  );
}

// ── Portal link button ──────────────────────────────────────────
// Shows the public /portal URL with a one-click "copy" CTA so the
// admin can share it with customers via WhatsApp / SMS / email
// without typing the host.
function PortalLinkButton() {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== 'undefined' ? `${window.location.origin}/portal` : '/portal';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast('تم نسخ رابط البوابة ✓', 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast('فشل النسخ — انسخه يدوياً', 'error');
    }
  };

  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '4px 4px 4px 14px', borderRadius: 999,
      background: 'var(--accent-dim)',
      border: '1px solid var(--accent)',
    }}>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          fontFamily: 'var(--font-mono)', fontSize: 11.5, fontWeight: 600,
          color: 'var(--accent)', textDecoration: 'none',
          direction: 'ltr',
          whiteSpace: 'nowrap',
          maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis',
        }}
        title="افتح البوابة في تبويب جديد"
      >
        {url}
      </a>
      <button
        onClick={handleCopy}
        title="نسخ"
        style={{
          background: copied ? 'var(--accent)' : 'transparent',
          color: copied ? '#fff' : 'var(--accent)',
          border: 'none', borderRadius: 999,
          padding: '5px 10px', fontSize: 11, fontWeight: 700,
          cursor: 'pointer', fontFamily: 'var(--font-sans)',
          transition: 'all .15s',
          display: 'inline-flex', alignItems: 'center', gap: 4,
        }}
      >
        {copied ? '✓ نُسخ' : '📋 نسخ'}
      </button>
    </div>
  );
}

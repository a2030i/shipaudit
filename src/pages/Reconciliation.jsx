// "مطابقة أرصدة المتاجر" — three-way reconciliation:
//   1. Internal platform export (استحقاق المتاجر)
//   2. Zoho Books — Customer Balances Summary
//   3. Our customer_receivables (auto, no upload needed)
//
// Each row in the result table shows the same store from all three
// angles + the largest pairwise discrepancy. Rows sort by max diff
// desc so the worst mismatches surface first — that's where the
// operator's attention is needed.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import * as XLSX from 'xlsx';
import {
  RefreshCw, Upload, Download, Trash2, AlertTriangle, CheckCircle2,
  Scale, Info, ChevronLeft, FileSpreadsheet,
} from 'lucide-react';
import {
  Card, Btn, Spinner, Empty, toast, PageHeader, DropZone,
} from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  parseInternalSettlement, parseZohoCustomerBalances,
  uploadBalanceSnapshot, listBalanceSnapshots, deleteBalanceSnapshot,
  loadReconciliation,
} from '../lib/reconciliationService.js';

const fmt = (n) =>
  n == null || Number.isNaN(n) ? '—'
  : Number(n).toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtCompact = (n) => {
  if (n == null || Number.isNaN(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1_000_000) return (n >= 0 ? '+' : '−') + (a / 1_000_000).toFixed(2) + 'م';
  if (a >= 1_000)     return (n >= 0 ? '+' : '−') + (a / 1_000).toFixed(1) + 'ك';
  return (n >= 0 ? '+' : n === 0 ? '' : '−') + a.toFixed(0);
};
const fmtDateTime = (iso) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('ar-SA', { dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return iso; }
};

export default function Reconciliation({ isActive = true }) {
  const location = useLocation();
  const { profile } = useAuth();
  const [loading, setLoading]       = useState(true);
  const [reconcile, setReconcile]   = useState([]);
  const [snapshots, setSnapshots]   = useState([]);
  const [tolerance, setTolerance]   = useState(0.5);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [r, s] = await Promise.all([
        loadReconciliation().catch(() => []),
        listBalanceSnapshots().catch(() => []),
      ]);
      setReconcile(r);
      setSnapshots(s);
    } catch (e) {
      toast(`فشل التحميل: ${e.message}`, 'error');
    }
    setLoading(false);
  }, []);

  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh, location.pathname]);

  // Buckets for the headline stats
  const stats = useMemo(() => {
    let matched = 0, mismatched = 0, totalDiff = 0;
    for (const r of reconcile) {
      if (r.maxDiff <= tolerance) matched++;
      else { mismatched++; totalDiff += r.maxDiff; }
    }
    return { matched, mismatched, totalDiff: +totalDiff.toFixed(2), total: reconcile.length };
  }, [reconcile, tolerance]);

  const latestInternal = snapshots.find(s => s.source === 'internal');
  const latestZoho     = snapshots.find(s => s.source === 'zoho');

  // ── upload handlers ──
  const handleUpload = async (file, source) => {
    try {
      const buffer = await file.arrayBuffer();
      const wb     = XLSX.read(buffer, { type: 'array', cellDates: true });
      const ws     = wb.Sheets[wb.SheetNames[0]];
      const rows   = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
      const parsed = source === 'internal'
        ? parseInternalSettlement(rows)
        : parseZohoCustomerBalances(rows);
      if (parsed.errors.length) { toast(parsed.errors.join('\n'), 'error'); return; }
      if (!parsed.rows.length)  { toast('لا توجد صفوف صالحة في الملف', 'warning'); return; }
      const result = await uploadBalanceSnapshot({
        source,
        parsed:   parsed.rows,
        fileName: file.name,
        userId:   profile?.id || null,
      });
      toast(
        `تم رفع ${result.rowCount} متجر · ${result.matched} مطابق · إجمالي ${fmt(result.totalBalance)} ر.س`,
        'success',
      );
      await refresh();
    } catch (e) {
      toast(`فشل: ${e.message}`, 'error');
    }
  };

  const handleDeleteSnapshot = async (id, source) => {
    if (!confirm(`حذف آخر تحميل ${source === 'internal' ? 'داخلي' : 'Zoho'}؟`)) return;
    try {
      await deleteBalanceSnapshot(id);
      toast('تم الحذف', 'success');
      await refresh();
    } catch (e) { toast(`فشل الحذف: ${e.message}`, 'error'); }
  };

  // ── Export mismatches to Excel ──
  const exportMismatches = () => {
    const bad = reconcile.filter(r => r.maxDiff > tolerance);
    if (!bad.length) { toast('لا توجد فروقات للتصدير', 'info'); return; }
    const headers = [
      'رقم المتجر', 'اسم المتجر',
      'الداخلي', 'الفواتير', 'Zoho',
      'أكبر فرق',
      'الاسم في الداخلي', 'الاسم في Zoho',
    ];
    const xRows = bad.map(r => [
      r.storeId, r.storeName,
      r.internal, r.receivables, r.zoho,
      r.maxDiff,
      r.internalRawName || '', r.zohoRawName || '',
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...xRows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'الفروقات');
    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `مطابقة_فروقات_${dateStr}.xlsx`);
    toast(`تم تصدير ${bad.length} فرق`, 'success');
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

  return (
    <div style={{ padding: '20px 24px 60px', maxWidth: 1320, margin: '0 auto' }}>
      <PageHeader
        icon={<Scale size={22}/>}
        iconColor="#8B5CF6"
        title="مطابقة أرصدة المتاجر"
        subtitle="قارن أرصدة المتاجر من 3 مصادر: النظام الداخلي · الفواتير · Zoho"
        actions={
          <Btn size="sm" variant="ghost" icon={<RefreshCw size={13}/>} onClick={refresh}>
            تحديث
          </Btn>
        }
      />

      {/* Upload row */}
      <div style={{
        display: 'grid', gap: 14, marginBottom: 20,
        gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
      }}>
        <UploadCard
          title="النظام الداخلي"
          subtitle="استحقاق المتاجر — العمودان: المتجر · الرصيد"
          color="#3B82F6"
          icon={<FileSpreadsheet size={18}/>}
          snapshot={latestInternal}
          onUpload={(f) => handleUpload(f, 'internal')}
          onDelete={() => handleDeleteSnapshot(latestInternal.id, 'internal')}
        />
        <UploadCard
          title="Zoho Books"
          subtitle="Customer Balances Summary — Customer Name + Closing Balance"
          color="#F59E0B"
          icon={<FileSpreadsheet size={18}/>}
          snapshot={latestZoho}
          onUpload={(f) => handleUpload(f, 'zoho')}
          onDelete={() => handleDeleteSnapshot(latestZoho.id, 'zoho')}
        />
      </div>

      {/* Stats strip */}
      {reconcile.length > 0 && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
            <Stat label="إجمالي المتاجر"   value={stats.total.toLocaleString('ar-SA')}      color="#0EA5E9"/>
            <Stat label="مطابق"             value={stats.matched.toLocaleString('ar-SA')}    color="#10B981" icon={<CheckCircle2 size={14}/>}/>
            <Stat label="فروقات"            value={stats.mismatched.toLocaleString('ar-SA')} color="#DC2626" icon={<AlertTriangle size={14}/>}/>
            <Stat label="إجمالي الفروقات"   value={fmt(stats.totalDiff)} suffix="ر.س"        color="#DC2626"/>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginInlineStart: 'auto' }}>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>قبول فرق حتى:</span>
              <input
                type="number" step="0.01" min="0"
                value={tolerance}
                onChange={(e) => setTolerance(Math.max(0, Number(e.target.value) || 0))}
                style={{
                  width: 80, padding: '4px 8px', fontSize: 12,
                  border: '1px solid var(--border)', borderRadius: 6,
                  background: 'var(--surface)', color: 'var(--text)',
                  textAlign: 'center', fontFamily: 'var(--font-mono)',
                }}
              />
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>ر.س</span>
            </div>
            <Btn size="sm" variant="ghost" icon={<Download size={13}/>} onClick={exportMismatches} disabled={stats.mismatched === 0}>
              تصدير الفروقات
            </Btn>
          </div>
        </Card>
      )}

      {/* Reconciliation table */}
      {reconcile.length === 0 ? (
        <Empty
          icon="🧮"
          title="لا توجد بيانات للمطابقة"
          sub="ارفع ملف النظام الداخلي و/أو ملف Zoho لبدء المطابقة. الفواتير تُؤخذ تلقائياً من آخر snapshot في /receivables."
        />
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                {['#', 'المتجر', 'الداخلي', 'الفواتير', 'Zoho', 'أكبر فرق', 'الحالة'].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reconcile.slice(0, 500).map((r, i) => {
                const matched = r.maxDiff <= tolerance;
                return (
                  <tr key={r.storeId} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 12px', color: 'var(--muted2)', fontSize: 10, fontFamily: 'var(--font-mono)' }}>{i + 1}</td>
                    <td style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--text)' }}>
                      {r.storeName}
                      <div style={{ fontSize: 10, color: 'var(--muted2)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                        {r.storeId}
                      </div>
                    </td>
                    <BalCell value={r.internal} highlight={!matched}/>
                    <BalCell value={r.receivables} highlight={!matched}/>
                    <BalCell value={r.zoho} highlight={!matched}/>
                    <td style={{
                      padding: '10px 12px', textAlign: 'left',
                      fontFamily: 'var(--font-mono)', fontWeight: 700,
                      color: matched ? 'var(--muted)' : '#DC2626',
                    }}>
                      {r.maxDiff > 0.005 ? fmt(r.maxDiff) : '—'}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      {matched ? (
                        <span style={statusPill('#10B981')}>
                          <CheckCircle2 size={11}/> مطابق
                        </span>
                      ) : (
                        <span style={statusPill('#DC2626')}>
                          <AlertTriangle size={11}/> فرق
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {reconcile.length > 500 && (
            <div style={{ padding: 12, textAlign: 'center', fontSize: 11.5, color: 'var(--muted)', background: 'var(--surface2)' }}>
              عرض أول ٥٠٠ من {reconcile.length.toLocaleString('ar-SA')} متجر — التصدير يشمل كل الفروقات
            </div>
          )}
        </Card>
      )}

      {/* Educational footer */}
      <div style={{
        marginTop: 16, padding: 14, borderRadius: 10,
        background: 'var(--surface2)', border: '1px solid var(--border)',
        fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.7,
        display: 'flex', gap: 10, alignItems: 'flex-start',
      }}>
        <Info size={14} style={{ flexShrink: 0, marginTop: 2 }}/>
        <div>
          <strong style={{ color: 'var(--text2)' }}>كيف تعمل المطابقة:</strong>{' '}
          عند رفع أي ملف، النظام يطابق كل اسم متجر مع جدول <code>merchants</code> (مطابقة تامة أولاً ثم fuzzy بـ pg_trgm).{' '}
          من ثم يجلب رصيد الفواتير من آخر snapshot في <code>/receivables</code> عبر روابط <code>customer_merchant_links</code>.{' '}
          <strong style={{ color: 'var(--text2)' }}>الفرق</strong> = أكبر اختلاف بين أي مصدرين من الثلاثة.{' '}
          الحد المقبول للفرق قابل للضبط أعلى الجدول (افتراضي 0.50 ر.س).
        </div>
      </div>
    </div>
  );
}

// ── subcomponents ─────────────────────────────────────────────
function UploadCard({ title, subtitle, color, icon, snapshot, onUpload, onDelete }) {
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{
          width: 32, height: 32, borderRadius: 8,
          background: `color-mix(in srgb, ${color} 14%, transparent)`,
          color, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{title}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{subtitle}</div>
        </div>
      </div>
      {snapshot ? (
        <div style={{
          padding: 12, borderRadius: 8,
          background: 'var(--surface2)', border: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CheckCircle2 size={14} color="#10B981"/>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>
                {snapshot.row_count} متجر · {snapshot.matched_count} مطابق
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>
                {fmtDateTime(snapshot.uploaded_at)} · {snapshot.file_name || 'بدون اسم ملف'}
              </div>
            </div>
            <button onClick={onDelete} title="حذف هذا التحميل" style={{
              background: 'transparent', border: 'none', padding: 4, cursor: 'pointer',
              color: 'var(--muted)', display: 'flex',
            }}
              onMouseEnter={(e) => e.currentTarget.style.color = '#DC2626'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--muted)'}
            >
              <Trash2 size={12}/>
            </button>
          </div>
          <div style={{ marginTop: 10 }}>
            <DropZone onFile={onUpload} accept=".xlsx,.xls,.csv">
              <span style={{ fontSize: 11.5 }}>أو ارفع نسخة جديدة (تستبدل القراءة الحالية)</span>
            </DropZone>
          </div>
        </div>
      ) : (
        <DropZone onFile={onUpload} accept=".xlsx,.xls,.csv">
          <Upload size={16}/>
          <span>اسحب الملف هنا أو اضغط للاختيار</span>
        </DropZone>
      )}
    </Card>
  );
}

function BalCell({ value, highlight }) {
  const zero = Math.abs(value) < 0.01;
  return (
    <td style={{
      padding: '10px 12px', textAlign: 'left',
      fontFamily: 'var(--font-mono)', fontSize: 12,
      fontWeight: 600,
      color: zero ? 'var(--muted2)'
           : value < 0 ? (highlight ? '#DC2626' : 'var(--text2)')
           : (highlight ? '#047857' : 'var(--text2)'),
    }}>
      {zero ? '—' : fmt(value)}
    </td>
  );
}

const statusPill = (color) => ({
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '3px 9px', borderRadius: 999,
  background: `color-mix(in srgb, ${color} 14%, transparent)`,
  color, fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap',
});

function Stat({ label, value, color, suffix, icon }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 90 }}>
      <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600, letterSpacing: .5, display: 'flex', alignItems: 'center', gap: 4 }}>
        {icon}{label}
      </span>
      <span style={{ fontSize: 16, fontWeight: 700, color, fontFamily: 'var(--font-mono)', letterSpacing: -0.3 }}>
        {value}
        {suffix && <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 500, marginInlineStart: 3 }}>{suffix}</span>}
      </span>
    </div>
  );
}

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
  Scale, Info, ChevronLeft, FileSpreadsheet, Link2, Search, X,
} from 'lucide-react';
import {
  Card, Btn, Spinner, Empty, Modal, toast, PageHeader, DropZone,
} from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  parseInternalSettlement, parseZohoCustomerBalances,
  uploadBalanceSnapshot, listBalanceSnapshots, deleteBalanceSnapshot,
  loadReconciliation,
  loadUnmatchedBalances, linkUnmatchedToStore, loadMerchantsForPicker,
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
  const [unmatched, setUnmatched]   = useState([]);
  const [tolerance, setTolerance]   = useState(0.5);
  const [onlyGaps,  setOnlyGaps]    = useState(false);
  const [linkTarget, setLinkTarget] = useState(null);    // { rawName, source, balance }

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [r, s, u] = await Promise.all([
        loadReconciliation().catch(() => []),
        listBalanceSnapshots().catch(() => []),
        loadUnmatchedBalances().catch(() => []),
      ]);
      setReconcile(r);
      setSnapshots(s);
      setUnmatched(u);
    } catch (e) {
      toast(`فشل التحميل: ${e.message}`, 'error');
    }
    setLoading(false);
  }, []);

  const handleLinkConfirm = async (storeId) => {
    if (!linkTarget) return;
    try {
      await linkUnmatchedToStore({
        rawName: linkTarget.rawName,
        storeId,
        userId:  profile?.id || null,
      });
      toast(`تم ربط «${linkTarget.rawName}» بالمتجر ${storeId}`, 'success');
      setLinkTarget(null);
      await refresh();
    } catch (e) {
      toast(`فشل الربط: ${e.message}`, 'error');
    }
  };

  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh, location.pathname]);

  // Reframe every row around the INTERNAL anchor. Internal system
  // is the source of truth; Zoho should match it; receivables is a
  // secondary cross-check. Each row gets an `action` describing
  // what needs to be done in Zoho to bring it into agreement.
  //
  // Anchor preference: store_settlement (internal aggregate) →
  // receivables (invoice-level, also internal). If both are zero
  // and Zoho has a value, that's a "Zoho has phantom entry" gap.
  const enriched = useMemo(() => reconcile.map(r => {
    const hasInternal    = Math.abs(r.internal)    > 0.005;
    const hasReceivables = Math.abs(r.receivables) > 0.005;
    const anchor = hasInternal ? r.internal
                 : hasReceivables ? r.receivables
                 : 0;
    const anchorSource = hasInternal ? 'internal'
                      : hasReceivables ? 'receivables'
                      : 'none';
    const zohoGap        = r.zoho       - anchor;   // Zoho minus internal
    const receivablesGap = r.receivables - anchor;  // receivables minus internal (cross-check)
    const matched        = Math.abs(zohoGap) <= tolerance && Math.abs(receivablesGap) <= tolerance;
    let action;
    if (matched) {
      action = { kind: 'matched', label: 'مطابق', color: '#10B981' };
    } else if (Math.abs(zohoGap) <= tolerance) {
      // Zoho matches internal, but receivables doesn't — internal-side inconsistency
      action = { kind: 'receivables_drift', label: 'فرق في كشف الفواتير', color: '#F59E0B' };
    } else if (zohoGap < 0) {
      // Zoho < internal → Zoho is missing entries the internal system has.
      // The platform didn't push these to Zoho yet.
      action = { kind: 'zoho_missing', label: `أضف ${fmtCompact(Math.abs(zohoGap))} في Zoho`, color: '#DC2626' };
    } else {
      // Zoho > internal → Zoho has an entry the internal system doesn't reflect.
      // Usually a duplicate or unmatched payment in Zoho.
      action = { kind: 'zoho_extra', label: `راجع زيادة ${fmtCompact(Math.abs(zohoGap))} في Zoho`, color: '#F97316' };
    }
    return { ...r, anchor, anchorSource, zohoGap, receivablesGap, matched, action };
  }), [reconcile, tolerance]);

  // Headline stats from the enriched rows
  const stats = useMemo(() => {
    let matched = 0, zohoMissing = 0, zohoExtra = 0, recDrift = 0, gapTotal = 0;
    for (const r of enriched) {
      if (r.matched) matched++;
      else if (r.action.kind === 'zoho_missing')      { zohoMissing++; gapTotal += Math.abs(r.zohoGap); }
      else if (r.action.kind === 'zoho_extra')        { zohoExtra++;   gapTotal += Math.abs(r.zohoGap); }
      else if (r.action.kind === 'receivables_drift') recDrift++;
    }
    return {
      total:       enriched.length,
      matched,
      zohoMissing,
      zohoExtra,
      recDrift,
      gapTotal:    +gapTotal.toFixed(2),
    };
  }, [enriched]);

  const visible = useMemo(
    () => onlyGaps ? enriched.filter(r => !r.matched) : enriched,
    [enriched, onlyGaps],
  );

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

  // ── Export "what to fix in Zoho" Excel ──
  // Sheet focuses on rows that need Zoho action, sorted by the
  // absolute size of the Zoho gap (largest first). Column order
  // matches the operator's accountant-handoff workflow.
  const exportMismatches = () => {
    const bad = enriched.filter(r => !r.matched);
    if (!bad.length) { toast('لا توجد فروقات — الكل متطابق', 'info'); return; }
    bad.sort((a, b) => Math.abs(b.zohoGap) - Math.abs(a.zohoGap));
    const headers = [
      'رقم المتجر',
      'اسم المتجر',
      'الاسم في زوهو',
      'الرصيد في لمحه',
      'الرصيد في زوهو',
      'فرق الأرصدة',
    ];
    const xRows = bad.map(r => [
      r.storeId,
      r.storeName,
      r.zohoRawName || '',
      r.anchor,
      r.zoho,
      r.zohoGap,
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...xRows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'تصحيحات Zoho');
    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `تصحيحات_Zoho_${dateStr}.xlsx`);
    toast(`تم تصدير ${bad.length} حالة تحتاج تحديث في Zoho`, 'success');
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

      {/* "Internal is the source of truth" banner */}
      {reconcile.length > 0 && (
        <Card style={{
          marginBottom: 14,
          background: 'color-mix(in srgb, #3B82F6 6%, transparent)',
          border: '1px solid color-mix(in srgb, #3B82F6 24%, transparent)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Info size={16} color="#3B82F6" style={{ flexShrink: 0 }}/>
            <div style={{ fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.7 }}>
              <strong style={{ color: 'var(--text)' }}>النظام الداخلي هو المرجع.</strong>{' '}
              Zoho يجب أن يطابقه. أي فرق يعني أن النظام الداخلي لم يرحّل العملية بعد إلى Zoho —
              العمود "الإجراء المطلوب" يخبرك ماذا تضيف/تراجع في Zoho ليطابق المرجع.
            </div>
          </div>
        </Card>
      )}

      {/* Stats strip */}
      {reconcile.length > 0 && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
            <Stat label="إجمالي المتاجر"  value={stats.total.toLocaleString('ar-SA')}        color="#0EA5E9"/>
            <Stat label="مطابق"           value={stats.matched.toLocaleString('ar-SA')}      color="#10B981" icon={<CheckCircle2 size={14}/>}/>
            <Stat label="Zoho ناقص"       value={stats.zohoMissing.toLocaleString('ar-SA')}  color="#DC2626" icon={<AlertTriangle size={14}/>}/>
            <Stat label="Zoho زائد"       value={stats.zohoExtra.toLocaleString('ar-SA')}    color="#F97316"/>
            <Stat label="فرق في الفواتير" value={stats.recDrift.toLocaleString('ar-SA')}     color="#F59E0B"/>
            <Stat label="مجموع الفروقات"  value={fmt(stats.gapTotal)} suffix="ر.س"           color="#DC2626"/>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginInlineStart: 'auto' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--muted)', cursor: 'pointer' }}>
                <input type="checkbox" checked={onlyGaps} onChange={e => setOnlyGaps(e.target.checked)} style={{ accentColor: '#DC2626' }}/>
                الفروقات فقط
              </label>
              <span style={{ fontSize: 11, color: 'var(--muted)', marginInlineStart: 10 }}>قبول فرق حتى:</span>
              <input
                type="number" step="0.01" min="0"
                value={tolerance}
                onChange={(e) => setTolerance(Math.max(0, Number(e.target.value) || 0))}
                style={{
                  width: 70, padding: '4px 8px', fontSize: 12,
                  border: '1px solid var(--border)', borderRadius: 6,
                  background: 'var(--surface)', color: 'var(--text)',
                  textAlign: 'center', fontFamily: 'var(--font-mono)',
                }}
              />
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>ر.س</span>
            </div>
            <Btn size="sm" variant="ghost" icon={<Download size={13}/>} onClick={exportMismatches} disabled={stats.matched === stats.total}>
              تصدير تصحيحات Zoho
            </Btn>
          </div>
        </Card>
      )}

      {/* Unmatched section — surfaces rows hidden from the main
          comparison because their store_id couldn't be resolved.
          Operator can link manually via the merchant picker. */}
      {unmatched.length > 0 && (
        <Card style={{
          padding: 0, overflow: 'hidden', marginBottom: 16,
          border: '1.5px solid color-mix(in srgb, #F59E0B 35%, transparent)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '12px 16px',
            background: 'color-mix(in srgb, #F59E0B 10%, transparent)',
            borderBottom: '1px solid var(--border)',
          }}>
            <Link2 size={15} color="#B45309"/>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
              غير مرتبط بمتاجر النظام — {unmatched.length} صف
            </span>
            <span style={{ fontSize: 11, color: '#B45309', fontWeight: 600 }}>
              ({unmatched.filter(u => u.source === 'internal').length} من الداخلي ·{' '}
              {unmatched.filter(u => u.source === 'zoho').length} من Zoho)
            </span>
            <span style={{
              marginInlineStart: 'auto', fontSize: 11.5, color: 'var(--text2)',
            }}>
              مجموع الأرصدة المخفية:&nbsp;
              <strong style={{
                fontFamily: 'var(--font-mono)',
                color: unmatched.reduce((s, u) => s + Math.abs(u.balance), 0) > 0 ? '#DC2626' : 'var(--muted)',
              }}>
                {fmt(unmatched.reduce((s, u) => s + Math.abs(u.balance), 0))} ر.س
              </strong>
            </span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                <th style={thStyle}>المصدر</th>
                <th style={thStyle}>الاسم في الملف</th>
                <th style={thStyle}>الرصيد</th>
                <th style={thStyle}>إجراء</th>
              </tr>
            </thead>
            <tbody>
              {unmatched.map(u => (
                <tr key={`${u.source}-${u.rawName}`} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={statusPill(u.source === 'internal' ? '#3B82F6' : '#F59E0B')}>
                      {u.source === 'internal' ? 'الداخلي' : 'Zoho'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', color: 'var(--text)', fontWeight: 500 }}>
                    {u.rawName}
                  </td>
                  <td style={{
                    padding: '10px 12px', textAlign: 'left',
                    fontFamily: 'var(--font-mono)', fontWeight: 600,
                    color: Math.abs(u.balance) > 0.5 ? '#DC2626' : 'var(--muted2)',
                  }}>
                    {Math.abs(u.balance) > 0.005 ? fmt(u.balance) : '—'}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <Btn size="sm" variant="ghost" icon={<Link2 size={11}/>}
                         onClick={() => setLinkTarget({ rawName: u.rawName, source: u.source, balance: u.balance })}>
                      اربط بمتجر
                    </Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Reconciliation table — anchored on internal (المرجع) */}
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
                <th style={thStyle}>#</th>
                <th style={thStyle}>المتجر</th>
                <th style={{...thStyle, color: '#3B82F6'}}>الداخلي (المرجع)</th>
                <th style={thStyle}>الفواتير</th>
                <th style={thStyle}>Zoho</th>
                <th style={thStyle}>Zoho − الداخلي</th>
                <th style={thStyle}>الإجراء</th>
              </tr>
            </thead>
            <tbody>
              {visible.slice(0, 500).map((r, i) => (
                <tr key={r.storeId} style={{
                  borderBottom: '1px solid var(--border)',
                  background: r.matched ? 'transparent' : 'color-mix(in srgb, #DC2626 3%, transparent)',
                }}>
                  <td style={{ padding: '10px 12px', color: 'var(--muted2)', fontSize: 10, fontFamily: 'var(--font-mono)' }}>{i + 1}</td>
                  <td style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--text)' }}>
                    {r.storeName}
                    <div style={{ fontSize: 10, color: 'var(--muted2)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                      {r.storeId}
                    </div>
                  </td>
                  <BalCell value={r.anchor} anchor/>
                  <BalCell value={r.receivables} dimmedIfZero/>
                  <BalCell value={r.zoho} dimmedIfZero/>
                  <td style={{
                    padding: '10px 12px', textAlign: 'left',
                    fontFamily: 'var(--font-mono)', fontWeight: 700,
                    color: r.matched ? 'var(--muted)' : (r.zohoGap < 0 ? '#DC2626' : '#F97316'),
                  }}>
                    {Math.abs(r.zohoGap) > 0.005 ? (r.zohoGap > 0 ? '+' : '−') + fmt(Math.abs(r.zohoGap)) : '—'}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={statusPill(r.action.color)}>
                      {r.action.kind === 'matched' ? <CheckCircle2 size={11}/> : <AlertTriangle size={11}/>}
                      {r.action.label}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {visible.length > 500 && (
            <div style={{ padding: 12, textAlign: 'center', fontSize: 11.5, color: 'var(--muted)', background: 'var(--surface2)' }}>
              عرض أول ٥٠٠ من {visible.length.toLocaleString('ar-SA')} متجر — التصدير يشمل كل الفروقات
            </div>
          )}
        </Card>
      )}

      {linkTarget && (
        <MerchantPickerModal
          target={linkTarget}
          onCancel={() => setLinkTarget(null)}
          onConfirm={handleLinkConfirm}
        />
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
          المرجع = النظام الداخلي (ملف الاستحقاق، أو كشف الفواتير كبديل).{' '}
          <strong style={{ color: '#DC2626' }}>Zoho ناقص</strong> = الفرق سالب → النظام الداخلي سجّل عملية لم تُرحَّل بعد إلى Zoho.{' '}
          <strong style={{ color: '#F97316' }}>Zoho زائد</strong> = الفرق موجب → في Zoho عملية ليست في الداخلي (تحقّق من التكرار أو دفعة غير مرتبطة).{' '}
          <strong style={{ color: '#F59E0B' }}>فرق في الفواتير</strong> = Zoho يطابق الداخلي لكن كشف الفواتير المرفوع يختلف — اعتمد المرجع.{' '}
          الحد المقبول للفرق قابل للضبط (افتراضي 0.50 ر.س).
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

function BalCell({ value, anchor = false, dimmedIfZero = false }) {
  const zero = Math.abs(value) < 0.01;
  return (
    <td style={{
      padding: '10px 12px', textAlign: 'left',
      fontFamily: 'var(--font-mono)', fontSize: 12,
      fontWeight: anchor ? 700 : 600,
      color: zero
        ? (dimmedIfZero ? 'var(--muted2)' : 'var(--muted)')
        : anchor ? '#3B82F6' : 'var(--text2)',
    }}>
      {zero ? '—' : fmt(value)}
    </td>
  );
}

const thStyle = {
  padding: '10px 12px', textAlign: 'right',
  fontSize: 11, fontWeight: 600, color: 'var(--muted)',
  whiteSpace: 'nowrap',
};

const statusPill = (color) => ({
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '3px 9px', borderRadius: 999,
  background: `color-mix(in srgb, ${color} 14%, transparent)`,
  color, fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap',
});

function MerchantPickerModal({ target, onCancel, onConfirm }) {
  const [merchants, setMerchants] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState('');
  const [picked,    setPicked]    = useState(null);

  useEffect(() => {
    loadMerchantsForPicker()
      .then(setMerchants)
      .catch((e) => toast(`فشل تحميل المتاجر: ${e.message}`, 'error'))
      .finally(() => setLoading(false));
  }, []);

  // Auto-suggest top trigram-similar merchants when the picker first
  // opens. Cheap heuristic: extract the last dash-separated segment
  // (e.g. "Konhub LLC - متجر أشكال" → "متجر أشكال") and rank merchants
  // by substring containment of either side.
  const suggested = useMemo(() => {
    const norm = (s) => String(s || '').toLowerCase()
      .replace(/[ًٌٍَُِّْٰ]/g, '')
      .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
    const segs = String(target.rawName || '').split(/[-|]/).map(s => norm(s.trim())).filter(s => s.length >= 2);
    if (!segs.length) return [];
    const scored = merchants.map(m => {
      const mn = norm(m.storeName);
      let score = 0;
      for (const seg of segs) {
        if (mn === seg)            score = Math.max(score, 1.0);
        else if (mn.includes(seg)) score = Math.max(score, Math.min(seg.length, mn.length) / Math.max(seg.length, mn.length));
        else if (seg.includes(mn)) score = Math.max(score, Math.min(seg.length, mn.length) / Math.max(seg.length, mn.length));
      }
      return { ...m, _score: score };
    }).filter(m => m._score > 0.3).sort((a, b) => b._score - a._score).slice(0, 5);
    return scored;
  }, [merchants, target]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return merchants.slice(0, 100);  // cap for perf
    return merchants.filter(m =>
      String(m.storeName || '').toLowerCase().includes(q) ||
      String(m.storeId   || '').toLowerCase().includes(q) ||
      String(m.phone     || '').toLowerCase().includes(q),
    ).slice(0, 100);
  }, [merchants, search]);

  return (
    <Modal title={`ربط: ${target.rawName}`} onClose={onCancel} width={680}>
      <form
        autoComplete="off"
        onSubmit={(e) => { e.preventDefault(); if (picked) onConfirm(picked.storeId); }}
        style={{ padding: '4px 4px 0' }}
      >
        {/* Banner showing the source + balance */}
        <div style={{
          padding: 12, marginBottom: 12, borderRadius: 8,
          background: target.source === 'internal'
            ? 'color-mix(in srgb, #3B82F6 8%, transparent)'
            : 'color-mix(in srgb, #F59E0B 8%, transparent)',
          border: '1px solid var(--border)',
          fontSize: 12, color: 'var(--text2)', display: 'flex', gap: 12,
        }}>
          <span>
            <strong style={{ color: 'var(--text)' }}>المصدر:</strong>{' '}
            {target.source === 'internal' ? 'النظام الداخلي' : 'Zoho'}
          </span>
          {Math.abs(target.balance) > 0.005 && (
            <span>
              <strong style={{ color: 'var(--text)' }}>الرصيد:</strong>{' '}
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: target.balance < 0 ? '#DC2626' : 'var(--text2)' }}>
                {fmt(target.balance)} ر.س
              </span>
            </span>
          )}
        </div>

        {/* Suggested matches */}
        {suggested.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, marginBottom: 6 }}>
              اقتراحات تلقائية
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {suggested.map(m => (
                <button key={m.storeId} type="button" onClick={() => setPicked(m)} style={{
                  padding: '6px 12px', borderRadius: 999, cursor: 'pointer',
                  border: `1.5px solid ${picked?.storeId === m.storeId ? '#10B981' : 'var(--border)'}`,
                  background: picked?.storeId === m.storeId ? 'rgba(16,185,129,.12)' : 'transparent',
                  color: picked?.storeId === m.storeId ? '#047857' : 'var(--text2)',
                  fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-sans)',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}>
                  {m.storeName}
                  <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                    #{m.storeId} · {Math.round(m._score * 100)}%
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Search */}
        <div style={{ position: 'relative', marginBottom: 10 }}>
          <Search size={14} style={{ position: 'absolute', insetInlineStart: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }}/>
          <input
            type="text"
            name="merchant_search"
            autoComplete="off"
            spellCheck={false}
            data-form-type="other"
            data-lpignore="true"
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث باسم المتجر أو رقمه أو الجوال…"
            style={{
              width: '100%', padding: '9px 12px 9px 34px', fontSize: 13,
              border: '1px solid var(--border)', borderRadius: 8,
              background: 'var(--surface)', color: 'var(--text)',
              fontFamily: 'var(--font-sans)', boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Results list */}
        <div style={{
          border: '1px solid var(--border)', borderRadius: 8,
          maxHeight: 340, overflowY: 'auto',
        }}>
          {loading ? (
            <div style={{ padding: 24, textAlign: 'center' }}><Spinner size={20}/></div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: 'var(--muted)' }}>
              لا توجد نتائج لـ «{search}»
            </div>
          ) : (
            filtered.map(m => (
              <div key={m.storeId} onClick={() => setPicked(m)} style={{
                padding: '10px 14px', cursor: 'pointer',
                borderBottom: '1px solid var(--border)',
                background: picked?.storeId === m.storeId ? 'color-mix(in srgb, #10B981 10%, transparent)' : 'transparent',
                display: 'flex', alignItems: 'center', gap: 12,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {m.storeName}
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2, fontFamily: 'var(--font-mono)', direction: 'ltr', textAlign: 'right' }}>
                    #{m.storeId} {m.phone ? `· ${m.phone}` : ''} {m.status ? `· ${m.status}` : ''}
                  </div>
                </div>
                {picked?.storeId === m.storeId && <CheckCircle2 size={16} color="#10B981"/>}
              </div>
            ))
          )}
        </div>

        <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
          <Btn size="md" variant="primary" icon={<Link2 size={13}/>}
               onClick={() => picked && onConfirm(picked.storeId)} disabled={!picked}>
            {picked ? `اربط بـ ${picked.storeName}` : 'اختر متجراً'}
          </Btn>
          <Btn size="md" variant="ghost" onClick={onCancel}>إلغاء</Btn>
        </div>
      </form>
    </Modal>
  );
}

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

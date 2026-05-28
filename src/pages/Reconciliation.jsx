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
  Scale, Info, ChevronLeft, FileSpreadsheet, Link2, Search, X, Zap,
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
  loadUnmatchedZohoForPicker, linkInternalRowToZohoRow,
  autolinkBalancesByExactName,
  parseZohoVendorBalances, uploadVendorBalanceSnapshot,
  listVendorSnapshots, deleteVendorSnapshot,
  loadVendorReconciliation, loadVendorOthers,
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
  // Hide zero-balance rows — no urgency to link until they carry debt.
  const unmatchedWithBalance = unmatched.filter(u => Math.abs(u.balance) > 0.005);
  const [tolerance, setTolerance]   = useState(0.5);
  const [onlyGaps,  setOnlyGaps]    = useState(false);
  const [linkTarget, setLinkTarget] = useState(null);    // { rawName, source, balance }
  // Tab between customer side (المتاجر/العملاء) and vendor side
  // (شركات الشحن). Each side has its own data + uploads.
  const [tab, setTab]               = useState('customers');
  const [autolinkBusy, setAutolinkBusy] = useState(false);

  // One-click backfill for the common case where the store_balances
  // upload happened before the merchants snapshot, leaving rows
  // unlinked despite having identical names to existing merchants.
  // The RPC does the SET on the server in a single transaction.
  const runAutolinkExactName = async () => {
    setAutolinkBusy(true);
    try {
      const { count, storeIds } = await autolinkBalancesByExactName();
      if (count === 0) {
        toast('لا توجد صفوف باسم مطابق — كل المتاجر مربوطة فعلاً', 'info');
      } else {
        toast(`✓ تم ربط ${count} متجراً تلقائياً بالأسماء المطابقة`, 'success');
        await refresh();
      }
      return { count, storeIds };
    } catch (e) {
      toast(`فشل الربط التلقائي: ${e.message}`, 'error');
    } finally {
      setAutolinkBusy(false);
    }
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // Auto-run the segment-match auto-linker BEFORE loading the
      // reconciliation/unmatched lists. Idempotent and fast — only
      // touches rows where store_id IS NULL. Catches the common
      // case where a Zoho row's raw_name is the merchant name
      // prefixed with the legal entity ("مؤسسة X - متجر Y"). Silent
      // if nothing changed; toast only when rows were actually
      // linked so the operator sees what happened.
      try {
        const r = await autolinkBalancesByExactName();
        if (r?.count > 0) {
          toast(`✓ ربطنا ${r.count} متجر تلقائياً (أسماء مطابقة أو متضمنة)`, 'success');
        }
      } catch { /* silent — fall through to load anyway */ }

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

  // Picker confirms one of two ways depending on the unmatched
  // row's source:
  //   Internal-source row → operator picked a Zoho candidate (rawName).
  //     We pair the two unmatched rows by fuzzy-matching the internal
  //     name to a merchant via linkInternalRowToZohoRow().
  //   Zoho-source row → operator picked a merchant (storeId).
  //     Straight customer_merchant_links insert + backfill.
  const handleLinkConfirm = async (picked) => {
    if (!linkTarget) return;
    try {
      if (linkTarget.source === 'internal') {
        // picked = { rawName, existingStoreId? } for a Zoho candidate.
        // existingStoreId is set when the picked Zoho row is already
        // anchored on a merchant — we reuse it instead of creating
        // a fresh anchor, so the internal row joins that pair.
        const r = await linkInternalRowToZohoRow({
          internalRawName: linkTarget.rawName,
          zohoRawName:     picked.rawName,
          existingStoreId: picked.existingStoreId || null,
          userId:          profile?.id || null,
        });
        // Three outcomes:
        //   reusedExisting → joined an existing pair anchored on
        //                    a merchant (most common case after the
        //                    operator already linked the Zoho side).
        //   syntheticAnchor → no merchant exists, fresh pair on a
        //                     manual:<uuid> anchor.
        //   else            → new pair on a fuzzy-matched merchant.
        let tail;
        if (r.reusedExisting)        tail = ` (انضمّ للمتجر ${r.storeName || r.storeId})`;
        else if (r.syntheticAnchor)  tail = ' (بدون متجر في الكشف — ربط يدوي)';
        else                          tail = ` (المتجر ${r.storeName || r.storeId})`;
        toast(`تم اقتران «${linkTarget.rawName}» بـ «${picked.rawName}»${tail}`, 'success');
      } else {
        // picked = { storeId } for a merchant candidate
        await linkUnmatchedToStore({
          rawName: linkTarget.rawName,
          storeId: picked.storeId,
          userId:  profile?.id || null,
        });
        toast(`تم ربط «${linkTarget.rawName}» بالمتجر ${picked.storeId}`, 'success');
      }
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
    () => onlyGaps ? enriched.filter(r => r.action?.kind !== 'matched') : enriched,
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
        title="مطابقة الأرصدة"
        subtitle={tab === 'customers'
          ? 'العملاء — قارن من 3 مصادر: النظام الداخلي · الفواتير · Zoho'
          : 'الموردون — قارن أرصدة شركات الشحن في نظامنا مقابل Zoho'}
        actions={
          <Btn size="sm" variant="ghost" icon={<RefreshCw size={13}/>} onClick={refresh}>
            تحديث
          </Btn>
        }
      />

      {/* Tab switcher: customers vs vendors */}
      <div style={{
        display: 'flex', gap: 4, marginBottom: 18,
        borderBottom: '1px solid var(--border)',
      }}>
        {[
          { id: 'customers', label: 'العملاء (المتاجر)', icon: '🏪' },
          { id: 'vendors',   label: 'الموردون (شركات الشحن)', icon: '🚚' },
        ].map(t => {
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: '10px 18px',
              border: 'none', background: 'transparent',
              borderBottom: `2.5px solid ${active ? '#8B5CF6' : 'transparent'}`,
              color: active ? 'var(--text)' : 'var(--muted)',
              fontSize: 13, fontWeight: active ? 700 : 500,
              fontFamily: 'var(--font-sans)', cursor: 'pointer',
              transition: 'all .15s', marginBottom: -1,
            }}>
              {t.icon} {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'vendors' && <VendorsTab profile={profile}/>}
      {tab === 'customers' && <>

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
      {unmatchedWithBalance.length > 0 && (
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
              غير مرتبط بمتاجر النظام — {unmatchedWithBalance.length} صف
            </span>
            <span style={{ fontSize: 11, color: '#B45309', fontWeight: 600 }}>
              ({unmatchedWithBalance.filter(u => u.source === 'internal').length} من الداخلي ·{' '}
              {unmatchedWithBalance.filter(u => u.source === 'zoho').length} من Zoho)
            </span>
            <span style={{
              marginInlineStart: 'auto', fontSize: 11.5, color: 'var(--text2)',
            }}>
              مجموع الأرصدة المخفية:&nbsp;
              <strong style={{
                fontFamily: 'var(--font-mono)',
                color: unmatchedWithBalance.reduce((s, u) => s + Math.abs(u.balance), 0) > 0 ? '#DC2626' : 'var(--muted)',
              }}>
                {fmt(unmatchedWithBalance.reduce((s, u) => s + Math.abs(u.balance), 0))} ر.س
              </strong>
            </span>
            <Btn
              size="sm"
              variant="primary"
              icon={autolinkBusy ? <Spinner size={12}/> : <Zap size={12}/>}
              onClick={runAutolinkExactName}
              disabled={autolinkBusy}
              title="يربط كل صف اسمه مطابق أو متضمَّن في اسم متجر بالكشف (يشتغل تلقائياً عند فتح الصفحة — استعمله للتحديث)"
              style={{ background: '#10B981', borderColor: '#10B981' }}
            >
              {autolinkBusy ? 'جارٍ الربط…' : 'إعادة فحص الربط التلقائي'}
            </Btn>
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
              {unmatchedWithBalance.map(u => (
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

      </>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Vendor reconciliation tab — symmetric to the customer one but
// against carriers (شركات الشحن) instead of merchants. Internal
// data comes from our carrier_operations open balance directly
// (no upload needed); operator only uploads the Zoho vendor file.
// ─────────────────────────────────────────────────────────────
function VendorsTab({ profile }) {
  const [loading, setLoading]       = useState(true);
  const [reconcile, setReconcile]   = useState([]);
  const [others, setOthers]         = useState([]);
  const [snapshots, setSnapshots]   = useState([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [r, o, s] = await Promise.all([
        loadVendorReconciliation().catch(() => []),
        loadVendorOthers().catch(() => []),
        listVendorSnapshots().catch(() => []),
      ]);
      setReconcile(r);
      setOthers(o);
      setSnapshots(s);
    } catch (e) {
      toast(`فشل التحميل: ${e.message}`, 'error');
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleUpload = async (file) => {
    try {
      const buffer = await file.arrayBuffer();
      const wb     = XLSX.read(buffer, { type: 'array', cellDates: true });
      const ws     = wb.Sheets[wb.SheetNames[0]];
      const rows   = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
      const parsed = parseZohoVendorBalances(rows);
      if (parsed.errors.length) { toast(parsed.errors.join('\n'), 'error'); return; }
      if (!parsed.rows.length)  { toast('لا توجد صفوف صالحة', 'warning'); return; }
      const result = await uploadVendorBalanceSnapshot({
        parsed:   parsed.rows,
        fileName: file.name,
        userId:   profile?.id || null,
      });
      toast(
        `تم رفع ${result.rowCount} مورّد · ${result.matched} مطابق بشركات الشحن · علينا ${fmt(result.totalWeOwe)} ر.س`,
        'success',
      );
      await refresh();
    } catch (e) { toast(`فشل: ${e.message}`, 'error'); }
  };

  const latestSnap = snapshots[0];
  const handleDelete = async () => {
    if (!latestSnap) return;
    if (!confirm('حذف آخر تحميل لـ Zoho الموردين؟')) return;
    try { await deleteVendorSnapshot(latestSnap.id); toast('تم الحذف', 'success'); await refresh(); }
    catch (e) { toast(`فشل: ${e.message}`, 'error'); }
  };

  // Vendors don't have a "reference" upload like the customer side
  // does — the carrier_operations open balance is sparse and not
  // authoritative. So this tab is no longer a reconciliation; it's
  // an enriched view of Zoho's vendor balances mapped to our
  // carriers. Each row is a directional label only:
  //   Zoho > 0  → "لهم" (we owe them)
  //   Zoho < 0  → "لنا" (they owe us)
  //   Zoho = 0  → "صفر"
  const stats = useMemo(() => {
    let we_owe = 0, they_owe = 0, zero = 0, we_owe_sum = 0, they_owe_sum = 0;
    for (const r of reconcile) {
      const v = r.zohoBalance;
      if (Math.abs(v) < 0.005) { zero++; }
      else if (v > 0) { we_owe++; we_owe_sum += v; }
      else            { they_owe++; they_owe_sum += Math.abs(v); }
    }
    const otherTotal = others.reduce((s, o) => s + Math.abs(o.balance), 0);
    return {
      total:        reconcile.length,
      we_owe, we_owe_sum:   +we_owe_sum.toFixed(2),
      they_owe, they_owe_sum: +they_owe_sum.toFixed(2),
      zero,
      otherCount:   others.length,
      otherTotal:   +otherTotal.toFixed(2),
    };
  }, [reconcile, others]);

  const exportAll = () => {
    if (!reconcile.length) { toast('لا توجد بيانات', 'info'); return; }
    const headers = ['رقم الشركة', 'اسم الشركة', 'الأسماء في Zoho', 'الرصيد في Zoho', 'الاتجاه'];
    const xRows = reconcile.map(r => {
      const v = r.zohoBalance;
      const dir = Math.abs(v) < 0.005 ? 'صفر' : v > 0 ? 'لهم (ندفع)' : 'لنا (يردّون)';
      return [r.carrierId, r.carrierName, (r.zohoRawNames || []).join(' / '), v, dir];
    });
    const ws = XLSX.utils.aoa_to_sheet([headers, ...xRows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'موردو_Zoho');
    XLSX.writeFile(wb, `موردو_Zoho_${new Date().toISOString().slice(0,10)}.xlsx`);
    toast(`تم تصدير ${reconcile.length} مورّد`, 'success');
  };

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner size={22}/></div>;
  }

  return (
    <div>
      {/* Upload card — single, since internal vendor balance comes from our DB */}
      <div style={{ marginBottom: 20 }}>
        <UploadCard
          title="Zoho — ملخص أرصدة الموردين"
          subtitle="Reports → الذمم الدائنة → ملخص أرصدة الموردين. Cr = ندفع لهم · Dr = يردّون لنا"
          color="#F59E0B"
          icon={<FileSpreadsheet size={18}/>}
          snapshot={latestSnap}
          onUpload={handleUpload}
          onDelete={handleDelete}
          noun="مورّد"
        />
      </div>

      {reconcile.length === 0 && others.length === 0 ? (
        <Empty
          icon="🚚"
          title="ارفع ملف Zoho الموردين لتبدأ"
          sub="كل مورّد يُربط بشركة شحن في نظامنا، ونعرض رصيده بالاتجاه: لهم / لنا / صفر."
        />
      ) : (
        <>
          {/* Banner — explains the directional view */}
          <Card style={{
            marginBottom: 14,
            background: 'color-mix(in srgb, #0EA5E9 6%, transparent)',
            border: '1px solid color-mix(in srgb, #0EA5E9 22%, transparent)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Info size={16} color="#0EA5E9" style={{ flexShrink: 0 }}/>
              <div style={{ fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.7 }}>
                هذي قائمة الموردين كما يراها Zoho. الاتجاه فقط:&nbsp;
                <strong style={{ color: '#DC2626' }}>لهم</strong> = ندفع لهم ·&nbsp;
                <strong style={{ color: '#047857' }}>لنا</strong> = يردّون لنا ·&nbsp;
                <strong style={{ color: 'var(--muted)' }}>صفر</strong> = منتهية. لا توجد مقارنة مرجعية لأن نظامنا لا يحتفظ بكشف موردين موازٍ.
              </div>
            </div>
          </Card>

          {/* Stats strip */}
          <Card style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
              <Stat label="شركات شحن"        value={stats.total.toLocaleString('ar-SA')} color="#0EA5E9"/>
              <Stat label="لهم (ندفع)"       value={stats.we_owe.toLocaleString('ar-SA')} suffix={`(${fmtCompact(stats.we_owe_sum)})`} color="#DC2626"/>
              <Stat label="لنا (يردّون)"     value={stats.they_owe.toLocaleString('ar-SA')} suffix={`(${fmtCompact(stats.they_owe_sum)})`} color="#047857"/>
              <Stat label="صفر"              value={stats.zero.toLocaleString('ar-SA')} color="var(--muted)"/>
              <Stat label="مورّدون آخرون"    value={stats.otherCount.toLocaleString('ar-SA')} suffix={`(${fmtCompact(stats.otherTotal)})`} color="#8B5CF6"/>
              <Btn size="sm" variant="ghost" icon={<Download size={13}/>} onClick={exportAll} disabled={!reconcile.length} style={{ marginInlineStart: 'auto' }}>
                تصدير الكل
              </Btn>
            </div>
          </Card>

          {/* Main vendor table — directional only, no reconciliation */}
          {reconcile.length > 0 && (
            <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                    <th style={thStyle}>الشركة</th>
                    <th style={thStyle}>رصيد Zoho</th>
                    <th style={thStyle}>الاتجاه</th>
                    <th style={thStyle}>أسماء Zoho المُجَمَّعة</th>
                  </tr>
                </thead>
                <tbody>
                  {reconcile.map(r => {
                    const v = r.zohoBalance;
                    const isZero = Math.abs(v) < 0.005;
                    return (
                      <tr key={r.carrierId} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--text)' }}>
                          {r.carrierName}
                          <div style={{ fontSize: 10, color: 'var(--muted2)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                            {r.carrierId}
                          </div>
                        </td>
                        <td style={{
                          padding: '10px 12px', textAlign: 'left',
                          fontFamily: 'var(--font-mono)', fontWeight: 700,
                          color: isZero ? 'var(--muted2)' : v > 0 ? '#DC2626' : '#047857',
                        }}>
                          {isZero ? '—' : fmt(Math.abs(v))}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          {isZero ? (
                            <span style={statusPill('var(--muted)')}>صفر</span>
                          ) : v > 0 ? (
                            <span style={statusPill('#DC2626')}>
                              ⬆ لهم {fmtCompact(v)} ر.س
                            </span>
                          ) : (
                            <span style={statusPill('#047857')}>
                              ⬇ لنا {fmtCompact(Math.abs(v))} ر.س
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: 10.5, color: 'var(--muted)' }}>
                          {(r.zohoRawNames || []).join(' / ') || '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          )}

          {/* Other vendors (non-carriers) — informational only */}
          {others.length > 0 && (
            <Card style={{
              padding: 0, overflow: 'hidden', marginBottom: 16,
              border: '1.5px solid color-mix(in srgb, #8B5CF6 30%, transparent)',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '12px 16px',
                background: 'color-mix(in srgb, #8B5CF6 8%, transparent)',
                borderBottom: '1px solid var(--border)',
              }}>
                <FileSpreadsheet size={15} color="#8B5CF6"/>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                  مصاريف أخرى من Zoho — {others.length} مورّد
                </span>
                <span style={{ marginInlineStart: 'auto', fontSize: 11.5, color: 'var(--text2)' }}>
                  ليست شركات شحن — معروضة للعلم بدون مقارنة
                </span>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                    <th style={thStyle}>#</th>
                    <th style={thStyle}>اسم المورّد</th>
                    <th style={thStyle}>الرصيد</th>
                    <th style={thStyle}>الاتجاه</th>
                  </tr>
                </thead>
                <tbody>
                  {others.map(o => (
                    <tr key={o.rawName} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px 12px', color: 'var(--muted2)', fontSize: 10, fontFamily: 'var(--font-mono)' }}>{o.rank}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--text)' }}>{o.rawName}</td>
                      <td style={{
                        padding: '10px 12px', textAlign: 'left',
                        fontFamily: 'var(--font-mono)', fontWeight: 700,
                        color: o.balance < 0 ? '#047857' : '#DC2626',
                      }}>
                        {fmt(Math.abs(o.balance))}
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 11 }}>
                        {o.balance > 0
                          ? <span style={statusPill('#DC2626')}>ندفع لهم</span>
                          : <span style={statusPill('#10B981')}>يردّون لنا</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ── subcomponents ─────────────────────────────────────────────
function UploadCard({ title, subtitle, color, icon, snapshot, onUpload, onDelete, noun = 'متجر' }) {
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
                {snapshot.row_count} {noun} · {snapshot.matched_count} مطابق
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

// Source-aware picker:
//   target.source === 'internal' → operator is linking a Lamha row.
//     Candidates = UNMATCHED Zoho rows (the missing other side).
//     onConfirm(picked) called with { rawName }. The page-level
//     handler then fuzzy-matches the internal name to a merchant
//     to anchor both rows on a store_id.
//   target.source === 'zoho' → operator is linking a Zoho row.
//     Candidates = Lamha merchants NOT already linked to anyone.
//     onConfirm(picked) called with { storeId, storeName }.
//
// In both modes already-linked candidates are hidden — the picker
// only ever shows fresh pairings.
// Excel export for the picker — dumps every unlinked candidate so
// the operator can work on the backlog outside the app. Two shapes:
//   • pickingZoho=true  → Zoho candidates: name + balance + match method
//   • pickingZoho=false → Lamha merchants: storeId + name + phone + status
// The file name reflects which side was being browsed.
function exportCandidates(list, pickingZoho) {
  if (!list?.length) return;
  let headers, rows, sheetName, fileBase;
  if (pickingZoho) {
    headers = ['الاسم في Zoho', 'الرصيد (ر.س)', 'طريقة المطابقة'];
    rows    = list.map(c => [c.rawName, Number(c.balance) || 0, c.method || '—']);
    sheetName = 'عملاء_Zoho_غير_المربوطين';
    fileBase  = 'عملاء_Zoho_غير_المربوطين';
  } else {
    headers = ['رقم المتجر', 'اسم المتجر', 'الجوال', 'الحالة'];
    rows    = list.map(m => [m.storeId, m.storeName, m.phone || '', m.status || '']);
    sheetName = 'متاجر_لمحة_غير_المربوطة';
    fileBase  = 'متاجر_لمحة_غير_المربوطة';
  }
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  // RTL view + auto column widths sized to the longest cell.
  ws['!cols'] = headers.map((h, i) => {
    const longest = Math.max(
      String(h).length,
      ...rows.map(r => String(r[i] ?? '').length),
    );
    return { wch: Math.min(40, longest + 2) };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const dateStr = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${fileBase}_${dateStr}.xlsx`);
  toast(`✓ تم تصدير ${list.length} سجل`, 'success');
}

function MerchantPickerModal({ target, onCancel, onConfirm }) {
  // We're picking from the OPPOSITE source.
  const pickingZoho = target.source === 'internal';
  const [candidates, setCandidates] = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [search,     setSearch]     = useState('');
  const [picked,     setPicked]     = useState(null);

  useEffect(() => {
    setLoading(true);
    const loader = pickingZoho
      ? loadUnmatchedZohoForPicker()        // Zoho candidates for an internal row
      // Hide already-linked merchants from the picker by default —
      // the auto-linker handles substring matches now, so what's
      // left in this picker is genuinely orphaned. Operator can
      // still see the linked list via the export button.
      : loadMerchantsForPicker({ includeLinked: false });
    loader
      .then(setCandidates)
      .catch((e) => toast(`فشل التحميل: ${e.message}`, 'error'))
      .finally(() => setLoading(false));
  }, [pickingZoho]);

  // Auto-suggest top-similarity candidates by normalized-substring
  // overlap with the target's raw_name. Works for either side.
  const suggested = useMemo(() => {
    const norm = (s) => String(s || '').toLowerCase()
      .replace(/[ًٌٍَُِّْٰ]/g, '')
      .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
    const segs = String(target.rawName || '').split(/[-|]/).map(s => norm(s.trim())).filter(s => s.length >= 2);
    if (!segs.length || !candidates.length) return [];
    const labelOf = (c) => pickingZoho ? c.rawName : c.storeName;
    return candidates.map(c => {
      const mn = norm(labelOf(c));
      let score = 0;
      for (const seg of segs) {
        if (mn === seg)            score = Math.max(score, 1.0);
        else if (mn.includes(seg)) score = Math.max(score, Math.min(seg.length, mn.length) / Math.max(seg.length, mn.length));
        else if (seg.includes(mn)) score = Math.max(score, Math.min(seg.length, mn.length) / Math.max(seg.length, mn.length));
      }
      return { ...c, _score: score };
    }).filter(c => c._score > 0.3).sort((a, b) => b._score - a._score).slice(0, 5);
  }, [candidates, target, pickingZoho]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (pickingZoho) {
      if (!q) return candidates.slice(0, 100);
      return candidates.filter(c => String(c.rawName || '').toLowerCase().includes(q)).slice(0, 100);
    }
    if (!q) return candidates.slice(0, 100);
    return candidates.filter(m =>
      String(m.storeName || '').toLowerCase().includes(q) ||
      String(m.storeId   || '').toLowerCase().includes(q) ||
      String(m.phone     || '').toLowerCase().includes(q),
    ).slice(0, 100);
  }, [candidates, search, pickingZoho]);

  const isPickedSame = (c) => pickingZoho
    ? picked?.rawName === c.rawName
    : picked?.storeId === c.storeId;
  const pickedLabel = picked && (pickingZoho ? picked.rawName : picked.storeName);
  const confirmDisabled = !picked;
  const dialogTitle = pickingZoho
    ? `ربط مع نظير في Zoho: ${target.rawName}`
    : `ربط بمتجر لمحة: ${target.rawName}`;
  const candidateSourceLabel = pickingZoho
    ? 'يعرض كل عملاء Zoho — المربوط منهم سيظهر بشارة'
    : 'يعرض متاجر لمحة التي لم تُربط بعد';

  return (
    <Modal title={dialogTitle} onClose={onCancel} width={680}>
      <form
        autoComplete="off"
        onSubmit={(e) => { e.preventDefault(); if (picked) onConfirm(picked); }}
        style={{ padding: '4px 4px 0' }}
      >
        {/* Source + balance banner */}
        <div style={{
          padding: 12, marginBottom: 12, borderRadius: 8,
          background: target.source === 'internal'
            ? 'color-mix(in srgb, #3B82F6 8%, transparent)'
            : 'color-mix(in srgb, #F59E0B 8%, transparent)',
          border: '1px solid var(--border)',
          fontSize: 12, color: 'var(--text2)', display: 'flex', gap: 12, flexWrap: 'wrap',
        }}>
          <span>
            <strong style={{ color: 'var(--text)' }}>المصدر:</strong>{' '}
            {target.source === 'internal' ? 'النظام الداخلي (لمحة)' : 'Zoho'}
          </span>
          {Math.abs(target.balance) > 0.005 && (
            <span>
              <strong style={{ color: 'var(--text)' }}>الرصيد:</strong>{' '}
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: target.balance < 0 ? '#DC2626' : 'var(--text2)' }}>
                {fmt(target.balance)} ر.س
              </span>
            </span>
          )}
          <span style={{ marginInlineStart: 'auto', color: 'var(--muted)', fontSize: 11 }}>
            {candidateSourceLabel}
          </span>
        </div>

        {/* Suggested matches */}
        {suggested.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, marginBottom: 6 }}>
              اقتراحات تلقائية
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {suggested.map(c => {
                return (
                  <button key={pickingZoho ? c.rawName : c.storeId} type="button" onClick={() => onConfirm(c)} style={{
                    padding: '6px 12px', borderRadius: 999, cursor: 'pointer',
                    border: '1.5px solid var(--border)',
                    background: 'transparent',
                    color: 'var(--text2)',
                    fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-sans)',
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    transition: 'all .12s',
                  }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(16,185,129,.12)';
                      e.currentTarget.style.borderColor = '#10B981';
                      e.currentTarget.style.color = '#047857';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.borderColor = 'var(--border)';
                      e.currentTarget.style.color = 'var(--text2)';
                    }}
                  >
                    {pickingZoho ? c.rawName : c.storeName}
                    <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                      {pickingZoho ? '' : `#${c.storeId} · `}{Math.round(c._score * 100)}%
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Search + export. The export dumps the FULL candidates list
            (not just the filtered view) so the operator can work on
            the unlinked set in Excel — useful when there are hundreds
            of unlinked merchants to clean up. */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'stretch' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={14} style={{ position: 'absolute', insetInlineStart: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }}/>
            <input
              type="text"
              name="picker_search"
              autoComplete="off"
              spellCheck={false}
              data-form-type="other"
              data-lpignore="true"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={pickingZoho
                ? 'ابحث في عملاء Zoho…'
                : 'ابحث باسم المتجر أو رقمه أو الجوال…'}
              style={{
                width: '100%', padding: '9px 12px 9px 34px', fontSize: 13,
                border: '1px solid var(--border)', borderRadius: 8,
                background: 'var(--surface)', color: 'var(--text)',
                fontFamily: 'var(--font-sans)', boxSizing: 'border-box',
              }}
            />
          </div>
          <Btn
            size="sm"
            variant="ghost"
            type="button"
            icon={<Download size={13}/>}
            onClick={() => exportCandidates(candidates, pickingZoho)}
            disabled={loading || !candidates.length}
            title="تصدير القائمة كاملة إلى Excel"
          >
            تصدير ({candidates.length})
          </Btn>
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
              {pickingZoho
                ? (search
                    ? `لا توجد نتائج لـ «${search}»`
                    : 'لا توجد عملاء Zoho — ارفع ملف Zoho أحدث')
                : (search
                    ? `لا توجد نتائج لـ «${search}»`
                    : 'كل المتاجر مربوطة بالفعل — لا يوجد متاجر لمحة جديدة لربطها')}
            </div>
          ) : pickingZoho ? (
            filtered.map(c => {
              const isLinked = !!c.existingStoreId;
              // One-click: clicking the row IS the link. The
              // bottom "اربط بـ" button stays as a redundancy in
              // case the operator wants to scan + select before
              // committing — they can still set picked via keyboard.
              return (
                <div key={c.rawName} onClick={() => onConfirm(c)} style={{
                  padding: '10px 14px', cursor: 'pointer',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', gap: 12,
                  transition: 'background .12s',
                }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'color-mix(in srgb, #10B981 8%, transparent)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span>{c.rawName}</span>
                      {isLinked && (
                        <span title={`مرتبط بالمتجر ${c.existingStoreId}`} style={{
                          fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
                          background: 'color-mix(in srgb, #3B82F6 14%, transparent)',
                          color: '#1D4ED8', fontFamily: 'var(--font-mono)',
                        }}>
                          🔗 مرتبط بـ #{c.existingStoreId}
                        </span>
                      )}
                    </div>
                    {Math.abs(c.balance) > 0.005 && (
                      <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                        رصيد Zoho: {fmt(c.balance)} ر.س
                      </div>
                    )}
                  </div>
                  <span style={{
                    fontSize: 11, color: '#10B981', fontWeight: 700,
                    fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap',
                    display: 'flex', alignItems: 'center', gap: 4,
                  }}>
                    <Link2 size={12}/>
                    اربط
                  </span>
                </div>
              );
            })
          ) : (
            filtered.map(m => {
              return (
                <div key={m.storeId} onClick={() => onConfirm(m)} style={{
                  padding: '10px 14px', cursor: 'pointer',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', gap: 12,
                  transition: 'background .12s',
                }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'color-mix(in srgb, #10B981 8%, transparent)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.storeName}</span>
                      {m.isLinked && (
                        <span title="هذا المتجر مربوط بصف آخر بالفعل — اضغطه ليُضمّ صف Zoho هذا للزوج الموجود" style={{
                          fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
                          background: 'color-mix(in srgb, #3B82F6 14%, transparent)',
                          color: '#1D4ED8', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap',
                        }}>
                          🔗 مربوط بالفعل
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2, fontFamily: 'var(--font-mono)', direction: 'ltr', textAlign: 'right' }}>
                      #{m.storeId} {m.phone ? `· ${m.phone}` : ''} {m.status ? `· ${m.status}` : ''}
                    </div>
                  </div>
                  <span style={{
                    fontSize: 11, color: '#10B981', fontWeight: 700,
                    fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap',
                    display: 'flex', alignItems: 'center', gap: 4,
                  }}>
                    <Link2 size={12}/>
                    اربط
                  </span>
                </div>
              );
            })
          )}
        </div>

        <div style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
            💡 اضغط على أي صف للربط مباشرة
          </div>
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

// "مطابقة أرصدة المتاجر" — reconciliation workspace:
//   1. Internal platform export (استحقاق المتاجر)
//   2. Zoho Books API live balances
//   3. Our customer_receivables (auto, no Zoho upload needed)
//
// Each row in the result table shows the same store from all three
// angles + the largest pairwise discrepancy. Rows sort by max diff
// desc so the worst mismatches surface first — that's where the
// operator's attention is needed.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { rtl } from '../lib/xlsxRtl.js';
import {
  RefreshCw, Upload, Download, Trash2, AlertTriangle, CheckCircle2,
  Scale, Info, ChevronLeft, FileSpreadsheet, Link2, Search, X, Zap,
} from 'lucide-react';
import {
  Card, Btn, Spinner, Empty, Modal, toast, PageHeader, DropZone,
} from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  parseInternalSettlement,
  uploadBalanceSnapshot, listBalanceSnapshots, deleteBalanceSnapshot,
  loadReconciliation,
  loadUnmatchedBalances, linkUnmatchedToStore, loadMerchantsForPicker,
  loadUnmatchedZohoForPicker, linkInternalRowToZohoRow,
  autolinkBalancesByExactName,
  loadCustomerBalanceRecon,
  loadVendorReconciliation, loadVendorOthers,
  loadTreasuryBalances,
} from '../lib/reconciliationService.js';

const fmt = (n) =>
  n == null || Number.isNaN(n) ? '—'
  : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtCompact = (n) => {
  if (n == null || Number.isNaN(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1_000_000) return (n >= 0 ? '+' : '−') + (a / 1_000_000).toFixed(2) + 'م';
  if (a >= 1_000)     return (n >= 0 ? '+' : '−') + (a / 1_000).toFixed(1) + 'ك';
  return (n >= 0 ? '+' : n === 0 ? '' : '−') + a.toFixed(0);
};
const fmtDateTime = (iso) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }); }
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
  const [tab, setTab]               = useState(() => new URLSearchParams(location.search).get('tab') || 'zoho_live');
  const [autolinkBusy, setAutolinkBusy] = useState(false);

  useEffect(() => {
    const wanted = new URLSearchParams(location.search).get('tab');
    if (wanted && ['zoho_live', 'customers', 'vendors'].includes(wanted) && wanted !== tab) {
      setTab(wanted);
    }
  }, [location.search, tab]);

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
    // If the store IS in the settlement file (internalRawName set), use that
    // value even when it's 0. Fall back to receivables only for stores
    // completely absent from the settlement file.
    const internalPresent = r.internalRawName != null;
    const anchor = (internalPresent || hasInternal) ? r.internal
                 : hasReceivables ? r.receivables
                 : 0;
    const anchorSource = (internalPresent || hasInternal) ? 'internal'
                      : hasReceivables ? 'receivables'
                      : 'none';
    const zohoGap = r.zoho - anchor;   // Zoho minus internal
    const matched = Math.abs(zohoGap) <= tolerance;
    let action;
    if (matched) {
      action = { kind: 'matched', label: 'مطابق', color: 'var(--green)' };
    } else if (zohoGap < 0) {
      // Zoho < internal → Zoho is missing entries the internal system has.
      // The platform didn't push these to Zoho yet.
      action = { kind: 'zoho_missing', label: `أضف ${fmtCompact(Math.abs(zohoGap))} في Zoho`, color: 'var(--red)' };
    } else {
      // Zoho > internal → Zoho has an entry the internal system doesn't reflect.
      // Usually a duplicate or unmatched payment in Zoho.
      action = { kind: 'zoho_extra', label: `راجع زيادة ${fmtCompact(Math.abs(zohoGap))} في Zoho`, color: '#F97316' };
    }
    return { ...r, anchor, anchorSource, zohoGap, matched, action };
  }), [reconcile, tolerance]);

  // Headline stats from the enriched rows
  const stats = useMemo(() => {
    let matched = 0, zohoMissing = 0, zohoExtra = 0, gapTotal = 0;
    for (const r of enriched) {
      if (r.matched) matched++;
      else if (r.action.kind === 'zoho_missing') { zohoMissing++; gapTotal += Math.abs(r.zohoGap); }
      else if (r.action.kind === 'zoho_extra')   { zohoExtra++;   gapTotal += Math.abs(r.zohoGap); }
    }
    return {
      total:    enriched.length,
      matched,
      zohoMissing,
      zohoExtra,
      gapTotal: +gapTotal.toFixed(2),
    };
  }, [enriched]);

  const visible = useMemo(
    () => onlyGaps ? enriched.filter(r => r.action?.kind !== 'matched') : enriched,
    [enriched, onlyGaps],
  );

  const latestInternal = snapshots.find(s => s.source === 'internal');

  // ── upload handlers ──
  const handleUpload = async (file) => {
    try {
      const buffer = await file.arrayBuffer();
      const wb     = XLSX.read(buffer, { type: 'array', cellDates: true });
      const ws     = wb.Sheets[wb.SheetNames[0]];
      const rows   = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
      const parsed = parseInternalSettlement(rows);
      if (parsed.errors.length) { toast(parsed.errors.join('\n'), 'error'); return; }
      if (!parsed.rows.length)  { toast('لا توجد صفوف صالحة في الملف', 'warning'); return; }
      const result = await uploadBalanceSnapshot({
        source:   'internal',
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

  const handleDeleteSnapshot = async (id) => {
    if (!confirm('حذف آخر تحميل داخلي؟')) return;
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
    XLSX.writeFile(rtl(wb), `تصحيحات_Zoho_${dateStr}.xlsx`);
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
    <div style={{ padding: '24px 28px 80px', maxWidth: 1320, margin: '0 auto' }}>
      <PageHeader
        icon={<Scale size={22}/>}
        iconColor="#8B5CF6"
        title="مطابقة الأرصدة"
        subtitle={tab === 'customers'
          ? 'العملاء — قارن رصيد النظام الداخلي مقابل Zoho'
          : tab === 'zoho_live'
          ? 'العملاء — فواتير زوهو الحيّة (المرجع) مقابل آخر استحقاق لمحة'
          : 'شركات الشحن — قارن أرصدتها في نظامنا مقابل زوهو'}
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
          { id: 'zoho_live', label: 'العملاء — زوهو API', icon: '⚡' },
          { id: 'customers', label: 'مطابقة لمحة الداخلية', icon: '🏪' },
          { id: 'vendors',   label: 'شركات الشحن — زوهو', icon: '🚚' },
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

      {tab === 'vendors' && <VendorsTab/>}
      {tab === 'zoho_live' && <ZohoLiveTab isActive={isActive}/>}
      {tab === 'customers' && <>

      {/* توضيح المصدرين: الداخلي كشف مرفوع يتجمد بين الرفعات · زوهو حي من API */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        background: 'color-mix(in srgb, #8B5CF6 7%, transparent)',
        border: '1px solid color-mix(in srgb, #8B5CF6 25%, transparent)',
        borderRadius: 10, padding: '9px 14px', marginBottom: 14, fontSize: 12.5,
      }}>
        <span>⚡ عمود <b>زوهو حي من الـAPI</b> (لا رفع له) · عمود <b>الداخلي</b> = آخر ملف «استحقاق المتاجر» مرفوع — يتجمد حتى الرفعة التالية.</span>
      </div>

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
          onUpload={handleUpload}
          onDelete={() => handleDeleteSnapshot(latestInternal.id)}
        />
        <Card style={{
          border: '1px solid color-mix(in srgb, #0EA5E9 24%, var(--border))',
          background: 'linear-gradient(135deg, color-mix(in srgb, #0EA5E9 7%, var(--surface)), var(--surface))',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{
              width: 38, height: 38, borderRadius: 10,
              background: 'color-mix(in srgb, #0EA5E9 14%, transparent)',
              color: '#0EA5E9', display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <Zap size={18}/>
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>زوهو من API فقط</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3, lineHeight: 1.6 }}>
                لا يوجد رفع Customer Balances من Excel. استخدم تبويب “العملاء — زوهو API” للمطابقة الحيّة.
              </div>
            </div>
          </div>
        </Card>
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
            <Stat label="إجمالي المتاجر"  value={stats.total.toLocaleString('en-US')}        color="#0EA5E9"/>
            <Stat label="مطابق"           value={stats.matched.toLocaleString('en-US')}      color="var(--green)" icon={<CheckCircle2 size={14}/>}/>
            <Stat label="ناقص في زوهو"      value={stats.zohoMissing.toLocaleString('en-US')}  color="var(--red)" icon={<AlertTriangle size={14}/>}/>
            <Stat label="زائد في زوهو"      value={stats.zohoExtra.toLocaleString('en-US')}    color="#F97316"/>
            <Stat label="مجموع الفروقات" value={fmt(stats.gapTotal)} suffix="ر.س"           color="var(--red)"/>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginInlineStart: 'auto' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--muted)', cursor: 'pointer' }}>
                <input type="checkbox" checked={onlyGaps} onChange={e => setOnlyGaps(e.target.checked)} style={{ accentColor: 'var(--red)' }}/>
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
          border: '1.5px solid color-mix(in srgb, var(--gold) 35%, transparent)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '12px 16px',
            background: 'color-mix(in srgb, var(--gold) 10%, transparent)',
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
                color: unmatchedWithBalance.reduce((s, u) => s + Math.abs(u.balance), 0) > 0 ? 'var(--red)' : 'var(--muted)',
              }}>
                {fmt(unmatchedWithBalance.reduce((s, u) => s + Math.abs(u.balance), 0))} ر.س
              </strong>
            </span>
            <Btn
              size="sm"
              variant="accent"
              icon={autolinkBusy ? <Spinner size={12}/> : <Zap size={12}/>}
              onClick={runAutolinkExactName}
              disabled={autolinkBusy}
              title="يربط كل صف اسمه مطابق أو متضمَّن في اسم متجر بالكشف (يشتغل تلقائياً عند فتح الصفحة — استعمله للتحديث)"
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
                    <span style={statusPill(u.source === 'internal' ? '#3B82F6' : 'var(--gold)')}>
                      {u.source === 'internal' ? 'الداخلي' : 'Zoho'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', color: 'var(--text)', fontWeight: 500 }}>
                    {u.rawName}
                  </td>
                  <td style={{
                    padding: '10px 12px', textAlign: 'left',
                    fontFamily: 'var(--font-mono)', fontWeight: 600,
                    color: Math.abs(u.balance) > 0.5 ? 'var(--red)' : 'var(--muted2)',
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
          sub="ارفع ملف النظام الداخلي فقط. بيانات زوهو تأتي من API في التبويب الحي."
        />
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <table className="m-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                {/* 2026-07-17: عمود زوهو صار حيّاً من المرآة (RPC balance_reconciliation
                    كان يقرأ ميزان مراجعة مرفوعاً يتقادم أسابيع — «زوهو API ما عاد فيه ملفات») */}
                <th style={thStyle}>#</th>
                <th style={thStyle}>المتجر</th>
                <th style={{...thStyle, color: '#3B82F6'}}>الداخلي (استحقاق المتاجر — المرجع)</th>
                <th style={{...thStyle, color: '#8B5CF6'}}>⚡ زوهو (حي من API)</th>
                <th style={thStyle}>الفرق</th>
                <th style={thStyle}>الإجراء</th>
              </tr>
            </thead>
            <tbody>
              {visible.slice(0, 500).map((r, i) => (
                <tr key={r.storeId} style={{
                  borderBottom: '1px solid var(--border)',
                  background: r.matched ? 'transparent' : 'color-mix(in srgb, var(--red) 3%, transparent)',
                }}>
                  <td data-label="" style={{ padding: '10px 12px', color: 'var(--muted2)', fontSize: 10, fontFamily: 'var(--font-mono)' }}>{i + 1}</td>
                  <td data-label="" style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--text)' }}>
                    {r.storeName}
                    <div style={{ fontSize: 10, color: 'var(--muted2)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                      {r.storeId}
                    </div>
                  </td>
                  <BalCell value={r.anchor} anchor label="الداخلي (المرجع)"/>
                  <BalCell value={r.zoho} dimmedIfZero label="Zoho"/>
                  <td data-label="Zoho − الداخلي" style={{
                    padding: '10px 12px', textAlign: 'left',
                    fontFamily: 'var(--font-mono)', fontWeight: 700,
                    color: r.matched ? 'var(--muted)' : (r.zohoGap < 0 ? 'var(--red)' : '#F97316'),
                  }}>
                    {Math.abs(r.zohoGap) > 0.005 ? (r.zohoGap > 0 ? '+' : '−') + fmt(Math.abs(r.zohoGap)) : '—'}
                  </td>
                  <td data-label="الإجراء" style={{ padding: '10px 12px' }}>
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
              عرض أول ٥٠٠ من {visible.length.toLocaleString('en-US')} متجر — التصدير يشمل كل الفروقات
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
          المرجع = النظام الداخلي (ملف الاستحقاق).{' '}
          <strong style={{ color: 'var(--red)' }}>ناقص في زوهو</strong> = الفرق سالب → النظام الداخلي سجّل عملية لم تُرحَّل بعد إلى Zoho.{' '}
          <strong style={{ color: '#F97316' }}>زائد في زوهو</strong> = الفرق موجب → في Zoho عملية ليست في الداخلي (تحقّق من التكرار أو دفعة غير مرتبطة).{' '}
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
// ── تبويب «زوهو المرجع (حيّ)» ──────────────────────────────────────
// مطابقة بلا رفع: فواتير زوهو المفتوحة (المرآة الحيّة) مقابل آخر كشف
// مديونيات داخلي، بمرساة store_id/الاسم المطبَّع. المحفظة محور مستقل.
const RECON_STATUS_META = {
  matched:             { label: 'مطابق للهللة',      color: 'var(--green)', icon: '✓' },
  needs_investigation: { label: 'يحتاج تحقيقاً',      color: 'var(--red)',   icon: '⚠' },
  internal_only:       { label: 'رصيد قديم بلا فاتورة في زوهو', color: 'var(--gold)', icon: '◐' },
  zoho_only:           { label: 'زوهو فقط',           color: '#8B5CF6',      icon: '◑' },
};

function ZohoLiveTab({ isActive = true }) {
  const [rows, setRows]     = useState(null);
  const [q, setQ]           = useState('');
  const [st, setSt]         = useState('');

  useEffect(() => {
    if (!isActive) return;
    let live = true;
    loadCustomerBalanceRecon()
      .then(r => { if (live) setRows(r); })
      .catch(e => { toast(`فشل التحميل: ${e.message}`, 'error'); if (live) setRows([]); });
    return () => { live = false; };
  }, [isActive]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    let list = rows;
    if (st) list = list.filter(r => r.status === st);
    const s = q.trim().toLowerCase();
    if (s) list = list.filter(r =>
      [r.storeName, r.phone, ...(r.zohoNames || []), ...(r.internalNames || [])]
        .some(v => String(v ?? '').toLowerCase().includes(s)));
    return list;
  }, [rows, q, st]);

  const kpi = useMemo(() => {
    const by = (status) => (rows || []).filter(r => r.status === status);
    return {
      matched:  by('matched'),
      invest:   by('needs_investigation'),
      internal: by('internal_only'),
      zoho:     by('zoho_only'),
      zohoTot:  (rows || []).reduce((s, r) => s + r.zoho, 0),
      intTot:   (rows || []).reduce((s, r) => s + r.internal, 0),
    };
  }, [rows]);

  const exportXlsx = () => {
    if (!filtered.length) return;
    const aoa = [
      ['مطابقة أرصدة العملاء — زوهو المرجع (حيّ)', '', '', new Date().toISOString().slice(0, 10)],
      [],
      ['العميل/المتجر', 'الهاتف', 'نوع الفوترة', 'حالة المنصّة', 'زوهو (مفتوح)', 'عدد الفواتير', 'أقدم فاتورة', 'استحقاق لمحة', 'الفرق', 'رصيد لصالح العميل', 'الحالة', 'أسماء زوهو', 'أسماء الاستحقاق'],
      ...filtered.map(r => [
        r.storeName, r.phone || '', r.billingType || '', r.platformStatus || '',
        r.zoho, r.zohoOpenCnt, r.zohoOldest || '', r.internal, r.diff, r.wallet,
        RECON_STATUS_META[r.status]?.label || r.status,
        (r.zohoNames || []).join(' | '), (r.internalNames || []).join(' | '),
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 30 }, { wch: 14 }, { wch: 11 }, { wch: 10 }, { wch: 12 }, { wch: 8 }, { wch: 11 }, { wch: 12 }, { wch: 12 }, { wch: 11 }, { wch: 18 }, { wch: 34 }, { wch: 34 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'مطابقة العملاء');
    XLSX.writeFile(rtl(wb), `مطابقة_عملاء_زوهو_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast(`صُدّر ${filtered.length} عميلاً ✓`, 'success');
  };

  if (rows == null) return <Card style={{ padding: 50, textAlign: 'center' }}><Spinner size={26}/></Card>;

  return (
    <>
      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(155px,1fr))', gap: 10, marginBottom: 14 }}>
        {[
          { k: '', label: 'زوهو (المرجع)', val: kpi.zohoTot, sub: 'فواتير مفتوحة الآن', color: '#8B5CF6' },
          // عمر الكشف ظاهر على البطاقة (2026-07-17) — المستخدم ظن الرقم معطلاً
          // وهو من ملف invoice_details منقطع منذ أسبوع
          { k: '', label: 'استحقاق لمحة', val: kpi.intTot,
            sub: (() => {
              const m = rows.internalMeta;
              if (!m?.uploadedAt) return 'آخر استحقاق مرفوع';
              const days = Math.floor((Date.now() - new Date(m.uploadedAt).getTime()) / 86_400_000);
              const when = new Date(m.uploadedAt).toLocaleDateString('ar-SA', { day: 'numeric', month: 'short' });
              return `${m.sourceFile || 'كشف'} — ${when}${days >= 3 ? ` (قديم ${days} يوم ⚠️)` : ''}`;
            })(),
            color: rows.internalMeta?.uploadedAt && (Date.now() - new Date(rows.internalMeta.uploadedAt).getTime()) > 3 * 86_400_000 ? 'var(--red)' : '#3B82F6' },
          { k: 'matched', label: 'مطابق للهللة', val: kpi.matched.reduce((s, r) => s + r.zoho, 0), sub: `${kpi.matched.length} عميلاً`, color: 'var(--green)' },
          { k: 'needs_investigation', label: 'يحتاج تحقيقاً', val: kpi.invest.reduce((s, r) => s + Math.abs(r.diff), 0), sub: `${kpi.invest.length} عميل — فرق`, color: 'var(--red)' },
          { k: 'internal_only', label: 'داخلي فقط', val: kpi.internal.reduce((s, r) => s + r.internal, 0), sub: `${kpi.internal.length} — أرصدة قديمة بلا فاتورة زوهو`, color: 'var(--gold)' },
        ].map(c => (
          <button key={c.label} onClick={() => c.k && setSt(st === c.k ? '' : c.k)}
            style={{ textAlign: 'right', padding: '10px 12px', borderRadius: 10, cursor: c.k ? 'pointer' : 'default',
              background: st && st === c.k ? `color-mix(in srgb, ${c.color} 10%, var(--card))` : 'var(--card)',
              border: `1px solid ${st && st === c.k ? c.color : 'var(--border)'}` }}>
            <div style={{ fontSize: 10.5, color: 'var(--muted)', marginBottom: 3 }}>{c.label}</div>
            <div style={{ fontSize: 16.5, fontWeight: 800, fontFamily: 'var(--font-mono)', color: c.color }}>{fmt(c.val)}</div>
            <div style={{ fontSize: 10, color: 'var(--muted2)', marginTop: 2 }}>{c.sub}</div>
          </button>
        ))}
      </div>

      {/* شريط الفلاتر */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: 'absolute', right: 12, top: 9, color: 'var(--muted)' }}/>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="بحث بالعميل/المتجر/الهاتف…"
            style={{ width: '100%', padding: '8px 36px 8px 12px', borderRadius: 8, fontSize: 13 }}/>
        </div>
        <select value={st} onChange={e => setSt(e.target.value)} style={{ padding: '7px 10px', borderRadius: 8, fontSize: 12.5 }}>
          <option value="">كل الحالات</option>
          {Object.entries(RECON_STATUS_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
        </select>
        <Btn size="sm" variant="ghost" icon={<Download size={13}/>} onClick={exportXlsx} disabled={!filtered.length}>تصدير</Btn>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 8 }}>
        عرض <b style={{ color: 'var(--text)' }}>{filtered.length}</b> من {rows.length} —
        المرجع = فواتير زوهو المفتوحة الحيّة (مزامنة كل 30 دقيقة + فوري بالويبهوك) · الداخلي = آخر استحقاق لمحة مرفوع · «داخلي فقط» = في الاستحقاق بلا فاتورة زوهو
      </div>

      {/* الجدول */}
      {!filtered.length ? <Card><Empty icon="📭" title="لا نتائج" sub="جرّب فلتراً آخر"/></Card> : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div className="m-flow" style={{ maxHeight: 620, overflowY: 'auto' }}>
            <table className="m-cards" style={{ width: '100%', fontSize: 12.5 }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--surface)' }}>
                <tr>
                  {['العميل / المتجر', 'زوهو (مفتوح)', 'استحقاق لمحة', 'الفرق', 'رصيد لصالح العميل', 'الحالة'].map(h => (
                    <th key={h} style={{ padding: '10px 12px', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const m = RECON_STATUS_META[r.status] || {};
                  return (
                    <tr key={r.anchor} style={{ borderTop: '1px solid var(--border)' }}>
                      <td data-label="" style={{ padding: '9px 12px', maxWidth: 300 }}>
                        <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.storeName}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--muted2)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {r.phone && <span style={{ fontFamily: 'var(--font-mono)' }}>{r.phone}</span>}
                          {r.billingType && <span>{r.billingType}</span>}
                          {r.platformStatus && <span>{r.platformStatus}</span>}
                          {r.zohoOpenCnt > 0 && <span>{r.zohoOpenCnt} فاتورة{r.zohoOldest ? ` · أقدمها ${r.zohoOldest}` : ''}</span>}
                        </div>
                      </td>
                      <td data-label="زوهو" style={{ padding: '9px 12px', fontFamily: 'var(--font-mono)', fontWeight: 700, whiteSpace: 'nowrap', color: r.zoho > 0.5 ? 'var(--text)' : 'var(--muted2)' }}>{fmt(r.zoho)}</td>
                      <td data-label="الداخلي" style={{ padding: '9px 12px', fontFamily: 'var(--font-mono)', fontWeight: 600, whiteSpace: 'nowrap', color: r.internal ? 'var(--text)' : 'var(--muted2)' }}>{fmt(r.internal)}</td>
                      <td data-label="الفرق" style={{ padding: '9px 12px', fontFamily: 'var(--font-mono)', fontWeight: 700, whiteSpace: 'nowrap',
                        color: Math.abs(r.diff) <= 1 ? 'var(--muted2)' : r.diff > 0 ? 'var(--gold)' : 'var(--red)' }}>
                        {Math.abs(r.diff) <= 1 ? '—' : fmt(r.diff)}
                      </td>
                      <td data-label="رصيد لصالح العميل" style={{ padding: '9px 12px', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap',
                        color: r.wallet < -0.5 ? 'var(--red)' : r.wallet > 0.5 ? 'var(--green)' : 'var(--muted2)' }}>
                        {Math.abs(r.wallet) > 0.5 ? fmt(r.wallet) : '—'}
                      </td>
                      <td data-label="الحالة" style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>
                        <span style={{ display: 'inline-block', padding: '2px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700,
                          color: m.color, background: `color-mix(in srgb, ${m.color} 13%, transparent)` }}>
                          {m.icon} {m.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

function VendorsTab() {
  const [loading, setLoading]       = useState(true);
  const [reconcile, setReconcile]   = useState([]);
  const [others, setOthers]         = useState([]);
  const [treasury, setTreasury]     = useState({ rows: [], uploadedAt: null });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [r, o, t] = await Promise.all([
        loadVendorReconciliation().catch(() => []),
        loadVendorOthers().catch(() => []),
        loadTreasuryBalances().catch(() => ({ rows: [], uploadedAt: null })),
      ]);
      setReconcile(r);
      setOthers(o);
      setTreasury(t);
    } catch (e) {
      toast(`فشل التحميل: ${e.message}`, 'error');
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

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
    XLSX.writeFile(rtl(wb), `موردو_Zoho_${new Date().toISOString().slice(0,10)}.xlsx`);
    toast(`تم تصدير ${reconcile.length} مورّد`, 'success');
  };

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner size={22}/></div>;
  }

  return (
    <div>
      <Card style={{
        marginBottom: 20,
        border: '1px solid color-mix(in srgb, #0EA5E9 24%, var(--border))',
        background: 'linear-gradient(135deg, color-mix(in srgb, #0EA5E9 7%, var(--surface)), var(--surface))',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{
            width: 38, height: 38, borderRadius: 10,
            background: 'color-mix(in srgb, #0EA5E9 14%, transparent)',
            color: '#0EA5E9', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Zap size={18}/>
          </span>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>أرصدة شركات الشحن من زوهو API</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3, lineHeight: 1.6 }}>
              تم إيقاف رفع Vendor Balances من Excel. هذه الصفحة تعرض المتاح من المزامنة، وأي فجوة API ستظهر في خطة التطوير.
            </div>
          </div>
        </div>
      </Card>

      {/* ── COD treasury balances — from the Zoho Trial Balance (ميزان المراجعة).
            Shows how much collected COD sits un-drained per carrier so the
            operator can watch whether the accountant empties each treasury. ── */}
      <Card style={{ marginBottom: 20, padding: 0, overflow: 'hidden',
        border: '1.5px solid color-mix(in srgb, #0EA5E9 30%, transparent)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
          background: 'color-mix(in srgb, #0EA5E9 8%, transparent)',
          borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 16 }}>💰</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
            أرصدة COD في زوهو — رقابة سحب المحاسب
          </span>
          {treasury.uploadedAt && (
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>
              آخر تحديث محفوظ: {new Date(treasury.uploadedAt).toLocaleDateString('en-GB')}
            </span>
          )}
        </div>
        {treasury.rows.length === 0 ? (
          <div style={{ padding: 16, fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.7 }}>
            رفع كشف أرصدة زوهو من Excel متوقف. المطلوب في المرحلة التالية ربط أرصدة COD من Zoho API مباشرة حتى تظهر أرصدة كل ناقل بلا ملفات.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                <th style={thStyle}>الخزينة</th>
                <th style={thStyle}>الناقل</th>
                <th style={thStyle}>مدين</th>
                <th style={thStyle}>دائن</th>
              </tr>
            </thead>
            <tbody>
              {[...treasury.rows]
                .sort((a, b) => Math.max(b.debit, b.credit) - Math.max(a.debit, a.credit))
                .map(t => (
                  <tr key={t.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--text)' }}>{t.raw_name}</td>
                    <td style={{ padding: '10px 12px', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                      {t.carrier_id || <span style={{ color: 'var(--muted2)' }}>خارج النظام</span>}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'left', fontFamily: 'var(--font-mono)', fontWeight: 700, color: Number(t.debit) ? 'var(--text)' : 'var(--muted2)' }}>
                      {Number(t.debit) ? fmt(t.debit) : '—'}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'left', fontFamily: 'var(--font-mono)', fontWeight: 700, color: Number(t.credit) ? '#0EA5E9' : 'var(--muted2)' }}>
                      {Number(t.credit) ? fmt(t.credit) : '—'}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </Card>

      {reconcile.length === 0 && others.length === 0 ? (
        <Empty
          icon="🚚"
          title="لا توجد أرصدة شركات شحن من زوهو API"
          sub="رفع Excel الموردين متوقف. المطلوب مزامنة الموردين من API ليظهر الاتجاه: لهم / لنا / صفر."
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
                <strong style={{ color: 'var(--red)' }}>لهم</strong> = ندفع لهم ·&nbsp;
                <strong style={{ color: '#047857' }}>لنا</strong> = يردّون لنا ·&nbsp;
                <strong style={{ color: 'var(--muted)' }}>صفر</strong> = منتهية. لا توجد مقارنة مرجعية لأن نظامنا لا يحتفظ بكشف موردين موازٍ.
              </div>
            </div>
          </Card>

          {/* Stats strip */}
          <Card style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
              <Stat label="شركات شحن"        value={stats.total.toLocaleString('en-US')} color="#0EA5E9"/>
              <Stat label="لهم (ندفع)"       value={stats.we_owe.toLocaleString('en-US')} suffix={`(${fmtCompact(stats.we_owe_sum)})`} color="var(--red)"/>
              <Stat label="لنا (يردّون)"     value={stats.they_owe.toLocaleString('en-US')} suffix={`(${fmtCompact(stats.they_owe_sum)})`} color="#047857"/>
              <Stat label="صفر"              value={stats.zero.toLocaleString('en-US')} color="var(--muted)"/>
              <Stat label="مورّدون آخرون"    value={stats.otherCount.toLocaleString('en-US')} suffix={`(${fmtCompact(stats.otherTotal)})`} color="#8B5CF6"/>
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
                          color: isZero ? 'var(--muted2)' : v > 0 ? 'var(--red)' : '#047857',
                        }}>
                          {isZero ? '—' : fmt(Math.abs(v))}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          {isZero ? (
                            <span style={statusPill('var(--muted)')}>صفر</span>
                          ) : v > 0 ? (
                            <span style={statusPill('var(--red)')}>
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
                  جهات صرف أخرى في زوهو — {others.length} جهة
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
                        color: o.balance < 0 ? '#047857' : 'var(--red)',
                      }}>
                        {fmt(Math.abs(o.balance))}
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 11 }}>
                        {o.balance > 0
                          ? <span style={statusPill('var(--red)')}>ندفع لهم</span>
                          : <span style={statusPill('var(--green)')}>يردّون لنا</span>}
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
            <CheckCircle2 size={14} color="var(--green)"/>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>
                {snapshot.row_count} {noun} · {snapshot.matched_count} مطابق
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>
                {fmtDateTime(snapshot.uploaded_at)} · {snapshot.file_name || 'بدون اسم ملف'}
              </div>
            </div>
            <Btn variant="danger" size="sm" title="حذف هذا التحميل" icon={<Trash2 size={12}/>} onClick={onDelete}/>
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

function BalCell({ value, anchor = false, dimmedIfZero = false, label }) {
  const zero = Math.abs(value) < 0.01;
  return (
    <td data-label={label} style={{
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
  XLSX.writeFile(rtl(wb), `${fileBase}_${dateStr}.xlsx`);
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
    ? `اربطه بالاسم المقابل في زوهو: ${target.rawName}`
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
            : 'color-mix(in srgb, var(--gold) 8%, transparent)',
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
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: target.balance < 0 ? 'var(--red)' : 'var(--text2)' }}>
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
                      e.currentTarget.style.borderColor = 'var(--green)';
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
                    : 'لا توجد عملاء Zoho من المزامنة الحيّة')
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
                  onMouseEnter={(e) => e.currentTarget.style.background = 'color-mix(in srgb, var(--green) 8%, transparent)'}
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
                    fontSize: 11, color: 'var(--green)', fontWeight: 700,
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
                  onMouseEnter={(e) => e.currentTarget.style.background = 'color-mix(in srgb, var(--green) 8%, transparent)'}
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
                    fontSize: 11, color: 'var(--green)', fontWeight: 700,
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

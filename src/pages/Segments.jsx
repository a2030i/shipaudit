// "شرائح العملاء" — segment builder.
//
// Take every merchant from the latest snapshot, overlay any matching
// receivables, then let the operator narrow that universe with
// AND-combined filters across activity / account / money dimensions.
// Two exports: full Excel (every field on every row) and a 3-column
// WhatsApp campaign file (phone / name / value) matching the same
// pattern as the negative-wallet anomaly export.
//
// Filters are intentionally facet-style (one input per dimension)
// rather than a generic rule builder — it's faster for the operator
// to fill in 2-3 known facets than to construct a free-form expression.
// 4 quick-preset buttons up top one-tap the most common questions
// the user asked for ("debt + idle", "signed up but never shipped",
// "live integration not yet shipping", "topped up but inactive").

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import * as XLSX from 'xlsx';
import {
  RefreshCw, Download, Phone, Search, X, Layers,
  Wallet, Activity, ShoppingBag,
  Bookmark, Save, Pencil, Check,
} from 'lucide-react';
import {
  Card, Btn, Spinner, Empty, Modal, toast, PageHeader, Select,
} from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import { loadLatestMerchants } from '../lib/merchantsService.js';
import { loadLatestReceivables } from '../lib/customerReceivablesService.js';
import {
  listSegments, createSegment, updateSegment, deleteSegment,
} from '../lib/segmentsService.js';

// ── helpers ─────────────────────────────────────────────────────
const DAY_MS = 86_400_000;
const daysAgo = (iso) => (iso ? Math.floor((Date.now() - new Date(iso)) / DAY_MS) : null);

const fmt = (n) => {
  if (n == null || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const fmtCompact = (n) => {
  if (n == null || Number.isNaN(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'م';
  if (a >= 1_000)     return (n / 1_000).toFixed(1) + 'ك';
  return n.toFixed(0);
};

// Phone normalizer — same logic as the campaign export so segments
// can hand off straight to the WhatsApp sender without re-cleaning.
const normalizePhone = (raw) => {
  if (raw == null) return null;
  let s = String(raw).replace(/\D/g, '');
  if (!s) return null;
  if (s.startsWith('00966')) s = s.slice(2);
  else if (s.startsWith('0')) s = '966' + s.slice(1);
  else if (!s.startsWith('966')) s = '966' + s;
  return s.length >= 11 ? s : null;
};

// Status pill — same color logic used in the anomaly modal.
function statusPillTone(rawStatus, shipDays) {
  const s = String(rawStatus || '').trim();
  const isSuspended = /موقوف|محذوف|إيقاف|stopped|deleted|disabled/i.test(s);
  const isInactive  = /غير\s*نشط|غير\s*مفعّل|غير\s*مفعل|inactive/i.test(s);
  const isActive    = /^نشط$|active|مفعّل/i.test(s);
  if (isSuspended) return { bg: 'rgba(220,38,38,.12)',  fg: '#DC2626', label: s || 'موقوف' };
  if (isInactive)  return { bg: 'rgba(122,130,196,.14)',fg: '#5B6BB0', label: s || 'غير نشط' };
  if (isActive) {
    if (shipDays != null && shipDays > 30) return { bg: 'rgba(245,158,11,.14)', fg: '#B45309', label: 'نشط — خامل' };
    return { bg: 'rgba(16,185,129,.14)', fg: '#047857', label: 'شغّال' };
  }
  return { bg: 'rgba(148,163,184,.16)', fg: 'var(--muted)', label: s || 'غير معروف' };
}

// ── default filter state ────────────────────────────────────────
// `null` everywhere means "no constraint on this dimension". Any
// non-null value narrows the result set further. Designed to match
// the questions the operator asks most often without forcing them
// to think in operators (>, <, =) — each input is unambiguous.
const EMPTY_FILTERS = {
  // Activity
  shippedRecency:    null,  // 'never' | 'gte_15' | 'gte_30' | 'gte_60' | 'gte_90'
  shipmentCountKind: null,  // 'zero' | 'one_plus' | 'high'
  signupRecency:     null,  // number of days — show rows where signupDays >= N
  topupRecency:      null,  // 'never' | 'gte_30' | 'gte_60' | 'gte_90' | 'gte_180'

  // Account
  platformStatuses:  [],    // multi-select of raw status strings
  billingTypes:      [],    // multi-select
  integrationTypes:  [],    // multi-select

  // Money
  debtFilter:        null,  // 'has_debt' | 'no_debt' | number (debt >= N)
  walletFilter:      null,  // 'negative' | 'positive' | 'zero' | number (|wallet| >= N)

  // Match status
  linkStatus:        null,  // 'linked' | 'unlinked' | null

  // Free-text search (name / phone / storeId)
  search:            '',
};

// Pretty labels for the shippedRecency / topupRecency / etc. dropdowns
const SHIP_RECENCY_LABELS = {
  '':         'أي وقت',
  never:      'لم يشحن نهائياً',
  gte_15:     'آخر شحنة ≥ ١٥ يوم',
  gte_30:     'آخر شحنة ≥ ٣٠ يوم',
  gte_60:     'آخر شحنة ≥ ٦٠ يوم',
  gte_90:     'آخر شحنة ≥ ٩٠ يوم',
};
const TOPUP_RECENCY_LABELS = {
  '':         'أي وقت',
  never:      'لم يشحن رصيد نهائياً',
  gte_30:     'آخر شحن رصيد ≥ ٣٠ يوم',
  gte_60:     'آخر شحن رصيد ≥ ٦٠ يوم',
  gte_90:     'آخر شحن رصيد ≥ ٩٠ يوم',
  gte_180:    'آخر شحن رصيد ≥ ١٨٠ يوم',
};
const SHIPMENT_COUNT_LABELS = {
  '':         'أي عدد',
  zero:       'صفر شحنات',
  one_plus:   'شحنة واحدة أو أكثر',
  high:       'أكثر من ١٠٠ شحنة',
};
const DEBT_LABELS = {
  '':         'أي قيمة',
  has_debt:   'عليه دين (> ٠)',
  no_debt:    'لا يوجد دين',
};
const WALLET_LABELS = {
  '':         'أي رصيد',
  negative:   'رصيد سالب',
  positive:   'رصيد موجب',
  zero:       'رصيد صفر',
};
const LINK_LABELS = {
  '':         'الكل',
  linked:     'مرتبط بمتجر',
  unlinked:   'بدون متجر',
};

// ── unify merchants × receivables → one row per merchant ────────
function unifyRows(merchants, receivables) {
  // Build customer lookup by storeId
  const customerByStoreId = new Map();
  for (const c of receivables) {
    const sid = c.merchant?.storeId;
    if (sid) customerByStoreId.set(sid, c);
  }
  return merchants.map(m => {
    const customer = customerByStoreId.get(m.store_id);
    const lastShipmentAt = m.last_shipment_at || null;
    const lastTopupAt    = m.last_topup_at    || null;
    const createdAtPlatform = m.created_at_platform || null;
    return {
      storeId:           m.store_id,
      storeName:         m.store_name,
      phone:             m.phone,
      platformStatus:    m.status,
      billingType:       m.billing_type,
      integrationType:   m.integration_type,
      shipmentCount:     Number(m.shipment_count) || 0,
      lastShipmentAt,
      createdAtPlatform,
      lastTopupAt,
      walletBalance:     Number(m.wallet_balance) || 0,
      // Customer overlay (null if no receivable matched this storeId)
      customerName:      customer?.name || null,
      debt:              customer ? Number(customer.total) || 0 : 0,
      invoiceCount:      customer?.invoiceCount || 0,
      oldestInvoiceDate: customer?.oldestInvoiceDate || null,
      daysOutstanding:   customer?.daysOutstanding   || null,
      isLinked:          !!customer,
      // Derived day-counters used by every filter & every row render
      _shipDays:         daysAgo(lastShipmentAt),
      _topupDays:        daysAgo(lastTopupAt),
      _signupDays:       daysAgo(createdAtPlatform),
    };
  });
}

// ── filter predicate — pure, AND-combines every non-null facet ──
function matchesFilters(row, f) {
  // Activity: shipped recency
  if (f.shippedRecency === 'never' && row.lastShipmentAt) return false;
  if (f.shippedRecency?.startsWith('gte_')) {
    const n = Number(f.shippedRecency.slice(4));
    if (row._shipDays == null || row._shipDays < n) return false;
  }
  // Activity: shipment count bucket
  if (f.shipmentCountKind === 'zero'     && row.shipmentCount !== 0)   return false;
  if (f.shipmentCountKind === 'one_plus' && row.shipmentCount <  1)    return false;
  if (f.shipmentCountKind === 'high'     && row.shipmentCount <= 100)  return false;
  // Activity: signup recency (numeric input — days since signup)
  if (f.signupRecency != null && f.signupRecency !== '' && Number(f.signupRecency) > 0) {
    const n = Number(f.signupRecency);
    if (row._signupDays == null || row._signupDays < n) return false;
  }
  // Activity: top-up recency
  if (f.topupRecency === 'never' && row.lastTopupAt) return false;
  if (f.topupRecency?.startsWith('gte_')) {
    const n = Number(f.topupRecency.slice(4));
    if (row._topupDays == null || row._topupDays < n) return false;
  }
  // Account: multi-select facets — empty array means no constraint
  if (f.platformStatuses?.length && !f.platformStatuses.includes(row.platformStatus || '')) return false;
  if (f.billingTypes?.length     && !f.billingTypes.includes(row.billingType || ''))         return false;
  if (f.integrationTypes?.length && !f.integrationTypes.includes(row.integrationType || '')) return false;
  // Money: debt
  if (f.debtFilter === 'has_debt' && !(row.debt > 0.5))     return false;
  if (f.debtFilter === 'no_debt'  && row.debt > 0.5)        return false;
  if (typeof f.debtFilter === 'number' && row.debt < f.debtFilter) return false;
  // Money: wallet
  if (f.walletFilter === 'negative' && !(row.walletBalance < -0.01)) return false;
  if (f.walletFilter === 'positive' && !(row.walletBalance >  0.01)) return false;
  if (f.walletFilter === 'zero'     && Math.abs(row.walletBalance) > 0.01) return false;
  // Link status
  if (f.linkStatus === 'linked'   && !row.isLinked) return false;
  if (f.linkStatus === 'unlinked' && row.isLinked)  return false;
  // Free-text search
  if (f.search?.trim()) {
    const q = f.search.trim().toLowerCase();
    const hay = [
      row.storeName, row.phone, row.storeId, row.customerName,
    ].filter(Boolean).map(x => String(x).toLowerCase()).join(' ');
    if (!hay.includes(q)) return false;
  }
  return true;
}

// ── component ───────────────────────────────────────────────────
export default function Segments({ isActive = true }) {
  const location = useLocation();
  const { profile } = useAuth();
  const [loading, setLoading]       = useState(true);
  const [merchants, setMerchants]   = useState([]);
  const [receivables, setReceivables] = useState([]);
  const [snapshot, setSnapshot]     = useState(null);
  const [filters, setFilters]       = useState(EMPTY_FILTERS);

  // Saved segments (operator-defined). Counts are recomputed in JS
  // every time `rows` changes; never stored in the DB. `activeSavedId`
  // tracks the currently-loaded chip so the strip can highlight it.
  const [savedSegments, setSavedSegments] = useState([]);
  const [activeSavedId,  setActiveSavedId]  = useState(null);
  const [saveOpen,       setSaveOpen]       = useState(false);
  const [renameTarget,   setRenameTarget]   = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [mResult, rResult, segments] = await Promise.all([
        loadLatestMerchants(),
        loadLatestReceivables().catch(() => ({ customers: [] })),
        listSegments().catch(() => []),
      ]);
      setMerchants(mResult?.merchants || []);
      setReceivables(rResult?.customers || []);
      setSnapshot(mResult?.snapshot || null);
      setSavedSegments(segments);
    } catch (e) {
      toast(`فشل التحميل: ${e.message}`, 'error');
    }
    setLoading(false);
  }, []);

  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh, location.pathname]);

  const rows = useMemo(
    () => unifyRows(merchants, receivables),
    [merchants, receivables],
  );

  const filtered = useMemo(
    () => rows.filter(r => matchesFilters(r, filters)),
    [rows, filters],
  );

  // Distinct facet values for the dropdowns — recomputed against the
  // full row set (not the filtered one) so the operator can always
  // see every option even after narrowing.
  const facetValues = useMemo(() => {
    const collect = (key) => {
      const set = new Set();
      for (const r of rows) {
        const v = r[key];
        if (v != null && String(v).trim()) set.add(String(v).trim());
      }
      return [...set].sort();
    };
    return {
      platformStatuses: collect('platformStatus'),
      billingTypes:     collect('billingType'),
      integrationTypes: collect('integrationType'),
    };
  }, [rows]);

  // Bucket totals for the result strip
  const stats = useMemo(() => {
    let totalDebt = 0, totalWallet = 0, withPhone = 0;
    for (const r of filtered) {
      totalDebt   += r.debt;
      totalWallet += r.walletBalance;
      if (normalizePhone(r.phone)) withPhone++;
    }
    return {
      count:       filtered.length,
      totalDebt,
      totalWallet,
      withPhone,
    };
  }, [filtered]);

  // ── filter handlers ────────────────────────────────────────
  // Any direct filter edit clears the "currently loaded saved
  // segment" highlight so the operator knows their tweaks haven't
  // been persisted yet (and the "حدّث الشريحة الحالية" button
  // appears so they can save the edit back).
  const setFilter = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setActiveSavedId(null);
  };
  const toggleMultiFilter = (key, value) => {
    setFilters(prev => {
      const cur = prev[key] || [];
      const next = cur.includes(value) ? cur.filter(v => v !== value) : [...cur, value];
      return { ...prev, [key]: next };
    });
    setActiveSavedId(null);
  };
  const resetFilters = () => {
    setFilters(EMPTY_FILTERS);
    setActiveSavedId(null);
  };
  const hasAnyFilter = useMemo(() => {
    return Object.entries(filters).some(([k, v]) => {
      if (k === 'search') return v?.trim();
      if (Array.isArray(v)) return v.length > 0;
      return v != null && v !== '';
    });
  }, [filters]);

  // ── saved-segments handlers ─────────────────────────────────
  // Per-chip counts: recomputed in JS whenever `rows` or the saved
  // list changes. Effectively a "refresh all" — pulling fresh source
  // data also re-derives every chip's count in a single pass.
  const savedSegmentCounts = useMemo(() => {
    const out = new Map();
    for (const s of savedSegments) {
      // Merge each saved segment over EMPTY_FILTERS so omitted keys
      // (added later) default to "no constraint" instead of undefined.
      const f = { ...EMPTY_FILTERS, ...(s.filters || {}) };
      let n = 0;
      for (const r of rows) if (matchesFilters(r, f)) n++;
      out.set(s.id, n);
    }
    return out;
  }, [rows, savedSegments]);

  const loadSavedSegment = (segment) => {
    setFilters({ ...EMPTY_FILTERS, ...(segment.filters || {}) });
    setActiveSavedId(segment.id);
  };

  const handleSave = async (name) => {
    if (!name?.trim()) { toast('الاسم مطلوب', 'warning'); return; }
    try {
      const created = await createSegment({
        name,
        filters,
        userId: profile?.id || null,
      });
      setSavedSegments(prev => [...prev, created]);
      setActiveSavedId(created.id);
      setSaveOpen(false);
      toast(`تم حفظ شريحة «${created.name}»`, 'success');
    } catch (e) {
      toast(`فشل الحفظ: ${e.message}`, 'error');
    }
  };

  const handleRename = async (id, newName) => {
    if (!newName?.trim()) { toast('الاسم مطلوب', 'warning'); return; }
    try {
      const updated = await updateSegment(id, { name: newName });
      setSavedSegments(prev => prev.map(s => s.id === id ? updated : s));
      setRenameTarget(null);
      toast('تم تعديل الاسم', 'success');
    } catch (e) {
      toast(`فشل التعديل: ${e.message}`, 'error');
    }
  };

  const handleOverwrite = async (id) => {
    try {
      const updated = await updateSegment(id, { filters });
      setSavedSegments(prev => prev.map(s => s.id === id ? updated : s));
      toast('تم تحديث الشريحة بالفلاتر الحالية', 'success');
    } catch (e) {
      toast(`فشل التحديث: ${e.message}`, 'error');
    }
  };

  const handleDelete = async (segment) => {
    if (!confirm(`حذف شريحة «${segment.name}»؟ لا يمكن التراجع.`)) return;
    try {
      await deleteSegment(segment.id);
      setSavedSegments(prev => prev.filter(s => s.id !== segment.id));
      if (activeSavedId === segment.id) setActiveSavedId(null);
      toast('تم الحذف', 'success');
    } catch (e) {
      toast(`فشل الحذف: ${e.message}`, 'error');
    }
  };

  // ── exports ────────────────────────────────────────────────
  // Full Excel — every column on every row, no aggregation. Suitable
  // for an internal collection / outreach campaign list.
  const exportFull = () => {
    if (!filtered.length) { toast('لا توجد نتائج للتصدير', 'warning'); return; }
    const headers = [
      'رقم المتجر', 'اسم المتجر', 'الهاتف',
      'حالة المنصّة', 'نوع الفوترة', 'نوع الربط',
      'عدد الشحنات', 'آخر شحنة', 'أيام منذ آخر شحنة',
      'تاريخ التسجيل', 'أيام منذ التسجيل',
      'آخر شحن رصيد', 'أيام منذ آخر شحن رصيد',
      'رصيد المحفظة',
      'اسم العميل في الفواتير', 'المديونية', 'عدد الفواتير', 'أقدم فاتورة', 'أيام التأخر',
    ];
    const data = filtered.map(r => [
      r.storeId, r.storeName, r.phone || '',
      r.platformStatus || '', r.billingType || '', r.integrationType || '',
      r.shipmentCount,
      r.lastShipmentAt ? r.lastShipmentAt.slice(0, 10) : '',
      r._shipDays ?? '',
      r.createdAtPlatform ? r.createdAtPlatform.slice(0, 10) : '',
      r._signupDays ?? '',
      r.lastTopupAt ? r.lastTopupAt.slice(0, 10) : '',
      r._topupDays ?? '',
      r.walletBalance.toFixed(2),
      r.customerName || '',
      r.debt ? r.debt.toFixed(2) : '',
      r.invoiceCount || '',
      r.oldestInvoiceDate || '',
      r.daysOutstanding ?? '',
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'شريحة');
    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `شريحة_${filtered.length}متجر_${dateStr}.xlsx`);
    toast(`تم تصدير ${filtered.length} متجر`, 'success');
  };

  // 3-column WhatsApp campaign — phone / name / value. The 3rd column
  // is "value of interest": debt if any, else wallet balance, else
  // shipment count. The operator picks the template that matches
  // whichever segment they're running.
  const exportCampaign = () => {
    if (!filtered.length) { toast('لا توجد نتائج للتصدير', 'warning'); return; }
    const headers = ['رقم الجوال', 'اسم المتجر', 'القيمة'];
    const xRows = [];
    let skipped = 0;
    for (const r of filtered) {
      const phone = normalizePhone(r.phone);
      if (!phone) { skipped++; continue; }
      // Pick the most meaningful value for this row — debt wins over
      // wallet wins over shipment count. Operator can swap in the
      // template what the column refers to.
      const value = r.debt > 0.5
        ? r.debt.toFixed(2)
        : Math.abs(r.walletBalance) > 0.01
          ? r.walletBalance.toFixed(2)
          : String(r.shipmentCount);
      xRows.push([phone, r.storeName, value]);
    }
    if (!xRows.length) { toast('لا توجد متاجر بأرقام جوال صالحة', 'warning'); return; }
    const ws = XLSX.utils.aoa_to_sheet([headers, ...xRows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'حملة');
    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `حملة_${xRows.length}متجر_${dateStr}.xlsx`);
    toast(
      skipped
        ? `تم تصدير ${xRows.length} للحملة · تخطّينا ${skipped} بدون جوال`
        : `تم تصدير ${xRows.length} للحملة`,
      'success',
    );
  };

  // ── render ──────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 320 }}>
          <Spinner size={28}/>
        </div>
      </div>
    );
  }

  if (!merchants.length) {
    return (
      <div style={{ padding: 24 }}>
        <Empty
          icon="🧩"
          title="لا يوجد كشف متاجر بعد"
          sub="ارفع stores.xlsx من /merchants ثم ارجع لبناء الشرائح."
        />
      </div>
    );
  }

  return (
    <div style={{ padding: '20px 24px 60px', maxWidth: 1400, margin: '0 auto' }}>
      <PageHeader
        icon={<Layers size={22}/>}
        iconColor="#0EA5E9"
        title="شرائح العملاء"
        subtitle="ابنِ شريحة بفلاتر متعدّدة، احفظها باسم، وحدّث كل الشرائح بضغطة"
        meta={snapshot ? `آخر تحديث ${new Date(snapshot.uploadedAt).toLocaleDateString('ar-SA')} · ${rows.length} متجر إجمالي` : null}
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            {hasAnyFilter && !activeSavedId && (
              <Btn size="sm" variant="primary" icon={<Save size={13}/>} onClick={() => setSaveOpen(true)}>
                احفظ كشريحة
              </Btn>
            )}
            {activeSavedId && hasAnyFilter && (
              <Btn size="sm" variant="ghost" icon={<Save size={13}/>} onClick={() => handleOverwrite(activeSavedId)}>
                حدّث الشريحة الحالية
              </Btn>
            )}
            <Btn size="sm" variant="ghost" icon={<RefreshCw size={13}/>} onClick={refresh}>
              تحديث الكل
            </Btn>
          </div>
        }
      />

      {/* Saved segments strip — chips with live counts. Click a chip
          to load its filters; counts auto-recompute when "تحديث الكل"
          pulls fresh source data. */}
      {savedSegments.length > 0 && (
        <Card style={{ marginBottom: 16, background: 'var(--surface2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Bookmark size={14} color="#0EA5E9"/>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
              شرائحي المحفوظة
            </span>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>
              ({savedSegments.length})
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {savedSegments.map(s => {
              const count = savedSegmentCounts.get(s.id) ?? 0;
              const active = activeSavedId === s.id;
              return (
                <SavedChip
                  key={s.id}
                  segment={s}
                  count={count}
                  active={active}
                  onLoad={() => loadSavedSegment(s)}
                  onRename={() => setRenameTarget(s)}
                  onDelete={() => handleDelete(s)}
                />
              );
            })}
          </div>
        </Card>
      )}

      {/* Reset link — only shown when at least one filter is active */}
      {hasAnyFilter && (
        <div style={{ marginBottom: 14 }}>
          <button onClick={resetFilters} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '7px 12px', borderRadius: 999,
            border: '1.5px solid var(--border)',
            background: 'transparent', color: 'var(--muted)',
            fontSize: 12, fontWeight: 600, cursor: 'pointer',
            fontFamily: 'var(--font-sans)',
          }}>
            <X size={12}/>
            مسح كل الفلاتر
          </button>
        </div>
      )}

      {/* Filter facets — 3 columns: activity / account / money */}
      <div style={{
        display: 'grid', gap: 14,
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        marginBottom: 18,
      }}>
        <Card>
          <FacetTitle icon={<Activity size={14}/>} color="#10B981">نشاط الشحن</FacetTitle>
          <Select label="آخر شحنة" value={filters.shippedRecency || ''} onChange={e => setFilter('shippedRecency', e.target.value || null)}>
            {Object.entries(SHIP_RECENCY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select label="عدد الشحنات" value={filters.shipmentCountKind || ''} onChange={e => setFilter('shipmentCountKind', e.target.value || null)}>
            {Object.entries(SHIPMENT_COUNT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <label style={{ display: 'block', marginTop: 8 }}>
            <span style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 4 }}>
              مسجّل منذ أكثر من (يوم)
            </span>
            <input
              type="number" min="0" placeholder="مثال: ٥"
              value={filters.signupRecency ?? ''}
              onChange={e => setFilter('signupRecency', e.target.value === '' ? null : Number(e.target.value))}
              style={inputStyle}
            />
          </label>
          <div style={{ marginTop: 8 }}>
            <Select label="آخر شحن رصيد" value={filters.topupRecency || ''} onChange={e => setFilter('topupRecency', e.target.value || null)}>
              {Object.entries(TOPUP_RECENCY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </div>
        </Card>

        <Card>
          <FacetTitle icon={<ShoppingBag size={14}/>} color="#8B5CF6">العضوية</FacetTitle>
          <MultiChips
            label="حالة المنصّة"
            options={facetValues.platformStatuses}
            selected={filters.platformStatuses}
            onToggle={v => toggleMultiFilter('platformStatuses', v)}
          />
          <MultiChips
            label="نوع الفوترة"
            options={facetValues.billingTypes}
            selected={filters.billingTypes}
            onToggle={v => toggleMultiFilter('billingTypes', v)}
          />
          <MultiChips
            label="نوع الربط"
            options={facetValues.integrationTypes}
            selected={filters.integrationTypes}
            onToggle={v => toggleMultiFilter('integrationTypes', v)}
          />
        </Card>

        <Card>
          <FacetTitle icon={<Wallet size={14}/>} color="#F59E0B">المال والربط</FacetTitle>
          <Select label="المديونية" value={filters.debtFilter || ''} onChange={e => setFilter('debtFilter', e.target.value || null)}>
            {Object.entries(DEBT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select label="رصيد المحفظة" value={filters.walletFilter || ''} onChange={e => setFilter('walletFilter', e.target.value || null)}>
            {Object.entries(WALLET_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select label="حالة الربط بالفواتير" value={filters.linkStatus || ''} onChange={e => setFilter('linkStatus', e.target.value || null)}>
            {Object.entries(LINK_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Card>
      </div>

      {/* Search + result strip */}
      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 200 }}>
            <Search size={14} style={{
              position: 'absolute', insetInlineStart: 12, top: '50%',
              transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none',
            }}/>
            <input
              type="text" placeholder="بحث باسم المتجر أو رقمه أو الجوال…"
              value={filters.search}
              onChange={e => setFilter('search', e.target.value)}
              style={{ ...inputStyle, paddingInlineStart: 34 }}
            />
          </div>
          <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
            <Stat label="النتائج"     value={stats.count.toLocaleString('ar-SA')} color="#0EA5E9"/>
            <Stat label="بأرقام جوال"  value={stats.withPhone.toLocaleString('ar-SA')} color="#10B981"/>
            <Stat label="إجمالي الدين" value={fmt(stats.totalDebt)}    color="#EF4444" suffix="ر.س"/>
            <Stat label="إجمالي المحافظ" value={fmt(stats.totalWallet)} color={stats.totalWallet < 0 ? '#DC2626' : '#0EA5E9'} suffix="ر.س"/>
          </div>
          <div style={{ display: 'flex', gap: 8, marginInlineStart: 'auto' }}>
            <Btn size="md" variant="primary" icon={<Phone size={13}/>} onClick={exportCampaign} disabled={!filtered.length}>
              ملف حملة (٣ أعمدة)
            </Btn>
            <Btn size="md" variant="ghost" icon={<Download size={13}/>} onClick={exportFull} disabled={!filtered.length}>
              تصدير Excel كامل
            </Btn>
          </div>
        </div>
      </Card>

      {/* Results table — capped at 500 rows to keep DOM cheap.
          Export still uses the full filtered set. */}
      {/* Save / Rename dialogs */}
      {saveOpen && (
        <NameDialog
          title="حفظ شريحة جديدة"
          initialValue={suggestSegmentName(filters)}
          onCancel={() => setSaveOpen(false)}
          onSubmit={handleSave}
        />
      )}
      {renameTarget && (
        <NameDialog
          title={`تعديل اسم «${renameTarget.name}»`}
          initialValue={renameTarget.name}
          onCancel={() => setRenameTarget(null)}
          onSubmit={(name) => handleRename(renameTarget.id, name)}
        />
      )}

      {filtered.length === 0 ? (
        <Empty
          icon="🔎"
          title="لا توجد نتائج"
          sub="جرّب تخفيف الفلاتر أو اضغط 'مسح كل الفلاتر' للرجوع لكامل المتاجر."
        />
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                  {['#', 'المتجر / الهاتف', 'حالة', 'الفوترة', 'الربط', 'الشحنات', 'آخر شحنة', 'تسجيل منذ', 'شحن رصيد', 'المحفظة', 'الدين'].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 500).map((r, i) => {
                  const tone = statusPillTone(r.platformStatus, r._shipDays);
                  return (
                    <tr key={r.storeId} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px 12px', color: 'var(--muted2)', fontSize: 10, fontFamily: 'var(--font-mono)' }}>{i + 1}</td>
                      <td style={{ padding: '10px 12px', minWidth: 200 }}>
                        <div style={{ fontWeight: 600, color: 'var(--text)' }}>{r.storeName}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--muted)', fontFamily: 'var(--font-mono)', direction: 'ltr', textAlign: 'right' }}>
                          {r.phone || r.storeId}
                        </div>
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: tone.bg, color: tone.fg, whiteSpace: 'nowrap' }}>
                          {tone.label}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', color: 'var(--text2)', fontSize: 12 }}>{r.billingType || '—'}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--text2)', fontSize: 12 }}>{r.integrationType || '—'}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', fontFamily: 'var(--font-mono)', color: r.shipmentCount === 0 ? 'var(--muted)' : 'var(--text)' }}>{r.shipmentCount}</td>
                      <td style={{ padding: '10px 12px', fontSize: 11, color: 'var(--muted)' }}>{r._shipDays == null ? '—' : `قبل ${r._shipDays}ي`}</td>
                      <td style={{ padding: '10px 12px', fontSize: 11, color: 'var(--muted)' }}>{r._signupDays == null ? '—' : `${r._signupDays}ي`}</td>
                      <td style={{ padding: '10px 12px', fontSize: 11, color: 'var(--muted)' }}>{r._topupDays == null ? '—' : `قبل ${r._topupDays}ي`}</td>
                      <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontWeight: 600, color: r.walletBalance < 0 ? '#DC2626' : 'var(--text2)' }}>
                        {fmtCompact(r.walletBalance)}
                      </td>
                      <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontWeight: 600, color: r.debt > 0.5 ? '#EF4444' : 'var(--muted)' }}>
                        {r.debt > 0.5 ? fmtCompact(r.debt) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filtered.length > 500 && (
            <div style={{ padding: 12, textAlign: 'center', fontSize: 11.5, color: 'var(--muted)', background: 'var(--surface2)' }}>
              عرض أول ٥٠٠ نتيجة من {filtered.length.toLocaleString('ar-SA')} — التصدير يشمل الكل
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ── small subcomponents ─────────────────────────────────────────
const inputStyle = {
  width: '100%', padding: '8px 12px', fontSize: 13,
  border: '1px solid var(--border)', borderRadius: 8,
  background: 'var(--surface)', color: 'var(--text)',
  fontFamily: 'var(--font-sans)', boxSizing: 'border-box',
};

function FacetTitle({ icon, color, children }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 7,
      marginBottom: 12, paddingBottom: 8,
      borderBottom: '1px solid var(--border)',
    }}>
      <span style={{
        width: 26, height: 26, borderRadius: 7,
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
        color, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{icon}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{children}</span>
    </div>
  );
}

function MultiChips({ label, options, selected, onToggle }) {
  if (!options?.length) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {options.map(opt => {
          const on = selected?.includes(opt);
          return (
            <button key={opt} onClick={() => onToggle(opt)} style={{
              padding: '4px 10px', borderRadius: 999,
              border: `1px solid ${on ? '#0EA5E9' : 'var(--border)'}`,
              background: on ? 'rgba(14,165,233,.12)' : 'transparent',
              color: on ? '#0369A1' : 'var(--text2)',
              fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
            }}>
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SavedChip({ segment, count, active, onLoad, onRename, onDelete }) {
  const tint = segment.color || '#0EA5E9';
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      padding: '6px 10px 6px 14px', borderRadius: 999,
      border: `1.5px solid ${active ? tint : 'var(--border)'}`,
      background: active ? `color-mix(in srgb, ${tint} 12%, transparent)` : 'var(--surface)',
      transition: 'all .15s',
    }}>
      <button
        onClick={onLoad}
        title="افتح الشريحة"
        style={{
          background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 7,
          fontFamily: 'var(--font-sans)',
          color: active ? tint : 'var(--text)',
        }}
      >
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{segment.name}</span>
        <span style={{
          fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
          background: `color-mix(in srgb, ${tint} 16%, transparent)`,
          color: tint, fontFamily: 'var(--font-mono)',
          minWidth: 28, textAlign: 'center',
        }}>
          {count.toLocaleString('ar-SA')}
        </span>
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onRename(); }}
        title="تعديل الاسم"
        style={{
          background: 'transparent', border: 'none', padding: 2, cursor: 'pointer',
          color: 'var(--muted)', display: 'flex',
        }}
        onMouseEnter={(e) => e.currentTarget.style.color = tint}
        onMouseLeave={(e) => e.currentTarget.style.color = 'var(--muted)'}
      >
        <Pencil size={11}/>
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        title="حذف الشريحة"
        style={{
          background: 'transparent', border: 'none', padding: 2, cursor: 'pointer',
          color: 'var(--muted)', display: 'flex',
        }}
        onMouseEnter={(e) => e.currentTarget.style.color = '#DC2626'}
        onMouseLeave={(e) => e.currentTarget.style.color = 'var(--muted)'}
      >
        <X size={12}/>
      </button>
    </div>
  );
}

function NameDialog({ title, initialValue = '', onCancel, onSubmit }) {
  const [name, setName] = useState(initialValue);
  return (
    <Modal title={title} onClose={onCancel} width={420}>
      {/* Wrap in a form with autoComplete='off' and tag the input with
          name='search' + multiple ignore attributes (LastPass, 1Password,
          Bitwarden, generic 'data-form-type=other') so browsers stop
          mistaking this single-input modal for a login form and
          offering to save it as a password. */}
      <form
        autoComplete="off"
        onSubmit={(e) => { e.preventDefault(); onSubmit(name); }}
        style={{ padding: '4px 4px 0' }}
      >
        <label style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
            اسم الشريحة
          </span>
          <input
            type="text"
            name="search"
            role="textbox"
            aria-label="اسم الشريحة"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            data-form-type="other"
            data-lpignore="true"
            data-1p-ignore="true"
            data-bwignore
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="مثال: مديونية + خامل ١٥ يوم"
            style={inputStyle}
          />
        </label>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-start' }}>
          <Btn size="md" variant="primary" icon={<Check size={13}/>} onClick={() => onSubmit(name)}>
            حفظ
          </Btn>
          <Btn size="md" variant="ghost" onClick={onCancel}>
            إلغاء
          </Btn>
        </div>
      </form>
    </Modal>
  );
}

// Best-effort suggested name based on what filters are active. The
// operator can edit it before saving — this is just a sensible seed
// so they're not facing an empty field.
function suggestSegmentName(filters) {
  const bits = [];
  if (filters.debtFilter === 'has_debt')            bits.push('عليه دين');
  if (filters.walletFilter === 'negative')          bits.push('رصيد سالب');
  if (filters.walletFilter === 'positive')          bits.push('رصيد موجب');
  if (filters.shipmentCountKind === 'zero')         bits.push('صفر شحنات');
  if (filters.shippedRecency?.startsWith('gte_'))   bits.push(`خامل ${filters.shippedRecency.slice(4)}ي+`);
  if (filters.signupRecency)                        bits.push(`مسجّل ${filters.signupRecency}ي+`);
  if (filters.platformStatuses?.length)             bits.push(filters.platformStatuses.join('/'));
  if (filters.integrationTypes?.length)             bits.push(`ربط ${filters.integrationTypes.join('/')}`);
  return bits.length ? bits.join(' · ') : 'شريحة جديدة';
}

function Stat({ label, value, color, suffix }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 80 }}>
      <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600, letterSpacing: .5 }}>
        {label}
      </span>
      <span style={{ fontSize: 16, fontWeight: 700, color, fontFamily: 'var(--font-mono)', letterSpacing: -0.3 }}>
        {value}
        {suffix && <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 500, marginInlineStart: 3 }}>{suffix}</span>}
      </span>
    </div>
  );
}

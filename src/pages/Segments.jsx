// "مجموعات العملاء" — segment builder.
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
import { rtl } from '../lib/xlsxRtl.js';
import {
  RefreshCw, Download, Phone, Search, X, Layers, MessageCircle,
  Wallet, Activity, ShoppingBag,
  Bookmark, Save, Pencil, Check, SlidersHorizontal, Type,
} from 'lucide-react';
import {
  Card, Btn, Spinner, Empty, Modal, toast, PageHeader, Select,
} from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import { persistAndDownloadExport } from '../lib/internalExportsService.js';
import { loadLatestMerchants } from '../lib/merchantsService.js';
import { loadWhatsAppCampaignStatus } from '../lib/whatsappService.js';
import WhatsAppSendModal from '../components/WhatsAppSendModal.jsx';
import { loadLatestReceivables } from '../lib/customerReceivablesService.js';
import {
  listSegments, createSegment, updateSegment, deleteSegment,
} from '../lib/segmentsService.js';

// ── helpers ─────────────────────────────────────────────────────
const DAY_MS = 86_400_000;
const daysAgo = (iso) => (iso ? Math.floor((Date.now() - new Date(iso)) / DAY_MS) : null);

const fmt = (n) => {
  if (n == null || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const fmtCompact = (n) => {
  if (n == null || Number.isNaN(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'م';
  if (a >= 1_000)     return (n / 1_000).toFixed(1) + 'ك';
  return n.toFixed(0);
};

// Money formatter — like fmtCompact for large sums, but NEVER rounds a
// small amount to a misleading integer (20.58 must show 20.58, not 21).
const fmtMoney = (n) => {
  if (n == null || Number.isNaN(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'م';
  if (a >= 10_000)    return (n / 1_000).toFixed(1) + 'ك';
  if (a >= 1_000)     return Math.round(n).toLocaleString('en-US');
  return n.toFixed(2);          // small amounts: exact, with halalas
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
  if (isSuspended) return { bg: 'rgba(220,38,38,.12)',  fg: 'var(--red)', label: s || 'موقوف' };
  if (isInactive)  return { bg: 'rgba(122,130,196,.14)',fg: '#5B6BB0', label: s || 'غير نشط' };
  if (isActive) {
    if (shipDays != null && shipDays > 30) return { bg: 'color-mix(in srgb, var(--gold) 14%, transparent)', fg: 'var(--gold)', label: 'نشط — خامل' };
    return { bg: 'color-mix(in srgb, var(--green) 14%, transparent)', fg: 'var(--green)', label: 'شغّال' };
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
  campaignRecency:   null,  // 'never' (لم تُرسَل حملة) | 'gte_N' | 'lte_N' (أيام منذ آخر حملة واتساب)

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

// Each numeric facet stores its value as one of three shapes:
//   null / '' / 'any'  → no constraint
//   '<token>'          → a "special" predicate the facet declares
//                        (e.g. 'never', 'has_debt', 'negative')
//   'gte_N' | 'lte_N' | 'eq_N'
//                      → operator + free user-entered number N
//
// parseFacetValue() turns any of those into { op, value, special }
// so the matcher and UI both work off the same parsed shape.
function parseFacetValue(v) {
  // Backwards compat: legacy signupRecency was stored as a raw number
  // (years before the gte_N tokens existed). Treat that as gte_N.
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
    return { op: 'gte', value: v, special: null };
  }
  if (v == null || v === '' || v === 'any') {
    return { op: 'any', value: null, special: null };
  }
  const s = String(v);
  const m = s.match(/^(gte|lte|eq)_(-?\d+(?:\.\d+)?)$/);
  if (m) return { op: m[1], value: Number(m[2]), special: null };
  return { op: 'special', value: null, special: s };
}

const buildToken = (op, value) => {
  if (op === 'any')     return null;
  if (op === 'special') return value;          // value carries the special token
  if (value == null || value === '' || Number.isNaN(Number(value))) return null;
  return `${op}_${Number(value)}`;
};

// Per-facet configuration. `specials` is the list of named predicates
// the facet supports beyond the generic ≥ / ≤ / = operators.
const FACET_CONFIG = {
  shippedRecency: {
    unit: 'يوم',
    operators: ['any', 'gte', 'lte'],
    specials:  [{ value: 'never', label: 'لم يشحن نهائياً' }],
    defaultValue: 15,
  },
  topupRecency: {
    unit: 'يوم',
    operators: ['any', 'gte', 'lte'],
    specials:  [{ value: 'never', label: 'لم يشحن رصيد نهائياً' }],
    defaultValue: 30,
  },
  shipmentCountKind: {
    unit: 'شحنة',
    operators: ['any', 'gte', 'lte', 'eq'],
    specials:  [],
    defaultValue: 10,
  },
  signupRecency: {
    unit: 'يوم',
    operators: ['any', 'gte', 'lte'],
    specials:  [],
    defaultValue: 5,
  },
  campaignRecency: {
    unit: 'يوم',
    operators: ['any', 'gte', 'lte'],
    specials:  [{ value: 'never', label: 'لم تُرسَل حملة' }],
    defaultValue: 7,
  },
  debtFilter: {
    unit: 'ر.س',
    operators: ['any', 'gte', 'lte'],
    specials:  [
      // "debt" = the matched customer's receivables total = unpaid Zoho
      // invoices. Labels say so explicitly so the toggle is unmistakable.
      { value: 'has_debt', label: 'عليه فواتير غير مدفوعة (زوهو)' },
      { value: 'no_debt',  label: 'لا فواتير غير مدفوعة' },
    ],
    defaultValue: 100,
  },
  walletFilter: {
    unit: 'ر.س',
    operators: ['any', 'gte', 'lte'],
    specials:  [
      { value: 'negative', label: 'رصيد سالب' },
      { value: 'positive', label: 'رصيد موجب' },
      { value: 'zero',     label: 'رصيد صفر'  },
    ],
    defaultValue: 100,
  },
};

const OP_LABEL = {
  any:     'أي قيمة',
  gte:     '≥ أكبر من',
  lte:     '≤ أقل من',
  eq:      '= يساوي',
  special: 'حالة خاصة',
};

const LINK_LABELS = {
  '':         'الكل',
  linked:     'مرتبط بمتجر',
  unlinked:   'بدون متجر',
};

// Results-table column config — drives both the header row and the
// sort handler. `sortKey: null` means the column isn't sortable
// (only the row-index column).
const COLUMNS = [
  { id: 'index',           label: '#',                 sortKey: null            },
  { id: 'name',            label: 'المتجر / الهاتف',   sortKey: 'storeName'     },
  { id: 'status',          label: 'حالة',              sortKey: 'platformStatus'},
  { id: 'billing',         label: 'الفوترة',           sortKey: 'billingType'   },
  { id: 'integration',     label: 'الربط',             sortKey: 'integrationType'},
  { id: 'shipments',       label: 'الشحنات',           sortKey: 'shipmentCount' },
  { id: 'lastShip',        label: 'آخر شحنة',          sortKey: '_shipDays'     },
  { id: 'signup',          label: 'تسجيل منذ',         sortKey: '_signupDays'   },
  { id: 'topup',           label: 'شحن رصيد',          sortKey: '_topupDays'    },
  { id: 'wallet',          label: 'المحفظة',           sortKey: 'walletBalance' },
  { id: 'debt',            label: 'الدين',             sortKey: 'debt'          },
];

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

// Generic numeric-facet matcher. `metric` is the row value to compare;
// `null` means the row has no value (e.g. lastShipmentAt is unknown).
// The "missing" rows fail ≥/≤/= constraints, which is what the
// operator usually wants — if you ask "shipped at least once",
// merchants with no shipment date don't qualify.
function matchNumeric(parsed, metric, specialChecks = {}) {
  if (parsed.op === 'any')   return true;
  if (parsed.op === 'special') {
    const check = specialChecks[parsed.special];
    return check ? check() : true;
  }
  if (metric == null) return false;
  if (parsed.op === 'gte') return metric >= parsed.value;
  if (parsed.op === 'lte') return metric <= parsed.value;
  if (parsed.op === 'eq')  return metric === parsed.value;
  return true;
}

// ── filter predicate — pure, AND-combines every non-null facet ──
function matchesFilters(row, f) {
  // Activity: shipped recency (days since last shipment)
  if (!matchNumeric(parseFacetValue(f.shippedRecency), row._shipDays, {
    never: () => !row.lastShipmentAt,
  })) return false;
  // Activity: shipment count
  if (!matchNumeric(parseFacetValue(f.shipmentCountKind), row.shipmentCount)) return false;
  // Activity: signup recency (days since createdAtPlatform)
  if (!matchNumeric(parseFacetValue(f.signupRecency), row._signupDays)) return false;
  // Activity: top-up recency
  if (!matchNumeric(parseFacetValue(f.topupRecency), row._topupDays, {
    never: () => !row.lastTopupAt,
  })) return false;
  // Activity: last WhatsApp campaign recency (أيام منذ آخر حملة) — never = لم تُرسَل
  if (!matchNumeric(parseFacetValue(f.campaignRecency), row._campaignDays, {
    never: () => row._campaignDays == null,
  })) return false;
  // Account: multi-select facets — empty array means no constraint
  if (f.platformStatuses?.length && !f.platformStatuses.includes(row.platformStatus || '')) return false;
  if (f.billingTypes?.length     && !f.billingTypes.includes(row.billingType || ''))         return false;
  if (f.integrationTypes?.length && !f.integrationTypes.includes(row.integrationType || '')) return false;
  // Money: debt
  if (!matchNumeric(parseFacetValue(f.debtFilter), row.debt, {
    has_debt: () => row.debt > 0.5,
    no_debt:  () => row.debt <= 0.5,
  })) return false;
  // Money: wallet
  if (!matchNumeric(parseFacetValue(f.walletFilter), row.walletBalance, {
    negative: () => row.walletBalance < -0.01,
    positive: () => row.walletBalance >  0.01,
    zero:     () => Math.abs(row.walletBalance) <= 0.01,
  })) return false;
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
  const { profile, can, user } = useAuth();
  const [loading, setLoading]       = useState(true);
  const [merchants, setMerchants]   = useState([]);
  const [waStatus, setWaStatus]     = useState(() => new Map());  // هاتف → آخر حملة
  const [receivables, setReceivables] = useState([]);
  const [snapshot, setSnapshot]     = useState(null);
  const [filters, setFilters]       = useState(EMPTY_FILTERS);
  // Column sort — null sortBy means "keep snapshot order" (the order
  // rows arrive from merchantsService). Click a header once → asc,
  // again → desc, third time → clear back to snapshot order.
  const [sortBy,  setSortBy]        = useState(null);
  const [sortDir, setSortDir]       = useState('asc');

  // Saved segments (operator-defined). Counts are recomputed in JS
  // every time `rows` changes; never stored in the DB. `activeSavedId`
  // tracks the currently-loaded chip so the strip can highlight it.
  const [savedSegments, setSavedSegments] = useState([]);
  const [waOpen, setWaOpen] = useState(false);   // مودال إرسال حملة واتساب
  const [activeSavedId,  setActiveSavedId]  = useState(null);
  const [saveOpen,       setSaveOpen]       = useState(false);
  const [renameTarget,   setRenameTarget]   = useState(null);
  // Filter cards visibility. Default true so the operator can build a
  // fresh segment from scratch. Loading a saved chip collapses them
  // (they came to see results, not to fiddle with knobs). Clicking
  // the chip's pencil re-expands them in edit mode.
  const [filtersExpanded, setFiltersExpanded] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [mResult, rResult, segments, wa] = await Promise.all([
        loadLatestMerchants(),
        loadLatestReceivables().catch(() => ({ customers: [] })),
        listSegments().catch(() => []),
        loadWhatsAppCampaignStatus().catch(() => new Map()),
      ]);
      setMerchants(mResult?.merchants || []);
      setReceivables(rResult?.customers || []);
      setSnapshot(mResult?.snapshot || null);
      setSavedSegments(segments);
      setWaStatus(wa || new Map());
    } catch (e) {
      toast(`فشل التحميل: ${e.message}`, 'error');
    }
    setLoading(false);
  }, []);

  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh, location.pathname]);

  const rows = useMemo(() => {
    const base = unifyRows(merchants, receivables);
    // أرفق «أيام منذ آخر حملة واتساب» لكل متجر عبر هاتفه المطبَّع
    return base.map(r => {
      const p = normalizePhone(r.phone);
      const st = p ? waStatus.get(p) : null;
      const last = st?.lastSentAt || null;
      const days = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86_400_000) : null;
      return { ...r, _lastCampaignAt: last, _campaignDays: days };
    });
  }, [merchants, receivables, waStatus]);

  const filtered = useMemo(
    () => rows.filter(r => matchesFilters(r, filters)),
    [rows, filters],
  );

  // Sorted view of the filtered set. Null/undefined values always sink
  // to the bottom regardless of asc/desc — that's the convention every
  // table grid uses. Without it, a "sort by آخر شحنة asc" would put
  // every "never shipped" row first which is the opposite of what the
  // operator usually wants.
  const sortedFiltered = useMemo(() => {
    if (!sortBy) return filtered;
    const dir = sortDir === 'desc' ? -1 : 1;
    const out = filtered.slice();
    out.sort((a, b) => {
      const va = a[sortBy];
      const vb = b[sortBy];
      const aMissing = va == null || va === '';
      const bMissing = vb == null || vb === '';
      if (aMissing && bMissing) return 0;
      if (aMissing) return 1;        // missing always last
      if (bMissing) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), 'ar') * dir;
    });
    return out;
  }, [filtered, sortBy, sortDir]);

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
  // been persisted yet (and the "حدّث المجموعة الحالية" button
  // appears so they can save the edit back).
  const setFilter = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setActiveSavedId(null);
    setFiltersExpanded(true);
  };
  const toggleMultiFilter = (key, value) => {
    setFilters(prev => {
      const cur = prev[key] || [];
      const next = cur.includes(value) ? cur.filter(v => v !== value) : [...cur, value];
      return { ...prev, [key]: next };
    });
    setActiveSavedId(null);
    setFiltersExpanded(true);
  };
  const resetFilters = () => {
    setFilters(EMPTY_FILTERS);
    setActiveSavedId(null);
    setFiltersExpanded(true);
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

  // Plain load — click on the chip body. Just runs the segment; the
  // operator wants to see results, not knobs.
  const loadSavedSegment = (segment) => {
    setFilters({ ...EMPTY_FILTERS, ...(segment.filters || {}) });
    setActiveSavedId(segment.id);
    setFiltersExpanded(false);
  };
  // Edit mode — clicking the pencil. Loads the segment AND opens the
  // facet cards so they can be tweaked.
  const editSavedSegment = (segment) => {
    setFilters({ ...EMPTY_FILTERS, ...(segment.filters || {}) });
    setActiveSavedId(segment.id);
    setFiltersExpanded(true);
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
      toast(`تم حفظ مجموعة «${created.name}»`, 'success');
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
      toast('تم تحديث المجموعة بالفلاتر الحالية', 'success');
    } catch (e) {
      toast(`فشل التحديث: ${e.message}`, 'error');
    }
  };

  const handleDelete = async (segment) => {
    if (!confirm(`حذف مجموعة «${segment.name}»؟ لا يمكن التراجع.`)) return;
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
    const data = sortedFiltered.map(r => [
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
    XLSX.utils.book_append_sheet(wb, ws, 'مجموعة');
    const dateStr = new Date().toISOString().slice(0, 10);
    // §1.13: كل تصدير عبر السجل (كان XLSX.writeFile خاماً — لا يُعاد تحميله)
    persistAndDownloadExport({ wb: rtl(wb), fileName: `مجموعة_${filtered.length}متجر_${dateStr}.xlsx`,
      kind: 'segments', rowCount: filtered.length, total: null, userId: user?.id || null })
      .then(() => toast(`تم تصدير ${filtered.length} متجر`, 'success'))
      .catch(e => toast(`فشل التصدير: ${e.message}`, 'error'));
  };

  // مستلِمو حملة واتساب من الشريحة الحالية — المودال يتيح اختيار عملاء محدّدين
  // (الكل افتراضياً). vars: {{1}} اسم المتجر · {{2}} القيمة (دين/محفظة/شحنات).
  const buildWaRecipients = () => {
    const out = [];
    for (const r of sortedFiltered) {
      const phone = normalizePhone(r.phone);
      if (!phone) continue;
      const value = r.debt > 0.5 ? r.debt.toFixed(2)
        : Math.abs(r.walletBalance) > 0.01 ? r.walletBalance.toFixed(2)
          : String(r.shipmentCount);
      out.push({
        to: phone, name: r.storeName, amount: Number(r.debt) || 0, vars: [r.storeName, value],
        // أعمدة صف المتجر نفسه لمتغيرات القالب — بدونها كان مودال الإرسال يستكمل
        // من سياق القاعدة الذي قد يجلب متجراً آخر بنفس الرقم (حادثة TREVU/farnearapp)
        fields: {
          name: r.storeName, shipments: r.shipmentCount,
          last_shipment: r.lastShipmentAt, days_since: r._shipDays,
          wallet: r.walletBalance, amount: Number(r.debt) || 0,
        },
      });
    }
    return out;
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
    for (const r of sortedFiltered) {
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
    persistAndDownloadExport({ wb: rtl(wb), fileName: `حملة_${xRows.length}متجر_${dateStr}.xlsx`,
      kind: 'segments_campaign', rowCount: xRows.length, total: null, userId: user?.id || null })
      .catch(e => toast(`فشل التخزين: ${e.message}`, 'error'));
    toast(
      skipped
        ? `تم تصدير ${xRows.length} للحملة · تخطّينا ${skipped} بدون جوال`
        : `تم تصدير ${xRows.length} للحملة`,
      'success',
    );
  };

  // ── render ──────────────────────────────────────────────────
  // تفصيص 2026-07-16: مفتاح مستقل لتبويب مجموعات العملاء
  if (!can('sales.segments')) {
    return <div style={{ padding: 40 }}><Empty icon="🔒" title="لا صلاحية" sub="تحتاج صلاحية «تبويب مجموعات العملاء»"/></div>;
  }
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
          sub="زامن دليل المتاجر من لمحة ثم ارجع لبناء المجموعات."
        />
      </div>
    );
  }

  return (
    <div className="operations-os-page segments-page" style={{ padding: '24px 28px 80px', maxWidth: 1320, margin: '0 auto' }}>
      <PageHeader
        icon={<Layers size={22}/>}
        iconColor="var(--accent3)"
        title="مجموعات العملاء"
        subtitle="ابنِ مجموعة بفلاتر متعدّدة، احفظها باسم، وحدّث كل المجموعات بضغطة"
        meta={snapshot ? `آخر تحديث ${new Date(snapshot.uploadedAt).toLocaleDateString('en-GB')} · ${rows.length} متجر إجمالي` : null}
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            {hasAnyFilter && !activeSavedId && (
              <Btn size="sm" variant="primary" icon={<Save size={13}/>} onClick={() => setSaveOpen(true)}>
                احفظ كمجموعة
              </Btn>
            )}
            {activeSavedId && hasAnyFilter && (
              <Btn size="sm" variant="ghost" icon={<Save size={13}/>} onClick={() => handleOverwrite(activeSavedId)}>
                حدّث المجموعة الحالية
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
            <Bookmark size={14} color="var(--accent3)"/>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
              مجموعاتي المحفوظة
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
                  onEdit={() => editSavedSegment(s)}
                  onRename={() => setRenameTarget(s)}
                  onDelete={() => handleDelete(s)}
                />
              );
            })}
          </div>
        </Card>
      )}

      {/* Collapsed-filters banner — only shown when viewing a saved
          segment with the filter cards hidden. Single click on
          "تعديل الفلاتر" expands them so the operator can tweak. */}
      {activeSavedId && !filtersExpanded && (
        <Card style={{
          marginBottom: 14, padding: '12px 16px',
          background: 'color-mix(in srgb, var(--accent3) 5%, transparent)',
          border: '1px solid color-mix(in srgb, var(--accent3) 18%, transparent)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <SlidersHorizontal size={14} color="var(--accent3)"/>
            <span style={{ fontSize: 12.5, color: 'var(--text2)' }}>
              تشاهد مجموعة محفوظة —
              <strong style={{ color: 'var(--text)', marginInlineStart: 4 }}>
                {savedSegments.find(s => s.id === activeSavedId)?.name || '—'}
              </strong>
            </span>
            <button
              onClick={() => setFiltersExpanded(true)}
              style={{
                marginInlineStart: 'auto',
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', borderRadius: 999,
                border: '1.5px solid var(--accent3)',
                background: 'transparent', color: 'var(--accent3)',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
              }}
            >
              <Pencil size={11}/>
              تعديل الفلاتر
            </button>
          </div>
        </Card>
      )}

      {/* Reset link — only shown when filters are visible AND something is set */}
      {filtersExpanded && hasAnyFilter && (
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

      {/* Filter facets — 3 columns: activity / account / money.
          Hidden when viewing a saved chip (operator wants results,
          not knobs). Click the chip's pencil → expands. */}
      {filtersExpanded && (
      <div style={{
        display: 'grid', gap: 14,
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        marginBottom: 18,
      }}>
        <Card>
          <FacetTitle icon={<Activity size={14}/>} color="var(--green)">نشاط الشحن</FacetTitle>
          <NumericFacet
            label="آخر شحنة منذ"
            facetKey="shippedRecency"
            value={filters.shippedRecency}
            onChange={v => setFilter('shippedRecency', v)}
          />
          <NumericFacet
            label="عدد الشحنات"
            facetKey="shipmentCountKind"
            value={filters.shipmentCountKind}
            onChange={v => setFilter('shipmentCountKind', v)}
          />
          <NumericFacet
            label="تسجيل المتجر منذ"
            facetKey="signupRecency"
            value={filters.signupRecency}
            onChange={v => setFilter('signupRecency', v)}
          />
          <NumericFacet
            label="آخر شحن رصيد منذ"
            facetKey="topupRecency"
            value={filters.topupRecency}
            onChange={v => setFilter('topupRecency', v)}
          />
          <NumericFacet
            label="آخر حملة واتساب منذ"
            facetKey="campaignRecency"
            value={filters.campaignRecency}
            onChange={v => setFilter('campaignRecency', v)}
          />
        </Card>

        <Card>
          <FacetTitle icon={<ShoppingBag size={14}/>} color="var(--accent)">بيانات الحساب</FacetTitle>
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
          <FacetTitle icon={<Wallet size={14}/>} color="var(--gold)">المال والربط</FacetTitle>
          <NumericFacet
            label="المديونية"
            facetKey="debtFilter"
            value={filters.debtFilter}
            onChange={v => setFilter('debtFilter', v)}
          />
          <NumericFacet
            label="رصيد المحفظة"
            facetKey="walletFilter"
            value={filters.walletFilter}
            onChange={v => setFilter('walletFilter', v)}
          />
          <Select label="حالة الربط بالفواتير" value={filters.linkStatus || ''} onChange={e => setFilter('linkStatus', e.target.value || null)}>
            {Object.entries(LINK_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Card>
      </div>
      )}

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
            <Stat label="النتائج"     value={stats.count.toLocaleString('en-US')} color="var(--accent3)"/>
            <Stat label="بأرقام جوال"  value={stats.withPhone.toLocaleString('en-US')} color="var(--green)"/>
            <Stat label="إجمالي الدين" value={fmt(stats.totalDebt)}    color="#EF4444" suffix="ر.س"/>
            <Stat label="إجمالي المحافظ" value={fmt(stats.totalWallet)} color={stats.totalWallet < 0 ? 'var(--red)' : 'var(--accent3)'} suffix="ر.س"/>
          </div>
          <div style={{ display: 'flex', gap: 8, marginInlineStart: 'auto', flexWrap: 'wrap' }}>
            {/* §هيكلة-0: كان الزر بلا أي بوابة صلاحية — الآن campaigns.send (والمودال يعيد الفحص) */}
            {can('campaigns.send') && (
              <Btn size="md" variant="primary" icon={<MessageCircle size={13}/>} onClick={() => setWaOpen(true)} disabled={!filtered.length}>
                إرسال حملة واتساب
              </Btn>
            )}
            {/* التصدير خلف sales.export (كانا بلا بوابة — اكتُشف مع موظف محدود 2026-07-16) */}
            {can('sales.export') && (
              <Btn size="md" variant="ghost" icon={<Phone size={13}/>} onClick={exportCampaign} disabled={!filtered.length}>
                ملف حملة
              </Btn>
            )}
            {can('sales.export') && (
              <Btn size="md" variant="ghost" icon={<Download size={13}/>} onClick={exportFull} disabled={!filtered.length}>
                تصدير Excel
              </Btn>
            )}
          </div>
        </div>
      </Card>

      {/* Results table — capped at 500 rows to keep DOM cheap.
          Export still uses the full filtered set. */}
      {/* Save / Rename dialogs */}
      {saveOpen && (
        <NameDialog
          title="حفظ مجموعة جديدة"
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
                  {COLUMNS.map(col => (
                    <SortableTh
                      key={col.id}
                      col={col}
                      sortBy={sortBy}
                      sortDir={sortDir}
                      onSort={(id) => {
                        if (sortBy !== id) { setSortBy(id); setSortDir('asc'); return; }
                        if (sortDir === 'asc') { setSortDir('desc'); return; }
                        setSortBy(null);              // third click clears
                      }}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedFiltered.slice(0, 500).map((r, i) => {
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
                      <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontWeight: 600, color: r.walletBalance < 0 ? 'var(--red)' : 'var(--text2)' }}>
                        {fmtMoney(r.walletBalance)}
                      </td>
                      <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontWeight: 600, color: r.debt > 0.5 ? '#EF4444' : 'var(--muted)' }}>
                        {r.debt > 0.5 ? fmtMoney(r.debt) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {sortedFiltered.length > 500 && (
            <div style={{ padding: 12, textAlign: 'center', fontSize: 11.5, color: 'var(--muted)', background: 'var(--surface2)' }}>
              عرض أول ٥٠٠ نتيجة من {sortedFiltered.length.toLocaleString('en-US')} — التصدير يشمل الكل
            </div>
          )}
        </Card>
      )}
      {waOpen && (
        <WhatsAppSendModal
          open={waOpen}
          salesAudience
          onClose={() => setWaOpen(false)}
          recipients={buildWaRecipients()}
          bucketLabel={savedSegments.find(s => s.id === activeSavedId)?.name || null}
          onSent={() => setWaOpen(false)}
        />
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

function SortableTh({ col, sortBy, sortDir, onSort }) {
  const sortable = !!col.sortKey;
  const active   = sortable && sortBy === col.sortKey;
  const arrow    = active ? (sortDir === 'asc' ? '↑' : '↓') : '⇅';
  return (
    <th
      onClick={sortable ? () => onSort(col.sortKey) : undefined}
      style={{
        padding: '10px 12px', textAlign: 'right',
        fontSize: 11, fontWeight: 600,
        color: active ? 'var(--accent3)' : 'var(--muted)',
        whiteSpace: 'nowrap',
        cursor: sortable ? 'pointer' : 'default',
        userSelect: 'none',
        transition: 'color .12s',
      }}
      onMouseEnter={(e) => { if (sortable && !active) e.currentTarget.style.color = 'var(--text)'; }}
      onMouseLeave={(e) => { if (sortable && !active) e.currentTarget.style.color = 'var(--muted)'; }}
    >
      {col.label}
      {sortable && (
        <span style={{
          marginInlineStart: 6, fontSize: 10,
          opacity: active ? 1 : 0.35,
          fontFamily: 'var(--font-mono)',
        }}>{arrow}</span>
      )}
    </th>
  );
}

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

// Dynamic numeric filter: operator + free user-entered number.
//   - Operator dropdown carries 'أي قيمة' + the operators the facet
//     supports (gte/lte/eq) + every "special" predicate (e.g. لم يشحن
//     نهائياً / عليه دين / رصيد سالب) flattened into the same list.
//   - When the operator is gte/lte/eq the number input appears inline;
//     for 'special' or 'any' it stays hidden.
//
// The component is self-contained: it owns the parsed split between
// op + number but emits a single token back to the parent
// (`gte_15`, `lte_30`, `eq_0`, 'never', etc.) so the persisted shape
// stays one flat string per facet.
function NumericFacet({ label, facetKey, value, onChange }) {
  const cfg = FACET_CONFIG[facetKey];
  const parsed = parseFacetValue(value);

  // Local input value — derived from the parsed token. We keep a
  // separate `localN` so the user can type "1" without it being
  // interpreted as `gte_1` before they finish typing "15".
  // (الـhooks قبل حارس `!cfg` — hook بعد return شرطي = React #310)
  const [localN, setLocalN] = useState(parsed.value ?? '');
  useEffect(() => { setLocalN(parsed.value ?? ''); }, [value]);
  if (!cfg) return null;

  const emit = (op, n) => {
    const token = buildToken(op, n);
    onChange(token);
  };

  const onOpChange = (e) => {
    const v = e.target.value;
    if (v === 'any') { onChange(null); return; }
    // Special predicate values (e.g. 'never', 'has_debt') come back as
    // bare tokens. Operator changes (gte/lte/eq) keep the current N
    // or fall back to the facet's defaultValue if N is empty.
    if (cfg.specials.some(s => s.value === v)) { onChange(v); return; }
    const n = localN === '' ? cfg.defaultValue : Number(localN);
    setLocalN(n);
    emit(v, n);
  };

  const onNumChange = (e) => {
    const raw = e.target.value;
    setLocalN(raw);
    if (raw === '') { onChange(null); return; }
    emit(parsed.op === 'special' || parsed.op === 'any' ? 'gte' : parsed.op, Number(raw));
  };

  // Build the unified options list for the operator dropdown
  const opOptions = [];
  for (const op of cfg.operators) opOptions.push({ value: op, label: OP_LABEL[op] });
  for (const sp of cfg.specials)  opOptions.push({ value: sp.value, label: sp.label });

  const currentOpValue = parsed.op === 'special' ? parsed.special : parsed.op;
  const showNumber = parsed.op === 'gte' || parsed.op === 'lte' || parsed.op === 'eq';

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <select
          value={currentOpValue || 'any'}
          onChange={onOpChange}
          style={{
            ...inputStyle, flex: showNumber ? '0 0 130px' : 1,
            cursor: 'pointer',
          }}
        >
          {opOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {showNumber && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
            <input
              type="number" min="0" inputMode="decimal"
              value={localN}
              onChange={onNumChange}
              placeholder={String(cfg.defaultValue)}
              style={{ ...inputStyle, flex: 1, textAlign: 'center', fontFamily: 'var(--font-mono)' }}
            />
            <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>
              {cfg.unit}
            </span>
          </div>
        )}
      </div>
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
              border: `1px solid ${on ? 'var(--accent3)' : 'var(--border)'}`,
              background: on ? 'color-mix(in srgb, var(--accent3) 12%, transparent)' : 'transparent',
              color: on ? 'var(--accent)' : 'var(--text2)',
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

function SavedChip({ segment, count, active, onLoad, onEdit, onRename, onDelete }) {
  const tint = segment.color || 'var(--accent3)';
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      padding: '6px 10px 6px 14px', borderRadius: 999,
      border: `1.5px solid ${active ? tint : 'var(--border)'}`,
      background: active ? `color-mix(in srgb, ${tint} 12%, transparent)` : 'var(--surface)',
      transition: 'all .15s',
    }}>
      {/* Click the chip body → load + collapse filters (just see results) */}
      <button
        onClick={onLoad}
        title="افتح المجموعة وأظهر النتائج"
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
          {count.toLocaleString('en-US')}
        </span>
      </button>
      {/* Pencil = enter edit mode (load + expand the filter cards).
          Renaming moved to a small icon further right so the most
          common edit-action (tweak filters) is the most prominent. */}
      <button
        onClick={(e) => { e.stopPropagation(); onEdit(); }}
        title="تعديل الفلاتر"
        style={iconBtnStyle}
        onMouseEnter={(e) => e.currentTarget.style.color = tint}
        onMouseLeave={(e) => e.currentTarget.style.color = 'var(--muted)'}
      >
        <SlidersHorizontal size={11}/>
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onRename(); }}
        title="تعديل الاسم"
        style={iconBtnStyle}
        onMouseEnter={(e) => e.currentTarget.style.color = tint}
        onMouseLeave={(e) => e.currentTarget.style.color = 'var(--muted)'}
      >
        <Type size={11}/>
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        title="حذف المجموعة"
        style={iconBtnStyle}
        onMouseEnter={(e) => e.currentTarget.style.color = 'var(--red)'}
        onMouseLeave={(e) => e.currentTarget.style.color = 'var(--muted)'}
      >
        <X size={12}/>
      </button>
    </div>
  );
}

const iconBtnStyle = {
  background: 'transparent', border: 'none', padding: 2, cursor: 'pointer',
  color: 'var(--muted)', display: 'flex',
};

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
            اسم المجموعة
          </span>
          <input
            type="text"
            name="search"
            role="textbox"
            aria-label="اسم المجموعة"
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
  const opPhrase = (p, unit) => {
    if (p.op === 'gte') return `≥ ${p.value} ${unit}`;
    if (p.op === 'lte') return `≤ ${p.value} ${unit}`;
    if (p.op === 'eq')  return `= ${p.value}`;
    return null;
  };
  const debt = parseFacetValue(filters.debtFilter);
  if (debt.special === 'has_debt') bits.push('عليه دين');
  if (debt.special === 'no_debt')  bits.push('بدون دين');
  const debtPhrase = opPhrase(debt, 'ر.س'); if (debtPhrase) bits.push(`دين ${debtPhrase}`);

  const wallet = parseFacetValue(filters.walletFilter);
  if (wallet.special === 'negative') bits.push('رصيد سالب');
  if (wallet.special === 'positive') bits.push('رصيد موجب');
  if (wallet.special === 'zero')     bits.push('رصيد صفر');
  const walletPhrase = opPhrase(wallet, 'ر.س'); if (walletPhrase) bits.push(`محفظة ${walletPhrase}`);

  const sc = parseFacetValue(filters.shipmentCountKind);
  if (sc.op === 'eq' && sc.value === 0) bits.push('صفر شحنات');
  else { const p = opPhrase(sc, 'شحنة'); if (p) bits.push(`شحنات ${p}`); }

  const ship = parseFacetValue(filters.shippedRecency);
  if (ship.special === 'never') bits.push('لم يشحن');
  else { const p = opPhrase(ship, 'يوم'); if (p) bits.push(`آخر شحنة ${p}`); }

  const su = parseFacetValue(filters.signupRecency);
  const suPhrase = opPhrase(su, 'يوم'); if (suPhrase) bits.push(`مسجّل ${suPhrase}`);

  const tu = parseFacetValue(filters.topupRecency);
  if (tu.special === 'never') bits.push('لم يشحن رصيد');
  else { const p = opPhrase(tu, 'يوم'); if (p) bits.push(`شحن رصيد ${p}`); }

  if (filters.platformStatuses?.length) bits.push(filters.platformStatuses.join('/'));
  if (filters.integrationTypes?.length) bits.push(`ربط ${filters.integrationTypes.join('/')}`);
  if (filters.billingTypes?.length)     bits.push(filters.billingTypes.join('/'));
  return bits.length ? bits.join(' · ') : 'مجموعة جديدة';
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

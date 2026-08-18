// "متابعة العملاء" — the customer 360 watch page.
//
// One screen, every signal: monthly invoicing, debt totals, wallet
// totals, anomaly buckets, and six top-N lists (debtors, shippers,
// wallet holders, wallet debtors, new signups, churned). Designed for
// the operator's morning standup — open this page, see everything.
//
// All data comes from customer360Service.loadCustomerWatch which
// cross-joins customer_receivables × merchants × customer_merchant_links
// in one pass.

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { rtl } from '../lib/xlsxRtl.js';
import {
  Users, TrendingUp, TrendingDown, Wallet,
  ShoppingBag, AlertTriangle, UserPlus, ZapOff, Phone,
  ArrowLeft, AlertOctagon, Flame, Clock, Moon, Search, X,
  Download, Activity, Calendar, Hash, Send,
} from 'lucide-react';
import {
  Card, Btn, Spinner, Empty, Modal, toast,
  PageHeader, SectionTitle, AreaChart,
} from '../components/UI.jsx';
import IvrCallButton from '../components/IvrCallButton.jsx';
import CustomerCommTimeline from '../components/CustomerCommTimeline.jsx';
import DataConfidenceBar from '../components/DataConfidenceBar.jsx';
import { loadCustomerWatch } from '../lib/customer360Service.js';
import { syncZohoDocs } from '../lib/pnlService.js';
import InteractionsLog from '../components/InteractionsLog.jsx';
import WhatsAppSendModal from '../components/WhatsAppSendModal.jsx';
import { normalizeSaudiPhone } from '../lib/whatsappService.js';
import { useAuth } from '../lib/auth.jsx';

// ── Formatters ───────────────────────────────────────────────────
const fmt = (n) => (n == null || Number.isNaN(n)) ? '—'
  : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtCount = (n) => (n == null) ? '—' : Number(n).toLocaleString('en-US');
const fmtCompact = (n) => {
  if (n == null) return '—';
  const a = Math.abs(n);
  if (a >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'م';
  if (a >= 1_000) return (n / 1_000).toFixed(1) + 'ك';
  return Number(n).toFixed(0);
};
const fmtDate = (iso) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return iso; }
};
const daysAgo = (iso) => {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso)) / 86_400_000);
};

function CustomerPulseSummary({ t }) {
  const delta = t.monthlyDelta;
  const deltaIsPositive = delta == null ? null : delta >= 0;
  const metrics = [
    { label: 'مديونيات العملاء (الكشف الداخلي)', value: `${fmtCompact(t.totalDebt)} ر.س`, color: 'var(--red)' },
    { label: 'عملاء عليهم دين', value: fmtCount(t.debtorsCount ?? t.customerCount), color: 'var(--text)' },
    { label: 'تنبيهات نشطة', value: fmtCount(t.anomalyCount), color: t.anomalyCount > 0 ? 'var(--gold)' : 'var(--green)' },
    { label: 'إجمالي المحافظ', value: `${fmtCompact(t.totalWallet)} ر.س`, color: t.totalWallet < 0 ? 'var(--red)' : 'var(--green)' },
  ];

  return (
    <Card style={{ padding: '18px 20px', marginBottom: 18 }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(260px, 1.35fr) repeat(4, minmax(120px, 1fr))',
        gap: 12,
        alignItems: 'stretch',
      }} className="customer-pulse-grid">
        <div style={{
          border: '1px solid color-mix(in srgb, var(--green) 24%, var(--border))',
          background: 'linear-gradient(135deg, color-mix(in srgb, var(--green) 9%, var(--surface)), var(--surface))',
          borderRadius: 12,
          padding: '16px 18px',
          minHeight: 128,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}>
          <div>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: '5px 10px',
              borderRadius: 999,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              color: 'var(--muted)',
              fontSize: 10.5,
              fontFamily: 'var(--font-mono)',
              fontWeight: 800,
              textTransform: 'uppercase',
            }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--green)' }}/>
              {t.invoicedSource === 'zoho' ? 'زوهو مباشر' : 'فواتير الشهر'}
            </div>
            <div style={{ marginTop: 12, color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.6 }}>
              إجمالي فواتير هذا الشهر{t.invoicedSource === 'zoho' ? ' من زوهو مباشرة، شامل المدفوعة' : ''}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
            <div style={{
              color: 'var(--text)',
              fontFamily: 'var(--font-mono)',
              fontWeight: 900,
              fontSize: 'clamp(28px, 3vw, 42px)',
              lineHeight: 1,
            }}>{fmt(t.monthlyInvoiced)}</div>
            <div style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: 13, marginBottom: 3 }}>ر.س</div>
            {delta != null && (
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '5px 9px',
                borderRadius: 999,
                background: deltaIsPositive ? 'rgba(16,185,129,.12)' : 'rgba(239,68,68,.12)',
                color: deltaIsPositive ? 'var(--green)' : 'var(--red)',
                fontSize: 11.5,
                fontFamily: 'var(--font-mono)',
                fontWeight: 800,
                marginBottom: 2,
              }}>
                {deltaIsPositive ? <TrendingUp size={12}/> : <TrendingDown size={12}/>}
                {Math.abs(delta).toFixed(1)}%
              </span>
            )}
          </div>
        </div>

        {metrics.map((m) => (
          <div key={m.label} style={{
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: '14px 14px',
            background: 'var(--surface)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: 7,
            minHeight: 128,
          }}>
            <div style={{ color: 'var(--muted)', fontSize: 12, fontWeight: 700 }}>{m.label}</div>
            <div style={{
              color: m.color,
              fontFamily: 'var(--font-mono)',
              fontSize: 22,
              lineHeight: 1.1,
              fontWeight: 900,
              direction: 'ltr',
              textAlign: 'right',
            }}>{m.value}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// Map a platform status string + last-shipment recency to a colored
// pill. The platform mostly emits "نشط" / "موقوف" / "محذوف" / "غير
// مفعّل" but we keep the matcher loose (includes()) so wording drift
// doesn't break the badge. If the platform says active but the store
// hasn't shipped in >30d, we down-shift to a "خامل" tone so the
// operator doesn't mistake a dormant active store for a live one.
function statusPillTone(rawStatus, shipDays) {
  const s = String(rawStatus || '').trim();
  // Real values in the platform export today (verified against the
  // latest merchants snapshot): "نشط" / "غير نشط". We still keep the
  // suspended/deleted matchers in case those terms appear in the
  // future. Order matters — "غير نشط" must match BEFORE the bare
  // /نشط/ check or else it would be flagged as active by substring.
  const isSuspended = /موقوف|محذوف|إيقاف|stopped|deleted|disabled/i.test(s);
  const isInactive  = /غير\s*نشط|غير\s*مفعّل|غير\s*مفعل|inactive/i.test(s);
  const isActive    = /^نشط$|active|مفعّل/i.test(s);
  if (isSuspended) return { bg: 'rgba(220,38,38,.12)',  fg: 'var(--red)', label: s || 'موقوف' };
  if (isInactive)  return { bg: 'rgba(122,130,196,.14)',fg: 'color-mix(in srgb, var(--brand-navy) 55%, var(--muted))', label: s || 'غير نشط' };
  if (isActive) {
    if (shipDays != null && shipDays > 30) {
      return { bg: 'color-mix(in srgb, var(--gold) 14%, transparent)', fg: 'var(--gold)', label: 'نشط بلا شحن حديث' };
    }
    return { bg: 'color-mix(in srgb, var(--green) 14%, transparent)', fg: 'var(--green)', label: 'شغّال' };
  }
  return { bg: 'rgba(148,163,184,.16)', fg: 'var(--muted)', label: s || 'غير معروف' };
}

const ANOMALY_META = {
  negative_wallet:    { color: 'var(--red)', icon: AlertOctagon, label: 'رصيد محفظة سالب',     hint: 'دفع مسبق ورصيده ناقص — خطأ تقني' },
  prepaid_with_debt:  { color: '#EF4444', icon: AlertTriangle, label: 'دفع مسبق وعليه دين', hint: 'يدفع من المحفظة لكن عليه فواتير' },
  active_with_debt:   { color: 'color-mix(in srgb, var(--gold) 50%, var(--red))', icon: Flame,         label: 'يشحن الآن وعليه دين', hint: 'آخر شحنة خلال 10 أيام — اتصل اليوم' },
  postpaid_overdue:   { color: 'var(--gold)', icon: Clock,         label: 'متأخر +60 يوم',       hint: 'مرشّح للإيقاف بعد تنبيه' },
  inactive_with_debt: { color: 'color-mix(in srgb, var(--brand-navy) 55%, var(--muted))', icon: Moon,          label: 'موقوف وعليه دين',     hint: 'حصّل قبل الإغلاق النهائي' },
};

// ── Main ──────────────────────────────────────────────────────────
export default function CustomerWatch({ isActive = true }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, can } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncingZoho, setSyncingZoho] = useState(false);
  const [search, setSearch] = useState('');
  const [view, setView] = useState('overview');
  const [listGroup, setListGroup] = useState('finance');
  const [openCustomer, setOpenCustomer] = useState(null);
  const [openAnomaly, setOpenAnomaly] = useState(null);
  const autoOpenedSearch = useRef('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const d = await loadCustomerWatch();
      setData(d);
    } catch (e) {
      toast(`فشل التحميل: ${e.message}`, 'error');
    }
    setLoading(false);
  }, []);

  const syncZohoAndRefresh = useCallback(async () => {
    setSyncingZoho(true);
    try {
      const r = await syncZohoDocs();
      const invoices = r?.results?.invoices ?? r?.invoices ?? 0;
      const payments = r?.results?.customerpayments ?? r?.customerpayments ?? 0;
      toast(`تم تحديث زوهو: ${invoices} فاتورة · ${payments} دفعة`, 'success');
      await refresh();
    } catch (e) {
      toast(`فشل تحديث زوهو: ${e.message}`, 'error');
    }
    setSyncingZoho(false);
  }, [refresh]);

  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh, location.pathname]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const incoming = params.get('customer') || params.get('q');
    if (incoming) {
      setSearch(incoming);
      setView('overview');
    }
  }, [location.search]);

  const t = data?.totals;

  // Cross-customer + merchant search — searches name, store_id, phone.
  // Returns up to 12 results, customer-first, then merchants without
  // a customer row.
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !data) return [];
    const out = [];
    const seen = new Set();
    for (const c of data.customers || []) {
      const hit =
        c.name?.toLowerCase().includes(q) ||
        c.merchant?.storeId?.toLowerCase().includes(q) ||
        c.merchant?.phone?.includes(q) ||
        c.merchant?.storeName?.toLowerCase().includes(q);
      if (hit) {
        out.push({ kind: 'customer', name: c.name, customer: c, merchant: c.merchant || null });
        if (c.merchant?.storeId) seen.add(c.merchant.storeId);
      }
      if (out.length >= 12) break;
    }
    if (out.length < 12) {
      for (const m of data.merchants || []) {
        if (seen.has(m.store_id)) continue;
        const hit =
          m.store_name?.toLowerCase().includes(q) ||
          m.store_id?.toLowerCase().includes(q) ||
          m.phone?.includes(q);
        if (hit) {
          out.push({
            kind: 'merchant',
            name: m.store_name,
            customer: null,
            merchant: {
              storeId: m.store_id, storeName: m.store_name, phone: m.phone,
              billingType: m.billing_type, platformStatus: m.status,
              shipmentCount: m.shipment_count, lastShipmentAt: m.last_shipment_at,
              walletBalance: Number(m.wallet_balance) || 0,
              createdAt: m.created_at_platform, lastTopupAt: m.last_topup_at,
              integrationType: m.integration_type,
            },
          });
          if (out.length >= 12) break;
        }
      }
    }
    return out;
  }, [search, data]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const incoming = params.get('customer') || params.get('q');
    if (params.get('open') !== '1' || !incoming || !data || !searchResults.length) return;
    if (autoOpenedSearch.current === location.search) return;
    const normalized = incoming.replace(/\D/g, '');
    const exact = searchResults.find(result => {
      const merchant = result.merchant || result.customer?.merchant;
      return merchant?.phone?.replace(/\D/g, '') === normalized
        || merchant?.storeId === incoming
        || result.name === incoming;
    }) || searchResults[0];
    autoOpenedSearch.current = location.search;
    setOpenCustomer(exact);
    setSearch('');
  }, [data, location.search, searchResults]);

  // Build chart series + labels from the monthsSeries
  const chartData = useMemo(() => {
    if (!data?.monthsSeries?.length) return null;
    return {
      labels: data.monthsSeries.map(m => m.label),
      series: [
        { data: data.monthsSeries.map(m => m.value), color: 'var(--green)', label: 'مبلغ الفواتير' },
      ],
    };
  }, [data]);

  // Excel export — flexible by which list to dump.
  const handleExport = (listName, rows, columnFn) => {
    if (!rows?.length) { toast('لا توجد بيانات للتصدير', 'info'); return; }
    const aoa = [columnFn('headers'), ...rows.map(r => columnFn('row', r))];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, listName.slice(0, 28));
    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(rtl(wb), `${listName}_${dateStr}.xlsx`);
    toast(`تم تصدير ${rows.length} صف`, 'success');
  };

  return (
    <div style={{ padding: '24px 28px 80px', maxWidth: 1320, margin: '0 auto' }}>
      <PageHeader
        icon={<Users size={22}/>}
        title="ملفات العملاء"
        subtitle="مرجع موحّد للعميل — هويته، وضعه المالي، نشاطه، وتاريخ التواصل"
        meta={data?.snapshot?.receivables
          ? `بيانات الفواتير: snapshot ${data.snapshot.receivables.id}${data.snapshot.merchants ? ` · المتاجر: ${data.snapshot.merchants.id}` : ''}`
          : null}
        actions={
          <>
            <Btn size="md" variant="ghost" onClick={() => navigate('/customer-money?tab=money')}>
              الديون والتحصيل
            </Btn>
          </>
        }
      />

      <details className="customer-source-details">
        <summary>
          <span>مصادر البيانات والتحديث</span>
          <small>زوهو + دليل متاجر لمحة</small>
        </summary>
        <DataConfidenceBar
          active={isActive}
          sourceLabel="Zoho Books API + دليل المتاجر"
          snapshotMeta={data?.snapshot?.receivables
            ? `فواتير ${data.snapshot.receivables.id}${data.snapshot.merchants ? ` · متاجر ${data.snapshot.merchants.id}` : ''}`
            : null}
          canSync={can?.('money.pnl')}
          syncing={syncingZoho}
          refreshing={loading}
          onSync={syncZohoAndRefresh}
          onRefresh={refresh}
          sourcePath="/zoho-data?type=invoices"
        />
      </details>

      {loading && !data ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Spinner size={28}/></div>
      ) : !t ? (
        <Card>
          <Empty
            icon="📊"
            title="لا توجد بيانات بعد"
            sub="ارفع كشف مديونيات + كشف متاجر لتبدأ المتابعة"
          />
        </Card>
      ) : (
        <>
          {/* ── SEARCH BAR ─────────────────────────────────────── */}
          <Card className="customer-search-hero" style={{ padding: '20px 22px', marginBottom: 16, position: 'relative' }}>
            <div className="customer-search-copy">
              <div>
                <div className="customer-search-eyebrow">ابدأ من هنا</div>
                <h2>افتح ملف عميل</h2>
                <p>ابحث بالاسم أو رقم المتجر أو الجوال، ثم راجع كل معلوماته في ملف واحد.</p>
              </div>
              <div className="customer-search-scope">
                <span>المديونية</span>
                <span>المحفظة</span>
                <span>الشحن</span>
                <span>التواصل</span>
              </div>
            </div>
            <div className="customer-search-input">
              <Search size={19} color="var(--brand)"/>
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="اسم العميل، اسم المتجر، رقم المتجر، أو الجوال…"
                autoComplete="off"
                data-lpignore="true" data-form-type="other"
                name="customer-watch-search"
                style={{
                  flex: 1, border: 'none', outline: 'none', background: 'transparent',
                  fontSize: 15, padding: '8px 0', color: 'var(--text)',
                  boxShadow: 'none',
                }}
              />
              {search && (
                <button onClick={() => setSearch('')} style={{
                  background: 'transparent', border: 'none', color: 'var(--muted)',
                  cursor: 'pointer', display: 'flex', alignItems: 'center',
                }}>
                  <X size={14}/>
                </button>
              )}
            </div>
            {search.trim() && (
              <div style={{
                position: 'absolute', insetInline: 0, top: '100%',
                background: 'var(--card)',
                border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
                marginTop: 8, zIndex: 10,
                boxShadow: 'var(--shadow-lg)',
                maxHeight: 420, overflowY: 'auto',
              }}>
                {searchResults.length === 0 ? (
                  <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>
                    لا توجد نتائج لـ "{search}"
                  </div>
                ) : searchResults.map((r, i) => (
                  <div key={i} onClick={() => { setOpenCustomer(r); setSearch(''); }} style={{
                    padding: '11px 16px', cursor: 'pointer',
                    borderBottom: i === searchResults.length - 1 ? 'none' : '1px solid var(--border)',
                    display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                        {r.merchant?.storeName || r.name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, fontFamily: 'var(--font-mono)', direction: 'ltr', textAlign: 'right' }}>
                        {r.merchant?.storeId || '—'}{r.merchant?.phone && ` · ${r.merchant.phone}`}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {r.customer?.total > 0 && (
                        <span style={{
                          fontSize: 11, padding: '3px 9px', borderRadius: 999,
                          background: 'rgba(239,68,68,.10)', color: 'var(--red)',
                          fontFamily: 'var(--font-mono)', fontWeight: 700,
                        }}>{fmtCompact(r.customer.total)} ر.س</span>
                      )}
                      {r.kind === 'merchant' && (
                        <span style={{
                          fontSize: 10, padding: '2px 8px', borderRadius: 999,
                          background: 'var(--accent-dim)', color: 'var(--accent)',
                          fontWeight: 600,
                        }}>متجر بدون فواتير</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <div className="customer-view-tabs" role="tablist" aria-label="أقسام ملفات العملاء">
            {[
              ['overview', 'ملخص العملاء', 'الأرقام الرئيسية واتجاه النشاط'],
              ['risks', 'مراقبة المخاطر', `${fmtCount(t.anomalyCount)} حالة تحتاج انتباه`],
              ['lists', 'القوائم المرجعية', 'الأعلى نشاطاً وديناً والأحدث'],
            ].map(([id, label, sub]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={view === id}
                className={view === id ? 'active' : ''}
                onClick={() => setView(id)}
              >
                <strong>{label}</strong>
                <span>{sub}</span>
              </button>
            ))}
          </div>

          {view === 'overview' && <CustomerPulseSummary t={t} />}

          {/* ── MONTHLY INVOICING TREND ────────────────────────── */}
          {view === 'overview' && chartData && chartData.series[0].data.some(v => v > 0) && (
            <Card style={{ padding: '24px 28px', marginBottom: 24 }}>
              <SectionTitle
                tag="الاتجاه · 12 شهراً"
                title="تطوّر الفوترة الشهرية"
                color="var(--green)"
              />
              <AreaChart series={chartData.series} labels={chartData.labels} height={240}/>
            </Card>
          )}

          {/* ── TODAY'S PRIORITIES ─────────────────────────────── */}
          {view === 'risks' && data.todayActions?.length > 0 && (
            <Card style={{ padding: '20px 24px', marginBottom: 28 }}>
              <SectionTitle
                tag="أولويات اليوم"
                title="اليوم تحتاج"
                color="var(--gold)"
                action={
                  <Btn size="sm" variant="ghost" onClick={() => navigate('/customer-money?tab=internal')}>
                    فتح المطابقة الداخلية
                  </Btn>
                }
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {data.todayActions.map((a, i) => {
                  const meta = ANOMALY_META[a.kind];
                  const Icon = meta?.icon || AlertTriangle;
                  return (
                    <div key={i} onClick={() => setOpenCustomer({
                      kind: a.c.merchant ? 'customer' : 'phantom',
                      name: a.c.name, customer: a.c, merchant: a.c.merchant,
                    })} style={{
                      display: 'grid',
                      gridTemplateColumns: '28px 1fr auto auto',
                      gap: 14, alignItems: 'center',
                      padding: '12px 14px',
                      background: `color-mix(in srgb, ${meta?.color || '#71717A'} 5%, transparent)`,
                      borderRadius: 12, cursor: 'pointer',
                      transition: 'background .15s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = `color-mix(in srgb, ${meta?.color || '#71717A'} 10%, transparent)`}
                    onMouseLeave={e => e.currentTarget.style.background = `color-mix(in srgb, ${meta?.color || '#71717A'} 5%, transparent)`}>
                      <div style={{
                        width: 28, height: 28, borderRadius: 8,
                        background: `color-mix(in srgb, ${meta?.color || '#71717A'} 16%, transparent)`,
                        color: meta?.color || '#71717A',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}><Icon size={14}/></div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {a.c.merchant?.storeName || a.c.name}
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
                          {a.action}
                        </div>
                      </div>
                      <div style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: meta?.color || 'var(--text)', fontFamily: 'var(--font-mono)' }}>
                          {a.kind === 'negative_wallet'
                            ? `${fmtCompact(a.c.merchant?.walletBalance || 0)} ر.س`
                            : `${fmtCompact(a.c.total || 0)} ر.س`}
                        </div>
                        {a.c.merchant?.phone && (
                          <div style={{ fontSize: 10.5, color: 'var(--muted)', fontFamily: 'var(--font-mono)', direction: 'ltr', marginTop: 2 }}>
                            {a.c.merchant.phone}
                          </div>
                        )}
                      </div>
                      <ArrowLeft size={14} color="var(--muted2)"/>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* ── QUICK STATS (merchant-side) ─────────────────────── */}
          {view === 'overview' && (
            <>
              <SectionTitle tag="حجم القاعدة" title="حالة متاجر العملاء"/>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 12, marginBottom: 28,
              }}>
                <QuickStat icon={<ShoppingBag/>}  label="إجمالي المتاجر"      value={fmtCount(t.merchantsCount)} color="var(--green)"/>
                <QuickStat icon={<UserPlus/>}     label="نشط حالياً"           value={fmtCount(t.activeCount)} hint={`${t.inactiveCount} غير نشط`} color="var(--green)"/>
                <QuickStat icon={<TrendingUp/>}   label="جدد آخر 30 يوم"       value={fmtCount(t.newLast30Days)} hint={`${t.newThisMonth} هذا الشهر`} color="var(--brand)"/>
                <QuickStat icon={<ZapOff/>}       label="لم يبدأ الشحن"        value={fmtCount(t.neverShipped)} hint="سجّل ولم ينفّذ أول شحنة" color="#EF4444"/>
                <QuickStat icon={<Wallet/>}       label="أرصدة محافظ موجبة"    value={`${fmtCompact(t.walletPositiveTotal)} ر.س`} color="var(--green)"/>
                <QuickStat icon={<Wallet/>}       label="أرصدة محافظ سالبة"    value={`${fmtCompact(Math.abs(t.walletNegativeTotal))} ر.س`} color="var(--red)"/>
              </div>
            </>
          )}

          {/* ── ANOMALIES — five tiles, click to drill into receivables ── */}
          {view === 'risks' && t.anomalyCount > 0 && (
            <>
              <SectionTitle
                tag="التنبيهات"
                title={`تنبيهات تحتاج إجراء (${t.anomalyCount})`}
                color="#EF4444"
                action={
                  <Btn size="sm" variant="ghost" onClick={() => navigate('/customer-money?tab=internal')}>
                    فتح المطابقة الداخلية
                  </Btn>
                }
              />
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 12, marginBottom: 28,
              }}>
                {Object.entries(data.anomalies).map(([key, list]) => {
                  if (!list.length) return null;
                  const meta = ANOMALY_META[key];
                  const Icon = meta.icon;
                  // For negative_wallet the meaningful aggregate is the
                  // absolute sum of the negative wallet balances — most
                  // entries are phantoms (no AR row) so their c.total is
                  // 0 and summing it under-reports the real exposure.
                  // For every other bucket the receivables debt is what
                  // matters.
                  const total = key === 'negative_wallet'
                    ? list.reduce((s, c) => s + Math.abs(Number(c.merchant?.walletBalance) || 0), 0)
                    : list.reduce((s, c) => s + (Number(c.total) || 0), 0);
                  return (
                    <Card key={key} hover onClick={() => setOpenAnomaly(key)} style={{
                      padding: '16px 18px',
                      cursor: 'pointer',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: 9,
                          background: `color-mix(in srgb, ${meta.color} 14%, transparent)`,
                          color: meta.color,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}><Icon size={16}/></div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {meta.label}
                          </div>
                        </div>
                        <span style={{
                          fontSize: 13, fontFamily: 'var(--font-mono)', fontWeight: 700,
                          color: meta.color, minWidth: 24, textAlign: 'left',
                        }}>{list.length}</span>
                      </div>
                      <div style={{
                        fontSize: 18, fontFamily: 'var(--font-mono)', fontWeight: 700,
                        color: meta.color, letterSpacing: -0.3,
                      }}>
                        {fmt(total)}
                        <span style={{ fontSize: 11, color: 'var(--muted)', marginRight: 4, fontWeight: 500 }}> ر.س</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>{meta.hint}</div>
                      <div style={{
                        fontSize: 11, color: meta.color, marginTop: 10,
                        fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4,
                      }}>
                        اضغط لعرض القائمة <ArrowLeft size={12}/>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </>
          )}

          {/* ── TOP-N LISTS ──────────────────────────────────────── */}
          {view === 'lists' && (
            <>
          <SectionTitle tag="مرجع سريع" title="استكشف قاعدة العملاء"/>
          <div className="customer-list-groups" role="tablist" aria-label="نوع القائمة">
            {[
              ['finance', 'المال والمخاطر'],
              ['activity', 'الاستخدام والنشاط'],
              ['growth', 'النمو والاستعادة'],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={listGroup === id}
                className={listGroup === id ? 'active' : ''}
                onClick={() => setListGroup(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="customer-reference-grid">
            {listGroup === 'finance' && (
            <TopList
              icon={<AlertTriangle size={14}/>}
              accent="#EF4444"
              title="أعلى المديونيات"
              sub="عملاء عليهم أكبر مبالغ مستحقّة"
              rows={data.top.byDebt}
              valueLabel="ر.س"
              renderRow={(c) => ({
                name: c.merchant?.storeName || c.name,
                sub:  c.merchant?.phone ? <span style={{ direction: 'ltr' }}>{c.merchant.phone}</span> : `${c.invoiceCount} فاتورة`,
                value: fmtCompact(c.total),
                meta: c.daysOutstanding ? `${c.daysOutstanding}ي متأخر` : null,
              })}
              empty="لا توجد مديونيات"
              onRowClick={(c) => setOpenCustomer({ kind: 'customer', name: c.name, customer: c, merchant: c.merchant })}
              onExport={() => handleExport('أعلى_المديونيات', data.top.byDebt, (kind, c) => kind === 'headers'
                ? ['اسم العميل', 'المتجر', 'الهاتف', 'الإجمالي', 'عدد الفواتير', 'أقدم فاتورة', 'الأيام']
                : [c.name, c.merchant?.storeName || '', c.merchant?.phone || '', c.total?.toFixed(2) || 0, c.invoiceCount || 0, c.oldestInvoiceDate || '', c.daysOutstanding || ''])}
            />
            )}
            {listGroup === 'activity' && (
            <TopList
              icon={<TrendingUp size={14}/>}
              accent="var(--green)"
              title="أنشط المتاجر شحناً"
              sub="الأكثر استخداماً للمنصّة"
              rows={data.top.byShipments}
              valueLabel="شحنة"
              renderRow={(m) => ({
                name: m.store_name,
                sub: m.phone ? <span style={{ direction: 'ltr' }}>{m.phone}</span> : m.store_id,
                value: fmtCount(m.shipment_count),
                meta: m.last_shipment_at ? `آخر شحنة ${daysAgo(m.last_shipment_at)}ي` : null,
              })}
              empty="لا توجد بيانات شحن"
              onRowClick={(m) => setOpenCustomer({ kind: 'merchant', name: m.store_name, customer: null,
                merchant: { storeId: m.store_id, storeName: m.store_name, phone: m.phone, billingType: m.billing_type, platformStatus: m.status, shipmentCount: m.shipment_count, lastShipmentAt: m.last_shipment_at, walletBalance: Number(m.wallet_balance) || 0, createdAt: m.created_at_platform, lastTopupAt: m.last_topup_at, integrationType: m.integration_type } })}
              onExport={() => handleExport('أنشط_المتاجر', data.top.byShipments, (kind, m) => kind === 'headers'
                ? ['اسم المتجر', 'رقم المتجر', 'الهاتف', 'عدد الشحنات', 'آخر شحنة', 'حالة المتجر', 'نوع الفوترة']
                : [m.store_name, m.store_id, m.phone || '', m.shipment_count, m.last_shipment_at || '', m.status || '', m.billing_type || ''])}
            />
            )}
            {listGroup === 'finance' && (
            <TopList
              icon={<Wallet size={14}/>}
              accent="var(--brand)"
              title="أكبر المحافظ"
              sub="رصيد دفع مسبق نشط"
              rows={data.top.byWallet}
              valueLabel="ر.س"
              renderRow={(m) => ({
                name: m.store_name,
                sub: m.phone ? <span style={{ direction: 'ltr' }}>{m.phone}</span> : m.store_id,
                value: fmtCompact(m.wallet_balance),
                meta: m.last_topup_at ? `آخر شحن ${daysAgo(m.last_topup_at)}ي` : null,
              })}
              empty="لا توجد محافظ نشطة"
              onRowClick={(m) => setOpenCustomer({ kind: 'merchant', name: m.store_name, customer: null,
                merchant: { storeId: m.store_id, storeName: m.store_name, phone: m.phone, billingType: m.billing_type, platformStatus: m.status, shipmentCount: m.shipment_count, lastShipmentAt: m.last_shipment_at, walletBalance: Number(m.wallet_balance) || 0, createdAt: m.created_at_platform, lastTopupAt: m.last_topup_at, integrationType: m.integration_type } })}
              onExport={() => handleExport('أكبر_المحافظ', data.top.byWallet, (kind, m) => kind === 'headers'
                ? ['اسم المتجر', 'رقم المتجر', 'الهاتف', 'الرصيد', 'آخر شحن للمحفظة']
                : [m.store_name, m.store_id, m.phone || '', Number(m.wallet_balance).toFixed(2), m.last_topup_at || ''])}
            />
            )}
            {listGroup === 'finance' && (
            <TopList
              icon={<AlertOctagon size={14}/>}
              accent="var(--red)"
              title="محافظ بأرصدة سالبة"
              sub="خطأ تقني — يحتاج تحقيق"
              rows={data.top.walletDebtors}
              valueLabel="ر.س"
              renderRow={(m) => ({
                name: m.store_name,
                sub: m.phone ? <span style={{ direction: 'ltr' }}>{m.phone}</span> : m.store_id,
                value: fmtCompact(m.wallet_balance),
                meta: m.billing_type || null,
              })}
              empty="لا توجد أرصدة سالبة"
              onRowClick={(m) => setOpenCustomer({ kind: 'merchant', name: m.store_name, customer: null,
                merchant: { storeId: m.store_id, storeName: m.store_name, phone: m.phone, billingType: m.billing_type, platformStatus: m.status, shipmentCount: m.shipment_count, lastShipmentAt: m.last_shipment_at, walletBalance: Number(m.wallet_balance) || 0, createdAt: m.created_at_platform, lastTopupAt: m.last_topup_at, integrationType: m.integration_type } })}
              onExport={() => handleExport('محافظ_سالبة', data.top.walletDebtors, (kind, m) => kind === 'headers'
                ? ['اسم المتجر', 'رقم المتجر', 'الهاتف', 'الرصيد السالب', 'نوع الفوترة']
                : [m.store_name, m.store_id, m.phone || '', Number(m.wallet_balance).toFixed(2), m.billing_type || ''])}
            />
            )}
            {listGroup === 'growth' && (
            <TopList
              icon={<UserPlus size={14}/>}
              accent="var(--accent)"
              title="أحدث التسجيلات"
              sub="آخر 10 متاجر انضمّت للمنصّة"
              rows={data.top.newest}
              valueLabel="اشترك"
              renderRow={(m) => ({
                name: m.store_name,
                sub: m.phone ? <span style={{ direction: 'ltr' }}>{m.phone}</span> : m.store_id,
                value: fmtDate(m.created_at_platform),
                meta: (m.shipment_count || 0) === 0 ? 'لم يشحن بعد' : `${m.shipment_count} شحنة`,
              })}
              empty="لا تسجيلات جديدة"
              onRowClick={(m) => setOpenCustomer({ kind: 'merchant', name: m.store_name, customer: null,
                merchant: { storeId: m.store_id, storeName: m.store_name, phone: m.phone, billingType: m.billing_type, platformStatus: m.status, shipmentCount: m.shipment_count, lastShipmentAt: m.last_shipment_at, walletBalance: Number(m.wallet_balance) || 0, createdAt: m.created_at_platform, lastTopupAt: m.last_topup_at, integrationType: m.integration_type } })}
              onExport={() => handleExport('أحدث_التسجيلات', data.top.newest, (kind, m) => kind === 'headers'
                ? ['اسم المتجر', 'رقم المتجر', 'الهاتف', 'تاريخ التسجيل', 'عدد الشحنات', 'حالة المتجر']
                : [m.store_name, m.store_id, m.phone || '', m.created_at_platform || '', m.shipment_count || 0, m.status || ''])}
            />
            )}
            {listGroup === 'growth' && (
            <TopList
              icon={<ZapOff size={14}/>}
              accent="color-mix(in srgb, var(--brand-navy) 55%, var(--muted))"
              title="توقّفوا عن الشحن (يمكن استرجاعهم)"
              sub="مُعطَّلون لكن شحنوا سابقاً"
              rows={data.top.churned}
              valueLabel=""
              renderRow={(m) => ({
                name: m.store_name,
                sub: m.phone ? <span style={{ direction: 'ltr' }}>{m.phone}</span> : m.store_id,
                value: m.last_shipment_at ? fmtDate(m.last_shipment_at) : '—',
                meta: `${m.shipment_count} شحنة في حياته`,
              })}
              empty="لا يوجد عملاء فُقدوا — ممتاز"
              onRowClick={(m) => setOpenCustomer({ kind: 'merchant', name: m.store_name, customer: null,
                merchant: { storeId: m.store_id, storeName: m.store_name, phone: m.phone, billingType: m.billing_type, platformStatus: m.status, shipmentCount: m.shipment_count, lastShipmentAt: m.last_shipment_at, walletBalance: Number(m.wallet_balance) || 0, createdAt: m.created_at_platform, lastTopupAt: m.last_topup_at, integrationType: m.integration_type } })}
              onExport={() => handleExport('فُقدوا', data.top.churned, (kind, m) => kind === 'headers'
                ? ['اسم المتجر', 'رقم المتجر', 'الهاتف', 'عدد الشحنات', 'آخر شحنة', 'تاريخ التسجيل']
                : [m.store_name, m.store_id, m.phone || '', m.shipment_count || 0, m.last_shipment_at || '', m.created_at_platform || ''])}
            />
            )}
          </div>
            </>
          )}
        </>
      )}

      {openCustomer && (
        <CustomerDrillDown
          entry={openCustomer}
          customers={data?.customers || []}
          merchants={data?.merchants || []}
          profile={profile}
          onSelect={(e) => setOpenCustomer(e)}
          onClose={() => setOpenCustomer(null)}
        />
      )}

      {openAnomaly && data?.anomalies && (
        <AnomalyListModal
          kind={openAnomaly}
          rows={data.anomalies[openAnomaly] || []}
          onClose={() => setOpenAnomaly(null)}
          onRowClick={(c) => {
            setOpenCustomer({
              kind: c.merchant ? 'customer' : 'phantom',
              name: c.name,
              customer: c,
              merchant: c.merchant,
            });
            setOpenAnomaly(null);
          }}
        />
      )}
    </div>
  );
}

// ── AnomalyListModal ─────────────────────────────────────────────
// Full list of customers/merchants in one anomaly bucket. Sorted by
// financial impact (debt or wallet) descending. Each row clickable
// → opens the drill-down modal. Includes Excel export of the bucket.
function AnomalyListModal({ kind, rows, onClose, onRowClick }) {
  const [waOpen, setWaOpen] = useState(false);   // §هيكلة-0: إطلاق مباشر بدل ملف فقط
  const meta = ANOMALY_META[kind];
  if (!meta) return null;
  const Icon = meta.icon;

  const sortKeyFor = (r) =>
    kind === 'negative_wallet'
      ? Math.abs(Number(r.merchant?.walletBalance) || 0)
      : Number(r.total) || 0;
  const sorted = [...rows].sort((a, b) => sortKeyFor(b) - sortKeyFor(a));
  const total = rows.reduce((s, c) =>
    s + (kind === 'negative_wallet'
      ? Math.abs(Number(c.merchant?.walletBalance) || 0)
      : Number(c.total) || 0), 0);

  const handleExport = () => {
    if (!rows.length) return;
    // Common operational signals every row carries — included in every
    // anomaly export so the collection campaign list always has the
    // "is this store alive?" context (status + last shipment + last
    // wallet top-up).
    const baseOps = ['حالة المنصّة', 'نوع الفوترة', 'آخر شحنة', 'أيام منذ آخر شحنة', 'آخر شحن رصيد', 'أيام منذ آخر شحن رصيد', 'الرصيد الحالي'];
    const opsCells = (m) => [
      m?.platformStatus || '',
      m?.billingType    || '',
      m?.lastShipmentAt ? m.lastShipmentAt.slice(0, 10) : '',
      m?.lastShipmentAt ? (daysAgo(m.lastShipmentAt) ?? '') : '',
      m?.lastTopupAt    ? m.lastTopupAt.slice(0, 10)    : '',
      m?.lastTopupAt    ? (daysAgo(m.lastTopupAt)    ?? '') : '',
      m?.walletBalance != null ? Number(m.walletBalance).toFixed(2) : '',
    ];
    const headers = kind === 'negative_wallet'
      ? ['اسم المتجر', 'رقم المتجر', 'الهاتف', 'الرصيد السالب', 'الدين الحالي', ...baseOps]
      : ['اسم العميل', 'اسم المتجر', 'رقم المتجر', 'الهاتف', 'المديونية', 'عدد الفواتير', 'أقدم فاتورة', 'الأيام', ...baseOps];
    const xRows = sorted.map(r => kind === 'negative_wallet'
      ? [r.merchant?.storeName || r.name, r.merchant?.storeId || '', r.merchant?.phone || '', Number(r.merchant?.walletBalance || 0).toFixed(2), Number(r.total || 0).toFixed(2), ...opsCells(r.merchant)]
      : [r.name, r.merchant?.storeName || '', r.merchant?.storeId || '', r.merchant?.phone || '', Number(r.total || 0).toFixed(2), r.invoiceCount || 0, r.oldestInvoiceDate || '', r.daysOutstanding || '', ...opsCells(r.merchant)]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...xRows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, meta.label.slice(0, 28));
    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(rtl(wb), `${meta.label}_${dateStr}.xlsx`);
    toast(`تم تصدير ${rows.length} صف`, 'success');
  };

  // Slim 3-column WhatsApp campaign export — only for negative_wallet.
  // Columns map 1:1 to the utility template variables:
  //   col 1: phone (for sending; not a template variable)
  //   col 2: store name → {{1}}
  //   col 3: balance (absolute value, signed in the template text) → {{2}}
  // Phones are normalized (drop non-digits, prepend 966 if missing) so
  // the bulk-sender doesn't need to clean them. Rows without a phone
  // are skipped — the operator gets a count in the toast.
  const handleExportCampaign = () => {
    if (kind !== 'negative_wallet') return;
    const normalizePhone = (raw) => {
      if (raw == null) return null;
      let s = String(raw).replace(/\D/g, '');
      if (!s) return null;
      if (s.startsWith('00966')) s = s.slice(2);          // 00966… → 966…
      else if (s.startsWith('0')) s = '966' + s.slice(1); // 05xxx → 9665xxx
      else if (!s.startsWith('966')) s = '966' + s;       // bare 5xxx → 966 5xxx
      return s.length >= 11 ? s : null;
    };
    const headers = ['رقم الجوال', 'اسم المتجر', 'الرصيد'];
    const xRows = [];
    let skipped = 0;
    for (const r of sorted) {
      const phone = normalizePhone(r.merchant?.phone);
      if (!phone) { skipped++; continue; }
      const name = r.merchant?.storeName || r.name;
      // Keep the sign — the wallet IS negative and that's the whole
      // point of this bucket. Excel will render it as -19.00 / -385.40
      // exactly as it appears on screen.
      const bal  = (Number(r.merchant?.walletBalance) || 0).toFixed(2);
      xRows.push([phone, name, bal]);
    }
    if (!xRows.length) {
      toast('لا توجد متاجر بأرقام جوال صالحة', 'warning');
      return;
    }
    const ws = XLSX.utils.aoa_to_sheet([headers, ...xRows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'حملة');
    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(rtl(wb), `حملة_رصيد_سالب_${dateStr}.xlsx`);
    toast(
      skipped
        ? `تم تصدير ${xRows.length} متجر · تخطّينا ${skipped} بدون جوال`
        : `تم تصدير ${xRows.length} متجر للحملة`,
      'success',
    );
  };

  return (
    <Modal title={`${meta.label} — ${rows.length} عميل`} onClose={onClose} width={820}>
      {/* Header strip with total + export */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '14px 16px', marginBottom: 14,
        background: `color-mix(in srgb, ${meta.color} 8%, transparent)`,
        borderRadius: 12,
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10,
          background: `color-mix(in srgb, ${meta.color} 16%, transparent)`,
          color: meta.color,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}><Icon size={18}/></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{meta.hint}</div>
          <div style={{
            fontSize: 22, fontFamily: 'var(--font-mono)', fontWeight: 700,
            color: meta.color, letterSpacing: -0.4, marginTop: 4,
          }}>
            {fmt(total)} <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>ر.س</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {kind === 'negative_wallet' && (
            <>
              {/* §هيكلة-0: إطلاق مباشر من نفس الصفوف — الملف يبقى خياراً ثانوياً */}
              <Btn size="md" variant="primary" icon={<Send size={13}/>} onClick={() => setWaOpen(true)}>
                إطلاق حملة
              </Btn>
              <Btn size="md" variant="ghost" icon={<Phone size={13}/>} onClick={handleExportCampaign}>
                ملف حملة (٣ أعمدة)
              </Btn>
            </>
          )}
          <Btn size="md" variant="ghost" icon={<Download size={13}/>} onClick={handleExport}>
            تصدير Excel
          </Btn>
        </div>
      </div>

      {/* Scrollable list */}
      <div className="m-flow" style={{
        border: '1px solid var(--border)', borderRadius: 12,
        maxHeight: 480, overflowY: 'auto',
      }}>
        {sorted.map((c, i) => {
          const m = c.merchant;
          const value = kind === 'negative_wallet'
            ? Number(m?.walletBalance || 0)
            : Number(c.total || 0);
          // Operational signals: "is this store alive right now?" — the
          // operator wants to see, before calling, whether the store is
          // still active on the platform and how recent its last
          // shipment / wallet top-up are.
          const shipDays = m?.lastShipmentAt ? daysAgo(m.lastShipmentAt) : null;
          const topupDays = m?.lastTopupAt   ? daysAgo(m.lastTopupAt)   : null;
          const statusTone = statusPillTone(m?.platformStatus, shipDays);
          return (
            <div key={(m?.storeId || c.name) + i} onClick={() => onRowClick(c)} style={{
              display: 'grid',
              gridTemplateColumns: '28px 1fr auto auto',
              gap: 12, padding: '12px 16px',
              borderBottom: i === sorted.length - 1 ? 'none' : '1px solid var(--border)',
              alignItems: 'center',
              cursor: 'pointer',
              transition: 'background .12s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <span style={{ fontSize: 10.5, color: 'var(--muted2)', fontFamily: 'var(--font-mono)', fontWeight: 700, textAlign: 'center' }}>
                {i + 1}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {m?.storeName || c.name}
                  </span>
                  {m?.platformStatus && (
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 7px',
                      borderRadius: 999, whiteSpace: 'nowrap', flexShrink: 0,
                      background: statusTone.bg,
                      color:      statusTone.fg,
                    }}>
                      {statusTone.label}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, fontFamily: m?.phone ? 'var(--font-mono)' : 'inherit', direction: m?.phone ? 'ltr' : 'rtl', textAlign: 'right' }}>
                  {m?.phone ? m.phone : m?.storeId ? m.storeId : `${c.invoiceCount || 0} فاتورة`}
                </div>
                {/* Ops signals strip — only shown when merchant linked */}
                {m && (shipDays != null || topupDays != null || m.billingType) && (
                  <div style={{
                    display: 'flex', flexWrap: 'wrap', gap: 10,
                    marginTop: 6, fontSize: 10.5, color: 'var(--muted)',
                  }}>
                    {m.billingType && (
                      <span title="نوع الفوترة">
                        <span style={{ opacity: .65 }}>الفوترة:</span>{' '}
                        <span style={{ color: 'var(--text2)', fontWeight: 600 }}>{m.billingType}</span>
                      </span>
                    )}
                    {shipDays != null && (
                      <span title={`آخر شحنة: ${m.lastShipmentAt.slice(0,10)}`}>
                        🚚 <span style={{
                          color: shipDays <= 10 ? 'var(--green)' : shipDays <= 30 ? 'var(--gold)' : 'var(--muted)',
                          fontWeight: 600,
                        }}>{shipDays === 0 ? 'اليوم' : `قبل ${shipDays}ي`}</span>
                      </span>
                    )}
                    {topupDays != null && (
                      <span title={`آخر شحن رصيد: ${m.lastTopupAt.slice(0,10)}`}>
                        💰 <span style={{
                          color: topupDays <= 30 ? 'var(--green)' : topupDays <= 90 ? 'var(--gold)' : 'var(--muted)',
                          fontWeight: 600,
                        }}>قبل {topupDays}ي</span>
                      </span>
                    )}
                    {m.walletBalance != null && Math.abs(Number(m.walletBalance)) > 0.5 && (
                      <span title="رصيد المحفظة الحالي">
                        رصيد المحفظة:{' '}
                        <span style={{
                          color: Number(m.walletBalance) < 0 ? 'var(--red)' : 'var(--text2)',
                          fontWeight: 700, fontFamily: 'var(--font-mono)',
                        }}>{fmtCompact(Number(m.walletBalance))}</span>
                      </span>
                    )}
                  </div>
                )}
                {!m && (
                  <div style={{ fontSize: 10, color: 'var(--muted2)', marginTop: 4, fontStyle: 'italic' }}>
                    ⚠ غير مرتبط بمتجر — اربطه من /merchants
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: meta.color, fontFamily: 'var(--font-mono)', letterSpacing: -0.3 }}>
                  {fmtCompact(value)}
                  <span style={{ fontSize: 10, color: 'var(--muted)', marginRight: 3, fontWeight: 500 }}> ر.س</span>
                </div>
                {kind !== 'negative_wallet' && c.daysOutstanding != null && (
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                    {c.daysOutstanding}ي متأخر
                  </div>
                )}
              </div>
              <ArrowLeft size={14} color="var(--muted2)"/>
            </div>
          );
        })}
      </div>

      {/* §هيكلة-0: إطلاق حملة من نفس صفوف «ملف الحملة» (رصيد سالب) مباشرة */}
      {waOpen && (
        <WhatsAppSendModal open={waOpen}
          recipients={sorted.filter(r => r.merchant?.phone).map(r => {
            const name = r.merchant?.storeName || r.name;
            const bal = Number(r.merchant?.walletBalance) || 0;
            return { to: normalizeSaudiPhone(r.merchant.phone), name, amount: Math.abs(bal),
              vars: [name, bal.toFixed(2)] };
          })}
          bucketLabel={meta.label}
          onClose={() => setWaOpen(false)} onSent={() => setWaOpen(false)}/>
      )}
    </Modal>
  );
}

// ── CustomerDrillDown ────────────────────────────────────────────
// Full 360 modal for one customer/merchant. Shows: identity, billing
// status, shipment activity, wallet, receivables totals, recent
// invoices (if any). One-click phone CTA for the operator.
function CustomerDrillDown({ entry, customers = [], merchants = [], profile, onSelect, onClose }) {
  const c = entry.customer;
  const m = entry.merchant;
  const debt = Number(c?.total) || 0;
  const wallet = Number(m?.walletBalance) || 0;

  // Normalize phone for matching: strip non-digits, drop a leading
  // country prefix (+966 / 00966 / 966) and a leading zero so all the
  // variants of the same number collapse to one key.
  const normalizePhone = (raw) => {
    if (!raw) return null;
    let s = String(raw).replace(/\D/g, '');
    if (s.startsWith('00966')) s = s.slice(5);
    else if (s.startsWith('966')) s = s.slice(3);
    if (s.startsWith('0')) s = s.slice(1);
    return s.length >= 8 ? s : null;
  };
  const myPhone = normalizePhone(m?.phone);
  const myStoreId = m?.storeId || null;

  // Sibling search: any merchant in the directory with the same phone,
  // excluding the current one. Each sibling carries the merchant data
  // PLUS, if it appears in receivables, the linked customer record so
  // we can show debt context inline.
  const siblings = useMemo(() => {
    if (!myPhone) return [];
    const out = [];
    const seen = new Set();
    if (myStoreId) seen.add(myStoreId);
    // Build a customer lookup by storeId for quick AR overlay
    const customerByStoreId = new Map();
    for (const cu of customers) {
      const sid = cu.merchant?.storeId;
      if (sid) customerByStoreId.set(sid, cu);
    }
    for (const mm of merchants) {
      if (seen.has(mm.store_id)) continue;
      if (normalizePhone(mm.phone) !== myPhone) continue;
      seen.add(mm.store_id);
      const cu = customerByStoreId.get(mm.store_id) || null;
      out.push({
        merchant: {
          storeId: mm.store_id, storeName: mm.store_name, phone: mm.phone,
          billingType: mm.billing_type, platformStatus: mm.status,
          shipmentCount: mm.shipment_count, lastShipmentAt: mm.last_shipment_at,
          walletBalance: Number(mm.wallet_balance) || 0,
          createdAt: mm.created_at_platform, lastTopupAt: mm.last_topup_at,
          integrationType: mm.integration_type,
        },
        customer: cu,
        debt: Number(cu?.total) || 0,
        wallet: Number(mm.wallet_balance) || 0,
        shipments: Number(mm.shipment_count) || 0,
        status: mm.status,
      });
    }
    return out.sort((a, b) => (b.debt + Math.abs(b.wallet)) - (a.debt + Math.abs(a.wallet)));
  }, [myPhone, myStoreId, customers, merchants]);

  // Aggregate across the customer + every sibling — so the operator
  // sees "you're calling this number about 4 stores: 22,400 ر.س total
  // debt, 1 has negative wallet"
  const groupAggregate = useMemo(() => {
    if (!siblings.length) return null;
    const all = [{ merchant: m, customer: c, debt, wallet, shipments: m?.shipmentCount || 0, status: m?.platformStatus }, ...siblings];
    return {
      stores: all.length,
      totalDebt: all.reduce((s, x) => s + (Number(x.debt) || 0), 0),
      totalWallet: all.reduce((s, x) => s + (Number(x.wallet) || 0), 0),
      negWalletCount: all.filter(x => Number(x.wallet) < -0.5).length,
      totalShipments: all.reduce((s, x) => s + (Number(x.shipments) || 0), 0),
      activeCount: all.filter(x => x.status === 'نشط').length,
    };
  }, [siblings, m, c, debt, wallet]);

  // Title preference: full customer_name from receivables (e.g.
  // "مشاري سعد نجيب عبد العال - مختلفٌ") > clean merchant store_name
  // (often just the brand suffix, e.g. "مختلفٌ"). Falls back to whatever
  // is present. The receivables name carries the most identifying info.
  const primaryName = c?.name || m?.storeName || 'تفاصيل';
  const showStoreSubtitle = c?.name && m?.storeName && m.storeName !== c.name;
  const initial = (primaryName.replace(/^\s+/, '').slice(0, 1)) || '?';

  // Activity log lives inside InteractionsLog (shared with /receivables).

  return (
    <Modal title={primaryName} onClose={onClose} width={780}>
      {/* Identity strip */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 16,
        padding: '14px 16px', marginBottom: 18,
        background: 'var(--bg2)', borderRadius: 12,
        alignItems: 'center',
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: 12,
          background: 'var(--accent-dim)', color: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 700, fontSize: 18,
        }}>
          {initial}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: 15, fontWeight: 700, color: 'var(--text)',
            overflow: 'hidden', textOverflow: 'ellipsis',
            display: '-webkit-box', WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 2, lineHeight: 1.35,
          }}>
            {primaryName}
          </div>
          {showStoreSubtitle && (
            <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 3, fontWeight: 500 }}>
              <ShoppingBag size={11} style={{ verticalAlign: 'middle', marginInlineEnd: 4 }}/>
              المتجر على المنصّة: {m.storeName}
            </div>
          )}
          <div style={{ display: 'flex', gap: 14, marginTop: 5, fontSize: 11.5, color: 'var(--muted)', fontFamily: 'var(--font-mono)', flexWrap: 'wrap' }}>
            {m?.storeId && <span><Hash size={11} style={{ verticalAlign: 'middle', marginInlineEnd: 3 }}/>{m.storeId}</span>}
            {m?.phone && <span style={{ direction: 'ltr' }}><Phone size={11} style={{ verticalAlign: 'middle', marginInlineEnd: 3 }}/>{m.phone}</span>}
          </div>
        </div>
        {m?.phone && (
          <IvrCallButton phone={m.phone} name={m.storeName || m.name} fields={{ name: m.storeName || m.name, amount: m.balance ?? m.debt }} label size={13}
            style={{ borderRadius: 999, padding: '8px 14px', background: 'var(--accent)', color: '#fff', border: 'none', fontSize: 12.5, boxShadow: '0 1px 2px color-mix(in srgb, var(--accent) 25%, transparent)' }}/>
        )}
      </div>

      {/* Promise / last-interaction summary banner is rendered inside
          the shared InteractionsLog component below — no inline copy. */}

      {/* Status chips */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {m?.billingType && (
          <Chip color={m.billingType === 'دفع مسبق' ? 'var(--brand)' : 'var(--gold)'} label={m.billingType}/>
        )}
        {m?.platformStatus && (
          <Chip color={m.platformStatus === 'نشط' ? 'var(--green)' : '#71717A'} label={`المنصّة: ${m.platformStatus}`}/>
        )}
        {m?.integrationType && (
          <Chip color="var(--accent)" label={m.integrationType}/>
        )}
        {!m && <Chip color="#71717A" label="غير مرتبط بمتجر"/>}
      </div>

      {/* KPI grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: 10, marginBottom: 18,
      }}>
        <MiniStat label="رصيد المحفظة" value={m ? fmt(wallet) : '—'} suffix="ر.س"
          color={wallet < -0.5 ? 'var(--red)' : wallet > 0 ? 'var(--accent)' : 'var(--muted)'}/>
        <MiniStat label="المديونية" value={fmt(debt)} suffix="ر.س"
          color={debt > 0.5 ? 'var(--red)' : 'var(--muted)'}/>
        <MiniStat label="عدد الشحنات" value={fmtCount(m?.shipmentCount || 0)}/>
        <MiniStat label="آخر شحنة"
          value={m?.lastShipmentAt ? fmtDate(m.lastShipmentAt) : '—'}
          hint={m?.lastShipmentAt ? `${daysAgo(m.lastShipmentAt)} يوم` : null}/>
      </div>

      {/* Secondary info row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: 10, marginBottom: 18,
      }}>
        <MiniStat label="تاريخ التسجيل" value={m?.createdAt ? fmtDate(m.createdAt) : '—'}/>
        <MiniStat label="آخر شحن للمحفظة" value={m?.lastTopupAt ? fmtDate(m.lastTopupAt) : '—'}/>
        <MiniStat label="عدد الفواتير" value={fmtCount(c?.invoiceCount || 0)}/>
        <MiniStat label="أيام التأخير" value={c?.daysOutstanding ? `${c.daysOutstanding} يوم` : '—'}
          color={c?.daysOutstanding > 60 ? 'var(--red)' : c?.daysOutstanding > 30 ? 'var(--gold)' : 'var(--muted)'}/>
      </div>

      {/* Phone siblings — same operator, multiple stores */}
      {siblings.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 10, marginBottom: 10,
          }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--accent)', fontFamily: 'var(--font-mono)', letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: 700, marginBottom: 3 }}>
                نفس الرقم · {siblings.length + 1} متجر
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', letterSpacing: -0.2 }}>
                هذا الرقم يدير {siblings.length + 1} متاجر — اتصال واحد يكفي
              </div>
            </div>
          </div>

          {/* Aggregate banner */}
          {groupAggregate && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
              gap: 8, marginBottom: 12,
              padding: '12px 14px',
              background: 'color-mix(in srgb, var(--accent) 6%, transparent)',
              borderRadius: 12,
            }}>
              <GroupStat label="إجمالي المتاجر" value={fmtCount(groupAggregate.stores)} color="var(--accent)"/>
              <GroupStat label="إجمالي الدين" value={`${fmtCompact(groupAggregate.totalDebt)} ر.س`} color={groupAggregate.totalDebt > 0.5 ? 'var(--red)' : 'var(--muted)'}/>
              <GroupStat label="مجموع المحافظ" value={`${fmtCompact(groupAggregate.totalWallet)} ر.س`} color={groupAggregate.totalWallet < 0 ? 'var(--red)' : 'var(--accent)'}/>
              <GroupStat label="إجمالي الشحنات" value={fmtCount(groupAggregate.totalShipments)}/>
              <GroupStat label="متاجر نشطة" value={`${groupAggregate.activeCount}/${groupAggregate.stores}`}/>
              {groupAggregate.negWalletCount > 0 && (
                <GroupStat label="محافظ سالبة" value={fmtCount(groupAggregate.negWalletCount)} color="var(--red)"/>
              )}
            </div>
          )}

          {/* Sibling list — clickable to switch the modal */}
          <div style={{
            border: '1px solid var(--border)', borderRadius: 12,
            maxHeight: 260, overflowY: 'auto',
          }}>
            {siblings.map((s, i) => {
              const sm = s.merchant;
              const billingColor = sm.billingType === 'دفع مسبق' ? 'var(--brand)' : 'var(--gold)';
              const statusColor  = sm.platformStatus === 'نشط' ? 'var(--green)' : '#71717A';
              return (
                <div
                  key={sm.storeId}
                  onClick={() => onSelect?.({
                    kind: s.customer ? 'customer' : 'merchant',
                    name: s.customer?.name || sm.storeName,
                    customer: s.customer,
                    merchant: sm,
                  })}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'auto 1fr auto auto',
                    gap: 12, padding: '12px 14px',
                    borderBottom: i === siblings.length - 1 ? 'none' : '1px solid var(--border)',
                    alignItems: 'center', cursor: 'pointer',
                    transition: 'background .12s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <div style={{
                    width: 32, height: 32, borderRadius: 9,
                    background: 'var(--accent-dim)', color: 'var(--accent)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, fontWeight: 700,
                  }}>{(sm.storeName || '?').slice(0, 1)}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {sm.storeName}
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                      {sm.billingType && (
                        <span style={{
                          fontSize: 10, padding: '1px 7px', borderRadius: 999,
                          background: `color-mix(in srgb, ${billingColor} 14%, transparent)`,
                          color: billingColor, fontWeight: 600,
                        }}>{sm.billingType}</span>
                      )}
                      <span style={{
                        fontSize: 10, padding: '1px 7px', borderRadius: 999,
                        background: `color-mix(in srgb, ${statusColor} 14%, transparent)`,
                        color: statusColor, fontWeight: 600,
                      }}>{sm.platformStatus || '—'}</span>
                      <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                        {fmtCount(s.shipments)} شحنة
                      </span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                    {s.debt > 0.5 ? (
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--red)', fontFamily: 'var(--font-mono)' }}>
                        {fmtCompact(s.debt)} <span style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 500 }}>دين</span>
                      </div>
                    ) : s.wallet !== 0 ? (
                      <div style={{ fontSize: 13, fontWeight: 700, color: s.wallet < 0 ? 'var(--red)' : 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                        {fmtCompact(s.wallet)} <span style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 500 }}>محفظة</span>
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>—</div>
                    )}
                  </div>
                  <ArrowLeft size={14} color="var(--muted2)"/>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent invoices */}
      {c?.invoices?.length > 0 && (
        <div>
          <div style={{
            fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)',
            letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8, fontWeight: 600,
          }}>
            آخر الفواتير ({c.invoices.length})
          </div>
          <div style={{
            maxHeight: 220, overflowY: 'auto',
            border: '1px solid var(--border)', borderRadius: 12,
          }}>
            {[...c.invoices].reverse().slice(0, 15).map((inv, i, arr) => (
              <div key={inv.id || i} style={{
                display: 'grid', gridTemplateColumns: '1fr auto', gap: 12,
                padding: '10px 14px',
                borderBottom: i === arr.length - 1 ? 'none' : '1px solid var(--border)',
                alignItems: 'center',
              }}>
                <div style={{ fontSize: 12, color: 'var(--text2)', fontFamily: 'var(--font-mono)' }}>
                  {inv.date ? fmtDate(inv.date) : '—'}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
                  {fmt(inv.amount)} <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 500 }}>ر.س</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* سجلّ تواصل العميل الموحّد (حملات + مكالمات آلية بتسجيلها + مَن تولّاه) */}
      {m?.phone && (
        <div style={{ marginTop: 22 }}>
          <CustomerCommTimeline phone={m.phone}/>
        </div>
      )}

      {/* ── Activity log (shared with /receivables drawer) ──── */}
      <div style={{ marginTop: 22 }}>
        <InteractionsLog
          customerName={c?.name || null}
          storeId={m?.storeId || null}
        />
      </div>

    </Modal>
  );
}

function Chip({ color, label }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '4px 12px', borderRadius: 999,
      background: `color-mix(in srgb, ${color} 12%, transparent)`,
      color, fontSize: 11.5, fontWeight: 600,
    }}>{label}</span>
  );
}

function GroupStat({ label, value, color }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 500, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: color || 'var(--text)', fontFamily: 'var(--font-mono)', letterSpacing: -0.2, whiteSpace: 'nowrap' }}>
        {value}
      </div>
    </div>
  );
}

function MiniStat({ label, value, suffix, hint, color }) {
  return (
    <div style={{
      padding: '12px 14px',
      background: 'var(--bg2)', borderRadius: 12,
    }}>
      <div style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 500, marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: color || 'var(--text)', fontFamily: 'var(--font-mono)', letterSpacing: -0.3, whiteSpace: 'nowrap' }}>
        {value}
        {suffix && <span style={{ fontSize: 10, color: 'var(--muted)', marginRight: 4, fontWeight: 500 }}> {suffix}</span>}
      </div>
      {hint && <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

// ── QuickStat ─────────────────────────────────────────────────────
function QuickStat({ icon, label, value, hint, color }) {
  return (
    <div style={{
      background: 'var(--card)',
      borderRadius: 'var(--r-lg)',
      padding: '16px 18px',
      boxShadow: 'var(--shadow-sm)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 500 }}>{label}</span>
        <div style={{
          width: 30, height: 30, borderRadius: 8,
          background: `color-mix(in srgb, ${color} 12%, transparent)`,
          color, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{icon}</div>
      </div>
      <div style={{
        fontSize: 22, fontWeight: 700, color,
        fontFamily: 'var(--font-mono)', letterSpacing: -0.4, lineHeight: 1,
      }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>{hint}</div>}
    </div>
  );
}

// ── TopList ───────────────────────────────────────────────────────
function TopList({ icon, accent, title, sub, rows, valueLabel, renderRow, empty, onRowClick, onExport }) {
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, padding: '14px 18px', borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{
              width: 24, height: 24, borderRadius: 7,
              background: `color-mix(in srgb, ${accent} 14%, transparent)`,
              color: accent,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>{icon}</span>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)', letterSpacing: -0.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{sub}</div>
        </div>
        {onExport && rows?.length > 0 && (
          <button
            onClick={onExport}
            title="تصدير القائمة كـ Excel"
            style={{
              background: 'transparent', border: '1px solid var(--border2)',
              color: 'var(--muted)', borderRadius: 999,
              padding: '6px 10px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 5,
              fontSize: 11.5, fontFamily: 'var(--font-sans)', fontWeight: 600,
              transition: 'all .15s',
              flexShrink: 0,
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.color = accent; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border2)'; e.currentTarget.style.color = 'var(--muted)'; }}
          >
            <Download size={12}/> Excel
          </button>
        )}
      </div>
      <div className="m-flow" style={{ maxHeight: 360, overflowY: 'auto' }}>
        {!rows?.length ? (
          <div style={{ padding: 28, textAlign: 'center', fontSize: 12, color: 'var(--muted)' }}>{empty}</div>
        ) : (
          rows.map((r, i) => {
            const cell = renderRow(r);
            return (
              <div
                key={r.id || r.name || r.store_id || i}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '24px 1fr auto',
                  gap: 12, padding: '10px 18px',
                  borderBottom: i === rows.length - 1 ? 'none' : '1px solid var(--border)',
                  alignItems: 'center',
                  cursor: onRowClick ? 'pointer' : 'default',
                  transition: 'background .12s',
                }}
                onMouseEnter={e => onRowClick && (e.currentTarget.style.background = 'var(--surface2)')}
                onMouseLeave={e => onRowClick && (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{
                  fontSize: 10, color: 'var(--muted2)', fontFamily: 'var(--font-mono)',
                  fontWeight: 700, textAlign: 'center',
                }}>{i + 1}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontSize: 12.5, fontWeight: 600, color: 'var(--text)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{cell.name}</div>
                  <div style={{
                    fontSize: 11, color: 'var(--muted)', marginTop: 2,
                    fontFamily: cell.sub?.props ? 'var(--font-mono)' : 'inherit',
                  }}>{cell.sub}</div>
                </div>
                <div style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                  <div style={{
                    fontSize: 13, fontWeight: 700, color: accent,
                    fontFamily: 'var(--font-mono)', letterSpacing: -0.2,
                  }}>{cell.value}</div>
                  {valueLabel && (
                    <div style={{ fontSize: 9, color: 'var(--muted2)', fontFamily: 'var(--font-mono)', letterSpacing: 1.2, textTransform: 'uppercase' }}>
                      {valueLabel}
                    </div>
                  )}
                  {cell.meta && (
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{cell.meta}</div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}

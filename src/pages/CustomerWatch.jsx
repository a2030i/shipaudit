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

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import {
  RefreshCw, Users, TrendingUp, TrendingDown, Wallet,
  ShoppingBag, AlertTriangle, UserPlus, ZapOff, Phone,
  ArrowLeft, AlertOctagon, Flame, Clock, Moon, Search, X,
  Download, Activity, Calendar, Hash,
} from 'lucide-react';
import {
  Card, Btn, Spinner, Empty, Modal, toast,
  SpotlightCard, PageHeader, SectionTitle, AreaChart,
} from '../components/UI.jsx';
import { loadCustomerWatch } from '../lib/customer360Service.js';

// ── Formatters ───────────────────────────────────────────────────
const fmt = (n) => (n == null || Number.isNaN(n)) ? '—'
  : Number(n).toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtCount = (n) => (n == null) ? '—' : Number(n).toLocaleString('ar-SA');
const fmtCompact = (n) => {
  if (n == null) return '—';
  const a = Math.abs(n);
  if (a >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'م';
  if (a >= 1_000) return (n / 1_000).toFixed(1) + 'ك';
  return Number(n).toFixed(0);
};
const fmtDate = (iso) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return iso; }
};
const daysAgo = (iso) => {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso)) / 86_400_000);
};

const ANOMALY_META = {
  negative_wallet:    { color: '#DC2626', icon: AlertOctagon, label: 'رصيد محفظة سالب',     hint: 'دفع مسبق ورصيده ناقص — خطأ تقني' },
  prepaid_with_debt:  { color: '#EF4444', icon: AlertTriangle, label: 'دفع مسبق وعليه دين', hint: 'يدفع من المحفظة لكن عليه فواتير' },
  active_with_debt:   { color: '#F97316', icon: Flame,         label: 'يشحن الآن وعليه دين', hint: 'آخر شحنة خلال 10 أيام — اتصل اليوم' },
  postpaid_overdue:   { color: '#F59E0B', icon: Clock,         label: 'متأخر +60 يوم',       hint: 'مرشّح للإيقاف بعد تنبيه' },
  inactive_with_debt: { color: '#7A82C4', icon: Moon,          label: 'موقوف وعليه دين',     hint: 'حصّل قبل الإغلاق النهائي' },
};

// ── Main ──────────────────────────────────────────────────────────
export default function CustomerWatch({ isActive = true }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [openCustomer, setOpenCustomer] = useState(null);
  const [openAnomaly, setOpenAnomaly] = useState(null);

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

  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh, location.pathname]);

  const t = data?.totals;

  // Sparkline of monthly invoicing — picks the values from the 12-month
  // series for the spotlight's mini trend.
  const sparkline = useMemo(() => {
    if (!data?.monthsSeries?.length) return [];
    return data.monthsSeries.map(m => m.value);
  }, [data]);

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

  // Build chart series + labels from the monthsSeries
  const chartData = useMemo(() => {
    if (!data?.monthsSeries?.length) return null;
    return {
      labels: data.monthsSeries.map(m => m.label),
      series: [
        { data: data.monthsSeries.map(m => m.value), color: '#10B981', label: 'مبلغ الفواتير' },
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
    XLSX.writeFile(wb, `${listName}_${dateStr}.xlsx`);
    toast(`تم تصدير ${rows.length} صف`, 'success');
  };

  return (
    <div style={{ padding: '32px 40px 80px', maxWidth: 1440 }}>
      <PageHeader
        icon={<Users size={22}/>}
        title="متابعة العملاء"
        subtitle="رؤية موحّدة لكل عميل ومتجر — مديونيات، شحنات، محافظ، تنبيهات"
        meta={data?.snapshot?.receivables
          ? `بيانات الفواتير: snapshot ${data.snapshot.receivables.id}${data.snapshot.merchants ? ` · المتاجر: ${data.snapshot.merchants.id}` : ''}`
          : null}
        actions={
          <>
            <Btn size="md" variant="ghost" icon={<RefreshCw size={14} className={loading ? 'spin' : ''}/>} onClick={refresh} disabled={loading}>
              تحديث
            </Btn>
            <Btn size="md" variant="primary" onClick={() => navigate('/receivables')}>
              عرض كامل المديونيات
            </Btn>
          </>
        }
      />

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
          {/* ── SPOTLIGHT: monthly invoiced (the headline number) ── */}
          <SpotlightCard
            tag="INVOICED THIS MONTH"
            title="إجمالي ما تم إصداره من فواتير هذا الشهر"
            value={fmt(t.monthlyInvoiced)}
            suffix="ر.س"
            accent="#10B981"
            sparkline={sparkline}
            delta={t.monthlyDelta != null ? {
              value: t.monthlyDelta,
              positive: t.monthlyDelta >= 0,
              label: 'مقارنة بالشهر السابق',
            } : null}
            stats={[
              { label: 'إجمالي المديونيات', value: `${fmtCompact(t.totalDebt)} ر.س`, color: '#FCA5A5' },
              { label: 'عملاء عليهم دين',    value: fmtCount(t.customerCount) },
              { label: 'تنبيهات نشطة',       value: fmtCount(t.anomalyCount), color: t.anomalyCount > 0 ? '#FCD34D' : '#86EFAC' },
              { label: 'إجمالي المحافظ',     value: `${fmtCompact(t.totalWallet)} ر.س`, color: t.totalWallet < 0 ? '#FCA5A5' : '#5EEAD4' },
            ]}
          />

          {/* ── SEARCH BAR ─────────────────────────────────────── */}
          <Card style={{ padding: '12px 16px', marginBottom: 24, position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Search size={16} color="var(--muted)"/>
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="ابحث عن عميل أو متجر بالاسم، الـ ID، أو الهاتف…"
                autoComplete="off"
                data-lpignore="true" data-form-type="other"
                name="customer-watch-search"
                style={{
                  flex: 1, border: 'none', outline: 'none', background: 'transparent',
                  fontSize: 14, padding: '6px 0', color: 'var(--text)',
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

          {/* ── MONTHLY INVOICING TREND ────────────────────────── */}
          {chartData && chartData.series[0].data.some(v => v > 0) && (
            <Card style={{ padding: '24px 28px', marginBottom: 24 }}>
              <SectionTitle
                tag="TREND · 12 MONTHS"
                title="تطوّر الفوترة الشهرية"
                color="#10B981"
              />
              <AreaChart series={chartData.series} labels={chartData.labels} height={240}/>
            </Card>
          )}

          {/* ── TODAY'S PRIORITIES ─────────────────────────────── */}
          {data.todayActions?.length > 0 && (
            <Card style={{ padding: '20px 24px', marginBottom: 28 }}>
              <SectionTitle
                tag="DAILY PRIORITIES"
                title="اليوم تحتاج"
                color="#F59E0B"
                action={
                  <Btn size="sm" variant="ghost" onClick={() => navigate('/receivables')}>
                    كل التنبيهات
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
          <SectionTitle tag="MERCHANTS" title="بيانات المتاجر"/>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12, marginBottom: 28,
          }}>
            <QuickStat icon={<ShoppingBag/>}  label="إجمالي المتاجر"      value={fmtCount(t.merchantsCount)} color="#10B981"/>
            <QuickStat icon={<UserPlus/>}     label="نشط حالياً"           value={fmtCount(t.activeCount)} hint={`${t.inactiveCount} غير نشط`} color="#10B981"/>
            <QuickStat icon={<TrendingUp/>}   label="جدد آخر 30 يوم"       value={fmtCount(t.newLast30Days)} hint={`${t.newThisMonth} هذا الشهر`} color="#3B82F6"/>
            <QuickStat icon={<ZapOff/>}       label="لم يشحن أبداً"        value={fmtCount(t.neverShipped)} hint="تسرّب funnel" color="#EF4444"/>
            <QuickStat icon={<Wallet/>}       label="أرصدة موجبة"          value={`${fmtCompact(t.walletPositiveTotal)} ر.س`} color="#10B981"/>
            <QuickStat icon={<Wallet/>}       label="أرصدة سالبة"          value={`${fmtCompact(Math.abs(t.walletNegativeTotal))} ر.س`} color="#DC2626"/>
          </div>

          {/* ── ANOMALIES — five tiles, click to drill into receivables ── */}
          {t.anomalyCount > 0 && (
            <>
              <SectionTitle
                tag="ALERTS"
                title={`تنبيهات تحتاج إجراء (${t.anomalyCount})`}
                color="#EF4444"
                action={
                  <Btn size="sm" variant="ghost" onClick={() => navigate('/receivables')}>
                    افتح صفحة التنبيهات
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
          <SectionTitle tag="LEADERBOARDS" title="أهم القوائم"/>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
            gap: 14, marginBottom: 28,
          }}>
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
            <TopList
              icon={<TrendingUp size={14}/>}
              accent="#10B981"
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
            <TopList
              icon={<Wallet size={14}/>}
              accent="#3B82F6"
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
            <TopList
              icon={<AlertOctagon size={14}/>}
              accent="#DC2626"
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
            <TopList
              icon={<UserPlus size={14}/>}
              accent="#8B5CF6"
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
            <TopList
              icon={<ZapOff size={14}/>}
              accent="#7A82C4"
              title="فُقدوا (مرشّحون لاسترداد)"
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
          </div>
        </>
      )}

      {openCustomer && (
        <CustomerDrillDown
          entry={openCustomer}
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
    const headers = kind === 'negative_wallet'
      ? ['اسم المتجر', 'رقم المتجر', 'الهاتف', 'الرصيد السالب', 'نوع الفوترة', 'حالة المنصّة', 'الدين الحالي']
      : ['اسم العميل', 'اسم المتجر', 'رقم المتجر', 'الهاتف', 'المديونية', 'عدد الفواتير', 'أقدم فاتورة', 'الأيام'];
    const xRows = sorted.map(r => kind === 'negative_wallet'
      ? [r.merchant?.storeName || r.name, r.merchant?.storeId || '', r.merchant?.phone || '', Number(r.merchant?.walletBalance || 0).toFixed(2), r.merchant?.billingType || '', r.merchant?.platformStatus || '', Number(r.total || 0).toFixed(2)]
      : [r.name, r.merchant?.storeName || '', r.merchant?.storeId || '', r.merchant?.phone || '', Number(r.total || 0).toFixed(2), r.invoiceCount || 0, r.oldestInvoiceDate || '', r.daysOutstanding || '']);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...xRows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, meta.label.slice(0, 28));
    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `${meta.label}_${dateStr}.xlsx`);
    toast(`تم تصدير ${rows.length} صف`, 'success');
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
        <Btn size="md" variant="ghost" icon={<Download size={13}/>} onClick={handleExport}>
          تصدير Excel
        </Btn>
      </div>

      {/* Scrollable list */}
      <div style={{
        border: '1px solid var(--border)', borderRadius: 12,
        maxHeight: 480, overflowY: 'auto',
      }}>
        {sorted.map((c, i) => {
          const m = c.merchant;
          const value = kind === 'negative_wallet'
            ? Number(m?.walletBalance || 0)
            : Number(c.total || 0);
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
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {m?.storeName || c.name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, fontFamily: m?.phone ? 'var(--font-mono)' : 'inherit', direction: m?.phone ? 'ltr' : 'rtl', textAlign: 'right' }}>
                  {m?.phone ? m.phone : m?.storeId ? m.storeId : `${c.invoiceCount || 0} فاتورة`}
                </div>
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
                {kind === 'negative_wallet' && m?.lastShipmentAt && (
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                    آخر شحنة {daysAgo(m.lastShipmentAt)}ي
                  </div>
                )}
              </div>
              <ArrowLeft size={14} color="var(--muted2)"/>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

// ── CustomerDrillDown ────────────────────────────────────────────
// Full 360 modal for one customer/merchant. Shows: identity, billing
// status, shipment activity, wallet, receivables totals, recent
// invoices (if any). One-click phone CTA for the operator.
function CustomerDrillDown({ entry, onClose }) {
  const c = entry.customer;
  const m = entry.merchant;
  const debt = Number(c?.total) || 0;
  const wallet = Number(m?.walletBalance) || 0;

  return (
    <Modal title={m?.storeName || c?.name || 'تفاصيل'} onClose={onClose} width={780}>
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
          {(m?.storeName || c?.name || '?').slice(0, 1)}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {m?.storeName || c?.name}
          </div>
          <div style={{ display: 'flex', gap: 14, marginTop: 4, fontSize: 11.5, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
            {m?.storeId && <span><Hash size={11} style={{ verticalAlign: 'middle', marginInlineEnd: 3 }}/>{m.storeId}</span>}
            {m?.phone && <span style={{ direction: 'ltr' }}><Phone size={11} style={{ verticalAlign: 'middle', marginInlineEnd: 3 }}/>{m.phone}</span>}
          </div>
        </div>
        {m?.phone && (
          <a href={`tel:${m.phone}`} style={{
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

      {/* Status chips */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {m?.billingType && (
          <Chip color={m.billingType === 'دفع مسبق' ? '#3B82F6' : '#F59E0B'} label={m.billingType}/>
        )}
        {m?.platformStatus && (
          <Chip color={m.platformStatus === 'نشط' ? '#10B981' : '#71717A'} label={`المنصّة: ${m.platformStatus}`}/>
        )}
        {m?.integrationType && (
          <Chip color="#8B5CF6" label={m.integrationType}/>
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
      <div style={{ maxHeight: 360, overflowY: 'auto' }}>
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

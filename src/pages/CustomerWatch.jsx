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
import {
  RefreshCw, Users, TrendingUp, TrendingDown, Wallet,
  ShoppingBag, AlertTriangle, UserPlus, ZapOff, Phone,
  ArrowLeft, AlertOctagon, Flame, Clock, Moon,
} from 'lucide-react';
import {
  Card, Btn, Spinner, Empty, toast,
  SpotlightCard, PageHeader, SectionTitle,
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

  // Sparkline of monthly invoicing — placeholder until we have a real
  // time-series source; for now uses [lastMonth, thisMonth] to give the
  // spotlight a visible direction indicator.
  const sparkline = useMemo(() => {
    if (!t) return [];
    if (!t.lastMonthInvoiced && !t.monthlyInvoiced) return [];
    return [t.lastMonthInvoiced, t.monthlyInvoiced];
  }, [t]);

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
                  const total = list.reduce((s, c) => s + (Number(c.total) || 0), 0);
                  return (
                    <Card key={key} hover style={{ padding: '16px 18px' }}>
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
            />
          </div>
        </>
      )}
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
function TopList({ icon, accent, title, sub, rows, valueLabel, renderRow, empty }) {
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{
            width: 24, height: 24, borderRadius: 7,
            background: `color-mix(in srgb, ${accent} 14%, transparent)`,
            color: accent,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>{icon}</span>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)', letterSpacing: -0.2 }}>{title}</span>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{sub}</div>
      </div>
      <div style={{ maxHeight: 360, overflowY: 'auto' }}>
        {!rows?.length ? (
          <div style={{ padding: 28, textAlign: 'center', fontSize: 12, color: 'var(--muted)' }}>{empty}</div>
        ) : (
          rows.map((r, i) => {
            const cell = renderRow(r);
            return (
              <div key={r.id || r.name || r.store_id || i} style={{
                display: 'grid',
                gridTemplateColumns: '24px 1fr auto',
                gap: 12, padding: '10px 18px',
                borderBottom: i === rows.length - 1 ? 'none' : '1px solid var(--border)',
                alignItems: 'center',
              }}>
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

// "نظرة عامة" — the one screen that answers "كيف الشركة الآن؟"
//
// Top:    Monthly snapshot. 4 big numbers (carrier spend / COD received /
//         net / drift recovered) with month-over-month deltas.
// Middle: Concentration — top carriers by spend % + top customers by debt %.
//         Designed so the operator immediately notices "60% of our
//         spending sits with one carrier" or "20% of receivables sit
//         with one customer".
// Lower:  AP aging — open carrier balances bucketed by 0-30 / 31-60 /
//         61-90 / 90+ days. Standard accounting view.
// Strip:  Operational alerts (pending audits, overdue AP, etc.)
//
// Everything is read-only. Numbers come from the four overview RPCs
// (monthly_financial_snapshot, ap_aging_by_carrier,
// carrier_spend_concentration, customer_debt_concentration). Period
// switcher at top — defaults to the current month, can flip back to
// any historical month for "كيف كان الوضع شهر يناير".

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  RefreshCw, TrendingUp, TrendingDown, Wallet, Calendar,
  AlertTriangle, Building2, Users, Banknote, Activity,
  ArrowDownCircle, ArrowUpCircle, ChevronLeft, Info,
  Heart, Shield, ArrowRight, Target, Clock3,
  CheckCircle2, Zap, Receipt,
} from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import { setBalance as setBankBalance } from '../lib/bankBalanceService.js';
import {
  Card, Btn, Spinner, Empty, Modal, toast, PageHeader, WorkspaceLoadingState,
} from '../components/UI.jsx';
import { loadOverview, currentPeriod, prevPeriodOf } from '../lib/overviewService.js';
import { scoreLevel } from '../lib/carrierScore.js';
import TeamReadinessPanel from '../components/TeamReadinessPanel.jsx';
import SourceStatusStrip from '../components/SourceStatusStrip.jsx';
import { metricDefinition } from '../lib/metricCatalog.js';

const fmtMonth = (period) => {
  if (!period) return '—';
  const [y, m] = period.split('-');
  const months = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  return `${months[Number(m) - 1] || m} ${y}`;
};
const fmt = (n) =>
  n == null || Number.isNaN(n) ? '—'
  : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtCompact = (n) => {
  if (n == null || Number.isNaN(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'م';
  if (a >= 1_000)     return (n / 1_000).toFixed(1) + 'ك';
  return n.toFixed(0);
};

export default function Overview({ carriers = [], isActive = true }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, can } = useAuth();
  const canEditBank = can('bank.set_balance');
  const [loading, setLoading] = useState(true);
  const [data, setData]       = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [vat, setVat]         = useState(null);   // ضريبة الربع الجاري (كاش زوهو)
  // Selected month persists for the session (sessionStorage) so a
  // historical month being examined survives a refresh / navigating
  // away and back — but resets to the current month on a fresh login.
  const [period, setPeriodRaw] = useState(() => {
    try { return sessionStorage.getItem('sa-overview-period') || currentPeriod(); }
    catch { return currentPeriod(); }
  });
  const setPeriod = useCallback((p) => {
    setPeriodRaw(p);
    try { sessionStorage.setItem('sa-overview-period', p); } catch { /* ignore */ }
  }, []);
  const [bankEdit, setBankEdit] = useState(false);
  const openBankDetails = useCallback(() => {
    const details = document.getElementById('bank-details');
    if (!details) return;
    details.open = true;
    details.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const carrierNameById = useMemo(
    () => new Map((carriers || []).map(c => [c.id, c.name])),
    [carriers],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await loadOverview({ period, topN: 5 });
      setData(result);
    } catch (e) {
      setLoadError(e);
      toast(`فشل التحميل: ${e.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh, location.pathname]);

  // ضريبة الربع الجاري — قراءة كاش خفيفة (يحدّثه كرون زوهو كل 30د)، فشلها صامت
  useEffect(() => {
    if (!isActive) return;
    import('../lib/zohoReportsService.js')
      .then(m => m.loadCurrentVat())
      .then(setVat)
      .catch(() => {});
  }, [isActive, location.pathname]);

  // حارس الصفحة (§1.32): كانت غرفة العمليات بلا أي حارس — موظف بصلاحية
  // sales.view فقط هبط عليها ورأى كل الأرقام المالية (اكتُشف 2026-07-16).
  if (!can('overview.view')) {
    return <div style={{ padding: 40 }}><Empty icon="🔒" title="لا صلاحية" sub="تحتاج صلاحية «عرض الصفحة الرئيسية» — تُمنح من شاشة الفريق"/></div>;
  }

  // لا نعرض بيانات شهر سابق تحت عنوان الشهر الجديد أثناء الانتقال أو عند
  // فشل تحميله. الاحتفاظ بالبيانات القديمة مسموح فقط عند تحديث نفس الشهر.
  const hasCurrentData = data?.period === period;

  if (!hasCurrentData && loadError) {
    return (
      <div className="overview-page workspace-page">
        <PageHeader
          icon={<Activity size={22}/>}
          iconColor="var(--accent3)"
          title="الرئيسية"
          subtitle="تعذّر جلب الملخص المالي — لم نعرض أصفاراً بديلة حتى لا تُفهم كأرقام حقيقية"
        />
        <div className="data-load-error" role="alert">
          <AlertTriangle size={22}/>
          <div>
            <strong>البيانات لم تصل من المصدر</strong>
            <span>{loadError.message || 'تحقق من الاتصال ثم أعد المحاولة.'}</span>
          </div>
          <Btn size="sm" variant="ghost" icon={<RefreshCw size={13}/>} onClick={refresh}>إعادة المحاولة</Btn>
        </div>
      </div>
    );
  }

  if (!hasCurrentData) {
    return (
      <div className="overview-page workspace-page">
        <PageHeader
          icon={<Activity size={22}/>} iconColor="var(--accent3)"
          title="الرئيسية"
          subtitle="ملخص السيولة، أهم التنبيهات، وحركة الشحن والتحصيل"
        />
        <WorkspaceLoadingState title="جارٍ إعداد الملخص التنفيذي" source="مصادر التشغيل والمالية" rows={4}/>
      </div>
    );
  }

  // Period-back navigation: go to the previous month
  const goPrev = () => setPeriod(prevPeriodOf(period));
  // Allow forward only up to current month — no point projecting backwards
  const isCurrent = period === currentPeriod();
  const goNext = () => {
    if (isCurrent) return;
    const [y, m] = period.split('-').map(Number);
    const next = new Date(y, m, 1);
    setPeriod(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`);
  };

  return (
    <div className="overview-page workspace-page">
      <PageHeader
        icon={<Activity size={22}/>}
        iconColor="var(--accent3)"
        title="الرئيسية"
        subtitle="ملخص السيولة، أهم التنبيهات، وحركة الشحن والتحصيل"
        meta={`${fmtMonth(period)} · مقارنة بـ ${fmtMonth(data.prevPeriod)}`}
        actions={
          <div className="overview-period-actions" aria-label="التحكم في فترة الملخص">
            <Btn size="sm" variant="ghost" onClick={goPrev} title="الشهر السابق">
              ‹
            </Btn>
            {!isCurrent && (
              <Btn size="sm" variant="ghost" onClick={goNext} title="الشهر التالي">
                ›
              </Btn>
            )}
            {!isCurrent && (
              <Btn size="sm" variant="ghost" onClick={() => setPeriod(currentPeriod())}>
                العودة للشهر الحالي
              </Btn>
            )}
            <Btn size="sm" variant="ghost" icon={<RefreshCw size={13}/>} onClick={refresh} disabled={loading}>
              {loading ? 'يُحدّث…' : 'تحديث'}
            </Btn>
          </div>
        }
      />

      <SourceStatusStrip
        sources={Object.values(data.sourceStates || {})}
        loadedAt={data.loadedAt}
        onRefresh={refresh}
        refreshing={loading}
      />

      {loadError && (
        <div className="data-load-error is-inline" role="status">
          <AlertTriangle size={17}/>
          <div>
            <strong>التحديث الأخير لم يكتمل</strong>
            <span>نعرض آخر بيانات نجحت بدل استبدالها بأرقام فارغة.</span>
          </div>
          <Btn size="sm" variant="ghost" onClick={refresh}>حاول مجدداً</Btn>
        </div>
      )}

      <CustomerDecisionBoard
        decisions={data.customerDecisions}
        available={data.sectionAvailability?.customerDecisions}
        onNavigate={navigate}
      />

      <nav className="overview-jump-nav" aria-label="الوصول السريع داخل الرئيسية">
        <button type="button" className="is-primary" onClick={() => document.getElementById('customer-decisions')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
          <Users size={14}/> قرارات العملاء
        </button>
        <button type="button" onClick={() => document.getElementById('cash-now')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
          <Wallet size={14}/> السيولة الآن
        </button>
        <button type="button" onClick={() => document.getElementById('customers-risk')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
          <Users size={14}/> تحصيل العملاء
        </button>
        <button type="button" onClick={openBankDetails}>
          <Building2 size={14}/> البنوك
        </button>
        <button type="button" className="overview-jump-extra" onClick={() => document.getElementById('month-performance')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
          <Calendar size={14}/> أداء الشهر
        </button>
        <button type="button" className="overview-jump-extra" onClick={() => document.getElementById('carriers-risk')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
          <Building2 size={14}/> التزامات الناقلين
        </button>
        <button type="button" className="is-primary overview-jump-extra" onClick={() => navigate('/pnl')}>
          <TrendingUp size={14}/> الربح الفعلي
        </button>
      </nav>

      {/* أرقام النقد (البنك/العملاء/الناقلين) خلف overview.cash_position —
          overview.view وحدها تعرض الصفحة بلا الوضع النقدي */}
      {can('overview.cash_position') && (
        <div id="cash-now" className="overview-anchor">
          <OperationsCommand
            data={data}
            vat={vat}
            period={period}
            showCashPosition={can('overview.cash_position')}
            onNavigate={navigate}
            onRefresh={refresh}
            onOpenBankDetails={openBankDetails}
            onEditBank={canEditBank ? () => setBankEdit(true) : null}
          />
        </div>
      )}

      {profile?.role === 'admin' && (
        <TeamReadinessPanel readiness={data.teamReadiness} onNavigate={navigate}/>
      )}

      {/* ── Section 1: Monthly snapshot — 4 big numbers ── */}
      {data.sectionAvailability?.monthly ? (
      <div id="month-performance" className="overview-anchor">
        <SectionTitle icon={<Calendar size={14}/>} color="var(--accent3)">
          أداء الشهر — {fmtMonth(period)}
        </SectionTitle>
        <div className="overview-stat-grid" style={{
          display: 'grid', gap: 12, marginBottom: 24,
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        }}>
        <BigStat
          metricId="carrier_spend"
          color="var(--red)"
          icon={<ArrowUpCircle size={18}/>}
          label="تكلفة الشحن المعتمدة"
          value={fmt(data.thisMonth.carrierSpend)}
          unit="ر.س"
          delta={Math.abs(data.thisMonth.carrierSpend) < 0.01 ? null : data.deltas.carrierSpend}
          deltaInverted    /* spend going up is bad, so red arrow */
          hint={Math.abs(data.thisMonth.carrierSpend) < 0.01 ? 'لا حركة شحن معتمدة في الشهر الجاري بعد' : `${data.thisMonth.auditsApproved} مراجعة معتمدة هذا الشهر`}
        />
        <BigStat
          metricId="cod_received"
          color="var(--green)"
          icon={<ArrowDownCircle size={18}/>}
          label="تحصيل COD المستلم"
          value={fmt(data.thisMonth.codReceived)}
          unit="ر.س"
          delta={Math.abs(data.thisMonth.codReceived) < 0.01 ? null : data.deltas.codReceived}
          hint={Math.abs(data.thisMonth.codReceived) < 0.01 ? 'لا تحصيل COD مسجّل في الشهر الجاري بعد' : 'من ملفات تحصيل الشركات'}
        />
        <BigStat
          metricId="carrier_cash_flow"
          color={data.thisMonth.net >= 0 ? 'var(--green2)' : 'var(--red)'}
          icon={data.thisMonth.net >= 0 ? <TrendingUp size={18}/> : <TrendingDown size={18}/>}
          label="صافي حركة الناقلين"
          value={(data.thisMonth.net >= 0 ? '+' : '−') + fmt(Math.abs(data.thisMonth.net))}
          unit="ر.س"
          delta={Math.abs(data.thisMonth.net) < 0.01 ? null : data.deltas.net}
          hint="COD مُستلَم − إنفاق — تدفّق نقدي وليس ربحاً (الربح في «الوضع المالي»)"
          big
        />
        <BigStat
          color="var(--accent)"
          icon={<AlertTriangle size={18}/>}
          label="فروق التدقيق"
          value={fmt(data.thisMonth.driftTotal)}
          unit="ر.س"
          hint={data.thisMonth.driftTotal < 0 ? 'مبالغ زائدة وفّرناها' : data.thisMonth.driftTotal > 0 ? 'مبالغ ناقصة على فواتير' : 'لا فروق'}
        />
        </div>
      </div>
      ) : (
        <SourceUnavailable title="أداء الشهر" source="ملخص الحركة الشهرية" />
      )}

      {/* Action alerts strip */}
      {data.sectionAvailability?.monthly && data.thisMonth.auditsPending > 0 && (
        <Card
          style={{
            marginBottom: 18,
            background: 'color-mix(in srgb, var(--gold) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--gold) 24%, transparent)',
            cursor: 'pointer',
          }}
          hover
          onClick={() => navigate('/audits')}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <AlertTriangle size={16} color="var(--gold)"/>
            <span style={{ fontSize: 13, color: 'var(--text)', flex: 1 }}>
              <strong>{data.thisMonth.auditsPending}</strong> مراجعة بانتظار اعتمادك — افتح القائمة
            </span>
            <ChevronLeft size={14} color="var(--muted)"/>
          </div>
        </Card>
      )}

      {/* ── Section 1.5: Working capital — CFO health metrics ── */}
      {data.sectionAvailability?.workingCapital ? (
      <>
      <SectionTitle icon={<TrendingUp size={14}/>} color="var(--accent)">
        دورة التحصيل والسداد
      </SectionTitle>
      <div style={{
        display: 'grid', gap: 12, marginBottom: 12,
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
      }}>
        <BigStat
          metricId="dso"
          color="var(--accent3)"
          icon={<Calendar size={18}/>}
          label="متوسط أيام تحصيلك من العملاء"
          value={data.workingCapital.dso.toFixed(1)}
          unit="يوم"
          hint={`متوسط أيام دفع العملاء · ${data.workingCapital.customersWithDebt} عميل عليه دين`}
        />
        <BigStat
          color="var(--green)"
          icon={<Calendar size={18}/>}
          label="متوسط أيام سدادك للشركات"
          value={data.workingCapital.dpo.toFixed(1)}
          unit="يوم"
          hint={`متوسط أيام دفعنا للشركات · ${data.workingCapital.carriersWithDebt} شركة عليها مفتوح`}
        />
        <BigStat
          color={data.workingCapital.ccc <= 0 ? 'var(--green2)' : data.workingCapital.ccc < 30 ? 'var(--gold)' : 'var(--red)'}
          icon={<Activity size={18}/>}
          label="الفجوة بين ما تقبض وما تدفع"
          value={(data.workingCapital.ccc >= 0 ? '+' : '−') + Math.abs(data.workingCapital.ccc).toFixed(1)}
          unit="يوم"
          hint={data.workingCapital.ccc <= 0
            ? '✓ الأعمال تموّل نفسها (نستلم قبل ما ندفع)'
            : data.workingCapital.ccc < 30
              ? '⚠ نموّل الفجوة من سيولتنا لكن ضمن المعقول'
              : '🚨 الفجوة كبيرة — راجع شروط التحصيل أو شروط السداد'}
          big
        />
      </div>

      {/* Top slow payers — both sides */}
      {(data.workingCapital.topSlowCustomers.length > 0 || data.workingCapital.topSlowCarriers.length > 0) && (
        <div style={{
          display: 'grid', gap: 12, marginBottom: 24,
          gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
        }}>
          {data.workingCapital.topSlowCustomers.length > 0 && (
            <Card style={{ padding: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>
                أبطأ ٥ عملاء في الدفع (يطيلون DSO)
              </div>
              {data.workingCapital.topSlowCustomers.slice(0, 5).map((c, i) => (
                <div key={c.name} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '7px 0',
                  borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', minWidth: 18 }}>{i + 1}</span>
                  <span style={{ flex: 1, fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--red)', fontFamily: 'var(--font-mono)', fontWeight: 700, minWidth: 50, textAlign: 'left' }}>
                    {c.days}ي
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)', minWidth: 70, textAlign: 'left' }}>
                    {fmtCompact(c.total)} ر.س
                  </span>
                </div>
              ))}
            </Card>
          )}
          {data.workingCapital.topSlowCarriers.length > 0 && (
            <Card style={{ padding: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>
                أبطأ شركات نسدّد لها (تطيل DPO)
              </div>
              {data.workingCapital.topSlowCarriers.slice(0, 5).map((c, i) => (
                <div key={c.carrier_id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '7px 0',
                  borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                  cursor: 'pointer',
                }}
                onClick={() => navigate(`/carrier?id=${c.carrier_id}`)}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', minWidth: 18 }}>{i + 1}</span>
                  <span style={{ flex: 1, fontSize: 12, color: 'var(--text)' }}>
                    {carrierNameById.get(c.carrier_id) || c.carrier_id}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--green)', fontFamily: 'var(--font-mono)', fontWeight: 700, minWidth: 50, textAlign: 'left' }}>
                    {c.days}ي
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)', minWidth: 70, textAlign: 'left' }}>
                    {fmtCompact(c.total)} ر.س
                  </span>
                </div>
              ))}
            </Card>
          )}
        </div>
      )}
      </>
      ) : (
        <SourceUnavailable title="دورة التحصيل والسداد" source="تقرير رأس المال العامل" />
      )}

      {/* ── Section 2: Concentration — risk awareness ── */}
      <div style={{
        display: 'grid', gap: 14, marginBottom: 24,
        gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
      }}>
        {/* Top carriers by spend */}
        <div id="carriers-risk" className="overview-anchor">
          <Card>
          <SectionTitle icon={<Building2 size={14}/>} color="var(--brand)" inline>
            الناقلون — تركّز الإنفاق ({fmtMonth(period)})
          </SectionTitle>
          {!data.sectionAvailability?.carrierConcentration ? (
            <SourceUnavailable compact title="تعذرت قراءة إنفاق الناقلين" source="تقرير إنفاق الناقلين" />
          ) : data.carrierConcentration.length === 0 ? (
            <Empty icon="📭" title="لا إنفاق هذا الشهر" sub="ينعكس بعد اعتماد أوّل مراجعة"/>
          ) : (
            <ConcentrationBars
              rows={data.carrierConcentration.map(r => ({
                key:        r.carrierId,
                name:       carrierNameById.get(r.carrierId) || r.carrierId,
                value:      r.spend,
                share:      r.sharePct,
                rank:       r.rank,
                meta:       `${r.auditsCount} مراجعة`,
                onClick:    () => navigate(`/carrier?id=${r.carrierId}`),
              }))}
              valueUnit="ر.س"
              warnAtPct={50}
              tint="var(--brand)"
            />
          )}
          </Card>
        </div>

        {/* Top customers by debt */}
        <div id="customers-risk" className="overview-anchor">
          <Card>
          <SectionTitle icon={<Users size={14}/>} color="#EF4444" inline>
            أكثر العملاء عليهم ديون{data.arSource === 'zoho' ? ' · زوهو حي' : ''}
          </SectionTitle>
          {!data.sectionAvailability?.customerConcentration ? (
            <SourceUnavailable compact title="تعذرت قراءة مديونيات العملاء" source="زوهو ومديونيات العملاء" />
          ) : data.customerConcentration.length === 0 ? (
            <Empty icon="📭" title="لا مديونيات حالياً" sub="زامن زوهو أو راجع صفحة تحصيل العملاء"/>
          ) : (
            <ConcentrationBars
              rows={data.customerConcentration.map(r => ({
                key:        r.customerName,
                name:       r.customerName,
                value:      r.debt,
                share:      r.sharePct,
                rank:       r.rank,
                meta:       Number(r.invoiceCount) > 0
                  ? `${r.invoiceCount} فاتورة مفتوحة`
                  : 'رصيد افتتاحي بلا فاتورة مفتوحة',
                // زوهو حي → «تحصيل العملاء» (العميل موجود هناك حتماً —
                // كان النقر ينقل لـ/receivables وقد يكون العميل مستبعداً منها)
                onClick:    () => navigate(
                  data.arSource === 'zoho'
                    ? `/customer-money?customer=${encodeURIComponent(r.customerName)}`
                    : `/receivables?customer=${encodeURIComponent(r.customerName)}`
                ),
              }))}
              valueUnit="ر.س"
              warnAtPct={25}
              tint="#EF4444"
            />
          )}
          </Card>
        </div>
      </div>

      {/* ── Section 3: AP aging ── */}
      {data.sectionAvailability?.aging ? (
      <>
      <SectionTitle icon={<Wallet size={14}/>} color="var(--gold)">
        أعمار ما عليك لشركات الشحن
      </SectionTitle>
      <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 18 }}>
        {/* Totals row up top */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          background: 'var(--surface2)', borderBottom: '1px solid var(--border)',
        }}>
          <AgingCell label="حديث (0–30ي)"  value={data.aging.totals.current} tone="var(--green)"/>
          <AgingCell label="31–60 يوم"      value={data.aging.totals.d31_60}  tone="var(--gold)"/>
          <AgingCell label="61–90 يوم"      value={data.aging.totals.d61_90}  tone="color-mix(in srgb, var(--gold) 45%, var(--red))"/>
          <AgingCell label="+90 يوم"        value={data.aging.totals.d90}     tone="var(--red)"/>
          <AgingCell label="المجموع"        value={data.aging.totals.total}   tone="var(--text)" bold/>
        </div>
        {/* Per-carrier rows */}
        {data.aging.rows.length === 0 ? (
          <Empty icon="✓" title="لا ذمم مفتوحة" sub="كل الفواتير معتمدة ومسدّدة"/>
        ) : (
          <div>
            {data.aging.rows.map(r => (
              <div key={r.carrierId} style={{
                display: 'grid',
                gridTemplateColumns: '1.3fr repeat(5, 1fr)',
                borderBottom: '1px solid var(--border)',
                padding: '10px 0', fontSize: 12,
                cursor: 'pointer',
              }}
              onClick={() => navigate(`/carrier?id=${r.carrierId}`)}>
                <div style={{ padding: '0 14px', fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  {carrierNameById.get(r.carrierId) || r.carrierId}
                  <ChevronLeft size={12} color="var(--muted2)"/>
                </div>
                <AmtCell value={r.current} active={r.current > 0.5} tone="var(--green)"/>
                <AmtCell value={r.d31_60}  active={r.d31_60 > 0.5}  tone="var(--gold)"/>
                <AmtCell value={r.d61_90}  active={r.d61_90 > 0.5}  tone="color-mix(in srgb, var(--gold) 45%, var(--red))"/>
                <AmtCell value={r.d90}     active={r.d90 > 0.5}     tone="var(--red)"/>
                <AmtCell value={r.total}   active                  tone="var(--text)" bold/>
              </div>
            ))}
          </div>
        )}
      </Card>
      </>
      ) : (
        <SourceUnavailable title="أعمار ذمم شركات الشحن" source="تقرير أعمار الذمم الدائنة" />
      )}

      {/* ── Section 4: Carrier health KPIs ── */}
      {!data.sectionAvailability?.carrierHealth ? (
        <SourceUnavailable title="صحة الناقلين" source="مؤشرات جودة الناقلين" />
      ) : data.carrierHealth.length > 0 && (
        <>
          <SectionTitle icon={<Shield size={14}/>} color="var(--green)">
            صحة الناقلين — جودة الفواتير والبيانات
          </SectionTitle>
          <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 18 }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1.4fr repeat(7, 1fr)',
              background: 'var(--surface2)', borderBottom: '1px solid var(--border)',
              padding: '10px 0', fontSize: 11, color: 'var(--muted)', fontWeight: 600,
            }}>
              <div style={{ padding: '0 14px' }}>الناقل</div>
              <div style={{ padding: '0 8px', textAlign: 'center' }}>صحة</div>
              <div style={{ padding: '0 8px', textAlign: 'center' }}>مراجعات</div>
              <div style={{ padding: '0 8px', textAlign: 'center' }}>تكلفة/شحنة</div>
              <div style={{ padding: '0 8px', textAlign: 'center' }}>الفروق %</div>
              <div style={{ padding: '0 8px', textAlign: 'center' }}>عدم تطابق %</div>
              <div style={{ padding: '0 8px', textAlign: 'center' }}>قبول أول مرة</div>
              <div style={{ padding: '0 8px', textAlign: 'center' }}>متوسط الاعتماد</div>
            </div>
            {data.carrierHealth.map(r => (
              <div
                key={r.carrierId}
                onClick={() => navigate(`/carrier?id=${r.carrierId}`)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1.4fr repeat(7, 1fr)',
                  borderBottom: '1px solid var(--border)',
                  padding: '12px 0', fontSize: 12, alignItems: 'center',
                  cursor: 'pointer',
                }}
              >
                <div style={{ padding: '0 14px', fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  {carrierNameById.get(r.carrierId) || r.carrierId}
                  <ChevronLeft size={12} color="var(--muted2)"/>
                </div>
                <div style={{ padding: '0 8px', textAlign: 'center' }}>
                  <HealthPill score={r.score}/>
                </div>
                <div style={{ padding: '0 8px', textAlign: 'center', fontFamily: 'var(--font-mono)', color: 'var(--text2)' }}>
                  {r.auditsApproved}
                </div>
                {/* تكلفة الشحنة الواحدة — رقم المفاوضة الأول مع الناقل */}
                <div style={{ padding: '0 8px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text)' }}>
                  {r.shipmentsTotal > 0 ? (r.totalBilledSum / r.shipmentsTotal).toFixed(2) : '—'}
                </div>
                <div style={{ padding: '0 8px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontWeight: 600, color: r.driftPct > 1 ? 'var(--red)' : 'var(--text2)' }}>
                  {r.driftPct.toFixed(1)}%
                </div>
                <div style={{ padding: '0 8px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontWeight: 600, color: r.mismatchPct > 1 ? 'var(--gold)' : 'var(--text2)' }}>
                  {r.mismatchPct.toFixed(1)}%
                </div>
                <div style={{ padding: '0 8px', textAlign: 'center', fontFamily: 'var(--font-mono)', color: r.firstPassRate < 80 ? 'var(--gold)' : 'var(--green)' }}>
                  {r.firstPassRate.toFixed(0)}%
                </div>
                <div style={{ padding: '0 8px', textAlign: 'center', fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
                  {r.avgApprovalHours < 1 ? '<1س'
                    : r.avgApprovalHours < 24 ? `${r.avgApprovalHours.toFixed(0)}س`
                    : `${(r.avgApprovalHours / 24).toFixed(1)}ي`}
                </div>
              </div>
            ))}
          </Card>
        </>
      )}

      {/* Footer hint */}
      <div style={{
        marginTop: 14, padding: 14, borderRadius: 10,
        background: 'var(--surface2)', border: '1px solid var(--border)',
        fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.7,
        display: 'flex', gap: 10, alignItems: 'flex-start',
      }}>
        <Info size={14} style={{ flexShrink: 0, marginTop: 2 }}/>
        <div>
          <strong style={{ color: 'var(--text2)' }}>كيف تُحسب الأرقام:</strong>{' '}
          الإنفاق = مجموع فواتير شركات الشحن المسجّلة في دفتر الناقلين بتاريخ ضمن الشهر.{' '}
          COD المُستلَم = ما رُفع من ملفات تحصيل الشركات (المبالغ المستلمة فعلاً).{' '}
          الفروق = مجموع الفرق قبل الضريبة للمراجعات المعتمدة هذا الشهر — سالب يعني وفّرنا، موجب يعني ندفع زيادة.
          تركّز العملاء يأتي من فواتير زوهو المفتوحة عند توفرها، مع fallback للكشوف القديمة.{' '}
          أعمار الذمم = الفرق بين تاريخ الفاتورة واليوم، للقيود غير المسددة.
        </div>
      </div>

      {/* Bank balance update modal */}
      {bankEdit && (
        <BankEditModal
          banks={data.cashPosition.bankAccounts || []}
          onCancel={() => setBankEdit(null)}
          onSave={async ({ bank, balance, notes }) => {
            try {
              await setBankBalance({ bank, balance, notes, userId: profile?.id || null });
              toast(`تم تحديث ${bank} إلى ${Number(balance).toLocaleString('en-US')} ر.س`, 'success');
              setBankEdit(null);
              await refresh();
            } catch (e) { toast(`فشل: ${e.message}`, 'error'); }
          }}
        />
      )}
    </div>
  );
}

function CustomerDecisionBoard({ decisions, available, onNavigate }) {
  if (!available || !decisions) {
    return (
      <section id="customer-decisions" className="customer-decision-board is-unavailable" aria-labelledby="customer-decisions-title">
        <div className="customer-decision-board__heading">
          <div>
            <span className="customer-decision-board__eyebrow">العملاء والمالية</span>
            <h2 id="customer-decisions-title">قرارات العملاء اليوم</h2>
            <p>تعذرت قراءة زوهو أو أحدث حالة للمتاجر؛ لم نعرض أي قرار افتراضي.</p>
          </div>
          <Btn size="sm" variant="ghost" onClick={() => onNavigate('/customer-money')}>فتح تحصيل العملاء</Btn>
        </div>
      </section>
    );
  }

  const total = (rows, key) => rows.reduce((sum, row) => sum + Number(row[key] || 0), 0);
  const lanes = [
    {
      key: 'stop', tone: 'danger', icon: '⏸', title: 'أوقف الشحن بعد المراجعة',
      note: 'دفع لاحق · متجر نشط · عليه فواتير تجاوزت 30 يومًا',
      rows: decisions.stopPostpaid, amountKey: 'over30', amountLabel: 'متأخر +30',
      empty: 'لا توجد حسابات نشطة تحتاج إيقافًا الآن.',
    },
    {
      key: 'activate', tone: 'success', icon: '▶', title: 'فعّل الحساب بعد المراجعة',
      note: 'دفع لاحق · متجر غير نشط · لا توجد فواتير تتجاوز 30 يومًا',
      rows: decisions.activatePostpaid, amountKey: 'debt', amountLabel: 'مستحق حالي',
      empty: 'لا توجد حسابات مؤهلة للتفعيل الآن.',
    },
    {
      key: 'deduct', tone: 'info', icon: '◌', title: 'راجع الخصم من الرصيد',
      note: 'دفع مسبق · له رصيد في المنصة وفواتير مفتوحة في زوهو',
      rows: decisions.deductPrepaid, amountKey: 'debt', amountLabel: 'فواتير مفتوحة',
      empty: 'لا توجد أرصدة مسبقة قابلة للمراجعة الآن.',
    },
  ];
  const otherCount = decisions.keepStopped.length + decisions.negativePrepaid.length + decisions.unlinkedFinance.length;

  return (
    <section id="customer-decisions" className="customer-decision-board" aria-labelledby="customer-decisions-title">
      <header className="customer-decision-board__heading">
        <div>
          <span className="customer-decision-board__eyebrow">أولوية اليوم · عملاء ثم سيولة ثم مبيعات</span>
          <h2 id="customer-decisions-title">قرارات تحتاج مراجعة الآن</h2>
          <p>حالة المتجر من أحدث لقطة للمنصة، والفواتير من Zoho. لا ينفذ النظام إيقافًا أو تفعيلًا أو خصمًا تلقائيًا.</p>
        </div>
        <div className="customer-decision-board__actions">
          <span className="customer-decision-source">زوهو + المنصة{formatSnapshotDate(decisions.snapshotAt)}</span>
          <Btn size="sm" onClick={() => onNavigate('/customer-money')}>فتح مركز العملاء</Btn>
        </div>
      </header>

      <div className="customer-decision-summary" aria-label="ملخص قرارات العملاء">
        {lanes.map((lane) => (
          <div className={`customer-decision-summary__item is-${lane.tone}`} key={lane.key}>
            <strong>{lane.rows.length}</strong>
            <span>{lane.title.replace(' بعد المراجعة', '')}</span>
          </div>
        ))}
        <div className="customer-decision-summary__item is-neutral">
          <strong>{otherCount}</strong>
          <span>حالات تحقق إضافية</span>
        </div>
      </div>

      <div className="customer-decision-lanes">
        {lanes.map((lane) => (
          <article className={`customer-decision-lane is-${lane.tone}`} key={lane.key}>
            <header>
              <span className="customer-decision-lane__icon" aria-hidden="true">{lane.icon}</span>
              <div>
                <h3>{lane.title}</h3>
                <p>{lane.note}</p>
              </div>
              <span className="customer-decision-lane__count">{lane.rows.length}</span>
            </header>
            {lane.rows.length === 0 ? <p className="customer-decision-empty">{lane.empty}</p> : (
              <div className="customer-decision-list">
                {lane.rows.slice(0, 4).map((row) => (
                  <button
                    type="button"
                    className="customer-decision-row"
                    key={row.storeId || `${row.name}:${row.customerName}`}
                    onClick={() => onNavigate(`/customer-money?customer=${encodeURIComponent(row.customerName || row.name)}`)}
                  >
                    <span className="customer-decision-row__name">{row.name}</span>
                    <span className="customer-decision-row__meta">
                      {lane.key === 'activate' && !row.hasFinancialRecord ? 'لا فواتير مفتوحة في زوهو' : `${lane.amountLabel}: ${fmt(row[lane.amountKey])} ر.س`}
                    </span>
                    <ChevronLeft size={16}/>
                  </button>
                ))}
              </div>
            )}
            {lane.rows.length > 4 && (
              <button type="button" className="customer-decision-show-all" onClick={() => onNavigate('/customer-money')}>
                عرض كل الحالات ({lane.rows.length}) <ArrowLeftIcon />
              </button>
            )}
            {lane.rows.length > 0 && <span className="customer-decision-lane__total">{fmt(total(lane.rows, lane.amountKey))} ر.س</span>}
          </article>
        ))}
      </div>

      {otherCount > 0 && (
        <details className="customer-decision-other">
          <summary>حالات لا تُنفّذ تلقائيًا وتحتاج تحققًا ({otherCount})</summary>
          <div>
            {decisions.keepStopped.length > 0 && <span>⏸ {decisions.keepStopped.length} دفع لاحق موقوف وله متأخرات +30: يبقى موقوفًا حتى التحصيل.</span>}
            {decisions.negativePrepaid.length > 0 && <span>⚠ {decisions.negativePrepaid.length} دفع مسبق برصيد منصة سالب: راجع الرصيد قبل أي شحن.</span>}
            {decisions.unlinkedFinance.length > 0 && <span>🔗 {decisions.unlinkedFinance.length} رصيد زوهو بلا ربط متجر مؤكد: اربطه قبل أي قرار تشغيلي.</span>}
          </div>
        </details>
      )}
    </section>
  );
}

function ArrowLeftIcon() {
  return <span aria-hidden="true">←</span>;
}

function formatSnapshotDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '' : ` · لقطة المتاجر ${date.toLocaleDateString('en-CA')}`;
}

function OperationsCommand({ data, vat, period, showCashPosition, onNavigate, onRefresh, onOpenBankDetails, onEditBank }) {
  const pendingAudits = Number(data.thisMonth?.auditsPending) || 0;
  const codDue = Number(data.codOutstanding?.total) || 0;
  const ap90 = Number(data.aging?.totals?.d90) || 0;
  const drift = Number(data.thisMonth?.driftTotal) || 0;
  const topCustomer = data.customerConcentration?.[0] || null;
  const cash = data.cashPosition || {};
  const net = cash.net;
  const vatReserve = Math.max(0, Number(vat?.netDue) || 0);
  const availableAfterVat = net == null ? null : net - vatReserve;
  const availablePositive = availableAfterVat == null ? null : availableAfterVat >= 0;
  const registeredBankCount = cash.bankAccounts?.length || 0;
  const expectedBankCount = Number(cash.bankExpectedCount) || registeredBankCount;
  const missingBankBalances = Array.isArray(cash.bankMissingAccounts) ? cash.bankMissingAccounts : [];
  const zohoBankTotal = (cash.zohoBankAccounts || []).reduce((sum, account) => sum + Number(account.bookBalance || 0), 0);
  const customerPath = topCustomer
    ? (data.arSource === 'zoho'
        ? `/customer-money?customer=${encodeURIComponent(topCustomer.customerName)}`
        : `/receivables?customer=${encodeURIComponent(topCustomer.customerName)}`)
    : '/customer-money';

  const missions = [
    missingBankBalances.length > 0 && {
      icon: <Wallet size={18}/>,
      tone: 'var(--red)',
      title: 'الرصيد البنكي غير مكتمل',
      value: `${missingBankBalances.length}`,
      unit: missingBankBalances.length === 1 ? 'بنك' : 'بنوك',
      body: `${missingBankBalances.join('، ')} بلا رصيد ختامي صالح؛ أوقفنا حساب المتاح الفعلي.`,
      action: 'حدّث الرصيد',
      path: '/money?tab=bank',
    },
    pendingAudits > 0 && {
      icon: <Clock3 size={18}/>,
      tone: 'var(--gold)',
      title: 'تدقيق ينتظر قرارك',
      value: `${pendingAudits}`,
      unit: 'مراجعة',
      body: 'اعتمادها أو رفضها يغيّر دفتر الناقلين فوراً.',
      action: 'افتح المراجعات',
      path: '/audits',
    },
    codDue > 0.5 && {
      icon: <Banknote size={18}/>,
      tone: 'var(--accent3)',
      title: 'COD عند شركات الشحن',
      value: fmtCompact(codDue),
      unit: 'ر.س',
      body: `${data.codOutstanding.carriersDue} شركة ما زالت لم تورّد.`,
      action: 'تابع التحصيل',
      path: '/money?tab=cod',
    },
    topCustomer && Number(topCustomer.debt) > 0.5 && {
      icon: <Users size={18}/>,
      tone: '#EF4444',
      title: 'عميل يضغط السيولة',
      value: fmtCompact(topCustomer.debt),
      unit: 'ر.س',
      body: Number(topCustomer.invoiceCount) > 0
        ? `${topCustomer.customerName} · ${topCustomer.invoiceCount} فاتورة مفتوحة.`
        : `${topCustomer.customerName} · رصيد افتتاحي بلا فاتورة مفتوحة.`,
      action: 'افتح العميل',
      path: customerPath,
    },
    ap90 > 0.5 && {
      icon: <Building2 size={18}/>,
      tone: '#DC2626',
      title: 'ذمم ناقلين قديمة',
      value: fmtCompact(ap90),
      unit: 'ر.س',
      body: 'مبالغ تجاوزت 90 يوم وتحتاج إغلاق أو مراجعة.',
      action: 'افتح الدفتر',
      path: '/ledger',
    },
    Math.abs(drift) > 0.5 && {
      icon: <Target size={18}/>,
      tone: 'var(--accent)',
      title: drift < 0 ? 'استرداد مكتشف' : 'فرق يحتاج تفسير',
      value: fmtCompact(Math.abs(drift)),
      unit: 'ر.س',
      body: drift < 0 ? 'فروقات لصالحك ظهرت من التدقيق.' : 'هناك مبالغ ناقصة أو غير متوقعة.',
      action: 'افتح المطالبات',
      path: '/hub?tab=claims',
    },
  ].filter(Boolean).slice(0, 3);

  if (missions.length === 0) {
    missions.push({
      icon: <CheckCircle2 size={18}/>,
      tone: '#059669',
      title: 'لا يوجد قرار عاجل',
      value: 'مستقر',
      unit: '',
      body: 'الأرقام الحرجة لا تحتاج إجراء فورياً الآن.',
      action: 'راجع القرارات',
      path: '/decisions',
    });
  }

  const cashParts = [
    {
      label: 'إجمالي البنوك المسجّلة',
      value: cash.bankBalance,
      tone: 'var(--accent)',
      Icon: Wallet,
      helper: registeredBankCount
        ? (missingBankBalances.length
            ? `${registeredBankCount} حسابات · الرصيد الختامي ناقص في ${missingBankBalances.join('، ')}`
            : `${registeredBankCount} من ${expectedBankCount} حسابات بنكية · اضغط للتفاصيل`)
        : 'لا توجد حسابات مسجّلة',
      onClick: onOpenBankDetails,
    },
    {
      label: 'لك عند العملاء',
      value: cash.totalAR,
      tone: 'var(--green)',
      Icon: ArrowDownCircle,
      helper: cash.arSource === 'zoho'
        ? (cash.customerCreditOffset > 0.005
            ? `المطلوب تحصيله · بعد خصم ${fmt(cash.customerCreditOffset)} ر.س رصيدًا دائنًا`
            : 'المطلوب تحصيله من Zoho')
        : 'آخر كشف داخلي',
      prefix: '+',
      onClick: () => onNavigate('/customer-money'),
    },
    {
      label: 'عليك للناقلين',
      value: cash.totalAP,
      tone: 'var(--red)',
      Icon: ArrowUpCircle,
      helper: 'الفواتير والقيود المفتوحة',
      prefix: '−',
      onClick: () => onNavigate('/ledger'),
    },
    // ضريبة الربع الجاري — التزام قادم يجب أن يظهر مع النقد لا بعده.
    // المصدر كاش زوهو (يُحدَّث كل 30د مع المزامنة) فالعرض فوري.
    ...(vat ? [{
      label: `ضريبة ${vat.quarter.replace('-Q', ' — الربع ')}`,
      value: vat.netDue,
      tone: vat.netDue < 0 ? 'var(--green)' : 'var(--gold)',
      Icon: Receipt,
      helper: vat.netDue < 0
        ? 'رصيد دائن لصالحك'
        : `تُسدَّد بعد انتهاء الربع · باقٍ ${vat.daysLeft} يوم`,
      prefix: vat.netDue < 0 ? '' : '−',
      onClick: () => onNavigate('/pnl'),
    }] : []),
  ];

  const sourceChips = [
    { label: 'العملاء', value: cash.arSource === 'zoho' ? 'Zoho مباشر' : 'نسخة داخلية', tone: 'var(--green)' },
    {
      label: 'البنوك',
      value: missingBankBalances.length ? 'رصيد غير مكتمل'
        : cash.bankSource === 'mixed'
        ? 'كشوف + يدوي'
        : cash.bankSource === 'statement' ? 'آخر كشف لكل بنك'
        : cash.bankSource === 'manual' ? 'إدخال يدوي'
        : 'غير محدد',
      tone: missingBankBalances.length ? 'var(--red)' : 'var(--accent3)',
    },
    { label: 'الناقلون', value: 'دفتر القيود', tone: 'var(--accent)' },
    {
      label: 'الفترة',
      value: fmtMonth(period),
      tone: 'var(--muted)',
    },
    ...(cash.bankUpdated ? [{
      label: 'آخر تحديث بنكي',
      value: formatBankDate(cash.bankUpdated),
      tone: 'var(--green)',
    }] : []),
  ];

  const leadMission = missions[0];

  return (
    <section className="ops-command">
      <div className="ops-command-head">
        <div>
          <div className="ops-command-kicker"><Zap size={14}/> ملخص اليوم</div>
          <h2>{showCashPosition ? 'السيولة المسجّلة وما يحتاج تدخلك' : 'ما يحتاج تدخلك اليوم'}</h2>
          <p>{showCashPosition ? 'الإجمالي يعتمد فقط على الحسابات المسجّلة، وتظهر تفاصيل كل بنك مباشرة تحته.' : 'أولويات قابلة للتنفيذ مرتبة حسب أثرها.'}</p>
        </div>
        <div className="ops-command-actions">
          <Btn size="sm" variant="primary" icon={<Target size={14}/>} onClick={() => onNavigate('/decisions')}>
            القرارات
          </Btn>
          <Btn size="sm" variant="ghost" icon={<ArrowRight size={14}/>} onClick={() => onNavigate('/drop')}>
            إدخال ملف
          </Btn>
          <Btn size="sm" variant="ghost" icon={<RefreshCw size={13}/>} onClick={onRefresh}>
            تحديث
          </Btn>
        </div>
      </div>

      <aside className="ops-attention" aria-label="الأولويات التي تحتاج تدخلاً">
        <div className="ops-attention-head">
          <div>
            <span>يحتاج تدخلك اليوم</span>
            <strong>{missions[0]?.title === 'لا يوجد قرار عاجل' ? 'الوضع مستقر' : `${missions.length} أولويات مرتبة حسب الأثر`}</strong>
          </div>
          <button type="button" className="ops-attention-all" onClick={() => onNavigate('/decisions')}>
            عرض الكل
            <ChevronLeft size={14}/>
          </button>
        </div>

        <div className="ops-missions">
          {missions.map((m) => (
            <button
              key={m.title}
              type="button"
              className="ops-mission"
              style={{ '--tone': m.tone }}
              onClick={() => onNavigate(m.path)}
            >
              <span className="ops-mission-icon">{m.icon}</span>
              <span className="ops-mission-copy">
                <strong>{m.title}</strong>
                <small>{m.body}</small>
              </span>
              <span className="ops-mission-value">
                {m.value}
                {m.unit && <small>{m.unit}</small>}
              </span>
              <ChevronLeft size={15}/>
            </button>
          ))}
        </div>
      </aside>

      <div className={`ops-command-grid ${showCashPosition ? '' : 'no-cash'}`}>
        {showCashPosition && <article className="ops-net-card">
          <span className="ops-net-label">المتاح الفعلي بعد الالتزامات والضريبة</span>
          <div className={`ops-net-value ${availablePositive === false ? 'negative' : ''}`}>
            {availableAfterVat == null ? '—' : `${availablePositive ? '+' : '−'}${fmt(Math.abs(availableAfterVat))}`}
            {availableAfterVat != null && <small>ر.س</small>}
          </div>
          <p>أرصدة البنوك + المطلوب تحصيله من العملاء بعد الأرصدة الدائنة − التزامات الناقلين − حجز الضريبة. هذا ملخص إداري حي وليس قيدًا محاسبيًا جديدًا.</p>

          <div className="ops-cash-parts">
            {cashParts.map((item) => {
              const Icon = item.Icon;
              const known = item.value != null && Number.isFinite(Number(item.value));
              return (
                <button
                  key={item.label}
                  type="button"
                  className="ops-cash-part"
                  style={{ '--tone': item.tone }}
                  onClick={item.onClick}
                  disabled={!item.onClick}
                >
                  <span className="ops-cash-icon"><Icon size={16}/></span>
                  <span className="ops-cash-copy">
                    <strong>{item.label}</strong>
                    <small>{item.helper}</small>
                  </span>
                  <span className="ops-cash-amount">
                    {known ? `${item.prefix || ''}${fmt(Math.abs(Number(item.value)))}` : '—'}
                    {known && <small>ر.س</small>}
                  </span>
                </button>
              );
            })}
          </div>

          <CashBridge
            bank={cash.bankBalance}
            receivables={cash.totalAR}
            payables={cash.totalAP}
            vatReserve={vatReserve}
            result={availableAfterVat}
          />

          {cash.bankAccounts?.length > 0 && (
            <details id="bank-details" className="ops-details">
              <summary>
                <span>تفاصيل الأرصدة البنكية المسجّلة</span>
                <strong>{registeredBankCount} حسابات</strong>
              </summary>
              <div className="ops-bank-breakdown" aria-label="تفصيل الحسابات البنكية">
              <div className="ops-bank-breakdown-head">
                <span>الحسابات الداخلة في الإجمالي</span>
                {onEditBank && <button type="button" onClick={onEditBank}>إضافة أو تحديث بنك</button>}
              </div>
              {cash.bankAccounts.map((account) => (
                <div className="ops-bank-row" key={account.bank}>
                  <span className="ops-bank-name">{account.bank}</span>
                  <small>
                    {account.source === 'statement' ? 'آخر كشف' : 'تحديث يدوي'} · {formatBankDate(account.asOf)}
                    {account.valid === false ? ' · لا يحتوي رصيدًا ختاميًا صالحًا' : ''}
                  </small>
                  <strong style={account.valid === false ? { color: 'var(--red)' } : undefined}>
                    {account.valid === false ? 'غير مكتمل' : <>{fmt(account.balance ?? account.closing)} <small>ر.س</small></>}
                  </strong>
                </div>
              ))}
              {registeredBankCount < expectedBankCount && (
                <button type="button" className="ops-bank-row" onClick={onEditBank}
                  style={{ width: '100%', border: '1px dashed var(--gold)', background: 'color-mix(in srgb, var(--gold) 7%, transparent)', cursor: onEditBank ? 'pointer' : 'default', textAlign: 'right' }}>
                  <span className="ops-bank-name" style={{ color: 'var(--gold)' }}>حساب بنكي غير مسجّل</span>
                  <small>الإجمالي الحالي لا يشمل {expectedBankCount - registeredBankCount} من الحسابات المتوقعة</small>
                  <strong style={{ color: 'var(--gold)' }}>{onEditBank ? 'أضف الرصيد' : 'يحتاج صلاحية'}</strong>
                </button>
              )}
              </div>
            </details>
          )}

          {cash.zohoBankAccounts?.length > 0 && (
            <details className="ops-details">
              <summary>
                <span>مطابقة أرصدة زوهو مع البنوك</span>
                <strong>{cash.zohoBankAccounts.length} حسابات</strong>
              </summary>
              <div className="ops-bank-breakdown" aria-label="أرصدة البنوك في زوهو">
              <div className="ops-bank-breakdown-head">
                <span>أرصدة البنوك في زوهو</span>
                <button type="button" onClick={() => onNavigate('/zoho-data?section=banks')}>عرض المطابقة</button>
              </div>
              {cash.zohoBankAccounts.map((account) => {
                const mismatch = account.difference != null && Math.abs(account.difference) > 0.5;
                return (
                  <div className="ops-bank-row" key={account.id}>
                    <span className="ops-bank-name">{account.internalName || account.name}</span>
                    <small>
                      رصيد زوهو الدفتري
                      {account.statementBalance != null ? ` · الختامي ${fmt(account.statementBalance)} ر.س` : ' · لا يوجد رصيد ختامي'}
                      {account.asOf ? ` · ${formatBankDate(account.asOf)}` : ''}
                      {account.difference != null ? <b style={{ display: 'block', marginTop: 3, color: mismatch ? 'var(--gold)' : 'var(--green)' }}>الفرق {fmt(account.difference)} ر.س</b> : null}
                    </small>
                    <strong>{fmt(account.bookBalance)} <small>ر.س</small></strong>
                  </div>
                );
              })}
              <div className="ops-net-foot" style={{ marginTop: 6 }}>
                <span>إجمالي البنكين في زوهو</span>
                <strong>{fmt(zohoBankTotal)} ر.س</strong>
              </div>
              </div>
            </details>
          )}

          <div className="ops-net-foot">
            <span>صافي المستحقات دون البنك</span>
            <strong>{cash.netNoBank == null ? '—' : `${cash.netNoBank >= 0 ? '+' : '−'}${fmt(Math.abs(cash.netNoBank))} ر.س`}</strong>
          </div>
          {vat && (
            <div className="ops-net-foot" style={{ color: availableAfterVat < 0 ? 'var(--red)' : 'var(--text)' }}>
              <span>السيولة قبل حجز الضريبة</span>
              <strong>{net == null ? '—' : `${net >= 0 ? '+' : '−'}${fmt(Math.abs(net))} ر.س`}</strong>
            </div>
          )}
        </article>}

        <aside className="ops-priority-inspector" style={{ '--tone': leadMission.tone }}>
          <span className="ops-inspector-kicker">مفتش التنبيه الأول</span>
          <div className="ops-inspector-icon">{leadMission.icon}</div>
          <h3>{leadMission.title}</h3>
          <div className="ops-inspector-value">{leadMission.value} <small>{leadMission.unit}</small></div>
          <p>{leadMission.body}</p>
          <Btn size="sm" variant="primary" onClick={() => onNavigate(leadMission.path)}>
            {leadMission.action}
          </Btn>
          <button type="button" className="ops-inspector-link" onClick={() => onNavigate('/decisions')}>
            عرض بقية القرارات
          </button>
        </aside>
      </div>

      {showCashPosition && <div className="ops-sources">
        <span className="ops-sources-label">مصادر الأرقام</span>
        {sourceChips.map((s) => (
          <span
            key={s.label}
            className="ops-source"
            style={{ '--tone': s.tone }}
          >
            <i/>
            <span>{s.label}</span>
            <strong>{s.value}</strong>
          </span>
        ))}
      </div>}
    </section>
  );
}

function formatBankDate(value) {
  if (!value) return 'بلا تاريخ';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('ar-SA', { day: 'numeric', month: 'short', year: 'numeric' });
}

function CashBridge({ bank, receivables, payables, vatReserve, result }) {
  const rows = [
    { label: 'البنوك المسجّلة', value: bank, sign: '+', color: 'var(--accent)' },
    { label: 'ذمم العملاء (زوهو)', value: receivables, sign: '+', color: 'var(--green)' },
    { label: 'التزامات الناقلين', value: payables, sign: '−', color: 'var(--red)' },
    ...(vatReserve > 0.5 ? [{ label: 'حجز الضريبة', value: vatReserve, sign: '−', color: 'var(--gold)' }] : []),
  ].filter(row => row.value != null && Number.isFinite(Number(row.value)));
  if (!rows.length || result == null) return null;
  const max = Math.max(...rows.map(row => Math.abs(Number(row.value) || 0)), Math.abs(Number(result) || 0), 1);
  return (
    <div style={{ marginTop: 13, padding: '12px 13px', borderRadius: 12, background: 'var(--surface2)', border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 9 }}>
        <strong style={{ fontSize: 11.5 }}>جسر السيولة — كيف وصلنا للمتاح</strong>
        <span style={{ fontSize: 10, color: 'var(--muted)' }}>مرجع بصري، لا قيد محاسبي جديد</span>
      </div>
      <div style={{ display: 'grid', gap: 7 }}>
        {rows.map(row => {
          const value = Math.abs(Number(row.value) || 0);
          return (
            <div key={row.label} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 1fr) minmax(90px, 2.2fr) auto', gap: 9, alignItems: 'center' }}>
              <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>{row.label}</span>
              <span style={{ height: 7, borderRadius: 999, background: 'var(--surface)', overflow: 'hidden' }}>
                <span style={{ display: 'block', width: `${Math.max(3, (value / max) * 100)}%`, height: '100%', borderRadius: 999, background: row.color }}/>
              </span>
              <strong style={{ minWidth: 92, textAlign: 'left', fontSize: 10.5, color: row.color, fontFamily: 'var(--font-mono)' }}>{row.sign}{fmt(value)}</strong>
            </div>
          );
        })}
        <div style={{ borderTop: '1px dashed var(--border2)', paddingTop: 8, display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <strong style={{ fontSize: 11.5 }}>المتاح بعد الضريبة والالتزامات</strong>
          <strong style={{ color: result >= 0 ? 'var(--green)' : 'var(--red)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>{result >= 0 ? '+' : '−'}{fmt(Math.abs(result))} ر.س</strong>
        </div>
      </div>
    </div>
  );
}

function BankEditModal({ banks = [], onCancel, onSave }) {
  const [bank, setBank] = useState('');
  const [balance, setBalanceLocal] = useState('');
  const [notes, setNotes] = useState('');

  const pickBank = (account) => {
    setBank(account.bank);
    setBalanceLocal(String(account.balance ?? account.closing ?? ''));
    setNotes(account.notes || '');
  };

  const canSave = bank.trim() && balance !== '';
  return (
    <Modal title="إدارة الحسابات البنكية" onClose={onCancel} width={560}>
      <form autoComplete="off"
            onSubmit={(e) => { e.preventDefault(); if (canSave) onSave({ bank: bank.trim(), balance, notes }); }}
            style={{ padding: '4px 4px 0' }}>
        <div className="bank-modal-intro">
          كل بنك حساب مستقل. اختر بنكاً لتحديث رصيده، أو أضف حساباً فعلياً جديداً عند الحاجة.
        </div>
        {banks.length > 0 && (
          <div className="bank-modal-accounts">
            {banks.map(account => (
              <button type="button" key={account.bank} onClick={() => pickBank(account)}>
                <span>
                  <strong>{account.bank}</strong>
                  <small>{account.source === 'statement' ? 'آخر كشف بنكي' : 'آخر تحديث يدوي'} · {formatBankDate(account.asOf)}</small>
                </span>
                <b>{account.valid === false ? 'الرصيد غير متاح' : fmt(account.balance ?? account.closing)} {account.valid === false ? null : <small>ر.س</small>}</b>
              </button>
            ))}
          </div>
        )}
        <label style={{ display: 'block', marginBottom: 10 }}>
          <span style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 5 }}>
            اسم البنك أو الحساب
          </span>
          <input
            type="text" autoFocus value={bank}
            onChange={(e) => setBank(e.target.value)}
            placeholder="مثال: البنك الأهلي"
            name="bank_name"
            autoComplete="off" data-form-type="other"
            style={{
              width: '100%', padding: '10px 12px', fontSize: 14,
              border: '1.5px solid var(--border)', borderRadius: 8,
              background: 'var(--surface)', color: 'var(--text)',
              fontFamily: 'var(--font-sans)', boxSizing: 'border-box',
            }}
          />
        </label>
        <label style={{ display: 'block', marginBottom: 10 }}>
          <span style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 5 }}>
            الرصيد الحالي (ر.س)
          </span>
          <input
            type="number" step="0.01" value={balance}
            onChange={(e) => setBalanceLocal(e.target.value)}
            name="bank_balance"
            autoComplete="off" data-form-type="other" data-lpignore="true"
            style={{
              width: '100%', padding: '12px 14px', fontSize: 18,
              border: '1.5px solid var(--border)', borderRadius: 8,
              background: 'var(--surface)', color: 'var(--text)',
              fontFamily: 'var(--font-mono)', textAlign: 'center', fontWeight: 700,
              boxSizing: 'border-box',
            }}
          />
        </label>
        <label style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 5 }}>
            ملاحظة (اختيارية)
          </span>
          <input
            type="text" value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="مثال: بعد تحويل سمسا 42K"
            name="bank_notes" autoComplete="off" data-form-type="other"
            style={{
              width: '100%', padding: '8px 12px', fontSize: 13,
              border: '1px solid var(--border)', borderRadius: 8,
              background: 'var(--surface)', color: 'var(--text)',
              fontFamily: 'var(--font-sans)', boxSizing: 'border-box',
            }}
          />
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn size="md" variant="accent" disabled={!canSave} onClick={() => onSave({ bank: bank.trim(), balance, notes })}>
            حفظ رصيد الحساب
          </Btn>
          <Btn size="md" variant="ghost" onClick={onCancel}>إلغاء</Btn>
        </div>
      </form>
    </Modal>
  );
}

// ─── subcomponents ──────────────────────────────────────────────
function SectionTitle({ icon, color, children, inline = false }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      marginBottom: inline ? 14 : 10,
      paddingBottom: inline ? 10 : 0,
      borderBottom: inline ? '1px solid var(--border)' : 'none',
    }}>
      <span style={{
        width: 24, height: 24, borderRadius: 7,
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
        color, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{icon}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
        {children}
      </span>
    </div>
  );
}

function SourceUnavailable({ title, source, compact = false }) {
  return (
    <Card
      className="source-unavailable-card"
      style={{ marginBottom: compact ? 0 : 18, padding: compact ? 14 : 18 }}
      role="status"
    >
      <AlertTriangle size={18} color="var(--gold)" aria-hidden="true"/>
      <div>
        <strong>{title} غير متاح الآن</strong>
        <span>تعذرت قراءة {source}؛ لم نعرض صفراً بديلاً. أعد التحديث بعد عودة المصدر.</span>
      </div>
    </Card>
  );
}

function BigStat({ metricId, color, icon, label, value, unit, delta, deltaInverted = false, hint, big = false }) {
  const metric = metricId ? metricDefinition(metricId) : null;
  // delta semantics: positive number = went UP this month.
  // deltaInverted=true flips the color meaning (spend going up = bad).
  const deltaUp = delta != null && delta > 0;
  const deltaColor = delta == null
    ? 'var(--muted)'
    : (deltaUp ? (deltaInverted ? 'var(--red)' : 'var(--green2)') : (deltaInverted ? 'var(--green2)' : 'var(--red)'));
  const deltaArrow = delta == null ? '·' : deltaUp ? '↑' : '↓';

  return (
    <div className="stat-card" style={{
      padding: 16,
      background: 'var(--surface)',
      border:     `1px solid var(--border2)`,
      borderRadius: 'var(--r-lg)',
      boxShadow: 'var(--shadow-sm)',
      '--sc-tone': color,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{
          width: 30, height: 30, borderRadius: 8,
          background: `color-mix(in srgb, ${color} 16%, transparent)`,
          color, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', letterSpacing: .5 }}>
          {label}
        </span>
        {delta != null && (
          <span style={{
            marginInlineStart: 'auto',
            fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 999,
            background: `color-mix(in srgb, ${deltaColor} 14%, transparent)`,
            color: deltaColor, fontFamily: 'var(--font-mono)',
          }}>
            {deltaArrow} {Math.abs(delta).toFixed(1)}%
          </span>
        )}
      </div>
      <div style={{
        fontSize: big ? 28 : 22, fontWeight: 800,
        color, fontFamily: 'var(--font-mono)', letterSpacing: -0.6,
      }}>
        {value}
        <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 500, marginInlineStart: 6 }}>{unit}</span>
      </div>
      {hint && (
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
          {hint}
        </div>
      )}
      {metric && (
        <div className="metric-source-line">
          <Info size={11} aria-hidden="true"/>
          <span>المصدر: {metric.source}</span>
        </div>
      )}
    </div>
  );
}

function ConcentrationBars({ rows, valueUnit, warnAtPct, tint }) {
  const maxValue = Math.max(...rows.map(r => r.value), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map(r => {
        const widthPct = Math.max(2, (r.value / maxValue) * 100);
        const warn = r.share >= warnAtPct;
        return (
          <button
            key={r.key}
            type="button"
            onClick={r.onClick}
            disabled={!r.onClick}
            className="concentration-row"
            style={{ cursor: r.onClick ? 'pointer' : 'default', padding: '4px 0' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{
                fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
                color: 'var(--muted)', minWidth: 16, textAlign: 'center',
              }}>{r.rank}</span>
              <span style={{
                fontSize: 12.5, fontWeight: 600,
                color: warn ? 'var(--red)' : 'var(--text)',
                flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{r.name}</span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{r.meta}</span>
              <span style={{
                fontSize: 11.5, fontWeight: 700,
                color: warn ? 'var(--red)' : tint,
                fontFamily: 'var(--font-mono)',
              }}>
                {r.share.toFixed(1)}%
              </span>
            </div>
            <div style={{
              position: 'relative', height: 6, borderRadius: 3,
              background: 'var(--surface2)',
              marginInlineStart: 24,
            }}>
              <div style={{
                position: 'absolute', insetInlineEnd: 0, top: 0, bottom: 0,
                width: `${widthPct}%`,
                background: warn ? 'var(--red)' : tint,
                borderRadius: 3,
              }}/>
            </div>
            <div style={{
              fontSize: 10.5, color: 'var(--muted)', marginTop: 3, marginInlineStart: 24,
              fontFamily: 'var(--font-mono)',
            }}>
              {fmtCompact(r.value)} {valueUnit}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function AgingCell({ label, value, tone, bold = false }) {
  return (
    <div style={{ padding: '12px 14px', borderInlineStart: '1px solid var(--border)' }}>
      <div style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 600, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{
        fontSize: 15, fontFamily: 'var(--font-mono)',
        fontWeight: bold ? 800 : 700,
        color: value > 0.5 ? tone : 'var(--muted2)',
      }}>
        {value > 0.5 ? fmtCompact(value) : '—'}
      </div>
    </div>
  );
}

function HealthPill({ score }) {
  // العتبات الموحّدة من carrierScore.js (≥85 جيد · 65-84 مقبول · <65 ضعيف)
  const lvl  = scoreLevel(score ?? 0);
  const tone = lvl.color;
  const bg   = lvl.bg;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 9px', borderRadius: 999,
      background: bg, color: tone,
      fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)',
    }}>
      <Heart size={9}/> {score}
    </span>
  );
}

function AmtCell({ value, active, tone, bold = false }) {
  return (
    <div style={{
      padding: '4px 14px', textAlign: 'center',
      fontFamily: 'var(--font-mono)', fontSize: 12,
      fontWeight: bold ? 800 : 600,
      color: active ? tone : 'var(--muted2)',
    }}>
      {active ? fmtCompact(value) : '—'}
    </div>
  );
}

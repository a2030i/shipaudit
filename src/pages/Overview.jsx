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
  Heart, Shield, Edit3, ArrowRight,
} from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import { setBalance as setBankBalance } from '../lib/bankBalanceService.js';
import {
  Card, Btn, Spinner, Empty, Modal, toast, PageHeader,
} from '../components/UI.jsx';
import { loadOverview, currentPeriod, prevPeriodOf } from '../lib/overviewService.js';
import { scoreLevel } from '../lib/carrierScore.js';

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
  const [bankEdit, setBankEdit] = useState(null);   // { current, notes } when open

  const carrierNameById = useMemo(
    () => new Map((carriers || []).map(c => [c.id, c.name])),
    [carriers],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await loadOverview({ period, topN: 5 });
      setData(result);
    } catch (e) {
      toast(`فشل التحميل: ${e.message}`, 'error');
    }
    setLoading(false);
  }, [period]);

  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh, location.pathname]);

  if (loading || !data) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 320 }}>
          <Spinner size={28}/>
        </div>
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
    <div style={{ padding: '20px 24px 60px', maxWidth: 1280, margin: '0 auto' }}>
      <PageHeader
        icon={<Activity size={22}/>}
        iconColor="#0EA5E9"
        title="نظرة عامة"
        subtitle={`الوضع المالي العام للشركة — ${fmtMonth(period)}`}
        meta={`مقارنة بـ ${fmtMonth(data.prevPeriod)}`}
        actions={
          <div style={{ display: 'flex', gap: 6 }}>
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
            <Btn size="sm" variant="ghost" icon={<RefreshCw size={13}/>} onClick={refresh}>
              تحديث
            </Btn>
          </div>
        }
      />

      {/* ── HERO: Cash position — the headline answer ──
          Edit-bank click only fires for users with bank.set_balance.
          Read-only viewers still see the tile but it's not clickable. */}
      <CashHero
        cash={data.cashPosition}
        codOutstanding={data.codOutstanding}
        onOpenCod={() => navigate('/money?tab=cod')}
        onEditBank={canEditBank ? () => setBankEdit({
          current: data.cashPosition.bankBalance ?? '',
          notes:   '',
        }) : null}
      />

      {/* ── Section 1: Monthly snapshot — 4 big numbers ── */}
      <SectionTitle icon={<Calendar size={14}/>} color="#0EA5E9">
        لمحة الشهر — {fmtMonth(period)}
      </SectionTitle>
      <div style={{
        display: 'grid', gap: 12, marginBottom: 24,
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
      }}>
        <BigStat
          color="var(--red)"
          icon={<ArrowUpCircle size={18}/>}
          label="إنفاق على الشركات"
          value={fmt(data.thisMonth.carrierSpend)}
          unit="ر.س"
          delta={data.deltas.carrierSpend}
          deltaInverted    /* spend going up is bad, so red arrow */
          hint={`${data.thisMonth.auditsApproved} مراجعة معتمدة هذا الشهر`}
        />
        <BigStat
          color="var(--green)"
          icon={<ArrowDownCircle size={18}/>}
          label="COD مُستلَم"
          value={fmt(data.thisMonth.codReceived)}
          unit="ر.س"
          delta={data.deltas.codReceived}
          hint="من ملفات تحصيل الشركات"
        />
        <BigStat
          color={data.thisMonth.net >= 0 ? 'var(--green2)' : 'var(--red)'}
          icon={data.thisMonth.net >= 0 ? <TrendingUp size={18}/> : <TrendingDown size={18}/>}
          label="صافي حركة النقد مع الناقلين"
          value={(data.thisMonth.net >= 0 ? '+' : '−') + fmt(Math.abs(data.thisMonth.net))}
          unit="ر.س"
          delta={data.deltas.net}
          hint="COD مُستلَم − إنفاق — تدفّق نقدي وليس ربحاً (الربح في «الوضع المالي»)"
          big
        />
        <BigStat
          color="#8B5CF6"
          icon={<AlertTriangle size={18}/>}
          label="الفروق المُكتشفة"
          value={fmt(data.thisMonth.driftTotal)}
          unit="ر.س"
          hint={data.thisMonth.driftTotal < 0 ? 'مبالغ زائدة وفّرناها' : data.thisMonth.driftTotal > 0 ? 'مبالغ ناقصة على فواتير' : 'لا فروق'}
        />
      </div>

      {/* Action alerts strip */}
      {data.thisMonth.auditsPending > 0 && (
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
      <SectionTitle icon={<TrendingUp size={14}/>} color="#8B5CF6">
        رأس المال العامل — متوسط أيام التحصيل والسداد
      </SectionTitle>
      <div style={{
        display: 'grid', gap: 12, marginBottom: 12,
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
      }}>
        <BigStat
          color="#0EA5E9"
          icon={<Calendar size={18}/>}
          label="DSO — أيام التحصيل"
          value={data.workingCapital.dso.toFixed(1)}
          unit="يوم"
          hint={`متوسط أيام دفع العملاء · ${data.workingCapital.customersWithDebt} عميل عليه دين`}
        />
        <BigStat
          color="var(--green)"
          icon={<Calendar size={18}/>}
          label="DPO — أيام السداد"
          value={data.workingCapital.dpo.toFixed(1)}
          unit="يوم"
          hint={`متوسط أيام دفعنا للشركات · ${data.workingCapital.carriersWithDebt} شركة عليها مفتوح`}
        />
        <BigStat
          color={data.workingCapital.ccc <= 0 ? 'var(--green2)' : data.workingCapital.ccc < 30 ? 'var(--gold)' : 'var(--red)'}
          icon={<Activity size={18}/>}
          label="CCC — دورة النقد"
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

      {/* ── Section 2: Concentration — risk awareness ── */}
      <div style={{
        display: 'grid', gap: 14, marginBottom: 24,
        gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
      }}>
        {/* Top carriers by spend */}
        <Card>
          <SectionTitle icon={<Building2 size={14}/>} color="#3B82F6" inline>
            الناقلون — تركّز الإنفاق ({fmtMonth(period)})
          </SectionTitle>
          {data.carrierConcentration.length === 0 ? (
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
              tint="#3B82F6"
            />
          )}
        </Card>

        {/* Top customers by debt */}
        <Card>
          <SectionTitle icon={<Users size={14}/>} color="#EF4444" inline>
            العملاء — تركّز المديونيات{data.arSource === 'zoho' ? ' · زوهو حي' : ''}
          </SectionTitle>
          {data.customerConcentration.length === 0 ? (
            <Empty icon="📭" title="لا مديونيات حالياً" sub="ارفع snapshot من /receivables"/>
          ) : (
            <ConcentrationBars
              rows={data.customerConcentration.map(r => ({
                key:        r.customerName,
                name:       r.customerName,
                value:      r.debt,
                share:      r.sharePct,
                rank:       r.rank,
                meta:       `${r.invoiceCount} فاتورة`,
                // زوهو حي → «فلوسي عند العملاء» (العميل موجود هناك حتماً —
                // كان النقر ينقل لـ/receivables وقد يكون العميل مستبعداً منها)
                onClick:    () => navigate(data.arSource === 'zoho' ? '/customer-money' : '/receivables'),
              }))}
              valueUnit="ر.س"
              warnAtPct={25}
              tint="#EF4444"
            />
          )}
        </Card>
      </div>

      {/* ── Section 3: AP aging ── */}
      <SectionTitle icon={<Wallet size={14}/>} color="var(--gold)">
        أعمار الذمم الدائنة — ما علينا للشركات
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
          <AgingCell label="61–90 يوم"      value={data.aging.totals.d61_90}  tone="#F97316"/>
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
                <AmtCell value={r.d61_90}  active={r.d61_90 > 0.5}  tone="#F97316"/>
                <AmtCell value={r.d90}     active={r.d90 > 0.5}     tone="var(--red)"/>
                <AmtCell value={r.total}   active                  tone="var(--text)" bold/>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── Section 4: Carrier health KPIs ── */}
      {data.carrierHealth.length > 0 && (
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
          الإنفاق = مجموع <code>amount_dr</code> في <code>carrier_operations</code> بتاريخ ضمن الشهر.{' '}
          COD المُستلَم = ما رُفع من ملفات تحصيل الشركات بـ <code>direction='in'</code>.{' '}
          الفروق = مجموع <code>drift_pre_tax</code> للمراجعات المعتمدة هذا الشهر — سالب يعني وفّرنا، موجب يعني ندفع زيادة.
          تركّز العملاء يأتي من آخر snapshot مديونيات.{' '}
          أعمار الذمم = الفرق بين تاريخ الفاتورة واليوم، للقيود غير المسددة.
        </div>
      </div>

      {/* Bank balance update modal */}
      {bankEdit && (
        <BankEditModal
          current={bankEdit.current}
          onCancel={() => setBankEdit(null)}
          onSave={async ({ balance, notes }) => {
            try {
              await setBankBalance({ balance, notes, userId: profile?.id || null });
              toast(`تم تحديث رصيد البنك إلى ${Number(balance).toLocaleString('en-US')} ر.س`, 'success');
              setBankEdit(null);
              await refresh();
            } catch (e) { toast(`فشل: ${e.message}`, 'error'); }
          }}
        />
      )}
    </div>
  );
}

// ─── Cash-position hero ─────────────────────────────────────────
// Single-screen answer to "كيف وضعنا اليوم؟". Five tiles:
//   💰 Bank        — manual entry, with last-updated timestamp
//   📥 AR          — customer debt (from working_capital_now)
//   📤 AP          — vendor debt (carrier_operations open)
//   📊 Net no-bank — AR − AP (operational net excluding cash on hand)
//   🏁 Net total   — bank + AR − AP (the bottom-line cash picture if
//                    we fully collect AR and pay AP today)
function CashHero({ cash, codOutstanding, onEditBank, onOpenCod }) {
  const fmtRel = (iso) => {
    if (!iso) return 'غير محدّث';
    const ms = Date.now() - new Date(iso).getTime();
    const days = Math.floor(ms / 86_400_000);
    if (days <= 0) return `حُدّث اليوم`;
    if (days === 1) return 'حُدّث أمس';
    if (days < 7)   return `حُدّث قبل ${days} أيام`;
    return `حُدّث قبل ${Math.floor(days / 7)} أسابيع — قد يكون قديماً`;
  };
  const isBankStale = cash.bankUpdated && (Date.now() - new Date(cash.bankUpdated).getTime()) > 7 * 86_400_000;
  return (
    <Card style={{
      padding: 20, marginBottom: 22,
      background: 'var(--surface)',
      border: '1px solid var(--border2)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <span style={{
          width: 32, height: 32, borderRadius: 8,
          background: 'color-mix(in srgb, var(--green) 16%, transparent)',
          color: 'var(--green2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}><Wallet size={17}/></span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>نظرة السيولة</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            البنك + المستحق علينا + المستحق لنا = الوضع النقدي الكامل
          </div>
        </div>
      </div>

      <div style={{
        display: 'grid', gap: 12,
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
      }}>
        {/* Bank balance — تلقائي من ختامي آخر كشف مرفوع، واليدوي بينهما */}
        <CashTile
          icon={<Wallet size={18}/>}
          color={isBankStale ? 'var(--gold)' : 'var(--green2)'}
          label={cash.bankSource === 'statement' ? 'رصيد البنك (آخر كشف)' : 'رصيد البنك'}
          value={cash.bankBalance == null ? '—' : fmt(cash.bankBalance)}
          unit={cash.bankBalance == null ? '' : 'ر.س'}
          hint={cash.bankSource === 'statement' ? (cash.bankNotes || fmtRel(cash.bankUpdated)) : fmtRel(cash.bankUpdated)}
          onClick={onEditBank || undefined}
          editable={!!onEditBank}
        />
        <CashTile
          icon={<ArrowDownCircle size={18}/>}
          color="var(--green)"
          label={cash.arSource === 'zoho' ? 'مستحق لنا (العملاء) · زوهو حي' : 'مستحق لنا (العملاء)'}
          value={fmt(cash.totalAR)}
          unit="ر.س"
          hint={cash.arSource === 'zoho' ? 'فواتير زوهو المفتوحة — نفس رقم «فلوسي عند العملاء»' : 'من آخر كشف داخلي مرفوع'}
        />
        <CashTile
          icon={<ArrowUpCircle size={18}/>}
          color="var(--red)"
          label="مستحق علينا (الموردون)"
          value={fmt(cash.totalAP)}
          unit="ر.س"
          hint="ما ندين به للشركات"
        />
        {codOutstanding && codOutstanding.total > 0.5 && (
          <CashTile
            icon={<Banknote size={18}/>}
            color="var(--gold)"
            label="COD لم يُحصَّل بعد"
            value={fmt(codOutstanding.total)}
            unit="ر.س"
            hint={`${codOutstanding.carriersDue} شركة لم تورّد — اضغط للتفاصيل`}
            onClick={onOpenCod}
          />
        )}
        <CashTile
          icon={cash.netNoBank >= 0 ? <TrendingUp size={18}/> : <TrendingDown size={18}/>}
          color={cash.netNoBank >= 0 ? 'var(--green2)' : 'var(--red)'}
          label="الصافي التشغيلي"
          value={(cash.netNoBank >= 0 ? '+' : '−') + fmt(Math.abs(cash.netNoBank))}
          unit="ر.س"
          hint="مستحق لنا − مستحق علينا"
        />
        <CashTile
          icon={<Banknote size={18}/>}
          color={cash.net == null ? 'var(--muted)' : cash.net >= 0 ? 'var(--green2)' : 'var(--red)'}
          label="الوضع النقدي الكامل"
          value={cash.net == null ? '—' : (cash.net >= 0 ? '+' : '−') + fmt(Math.abs(cash.net))}
          unit={cash.net == null ? '' : 'ر.س'}
          hint={cash.bankBalance == null ? 'حدّث رصيد البنك للحساب' : 'البنك + الصافي التشغيلي'}
          big
        />
      </div>

      {isBankStale && (
        <div style={{
          marginTop: 14, padding: '10px 14px', borderRadius: 8,
          background: 'color-mix(in srgb, var(--gold) 10%, transparent)',
          border: '1px solid color-mix(in srgb, var(--gold) 30%, transparent)',
          fontSize: 12, color: 'var(--warn)', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <AlertTriangle size={14}/>
          رصيد البنك قديم — اضغط على البطاقة لتحديثه برصيدك الحالي
        </div>
      )}
    </Card>
  );
}

function CashTile({ icon, color, label, value, unit, hint, onClick, editable = false, big = false }) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: 14, borderRadius: 10,
        background: 'var(--surface)',
        border: `1px solid color-mix(in srgb, ${color} ${big ? 28 : 14}%, transparent)`,
        cursor: onClick ? 'pointer' : 'default',
        position: 'relative',
        transition: 'border-color .15s',
        background: 'var(--surface)',
      }}
      onMouseEnter={onClick ? (e) => e.currentTarget.style.borderColor = color : undefined}
      onMouseLeave={onClick ? (e) => e.currentTarget.style.borderColor = `color-mix(in srgb, ${color} ${big ? 28 : 14}%, transparent)` : undefined}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{
          width: 26, height: 26, borderRadius: 7,
          background: `color-mix(in srgb, ${color} 14%, transparent)`,
          color, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{icon}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: .4, flex: 1 }}>
          {label}
        </span>
        {editable && (
          <Edit3 size={11} color="var(--muted2)"/>
        )}
      </div>
      <div style={{
        fontSize: big ? 26 : 21, fontWeight: 800,
        color, fontFamily: 'var(--font-mono)', letterSpacing: -0.5,
      }}>
        {value}
        {unit && <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 500, marginInlineStart: 5 }}>{unit}</span>}
      </div>
      {hint && (
        <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 5 }}>{hint}</div>
      )}
    </div>
  );
}

function BankEditModal({ current, onCancel, onSave }) {
  const [balance, setBalanceLocal] = useState(current ?? '');
  const [notes,   setNotes]   = useState('');
  return (
    <Modal title="تحديث رصيد البنك" onClose={onCancel} width={460}>
      <form autoComplete="off"
            onSubmit={(e) => { e.preventDefault(); if (balance !== '') onSave({ balance, notes }); }}
            style={{ padding: '4px 4px 0' }}>
        <div style={{
          padding: 12, marginBottom: 12, borderRadius: 8,
          background: 'var(--surface2)', border: '1px solid var(--border)',
          fontSize: 12, color: 'var(--muted)', lineHeight: 1.7,
        }}>
          أدخل رصيد البنك الحالي. كل تحديث يُحفظ كسجل (يبقى التاريخ مرئياً) — فلا داعي لتعديل القيم القديمة.
        </div>
        <label style={{ display: 'block', marginBottom: 10 }}>
          <span style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 5 }}>
            الرصيد الحالي (ر.س)
          </span>
          <input
            type="number" step="0.01" autoFocus value={balance}
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
          <Btn size="md" variant="accent" disabled={balance === ''} onClick={() => onSave({ balance, notes })}>
            احفظ
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

function BigStat({ color, icon, label, value, unit, delta, deltaInverted = false, hint, big = false }) {
  // delta semantics: positive number = went UP this month.
  // deltaInverted=true flips the color meaning (spend going up = bad).
  const deltaUp = delta != null && delta > 0;
  const deltaColor = delta == null
    ? 'var(--muted)'
    : (deltaUp ? (deltaInverted ? 'var(--red)' : 'var(--green2)') : (deltaInverted ? 'var(--green2)' : 'var(--red)'));
  const deltaArrow = delta == null ? '·' : deltaUp ? '↑' : '↓';

  return (
    <Card style={{
      padding: 16,
      background: 'var(--surface)',
      border:     `1px solid var(--border2)`,
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
    </Card>
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
          <div
            key={r.key}
            onClick={r.onClick}
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
                background: warn
                  ? 'linear-gradient(to left, #DC2626, color-mix(in srgb, var(--red) 60%, transparent))'
                  : `linear-gradient(to left, ${tint}, color-mix(in srgb, ${tint} 60%, transparent))`,
                borderRadius: 3,
              }}/>
            </div>
            <div style={{
              fontSize: 10.5, color: 'var(--muted)', marginTop: 3, marginInlineStart: 24,
              fontFamily: 'var(--font-mono)',
            }}>
              {fmtCompact(r.value)} {valueUnit}
            </div>
          </div>
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

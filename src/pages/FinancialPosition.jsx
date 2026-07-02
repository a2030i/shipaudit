// «الوضع المالي» /pnl — أول شاشة تجيب «هل نربح؟» (من خطة وكلاء زوهو).
//
// المصدر: قائمة الدخل الرسمية من Zoho Books (كاش pnl_snapshots + تحديث حي).
// التصميم لغير المالي — اختبار الـ30 ثانية:
//   1) بانر حكم واحد: رابحون/خاسرون هذا الشهر + كم
//   2) شلال 4 سطور بلغة بشرية (دخلنا − الناقلون − المصاريف = الباقي لنا)
//   3) اتجاه الشهور + بطاقات الأرباع
//   4) فحص فجوة التسجيل: فواتير الناقلين في دفترنا مقابل ما سجّله زوهو
// قاعدة ثابتة: تحصيل COD ليس دخلاً — أمانة التجار تمرّ عبرنا.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, TrendingUp, TrendingDown, Wallet, AlertTriangle, ChevronLeft } from 'lucide-react';
import { Card, Btn, Spinner, Empty, toast, PageHeader } from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  loadPnlSnapshots, refreshPnlMonth, currentPnlPeriod, prevPnlPeriod, quarterTotals,
  syncZohoDocs, loadInvoicedVsCollected, loadSyncState, loadZohoEvents,
} from '../lib/pnlService.js';
import { loadMonthlyReport } from '../lib/monthlyReportService.js';

const fmt = (n) => (n == null || Number.isNaN(n)) ? '—'
  : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtK = (n) => { const a = Math.abs(n); return a >= 1e6 ? (n / 1e6).toFixed(2) + 'م' : a >= 1e3 ? (n / 1e3).toFixed(0) + 'ك' : String(Math.round(n)); };
const monthLabel = (p) => {
  if (!p) return '';
  const [y, m] = p.split('-');
  const names = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  return `${names[+m - 1] || m} ${y}`;
};
const STALE_MS = 6 * 3600_000;   // الشهر الجاري يُحدَّث تلقائياً إن مضت 6 ساعات

export default function FinancialPosition({ isActive = true }) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [snaps, setSnaps] = useState(null);
  const [sel, setSel] = useState(currentPnlPeriod());
  const [busy, setBusy] = useState(false);
  const [billedByMonth, setBilledByMonth] = useState(new Map());   // دفترنا (فحص الفجوة)
  const [invCol, setInvCol] = useState(null);                      // فوترنا/حصّلنا للشهر المحدد
  const [events, setEvents] = useState(null);                      // آخر الحركات (webhooks)

  const reload = useCallback(async () => {
    try { setSnaps(await loadPnlSnapshots()); }
    catch (e) { toast(`فشل تحميل القائمة: ${e.message}`, 'error'); }
  }, []);

  // تحميل أولي + تحديث تلقائي للشهر الجاري إن كان غائباً/قديماً
  useEffect(() => {
    if (!isActive || snaps != null) return;
    (async () => {
      let rows = [];
      try { rows = await loadPnlSnapshots(); setSnaps(rows); }
      catch (e) { toast(`فشل التحميل: ${e.message}`, 'error'); setSnaps([]); return; }
      const cur = currentPnlPeriod();
      const curSnap = rows.find(s => s.period === cur);
      const stale = !curSnap || (Date.now() - new Date(curSnap.fetched_at).getTime() > STALE_MS);
      if (stale) {
        try { await refreshPnlMonth(cur); setSnaps(await loadPnlSnapshots()); }
        catch { /* الكاش يكفي للعرض */ }
      }
    })();
  }, [isActive, snaps]);

  // فواتير الناقلين من دفترنا لكل شهر (فحص فجوة التسجيل) — تحميل كسول
  useEffect(() => {
    if (!isActive || billedByMonth.size) return;
    loadMonthlyReport().then(r => {
      const m = new Map();
      for (const row of r.rows || []) m.set(row.month, +(((m.get(row.month) || 0) + row.billed)).toFixed(2));
      setBilledByMonth(m);
    }).catch(() => {});
  }, [isActive, billedByMonth]);

  // مزامنة الفواتير/الدفعات تلقائياً إن قدُمت (+6 ساعات) ثم تحميل شريط
  // «فوترنا/حصّلنا» للشهر المحدد + آخر الأحداث الفورية
  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    (async () => {
      try {
        const st = await loadSyncState();
        const last = st.get('invoices')?.last_sync;
        if (!last || Date.now() - new Date(last).getTime() > STALE_MS) {
          await syncZohoDocs().catch(() => {});   // غير قاتل — المرايا الموجودة تكفي
        }
      } catch { /* تجاهل */ }
      if (cancelled) return;
      loadZohoEvents(10).then(e => { if (!cancelled) setEvents(e); }).catch(() => {});
    })();
    return () => { cancelled = true; };
  }, [isActive]);
  useEffect(() => {
    if (!isActive || !sel) return;
    let cancelled = false;
    loadInvoicedVsCollected(sel)
      .then(r => { if (!cancelled) setInvCol(r); })
      .catch(() => { if (!cancelled) setInvCol(null); });
    return () => { cancelled = true; };
  }, [isActive, sel]);

  const refresh = async (period) => {
    setBusy(true);
    try {
      await refreshPnlMonth(period);
      await reload();
      toast(`حُدّث ${monthLabel(period)} من زوهو ✓`, 'success');
    } catch (e) { toast(`فشل التحديث: ${e.message}`, 'error'); }
    setBusy(false);
  };

  const byPeriod = useMemo(() => new Map((snaps || []).map(s => [s.period, s])), [snaps]);
  const snap = byPeriod.get(sel);
  const prev = byPeriod.get(prevPnlPeriod(sel));
  const isCurrentMonth = sel === currentPnlPeriod();
  const quarters = useMemo(() => quarterTotals(snaps), [snaps]);
  const trend = useMemo(() => (snaps || []).slice(0, 6).reverse(), [snaps]);   // الأقدم→الأحدث للأعمدة

  // فجوة التسجيل: دفترنا (شامل ضريبة 15%) مقابل cogs زوهو (قبل الضريبة) —
  // من فحص الوكلاء: المقارنة المباشرة تصنع فجوة وهمية ~15% دائمة، فنقسم
  // دفترنا ÷1.15 (تقريب مُعلَن — الشحن الدولي VAT=0 يُبخَس قليلاً) ونستخدم
  // عتبة نسبية 5% لا رقماً ثابتاً.
  const gap = useMemo(() => {
    if (!snap) return null;
    const grossBilled = billedByMonth.get(sel);
    if (grossBilled == null) return null;
    const billedPreTax = +(grossBilled / 1.15).toFixed(2);
    const cogs = Number(snap.cogs) || 0;
    const diff = +(billedPreTax - cogs).toFixed(2);
    const threshold = Math.max(1000, billedPreTax * 0.05);
    return { billedPreTax, grossBilled, cogs, diff, threshold };
  }, [snap, billedByMonth, sel]);

  if (!can('money.pnl')) return <div style={{ padding: 40 }}><Empty icon="🔒" title="لا صلاحية" sub="تحتاج صلاحية «الوضع المالي»"/></div>;
  if (snaps == null) return <div style={{ padding: 60, textAlign: 'center' }}><Spinner size={26}/></div>;

  const net = Number(snap?.net) || 0;
  const prevNet = prev ? Number(prev.net) : null;
  const delta = prevNet != null && Math.abs(prevNet) > 0.01 ? +(((net - prevNet) / Math.abs(prevNet)) * 100).toFixed(0) : null;
  const profitable = net >= 0;

  return (
    <div style={{ padding: '20px 26px 70px', maxWidth: 1300, margin: '0 auto' }}>
      <PageHeader
        icon={<Wallet size={22}/>} iconColor="var(--green)"
        title="الوضع المالي"
        subtitle="قائمة الدخل الرسمية من Zoho Books — بلغة بسيطة"
        actions={
          <Btn size="sm" variant="ghost" icon={busy ? <Spinner size={13}/> : <RefreshCw size={14}/>}
            disabled={busy} onClick={() => refresh(sel)}>
            تحديث من زوهو
          </Btn>
        }
      />

      {/* مبدّل الشهور — الصافي مصغّراً تحت كل شهر */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        {(snaps || []).map(s => {
          const active = s.period === sel;
          const n = Number(s.net) || 0;
          return (
            <button key={s.period} onClick={() => setSel(s.period)}
              style={{
                padding: '6px 14px', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                border: `1px solid ${active ? 'var(--green)' : 'var(--border)'}`,
                background: active ? 'color-mix(in srgb, var(--green) 12%, transparent)' : 'var(--card)',
                color: active ? 'var(--green)' : 'var(--text)', textAlign: 'center',
              }}>
              {monthLabel(s.period)}
              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', marginTop: 1,
                color: n >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {n >= 0 ? '+' : '−'}{fmtK(Math.abs(n))}
              </div>
            </button>
          );
        })}
      </div>

      {!snap ? (
        <Card><Empty icon="📭" title="لا بيانات لهذا الشهر" sub="اضغط «تحديث من زوهو» لجلبه"/></Card>
      ) : (<>
        {/* ── بانر الحكم — سؤال الـ30 ثانية ── */}
        <Card style={{
          marginBottom: 16, padding: '22px 24px',
          border: `1.5px solid ${profitable ? 'var(--green)' : 'var(--red)'}`,
          background: profitable ? 'color-mix(in srgb, var(--green) 6%, transparent)' : 'color-mix(in srgb, var(--red) 6%, transparent)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            {profitable ? <TrendingUp size={30} color="var(--green)"/> : <TrendingDown size={30} color="var(--red)"/>}
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 19, fontWeight: 800, color: profitable ? 'var(--green)' : 'var(--red)' }}>
                {profitable ? '✅ رابحون' : '🔻 خاسرون'} في {monthLabel(sel)}: {net >= 0 ? '+' : '−'}{fmt(Math.abs(net))} ر.س
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4 }}>
                {isCurrentMonth && 'شهر جارٍ — الرقم يكبر مع كل فاتورة تُسجَّل · '}
                {delta != null && `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}% عن ${monthLabel(prevPnlPeriod(sel))} · `}
                آخر تحديث من زوهو: {snap.fetched_at ? new Date(snap.fetched_at).toLocaleString('ar-SA', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
              </div>
            </div>
          </div>
        </Card>

        {/* عمودان على العريض (شكوى «الهوامش عالية»): الشلال وفحوص الفجوة
            يميناً، الاتجاه/الأرباع/الحركات يساراً — يلتفّان عمودياً على الضيّق */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1.4 1 480px', minWidth: 0 }}>

        {/* ── فوترنا × وحصّلنا — من مرايا فواتير/دفعات زوهو (مزامنة دلتا) ── */}
        {invCol?.hasData && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
            <div style={{ flex: 1, minWidth: 165, background: 'var(--card)', border: '1px solid var(--border)',
              borderRadius: 12, padding: '12px 16px' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>🧾 فوترنا هذا الشهر ({invCol.invCount} فاتورة)</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 17, marginTop: 3 }}>{fmt(invCol.invoiced)} <span style={{ fontSize: 10, color: 'var(--muted)' }}>ر.س</span></div>
            </div>
            <div style={{ flex: 1, minWidth: 165, background: 'var(--card)', border: '1px solid var(--border)',
              borderRadius: 12, padding: '12px 16px' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>💰 وحصّلنا من العملاء ({invCol.payCount} دفعة)</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 17, marginTop: 3, color: 'var(--green)' }}>{fmt(invCol.collected)} <span style={{ fontSize: 10, color: 'var(--muted)' }}>ر.س</span></div>
            </div>
            <div style={{ flex: 1, minWidth: 165, background: 'var(--card)', border: '1px solid var(--border)',
              borderRadius: 12, padding: '12px 16px' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>⏳ الباقي عند العملاء من فواتير الشهر</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 17, marginTop: 3, color: invCol.invoiced - invCol.collected > 0.5 ? 'var(--gold)' : 'var(--green)' }}>
                {fmt(Math.max(0, +(invCol.invoiced - invCol.collected).toFixed(2)))} <span style={{ fontSize: 10, color: 'var(--muted)' }}>ر.س</span>
              </div>
            </div>
          </div>
        )}

        {/* ── الشلال — 4 سطور بلغة بشرية ── */}
        <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
          <WaterRow label="دخلنا من العملاء" hint="كل ما فوترناه هذا الشهر (بوليصات + مبيعات + رسوم)"
            value={snap.income} color="var(--green)" sign="+" lines={findLines(snap, 'الدخل التشغيلي')}/>
          <WaterRow label="دفعنا لشركات الشحن" hint="تكلفة البوليصات (ما يسجّله المحاسب من فواتير الناقلين)"
            value={snap.cogs} color="var(--red)" sign="−" lines={findLines(snap, 'تكلفة')}/>
          <WaterRow label="مصاريف التشغيل" hint="أجور · رسوم بنكية · وغيرها"
            value={snap.opex} color="var(--gold)" sign="−" lines={findLines(snap, 'المصروفات التشغيلية')}/>
          {(Number(snap.other_income) || 0) - (Number(snap.other_expense) || 0) !== 0 && (
            <WaterRow label="بنود غير تشغيلية" hint="دخل/مصاريف خارج النشاط الأساسي"
              value={(Number(snap.other_income) || 0) - (Number(snap.other_expense) || 0)} color="var(--muted)" sign="±"/>
          )}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '16px 18px', background: 'color-mix(in srgb, var(--green) 7%, transparent)',
            borderTop: '2px solid var(--border)',
          }}>
            <div style={{ fontWeight: 800, fontSize: 15 }}>= الباقي لنا (صافي الربح)</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 18,
              color: profitable ? 'var(--green)' : 'var(--red)' }}>
              {net >= 0 ? '+' : '−'}{fmt(Math.abs(net))} ر.س
            </div>
          </div>
        </Card>

        {/* ── فحص فجوة التسجيل — دفترنا × زوهو (مقارنة قبل الضريبة) ── */}
        {gap && gap.diff > gap.threshold && (
          <Card style={{ marginBottom: 16, border: '1px solid var(--red)', background: 'color-mix(in srgb, var(--red) 5%, transparent)' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <AlertTriangle size={18} color="var(--red)" style={{ flexShrink: 0, marginTop: 2 }}/>
              <div style={{ flex: 1, fontSize: 13, lineHeight: 1.8 }}>
                <b style={{ color: 'var(--red)' }}>فجوة تسجيل: ~{fmt(gap.diff)} ر.س فواتير ناقلين لم تدخل زوهو بعد</b>
                <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                  دفترنا يعرف فواتير ناقلين بـ{fmt(gap.billedPreTax)} ر.س قبل الضريبة لشهر {monthLabel(sel)}
                  (الإجمالي الشامل {fmt(gap.grossBilled)} ÷ 1.15)، بينما زوهو سجّل {fmt(gap.cogs)} فقط —
                  الربح المعروض أعلاه <b>أعلى من الحقيقة</b> حتى يسجّلها المحاسب. المقارنة تقريبية قبل الضريبة.
                </div>
                <Btn size="sm" variant="ghost" style={{ marginTop: 6 }} onClick={() => navigate('/ledger')}>
                  فتح دفتر الشركات <ChevronLeft size={12}/>
                </Btn>
              </div>
            </div>
          </Card>
        )}
        {gap && gap.diff < -gap.threshold && (
          <Card style={{ marginBottom: 16, border: '1px solid var(--gold)', background: 'color-mix(in srgb, var(--gold) 6%, transparent)' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <AlertTriangle size={18} color="var(--gold)" style={{ flexShrink: 0, marginTop: 2 }}/>
              <div style={{ fontSize: 13, lineHeight: 1.8 }}>
                <b style={{ color: 'var(--gold)' }}>زوهو سجّل تكاليف ناقلين ~{fmt(Math.abs(gap.diff))} ر.س أكثر مما يعرفه دفترنا</b>
                <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                  فواتير دخلت المحاسبة ولم تُدقَّق عندنا؟ ({fmt(gap.cogs)} في زوهو مقابل {fmt(gap.billedPreTax)} قبل الضريبة بدفترنا)
                </div>
              </div>
            </div>
          </Card>
        )}

        </div>{/* نهاية العمود الرئيسي */}
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>

        {/* ── الاتجاه + الأرباع (العمود الجانبي) ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14, marginBottom: 16 }}>
          <Card>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 14 }}>📈 صافي الربح — آخر {trend.length} أشهر</div>
            <TrendBars data={trend} onPick={setSel} sel={sel}/>
          </Card>
          <Card>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 14 }}>🗓 الأرباع</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {quarters.slice(0, 3).map(q => (
                <div key={q.quarter} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '10px 12px', background: 'var(--surface2)', borderRadius: 10 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{q.quarter.replace('-Q', ' — الربع ')}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                      {q.complete ? '3 أشهر مكتملة' : `${q.months.length} من 3 أشهر${q.months.includes(currentPnlPeriod()) ? ' (جارٍ)' : ''}`}
                    </div>
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 15,
                    color: q.net >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {q.net >= 0 ? '+' : '−'}{fmt(Math.abs(q.net))}
                  </div>
                </div>
              ))}
              {!quarters.length && <Empty icon="🗓" title="لا أرباع بعد"/>}
            </div>
          </Card>
        </div>

        {/* ── آخر الحركات (أحداث فورية من زوهو) — نبض فقط، لا تدخل الربح ── */}
        {events?.length > 0 && (
          <Card style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12 }}>⚡ آخر الحركات — لحظياً من زوهو</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {events.map(e => (
                <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5,
                  padding: '8px 10px', background: 'var(--surface2)', borderRadius: 9 }}>
                  <span style={{ fontSize: 15 }}>{e.event_type === 'payment_received' ? '💰' : e.event_type === 'invoice_created' ? '🧾' : '📄'}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.event_type === 'payment_received' ? 'دفعة من' : e.event_type === 'invoice_created' ? 'فاتورة لـ' : 'حدث —'} <b>{e.contact_name || '—'}</b>
                    {e.ref_number ? <span style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}> · {e.ref_number}</span> : null}
                  </span>
                  {e.amount != null && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700,
                      color: e.event_type === 'payment_received' ? 'var(--green)' : 'var(--text)' }}>
                      {fmt(e.amount)}
                    </span>
                  )}
                  <span style={{ fontSize: 10.5, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                    {e.received_at ? new Date(e.received_at).toLocaleString('ar-SA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}

        </div>{/* نهاية العمود الجانبي */}
        </div>{/* نهاية صف العمودين */}

        {/* القاعدة الثابتة */}
        <div style={{ fontSize: 11.5, color: 'var(--muted)', textAlign: 'center', marginTop: 4 }}>
          💡 تحصيل COD ليس دخلاً — أمانة التجار تمرّ عبرنا. الدخل هنا = ما نفوتره نحن للعملاء (أرقام زوهو الرسمية).
        </div>
      </>)}
    </div>
  );
}

// سطر شلال: تسمية بشرية + hint + المبلغ + تفاصيل الحسابات قابلة للطي
function WaterRow({ label, hint, value, color, sign, lines }) {
  const v = Number(value) || 0;
  return (
    <div style={{ borderBottom: '1px solid var(--border)', padding: '13px 18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{sign} {label}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{hint}</div>
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 15.5, color, whiteSpace: 'nowrap' }}>
          {fmt(v)} <span style={{ fontSize: 10, color: 'var(--muted)' }}>ر.س</span>
        </div>
      </div>
      {lines?.length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary style={{ fontSize: 11, color: 'var(--muted)', cursor: 'pointer' }}>التفاصيل ({lines.length})</summary>
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {lines.map((a, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text2)' }}>
                <span>{a.name}</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{fmt(a.total)}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// حسابات مجموعة من lines (jsonb المخزَّن) بمطابقة اسم المجموعة
function findLines(snap, namePart) {
  const g = (snap?.lines || []).find(l => String(l.group || '').includes(namePart));
  return g?.accounts?.filter(a => Math.abs(a.total) > 0.001) || [];
}

// أعمدة اتجاه بسيطة (divs — بلا مكتبات)
function TrendBars({ data, onPick, sel }) {
  if (!data?.length) return <Empty icon="📈" title="لا بيانات"/>;
  const max = Math.max(...data.map(s => Math.abs(Number(s.net) || 0)), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 130 }}>
      {data.map(s => {
        const n = Number(s.net) || 0;
        const h = Math.max(6, Math.round((Math.abs(n) / max) * 100));
        const active = s.period === sel;
        return (
          <button key={s.period} onClick={() => onPick(s.period)} title={`${monthLabelShort(s.period)}: ${n.toFixed(0)}`}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            <span style={{ fontSize: 9.5, fontFamily: 'var(--font-mono)', color: n >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {Math.abs(n) >= 1000 ? (n / 1000).toFixed(0) + 'ك' : Math.round(n)}
            </span>
            <div style={{
              width: '100%', height: h, borderRadius: 6,
              background: n >= 0 ? 'var(--green)' : 'var(--red)',
              opacity: active ? 1 : 0.45, transition: 'opacity .15s',
            }}/>
            <span style={{ fontSize: 9.5, color: active ? 'var(--text)' : 'var(--muted)', fontWeight: active ? 700 : 400 }}>
              {monthLabelShort(s.period)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
const monthLabelShort = (p) => {
  const names = ['ينا','فبر','مار','أبر','ماي','يون','يول','أغس','سبت','أكت','نوف','ديس'];
  const [, m] = p.split('-');
  return names[+m - 1] || p;
};

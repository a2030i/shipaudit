import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  AlertOctagon, Wallet, TrendingDown, TrendingUp, Clock, Building2,
  RefreshCw, ArrowLeft, Upload, FileText, BookOpen, Bell, Search, ExternalLink,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Card, Btn, Spinner, Empty, toast, PageHero, SpotlightCard, Sparkline, Donut, SectionTitle } from '../components/UI.jsx';
import {
  loadCarriersOverview, aggregateOverview, loadRecentActivity, loadOperations,
  loadStaleDisputes,
} from '../lib/carrierStatementsService.js';
import { loadAuditsFromDB, searchAwbAcrossAudits, loadAuditByIdFromDB } from '../lib/coreService.js';
import { loadOutstandingByCarrier } from '../lib/codSettlementService.js';
import { Banknote } from 'lucide-react';

const fmt = n => (n == null || Number.isNaN(n))
  ? '—'
  : Number(n).toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtCompact = n => {
  if (n == null) return '—';
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'م';
  if (Math.abs(n) >= 1_000)     return (n / 1_000).toFixed(1) + 'ك';
  return n.toFixed(0);
};

export default function Dashboard({ carriers, onNavigate, isActive = true }) {
  const navigate = useNavigate();
  const [overview, setOverview]   = useState([]);
  const [audits,   setAudits]     = useState([]);
  const [activity, setActivity]   = useState({ statements: [], operations: [] });
  const [actionItems, setActionItems] = useState([]);
  const [dueWeek, setDueWeek]   = useState([]); // operations due in next 7 days
  const [staleDisputes, setStaleDisputes] = useState([]);
  // codOutstanding: [{ carrierId, carrierName, logo, color, amount }]
  // — outstanding COD remittances per carrier, zero-balance ones
  // dropped. Drives the "تحصيلات COD المتبقّية" card.
  const [codOutstanding, setCodOutstanding] = useState([]);
  const [loading,  setLoading]    = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [ov, ad, act, allOps, stale, codMap] = await Promise.all([
        loadCarriersOverview(),
        loadAuditsFromDB(8),
        loadRecentActivity(6),
        loadOperations({}),
        loadStaleDisputes({ thresholdDays: 30 }),
        loadOutstandingByCarrier(),
      ]);
      setStaleDisputes(stale);
      // Build action-required list across all carriers.
      const today = new Date().toISOString().slice(0, 10);
      const sevenDaysFromNow = new Date();
      sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
      const weekHorizon = sevenDaysFromNow.toISOString().slice(0, 10);

      const open = (allOps || []).filter(o => o.status !== 'paid' && o.status !== 'waived');

      // Due-this-week = open + due_date in [today, today+7]
      const due = open
        .filter(o => o.due_date && o.due_date >= today && o.due_date <= weekHorizon)
        .sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''));
      setDueWeek(due);

      // Action required: overdue / disputed / reviewing
      const actions = open
        .map(o => {
          let kind = null;
          if (o.due_date && o.due_date < today)  kind = 'overdue';
          else if (o.status === 'disputed')      kind = 'disputed';
          else if (o.status === 'reviewing')     kind = 'reviewing';
          if (!kind) return null;
          return { ...o, _kind: kind };
        })
        .filter(Boolean)
        .sort((a, b) => {
          // overdue → reviewing → disputed; within each, oldest first
          const order = { overdue: 0, reviewing: 1, disputed: 2 };
          if (order[a._kind] !== order[b._kind]) return order[a._kind] - order[b._kind];
          return (a.due_date || a.doc_date || '').localeCompare(b.due_date || b.doc_date || '');
        })
        .slice(0, 12);
      setActionItems(actions);
      // Decorate overview rows with carrier metadata (logo, color, name fallback)
      const byId = new Map((carriers ?? []).map(c => [c.id, c]));
      ov.forEach(r => {
        const c = byId.get(r.carrierId);
        if (c) {
          r.carrierName = r.carrierName ?? c.name;
          r.logo  = c.logo;
          r.color = c.color;
        }
      });
      setOverview(ov);
      setAudits(ad);
      setActivity(act);

      // Flatten the COD outstanding map into a sorted list of carriers
      // with non-zero balances. The card on the dashboard shows them
      // largest-first.
      const carriersById = new Map((carriers ?? []).map(c => [c.id, c]));
      const codList = [...(codMap?.entries?.() ?? codMap ?? [])]
        .filter(([, amt]) => amt > 0)
        .map(([carrierId, amount]) => {
          const c = carriersById.get(carrierId);
          return {
            carrierId,
            carrierName: c?.name || carrierId,
            logo:        c?.logo || '📦',
            color:       c?.color || '#2DD4BF',
            amount,
          };
        })
        .sort((a, b) => b.amount - a.amount);
      setCodOutstanding(codList);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, [carriers]);

  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh]);

  const totals = useMemo(() => aggregateOverview(overview), [overview]);

  // Build a 14-point trend from the most recent audits — gives the
  // SpotlightCard sparkline real movement instead of a flat line. We
  // walk the audits oldest→newest so the line reads left-to-right
  // (older on the right in RTL, newer on the left). If we don't have
  // enough audits, the sparkline silently hides itself.
  const trendData = useMemo(() => {
    if (!audits?.length) return [];
    const ordered = [...audits]
      .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
      .slice(-14);
    const pts = ordered.map(a => Number(a.total_billed || a.totalBilled || a.total_expected || a.totalExpected) || 0);
    return pts;
  }, [audits]);

  // Aging segments for the donut. We re-derive from totals.aging so
  // both the donut and the existing list-bar can render the same
  // numbers in different shapes.
  const agingSegments = useMemo(() => ([
    { value: totals.aging?.d0_30   || 0, color: '#10B981', label: 'حتى 30 يوم' },
    { value: totals.aging?.d31_60  || 0, color: '#F59E0B', label: '31 إلى 60' },
    { value: totals.aging?.d61_90  || 0, color: '#F97316', label: '61 إلى 90' },
    { value: totals.aging?.over90  || 0, color: '#EF4444', label: 'فوق 90 يوم' },
  ]), [totals]);
  const agingTotal = agingSegments.reduce((s, x) => s + x.value, 0);

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '28px 32px', maxWidth: 1400 }}>
      <SpotlightCard
        tag="LAMHA · FINANCIAL CONTROL"
        title="إجمالي المستحقات لشركات الشحن"
        value={fmt(totals.outstanding)}
        suffix="ر.س"
        sparkline={trendData}
        accent="#2DD4BF"
        side={
          <button
            onClick={refresh}
            disabled={loading}
            style={{
              background: 'rgba(255,255,255,.10)',
              border: '1px solid rgba(255,255,255,.22)',
              color: '#fff',
              padding: '10px 18px',
              borderRadius: 9, fontSize: 12.5, fontWeight: 600,
              cursor: loading ? 'wait' : 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontFamily: 'var(--font-sans)',
            }}
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''}/>
            {loading ? 'جارٍ التحميل…' : 'تحديث البيانات'}
          </button>
        }
        stats={[
          { label: 'متأخر',         value: `${fmtCompact(totals.overdueAmount)} ر.س`, color: '#FCD34D' },
          { label: 'مسدّد سابقاً',   value: `${fmtCompact(totals.paidTotal)} ر.س`,    color: '#86EFAC' },
          { label: 'شركات نشطة',    value: overview.length },
          { label: 'عمليات مفتوحة', value: totals.pendingCount + totals.auditedCount + totals.disputedCount + totals.reviewingCount },
        ]}
      />

      {loading && overview.length === 0 ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner size={28}/></div>
      ) : (
        <>
          {/* AWB lookup — fastest path during a dispute. Type a tracking
              number, see every audit that ever billed this shipment. */}
          <AwbSearchCard/>

          {/* AGING DONUT  +  STATUS BREAKDOWN  ────────────────────────
              Two-column visual section. Left: donut chart of receivable
              ages (the most decision-driving cut). Right: status counts
              as a clean rail with coloured dot + count + percentage. */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)',
            gap: 14, marginBottom: 22,
          }}>
            {/* Aging donut */}
            <Card style={{ padding: '20px 24px' }}>
              <SectionTitle
                tag="AGING"
                title="أعمار الديون"
                color="var(--gold)"
              />
              {agingTotal <= 0 ? (
                <div style={{ color: 'var(--muted)', fontSize: 12, padding: '20px 0', textAlign: 'center' }}>
                  لا توجد التزامات حالياً
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 28, alignItems: 'center' }}>
                  <Donut
                    segments={agingSegments}
                    size={170} thickness={20}
                  >
                    <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)', letterSpacing: 1, textTransform: 'uppercase', fontWeight: 600 }}>
                      الإجمالي
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-mono)', letterSpacing: -0.5, marginTop: 2 }}>
                      {fmtCompact(agingTotal)}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>ر.س</div>
                  </Donut>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {agingSegments.map(s => {
                      const pct = agingTotal > 0 ? (s.value / agingTotal) * 100 : 0;
                      return (
                        <div key={s.label} style={{
                          display: 'grid',
                          gridTemplateColumns: 'auto 1fr auto auto',
                          gap: 10, alignItems: 'center', fontSize: 12.5,
                        }}>
                          <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }}/>
                          <span style={{ color: 'var(--muted)', fontWeight: 500 }}>{s.label}</span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: s.color }}>
                            {fmtCompact(s.value)}
                          </span>
                          <span style={{ color: 'var(--muted2)', fontSize: 10.5, fontFamily: 'var(--font-mono)', minWidth: 36, textAlign: 'left' }}>
                            {pct.toFixed(0)}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </Card>

            {/* Status breakdown — clean rail */}
            <Card style={{ padding: '20px 24px' }}>
              <SectionTitle
                tag="OPERATIONS"
                title="توزيع العمليات"
              />
              <StatusRail items={[
                { label: 'معلّقة',    n: totals.pendingCount,   color: '#F59E0B', icon: <Clock size={14}/> },
                { label: 'معتمدة',    n: totals.auditedCount,   color: '#14B8A6', icon: <FileText size={14}/> },
                { label: 'تحت المراجعة', n: totals.reviewingCount, color: '#7C3AED', icon: <RefreshCw size={14}/> },
                { label: 'متنازع',    n: totals.disputedCount,  color: '#EF4444', icon: <AlertOctagon size={14}/> },
                { label: 'مسدّدة',     n: totals.paidCount,      color: '#10B981', icon: <TrendingDown size={14}/> },
              ]}/>
            </Card>
          </div>

          {/* COD OUTSTANDING per carrier — what each carrier still
              owes us in cash. Zero-balance carriers excluded so the
              card stays focused on what needs follow-up. */}
          {codOutstanding.length > 0 && (() => {
            const grand = codOutstanding.reduce((s, x) => s + x.amount, 0);
            return (
              <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 18, borderTop: '3px solid #2DD4BF' }}>
                <div style={{
                  padding: '14px 20px', borderBottom: '1px solid var(--border)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                    <Banknote size={16} color="var(--accent)"/>
                    تحصيلات COD المتبقّية ({codOutstanding.length} شركة)
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--accent)', fontWeight: 700 }}>
                    إجمالي: {fmt(grand)} ر.س
                  </span>
                </div>
                <div style={{ padding: '10px 8px' }}>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: 8,
                  }}>
                    {codOutstanding.map(c => (
                      <button
                        key={c.carrierId}
                        onClick={() => navigate('/cod-settlements')}
                        style={{
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                          borderRight: `3px solid ${c.color}`,
                          borderRadius: 9,
                          padding: '10px 14px',
                          display: 'flex', alignItems: 'center', gap: 10,
                          cursor: 'pointer', textAlign: 'right',
                          transition: 'all .18s',
                          fontFamily: 'inherit',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.background = 'var(--card)'; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--surface)'; }}
                      >
                        <span style={{ fontSize: 22, flexShrink: 0 }}>{c.logo}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {c.carrierName}
                          </div>
                          <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>
                            متبقّي عند الناقل
                          </div>
                        </div>
                        <div style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 700, color: c.color }}>
                            {fmt(c.amount)}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1 }}>ر.س</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </Card>
            );
          })()}

          {/* DUE THIS WEEK — operations whose due_date is within the next 7 days */}
          {dueWeek.length > 0 && (() => {
            const totalDue = dueWeek.reduce((s, o) => s + ((Number(o.amount_dr) || 0) - (Number(o.amount_cr) || 0)), 0);
            return (
              <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 18, borderTop: '3px solid var(--accent)' }}>
                <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    📅 مستحق هذا الأسبوع ({dueWeek.length})
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--gold)', fontWeight: 700 }}>
                    {fmt(totalDue)} ر.س
                  </span>
                </div>
                <div style={{ maxHeight: 280, overflowY: 'auto' }}>
                  {dueWeek.map(o => {
                    const amount = (Number(o.amount_dr) || 0) - (Number(o.amount_cr) || 0);
                    const daysLeft = Math.ceil((new Date(o.due_date) - new Date()) / 86_400_000);
                    return (
                      <div key={o.id} style={{
                        padding: '10px 18px', borderBottom: '1px solid var(--border)22',
                        display: 'grid', gridTemplateColumns: '90px 1fr auto auto', gap: 12, alignItems: 'center',
                      }}>
                        <span style={{
                          background: 'var(--accent)18', border: '1px solid var(--accent)40',
                          color: 'var(--accent)', fontSize: 10, fontWeight: 700,
                          padding: '2px 8px', borderRadius: 12, fontFamily: 'var(--font-mono)',
                          textAlign: 'center', whiteSpace: 'nowrap',
                        }}>
                          {daysLeft <= 0 ? 'اليوم' : `بعد ${daysLeft} يوم`}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                            <span style={{ color: 'var(--accent)' }}>{o.doc_no}</span>
                            <span style={{ color: 'var(--muted)' }}> · {o.doc_type}</span>
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {o.carrier_id} · يستحق {o.due_date}
                          </div>
                        </div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--red)', textAlign: 'left' }}>
                          {fmt(amount)}
                        </div>
                        <Btn size="sm" variant="ghost" onClick={() => onNavigate(`ledger?carrier=${o.carrier_id}`)}>
                          فتح
                        </Btn>
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })()}

          {/* STALE DISPUTES — disputes opened > 30 days ago, still unresolved.
              Surfaced separately because they're an SLA / collection-risk
              signal the AP person needs to chase, distinct from the
              "anything overdue" pile in the action card below. */}
          {staleDisputes.length > 0 && (() => {
            const totalAmt = staleDisputes.reduce(
              (s, o) => s + ((Number(o.amount_dr) || 0) - (Number(o.amount_cr) || 0)), 0,
            );
            const today = new Date(); today.setHours(0,0,0,0);
            return (
              <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 18, borderTop: '3px solid var(--red)' }}>
                <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--red)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    🚨 نزاعات قديمة بدون حل ({staleDisputes.length})
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--red)', fontWeight: 700 }}>
                    {fmt(totalAmt)} ر.س
                  </span>
                </div>
                <div style={{ padding: '8px 18px', fontSize: 11, color: 'var(--muted)', borderBottom: '1px dashed var(--border)' }}>
                  هذي النزاعات مرّ عليها أكثر من 30 يوم بدون رد من الناقل أو إغلاق — متابعة عاجلة موصى بها.
                </div>
                <div style={{ maxHeight: 280, overflowY: 'auto' }}>
                  {staleDisputes.map(o => {
                    const amount = (Number(o.amount_dr) || 0) - (Number(o.amount_cr) || 0);
                    const days = o.dispute_opened_at
                      ? Math.floor((today - new Date(o.dispute_opened_at)) / 86_400_000)
                      : 0;
                    return (
                      <div key={o.id} style={{
                        padding: '10px 18px', borderBottom: '1px solid var(--border)22',
                        display: 'grid', gridTemplateColumns: '90px 1fr auto auto', gap: 12, alignItems: 'center',
                      }}>
                        <span style={{
                          background: 'rgba(248,113,113,.15)', border: '1px solid var(--red)40',
                          color: 'var(--red)', fontSize: 10, fontWeight: 700,
                          padding: '2px 8px', borderRadius: 12, fontFamily: 'var(--font-mono)',
                          textAlign: 'center', whiteSpace: 'nowrap',
                        }}>
                          {days} يوم
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                            <span style={{ color: 'var(--accent)' }}>{o.doc_no}</span>
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            فُتح {o.dispute_opened_at?.slice(0,10) ?? '—'} · {o.carrier_id}
                          </div>
                        </div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--red)', textAlign: 'left' }}>
                          {fmt(amount)}
                        </div>
                        <Btn size="sm" variant="ghost" onClick={() => onNavigate(`ledger?carrier=${o.carrier_id}&doc=${o.doc_no}`)}>
                          فتح
                        </Btn>
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })()}

          {/* ACTION REQUIRED — overdue / disputed / reviewing */}
          {actionItems.length > 0 && (
            <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 18, borderTop: '3px solid var(--gold)' }}>
              <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--gold)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Bell size={14}/> إجراءات مطلوبة ({actionItems.length})
                </span>
                <Btn size="sm" variant="ghost" onClick={() => onNavigate('ledger')} icon={<BookOpen size={12}/>}>
                  افتح الدفتر
                </Btn>
              </div>
              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                {actionItems.map(o => {
                  const kindMeta = {
                    overdue:   { label: '⚠ متأخّرة',  color: 'var(--gold)' },
                    disputed:  { label: '✗ متنازع',  color: 'var(--red)' },
                    reviewing: { label: '🔄 مراجعة', color: 'var(--gold)' },
                  }[o._kind];
                  const amount = (Number(o.amount_dr) || 0) - (Number(o.amount_cr) || 0);
                  return (
                    <div key={o.id} style={{
                      padding: '10px 18px', borderBottom: '1px solid var(--border)22',
                      display: 'grid', gridTemplateColumns: '110px 1fr auto auto', gap: 12, alignItems: 'center',
                    }}>
                      <span style={{
                        background: `${kindMeta.color}20`, border: `1px solid ${kindMeta.color}40`,
                        color: kindMeta.color, fontSize: 10, fontWeight: 700,
                        padding: '2px 8px', borderRadius: 12, fontFamily: 'var(--font-mono)',
                        textAlign: 'center', whiteSpace: 'nowrap',
                      }}>{kindMeta.label}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                          <span style={{ color: 'var(--accent)' }}>{o.doc_no}</span>
                          <span style={{ color: 'var(--muted)' }}> · {o.doc_type}</span>
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {o.carrier_id} · {o.due_date ? `يستحق ${o.due_date}` : `بتاريخ ${o.doc_date || '—'}`}
                        </div>
                      </div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--red)', textAlign: 'left' }}>
                        {fmt(amount)}
                      </div>
                      <Btn size="sm" variant="ghost" onClick={() => onNavigate(`ledger?carrier=${o.carrier_id}`)}>
                        فتح
                      </Btn>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* TOP CREDITORS TABLE */}
          <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 18 }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <TrendingUp size={14}/> أعلى الالتزامات حسب الشركة
              </span>
              <Btn size="sm" variant="ghost" onClick={() => onNavigate('aramex-statements')} icon={<Upload size={12}/>}>
                رفع كشف
              </Btn>
            </div>
            {overview.length === 0
              ? <Empty icon="📒" title="لا توجد بيانات بعد" sub="ارفع كشف حساب من شركة شحن للبدء"/>
              : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ fontSize: 12, width: '100%' }}>
                    <thead>
                      <tr>
                        <th style={{ minWidth: 140 }}>الشركة</th>
                        <th style={{ minWidth: 130, textAlign: 'left' }}>المستحق</th>
                        <th style={{ minWidth: 130, textAlign: 'left' }}>متأخّر</th>
                        <th>عمليات مفتوحة</th>
                        <th>متأخّرة</th>
                        <th>متنازع</th>
                        <th style={{ minWidth: 120 }}>آخر كشف</th>
                        <th style={{ minWidth: 90 }}/>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.map(r => {
                        const openOps = r.pendingCount + r.auditedCount + r.disputedCount + r.reviewingCount;
                        return (
                          <tr key={r.carrierId}>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <span style={{ fontSize: 18 }}>{r.logo || '📦'}</span>
                                <span style={{ fontWeight: 600 }}>{r.carrierName || r.carrierId}</span>
                              </div>
                            </td>
                            <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: r.outstanding > 0 ? 'var(--red)' : 'var(--muted)', textAlign: 'left' }}>
                              {fmt(r.outstanding)}
                            </td>
                            <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: r.overdueAmount > 0 ? 'var(--gold)' : 'var(--muted3)', textAlign: 'left' }}>
                              {r.overdueAmount > 0 ? fmt(r.overdueAmount) : '—'}
                            </td>
                            <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)' }}>{openOps}</td>
                            <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', color: r.overdueCount > 0 ? 'var(--gold)' : 'var(--muted3)' }}>
                              {r.overdueCount || '—'}
                            </td>
                            <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', color: r.disputedCount > 0 ? 'var(--red)' : 'var(--muted3)' }}>
                              {r.disputedCount || '—'}
                            </td>
                            <td style={{ fontSize: 11, color: 'var(--muted)' }}>
                              {r.lastStatementAt ? new Date(r.lastStatementAt).toLocaleDateString('ar-SA') : '—'}
                            </td>
                            <td>
                              <Btn size="sm" variant="ghost" onClick={() => onNavigate(`ledger?carrier=${r.carrierId}`)} icon={<BookOpen size={12}/>}>
                                الدفتر
                              </Btn>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )
            }
          </Card>

          {/* RECENT ACTIVITY · 2-column */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 14, marginBottom: 18 }}>
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent)' }}>📑 آخر الكشوف المرفوعة</span>
              </div>
              {activity.statements.length === 0
                ? <Empty icon="📑" title="لا توجد كشوف"/>
                : (
                  <div>
                    {activity.statements.map(s => (
                      <div key={s.id} style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)22', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 2 }}>{s.carrier_name}</div>
                          <div style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {s.period_from} ← {s.period_to} · {s.file_name}
                          </div>
                        </div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>
                          {fmtCompact(s.total_balance)}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              }
            </Card>

            <Card style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent)' }}>🔬 آخر مراجعات الفواتير</span>
                <Btn size="sm" variant="ghost" onClick={() => onNavigate('audits')}>الكل</Btn>
              </div>
              {audits.length === 0
                ? <Empty icon="📋" title="لا توجد مراجعات"/>
                : (
                  <div>
                    {audits.map(a => (
                      <div key={a.id} style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)22', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 12 }}>{a.carrierName}</div>
                          <div style={{ fontSize: 10, color: 'var(--muted)' }}>{a.period} · {a.rowCount ?? 0} شحنة</div>
                        </div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: (a.issueCount ?? 0) > 0 ? 'var(--red)' : 'var(--green)' }}>
                          {(a.issueCount ?? 0) > 0 ? `✗ ${a.issueCount}` : '✓'}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              }
            </Card>
          </div>

          {/* Empty state */}
          {overview.length === 0 && audits.length === 0 && (
            <Card style={{ textAlign: 'center', padding: 32 }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>🚀</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>ابدأ نظامك المركزي</div>
              <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 20 }}>
                ارفع كشف حساب من أرامكس، أو دقّق فاتورة شحنات
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                <Btn variant="primary" onClick={() => onNavigate('aramex-statements')} icon={<Upload size={14}/>}>
                  رفع كشف أرامكس
                </Btn>
                <Btn variant="ghost" onClick={() => onNavigate('upload')}>
                  مراجعة فاتورة شحنات
                </Btn>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ── Hero KPI ───────────────────────────────────────────────────────────
// ── StatusRail ──────────────────────────────────────────────────────────────
// Clean horizontal-bar list for breaking down counts by status. Each row:
//   [icon-tile]  label  ─────────────  count  pct
// The bar grows proportional to the largest value, giving a visual
// hierarchy without needing a separate chart.
function StatusRail({ items }) {
  const max = Math.max(1, ...items.map(i => i.n || 0));
  const total = items.reduce((s, i) => s + (i.n || 0), 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map(it => {
        const n = it.n || 0;
        const pct = total > 0 ? (n / total) * 100 : 0;
        const barW = total > 0 ? (n / max) * 100 : 0;
        return (
          <div key={it.label} style={{
            display: 'grid',
            gridTemplateColumns: '28px 1fr auto auto',
            gap: 12, alignItems: 'center',
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8,
              background: `color-mix(in srgb, ${it.color} 12%, transparent)`,
              color: it.color,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>{it.icon}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
                {it.label}
              </div>
              <div style={{
                height: 4, borderRadius: 999,
                background: 'var(--bg2)', overflow: 'hidden',
              }}>
                <div style={{
                  width: `${barW}%`, height: '100%',
                  background: it.color, borderRadius: 999,
                  transition: 'width .4s cubic-bezier(.4,0,.2,1)',
                }}/>
              </div>
            </div>
            <span style={{
              fontFamily: 'var(--font-mono)', fontWeight: 700,
              fontSize: 16, color: it.color, minWidth: 32, textAlign: 'left',
            }}>{n}</span>
            <span style={{
              color: 'var(--muted2)', fontSize: 10.5, fontFamily: 'var(--font-mono)',
              minWidth: 36, textAlign: 'left',
            }}>{pct.toFixed(0)}%</span>
          </div>
        );
      })}
    </div>
  );
}

function Hero({ label, icon, value, suffix, color, hint, big }) {
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 'var(--r-lg)', padding: '16px 20px',
      boxShadow: 'var(--shadow-sm)',
      position: 'relative',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{
          color: 'var(--muted)', fontSize: 10.5, fontFamily: 'var(--font-mono)',
          letterSpacing: 1, textTransform: 'uppercase', fontWeight: 600,
        }}>{label}</span>
        {icon && (
          <div style={{
            width: 30, height: 30, borderRadius: 8,
            background: `color-mix(in srgb, ${color} 12%, transparent)`,
            color, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{icon}</div>
        )}
      </div>
      <div style={{
        color, fontSize: big ? 26 : 22, fontFamily: 'var(--font-mono)', fontWeight: 700,
        whiteSpace: 'nowrap', letterSpacing: -0.4, lineHeight: 1,
      }}>
        {value}
        {suffix && <span style={{ fontSize: 11, color: 'var(--muted)', marginRight: 5, fontWeight: 500 }}> {suffix}</span>}
      </div>
      {hint && <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 6 }}>{hint}</div>}
    </div>
  );
}

// ── Aging bar ──────────────────────────────────────────────────────────
function AgingBar({ aging }) {
  const total = aging.d0_30 + aging.d31_60 + aging.d61_90 + aging.over90;
  const pct = total > 0 ? n => (n / total) * 100 : () => 0;
  const segs = [
    { key: '0_30',   label: 'حتى 30 يوم',  v: aging.d0_30,   color: 'var(--green)' },
    { key: '31_60',  label: '31 إلى 60',   v: aging.d31_60,  color: 'var(--gold)'  },
    { key: '61_90',  label: '61 إلى 90',   v: aging.d61_90,  color: 'var(--warn)'  },
    { key: 'over90', label: 'فوق 90 يوم',  v: aging.over90,  color: 'var(--red)'   },
  ];

  if (total <= 0) {
    return <div style={{ color: 'var(--muted)', fontSize: 12, padding: '10px 0' }}>لا توجد التزامات حالياً</div>;
  }

  return (
    <>
      <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', marginBottom: 14, background: 'var(--surface)' }}>
        {segs.map(s => s.v > 0 && (
          <div key={s.key} style={{ flex: pct(s.v), background: s.color }} title={`${s.label}: ${s.v.toFixed(2)}`}/>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8 }}>
        {segs.map(s => (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color, flexShrink: 0 }}/>
            <span style={{ flex: 1, color: 'var(--muted)' }}>{s.label}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: s.color }}>
              {fmt(s.v)}
            </span>
            <span style={{ color: 'var(--muted3)', fontSize: 10, fontFamily: 'var(--font-mono)' }}>
              {pct(s.v).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

// ── Count row ──────────────────────────────────────────────────────────
function CountRow({ label, n, color }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '8px 12px', borderRadius: 8, background: 'var(--surface)',
      border: '1px solid var(--border)',
    }}>
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</span>
      <span style={{ color, fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 14 }}>{n}</span>
    </div>
  );
}

// ── AWB search ─────────────────────────────────────────────────────────
// Drill-down for disputes: paste any AWB / tracking number and we surface
// every audit that ever billed it (shipping side + COD side, across
// months). Clicking a hit loads the full audit and routes to /results.
const AUDIT_TYPE_META_DASH = {
  domestic:      { label: 'محلي',           icon: '🇸🇦', color: '#22c55e' },
  international: { label: 'دولي',           icon: '🌐', color: '#f59e0b' },
  cod:           { label: 'COD',            icon: '💰', color: '#a855f7' },
  mixed:         { label: 'مختلط',          icon: '🔀', color: '#06b6d4' },
  unknown:       { label: '—',              icon: '❓', color: 'var(--muted)' },
};

function AwbSearchCard() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null); // null = no search yet
  const [searching, setSearching] = useState(false);
  const [loadingAudit, setLoadingAudit] = useState(null);

  const runSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try {
      const hits = await searchAwbAcrossAudits(q);
      setResults(hits);
    } catch (e) {
      toast(`فشل البحث: ${e.message}`, 'error');
      setResults([]);
    }
    setSearching(false);
  };

  const openAudit = async (auditId) => {
    setLoadingAudit(auditId);
    try {
      const full = await loadAuditByIdFromDB(auditId);
      sessionStorage.setItem('lastAudit', JSON.stringify(full));
      navigate('/results');
    } catch (e) {
      toast(`فشل التحميل: ${e.message}`, 'error');
    }
    setLoadingAudit(null);
  };

  const clearSearch = () => { setQuery(''); setResults(null); };

  return (
    <Card style={{ padding: 14, marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <Search size={16} color="var(--accent)"/>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
          🔍 بحث عن شحنة (AWB) في كل المراجعات
        </div>
      </div>
      <form onSubmit={e => { e.preventDefault(); runSearch(); }}
        style={{ display: 'flex', gap: 8 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="رقم الشحنة (AWB) أو جزء منه..."
          style={{
            flex: 1, padding: '9px 12px', borderRadius: 9, fontSize: 13,
            fontFamily: 'var(--font-mono)',
          }}
        />
        <Btn type="submit" variant="primary" size="sm" disabled={searching || !query.trim()}>
          {searching ? <Spinner size={13}/> : 'بحث'}
        </Btn>
        {results !== null && (
          <Btn type="button" variant="ghost" size="sm" onClick={clearSearch}>مسح</Btn>
        )}
      </form>

      {results !== null && (
        <div style={{ marginTop: 12 }}>
          {results.length === 0
            ? <div style={{ padding: 18, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
                لا يوجد ما يطابق &laquo;{query}&raquo; في أي مراجعة محفوظة.
              </div>
            : <>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6, fontFamily: 'var(--font-mono)' }}>
                  {results.length} نتيجة · انقر &laquo;افتح&raquo; للذهاب إلى المراجعة
                </div>
                <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {results.map((r, i) => {
                    const tm = AUDIT_TYPE_META_DASH[r.audit?.auditType] ?? AUDIT_TYPE_META_DASH.unknown;
                    const cls = r.billingClass === 'cod' ? '💰 COD' : '🚚 شحن';
                    return (
                      <div key={`${r.auditId}-${i}`} style={{
                        display: 'grid', gridTemplateColumns: '120px 1fr auto auto', gap: 12,
                        alignItems: 'center', padding: '8px 12px',
                        background: 'var(--surface)', border: '1px solid var(--border)',
                        borderRadius: 9, fontSize: 12,
                      }}>
                        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontWeight: 700 }}>
                          {r.awb}
                        </span>
                        <div>
                          <div style={{ fontWeight: 600 }}>
                            {r.audit?.carrierName ?? '—'}{' '}
                            <span style={{
                              padding: '1px 6px', borderRadius: 999,
                              background: `${tm.color}1F`, border: `1px solid ${tm.color}55`,
                              color: tm.color, fontSize: 9, fontFamily: 'var(--font-mono)', marginRight: 4,
                            }}>{tm.icon} {tm.label}</span>
                            <span style={{
                              padding: '1px 6px', borderRadius: 999,
                              background: 'rgba(45,212,191,.10)',
                              border: '1px solid rgba(45,212,191,.35)',
                              color: 'var(--accent)', fontSize: 9, fontFamily: 'var(--font-mono)',
                            }}>{cls}</span>
                          </div>
                          <div style={{ color: 'var(--muted)', fontSize: 10, marginTop: 2 }}>
                            {r.shipDate || r.period || '—'} · {r.audit?.fileName || `(${(r.auditId || '').slice(0, 10)}...)`}
                          </div>
                        </div>
                        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap' }}>
                          {Number(r.invoiced ?? 0).toFixed(2)} <span style={{ fontSize: 9, color: 'var(--muted)' }}>ر.س</span>
                        </span>
                        <Btn size="sm" variant="ghost" disabled={loadingAudit === r.auditId}
                          onClick={() => openAudit(r.auditId)}>
                          {loadingAudit === r.auditId ? <Spinner size={11}/> : <><ExternalLink size={11}/> افتح</>}
                        </Btn>
                      </div>
                    );
                  })}
                </div>
              </>
          }
        </div>
      )}
    </Card>
  );
}

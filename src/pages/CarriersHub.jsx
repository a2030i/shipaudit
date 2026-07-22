// Carriers Hub — the home view. One card per carrier with everything
// the admin needs at a glance: balance, pending actions, setup state.
// Clicking a card drills into its ledger detail.

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  RefreshCw, Inbox, FileText, CheckCircle2, AlertTriangle,
  TrendingUp, TrendingDown, Building2, Webhook as WebhookIcon,
  Settings as SettingsIcon, Wallet, ArrowLeft, BookOpen,
} from 'lucide-react';
import { Card, Btn, Spinner, Empty, toast, PageHero, PageHeader } from '../components/UI.jsx';
import { loadCarriersHub } from '../lib/carriersHubService.js';

const fmt = (n) =>
  (n == null || Number.isNaN(n)) ? '—'
  : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtCompact = (n) => {
  if (n == null || Number.isNaN(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'م';
  if (a >= 1_000)     return (n / 1_000).toFixed(1) + 'ك';
  return n.toFixed(0);
};

const relTime = (iso) => {
  if (!iso) return 'لا نشاط بعد';
  const d = new Date(iso);
  const now = new Date();
  const days = Math.floor((now - d) / 86400000);
  if (days <= 0) return 'اليوم';
  if (days === 1) return 'أمس';
  if (days < 7)   return `قبل ${days} أيام`;
  if (days < 30)  return `قبل ${Math.floor(days / 7)} أسابيع`;
  if (days < 365) return `قبل ${Math.floor(days / 30)} شهور`;
  return `قبل ${Math.floor(days / 365)} سنوات`;
};

function HeaderTotals({ totals, loading }) {
  const owed   = totals?.totalDr - totals?.totalCr; // positive = we owe carriers
  const sign   = owed >= 0 ? '—' : '+';
  return (
    <PageHero
      variant="dark"
      icon={<Building2 size={22}/>}
      tag="LAMHA · CARRIERS OVERVIEW"
      title="شركات الشحن — كشف موحّد"
      stats={[
        { label: 'المطلوب منّا (DR)', value: loading ? '…' : `${fmtCompact(totals?.totalDr)} ر.س` },
        { label: 'المدفوع/لنا (CR)',   value: loading ? '…' : `${fmtCompact(totals?.totalCr)} ر.س` },
        {
          label: owed >= 0 ? 'نحن مدينون' : 'الشركات مدينة',
          value: loading ? '…' : `${sign} ${fmtCompact(Math.abs(owed))} ر.س`,
          big: true,
          color: owed >= 0 ? '#FCA5A5' : '#86EFAC',
        },
      ]}
    />
  );
}

// One compact line per health signal: COD still with the carrier, open
// un-audited invoices, and how stale the audit trail is. These are the
// three questions the operator asks per carrier every morning — surfacing
// them here saves a tour through /cod-settlements + /ledger + /audits.
function HealthStrip({ row, onCod, onLedger }) {
  const items = [];
  if (row.codOutstanding > 0.5) {
    items.push({
      key: 'cod', color: '#D97706', onClick: onCod,
      label: `COD معلّق ${fmtCompact(row.codOutstanding)} ر.س`,
    });
  }
  if (row.unauditedRv.count > 0) {
    items.push({
      key: 'rv', color: '#EF4444', onClick: onLedger,
      label: `${row.unauditedRv.count} فاتورة غير مدقَّقة (${fmtCompact(row.unauditedRv.amount)})`,
    });
  }
  if (row.hasContract) {
    items.push(row.lastAudit
      ? { key: 'aud', color: 'var(--muted)', label: `آخر تدقيق: ${row.lastAudit.period || relTime(row.lastAudit.approvedAt)}` }
      : { key: 'aud', color: '#EF4444',      label: 'لم تُدقَّق أي فاتورة بعد' });
  }
  if (!items.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
      {items.map(it => (
        <span
          key={it.key}
          role={it.onClick ? 'button' : undefined}
          title={it.label}
          onClick={it.onClick ? (e) => { e.stopPropagation(); it.onClick(); } : undefined}
          style={{
            display: 'inline-flex', alignItems: 'center',
            padding: '4px 10px', borderRadius: 8,
            background: it.color.startsWith('#') ? `color-mix(in srgb, ${it.color} 10%, transparent)` : 'var(--bg2)',
            color: it.color, fontSize: 11, fontWeight: 600,
            cursor: it.onClick ? 'pointer' : 'default', whiteSpace: 'nowrap',
          }}
        >
          {it.label}
        </span>
      ))}
    </div>
  );
}

function CarrierCard({ row, onClick, onSetup, onWebhook, onCod, onLedger }) {
  const [logoErr, setLogoErr] = useState(false);   // شعار مكسور → ننزل للبديل (الحرف الأول)
  const owed = row.balance; // > 0 = we owe them; < 0 = they owe us
  const balanceColor =
    Math.abs(owed) < 0.01 ? 'var(--muted)' :
    owed > 0              ? '#EF4444'      : // we owe → red
                            'var(--green)';        // they owe → green
  const balanceLabel =
    Math.abs(owed) < 0.01 ? 'صفر' :
    owed > 0              ? 'لها علينا' :
                            'لنا عليها';
  const setupColor =
    row.setupCompleteness >= 100 ? 'var(--green)' :
    row.setupCompleteness >= 50  ? 'var(--gold)' :
                                   '#EF4444';

  const actionsCount = row.pendingAudits + row.webhookPending;
  const setupGaps = [];
  if (!row.hasContract)       setupGaps.push('عقد');
  if (!row.hasFileSignature)  setupGaps.push('تعريف بريد الشركة');
  if (!row.fileKind)          setupGaps.push('نوع الملف');

  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--card)',
        border: '1px solid transparent',
        borderRadius: 'var(--r-lg)',
        padding: '22px 24px',
        cursor: 'pointer',
        transition: 'transform .18s, box-shadow .18s',
        position: 'relative',
        boxShadow: 'var(--shadow-sm)',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = 'var(--shadow-md)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'none';
        e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
      }}
    >
      {/* Header: logo + name (no top color stripe) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22 }}>
        {row.logo && !logoErr ? (
          <img src={row.logo} alt="" onError={() => setLogoErr(true)} style={{
            width: 44, height: 44, borderRadius: 12, objectFit: 'cover',
            border: '1px solid var(--border)',
          }}/>
        ) : (
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            background: `color-mix(in srgb, ${row.color || 'var(--green)'} 14%, transparent)`,
            color: row.color || 'var(--green)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontFamily: 'var(--font-sans)', fontSize: 18,
          }}>
            {(row.name || '?').slice(0, 1)}
          </div>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', letterSpacing: -0.2 }}>
            {row.name}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
            آخر نشاط · {relTime(row.lastActivityAt)}
          </div>
        </div>
      </div>

      {/* Balance — the headline */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 500, marginBottom: 8 }}>
          {balanceLabel}
        </div>
        <div style={{
          display: 'flex', alignItems: 'baseline', gap: 6,
        }}>
          <div style={{
            fontSize: 30, fontWeight: 700, color: balanceColor,
            fontFamily: 'var(--font-mono)', letterSpacing: -1, lineHeight: 1,
          }}>
            {fmt(Math.abs(owed))}
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 500 }}>ر.س</div>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 8, display: 'flex', gap: 14 }}>
          <span>فواتير <span style={{ color: 'var(--text2)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{fmtCompact(row.totalDr)}</span></span>
          <span style={{ color: 'var(--muted3)' }}>·</span>
          <span>تحصيل <span style={{ color: 'var(--text2)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{fmtCompact(row.totalCr)}</span></span>
        </div>
      </div>

      {/* Direct entry to the FULL account ledger — the balance above is just
          the headline; this one click opens every DR/CR line. The card body
          drills into the profile overview, so this needs stopPropagation. */}
      <div style={{ marginBottom: 18 }}>
        <Btn
          variant="ghost"
          size="sm"
          icon={<BookOpen size={14}/>}
          onClick={(e) => { e.stopPropagation(); onLedger?.(); }}
          title="افتح كشف الحساب الكامل لهذا الناقل (كل القيود والرصيد)"
          style={{ width: '100%', justifyContent: 'center' }}
        >
          الكشف الكامل للحساب
        </Btn>
      </div>

      {/* Health signals — COD held by carrier / unaudited invoices / audit staleness */}
      <HealthStrip row={row} onCod={onCod} onLedger={onLedger}/>

      {/* Setup completeness — horizontal progress bar */}
      <div style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 500 }}>اكتمال الإعداد</span>
          <span style={{
            fontSize: 11, color: setupColor, fontFamily: 'var(--font-mono)',
            fontWeight: 700,
          }}>{row.setupCompleteness}%</span>
        </div>
        <div style={{
          height: 6, background: 'var(--bg2)', borderRadius: 999,
          overflow: 'hidden',
        }}>
          <div style={{
            width: `${row.setupCompleteness}%`, height: '100%',
            background: setupColor, borderRadius: 999,
            transition: 'width .4s cubic-bezier(.4,0,.2,1)',
          }}/>
        </div>
      </div>

      {/* Status pills */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
      }}>
        {row.pendingAudits > 0 && (
          <ActionPill icon={<FileText size={11}/>} label={`${row.pendingAudits} مراجعة بانتظار الاعتماد`} color="var(--gold)"/>
        )}
        {row.webhookPending > 0 && (
          <ActionPill
            icon={<WebhookIcon size={11}/>}
            label={`${row.webhookPending} ملف وارد`}
            color="#3B82F6"
            onClick={(e) => { e.stopPropagation(); onWebhook?.(); }}
          />
        )}
        {actionsCount === 0 && (
          <ActionPill icon={<CheckCircle2 size={11}/>} label="لا عمل معلّق" color="var(--green)"/>
        )}
        {row.approvedAudits > 0 && (
          <span style={{ fontSize: 11, color: 'var(--muted)', marginInlineStart: 'auto' }}>
            {row.approvedAudits} مراجعة معتمدة
          </span>
        )}
      </div>

      {/* Setup gaps — clean alert ribbon */}
      {setupGaps.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          marginTop: 14,
          padding: '10px 14px',
          background: 'rgba(239,68,68,.06)',
          borderRadius: 10,
        }}>
          <AlertTriangle size={14} color="var(--red)" style={{ flexShrink: 0 }}/>
          <span style={{ fontSize: 12, color: 'var(--text)', flex: 1 }}>
            ينقصها <span style={{ fontWeight: 600 }}>{setupGaps.join(' · ')}</span>
          </span>
          <Btn
            variant="danger"
            size="sm"
            onClick={(e) => { e.stopPropagation(); onSetup?.(); }}
            style={{ flexShrink: 0 }}
          >
            ضبط
          </Btn>
        </div>
      )}
    </div>
  );
}

function ActionPill({ icon, label, color, onClick }) {
  return (
    <span
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '5px 12px',
        borderRadius: 999,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        color,
        fontSize: 11.5,
        fontFamily: 'var(--font-sans)',
        fontWeight: 600,
        whiteSpace: 'nowrap',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'background .15s',
      }}
    >
      {icon}
      {label}
    </span>
  );
}

export default function CarriersHub({ isActive = true }) {
  const navigate = useNavigate();
  const [data,    setData]    = useState({ rows: [], totals: {} });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await loadCarriersHub();
      setData(result);
    } catch (e) {
      toast(`فشل تحميل بيانات الشركات: ${e.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh]);

  return (
    <div style={{ padding: '24px 28px 80px', maxWidth: 1320, margin: '0 auto' }}>
      <PageHeader
        icon={<Building2 size={22}/>}
        title="شركات الشحن"
        subtitle={loading
          ? 'جارٍ التحميل…'
          : `${data.rows.length} ${data.rows.length === 1 ? 'شركة' : 'شركات'} · ${data.totals.pendingActions ?? 0} ${(data.totals.pendingActions ?? 0) === 1 ? 'مهمة معلّقة' : 'مهام معلّقة'}`}
        actions={
          <>
            <Btn size="md" variant="ghost" icon={<Inbox size={14}/>} onClick={() => navigate('/webhook')}>
              الوارد
            </Btn>
            <Btn size="md" variant="ghost" icon={<SettingsIcon size={14}/>} onClick={() => navigate('/carriers')}>
              إدارة
            </Btn>
            <Btn size="sm" variant="ghost" icon={<RefreshCw size={14} className={loading ? 'spin' : ''}/>} onClick={refresh} disabled={loading}>
              تحديث
            </Btn>
          </>
        }
      />
      <HeaderTotals totals={data.totals} loading={loading}/>

      {/* Carrier grid */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
          <Spinner size={28}/>
        </div>
      ) : data.rows.length === 0 ? (
        <Card>
          <Empty
            icon="🚚"
            title="ما فيه شركات شحن مسجَّلة"
            sub="أضف أول شركة من صفحة إدارة الشركات"
          />
        </Card>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: 14,
        }}>
          {data.rows.map(row => (
            <CarrierCard
              key={row.carrierId}
              row={row}
              onClick={() => navigate(`/carrier?id=${row.carrierId}`)}
              onSetup={() => navigate(`/carrier?id=${row.carrierId}`)}
              onWebhook={() => navigate(`/webhook?carrier=${row.carrierId}`)}
              onCod={() => navigate(`/cod-settlements?carrier=${row.carrierId}`)}
              onLedger={() => navigate(`/ledger?carrier=${row.carrierId}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

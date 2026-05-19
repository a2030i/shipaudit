// Carriers Hub — the home view. One card per carrier with everything
// the admin needs at a glance: balance, pending actions, setup state.
// Clicking a card drills into its ledger detail.

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  RefreshCw, Inbox, FileText, CheckCircle2, AlertTriangle,
  TrendingUp, TrendingDown, Building2, Webhook as WebhookIcon,
  Settings as SettingsIcon, Wallet, ArrowLeft,
} from 'lucide-react';
import { Card, Btn, Spinner, Empty, toast, PageHero, PageHeader } from '../components/UI.jsx';
import { loadCarriersHub } from '../lib/carriersHubService.js';

const fmt = (n) =>
  (n == null || Number.isNaN(n)) ? '—'
  : Number(n).toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
        { label: 'مدين علينا (DR)', value: loading ? '…' : `${fmtCompact(totals?.totalDr)} ر.س` },
        { label: 'دائن لنا (CR)',   value: loading ? '…' : `${fmtCompact(totals?.totalCr)} ر.س` },
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

function CarrierCard({ row, onClick, onSetup, onWebhook }) {
  const owed = row.balance; // > 0 = we owe them; < 0 = they owe us
  const balanceColor =
    Math.abs(owed) < 0.01 ? 'var(--muted)' :
    owed > 0              ? '#EF4444'      : // we owe → red
                            '#10B981';        // they owe → green
  const balanceLabel =
    Math.abs(owed) < 0.01 ? 'صفر' :
    owed > 0              ? 'لها علينا' :
                            'لنا عليها';
  const setupColor =
    row.setupCompleteness >= 100 ? '#10B981' :
    row.setupCompleteness >= 50  ? '#F59E0B' :
                                   '#EF4444';

  const actionsCount = row.pendingAudits + row.webhookPending;
  const setupGaps = [];
  if (!row.hasContract)       setupGaps.push('عقد');
  if (!row.hasFileSignature)  setupGaps.push('بصمة Webhook');
  if (!row.fileKind)          setupGaps.push('نوع الملف');

  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)',
        padding: '18px 20px',
        cursor: 'pointer',
        transition: 'all .15s',
        position: 'relative',
        overflow: 'hidden',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'var(--border2)';
        e.currentTarget.style.transform   = 'translateY(-2px)';
        e.currentTarget.style.boxShadow   = 'var(--shadow-md)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--border)';
        e.currentTarget.style.transform   = 'none';
        e.currentTarget.style.boxShadow   = 'none';
      }}
    >
      {/* Top stripe with carrier color */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 3,
        background: row.color || '#2DD4BF',
      }}/>

      {/* Header: name + setup gauge */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          {row.logo ? (
            <img src={row.logo} alt="" style={{
              width: 34, height: 34, borderRadius: 8, objectFit: 'cover',
              border: '1px solid var(--border)',
            }}/>
          ) : (
            <div style={{
              width: 34, height: 34, borderRadius: 8,
              background: (row.color || '#2DD4BF') + '22',
              color: row.color || '#2DD4BF',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 800, fontFamily: 'var(--font-mono)',
            }}>
              {(row.name || '?').slice(0, 1)}
            </div>
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {row.name}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>
              آخر نشاط: {relTime(row.lastActivityAt)}
            </div>
          </div>
        </div>
        <div title={`اكتمال الإعداد: ${row.setupCompleteness}%`} style={{
          padding: '2px 8px',
          borderRadius: 12,
          fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
          background: setupColor + '20',
          color: setupColor,
          border: `1px solid ${setupColor}40`,
          whiteSpace: 'nowrap',
        }}>
          {row.setupCompleteness}%
        </div>
      </div>

      {/* Balance — the headline */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 4 }}>
          {balanceLabel}
        </div>
        <div style={{
          fontSize: 24, fontWeight: 800, color: balanceColor,
          fontFamily: 'var(--font-mono)',
        }}>
          {fmt(Math.abs(owed))} <span style={{ fontSize: 11, opacity: .65 }}>ر.س</span>
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 3, fontFamily: 'var(--font-mono)' }}>
          فواتير {fmtCompact(row.totalDr)} − تحصيل {fmtCompact(row.totalCr)}
        </div>
      </div>

      {/* Actions row */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
        paddingBlock: 10,
        borderBlock: '1px dashed var(--border)',
      }}>
        {row.pendingAudits > 0 && (
          <ActionPill icon={<FileText size={11}/>} label={`${row.pendingAudits} مراجعة بانتظار الاعتماد`} color="#F59E0B"/>
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
          <ActionPill icon={<CheckCircle2 size={11}/>} label="لا عمل معلّق" color="var(--accent)"/>
        )}
        {row.approvedAudits > 0 && (
          <span style={{ fontSize: 10.5, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
            {row.approvedAudits} مراجعة معتمدة
          </span>
        )}
      </div>

      {/* Setup gaps row */}
      {setupGaps.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          marginTop: 10,
          padding: '6px 10px',
          background: 'rgba(239,68,68,.06)',
          border: '1px solid rgba(239,68,68,.20)',
          borderRadius: 8,
        }}>
          <AlertTriangle size={11} color="var(--red)"/>
          <span style={{ fontSize: 10.5, color: 'var(--text)', flex: 1 }}>
            ينقصها: <strong>{setupGaps.join(' / ')}</strong>
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onSetup?.(); }}
            style={{
              background: 'transparent', border: '1px solid var(--red)',
              color: 'var(--red)', padding: '2px 8px',
              fontSize: 10, fontFamily: 'var(--font-sans)', fontWeight: 600,
              borderRadius: 6, cursor: 'pointer',
            }}
          >
            ضبط
          </button>
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
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '3px 9px',
        borderRadius: 11,
        background: color + '18',
        color,
        border: `1px solid ${color}40`,
        fontSize: 10.5,
        fontFamily: 'var(--font-mono)',
        fontWeight: 600,
        whiteSpace: 'nowrap',
        cursor: onClick ? 'pointer' : 'default',
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
    <div style={{ padding: '32px 40px 80px', maxWidth: 1440 }}>
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
            <Btn size="md" variant="ghost" icon={<RefreshCw size={14} className={loading ? 'spin' : ''}/>} onClick={refresh} disabled={loading}>
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
              onWebhook={() => navigate('/webhook')}
            />
          ))}
        </div>
      )}
    </div>
  );
}

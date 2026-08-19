import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RefreshCw, Filter, Activity, Database, AlertTriangle, Clock3 } from 'lucide-react';
import { Card, Btn, Empty, Spinner, toast, PageHeader } from '../components/UI.jsx';
import { loadActivityLog } from '../lib/carrierStatementsService.js';

const ACTION_META = {
  'audit.approve':     { icon: '✓',  label: 'اعتماد مراجعة ناقل',       color: 'var(--green)' },
  payment_created:   { icon: '💰', label: 'دفعة جديدة',           color: 'var(--green)' },
  dispute_opened:    { icon: '⚠️', label: 'فتح نزاع',             color: 'var(--red)'   },
  dispute_resolved:  { icon: '✓',  label: 'حلّ نزاع',              color: 'var(--green)' },
  audit_linked:      { icon: '🔗', label: 'ربط مراجعة',            color: 'var(--accent)'},
  audit_unlinked:    { icon: '🔗✕', label: 'إلغاء ربط',             color: 'var(--muted)' },
  op_paid:           { icon: '💸', label: 'تسديد عملية',           color: 'var(--green)' },
  op_status_changed: { icon: '🔄', label: 'تغيير حالة',           color: 'var(--gold)'  },
};
const fmt = n => (n == null || Number.isNaN(n))
  ? '—'
  : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ActivityLog({ isActive = true }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sourceError, setSourceError] = useState('');
  const [actionFilter, setActionFilter] = useState(() => searchParams.get('action') || 'all');

  useEffect(() => { setActionFilter(searchParams.get('action') || 'all'); }, [searchParams]);

  const changeActionFilter = (nextFilter) => {
    const next = new URLSearchParams(searchParams);
    if (nextFilter === 'all') next.delete('action');
    else next.set('action', nextFilter);
    setSearchParams(next, { replace: true });
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await loadActivityLog({ limit: 200 });
      setRows(data);
      setSourceError('');
    } catch (e) {
      setSourceError(e.message || 'تعذّر تحميل سجل النظام');
      toast(`خطأ: ${e.message}`, 'error');
    }
    setLoading(false);
  }, []);

  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh]);

  const filtered = useMemo(() => {
    if (actionFilter === 'all') return rows;
    return rows.filter(r => r.action === actionFilter);
  }, [rows, actionFilter]);

  const counts = useMemo(() => {
    const c = { all: rows.length };
    for (const r of rows) c[r.action] = (c[r.action] ?? 0) + 1;
    return c;
  }, [rows]);
  const lastUpdatedAt = useMemo(() => rows.reduce((latest, row) => {
    const value = new Date(row.created_at || 0).getTime();
    return Number.isFinite(value) && value > latest ? value : latest;
  }, 0), [rows]);

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner size={22}/></div>
  );

  return (
    <div style={{ padding: '24px 28px 80px', maxWidth: 1100, margin: '0 auto' }}>
      <PageHeader
        icon={<Activity size={22}/>}
        title="سجل النشاط"
        subtitle="مَن فعَل ماذا ومتى — مرجع للمراجعة الداخلية ومتابعة فِرق العمل."
        actions={
          <Btn size="sm" variant="ghost" icon={<RefreshCw size={14}/>} onClick={refresh}>تحديث سجل النظام</Btn>
        }
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', margin: '-10px 0 18px', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', color: 'var(--muted)', fontSize: 11.5 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Database size={13}/> المصدر: سجل العمليات الداخلي</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Clock3 size={13}/> آخر تحديث: {lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleString('ar-SA') : 'لا توجد أحداث مسجلة'}</span>
      </div>

      {sourceError ? (
        <Empty icon={<AlertTriangle size={28}/>} title="المصدر غير متاح" sub={`${sourceError} — لم نعرض سجلًا فارغًا على أنه لا يوجد نشاط.`}/>
      ) : rows.length === 0 ? (
        <Empty
          icon="🕓"
          title="لا يوجد نشاط بعد"
          sub="كل عملية تسديد، فتح نزاع، أو ربط مراجعة سيُسجَّل هنا تلقائياً"
        />
      ) : (
        <>
          {/* Filter chips */}
          <div className="workspace-filter-bar" style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
            {[
              { k: 'all', l: `الكل (${counts.all})` },
              ...Object.entries(ACTION_META).map(([k, m]) => ({
                k, l: `${m.icon} ${m.label} (${counts[k] ?? 0})`,
              })),
            ].filter(t => t.k === 'all' || (counts[t.k] ?? 0) > 0).map(t => (
              <button key={t.k} onClick={() => changeActionFilter(t.k)}
                style={{
                  background: actionFilter === t.k ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
                  border: `1px solid ${actionFilter === t.k ? 'var(--accent)' : 'var(--border)'}`,
                  color: actionFilter === t.k ? 'var(--accent)' : 'var(--muted)',
                  borderRadius: 7, padding: '5px 13px', cursor: 'pointer',
                  fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 600,
                }}>
                {t.l}
              </button>
            ))}
          </div>

          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ maxHeight: 700, overflowY: 'auto' }}>
              {filtered.length === 0
                ? <Empty icon="🔍" title="لا توجد سجلات بهذا الفلتر"/>
                : filtered.map(r => <LogRow key={r.id} r={r}/>)
              }
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

// ── LogRow ─────────────────────────────────────────────────────────────
function LogRow({ r }) {
  const meta = ACTION_META[r.action] ?? { icon: '•', label: r.action, color: 'var(--muted)' };
  const date = new Date(r.created_at);
  const desc = describeRow(r);
  return (
    <div style={{
      padding: '12px 18px', borderBottom: '1px solid var(--border)',
      display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 12, alignItems: 'center',
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: '50%',
        background: `color-mix(in srgb, ${meta.color} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${meta.color} 25%, transparent)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 16,
      }}>
        {meta.icon}
      </div>
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: 13, color: meta.color }}>{meta.label}</span>
          {r.actor_email && (
            <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
              · {r.actor_email}
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text)', marginTop: 3 }}>{desc}</div>
      </div>
      <div style={{ textAlign: 'left' }}>
        <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          {date.toLocaleDateString('en-GB')}
        </div>
        <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          {date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
}

function describeRow(r) {
  const p = r.payload ?? {};
  if (r.action === 'audit.approve') {
    const carrier = p.carrier_name || r.carrier_id || 'شركة شحن';
    const period = p.period ? ` · ${p.period}` : '';
    const rows = p.row_count != null ? ` · ${Number(p.row_count).toLocaleString('en-US')} شحنة` : '';
    const amount = p.total_billed != null ? ` · ${fmt(p.total_billed)} ر.س` : '';
    return `${carrier}${period}${rows}${amount}`;
  }
  if (r.action === 'payment_created') {
    return `${fmt(p.amount)} ر.س · ${p.ops_count} عملية${p.payment_ref ? ` · ${p.payment_ref}` : ''}`;
  }
  if (r.action === 'dispute_opened') {
    return `${p.doc_no || '—'}${p.note ? ` · "${p.note.slice(0, 80)}${p.note.length > 80 ? '...' : ''}"` : ''}`;
  }
  if (r.action === 'dispute_resolved') {
    const kindAr = p.resolution === 'credit_received' ? 'مذكرة دائنة' : 'قبول';
    return `${p.doc_no || '—'} · ${kindAr}${p.credit_op_id ? ` (مرتبط بمذكرة)` : ''}`;
  }
  if (r.action === 'audit_linked') {
    return `${p.doc_no || '—'} ↔ ${p.audit_id || ''}`;
  }
  return r.entity_id ? `${r.entity_type}: ${r.entity_id}` : r.entity_type;
}

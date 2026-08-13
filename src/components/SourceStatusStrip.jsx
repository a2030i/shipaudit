import { AlertTriangle, CheckCircle2, Database, RefreshCw } from 'lucide-react';

const STATUS = {
  fresh: { label: 'متاح', tone: 'ok', icon: CheckCircle2 },
  stale: { label: 'قديم — راجع', tone: 'warning', icon: AlertTriangle },
  empty: { label: 'لا توجد بيانات', tone: 'muted', icon: Database },
  unavailable: { label: 'غير متاح', tone: 'danger', icon: AlertTriangle },
};

export default function SourceStatusStrip({ sources = [], loadedAt, onRefresh, refreshing = false }) {
  const unavailable = sources.filter(source => source.status === 'unavailable');
  const stale = sources.filter(source => source.status === 'stale');
  const attention = [...unavailable, ...stale];
  const checked = loadedAt ? new Date(loadedAt).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }) : '—';
  return (
    <section className={`source-status-strip ${attention.length ? 'is-partial' : 'is-complete'}`} aria-label="حالة مصادر بيانات الصفحة">
      <div className="source-status-summary">
        <Database size={18}/>
        <div>
          <strong>{unavailable.length ? `البيانات جزئية — ${unavailable.length} مصدر غير متاح` : stale.length ? `بيانات تحتاج تحديثًا — ${stale.length} مصدر قديم` : 'مصادر الصفحة متاحة'}</strong>
          <span>آخر فحص {checked} · المصدر القديم أو المتعذر لا يتحول إلى رقم صفري</span>
        </div>
        {onRefresh && <button type="button" onClick={onRefresh} disabled={refreshing} aria-label="إعادة فحص مصادر البيانات"><RefreshCw size={15}/>إعادة الفحص</button>}
      </div>
      <details className="source-status-details">
        <summary>عرض تفاصيل {sources.length} {sources.length === 1 ? 'مصدر' : 'مصادر'}</summary>
        <div className="source-status-items">
          {sources.map((source) => {
            const cfg = STATUS[source.status] || STATUS.unavailable;
            const Icon = cfg.icon;
            return <div key={source.key} className={`source-status-item is-${cfg.tone}`} title={source.error || source.message || source.label}><Icon size={14}/><span>{source.label}</span><small>{cfg.label}</small></div>;
          })}
        </div>
      </details>
      {attention.length > 0 && <details className="source-status-errors"><summary>عرض المصادر التي تحتاج مراجعة</summary>{attention.map(source => <p key={source.key}><strong>{source.label}:</strong> {source.error || source.message || 'تعذرت القراءة'}</p>)}</details>}
    </section>
  );
}

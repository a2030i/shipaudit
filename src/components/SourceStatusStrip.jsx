import { AlertTriangle, CheckCircle2, Database, RefreshCw } from 'lucide-react';

const STATUS = {
  fresh: { label: 'متاح', tone: 'ok', icon: CheckCircle2 },
  empty: { label: 'لا توجد بيانات', tone: 'muted', icon: Database },
  unavailable: { label: 'غير متاح', tone: 'danger', icon: AlertTriangle },
};

export default function SourceStatusStrip({ sources = [], loadedAt, onRefresh, refreshing = false }) {
  const unavailable = sources.filter(source => source.status === 'unavailable');
  const checked = loadedAt ? new Date(loadedAt).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }) : '—';
  return (
    <section className={`source-status-strip ${unavailable.length ? 'is-partial' : 'is-complete'}`} aria-label="حالة مصادر بيانات الصفحة">
      <div className="source-status-summary">
        <Database size={18}/>
        <div>
          <strong>{unavailable.length ? `البيانات جزئية — ${unavailable.length} مصدر غير متاح` : 'مصادر الصفحة متاحة'}</strong>
          <span>آخر فحص {checked} · تعطل مصدر لا يحوّل قيمته إلى صفر</span>
        </div>
        {onRefresh && <button type="button" onClick={onRefresh} disabled={refreshing} aria-label="إعادة فحص مصادر البيانات"><RefreshCw size={15}/>إعادة الفحص</button>}
      </div>
      <div className="source-status-items">
        {sources.map((source) => {
          const cfg = STATUS[source.status] || STATUS.unavailable;
          const Icon = cfg.icon;
          return <div key={source.key} className={`source-status-item is-${cfg.tone}`} title={source.error || source.label}><Icon size={14}/><span>{source.label}</span><small>{cfg.label}</small></div>;
        })}
      </div>
      {unavailable.length > 0 && <details className="source-status-errors"><summary>عرض المصادر المتعذرة</summary>{unavailable.map(source => <p key={source.key}><strong>{source.label}:</strong> {source.error || 'تعذرت القراءة'}</p>)}</details>}
    </section>
  );
}

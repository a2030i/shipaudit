import { AlertTriangle, CheckCircle2, Clock3, LoaderCircle, XCircle } from 'lucide-react';
import { Btn, Modal } from '../UI.jsx';
import './operational-result-set.css';

const COUNT = value => Number(value || 0).toLocaleString('en-US');

export function ActionResult({ summary, title = 'نتيجة التنفيذ', onClose, onRetry }) {
  if (!summary) return null;
  return <div className="action-result" role="status" aria-live="polite">
    <div className="action-result__title"><CheckCircle2 size={20}/><div><strong>{title}</strong><span>اكتمل التنفيذ ويمكن فحص كل نتيجة أدناه.</span></div></div>
    <div className="action-result__counts">
      <span className="is-success">نجح <b>{COUNT(summary.succeeded)}</b></span>
      <span className="is-failed">فشل <b>{COUNT(summary.failed)}</b></span>
      <span className="is-skipped">متجاوز <b>{COUNT(summary.skipped)}</b></span>
    </div>
    {summary.results?.length ? <div className="action-result__rows">{summary.results.map((row, index) => <div className={`is-${row.status}`} key={row.key ?? index}><span>{row.label || row.item?.storeName || row.item?.name || row.key || `السجل ${index + 1}`}</span><b>{row.status === 'success' ? 'نجح' : row.status === 'skipped' ? 'متجاوز' : row.reason || 'فشل'}</b></div>)}</div> : null}
    <div className="action-result__actions">{onRetry && summary.failed ? <Btn variant="ghost" onClick={onRetry}>إعادة محاولة الفاشل</Btn> : null}<Btn variant="accent" onClick={onClose}>إغلاق</Btn></div>
  </div>;
}

export default function BulkPreflightDialog({
  open = true, title, actionLabel, preflight, impact, notice, busy = false,
  progress, result, onClose, onConfirm, renderRow,
}) {
  if (!open) return null;
  const progressTotal = Number(progress?.total || 0);
  const progressCompleted = Math.min(Number(progress?.completed || 0), progressTotal);
  const showProgress = progressTotal > 0 && (busy || progressCompleted < progressTotal);
  const progressPercent = progressTotal ? Math.round((progressCompleted / progressTotal) * 100) : 0;
  return <Modal title={title || 'مراجعة الإجراء'} onClose={busy ? undefined : onClose} width={760} bodyClassName="bulk-preflight-modal">
    {result ? <ActionResult summary={result} onClose={onClose}/> : <div className="bulk-preflight">
      <div className="bulk-preflight__equation">
        <div><span>المحدد</span><b>{COUNT(preflight?.total)}</b></div>
        <div className="is-ready"><CheckCircle2 size={15}/><span>مؤهل</span><b>{COUNT(preflight?.eligible?.length)}</b></div>
        <div className="is-review"><Clock3 size={15}/><span>يحتاج مراجعة</span><b>{COUNT(preflight?.requiresReview?.length)}</b></div>
        <div className="is-blocked"><XCircle size={15}/><span>غير مؤهل</span><b>{COUNT(preflight?.ineligible?.length)}</b></div>
      </div>
      {impact ? <div className="bulk-preflight__impact">{impact}</div> : null}
      {notice ? <div className="bulk-preflight__notice"><AlertTriangle size={16}/><span>{notice}</span></div> : null}
      <div className="bulk-preflight__rows">{preflight?.reviewed?.map((row, index) => renderRow ? renderRow(row, index) : <div className={`is-${row.status}`} key={index}><span>{row.item?.storeName || row.item?.name || `السجل ${index + 1}`}</span><b>{row.status === 'eligible' ? 'مؤهل' : row.reason || 'يحتاج مراجعة'}</b></div>)}</div>
      {showProgress ? <div className="bulk-preflight__progress" role="status" aria-live="polite">
        <LoaderCircle className="spin" size={17}/>
        <span><b>{progress?.label || (busy ? 'جارٍ التنفيذ والتحقق' : 'جارٍ فحص الحالات الحية')}</b><small>{COUNT(progressCompleted)} من {COUNT(progressTotal)} · {progressPercent}%</small></span>
        <i aria-hidden="true"><em style={{ inlineSize: `${Math.max(progressPercent, busy ? 6 : 0)}%` }}/></i>
      </div> : null}
      <div className="bulk-preflight__actions"><Btn variant="ghost" onClick={onClose} disabled={busy}>إلغاء</Btn><Btn variant="danger" onClick={onConfirm} disabled={busy || !preflight?.eligible?.length}>{busy ? 'جارٍ التنفيذ والتحقق…' : actionLabel || `تنفيذ على ${COUNT(preflight?.eligible?.length)}`}</Btn></div>
    </div>}
  </Modal>;
}

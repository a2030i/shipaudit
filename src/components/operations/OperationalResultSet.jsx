import { AlertTriangle, CheckCircle2, Clock3, Database, RefreshCw, SearchX } from 'lucide-react';
import { Btn, Spinner } from '../UI.jsx';
import { isOperationalDataStale } from '../../lib/operationalWorkflows.js';
import './operational-result-set.css';

const COUNT = value => Number(value || 0).toLocaleString('en-US');

function ResultSetState({ state, error, empty, onRetry }) {
  if (state === 'loading') return <div className="ors-state" role="status"><Spinner size={22}/><div><strong>جارٍ تجهيز النتائج</strong><span>نراجع المصدر والفلاتر قبل إتاحة الإجراءات.</span></div></div>;
  if (state === 'error') return <div className="ors-state is-error" role="alert"><AlertTriangle size={22}/><div><strong>تعذر تحميل النتائج</strong><span>{error || 'المصدر غير متاح الآن. لم تُحوّل المشكلة إلى قائمة فارغة.'}</span></div>{onRetry ? <Btn size="sm" variant="ghost" icon={<RefreshCw size={14}/>} onClick={onRetry}>إعادة المحاولة</Btn> : null}</div>;
  if (empty) return <div className="ors-state is-empty"><SearchX size={22}/><div><strong>لا توجد نتائج مطابقة</strong><span>راجع الفلاتر أو حدّث المصدر إذا كنت تتوقع ظهور حالات هنا.</span></div></div>;
  return null;
}

export function ResultSetContext({
  title, description, reason, metrics = [], source, updatedAt, staleAfterMs,
  sourceState = 'healthy', sourceDetails = [], activeFilters = [], actions,
}) {
  const stale = sourceState === 'stale' || (sourceState === 'healthy' && isOperationalDataStale(updatedAt, staleAfterMs));
  const effectiveState = stale ? 'stale' : sourceState;
  const sourceTone = ['healthy', 'syncing', 'stale', 'partial', 'error', 'disconnected'].includes(effectiveState)
    ? effectiveState
    : 'healthy';
  const freshnessLabel = !updatedAt && sourceState === 'healthy'
    ? 'وقت التحديث غير متاح'
    : ({
      healthy: 'آخر تحديث', syncing: 'جارٍ التحديث', stale: 'بيانات قديمة', partial: 'تحديث جزئي',
      error: 'خطأ في المصدر', disconnected: 'المصدر غير متصل',
    }[sourceTone] || 'حالة المصدر غير معروفة');
  return <header className="ors-context">
    <div className="ors-context__main">
      <div><h2>{title}</h2>{description ? <p>{description}</p> : null}</div>
      {actions ? <div className="ors-context__actions">{actions}</div> : null}
    </div>
    {reason ? <div className="ors-context__reason"><AlertTriangle size={15}/><span><b>سبب ظهور النتائج:</b> {reason}</span></div> : null}
    {metrics.length ? <dl className="ors-context__metrics">{metrics.map(metric => <div key={metric.key || metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd>{metric.detail ? <small>{metric.detail}</small> : null}</div>)}</dl> : null}
    <div className="ors-context__meta">
      <span className={`ors-source is-${sourceTone}`}><Database size={13}/>{source || 'المصدر غير محدد'}</span>
      <span className={`ors-freshness is-${sourceTone}`}>{sourceTone === 'healthy' ? <CheckCircle2 size={13}/> : sourceTone === 'syncing' ? <RefreshCw size={13}/> : <Clock3 size={13}/>} {updatedAt ? `${freshnessLabel}: ${new Date(updatedAt).toLocaleString('ar-SA')}` : freshnessLabel}</span>
      {sourceDetails.map(detail => <span className={`ors-source-detail is-${detail.state || 'healthy'}`} key={detail.key || detail.label} title={detail.title || ''}><Database size={13}/><b>{detail.label}</b>{detail.updatedAt ? ` · ${new Date(detail.updatedAt).toLocaleString('ar-SA')}` : ' · الوقت غير متاح'}{detail.detail ? ` · ${detail.detail}` : ''}</span>)}
      {activeFilters.map(filter => <span className="ors-filter" key={filter.key || filter.label}>{filter.label}{filter.onRemove ? <button type="button" onClick={filter.onRemove} aria-label={`إزالة فلتر ${filter.label}`}>×</button> : null}</span>)}
    </div>
  </header>;
}

export function ResultSetSelection({
  visibleCount = 0, totalCount = visibleCount, selectedCount = 0,
  allVisibleSelected = false, allResultsSelected = false,
  onToggleVisible, onSelectAllResults, onClear, actions = [], disabled = false,
}) {
  return <>
    <div className="ors-selection-control">
      <label><input type="checkbox" checked={allVisibleSelected} disabled={disabled || !visibleCount} onChange={event => onToggleVisible?.(event.target.checked)}/> تحديد الصفحة الحالية ({COUNT(visibleCount)})</label>
      {!allResultsSelected && totalCount > visibleCount && selectedCount >= visibleCount ? <button type="button" onClick={() => onSelectAllResults?.(true)}>تحديد كل النتائج ({COUNT(totalCount)})</button> : null}
      <span>{COUNT(selectedCount)} محدد</span>
    </div>
    {selectedCount ? <div className="ors-bulk-bar" role="toolbar" aria-label="إجراءات النتائج المحددة">
      <strong>{allResultsSelected ? `كل النتائج محددة (${COUNT(totalCount)})` : `${COUNT(selectedCount)} سجل محدد`}</strong>
      <div>{actions.filter(action => !action.hidden).map(action => <Btn key={action.key} size="sm" variant={action.variant || 'ghost'} icon={action.icon} onClick={action.onClick} disabled={disabled || action.disabled}>{action.label}</Btn>)}</div>
      <button type="button" onClick={onClear}>إلغاء التحديد</button>
    </div> : null}
  </>;
}

export function ResultSetColumnVisibility({ columns = [], visible = new Set(), onChange }) {
  if (!columns.length) return null;
  return <details className="ors-columns">
    <summary>الأعمدة</summary>
    <div>{columns.map(column => <label key={column.key}><input type="checkbox" checked={visible.has(column.key)} onChange={event => onChange?.(column.key, event.target.checked)}/><span>{column.label}</span></label>)}</div>
  </details>;
}

export default function OperationalResultSet({
  context, state = 'available', error, onRetry, toolbar, selection,
  children, empty = false, pagination, className = '',
}) {
  const showContent = state === 'available' && !empty;
  return <section className={`operational-result-set ${className}`.trim()} dir="rtl">
    <ResultSetContext {...context}/>
    {toolbar ? <div className="ors-toolbar">{toolbar}</div> : null}
    {selection && state === 'available' ? <ResultSetSelection {...selection}/> : null}
    <ResultSetState state={state} error={error} empty={state === 'available' && empty} onRetry={onRetry}/>
    {showContent ? <div className="ors-results">{children}</div> : null}
    {showContent && pagination ? <nav className="ors-pagination" aria-label="صفحات النتائج">
      <Btn size="sm" variant="ghost" disabled={!pagination.canPrevious} onClick={pagination.onPrevious}>السابق</Btn>
      <span>صفحة {pagination.page} من {pagination.pages} · {COUNT(pagination.total)} نتيجة</span>
      <Btn size="sm" variant="ghost" disabled={!pagination.canNext} onClick={pagination.onNext}>التالي</Btn>
    </nav> : null}
  </section>;
}

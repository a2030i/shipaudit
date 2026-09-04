import { forwardRef, useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, LoaderCircle, MoreHorizontal, Search, UploadCloud, X } from 'lucide-react';
import { normalizePhoneForDisplay } from '../lib/presentationFormatters.js';

const classNames = (...values) => values.filter(Boolean).join(' ');

export function Money({ value, currency = 'ر.س', digits = 2, compact = false, className = '' }) {
  const number = Number(value);
  const formatted = Number.isFinite(number)
    ? new Intl.NumberFormat('en-US', {
        minimumFractionDigits: compact ? 0 : digits,
        maximumFractionDigits: compact ? 1 : digits,
        notation: compact ? 'compact' : 'standard',
      }).format(number)
    : '—';
  return (
    <span className={classNames('ds-money', className)} dir="ltr">
      <bdi>{formatted}</bdi>{Number.isFinite(number) ? <><span aria-hidden="true">&nbsp;</span><bdi>{currency}</bdi></> : null}
    </span>
  );
}

export function NumberValue({ value, className = '' }) {
  const number = Number(value);
  return <bdi className={classNames('ds-number', className)} dir="ltr">{Number.isFinite(number) ? number.toLocaleString('en-US') : '—'}</bdi>;
}

export function Identifier({ value, className = '' }) {
  return <bdi className={classNames('ds-identifier', className)} dir="ltr">{value || '—'}</bdi>;
}

export function PhoneNumber({ value, className = '' }) {
  const formatted = normalizePhoneForDisplay(value);
  return <bdi className={classNames('ds-identifier', 'ds-phone', className)} dir="ltr">{formatted || '—'}</bdi>;
}

export function Percent({ value, digits = 1, className = '' }) {
  const number = Number(value);
  return <bdi className={classNames('ds-number', className)} dir="ltr">{Number.isFinite(number) ? `${number.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%` : '—'}</bdi>;
}

export function DateTime({ value, withTime = true, className = '' }) {
  const date = value ? new Date(value) : null;
  const valid = date && Number.isFinite(date.getTime());
  const text = valid ? date.toLocaleString('ar-SA', withTime
    ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  return <bdi className={classNames('ds-date-time', className)}>{text}</bdi>;
}

export function StatusBadge({ tone = 'neutral', children, dot = true, className = '' }) {
  return <span className={classNames('ds-status', `is-${tone}`, className)}>{dot ? <i aria-hidden="true"/> : null}{children}</span>;
}

export function Page({ children, className = '', ...props }) {
  return <div className={classNames('ds-page', className)} dir="rtl" {...props}>{children}</div>;
}

export function AppShell({ children, className = '' }) {
  return <div className={classNames('app-layout', className)}>{children}</div>;
}

export function PageHeader({ eyebrow, title, description, subtitle, meta, actions, className = '' }) {
  const supportingText = description || subtitle;
  return (
    <header className={classNames('ds-page-heading', className)}>
      <div className="ds-page-heading__copy">
        {eyebrow ? <span>{eyebrow}</span> : null}
        <h1>{title}</h1>
        {supportingText ? <p>{supportingText}</p> : null}
      </div>
      <div className="ds-page-heading__actions">{meta ? <small>{meta}</small> : null}{actions}</div>
    </header>
  );
}

export const PageHeading = PageHeader;

export function EntityPageHeader({ eyebrow, title, avatar, identifiers = [], badges = [], status, meta, onBack, backLabel = 'رجوع', className = '' }) {
  return <header className={classNames('ds-entity-header', className)}>
    {onBack ? <button type="button" className="ds-entity-header__back" onClick={onBack}><ChevronRight size={16}/>{backLabel}</button> : null}
    <div className="ds-entity-header__identity">
      <div className="ds-entity-header__avatar" aria-hidden="true">{avatar || String(title || '?').trim().slice(0, 1)}</div>
      <div><span>{eyebrow}</span><h1>{title}</h1><div className="ds-entity-header__identifiers">{identifiers.map((item, index) => <span key={item.key || index}>{item.icon}{item.value}</span>)}</div></div>
    </div>
    <div className="ds-entity-header__status">{status}{meta ? <small>{meta}</small> : null}</div>
    {badges.length ? <div className="ds-entity-header__badges">{badges.map((badge, index) => <StatusBadge key={badge.key || index} tone={badge.tone || 'neutral'} dot={badge.dot ?? false}>{badge.label}</StatusBadge>)}</div> : null}
  </header>;
}

export function Breadcrumbs({ items = [], label = 'مسار الصفحة', className = '' }) {
  return <nav className={classNames('ds-breadcrumbs', className)} aria-label={label}><ol>{items.map((item, index) => <li key={item.key || item.label || index}>{index > 0 ? <ChevronLeft size={11} aria-hidden="true"/> : null}{item.onClick ? <button type="button" onClick={item.onClick}>{item.label}</button> : <span aria-current={index === items.length - 1 ? 'page' : undefined}>{item.label}</span>}</li>)}</ol></nav>;
}

export function Button({ variant = 'secondary', size = 'md', icon, children, className = '', ariaLabel, ...props }) {
  const normalizedVariant = ['primary', 'accent'].includes(variant) ? 'primary' : variant === 'danger' ? 'danger' : 'secondary';
  return <button type="button" className={classNames('ds-button', `is-${normalizedVariant}`, `is-${size}`, className)} aria-label={ariaLabel || props.title} {...props}>{icon}{children ? <span>{children}</span> : null}</button>;
}

export function IconButton({ label, children = <MoreHorizontal size={16}/>, className = '', ...props }) {
  return <button type="button" className={classNames('ds-icon-button', className)} aria-label={label} title={label} {...props}>{children}</button>;
}

export function OverflowMenu({ label = 'إجراءات أخرى', items = [], className = '' }) {
  const detailsRef = useRef(null);
  if (!items.length) return null;
  return <details ref={detailsRef} className={classNames('ds-overflow-menu', className)}>
    <summary aria-label={label} title={label}><MoreHorizontal size={16} aria-hidden="true"/></summary>
    <div role="menu" aria-label={label}>{items.map(item => (
      <button
        type="button"
        role="menuitem"
        className={item.variant === 'danger' ? 'is-danger' : ''}
        disabled={item.disabled}
        key={item.key || item.label}
        onClick={event => {
          event.stopPropagation();
          detailsRef.current?.removeAttribute('open');
          item.onClick?.(event);
        }}
      >{item.icon}{item.label}</button>
    ))}</div>
  </details>;
}

export function StatStrip({ items = [], className = '', ariaLabel = 'المؤشرات الرئيسية' }) {
  return <section className={classNames('ds-stat-strip', className)} aria-label={ariaLabel}>{items.map(item => (
    item.onClick
      ? <button type="button" key={item.key || item.label} onClick={item.onClick} className={classNames(item.tone && `is-${item.tone}`)}><span>{item.label}</span><strong>{item.value}</strong>{item.note ? <small>{item.note}</small> : null}</button>
      : <div key={item.key || item.label} className={classNames('is-static', item.tone && `is-${item.tone}`)}><span>{item.label}</span><strong>{item.value}</strong>{item.note ? <small>{item.note}</small> : null}</div>
  ))}</section>;
}

export function Tabs({ items = [], active, onChange, label = 'عروض مساحة العمل' }) {
  const refs = useRef([]);
  const prefix = useId();
  const moveFocus = (event, index) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowLeft' ? 1 : -1) + items.length) % items.length;
    refs.current[next]?.focus();
    onChange?.(items[next]?.id);
  };
  return <div className="ds-tabs-control">
    <label className="ds-tabs__mobile-select"><span>{label}</span><select aria-label={label} value={active} onChange={event => onChange?.(event.target.value)}>{items.map(item => <option value={item.id} key={item.id}>{item.label}{item.count != null ? ` (${item.count})` : ''}</option>)}</select></label>
    <div className="ds-tabs" role="tablist" aria-label={label}>{items.map((item, index) => (
      <button ref={node => { refs.current[index] = node; }} id={`${prefix}-tab-${item.id}`} tabIndex={active === item.id ? 0 : -1} type="button" role="tab" aria-selected={active === item.id} key={item.id} onKeyDown={event => moveFocus(event, index)} onClick={() => onChange?.(item.id)}>{item.label}{item.count != null ? <b>{item.count}</b> : null}</button>
    ))}</div>
  </div>;
}

export function Section({ title, description, meta, action, children, className = '' }) {
  return <section className={classNames('ds-section', className)}>
    <header className="ds-section__header"><div><h2>{title}</h2>{description ? <p>{description}</p> : null}</div><div>{meta}{action}</div></header>
    {children}
  </section>;
}

export function Surface({ as: Component = 'div', children, className = '', hover = false, accent, style, ...props }) {
  return <Component
    className={classNames('ds-surface', (hover || props.onClick) && 'is-interactive', className)}
    style={{ ...(accent ? { borderBlockStartColor: accent } : null), ...style }}
    {...props}
  >{children}</Component>;
}

// Dense content panel for migrated operational pages. It keeps the shared
// Surface contract while preserving the standard content inset expected by
// table filters, forms and review summaries.
export function Panel({ style, ...props }) {
  return <Surface {...props} style={{ padding: 20, ...style }}/>;
}

export function DataTable({
  columns = [], rows = [], getRowKey = (_, index) => index, getRowLabel,
  onRowClick, empty = 'لا توجد نتائج', className = '', caption,
  sort, onSort, loading = false, error = null, onRetry,
  hiddenColumnKeys, selection, getRowClassName, children,
}) {
  if (children) return <div className={classNames('ds-table-shell', className)}><table className="ds-table">{caption ? <caption className="ds-visually-hidden">{caption}</caption> : null}{children}</table></div>;
  const hidden = hiddenColumnKeys instanceof Set ? hiddenColumnKeys : new Set(hiddenColumnKeys || []);
  const visibleColumns = columns.filter(column => !hidden.has(column.key));
  const selectedKeys = selection?.selectedKeys instanceof Set ? selection.selectedKeys : new Set(selection?.selectedKeys || []);
  const selectableRows = selection ? rows.filter(row => selection.isRowSelectable?.(row) !== false) : [];
  const allSelected = selectableRows.length > 0 && selectableRows.every((row, index) => selectedKeys.has(getRowKey(row, index)));
  const updateSelection = next => selection?.onChange?.(next);
  const toggleAll = () => {
    const next = new Set(selectedKeys);
    if (allSelected) selectableRows.forEach((row, index) => next.delete(getRowKey(row, index)));
    else selectableRows.forEach((row, index) => next.add(getRowKey(row, index)));
    updateSelection(next);
  };
  const toggleRow = (row, index) => {
    const key = getRowKey(row, index);
    const next = new Set(selectedKeys);
    if (next.has(key)) next.delete(key); else next.add(key);
    updateSelection(next);
  };
  const renderedColumns = selection ? [{ key: '__selection', label: <input type="checkbox" aria-label="تحديد الصفحة" checked={allSelected} onChange={toggleAll}/>, mobileLabel: 'تحديد', className: 'ds-table__selection mobile-hide', render: (row, index) => <input type="checkbox" aria-label={selection.labelForRow?.(row) || 'تحديد الصف'} checked={selectedKeys.has(getRowKey(row, index))} disabled={selection.isRowSelectable?.(row) === false} onChange={() => toggleRow(row, index)} onClick={event => event.stopPropagation()}/> }, ...visibleColumns] : visibleColumns;
  const state = loading ? <LoadingState compact title="جارٍ تحميل البيانات…"/> : error ? <ErrorState compact title="تعذر تحميل البيانات" description={error?.message || String(error)} onRetry={onRetry}/> : !rows.length ? <EmptyState compact title={empty}/> : null;
  return <div className={classNames('ds-table-shell', className)} aria-busy={loading || undefined}><table className="ds-table">
    {caption ? <caption className="ds-visually-hidden">{caption}</caption> : null}
    <thead><tr>{renderedColumns.map(column => <th key={column.key} className={column.className || ''} aria-sort={column.sortable && sort?.key === column.key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}>{column.sortable ? <button type="button" className="ds-table__sort" aria-label={`ترتيب حسب ${column.label}`} onClick={() => onSort?.(column.key)}>{column.label}{sort?.key === column.key ? (sort.direction === 'asc' ? <ChevronUp size={12}/> : <ChevronDown size={12}/>) : <span className="ds-table__sort-idle" aria-hidden="true"><ChevronDown size={11}/></span>}</button> : column.label}</th>)}</tr></thead>
    <tbody>{state ? <tr><td className="ds-table__state" colSpan={Math.max(1, renderedColumns.length)}>{state}</td></tr> : rows.map((row, index) => <tr key={getRowKey(row, index)} onClick={onRowClick ? event => { if (!event.target.closest('button,a,input,select,textarea,summary')) onRowClick(row); } : undefined} aria-label={getRowLabel?.(row)} className={classNames(onRowClick && 'is-clickable', getRowClassName?.(row, index))} tabIndex={onRowClick ? 0 : undefined} onKeyDown={onRowClick ? event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onRowClick(row); } } : undefined}>{renderedColumns.map(column => <td key={column.key} data-label={column.mobileLabel ?? (typeof column.label === 'string' ? column.label : '')} className={column.className || ''}>{column.render ? column.render(row, index) : row[column.key]}</td>)}</tr>)}</tbody>
  </table></div>;
}

export function FilterBar({ children, className = '' }) {
  return <div className={classNames('ds-filter-bar', className)} role="search">{children}</div>;
}

export const TextInput = forwardRef(function TextInput({ className = '', ...props }, ref) {
  return <input ref={ref} className={classNames('ds-input', className)} {...props}/>;
});

export const SelectInput = forwardRef(function SelectInput({ className = '', children, ...props }, ref) {
  return <select ref={ref} className={classNames('ds-select', className)} {...props}>{children}</select>;
});

export const Select = forwardRef(function Select({ label, hint, error, required = false, className = '', children, style, ...props }, ref) {
  if (!label) return <SelectInput ref={ref} className={className} style={style} {...props}>{children}</SelectInput>;
  return <FormField label={label} hint={hint} error={error} required={required} className={className} style={style}>
    <SelectInput ref={ref} {...props}>{children}</SelectInput>
  </FormField>;
});

export function Input({ label, hint, error, style, className = '', ...props }) {
  if (!label) return <TextInput className={className} style={style} {...props}/>;
  return <FormField label={label} hint={hint} error={error} className={className} style={style}><TextInput {...props}/></FormField>;
}

export function SearchInput({ className = '', ...props }) {
  return <label className={classNames('ds-search-input', className)}><Search size={15} aria-hidden="true"/><TextInput type="search" {...props}/></label>;
}

export function DropZone({ onFile, accept = '.xlsx,.xls,.csv', title = 'اختر ملف Excel', hint, icon: Icon = UploadCloud, multi = false, className = '' }) {
  const [dragOver, setDragOver] = useState(false);
  const inputId = useId();
  const chooseFiles = filesLike => {
    const files = Array.from(filesLike || []);
    if (!files.length) return;
    onFile?.(multi ? files : files[0]);
  };
  const openPicker = () => document.getElementById(inputId)?.click();
  return <div
    className={classNames('ds-drop-zone', dragOver && 'is-dragging', className)}
    role="button"
    tabIndex={0}
    onClick={openPicker}
    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openPicker(); } }}
    onDrop={event => { event.preventDefault(); setDragOver(false); chooseFiles(event.dataTransfer?.files); }}
    onDragOver={event => { event.preventDefault(); setDragOver(true); }}
    onDragEnter={event => { event.preventDefault(); setDragOver(true); }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDragOver(false); }}
  >
    <span className="ds-drop-zone__icon"><Icon size={24} aria-hidden="true"/></span>
    <strong>{dragOver ? 'أفلت الملف هنا' : title}</strong>
    <small>{hint || <>اسحب الملف هنا، أو <span>اضغط للاختيار</span></>}</small>
    <input id={inputId} type="file" hidden accept={accept} multiple={multi} onChange={event => { chooseFiles(event.target.files); event.target.value = ''; }}/>
  </div>;
}

export function FormField({ label, hint, error, required = false, children, className = '' }) {
  return <label className={classNames('ds-form-field', error && 'is-error', className)}><span>{label}{required ? <i aria-hidden="true">*</i> : null}</span>{children}{error ? <small role="alert">{error}</small> : hint ? <small>{hint}</small> : null}</label>;
}

export function ColumnVisibilityMenu({ columns = [], hiddenKeys = new Set(), onToggle, label = 'الأعمدة' }) {
  return <details className="ds-columns-menu"><summary>{label}</summary><div>{columns.map(column => <label key={column.key}><input type="checkbox" checked={!hiddenKeys.has(column.key)} onChange={() => onToggle?.(column.key)}/>{column.label}</label>)}</div></details>;
}

export function BulkActionBar({ count, children, onClear, className = '' }) {
  if (!count) return null;
  return <div className={classNames('ds-bulk-actions', className)} role="region" aria-label="الإجراءات الجماعية"><strong><NumberValue value={count}/> محدد</strong><div>{children}</div>{onClear ? <Button size="sm" onClick={onClear}>إلغاء التحديد</Button> : null}</div>;
}

export function SourceStamp({ label, updatedAt, status = 'fresh' }) {
  const text = updatedAt ? new Date(updatedAt).toLocaleString('ar-SA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'غير متاح';
  return <span className={classNames('ds-source-stamp', `is-${status}`)}><i/>{label}<bdi>{text}</bdi></span>;
}

export function Pagination({ page, pages, onChange, total, pageSize }) {
  if (pages <= 1) return total != null ? <div className="ds-pagination"><span>عرض {Math.min(total, pageSize || total).toLocaleString('en-US')} من {total.toLocaleString('en-US')}</span></div> : null;
  return <nav className="ds-pagination" aria-label="صفحات النتائج">
    <span>صفحة {(page + 1).toLocaleString('en-US')} من {pages.toLocaleString('en-US')} · {total.toLocaleString('en-US')} سجل</span>
    <div><button type="button" onClick={() => onChange(page - 1)} disabled={page <= 0} aria-label="الصفحة السابقة"><ChevronRight size={16}/></button><button type="button" onClick={() => onChange(page + 1)} disabled={page >= pages - 1} aria-label="الصفحة التالية"><ChevronLeft size={16}/></button></div>
  </nav>;
}

export function EmptyState({ title = 'لا توجد بيانات', description, sub, icon, action, compact = false }) {
  const detail = description || sub;
  return <div className={classNames('ds-empty', compact && 'is-compact')} role="status">{icon ? <span className="ds-empty__icon" aria-hidden="true">{icon}</span> : null}<strong>{title}</strong>{detail ? <p>{detail}</p> : null}{action}</div>;
}

export function Spinner({ size = 20, label = 'جارٍ التحميل' }) {
  return <LoaderCircle className="ds-spinner" size={size} aria-label={label}/>;
}

export function LoadingState({ title = 'جارٍ التحميل…', label, description, source, compact = false }) {
  return <div className={classNames('ds-state', 'is-loading', compact && 'is-compact')} role="status" aria-live="polite"><LoaderCircle size={compact ? 18 : 24} aria-hidden="true"/><div><strong>{label || title}</strong>{description || source ? <p>{description || source}</p> : null}</div></div>;
}

export function ErrorState({ title = 'تعذر تحميل البيانات', description, onRetry, compact = false }) {
  return <div className={classNames('ds-state', 'is-error', compact && 'is-compact')} role="alert"><AlertTriangle size={compact ? 18 : 24} aria-hidden="true"/><div><strong>{title}</strong>{description ? <p>{description}</p> : null}</div>{onRetry ? <Button size="sm" onClick={onRetry}>إعادة المحاولة</Button> : null}</div>;
}

export function Alert({ tone = 'info', title, children, className = '' }) {
  return <div className={classNames('ds-alert', `is-${tone}`, className)} role={tone === 'danger' ? 'alert' : 'status'}>{title ? <strong>{title}</strong> : null}<div>{children}</div></div>;
}

function Overlay({ open = true, title, description, onClose, children, footer, kind, className = '', bodyClassName = '', width }) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    const onKeyDown = event => {
      if (event.key === 'Escape') { onClose?.(); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...(panelRef.current?.querySelectorAll('button:not(:disabled),[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])') || [])];
      if (!focusable.length) { event.preventDefault(); panelRef.current?.focus(); return; }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    window.requestAnimationFrame(() => panelRef.current?.querySelector('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')?.focus());
    return () => { document.removeEventListener('keydown', onKeyDown); previous?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return <div className={classNames('ds-overlay', `is-${kind}`)} onMouseDown={event => { if (event.target === event.currentTarget) onClose?.(); }}>
    <section ref={panelRef} tabIndex={-1} className={classNames('ds-overlay__panel', className)} style={width ? { '--ds-overlay-width': `${width}px` } : undefined} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined}>
      <header><div><h2 id={titleId}>{title}</h2>{description ? <p id={descriptionId}>{description}</p> : null}</div><IconButton label="إغلاق" onClick={onClose} disabled={!onClose}><X size={17}/></IconButton></header>
      <div className={classNames('ds-overlay__body', bodyClassName)}>{children}</div>{footer ? <footer>{footer}</footer> : null}
    </section>
  </div>;
}

export function Dialog(props) { return <Overlay {...props} kind="dialog"/>; }
export function Drawer(props) { return <Overlay {...props} kind="drawer"/>; }

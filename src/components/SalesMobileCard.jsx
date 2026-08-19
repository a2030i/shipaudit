import { ChevronLeft } from 'lucide-react';
import './sales-mobile-card.css';

export function SalesMobileList({ children, className = '' }) {
  return <div className={`sales-mobile-list ${className}`.trim()}>{children}</div>;
}

export function SalesMobileBadge({ children, color = 'var(--accent3)' }) {
  return (
    <span className="sales-mobile-badge" style={{ '--sales-badge-color': color }}>
      {children}
    </span>
  );
}

export function SalesMobileCard({
  title,
  subtitle,
  eyebrow,
  badges,
  metrics = [],
  footer,
  selection,
  selected = false,
  tone = 'var(--accent3)',
  onClick,
  actionLabel = 'فتح السجل',
}) {
  const interactive = typeof onClick === 'function';
  const openFromKeyboard = event => {
    if (!interactive || !['Enter', ' '].includes(event.key)) return;
    if (event.target.closest('button, a, input, select, textarea')) return;
    event.preventDefault();
    onClick();
  };

  return (
    <article
      className={`sales-mobile-card${selected ? ' is-selected' : ''}${interactive ? ' is-interactive' : ''}`}
      style={{ '--sales-card-tone': tone }}
      onClick={onClick}
      onKeyDown={openFromKeyboard}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? `${actionLabel}: ${title}` : undefined}
    >
      <header className="sales-mobile__header">
        <div className="sales-mobile__identity">
          {eyebrow && <div className="sales-mobile__eyebrow">{eyebrow}</div>}
          <h3>{title || 'بدون اسم'}</h3>
          {subtitle && <div className="sales-mobile__subtitle">{subtitle}</div>}
        </div>
        {selection && <div className="sales-mobile__selection" onClick={event => event.stopPropagation()}>{selection}</div>}
      </header>

      {badges && <div className="sales-mobile__badges">{badges}</div>}

      {!!metrics.length && (
        <dl className="sales-mobile__metrics">
          {metrics.map((metric, index) => (
            <div
              key={`${metric.label}-${index}`}
              className={`sales-mobile__metric${metric.wide ? ' is-wide' : ''}`}
            >
              <dt>{metric.label}</dt>
              <dd style={{ color: metric.color, direction: metric.direction }}>{metric.value ?? '—'}</dd>
            </div>
          ))}
        </dl>
      )}

      {(footer || interactive) && (
        <footer className="sales-mobile__footer">
          <div className="sales-mobile__footer-content">{footer}</div>
          {interactive && (
            <span className="sales-mobile__open" aria-hidden="true">
              {actionLabel}<ChevronLeft size={15}/>
            </span>
          )}
        </footer>
      )}
    </article>
  );
}

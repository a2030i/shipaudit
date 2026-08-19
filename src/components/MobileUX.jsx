import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Clock3, Database, Filter, RotateCcw, X } from 'lucide-react';
import useMobileLayout from '../lib/useMobileLayout.js';

const focusableSelector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ActiveFilterChips({ items = [], onClear }) {
  if (!items.length) return null;
  return (
    <div className="mobile-active-filters" aria-label="الفلاتر النشطة">
      {items.map(item => (
        <button type="button" key={item.key || item.id || item.label} onClick={item.onRemove} aria-label={`إزالة فلتر ${item.label}`}>
          <span>{item.label}</span><X size={13}/>
        </button>
      ))}
      {onClear ? <button type="button" className="mobile-active-filters__clear" onClick={onClear}>مسح الكل</button> : null}
    </div>
  );
}

export function MobileFilterSheet({ open, title = 'فلترة النتائج', count = 0, onClose, onClear, children }) {
  const titleId = useId();
  const panelRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    document.body.classList.add('mobile-overlay-open');
    const frame = requestAnimationFrame(() => panelRef.current?.querySelector(focusableSelector)?.focus());
    const onKey = event => {
      if (event.key === 'Escape') { event.preventDefault(); onClose?.(); return; }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const items = [...panelRef.current.querySelectorAll(focusableSelector)].filter(node => node.getClientRects().length);
      if (!items.length) return;
      const first = items[0]; const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('mobile-overlay-open');
      if (previous instanceof HTMLElement && document.contains(previous)) previous.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="mobile-sheet-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose?.()}>
      <section ref={panelRef} className="mobile-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header>
          <div><span>طريقة العرض</span><h2 id={titleId}>{title}{count ? ` (${count})` : ''}</h2></div>
          <button type="button" className="mobile-icon-button" onClick={onClose} aria-label="إغلاق الفلاتر"><X size={20}/></button>
        </header>
        <div className="mobile-sheet__body">{children}</div>
        <footer>
          {onClear ? <button type="button" className="mobile-sheet__clear" onClick={onClear}><RotateCcw size={16}/>مسح الكل</button> : <span/>}
          <button type="button" className="mobile-sheet__apply" onClick={onClose}>عرض النتائج</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

export function MobileFilterBar({ search, primary, activeFilters = [], onClear, title, children, desktop }) {
  const mobile = useMobileLayout();
  const [open, setOpen] = useState(false);
  if (!mobile) return desktop || <div className="workspace-filter-bar">{search}{primary}{children}</div>;
  return (
    <>
      <div className="mobile-filter-trigger-row">
        {search ? <div className="mobile-filter-search">{search}</div> : null}
        {primary ? <div className="mobile-filter-primary">{primary}</div> : null}
        <button type="button" className="mobile-filter-trigger" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>
          <Filter size={17}/><span>فلترة</span>{activeFilters.length ? <b>{activeFilters.length}</b> : null}
        </button>
      </div>
      <ActiveFilterChips items={activeFilters} onClear={onClear}/>
      <MobileFilterSheet open={open} title={title} count={activeFilters.length} onClose={() => setOpen(false)} onClear={onClear}>
        <div className="mobile-filter-fields">{children}</div>
      </MobileFilterSheet>
    </>
  );
}

export function MobileDecisionCard({ title, status, meta, amount, amountLabel, children, actions, onClick, ariaLabel }) {
  const interactive = typeof onClick === 'function';
  const Tag = interactive ? 'button' : 'article';
  return (
    <Tag type={interactive ? 'button' : undefined} className={`mobile-decision-card${interactive ? ' is-interactive' : ''}`} onClick={onClick} aria-label={ariaLabel}>
      <header><div><strong>{title}</strong>{meta ? <small>{meta}</small> : null}</div>{status ? <span className="mobile-decision-card__status">{status}</span> : null}</header>
      {amount != null ? <div className="mobile-decision-card__amount"><span>{amountLabel || 'القيمة'}</span><b>{amount}</b></div> : null}
      {children ? <div className="mobile-decision-card__details">{children}</div> : null}
      {actions ? <footer onClick={event => event.stopPropagation()}>{actions}</footer> : null}
    </Tag>
  );
}

export function MobileStatusMeta({ source, updatedAt, unavailable, status }) {
  return (
    <div className={`mobile-status-meta${unavailable ? ' is-unavailable' : ''}`} role={unavailable ? 'status' : undefined}>
      <span><Database size={13}/>{unavailable ? 'المصدر غير متاح' : source || 'المصدر غير محدد'}</span>
      {updatedAt ? <span><Clock3 size={13}/>{updatedAt}</span> : null}
      {status ? <strong>{status}</strong> : null}
    </div>
  );
}

export function MobileState({ kind = 'empty', title, message, action }) {
  return <div className={`mobile-state is-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
    {kind === 'error' || kind === 'unavailable' ? <AlertTriangle size={22}/> : null}
    <strong>{title}</strong>{message ? <p>{message}</p> : null}{action}
  </div>;
}

export function MobileStickyActionBar({ children, label = 'إجراءات التحديد' }) {
  return <div className="mobile-sticky-action-bar" role="toolbar" aria-label={label}>{children}</div>;
}

export function ProgressiveListFooter({ hasMore, shown, total, onLoadMore, sentinelRef }) {
  if (!total) return null;
  return <div className="mobile-progressive-footer" ref={hasMore ? sentinelRef : undefined}>
    <span>عرض {Math.min(shown, total).toLocaleString('en-US')} من {total.toLocaleString('en-US')}</span>
    {hasMore ? <button type="button" onClick={onLoadMore}>عرض المزيد</button> : <small>وصلت لنهاية النتائج</small>}
  </div>;
}

function enhanceTables(root) {
  if (!root || !window.matchMedia('(max-width: 768px)').matches) return;
  root.querySelectorAll('table:not(.m-cards):not(.m-compact):not(.mobile-auto-cards):not([data-mobile-layout="table"])').forEach(table => {
    const headerRows = [...table.querySelectorAll('thead tr')];
    if (headerRows.length !== 1) return;
    const headers = [...headerRows[0].children].map(cell => cell.textContent.replace(/\s+/g, ' ').trim());
    const bodyRows = [...table.querySelectorAll('tbody > tr')];
    if (!headers.length || !bodyRows.length || bodyRows.some(row => row.children.length !== headers.length)) return;
    table.classList.add('mobile-auto-cards');
    bodyRows.forEach(row => [...row.children].forEach((cell, index) => {
      if (!cell.hasAttribute('data-label')) cell.setAttribute('data-label', index === 0 ? '' : headers[index] || 'تفصيل');
    }));
  });
}

export function MobileExperienceManager({ routeKey }) {
  useEffect(() => {
    const root = document.querySelector('.page-content') || document.body;
    const apply = () => enhanceTables(root);
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(root, { subtree: true, childList: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const updateOverlayState = () => {
      const active = document.querySelector('.modal-overlay, .quick-action-backdrop, .mobile-sheet-backdrop, .sidebar.mobile-open');
      document.body.classList.toggle('mobile-overlay-open', !!active);
    };
    updateOverlayState();
    const observer = new MutationObserver(updateOverlayState);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!window.matchMedia('(max-width: 768px)').matches) return undefined;
    let slot = null;
    let saveScroll = null;
    let restoreTimers = [];
    const frame = requestAnimationFrame(() => {
      const slots = [...document.querySelectorAll('.page-slot')];
      slot = slots.find(node => {
        const style = getComputedStyle(node);
        return style.display !== 'none' && style.visibility !== 'hidden' && node.getClientRects().length > 0;
      });
      if (!slot) return;
      const saved = Number(sessionStorage.getItem(`mobile-scroll:${routeKey}`) || 0);
      let restoring = Number.isFinite(saved) && saved > 0;
      const restore = () => {
        if (!restoring || !slot) return;
        slot.scrollTop = Math.min(saved, Math.max(0, slot.scrollHeight - slot.clientHeight));
      };
      restore();
      restoreTimers = [120, 420, 900, 1600].map((delay, index, list) => window.setTimeout(() => {
        restore();
        if (index === list.length - 1) restoring = false;
      }, delay));
      saveScroll = () => {
        if (!restoring) sessionStorage.setItem(`mobile-scroll:${routeKey}`, String(slot.scrollTop || 0));
      };
      slot.addEventListener('scroll', saveScroll, { passive: true });
    });
    return () => {
      cancelAnimationFrame(frame);
      restoreTimers.forEach(timer => window.clearTimeout(timer));
      if (slot && saveScroll) {
        slot.removeEventListener('scroll', saveScroll);
      }
    };
  }, [routeKey]);
  return null;
}

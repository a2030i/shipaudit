// لوحة الأوامر / التنقل الفوري (Ctrl+K).
// صارت بوابة وصول للكيانات كذلك: صفحات، نواقل، متاجر، فواتير زوهو، و AWB.

import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, CornerDownLeft, Truck, FileText, ShoppingBag,
  ReceiptText, PackageSearch, Loader2,
  X,
} from 'lucide-react';
import { searchGlobalEntities } from '../lib/globalSearchService.js';

// Carrier-scoped actions always resolve inside the Carrier 360 file.
const CARRIER_PAGES = [
  { label: 'نظرة عامة',  to: (id) => `/carrier?id=${id}` },
  { label: 'الفواتير والمراجعة', to: (id) => `/carrier?id=${id}&view=invoices` },
  { label: 'رفع فاتورة للمراجعة', to: (id) => `/carrier?id=${id}&view=invoices&mode=upload` },
  { label: 'COD', to: (id) => `/carrier?id=${id}&view=account&panel=cod` },
  { label: 'الكشوف', to: (id) => `/carrier?id=${id}&view=account&panel=statements` },
  { label: 'الحساب والمدفوعات', to: (id) => `/carrier?id=${id}&view=account&panel=ledger` },
];

const ICONS = {
  page: FileText,
  carrier: Truck,
  merchant: ShoppingBag,
  invoice: ReceiptText,
  awb: PackageSearch,
};

// Arabic-light normalization so search tolerates alef/ya/ta drift.
const norm = (s) => String(s ?? '').toLowerCase()
  .replace(/[\u064B-\u0652]/g, '')
  .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/[ـ\s]+/g, ' ').trim();

export default function CommandPalette({ open, onClose, navItems = [], carriers = [] }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [remoteItems, setRemoteItems] = useState([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const restoreFocusRef = useRef(null);

  // Build the full item list once per nav/carriers change.
  const allItems = useMemo(() => {
    const items = [];
    for (const n of navItems) {
      if (n.path) items.push({ label: n.label, sub: '', path: n.path, group: 'صفحة', kind: 'page' });
      for (const t of (n.subTabs || [])) {
        items.push({ label: t.label, sub: n.label, path: `${n.path}?tab=${t.tabId}`, group: 'صفحة', kind: 'page' });
      }
    }
    for (const c of carriers) {
      const cname = c.label || c.name || c.id;
      for (const p of CARRIER_PAGES) {
        items.push({ label: p.label, sub: cname, path: p.to(c.id), group: 'ناقل', kind: 'carrier', kw: cname });
      }
    }
    return items;
  }, [navItems, carriers]);

  const localResults = useMemo(() => {
    const nq = norm(q);
    if (!nq) {
      return allItems.filter(i => i.kind === 'page').slice(0, 8);
    }
    const scored = [];
    for (const it of allItems) {
      const hay = norm(`${it.label} ${it.sub} ${it.kw || ''}`);
      const idx = hay.indexOf(nq);
      if (idx >= 0) scored.push({ it, score: (idx === 0 ? 0 : 1) + idx * 0.001 });
    }
    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, 40).map(s => s.it);
  }, [q, allItems]);

  useEffect(() => {
    const nq = norm(q);
    if (!open || nq.length < 2) {
      setRemoteItems([]);
      setRemoteLoading(false);
      return undefined;
    }

    let live = true;
    const timer = setTimeout(async () => {
      setRemoteLoading(true);
      try {
        const rows = await searchGlobalEntities(q);
        if (live) setRemoteItems(rows);
      } catch (e) {
        if (live) setRemoteItems([]);
        console.warn('global search failed:', e.message);
      } finally {
        if (live) setRemoteLoading(false);
      }
    }, 220);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [open, q]);

  const results = useMemo(() => {
    if (!norm(q)) return localResults;
    const seen = new Set();
    return [...remoteItems, ...localResults].filter(item => {
      const key = `${item.kind || item.group}:${item.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 40);
  }, [q, remoteItems, localResults]);

  useEffect(() => {
    if (open) {
      if (document.activeElement instanceof HTMLElement) restoreFocusRef.current = document.activeElement;
      setQ('');
      setSel(0);
      setRemoteItems([]);
      setTimeout(() => inputRef.current?.focus(), 30);
    } else if (restoreFocusRef.current?.isConnected) {
      const target = restoreFocusRef.current;
      requestAnimationFrame(() => target.focus());
    }
  }, [open]);
  useEffect(() => { setSel(0); }, [q, remoteItems]);

  if (!open) return null;

  const go = (item) => {
    if (!item) return;
    onClose();
    navigate(item.path);
  };

  const onKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel(s => Math.min(s + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel(s => Math.max(s - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(results[sel]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(15,23,42,.45)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '12vh',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(640px, calc(100vw - 24px))',
          background: 'var(--surface)', border: '1px solid var(--border2)',
          borderRadius: 16, boxShadow: 'var(--shadow-xl)', overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <Search size={18} color="var(--muted)"/>
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="ابحث عن عميل، متجر، فاتورة، AWB، صفحة أو ناقل..."
            style={{
              flex: 1, border: 'none', outline: 'none', background: 'transparent',
              color: 'var(--text)', fontSize: 15, fontFamily: 'var(--font-sans)',
            }}
          />
          <kbd style={{ fontSize: 10, color: 'var(--muted)', border: '1px solid var(--border2)', borderRadius: 5, padding: '2px 6px' }}>Esc</kbd>
          <button type="button" aria-label="إغلاق لوحة الأوامر" onClick={onClose} style={{ display: 'grid', placeItems: 'center', width: 32, height: 32, border: '1px solid var(--border)', borderRadius: 'var(--r-md)', background: 'var(--surface)', color: 'var(--text2)', cursor: 'pointer' }}><X size={15}/></button>
        </div>

        <div ref={listRef} style={{ maxHeight: 460, overflowY: 'auto', padding: 6 }}>
          {remoteLoading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', color: 'var(--muted)', fontSize: 12 }}>
              <Loader2 size={14} className="spin"/>
              يبحث في العملاء والمتاجر وزوهو والشحنات...
            </div>
          )}

          {!remoteLoading && results.length === 0 ? (
            <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              لا نتائج لـ «{q}»
            </div>
          ) : results.map((it, i) => {
            const Icon = it.icon || ICONS[it.kind] || FileText;
            const active = i === sel;
            const accentIcon = ['carrier', 'merchant', 'invoice', 'awb'].includes(it.kind);
            return (
              <button
                key={`${it.path}-${i}`}
                onMouseEnter={() => setSel(i)}
                onClick={() => go(it)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 11, width: '100%',
                  padding: '10px 12px', borderRadius: 10, border: 'none', cursor: 'pointer',
                  background: active ? 'var(--nav-active-bg)' : 'transparent',
                  color: 'var(--text)', textAlign: 'right', fontFamily: 'var(--font-sans)',
                }}
              >
                <Icon size={16} color={accentIcon ? 'var(--accent)' : 'var(--muted)'} style={{ flexShrink: 0 }}/>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {it.label}
                  </span>
                  {it.sub && (
                    <span style={{ fontSize: 11.5, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {it.sub}
                    </span>
                  )}
                </span>
                <span style={{ fontSize: 10, color: 'var(--muted)', flexShrink: 0 }}>{it.group}</span>
                {active && <CornerDownLeft size={13} color="var(--accent)" style={{ flexShrink: 0 }}/>}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 14, padding: '8px 14px', borderTop: '1px solid var(--border)', fontSize: 10.5, color: 'var(--muted)' }}>
          <span>↑↓ تنقّل</span><span>↵ فتح</span><span>Esc إغلاق</span>
        </div>
      </div>
    </div>
  );
}

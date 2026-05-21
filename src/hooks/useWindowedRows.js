// useWindowedRows — incremental render for long lists.
//
// The two problems this solves:
//   1. The DOM table stays small (only `visible` rows rendered) so
//      sort / filter / hover stays snappy even at 100K+ source rows.
//   2. The operator never has to click "load more" — an
//      IntersectionObserver sentinel near the bottom of the list
//      auto-loads the next batch when it scrolls into view.
//
// Why no react-window: this hook is ~30 lines, has zero deps, and
// works with any markup (table rows, divs, cards). react-window
// forces a `<div>` grid layout which breaks the existing `<table>`
// + sticky `<thead>` + Excel-export-from-DOM patterns the codebase
// already relies on.
//
// Usage:
//   const { visible, sentinelRef, hasMore, loadMore, reset } =
//     useWindowedRows(filtered, { batch: 200 });
//   ...
//   {visible.map(r => <Row .../>)}
//   {hasMore && <tr ref={sentinelRef}><td colSpan={N}>…</td></tr>}
//
// `reset()` is exposed for callers that want to force-collapse the
// window on a sort/filter change without re-creating the hook.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const DEFAULT_BATCH = 200;

export function useWindowedRows(rows, { batch = DEFAULT_BATCH } = {}) {
  const total = rows?.length ?? 0;
  const [count, setCount] = useState(Math.min(batch, total));
  const sentinelRef = useRef(null);

  // Any change to the source rows (filter, sort, snapshot reload)
  // collapses the window back to the first batch. Without this, a
  // user who scrolled to row 5000 then filtered to 20 results would
  // still see "count = 5200" applied against the new 20-row list
  // (harmless but wasteful — the slice() still returns all 20).
  useEffect(() => {
    setCount(Math.min(batch, rows?.length ?? 0));
  }, [rows, batch]);

  const loadMore = useCallback(() => {
    setCount(c => Math.min(c + batch, rows?.length ?? 0));
  }, [rows, batch]);

  // IntersectionObserver — fires loadMore when the sentinel scrolls
  // within 200px of the viewport. Re-attaches whenever the sentinel
  // node changes (e.g. after first render or after "hasMore" flips).
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') return;  // SSR-safe
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) loadMore();
      },
      { rootMargin: '200px' },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [loadMore, count, total]);

  const visible = useMemo(
    () => (rows && count < total ? rows.slice(0, count) : rows || []),
    [rows, count, total],
  );

  return {
    visible,
    count,
    total,
    hasMore:    count < total,
    sentinelRef,
    loadMore,
    reset:      () => setCount(Math.min(batch, total)),
  };
}

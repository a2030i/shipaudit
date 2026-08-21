import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Pause,
  Power, PowerOff, RefreshCw, ShieldCheck, XCircle,
} from 'lucide-react';
import { Btn, Modal, Spinner, toast } from './UI.jsx';
import { loadLamhaFinancialPolicyData } from '../lib/lamhaFinancialPolicyService.js';
import { lamhaFinancialDecision, policyCandidates } from '../lib/lamhaFinancialPolicy.js';
import {
  estimateLamhaOperationSeconds, isLamhaStatusResultFresh, loadCachedLamhaStoreStatuses,
  needsLamhaStatusRefresh, runLamhaStoreOperation,
} from '../lib/lamhaStoreStatusService.js';
import './lamha-financial-account-review.css';

const PAGE_SIZE = 30;
const MONEY = value => Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const COUNT = value => Number(value || 0).toLocaleString('en-US');

function durationLabel(seconds) {
  if (seconds < 60) return `نحو ${seconds} ثانية`;
  return `نحو ${Math.ceil(seconds / 60)} دقيقة`;
}

function DecisionBadge({ decision }) {
  const Icon = decision.key === 'deactivate' ? PowerOff
    : decision.key === 'activate' || decision.key === 'aligned' ? CheckCircle2
      : decision.key === 'error' ? XCircle : Clock3;
  return <span className={`lfar-decision is-${decision.key}`}><Icon size={13}/>{decision.label}</span>;
}

export default function LamhaFinancialAccountReview({ onClose }) {
  const [source, setSource] = useState({ state: 'loading', data: null, error: null });
  const [results, setResults] = useState(() => new Map());
  const [financialHoldStoreIds, setFinancialHoldStoreIds] = useState(() => new Set());
  const [cacheState, setCacheState] = useState({ state: 'loading', restored: 0, error: null });
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [view, setView] = useState('all');
  const [page, setPage] = useState(1);
  const [review, setReview] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const stopRef = useRef(false);

  const loadSource = useCallback(async () => {
    setSource({ state: 'loading', data: null, error: null });
    try {
      const data = await loadLamhaFinancialPolicyData();
      setCacheState({ state: 'loading', restored: 0, error: null });
      try {
        const cached = await loadCachedLamhaStoreStatuses(data.rows.map(row => row.storeId));
        const restored = new Map((cached.results || []).map(result => [Number(result.storeId), result]));
        setResults(restored);
        setFinancialHoldStoreIds(new Set((cached.financialHoldStoreIds || []).map(Number)));
        setCacheState({ state: 'available', restored: restored.size, error: null });
      } catch (cacheError) {
        setResults(new Map());
        setFinancialHoldStoreIds(new Set());
        setCacheState({ state: 'error', restored: 0, error: cacheError?.message || 'تعذرت استعادة آخر فحص' });
      }
      setSource({ state: 'available', data, error: null });
      return data;
    } catch (error) {
      setSource({ state: 'error', data: null, error: error?.message || 'تعذرت قراءة المصادر المالية' });
      return null;
    }
  }, []);

  useEffect(() => { loadSource(); }, [loadSource]);

  const rows = source.data?.rows || [];
  const stopCandidates = useMemo(() => policyCandidates(rows, results, 'deactivate', financialHoldStoreIds), [financialHoldStoreIds, results, rows]);
  const activateCandidates = useMemo(() => policyCandidates(rows, results, 'activate', financialHoldStoreIds), [financialHoldStoreIds, results, rows]);
  const checked = useMemo(() => [...results.values()].filter(result => isLamhaStatusResultFresh(result)).length, [results]);
  const stale = useMemo(() => [...results.values()].filter(result => result?.ok && !isLamhaStatusResultFresh(result)).length, [results]);
  const errors = useMemo(() => [...results.values()].filter(result => result && !result.ok).length, [results]);
  const filtered = useMemo(() => rows.filter(row => {
    const decision = lamhaFinancialDecision(row, results.get(row.storeId), { financialHold: financialHoldStoreIds.has(row.storeId) });
    if (view === 'overdue') return row.policyGroup === 'overdue';
    if (view === 'clear') return row.policyGroup === 'clear';
    if (view === 'deactivate') return decision.key === 'deactivate';
    if (view === 'activate') return decision.key === 'activate';
    if (view === 'review') return ['error', 'unknown', 'excluded'].includes(decision.key);
    return true;
  }), [financialHoldStoreIds, results, rows, view]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const runStatusCheck = useCallback(async policyGroup => {
    const scoped = rows.filter(row => row.eligible
      && (!policyGroup || row.policyGroup === policyGroup)
      && (policyGroup !== 'clear' || financialHoldStoreIds.has(row.storeId)));
    const targets = scoped.filter(row => needsLamhaStatusRefresh(results.get(row.storeId)));
    if (!targets.length || busy) {
      if (!busy) toast(scoped.length ? 'كل الحالات المطلوبة حديثة؛ لا حاجة لإعادة الفحص' : 'لا توجد حسابات أوقفها النظام ماليًا وتحتاج إعادة تشغيل', 'info');
      return;
    }
    setBusy(true); stopRef.current = false; setProgress({ completed: 0, total: targets.length });
    const summary = await runLamhaStoreOperation({
      storeIds: targets.map(row => row.storeId),
      mode: 'get',
      context: 'financial_policy',
      shouldStop: () => stopRef.current,
      onProgress: ({ completed, total, results: nextResults }) => {
        setProgress({ completed, total });
        setResults(current => {
          const next = new Map(current);
          nextResults.forEach(result => next.set(Number(result.storeId), result));
          return next;
        });
      },
    });
    setBusy(false);
    if (!summary.cacheSaved) toast('اكتمل الفحص، لكن تعذر حفظ بعض النتائج للاستعادة لاحقًا', 'warn');
    if (summary.stopped) toast(`توقف الفحص بعد ${summary.completed} من ${summary.requested}`, 'info');
    else if (summary.failed) toast(`اكتمل الفحص مع ${summary.failed} حساب يحتاج مراجعة`, 'warn');
    else toast(`تم فحص ${summary.succeeded} حساب من لمحة`, 'success');
  }, [busy, financialHoldStoreIds, results, rows]);

  const openReview = action => {
    const candidates = action === 'deactivate' ? stopCandidates : activateCandidates;
    setSelected(new Set(candidates.map(row => row.storeId)));
    setReview(action);
    setPage(1);
  };

  const confirmAction = async () => {
    if (!review || !selected.size || busy) return;
    setBusy(true);
    const fresh = await loadLamhaFinancialPolicyData().catch(error => {
      toast(`توقف التنفيذ: تعذرت إعادة قراءة البيانات المالية — ${error.message}`, 'error');
      return null;
    });
    if (!fresh) { setBusy(false); return; }
    const freshById = new Map(fresh.rows.map(row => [row.storeId, row]));
    const invalid = [...selected].filter(storeId => {
      const row = freshById.get(storeId);
      return !row?.eligible || (review === 'deactivate'
        ? row.policyGroup !== 'overdue'
        : row.policyGroup !== 'clear' || !financialHoldStoreIds.has(storeId));
    });
    setSource({ state: 'available', data: fresh, error: null });
    if (invalid.length) {
      setBusy(false); setReview(null); setSelected(new Set());
      toast(`تغيرت البيانات المالية لـ ${invalid.length} متجر؛ أعد الفحص والمراجعة قبل التنفيذ`, 'warn');
      return;
    }
    stopRef.current = false; setProgress({ completed: 0, total: selected.size });
    const summary = await runLamhaStoreOperation({
      storeIds: [...selected],
      mode: review,
      context: 'financial_policy',
      shouldStop: () => stopRef.current,
      onProgress: ({ completed, total, results: nextResults }) => {
        setProgress({ completed, total });
        setResults(current => {
          const next = new Map(current);
          nextResults.forEach(result => next.set(Number(result.storeId), result));
          return next;
        });
      },
    });
    setBusy(false); setReview(null); setSelected(new Set());
    if (review === 'deactivate') {
      setFinancialHoldStoreIds(current => new Set([...current, ...summary.results.filter(item => item.ok).map(item => Number(item.storeId))]));
    } else {
      setFinancialHoldStoreIds(current => {
        const next = new Set(current);
        summary.results.filter(item => item.ok).forEach(item => next.delete(Number(item.storeId)));
        return next;
      });
    }
    if (!summary.cacheSaved) toast('تم التنفيذ، لكن تعذر حفظ نتيجة التحقق الأخيرة', 'warn');
    if (summary.failed) toast(`نُفذ ${summary.succeeded} حساب و${summary.failed} يحتاج مراجعة`, 'warn');
    else toast(`${review === 'deactivate' ? 'تم إيقاف' : 'تم تشغيل'} ${summary.succeeded} حساب والتحقق منها`, 'success');
  };

  const reviewRows = review === 'deactivate' ? stopCandidates : activateCandidates;
  const reviewAmount = reviewRows.filter(row => selected.has(row.storeId))
    .reduce((sum, row) => sum + row.overdue30Amount, 0);
  const reviewPageCount = Math.max(1, Math.ceil(reviewRows.length / PAGE_SIZE));
  const reviewSafePage = Math.min(page, reviewPageCount);
  const reviewPageRows = reviewRows.slice((reviewSafePage - 1) * PAGE_SIZE, reviewSafePage * PAGE_SIZE);

  if (review) {
    const deactivating = review === 'deactivate';
    return <Modal title={deactivating ? 'مراجعة إيقاف حسابات لمحة' : 'مراجعة تشغيل حسابات لمحة'} onClose={busy ? undefined : () => setReview(null)} width={820}>
      <div className="lfar-review">
        <div className={`lfar-review__hero ${deactivating ? 'is-danger' : 'is-active'}`}>
          {deactivating ? <PowerOff size={26}/> : <Power size={26}/>}<div><strong>{COUNT(selected.size)} حساب محدد</strong><span>{deactivating ? `${MONEY(reviewAmount)} ر.س مستحقات متجاوزة 30 يومًا` : 'لا توجد مستحقات متجاوزة 30 يومًا'}</span></div>
        </div>
        <div className="lfar-review__guard"><ShieldCheck size={17}/><span>قبل التنفيذ ستُعاد قراءة البيانات المالية. ثم تفحص لمحة كل حساب قبل التغيير وتتحقق منه بعده.</span></div>
        <label className="lfar-review__select-all"><input type="checkbox" checked={reviewRows.length > 0 && reviewRows.every(row => selected.has(row.storeId))} onChange={event => setSelected(event.target.checked ? new Set(reviewRows.map(row => row.storeId)) : new Set())}/> تحديد كل المرشحين ({COUNT(reviewRows.length)})</label>
        <div className="lfar-review__rows">
          {reviewPageRows.map(row => <label key={row.storeId}><input type="checkbox" checked={selected.has(row.storeId)} onChange={() => setSelected(current => { const next = new Set(current); next.has(row.storeId) ? next.delete(row.storeId) : next.add(row.storeId); return next; })}/><span><b>{row.storeName}</b><small>#{row.storeId} · {deactivating ? `${MONEY(row.overdue30Amount)} ر.س · ${row.overdue30InvoiceCount} فاتورة · ${MONEY(row.overdue30OpeningBalanceAmount)} ر.س رصيد افتتاحي` : 'المستحق المتجاوز 30 يومًا: 0.00 ر.س'}</small></span></label>)}
        </div>
        {reviewPageCount > 1 ? <div className="lfar-pages"><Btn size="sm" variant="ghost" onClick={() => setPage(Math.max(1, reviewSafePage - 1))} disabled={reviewSafePage <= 1}>السابق</Btn><span>{reviewSafePage} / {reviewPageCount}</span><Btn size="sm" variant="ghost" onClick={() => setPage(Math.min(reviewPageCount, reviewSafePage + 1))} disabled={reviewSafePage >= reviewPageCount}>التالي</Btn></div> : null}
        {busy ? <div className="lfar-progress"><Spinner size={17}/><span>{progress.completed} / {progress.total} · يُحترم حد 30 طلبًا بالدقيقة</span></div> : null}
        <div className="lfar-review__actions"><Btn variant="ghost" onClick={() => setReview(null)} disabled={busy}>إلغاء</Btn><Btn variant={deactivating ? 'danger' : 'accent'} onClick={confirmAction} disabled={busy || !selected.size}>{busy ? 'جارٍ التنفيذ والتحقق…' : deactivating ? `تأكيد إيقاف ${COUNT(selected.size)}` : `تأكيد تشغيل ${COUNT(selected.size)}`}</Btn></div>
      </div>
    </Modal>;
  }

  return <Modal title="ضبط حسابات لمحة حسب تجاوز 30 يومًا" onClose={busy ? undefined : onClose} width={1120}>
    <div className="lfar" dir="rtl">
      {source.state === 'loading' ? <div className="lfar-loading"><Spinner size={22}/><span>جارٍ قراءة الفواتير وروابط المتاجر…</span></div> : null}
      {source.state === 'error' ? <div className="lfar-error" role="alert"><AlertTriangle size={22}/><div><strong>تعذر تجهيز المراجعة</strong><p>{source.error}</p></div><Btn variant="ghost" onClick={loadSource}>إعادة المحاولة</Btn></div> : null}
      {source.state === 'available' ? <>
        <div className="lfar-policy"><ShieldCheck size={22}/><div><strong>قاعدة القرار</strong><p>فواتير أو رصيد افتتاحي غير مدفوع متجاوز 30 يومًا + حساب نشط = إيقاف. لا مستحقات متجاوزة 30 يومًا + حساب غير نشط = تشغيل.</p><small>المسودات مستبعدة، والحالة البصرية للعرض فقط.</small></div></div>
        <div className="lfar-summary">
          <button type="button" onClick={() => { setView('deactivate'); setPage(1); }}><span>مرشحون للإيقاف</span><strong>{COUNT(stopCandidates.length)}</strong><small>{MONEY(stopCandidates.reduce((sum, row) => sum + row.overdue30Amount, 0))} ر.س</small></button>
          <button type="button" onClick={() => { setView('activate'); setPage(1); }}><span>مرشحون للتشغيل</span><strong>{COUNT(activateCandidates.length)}</strong><small>أوقفهم النظام ماليًا ثم زال التجاوز</small></button>
          <div><span>حالات حديثة من لمحة</span><strong>{COUNT(checked)}</strong><small>{stale ? `${COUNT(stale)} نتيجة قديمة تُفحص عند الحاجة` : `من ${COUNT(rows.length)} متجر مرتبط`}</small></div>
          <div className={errors ? 'is-error' : ''}><span>تحتاج مراجعة</span><strong>{COUNT(errors + rows.filter(row => !row.eligible).length)}</strong><small>فشل فحص أو فرق مطابقة</small></div>
        </div>
        <div className="lfar-scan-actions">
          <Btn variant="danger" icon={<PowerOff size={15}/>} onClick={() => runStatusCheck('overdue')} disabled={busy || !rows.some(row => row.eligible && row.policyGroup === 'overdue')}>فحص حسابات المتجاوزين</Btn>
          <Btn variant="accent" icon={<Power size={15}/>} onClick={() => runStatusCheck('clear')} disabled={busy || !rows.some(row => row.eligible && row.policyGroup === 'clear' && financialHoldStoreIds.has(row.storeId))}>فحص من زال عنهم الحجز المالي</Btn>
          <span>{source.data.unlinkedStores} متجر بلا ربط مالي صريح مستبعد من التشغيل التلقائي</span>
        </div>
        {cacheState.state === 'available' && cacheState.restored > 0 ? <div className="lfar-source">تمت استعادة آخر فحص لـ {COUNT(cacheState.restored)} متجر. النتائج الحديثة لا تُفحص مجددًا، والقديمة أو الفاشلة فقط تُحدّث عند الطلب.</div> : null}
        {cacheState.state === 'error' ? <div className="lfar-error" role="alert"><AlertTriangle size={18}/><div><strong>تعذرت استعادة آخر فحص</strong><p>{cacheState.error}</p></div></div> : null}
        {busy ? <div className="lfar-progress" role="status"><div><strong>{progress.completed} / {progress.total}</strong><span>30 طلبًا بالدقيقة كحد مشترك لكل API لمحة</span></div><div className="lfar-progress__track"><i style={{ width: `${progress.total ? progress.completed / progress.total * 100 : 0}%` }}/></div><Btn variant="ghost" icon={<Pause size={14}/>} onClick={() => { stopRef.current = true; }}>إيقاف بعد الدفعة</Btn></div> : null}
        <div className="lfar-actions">
          <Btn variant="danger" onClick={() => openReview('deactivate')} disabled={busy || !stopCandidates.length}>مراجعة إيقاف ({COUNT(stopCandidates.length)})</Btn>
          <Btn variant="accent" onClick={() => openReview('activate')} disabled={busy || !activateCandidates.length}>مراجعة تشغيل ({COUNT(activateCandidates.length)})</Btn>
          <Btn variant="ghost" icon={<RefreshCw size={14}/>} onClick={loadSource} disabled={busy}>تحديث البيانات المالية</Btn>
        </div>
        <div className="lfar-tabs" role="tablist">
          {[['all', 'الكل'], ['overdue', 'متجاوزون'], ['clear', 'غير متجاوزين'], ['deactivate', 'للإيقاف'], ['activate', 'للتشغيل'], ['review', 'تحتاج مراجعة']].map(([key, label]) => <button type="button" key={key} className={view === key ? 'is-active' : ''} onClick={() => { setView(key); setPage(1); }}>{label}</button>)}
        </div>
        <div className="lfar-list">
          <div className="lfar-list__head"><span>المتجر</span><span>مستحقات +30</span><span>حساب لمحة الفعلي</span><span>القرار</span></div>
          {pageRows.map(row => {
            const live = results.get(row.storeId);
            const decision = lamhaFinancialDecision(row, live, { financialHold: financialHoldStoreIds.has(row.storeId) });
            const liveLabel = !live ? 'لم يُفحص' : !live.ok ? 'فشل الفحص' : live.store?.canCreateShipments === true ? 'نشط' : live.store?.canCreateShipments === false ? 'غير نشط' : 'غير متاح';
            const checkedAt = live?.checkedAt || live?.checked_at;
            return <article key={row.storeId}><div data-label="المتجر"><b>{row.storeName}</b><small>#{row.storeId} · {row.customerNames.length} حساب مالي</small></div><div data-label="مستحقات +30"><b>{MONEY(row.overdue30Amount)} ر.س</b><small>{MONEY(row.overdue30InvoiceAmount)} ر.س فواتير · {MONEY(row.overdue30OpeningBalanceAmount)} ر.س رصيد افتتاحي · الأقدم {row.oldestOverdueDays || 0} يوم</small></div><div data-label="حساب لمحة الفعلي"><b>{liveLabel}</b><small>{checkedAt ? `${isLamhaStatusResultFresh(live) ? 'فحص حديث' : 'فحص قديم'} · ${new Date(checkedAt).toLocaleString('ar-SA')}` : `الحالة البصرية: ${row.visualStatus || '—'} (للعرض فقط)`}</small></div><div data-label="القرار"><DecisionBadge decision={decision}/></div></article>;
          })}
          {!pageRows.length ? <div className="lfar-empty">لا توجد حسابات في هذا العرض.</div> : null}
        </div>
        {pageCount > 1 ? <div className="lfar-pages"><Btn size="sm" variant="ghost" icon={<ChevronRight size={13}/>} onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage <= 1}>السابق</Btn><span>صفحة {safePage} من {pageCount} · {filtered.length} نتيجة</span><Btn size="sm" variant="ghost" icon={<ChevronLeft size={13}/>} onClick={() => setPage(Math.min(pageCount, safePage + 1))} disabled={safePage >= pageCount}>التالي</Btn></div> : null}
        <footer className="lfar-source">المصدر المالي: Zoho Books / customer_collectible_lines · الربط: customer_merchant_links · تمت القراءة {new Date(source.data.fetchedAt).toLocaleString('ar-SA')}</footer>
      </> : null}
    </div>
  </Modal>;
}

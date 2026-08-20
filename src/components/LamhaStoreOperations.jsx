import { useCallback, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Clock3,
  ExternalLink, Pause, Play, Power, PowerOff, RefreshCw, Search, ShieldCheck, XCircle,
} from 'lucide-react';
import { Btn, Card, Modal, PageHeader, toast } from './UI.jsx';
import {
  estimateLamhaOperationSeconds,
  runLamhaStoreOperation,
} from '../lib/lamhaStoreStatusService.js';
import './lamha-store-operations.css';

const PAGE_SIZE = 50;
const VISUAL_LABELS = {
  active: 'نشط', inactive: 'غير نشط', idle: 'خامل', stopped: 'متوقف',
};
const ERROR_LABELS = {
  lamha_store_read_failed: 'تعذر قراءة المتجر من لمحة',
  lamha_status_not_actionable: 'حالة لمحة ليست نشط أو غير نشط',
  lamha_status_write_failed: 'رفضت لمحة تغيير الحالة',
  lamha_status_verification_failed: 'تم الطلب لكن تعذر إثبات النتيجة',
  lamha_rate_limit_wait_timeout: 'انتهت مهلة انتظار حد الطلبات',
};

const fmtCount = value => Number(value || 0).toLocaleString('en-US');

function durationLabel(seconds) {
  if (seconds < 60) return `قرابة ${seconds} ثانية`;
  const minutes = Math.ceil(seconds / 60);
  return `قرابة ${minutes} ${minutes <= 10 ? 'دقائق' : 'دقيقة'}`;
}

function liveState(result) {
  if (!result) return 'unchecked';
  if (!result.ok) return 'error';
  if (result.store?.canCreateShipments === true) return 'active';
  if (result.store?.canCreateShipments === false) return 'inactive';
  return 'unknown';
}

function StateBadge({ result }) {
  const state = liveState(result);
  const labels = {
    unchecked: 'لم يُفحص', active: 'إنشاء الشحنات مسموح', inactive: 'إنشاء الشحنات متوقف',
    unknown: 'الحالة التشغيلية غير متاحة', error: 'فشل الفحص',
  };
  return <span className={`lamha-live-state is-${state}`}>
    {state === 'active' ? <CheckCircle2 size={13}/> : state === 'inactive' ? <PowerOff size={13}/> : state === 'error' ? <XCircle size={13}/> : <Clock3 size={13}/>}
    {labels[state]}
  </span>;
}

function OperationReview({ mode, rows, onClose, onConfirm }) {
  const isRead = mode === 'get';
  const actionLabel = mode === 'activate' ? 'تشغيل' : mode === 'deactivate' ? 'إيقاف' : 'فحص';
  const estimated = estimateLamhaOperationSeconds(rows.length, mode);
  return <Modal title={`مراجعة ${actionLabel} متاجر لمحة`} onClose={onClose} width={540}>
    <div className="lamha-operation-review">
      <div className={`lamha-operation-review__icon is-${mode}`}>
        {mode === 'activate' ? <Power size={26}/> : mode === 'deactivate' ? <PowerOff size={26}/> : <RefreshCw size={26}/>}
      </div>
      <strong>{actionLabel} {fmtCount(rows.length)} متجر</strong>
      <p>{isRead
        ? 'ستُقرأ حالة نشط أو غير نشط مباشرة من لمحة دون تغيير أي متجر.'
        : 'سيُفحص كل متجر أولًا، ويُتجاوز المطابق، ثم يُغيّر المختلف ويُعاد فحصه لإثبات النتيجة.'}</p>
      <div className="lamha-operation-review__facts">
        <span><b>حد التوكن</b> 30 طلبًا في الدقيقة على جميع نقاط لمحة</span>
        <span><b>الوقت المتوقع</b> {durationLabel(estimated)}</span>
        <span><b>الحماية</b> لا تعتمد العملية على خامل أو متوقف</span>
      </div>
      {!isRead ? <div className="lamha-operation-review__warning"><AlertTriangle size={16}/> سيُسجل كل تغيير في سجل النظام باسم المستخدم.</div> : null}
      <div className="lamha-operation-review__actions">
        <Btn variant="ghost" onClick={onClose}>إلغاء</Btn>
        <Btn variant={mode === 'deactivate' ? 'danger' : 'accent'} onClick={onConfirm}>تأكيد {actionLabel}</Btn>
      </div>
    </div>
  </Modal>;
}

export default function LamhaStoreOperations({ merchants, onClose }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(() => new Set());
  const [results, setResults] = useState(() => new Map());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [reviewMode, setReviewMode] = useState(null);
  const stopRef = useRef(false);

  const normalizedRows = useMemo(() => (merchants || [])
    .map(merchant => ({ ...merchant, numericId: Number(merchant.store_id) }))
    .filter(merchant => Number.isSafeInteger(merchant.numericId) && merchant.numericId > 0), [merchants]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return normalizedRows.filter(merchant => {
      if (query && !String(merchant.store_name || '').toLowerCase().includes(query)
        && !String(merchant.store_id || '').includes(query)
        && !String(merchant.phone || '').includes(query)) return false;
      if (filter === 'all') return true;
      return liveState(results.get(merchant.numericId)) === filter;
    });
  }, [filter, normalizedRows, results, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const selectedRows = useMemo(() => normalizedRows.filter(row => selected.has(row.numericId)), [normalizedRows, selected]);
  const checked = [...results.values()].filter(result => result?.ok).length;
  const active = [...results.values()].filter(result => result?.ok && result.store?.canCreateShipments === true).length;
  const inactive = [...results.values()].filter(result => result?.ok && result.store?.canCreateShipments === false).length;
  const failed = [...results.values()].filter(result => result && !result.ok).length;

  const toggleRow = useCallback((id) => setSelected(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  }), []);

  const selectPage = () => setSelected(current => {
    const next = new Set(current);
    const allSelected = pageRows.every(row => next.has(row.numericId));
    pageRows.forEach(row => allSelected ? next.delete(row.numericId) : next.add(row.numericId));
    return next;
  });

  const selectAllResults = () => setSelected(current => {
    const next = new Set(current);
    const allSelected = filtered.every(row => next.has(row.numericId));
    filtered.forEach(row => allSelected ? next.delete(row.numericId) : next.add(row.numericId));
    return next;
  });

  const run = useCallback(async (mode, rows) => {
    if (!rows.length || busy) return;
    setReviewMode(null);
    setBusy(true);
    stopRef.current = false;
    setProgress({ completed: 0, total: rows.length });
    const summary = await runLamhaStoreOperation({
      storeIds: rows.map(row => row.numericId),
      mode,
      shouldStop: () => stopRef.current,
      onProgress: ({ completed, total, results: nextResults }) => {
        setProgress({ completed, total });
        setResults(current => {
          const next = new Map(current);
          nextResults.forEach(result => next.set(Number(result.storeId), { ...result, checkedAt: new Date().toISOString() }));
          return next;
        });
      },
    });
    setBusy(false);
    if (summary.stopped) toast(`أُوقف التنفيذ بعد ${summary.completed} من ${summary.requested}`, 'info');
    else if (summary.failed) toast(`اكتمل: ${summary.succeeded} ناجح · ${summary.failed} يحتاج مراجعة`, 'warn');
    else toast(mode === 'get' ? `تم فحص ${summary.succeeded} متجر` : `اكتمل التنفيذ على ${summary.succeeded} متجر`, 'success');
  }, [busy]);

  const openStore = merchant => {
    const params = new URLSearchParams({
      customer: String(merchant.store_id),
      open: '1',
      source: 'lamha-status',
      returnTo: `${location.pathname}${location.search}`,
    });
    navigate(`/customer-360?${params.toString()}`);
  };

  const reviewRows = reviewMode === 'get-all' ? filtered : selectedRows;
  const effectiveReviewMode = reviewMode === 'get-all' ? 'get' : reviewMode;

  return <div className="lamha-operations-page">
    <PageHeader
      icon={<ShieldCheck size={22}/>}
      title="حالة متاجر لمحة الحية"
      subtitle="تشغيل وإيقاف إنشاء الشحنات من حالة لمحة: نشط أو غير نشط"
      meta="خامل ومتوقف حالات متابعة فقط ولا تنفذ أي إجراء"
      actions={<Btn variant="ghost" onClick={onClose} disabled={busy}>العودة إلى دليل المتاجر</Btn>}
    />

    <div className="lamha-operations-summary">
      <Card><span>المتاجر المتاحة</span><strong>{fmtCount(normalizedRows.length)}</strong><small>من أحدث دليل متاجر</small></Card>
      <Card><span>فُحصت حيًا</span><strong>{fmtCount(checked)}</strong><small>المصدر: لمحة مباشرة</small></Card>
      <Card className="is-active"><span>يسمح بإنشاء الشحنات</span><strong>{fmtCount(active)}</strong><small>حالة لمحة: نشط</small></Card>
      <Card className="is-inactive"><span>إنشاء الشحنات متوقف</span><strong>{fmtCount(inactive)}</strong><small>حالة لمحة: غير نشط</small></Card>
      <Card className={failed ? 'is-error' : ''}><span>تحتاج مراجعة</span><strong>{fmtCount(failed)}</strong><small>تعذر الفحص أو الإثبات</small></Card>
    </div>

    <Card className="lamha-operations-toolbar">
      <div className="lamha-operations-search"><Search size={17}/><input value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="ابحث باسم المتجر أو ID أو الهاتف" aria-label="بحث في متاجر لمحة"/></div>
      <select value={filter} onChange={event => { setFilter(event.target.value); setPage(1); }} aria-label="تصفية حسب حالة لمحة الحية">
        <option value="all">كل الحالات</option>
        <option value="unchecked">لم تُفحص</option>
        <option value="active">يسمح بالشحن</option>
        <option value="inactive">موقوف عن الشحن</option>
        <option value="unknown">حالة غير متاحة</option>
        <option value="error">فشل الفحص</option>
      </select>
      <Btn variant="ghost" icon={<RefreshCw size={15}/>} onClick={() => setReviewMode('get-all')} disabled={busy || !filtered.length}>فحص كل النتائج</Btn>
    </Card>

    {busy ? <div className="lamha-operations-progress" role="status" aria-live="polite">
      <div><strong>{fmtCount(progress.completed)} / {fmtCount(progress.total)}</strong><span>يتم احترام 30 طلبًا/دقيقة تلقائيًا</span></div>
      <div className="lamha-operations-progress__track"><span style={{ width: `${progress.total ? (progress.completed / progress.total) * 100 : 0}%` }}/></div>
      <Btn variant="ghost" icon={<Pause size={15}/>} onClick={() => { stopRef.current = true; }}>إيقاف بعد الدفعة الحالية</Btn>
    </div> : null}

    <div className="lamha-selection-bar">
      <label><input type="checkbox" checked={pageRows.length > 0 && pageRows.every(row => selected.has(row.numericId))} onChange={selectPage}/> تحديد هذه الصفحة</label>
      <button type="button" onClick={selectAllResults}>{filtered.every(row => selected.has(row.numericId)) && filtered.length ? 'إلغاء تحديد النتائج' : `تحديد كل النتائج (${fmtCount(filtered.length)})`}</button>
      <span>{fmtCount(selected.size)} متجر محدد</span>
      <div>
        <Btn size="sm" variant="ghost" icon={<RefreshCw size={14}/>} onClick={() => setReviewMode('get')} disabled={!selected.size || busy}>فحص</Btn>
        <Btn size="sm" variant="accent" icon={<Power size={14}/>} onClick={() => setReviewMode('activate')} disabled={!selected.size || busy}>تشغيل</Btn>
        <Btn size="sm" variant="danger" icon={<PowerOff size={14}/>} onClick={() => setReviewMode('deactivate')} disabled={!selected.size || busy}>إيقاف</Btn>
      </div>
    </div>

    <Card className="lamha-operations-list">
      <div className="lamha-operations-list__head">
        <span>المتجر</span><span>الحالة التشغيلية الحية</span><span>الحالة البصرية</span><span>آخر فحص</span><span>الإجراء</span>
      </div>
      {pageRows.map(merchant => {
        const result = results.get(merchant.numericId);
        const visualLabel = result?.store?.visualStatusLabel || merchant.status || '—';
        return <article key={merchant.store_id} className={`lamha-store-row ${selected.has(merchant.numericId) ? 'is-selected' : ''}`}>
          <label className="lamha-store-row__identity">
            <input type="checkbox" checked={selected.has(merchant.numericId)} onChange={() => toggleRow(merchant.numericId)}/>
            <span><strong>{merchant.store_name}</strong><small>#{merchant.store_id} · {merchant.phone || 'بلا هاتف'}</small></span>
          </label>
          <div data-label="الحالة التشغيلية"><StateBadge result={result}/>{result && !result.ok ? <small className="lamha-store-row__error">{ERROR_LABELS[result.error] || result.error}</small> : null}</div>
          <div data-label="الحالة البصرية"><span className="lamha-visual-state">{VISUAL_LABELS[visualLabel] || visualLabel}</span><small>للعرض فقط</small></div>
          <div data-label="آخر فحص"><span>{result?.checkedAt ? new Date(result.checkedAt).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }) : '—'}</span><small>{result?.checkedAt ? 'لمحة مباشر' : 'لم يُفحص'}</small></div>
          <div className="lamha-store-row__actions">
            <button type="button" onClick={() => run('get', [merchant])} disabled={busy} aria-label={`فحص ${merchant.store_name}`}><RefreshCw size={15}/></button>
            <button type="button" onClick={() => openStore(merchant)} aria-label={`فتح ملف ${merchant.store_name}`}><ExternalLink size={15}/></button>
          </div>
        </article>;
      })}
      {!pageRows.length ? <div className="lamha-operations-empty">لا توجد متاجر تطابق البحث والفلاتر.</div> : null}
    </Card>

    <div className="lamha-pagination">
      <Btn size="sm" variant="ghost" icon={<ChevronRight size={14}/>} onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage <= 1}>السابق</Btn>
      <span>صفحة {fmtCount(safePage)} من {fmtCount(pageCount)} · {fmtCount(filtered.length)} نتيجة</span>
      <Btn size="sm" variant="ghost" icon={<ChevronLeft size={14}/>} onClick={() => setPage(Math.min(pageCount, safePage + 1))} disabled={safePage >= pageCount}>التالي</Btn>
    </div>

    {reviewMode ? <OperationReview mode={effectiveReviewMode} rows={reviewRows} onClose={() => setReviewMode(null)} onConfirm={() => run(effectiveReviewMode, reviewRows)}/> : null}
  </div>;
}

import { useState, useMemo, useCallback, useEffect } from 'react';
import { Upload, Download, Trash2, Search, Wallet, Calendar, AlertCircle, Link2, CheckCircle2, Save, Database } from 'lucide-react';
import { Card, Btn, Modal, Spinner, Empty, toast } from '../components/UI.jsx';
import { parseExcelFile, generateCleanExcel, extractCarrierPayments, annotateRejected } from '../engine/bankStatementProcessor.js';
import { suggestPaymentMatches, markOperationsPaid } from '../lib/carrierStatementsService.js';
import { saveBankTransactions, loadBankTransactions, deleteBankTransaction, loadPreviousClosing, saveStatementSummary, loadStatementSummaries, setBankNote } from '../lib/bankTransactionsService.js';
import { loadCarriers } from '../lib/coreService.js';
import { useAuth } from '../lib/auth.jsx';

// ── State machine: idle → processing → done | error ──
const fmtMoney = n =>
  (n == null || Number.isNaN(n))
    ? '—'
    : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// مفتاح ترتيب تسلسل العمليات: الوقت الكامل (datetime/txn_at) وإلا التاريخ، ثم المرجع
// تصاعدياً (مبطَّن) عند تساوي الوقت — فالأصغر مرجعاً = الأقدم. يعمل لحقول المعاينة
// (date/datetime) والمحفوظ (txn_date/txn_at). 2026-07-27.
const seqKey = (t) =>
  `${t.datetime || t.txn_at || t.date || t.txn_date || ''}|${String(t.reference || '').padStart(24, '0')}`;

// Carrier aliases used for description matching (extends what's in the carrier name field)
const CARRIER_ALIASES = {
  aramex: ['أرامكس', 'ارامكس', 'aramex', 'ARAMEX', 'aramex saudi'],
  smsa:   ['سمسا', 'smsa', 'SMSA'],
};

export default function BankStatement() {
  const { user, can } = useAuth();
  const [state, setState] = useState('idle');           // idle | processing | done | error
  const [errorMsg, setErrorMsg] = useState('');
  const [result, setResult] = useState(null);            // { transactions, summary, hiddenFees, fileName }
  const [drag, setDrag]     = useState(false);
  const [search, setSearch] = useState('');
  const [carriers, setCarriers] = useState([]);
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [reconciledTxIds, setReconciledTxIds] = useState(new Set()); // tx index → matched

  // View: the current (in-memory) upload, or the accumulated saved ledger.
  const [view, setView]               = useState('current'); // current | saved
  const [saving, setSaving]           = useState(false);
  const [saved, setSaved]             = useState(null);      // null = not loaded yet
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedSearch, setSavedSearch]   = useState('');
  const [savedFrom, setSavedFrom]       = useState('');       // فلتر الفترة: من
  const [savedTo, setSavedTo]           = useState('');       // فلتر الفترة: إلى
  const [savedType, setSavedType]       = useState('all');    // all | debit | credit
  const [savedBank, setSavedBank]       = useState('all');    // all | اسم البنك
  const [stmtSummaries, setStmtSummaries] = useState([]);      // ملخّصات الكشوف (ختامي/افتتاحي لكل فترة)
  const [confirmDel, setConfirmDel]     = useState(null);     // العملية المطلوب حذفها (تأكيد)
  const [noteFor, setNoteFor]           = useState(null);     // العملية المطلوب إضافة ملاحظة لها
  const [noteText, setNoteText]         = useState('');
  const [noteSaving, setNoteSaving]     = useState(false);
  const [deleting, setDeleting]         = useState(false);

  const loadSaved = useCallback(async () => {
    setSavedLoading(true);
    try {
      const rows = await loadBankTransactions();
      annotateRejected(rows);   // علّم أزواج التحويلات المرفوضة (مدين + رفض بنفس المرجع)
      setSaved(rows);
      loadStatementSummaries().then(setStmtSummaries).catch(() => {});
    }
    catch (e) { toast(`فشل تحميل الدفتر البنكي: ${e.message}`, 'error'); }
    setSavedLoading(false);
  }, []);
  useEffect(() => { if (view === 'saved' && saved == null) loadSaved(); }, [view, saved, loadSaved]);

  // Persist the parsed statement so uploads accumulate across periods.
  const handleSave = async () => {
    if (!can('bank.upload_statement')) {
      toast('لا تملك صلاحية حفظ كشف بنكي', 'error');
      return;
    }
    if (!result) return;
    setSaving(true);
    try {
      const bank = result.bank || 'بنك الإنماء';
      const r = await saveBankTransactions({
        transactions: result.transactions, summary: result.summary,
        fileName: result.fileName, userId: user?.id, bank,
      });
      // خزّن ملخّص الكشف (افتتاحي/ختامي/فترة) لفحص استمرارية الرصيد لاحقاً
      try {
        await saveStatementSummary({
          periodFrom: result.summary?.periodFrom, periodTo: result.summary?.periodTo,
          opening: openingBalance, closing: result.summary?.closingBalance,
          totalDebit: totals.debit, totalCredit: totals.credit,
          fileName: result.fileName, userId: user?.id, bank,
        });
      } catch { /* غير قاتل */ }
      toast(`حُفظ ${r.saved} عملية من ${bank} · ${r.added} جديدة · ${r.merged} مدموجة`, 'success');
      setSaved(null);   // invalidate so the saved view reloads fresh
      setView('saved');
    } catch (e) {
      toast(`فشل الحفظ: ${e.message}`, 'error');
    }
    setSaving(false);
  };

  const savedFiltered = useMemo(() => {
    let list = saved || [];
    const q = savedSearch.trim().toLowerCase();
    if (q) list = list.filter(t =>
      String(t.reference || '').toLowerCase().includes(q)
      || String(t.description || '').toLowerCase().includes(q));
    if (savedFrom) list = list.filter(t => t.txn_date && String(t.txn_date).slice(0, 10) >= savedFrom);
    if (savedTo)   list = list.filter(t => t.txn_date && String(t.txn_date).slice(0, 10) <= savedTo);
    if (savedType === 'debit')  list = list.filter(t => Number(t.debit) > 0);
    if (savedType === 'credit') list = list.filter(t => Number(t.credit) > 0);
    if (savedBank !== 'all')    list = list.filter(t => (t.bank || 'بنك الإنماء') === savedBank);
    // ترتيب تسلسلي (الوقت ثم المرجع) — الأحدث أولاً، فالتسلسل داخل اليوم صحيح.
    return [...list].sort((a, b) => seqKey(b).localeCompare(seqKey(a)));
  }, [saved, savedSearch, savedFrom, savedTo, savedType, savedBank]);

  const filtersActive = !!(savedSearch.trim() || savedFrom || savedTo || savedType !== 'all' || savedBank !== 'all');

  // البنوك + رصيد كل بنك (ختامي آخر كشف) — لعرض التمييز بين البنوك.
  const bankSummary = useMemo(() => {
    const byBank = new Map();
    for (const t of (saved || [])) {
      const b = t.bank || 'بنك الإنماء';
      const cur = byBank.get(b) || { bank: b, count: 0, debit: 0, credit: 0 };
      cur.count++; cur.debit += Number(t.debit) || 0; cur.credit += Number(t.credit) || 0;
      byBank.set(b, cur);
    }
    // ختامي آخر كشف لكل بنك من ملخّصات الكشوف
    for (const s of stmtSummaries || []) {
      const b = s.bank || 'بنك الإنماء';
      const cur = byBank.get(b);
      if (cur && cur.closing == null) { cur.closing = Number(s.closing_balance) || 0; cur.asOf = s.period_to; }
    }
    return [...byBank.values()].sort((a, b) => b.count - a.count);
  }, [saved, stmtSummaries]);

  const savedRejectedInfo = useMemo(() => {
    const returns = (savedFiltered || []).filter(t => t.rejected && (Number(t.credit) || 0) > 0);
    return { count: returns.length, amount: +returns.reduce((s, t) => s + (Number(t.credit) || 0), 0).toFixed(2) };
  }, [savedFiltered]);

  // شرائح الفترات الجاهزة — مشتقّة من فترات الكشوف المرفوعة فعلاً.
  const savedPeriods = useMemo(() => {
    const seen = new Map();
    for (const t of saved || []) {
      if (t.period_from && t.period_to) {
        const k = `${t.period_from}→${t.period_to}`;
        if (!seen.has(k)) seen.set(k, { from: String(t.period_from).slice(0, 10), to: String(t.period_to).slice(0, 10) });
      }
    }
    return [...seen.values()].sort((a, b) => b.to.localeCompare(a.to));
  }, [saved]);

  // التصدير يتبع المعروض (بعد الفلاتر) — يعيد استخدام صيغة الكشف الصافي.
  const handleExportSaved = () => {
    if (!can('bank.export')) {
      toast('لا تملك صلاحية تصدير حركة البنك', 'error');
      return;
    }
    try {
      // نمرّر rejected ليحذفها generateCleanExcel (نفس سلوك الكشف الصافي).
      const rows = savedFiltered.map(t => ({
        date: String(t.txn_date || '').slice(0, 10), description: t.description || '',
        credit: Number(t.credit) || 0, debit: Number(t.debit) || 0,
        fees: Number(t.fees) || 0, tax: Number(t.tax) || 0, reference: t.reference,
        rejected: t.rejected,
      }));
      const kept = rows.filter(r => !r.rejected).length;
      const bytes = generateCleanExcel(rows, {});
      const blob  = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url   = URL.createObjectURL(blob);
      const a     = document.createElement('a');
      const range = (savedFrom || savedTo) ? `_${savedFrom || '…'}_${savedTo || '…'}` : '';
      a.href      = url;
      a.download  = `الدفتر_البنكي${range}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      const dropped = rows.length - kept;
      toast(`تم تصدير ${kept} عملية ✓${dropped ? ` · حُذف ${dropped} صف مرفوض/مُرجَع` : ''}`, 'success');
    } catch (e) { toast(`خطأ في التصدير: ${e.message}`, 'error'); }
  };

  const savedTotals = useMemo(() => {
    const list = savedFiltered;
    return {
      count:  list.length,
      // المدين الإجمالي = الصافي المخزَّن + الرسوم+الضريبة (= المدين الفعلي من
      // البنك) — يطابق حساب المعروض قبل الحفظ (كان يعرض الصافي فقط).
      debit:  list.reduce((s, t) => s + (Number(t.debit) || 0) + (Number(t.fees) || 0) + (Number(t.tax) || 0), 0),
      credit: list.reduce((s, t) => s + (Number(t.credit) || 0), 0),
      fees:   list.reduce((s, t) => s + (Number(t.fees) || 0) + (Number(t.tax) || 0), 0),
    };
  }, [savedFiltered]);

  // الرصيد الختامي للفترة المختارة — من ملخّصات الكشوف المرفوعة (تطابق دقيق
  // لشريحة جاهزة، أو أحدث كشف ينتهي ضمن المدى المخصّص).
  const periodClosing = useMemo(() => {
    if (!savedTo || !stmtSummaries.length) return null;
    const d = (x) => String(x || '').slice(0, 10);
    const exact = stmtSummaries.find(s => d(s.period_from) === savedFrom && d(s.period_to) === savedTo);
    if (exact) return exact;
    const inRange = stmtSummaries
      .filter(s => d(s.period_to) <= savedTo && (!savedFrom || d(s.period_to) >= savedFrom))
      .sort((a, b) => d(b.period_to).localeCompare(d(a.period_to)));
    return inRange[0] || null;
  }, [stmtSummaries, savedFrom, savedTo]);

  // التحقّق من ختامي البنك: نحسبه بأنفسنا (افتتاحي + مودَع − مسحوب شامل الرسوم)
  // على كامل فترة الكشف — تطابقه مع رقم البنك = دليل التقاط كل عملية بلا نقص/تكرار.
  // نستخدم فترة الكشف نفسها (لا فلتر النوع/البحث) كي لا يكسر التطابق فلترٌ جزئي.
  const periodRecon = useMemo(() => {
    if (!periodClosing || periodClosing.opening_balance == null || periodClosing.closing_balance == null) return null;
    const from = String(periodClosing.period_from).slice(0, 10), to = String(periodClosing.period_to).slice(0, 10);
    const inP = (saved || []).filter(t => { const d = String(t.txn_date || '').slice(0, 10); return d >= from && d <= to; });
    const credit = inP.reduce((s, t) => s + (Number(t.credit) || 0), 0);
    const debitGross = inP.reduce((s, t) => s + (Number(t.debit) || 0) + (Number(t.fees) || 0) + (Number(t.tax) || 0), 0);
    const computed = +(Number(periodClosing.opening_balance) + credit - debitGross).toFixed(2);
    const gap = +(computed - Number(periodClosing.closing_balance)).toFixed(2);
    return { computed, gap, ok: Math.abs(gap) <= 0.5 };
  }, [periodClosing, saved]);

  const handleDeleteSaved = async (id) => {
    if (!can('bank.delete_transaction')) {
      toast('لا تملك صلاحية حذف العمليات البنكية', 'error');
      return;
    }
    try {
      await deleteBankTransaction(id);
      setSaved(prev => (prev || []).filter(t => t.id !== id));
      toast('حُذفت العملية', 'info');
    } catch (e) { toast(`فشل الحذف: ${e.message}`, 'error'); }
  };

  // Pull carrier list once so we can detect transfers to them.
  useEffect(() => {
    loadCarriers().then(rows => {
      const enriched = rows.map(c => ({
        ...c,
        aliases: CARRIER_ALIASES[c.id] ?? [],
      }));
      setCarriers(enriched);
    }).catch(() => {});
  }, []);

  const carrierTransfers = useMemo(() => {
    if (!result?.transactions || !carriers.length) return [];
    return extractCarrierPayments(result.transactions, carriers).map((t, i) => ({ ...t, _idx: i }));
  }, [result, carriers]);

  // ── File handling ──────────────────────────────────────────────────────────
  const processFile = useCallback((file) => {
    if (!file) return;
    if (!can('bank.upload_statement')) {
      toast('لا تملك صلاحية رفع كشف بنكي', 'error');
      return;
    }
    setState('processing');
    setErrorMsg('');

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const parsed = parseExcelFile(data.buffer);
        setResult({ ...parsed, fileName: file.name });
        setState('done');
        toast(`تم استخراج ${parsed.transactions.length} عملية`, 'success');
      } catch (err) {
        console.error(err);
        setErrorMsg(err.message || 'فشل في قراءة الملف');
        setState('error');
      }
    };
    reader.onerror = () => {
      setErrorMsg('تعذّر قراءة الملف من القرص');
      setState('error');
    };
    reader.readAsArrayBuffer(file);
  }, [can]);

  const handleDrop = (e) => {
    e.preventDefault();
    setDrag(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) processFile(file);
  };

  const handlePick = (e) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = ''; // allow re-pick of same file
  };

  const reset = () => {
    setState('idle');
    setResult(null);
    setSearch('');
    setErrorMsg('');
  };

  // ── Derived totals ─────────────────────────────────────────────────────────
  const totals = useMemo(() => {
    if (!result) return { count: 0, debit: 0, credit: 0, fees: 0 };
    const t = result.transactions;
    const sumFeesRemoved = t.reduce((s, r) => s + (r.feesRemoved ?? 0), 0);
    const sumDebit       = t.reduce((s, r) => s + (r.debit  ?? 0), 0);
    const sumCredit      = t.reduce((s, r) => s + (r.credit ?? 0), 0);
    return {
      count:  t.length,
      // الرسوم (والخفية) صارت صفوفاً بـfeesRemoved، فلا نضيف hiddenFees ثانية.
      // المدين الإجمالي = الصافي + الرسوم المخصومة (= المدين الفعلي من البنك).
      debit:  sumDebit + sumFeesRemoved,
      credit: sumCredit,
      fees:   sumFeesRemoved,
    };
  }, [result]);

  // الرصيد الافتتاحي = الختامي − الدائن + المدين (الفعلي). + فحص الاستمرارية:
  // يجب أن يطابق ختامي الكشف السابق بالهللة.
  const openingBalance = useMemo(() => {
    if (!result?.summary || result.summary.closingBalance == null) return null;
    return +(result.summary.closingBalance - totals.credit + totals.debit).toFixed(2);
  }, [result, totals]);
  const [prevClosing, setPrevClosing] = useState(null);
  useEffect(() => {
    const pf = result?.summary?.periodFrom;
    if (pf) loadPreviousClosing(pf, result?.bank || 'بنك الإنماء').then(setPrevClosing).catch(() => setPrevClosing(null));
    else setPrevClosing(null);
  }, [result]);
  const continuityGap = (openingBalance != null && prevClosing?.closing_balance != null)
    ? +(openingBalance - Number(prevClosing.closing_balance)).toFixed(2) : null;

  // ملخّص العمليات المرفوضة/المُرجَعة (صافيها صفر — تحويل خرج ثم رُدّ بنفس المرجع)
  const rejectedInfo = useMemo(() => {
    const list = result?.transactions || [];
    const returns = list.filter(t => t.rejected && (t.credit ?? 0) > 0);
    return { count: returns.length, amount: +returns.reduce((s, t) => s + (t.credit || 0), 0).toFixed(2) };
  }, [result]);

  // مطابقة البنك: نجمع عملياتنا بأنفسنا ونقارنها بإجماليات البنك المطبوعة
  // (لا ننسخها). التطابق = إثبات أننا التقطنا كل عملية بلا نقص ولا تكرار.
  const reconcile = useMemo(() => {
    if (!result?.summary) return null;
    const s = result.summary;
    const t = result.transactions;
    const ourDeposits  = t.filter(r => (r.credit ?? 0) > 0).length;
    const ourWithdraws = t.length - ourDeposits;
    const near = (a, b) => a != null && b != null && Math.abs(a - b) <= 0.01;
    const checks = [];
    if (s.bankTotalCredit  != null) checks.push({ label: 'إجمالي المودَع', ours: totals.credit, bank: s.bankTotalCredit, ok: near(totals.credit, s.bankTotalCredit), money: true });
    if (s.bankTotalDebit   != null) checks.push({ label: 'إجمالي المسحوب', ours: totals.debit,  bank: s.bankTotalDebit,  ok: near(totals.debit,  s.bankTotalDebit),  money: true });
    if (s.bankDepositCount != null) checks.push({ label: 'عدد الإيداعات', ours: ourDeposits,  bank: s.bankDepositCount, ok: ourDeposits  === s.bankDepositCount });
    if (s.bankWithdrawCount!= null) checks.push({ label: 'عدد السحوبات', ours: ourWithdraws, bank: s.bankWithdrawCount, ok: ourWithdraws === s.bankWithdrawCount });
    if (!checks.length) return null;
    return { checks, allOk: checks.every(c => c.ok) };
  }, [result, totals]);

  const filtered = useMemo(() => {
    if (!result) return [];
    let list = result.transactions;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(t =>
        String(t.reference).toLowerCase().includes(q)
        || String(t.description).toLowerCase().includes(q)
      );
    }
    // ترتيب تسلسلي: الوقت الكامل (SiFi) ثم المرجع تصاعدياً عند التساوي — الأحدث أولاً.
    return [...list].sort((a, b) => seqKey(b).localeCompare(seqKey(a)));
  }, [result, search]);

  // ── Export ────────────────────────────────────────────────────────────────
  const handleExport = () => {
    if (!result) return;
    if (!can('bank.export')) {
      toast('لا تملك صلاحية تصدير كشف البنك', 'error');
      return;
    }
    try {
      const bytes = generateCleanExcel(result.transactions, result.summary);
      const blob  = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url   = URL.createObjectURL(blob);
      const a     = document.createElement('a');
      a.href      = url;
      a.download  = `كشف_حساب_صافي_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast(`تم تصدير الكشف الصافي ✓${rejectedInfo.count ? ` · حُذف ${rejectedInfo.count} تحويل مرفوض (وردّه)` : ''}`, 'success');
    } catch (e) {
      toast(`خطأ في التصدير: ${e.message}`, 'error');
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '24px 28px 80px', maxWidth: 1200, margin: '0 auto' }}>
      <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 18, marginBottom: 4 }}>
        💼 كشف <span style={{ color: 'var(--accent)' }}>الحساب</span>
      </h2>
      <p style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 18 }}>
        ارفع كشف بنكي (Excel) ليتم استخراج العمليات وفصل الرسوم والضريبة عن المبلغ الأساسي.
        احفظ العمليات لتتراكم عبر الفترات — الرفعات المتداخلة تُدمَج بلا تكرار.
      </p>

      {/* View toggle: this upload vs the accumulated saved ledger */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
        <Btn variant={view === 'current' ? 'primary' : 'outline'} icon={<Upload size={13}/>} onClick={() => setView('current')}>
          الكشف الحالي
        </Btn>
        <Btn variant={view === 'saved' ? 'primary' : 'outline'} icon={<Database size={13}/>} onClick={() => setView('saved')}>
          الكشوف المحفوظة{saved?.length ? ` (${saved.length})` : ''}
        </Btn>
      </div>

      {view === 'current' && (<>
      {/* IDLE — drop zone */}
      {state === 'idle' && can('bank.upload_statement') && (
        <div
          onDragOver={e => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={handleDrop}
          onClick={() => document.getElementById('bs-file').click()}
          style={{
            border: `2px dashed ${drag ? 'var(--accent)' : 'var(--border2)'}`,
            borderRadius: 14, padding: '64px 24px', textAlign: 'center',
            background: drag ? 'color-mix(in srgb, var(--accent) 5%, transparent)' : 'var(--surface)',
            cursor: 'pointer', transition: 'all .2s',
            transform: drag ? 'scale(1.01)' : 'scale(1)',
          }}
        >
          <Upload size={42} color="var(--muted)" style={{ marginBottom: 12 }}/>
          <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>اسحب ملف كشف الحساب هنا</div>
          <div style={{ color: 'var(--muted)', fontSize: 12 }}>
            يدعم ملفات Excel من بنك الإنماء وغيره
          </div>
          <input id="bs-file" type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
            onChange={handlePick}/>
        </div>
      )}
      {state === 'idle' && !can('bank.upload_statement') && (
        <Card><Empty icon="🔒" title="عرض فقط" sub="يمكنك مراجعة الكشوف المحفوظة، لكن رفع كشف جديد يحتاج صلاحية مستقلة."/></Card>
      )}

      {/* PROCESSING */}
      {state === 'processing' && (
        <Card style={{ padding: 64, textAlign: 'center' }}>
          <Spinner size={36}/>
          <div style={{ color: 'var(--muted)', marginTop: 12, fontSize: 13 }}>جارٍ معالجة الكشف...</div>
        </Card>
      )}

      {/* ERROR */}
      {state === 'error' && (
        <Card>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <AlertCircle size={22} color="var(--red)" style={{ flexShrink: 0, marginTop: 2 }}/>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>تعذّر معالجة الملف</div>
              <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 14 }}>{errorMsg}</div>
              <Btn variant="primary" onClick={reset}>محاولة أخرى</Btn>
            </div>
          </div>
        </Card>
      )}

      {/* DONE */}
      {state === 'done' && result && (
        <>
          {/* Summary card */}
          <Card style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Wallet size={22} color="var(--accent)"/>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 2 }}>ملخص الكشف</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted3)' }}>{result.fileName}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', rowGap: 12 }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>الرصيد أول الفترة</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>
                    {openingBalance != null ? fmtMoney(openingBalance) : '—'} <span style={{ fontSize: 11, color: 'var(--muted)' }}>ر.س</span>
                  </div>
                  {prevClosing && continuityGap != null ? (
                    <div style={{ fontSize: 10.5, marginTop: 3, fontWeight: 700, color: Math.abs(continuityGap) <= 0.01 ? 'var(--green)' : 'var(--red)' }}>
                      {Math.abs(continuityGap) <= 0.01 ? '✓ مطابق للكشف السابق' : `⚠️ فجوة ${fmtMoney(continuityGap)} عن السابق`}
                    </div>
                  ) : result.summary?.periodFrom ? (
                    <div style={{ fontSize: 10, marginTop: 3, color: 'var(--muted)' }}>لا كشف سابق محفوظ للمقارنة</div>
                  ) : null}
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>الرصيد آخر الفترة</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>
                    {fmtMoney(result.summary.closingBalance)} <span style={{ fontSize: 11, color: 'var(--muted)' }}>ر.س</span>
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>
                    <Calendar size={10} style={{ display: 'inline', marginLeft: 4 }}/>
                    الفترة
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600 }}>
                    {result.summary.periodFrom || '—'} ← {result.summary.periodTo || '—'}
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* لوحة تحقّق المطابقة مع البنك — مجموع عملياتنا مقابل إجماليات البنك */}
          {reconcile && (
            <Card style={{
              marginBottom: 14, padding: '12px 16px',
              border: `1px solid ${reconcile.allOk ? 'var(--green)' : 'var(--red)'}`,
              background: reconcile.allOk ? 'rgba(52,211,153,.06)' : 'rgba(220,38,38,.06)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                {reconcile.allOk
                  ? <CheckCircle2 size={17} color="var(--green)"/>
                  : <AlertCircle size={17} color="var(--red)"/>}
                <div style={{ fontWeight: 700, fontSize: 13, color: reconcile.allOk ? 'var(--green)' : 'var(--red)' }}>
                  {reconcile.allOk
                    ? '✓ العمليات المستخرَجة مطابقة تماماً لإجماليات البنك'
                    : '⚠️ فرق بين عملياتنا وإجماليات البنك — قد تكون هناك عمليات ناقصة'}
                </div>
                <span style={{ marginRight: 'auto', fontSize: 11, color: 'var(--muted)' }}>
                  جُمِعت {totals.count} عملية بشكل مستقل، ثم قُورنت بالكشف
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
                {reconcile.checks.map((c, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                    padding: '7px 11px', borderRadius: 9,
                    background: 'var(--card)', border: `1px solid ${c.ok ? 'var(--border)' : 'var(--red)'}`,
                  }}>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>{c.label}</span>
                    <div style={{ textAlign: 'left' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, fontWeight: 700, color: c.ok ? 'var(--text)' : 'var(--red)' }}>
                        {c.money ? fmtMoney(c.ours) : c.ours}
                      </span>
                      {c.ok
                        ? <CheckCircle2 size={13} color="var(--green)" style={{ marginRight: 5, verticalAlign: 'middle' }}/>
                        : <span style={{ fontSize: 10, color: 'var(--red)', marginRight: 5 }}>
                            ≠ بنك {c.money ? fmtMoney(c.bank) : c.bank}
                          </span>}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Stat cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 14 }}>
            <StatBlock label="إجمالي العمليات"   value={totals.count}             color="var(--accent)" mono/>
            <StatBlock label="إجمالي المسحوب"     value={fmtMoney(totals.debit)}   color="var(--red)"   suffix="ر.س"/>
            <StatBlock label="إجمالي المودَع"     value={fmtMoney(totals.credit)}  color="var(--green)" suffix="ر.س"/>
            <StatBlock label="إجمالي الرسوم المخصومة" value={fmtMoney(totals.fees)} color="var(--gold)"  suffix="ر.س"/>
          </div>

          {/* Toolbar */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            {can('bank.upload_statement') ? (
              <Btn variant="accent" icon={saving ? <Spinner size={13}/> : <Save size={14}/>} onClick={handleSave} disabled={saving}>
                {saving ? 'جارٍ الحفظ…' : 'حفظ في الدفتر'}
              </Btn>
            ) : null}
            {/* البنك المكتشَف — يُحفظ منفصلاً (§متعدد البنوك) */}
            <span style={{ padding: '5px 12px', borderRadius: 999, fontSize: 12, fontWeight: 800, background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)', display: 'inline-flex', gap: 5, alignItems: 'center' }}>
              🏦 {result?.bank || 'بنك الإنماء'}
            </span>
            {can('bank.export') ? (
              <Btn variant="ghost" size="sm" icon={<Download size={14}/>} onClick={handleExport}>
                تصدير الكشف الصافي
              </Btn>
            ) : null}
            {carrierTransfers.length > 0 && can('bank.reconcile') && (
              <Btn variant="gold" icon={<Link2 size={14}/>} onClick={() => setReconcileOpen(true)}>
                💼 ربط تحويلاتك لشركات الشحن ({carrierTransfers.length})
              </Btn>
            )}
            <Btn variant="ghost" icon={<Trash2 size={14}/>} onClick={reset}>
              ملف جديد
            </Btn>
            {rejectedInfo.count > 0 && (
              <span style={{
                background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.28)',
                color: 'var(--red)', fontSize: 11, padding: '4px 10px', borderRadius: 14,
                fontFamily: 'var(--font-mono)',
              }}>
                ↩︎ {rejectedInfo.count} عملية مرفوضة · {fmtMoney(rejectedInfo.amount)} ر.س ذهاباً وإياباً (صافي صفر)
              </span>
            )}
            {result.hiddenFees > 0 && (
              <span style={{
                marginRight: 'auto',
                background: 'rgba(245,158,11,.1)', border: '1px solid rgba(245,158,11,.25)',
                color: 'var(--gold)', fontSize: 11, padding: '4px 10px', borderRadius: 14,
                fontFamily: 'var(--font-mono)',
              }}>
                ⚠ {fmtMoney(result.hiddenFees)} ر.س رسوم خفية (صفوف بدون وصف)
              </span>
            )}
          </div>

          {/* Search */}
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <Search size={14} style={{ position: 'absolute', right: 12, top: 11, color: 'var(--muted)' }}/>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="بحث بالرقم المرجعي أو الوصف..."
              style={{ width: '100%', padding: '9px 36px 9px 12px', borderRadius: 9, fontSize: 13 }}
            />
          </div>

          {/* Table */}
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <div className="m-flow" style={{ maxHeight: 600, overflowY: 'auto' }}>
              {filtered.length === 0
                ? <Empty icon="🔍" title="لا توجد عمليات مطابقة" sub="جرب نص بحث مختلف"/>
                : (
                  <table className="m-cards" style={{ fontSize: 12, width: '100%' }}>
                    <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--surface)' }}>
                      <tr>
                        <th style={{ minWidth: 90 }}>التاريخ</th>
                        <th style={{ minWidth: 130 }}>الرقم المرجعي</th>
                        <th>الوصف</th>
                        <th style={{ minWidth: 90 }}>مودَع</th>
                        <th style={{ minWidth: 90 }}>مسحوب (صافي)</th>
                        <th style={{ minWidth: 70 }}>الرسوم</th>
                        <th style={{ minWidth: 70 }}>الضريبة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((t, i) => (
                        <tr key={i} style={t.rejected ? { background: 'rgba(220,38,38,.05)' } : undefined}>
                          <td data-label="التاريخ" style={{ color: 'var(--muted)', fontSize: 11, whiteSpace: 'nowrap' }}>{t.date || '—'}</td>
                          <td data-label="المرجع" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', whiteSpace: 'nowrap' }}>
                            {t.reference || '—'}
                          </td>
                          <td data-label="" style={{ fontSize: 12, maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {t.rejected && <RejBadge/>}
                            {t.description}
                          </td>
                          <td data-label="مودَع" style={{ fontFamily: 'var(--font-mono)', color: 'var(--green)', fontWeight: 600 }}>
                            {t.credit != null ? fmtMoney(t.credit) : ''}
                          </td>
                          <td data-label="مسحوب (صافي)" style={{ fontFamily: 'var(--font-mono)', color: 'var(--red)', fontWeight: 600 }}>
                            {t.debit != null && t.debit !== 0 ? fmtMoney(t.debit) : ''}
                          </td>
                          <td data-label="الرسوم" style={{ fontFamily: 'var(--font-mono)', color: 'var(--gold)' }}>
                            {t.fees > 0 ? t.fees.toFixed(2) : ''}
                          </td>
                          <td data-label="الضريبة" style={{ fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
                            {t.tax > 0 ? t.tax.toFixed(2) : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              }
            </div>
          </Card>
        </>
      )}
      </>)}

      {/* SAVED LEDGER — accumulated across every upload */}
      {view === 'saved' && (
        savedLoading && saved == null
          ? <Card style={{ padding: 64, textAlign: 'center' }}><Spinner size={32}/></Card>
          : !saved || saved.length === 0
            ? <Card><Empty icon="🏦" title="الدفتر البنكي فارغ" sub="ارفع كشفاً من تبويب «الكشف الحالي» ثم اضغط «حفظ في الدفتر»"/></Card>
            : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 14 }}>
                  <StatBlock label="إجمالي العمليات" value={savedTotals.count}           color="var(--accent)" mono/>
                  <StatBlock label="إجمالي المسحوب"   value={fmtMoney(savedTotals.debit)}  color="var(--red)"   suffix="ر.س"/>
                  <StatBlock label="إجمالي المودَع"   value={fmtMoney(savedTotals.credit)} color="var(--green)" suffix="ر.س"/>
                  <StatBlock label="رسوم + ضريبة"    value={fmtMoney(savedTotals.fees)}   color="var(--gold)"  suffix="ر.س"/>
                  {periodClosing && periodClosing.closing_balance != null && (
                    <StatBlock label={`الرصيد الختامي · ${String(periodClosing.period_to).slice(0, 10)}`}
                      value={fmtMoney(Number(periodClosing.closing_balance))} color="var(--accent)" suffix="ر.س"/>
                  )}
                </div>
                {/* شريط البنوك — رصيد كل بنك (ختامي آخر كشف) + النقر يفلتر (§متعدد البنوك) */}
                {bankSummary.length > 1 && (
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
                    {bankSummary.map(b => (
                      <div key={b.bank} onClick={() => setSavedBank(savedBank === b.bank ? 'all' : b.bank)}
                        style={{ cursor: 'pointer', flex: '1 1 200px', minWidth: 180, padding: '12px 16px', borderRadius: 12,
                          border: `1.5px solid ${savedBank === b.bank ? 'var(--accent)' : 'var(--border)'}`,
                          background: savedBank === b.bank ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'var(--surface)' }}>
                        <div style={{ fontSize: 13, fontWeight: 800, display: 'flex', gap: 6, alignItems: 'center' }}>🏦 {b.bank}</div>
                        <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--accent)', marginTop: 4 }}>
                          {b.closing != null ? fmtMoney(b.closing) : '—'} <span style={{ fontSize: 11, color: 'var(--muted)' }}>ر.س</span>
                        </div>
                        <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>
                          {b.count} عملية{b.asOf ? ` · ختامي ${String(b.asOf).slice(0, 10)}` : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {periodClosing && periodClosing.closing_balance != null && (
                  <div style={{ marginBottom: 10, marginTop: -6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                      كشف {String(periodClosing.period_from).slice(0, 10)} ← {String(periodClosing.period_to).slice(0, 10)}
                      {periodClosing.opening_balance != null && <> · الافتتاحي <b style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{fmtMoney(Number(periodClosing.opening_balance))}</b> ر.س</>}
                      {' · '}الختامي <b style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{fmtMoney(Number(periodClosing.closing_balance))}</b> ر.س
                    </div>
                    {periodRecon && (
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, lineHeight: 1.6, padding: '8px 12px', borderRadius: 9,
                        background: periodRecon.ok ? 'rgba(16,163,74,.08)' : 'rgba(220,38,38,.08)',
                        border: `1px solid ${periodRecon.ok ? 'rgba(16,163,74,.3)' : 'rgba(220,38,38,.3)'}`,
                        color: periodRecon.ok ? 'var(--green)' : 'var(--red)' }}>
                        <span style={{ fontSize: 14, flexShrink: 0 }}>{periodRecon.ok ? '✓' : '⚠️'}</span>
                        {periodRecon.ok
                          ? <span>تحقّقنا: حساب البنك <b>مطابق</b> لعملياتنا — الافتتاحي + الحركة = الختامي بالضبط (فجوة صفر). دليل أنّنا التقطنا كل عملية بلا نقص أو تكرار.</span>
                          : <span>فجوة <b style={{ fontFamily: 'var(--font-mono)' }}>{fmtMoney(Math.abs(periodRecon.gap))}</b> ر.س: حسابنا يعطي <b style={{ fontFamily: 'var(--font-mono)' }}>{fmtMoney(periodRecon.computed)}</b> بينما ختامي البنك <b style={{ fontFamily: 'var(--font-mono)' }}>{fmtMoney(Number(periodClosing.closing_balance))}</b> — عملية ناقصة/مكررة أو خطأ، راجِع الفترة.</span>}
                      </div>
                    )}
                  </div>
                )}

                {savedRejectedInfo.count > 0 && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
                    background: 'rgba(220,38,38,.07)', border: '1px solid rgba(220,38,38,.25)',
                    borderRadius: 10, padding: '8px 12px', fontSize: 12, color: 'var(--red)',
                  }}>
                    <span>↩︎</span>
                    <span><b>{savedRejectedInfo.count}</b> عملية مرفوضة/مُرجَعة ضمن المعروض · {fmtMoney(savedRejectedInfo.amount)} ر.س ذهاباً وإياباً (صافيها صفر — مُعلَّمة بالجدول)</span>
                  </div>
                )}

                {/* شرائح الفترات الجاهزة (من الكشوف المرفوعة) */}
                {savedPeriods.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 4 }}>فترات جاهزة:</span>
                    {savedPeriods.map((p, i) => {
                      const active = savedFrom === p.from && savedTo === p.to;
                      return (
                        <button key={i} onClick={() => { setSavedFrom(active ? '' : p.from); setSavedTo(active ? '' : p.to); }}
                          style={{
                            fontSize: 10.5, fontFamily: 'var(--font-mono)', padding: '4px 9px', borderRadius: 20, cursor: 'pointer',
                            border: `1px solid ${active ? 'var(--accent)' : 'var(--border2)'}`,
                            background: active ? 'var(--accent)' : 'transparent',
                            color: active ? '#fff' : 'var(--muted)', whiteSpace: 'nowrap',
                          }}>
                          {p.from} ← {p.to}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* شريط الفلاتر: فترة مخصّصة + نوع + بحث + تصدير */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                    <Calendar size={13} style={{ color: 'var(--muted)' }}/>
                    <input type="date" value={savedFrom} onChange={e => setSavedFrom(e.target.value)}
                      title="من تاريخ" style={{ padding: '7px 8px', borderRadius: 8, fontSize: 12, fontFamily: 'var(--font-mono)' }}/>
                    <span style={{ color: 'var(--muted)', fontSize: 12 }}>←</span>
                    <input type="date" value={savedTo} onChange={e => setSavedTo(e.target.value)}
                      title="إلى تاريخ" style={{ padding: '7px 8px', borderRadius: 8, fontSize: 12, fontFamily: 'var(--font-mono)' }}/>
                  </div>
                  {bankSummary.length > 1 && (
                    <select value={savedBank} onChange={e => setSavedBank(e.target.value)}
                      title="فلتر البنك" style={{ padding: '7px 10px', borderRadius: 8, fontSize: 12, fontWeight: 700 }}>
                      <option value="all">🏦 كل البنوك</option>
                      {bankSummary.map(b => <option key={b.bank} value={b.bank}>{b.bank} ({b.count})</option>)}
                    </select>
                  )}
                  <select value={savedType} onChange={e => setSavedType(e.target.value)}
                    style={{ padding: '7px 10px', borderRadius: 8, fontSize: 12 }}>
                    <option value="all">كل العمليات</option>
                    <option value="debit">مسحوب فقط</option>
                    <option value="credit">مودَع فقط</option>
                  </select>
                  <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
                    <Search size={14} style={{ position: 'absolute', right: 12, top: 9, color: 'var(--muted)' }}/>
                    <input
                      value={savedSearch}
                      onChange={e => setSavedSearch(e.target.value)}
                      placeholder="بحث بالرقم المرجعي أو الوصف..."
                      style={{ width: '100%', padding: '8px 36px 8px 12px', borderRadius: 8, fontSize: 13 }}
                    />
                  </div>
                  {filtersActive && (
                    <Btn variant="ghost" size="sm" onClick={() => { setSavedSearch(''); setSavedFrom(''); setSavedTo(''); setSavedType('all'); setSavedBank('all'); }}>
                      مسح الفلاتر
                    </Btn>
                  )}
                  {can('bank.export') ? (
                    <Btn variant="ghost" size="sm" icon={<Download size={14}/>} onClick={handleExportSaved} disabled={!savedFiltered.length}>
                      تصدير المعروض
                    </Btn>
                  ) : null}
                </div>

                {/* عدّاد النتائج تحت الفلترة */}
                {filtersActive && (
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
                    عرض <b style={{ color: 'var(--text)' }}>{savedFiltered.length}</b> من {saved.length} عملية
                  </div>
                )}

                <Card style={{ padding: 0, overflow: 'hidden' }}>
                  <div className="m-flow" style={{ maxHeight: 600, overflowY: 'auto' }}>
                    {savedFiltered.length === 0
                      ? <Empty icon="🔍" title="لا توجد عمليات مطابقة" sub="عدّل الفترة أو نوع العملية أو نص البحث"/>
                      : (
                        <table className="m-cards" style={{ fontSize: 12, width: '100%' }}>
                          <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--surface)' }}>
                            <tr>
                              <th style={{ minWidth: 90 }}>التاريخ</th>
                              <th style={{ minWidth: 130 }}>الرقم المرجعي</th>
                              <th>الوصف</th>
                              <th style={{ minWidth: 90 }}>مودَع</th>
                              <th style={{ minWidth: 90 }}>مسحوب</th>
                              <th style={{ minWidth: 70 }}>الرسوم</th>
                              <th style={{ minWidth: 40 }}></th>
                            </tr>
                          </thead>
                          <tbody>
                            {savedFiltered.map(t => (
                              <tr key={t.id} style={t.rejected ? { background: 'rgba(220,38,38,.05)' } : undefined}>
                                <td data-label="التاريخ" style={{ color: 'var(--muted)', fontSize: 11, whiteSpace: 'nowrap' }}>
                                  {t.txn_date || '—'}
                                  {t.txn_at && <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--muted2)', marginInlineStart: 4 }}>{String(t.txn_at).match(/[T ](\d{2}:\d{2})/)?.[1] || ''}</span>}
                                  {savedBank === 'all' && bankSummary.length > 1 && (
                                    <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--accent)', marginTop: 2 }}>🏦 {(t.bank || 'بنك الإنماء').replace('بنك ', '')}</div>
                                  )}
                                </td>
                                <td data-label="المرجع" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', whiteSpace: 'nowrap' }}>
                                  {t.reference || '—'}
                                </td>
                                <td data-label="" style={{ fontSize: 12, maxWidth: 360 }}>
                                  {t.rejected && <RejBadge/>}
                                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.description}</div>
                                  {t.note && (
                                    <div style={{ marginTop: 3, fontSize: 11, color: 'var(--gold)', background: 'color-mix(in srgb, var(--gold) 10%, transparent)', borderRadius: 6, padding: '3px 8px', display: 'inline-block' }}>
                                      📝 {t.note}
                                    </div>
                                  )}
                                </td>
                                <td data-label="مودَع" style={{ fontFamily: 'var(--font-mono)', color: 'var(--green)', fontWeight: 600 }}>
                                  {Number(t.credit) ? fmtMoney(t.credit) : ''}
                                </td>
                                <td data-label="مسحوب" style={{ fontFamily: 'var(--font-mono)', color: 'var(--red)', fontWeight: 600 }}>
                                  {Number(t.debit) ? fmtMoney(t.debit) : ''}
                                </td>
                                <td data-label="الرسوم" style={{ fontFamily: 'var(--font-mono)', color: 'var(--gold)' }}>
                                  {Number(t.fees) + Number(t.tax) > 0 ? (Number(t.fees) + Number(t.tax)).toFixed(2) : ''}
                                </td>
                                <td data-label="إجراء">
                                  <div style={{ display: 'flex', gap: 5 }}>
                                    {can('bank.edit_note') ? <button title="ملاحظة" onClick={() => { setNoteFor(t); setNoteText(t.note || ''); }}
                                      style={{ border: `1px solid ${t.note ? 'var(--gold)' : 'var(--border2)'}`, background: t.note ? 'color-mix(in srgb, var(--gold) 14%, transparent)' : 'var(--surface)', color: t.note ? 'var(--gold)' : 'var(--muted)', borderRadius: 8, padding: '5px 7px', cursor: 'pointer', fontSize: 12 }}>📝</button>
                                    : null}
                                    {can('bank.delete_transaction') ? (
                                      <Btn variant="danger" size="sm" title="حذف العملية" icon={<Trash2 size={12}/>}
                                        onClick={() => setConfirmDel(t)}/>
                                    ) : null}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )
                    }
                  </div>
                </Card>
              </>
            )
      )}

      {confirmDel && can('bank.delete_transaction') && (
        <Modal title="⚠️ تأكيد حذف العملية" onClose={() => !deleting && setConfirmDel(null)} width={460}>
          <div style={{ fontSize: 13, marginBottom: 12 }}>
            سيُحذف هذا القيد نهائياً من الكشوف المحفوظة. <b style={{ color: 'var(--red)' }}>لا يمكن التراجع.</b>
          </div>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 9, padding: 12, marginBottom: 16, fontSize: 12, lineHeight: 1.7 }}>
            <div><span style={{ color: 'var(--muted)' }}>التاريخ:</span> {confirmDel.txn_date || '—'}</div>
            <div><span style={{ color: 'var(--muted)' }}>المرجع:</span> <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{confirmDel.reference || '—'}</span></div>
            <div>
              <span style={{ color: 'var(--muted)' }}>المبلغ:</span>{' '}
              <b style={{ color: Number(confirmDel.credit) ? 'var(--green)' : 'var(--red)' }}>
                {fmtMoney(Number(confirmDel.credit) || Number(confirmDel.debit) || 0)} ر.س
              </b>{' '}
              <span style={{ color: 'var(--muted)' }}>({Number(confirmDel.credit) ? 'مودَع' : 'مسحوب'})</span>
            </div>
            <div style={{ color: 'var(--muted3)', marginTop: 4, fontSize: 11 }}>{confirmDel.description}</div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Btn variant="ghost" onClick={() => setConfirmDel(null)} disabled={deleting}>إلغاء</Btn>
            <Btn variant="danger" icon={deleting ? <Spinner size={13}/> : <Trash2 size={13}/>} disabled={deleting}
              onClick={async () => {
                setDeleting(true);
                await handleDeleteSaved(confirmDel.id);
                setDeleting(false);
                setConfirmDel(null);
              }}>
              {deleting ? 'جارٍ الحذف…' : 'تأكيد الحذف'}
            </Btn>
          </div>
        </Modal>
      )}

      {/* ملاحظة على عملية بنكية */}
      {noteFor && can('bank.edit_note') && (
        <Modal title="📝 ملاحظة على العملية" onClose={() => setNoteFor(null)} width={460}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
            {noteFor.txn_date} · {noteFor.reference} · <span style={{ color: (Number(noteFor.debit) > 0) ? 'var(--red)' : 'var(--green)' }}>{fmtMoney(Number(noteFor.debit) > 0 ? noteFor.debit : noteFor.credit)} ر.س</span>
          </div>
          <textarea value={noteText} onChange={e => setNoteText(e.target.value)} autoFocus rows={3}
            placeholder="اكتب ملاحظتك على هذه العملية (سبب/سياق/تذكير)…"
            style={{ width: '100%', padding: '9px 11px', borderRadius: 9, fontSize: 13, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', resize: 'vertical' }}/>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 12 }}>
            {noteFor.note
              ? <Btn variant="ghost" size="sm" onClick={async () => { setNoteSaving(true); try { await setBankNote(noteFor.id, ''); setSaved(prev => (prev || []).map(x => x.id === noteFor.id ? { ...x, note: null } : x)); setNoteFor(null); toast('حُذفت الملاحظة', 'success'); } catch (e) { toast(e.message, 'error'); } setNoteSaving(false); }}>حذف الملاحظة</Btn>
              : <span/>}
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn variant="ghost" onClick={() => setNoteFor(null)} disabled={noteSaving}>إلغاء</Btn>
              <Btn variant="accent" disabled={noteSaving} icon={noteSaving ? <Spinner size={13}/> : null}
                onClick={async () => { setNoteSaving(true); try { await setBankNote(noteFor.id, noteText); setSaved(prev => (prev || []).map(x => x.id === noteFor.id ? { ...x, note: noteText.trim() || null } : x)); setNoteFor(null); toast('حُفظت الملاحظة', 'success'); } catch (e) { toast(e.message, 'error'); } setNoteSaving(false); }}>
                حفظ
              </Btn>
            </div>
          </div>
        </Modal>
      )}

      {reconcileOpen && can('bank.reconcile') && (
        <ReconcileModal
          transfers={carrierTransfers}
          carriers={carriers}
          reconciledTxIds={reconciledTxIds}
          onClose={() => setReconcileOpen(false)}
          onReconciled={(txIdx) => setReconciledTxIds(prev => new Set([...prev, txIdx]))}
        />
      )}
    </div>
  );
}

// ─── Reconciliation modal ─────────────────────────────────────────────────
function ReconcileModal({ transfers, carriers, reconciledTxIds, onClose, onReconciled }) {
  const [matches, setMatches] = useState(null);  // [{ transfer, suggestion, confidence }]
  const [loading, setLoading] = useState(true);
  const [busyIdx, setBusyIdx] = useState(null);
  const carriersById = useMemo(
    () => Object.fromEntries((carriers ?? []).map(c => [c.id, c])),
    [carriers],
  );

  useEffect(() => {
    let cancelled = false;
    suggestPaymentMatches(transfers).then(rows => {
      if (!cancelled) { setMatches(rows); setLoading(false); }
    }).catch(e => {
      if (!cancelled) { toast(`فشل التحليل: ${e.message}`, 'error'); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [transfers]);

  const confirm = async (row, idx) => {
    if (!row.suggestion) return;
    setBusyIdx(idx);
    try {
      const opIds = row.suggestion.ops.map(o => o.id);
      await markOperationsPaid(opIds, row.transfer.reference, row.transfer.date);
      toast(`✓ تم تسديد ${opIds.length} عملية`, 'success');
      onReconciled(row.transfer._idx);
      // Update local state to mark this row as done
      setMatches(prev => prev.map((r, i) => i === idx ? { ...r, _done: true } : r));
    } catch (e) {
      toast(`فشل التسديد: ${e.message}`, 'error');
    }
    setBusyIdx(null);
  };

  return (
    <Modal title="💼 ربط تحويلاتك لشركات الشحن" onClose={onClose} width={780}>
      <p style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 14 }}>
        اقتراحات لربط التحويلات الصادرة لشركات الشحن بالعمليات المعلّقة في الدفتر.
        كل تأكيد يُسجّل تسديد العملية مع رقم الحوالة وتاريخها تلقائياً.
      </p>

      {loading
        ? <div style={{ textAlign: 'center', padding: 30 }}><Spinner size={22}/></div>
        : matches.length === 0
          ? <Empty icon="🔍" title="ما لقيت اقتراحات" sub="لا يوجد عمليات معلّقة بنفس مبالغ التحويلات"/>
          : (
            <div style={{ maxHeight: 460, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {matches.map((row, idx) => {
                const t = row.transfer;
                const sug = row.suggestion;
                const carrierName = carriersById[t.matchedCarrier]?.name || t.matchedCarrier;
                const isDone = row._done || reconciledTxIds.has(t._idx);
                const isLow = (row.confidence || 0) < 60;
                return (
                  <div key={idx} style={{
                    border: `1px solid ${isDone ? 'var(--green)' : sug ? 'var(--accent)' : 'var(--border)'}`,
                    background: isDone ? 'rgba(52,211,153,.05)' : 'var(--surface)',
                    borderRadius: 10, padding: '10px 12px',
                  }}>
                    {/* Bank transfer line */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: sug ? 8 : 0 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 3 }}>
                          <span style={{
                            background: 'var(--accent)20', color: 'var(--accent)',
                            padding: '2px 8px', borderRadius: 9, fontSize: 10, fontWeight: 700,
                            fontFamily: 'var(--font-mono)',
                          }}>{carrierName}</span>
                          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{t.date}</span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)' }}>{t.reference}</span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {t.description}
                        </div>
                      </div>
                      <div style={{ textAlign: 'left', minWidth: 110 }}>
                        <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--red)', fontSize: 14 }}>
                          {fmtMoney(t.grossAmount ?? t.debit)}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--muted)' }}>تحويل صادر</div>
                      </div>
                    </div>

                    {/* Suggestion or empty */}
                    {!sug && (
                      <div style={{ fontSize: 11, color: 'var(--muted)', padding: '6px 0' }}>
                        ما لقيت عملية معلّقة بنفس المبلغ — يحتاج تسديد يدوي من الدفتر.
                      </div>
                    )}
                    {sug && !isDone && (
                      <div style={{
                        background: 'var(--card)', borderRadius: 8, padding: 10,
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
                            مطابقة مقترحة:
                            <span style={{
                              marginRight: 8,
                              background: isLow ? 'var(--gold)15' : 'var(--green)15',
                              color: isLow ? 'var(--gold)' : 'var(--green)',
                              padding: '1px 7px', borderRadius: 9, fontSize: 9, fontWeight: 700,
                            }}>
                              ثقة {row.confidence}%
                            </span>
                            {sug.type === 'multi' && <span style={{ marginRight: 6, color: 'var(--gold)' }}>(عمليتان مجمّعتان)</span>}
                          </div>
                          {sug.ops.map(op => (
                            <div key={op.id} style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                              <span style={{ color: 'var(--accent)' }}>{op.doc_no}</span>
                              <span style={{ color: 'var(--muted)' }}> · {op.doc_type} · </span>
                              <span style={{ color: 'var(--text)' }}>{op.reference_no}</span>
                              <span style={{ color: 'var(--muted)' }}> · </span>
                              <span style={{ color: 'var(--red)', fontWeight: 600 }}>{fmtMoney(op.amount_dr)} ر.س</span>
                              {op.due_date && <span style={{ color: 'var(--muted)', fontSize: 10 }}> · يستحق {op.due_date}</span>}
                            </div>
                          ))}
                        </div>
                        <Btn size="sm" variant="accent" disabled={busyIdx === idx} onClick={() => confirm(row, idx)}>
                          {busyIdx === idx ? <Spinner size={11}/> : <><CheckCircle2 size={12}/> تأكيد</>}
                        </Btn>
                      </div>
                    )}
                    {isDone && (
                      <div style={{
                        background: 'rgba(52,211,153,.1)', borderRadius: 8, padding: '8px 12px',
                        color: 'var(--green)', fontSize: 12, fontWeight: 600,
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}>
                        <CheckCircle2 size={14}/> تم التسديد ✓
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
      }

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        <Btn variant="ghost" onClick={onClose}>إغلاق</Btn>
      </div>
    </Modal>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────
function RejBadge() {
  return (
    <span title="تحويل مرفوض/مُرجَع — رُدّ بنفس المرجع (صافي صفر)" style={{
      display: 'inline-block', background: 'var(--red)', color: '#fff',
      fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 8,
      marginLeft: 6, verticalAlign: 'middle', whiteSpace: 'nowrap',
    }}>↩︎ مرفوض</span>
  );
}

function StatBlock({ label, value, color, suffix, mono }) {
  return (
    <div className="stat-card" style={{
      '--sc-tone': color || 'var(--accent)',
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 11, padding: '13px 16px',
    }}>
      <div style={{ color: 'var(--muted)', fontSize: 10, fontFamily: 'var(--font-mono)', marginBottom: 3 }}>
        {label}
      </div>
      <div style={{
        color, fontSize: mono ? 22 : 16,
        fontFamily: 'var(--font-mono)', fontWeight: 700,
        whiteSpace: 'nowrap',
      }}>
        {value}
        {suffix && <span style={{ fontSize: 10, color: 'var(--muted)', marginRight: 4 }}> {suffix}</span>}
      </div>
    </div>
  );
}

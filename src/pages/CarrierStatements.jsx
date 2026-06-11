import { useState, useMemo, useCallback, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Upload, FileText, AlertCircle, Search, Trash2, Save, Sparkles } from 'lucide-react';
import CarrierTabs from '../components/CarrierTabs.jsx';
import { Card, Btn, Input, Spinner, Empty, Badge, toast } from '../components/UI.jsx';
import { parseAramexStatement } from '../engine/aramexStatementParser.js';
import { parseSmsaStatement, sniffStatementCarrier } from '../engine/smsaStatementParser.js';
import { parseStatementWithAI } from '../engine/aiStatementParser.js';
import { saveCarrierStatement, loadExistingOpsByDocNos, loadOpenBalance } from '../lib/carrierStatementsService.js';
import { useAuth } from '../lib/auth.jsx';

// ─── Doc-type & shipment-type labels ──────────────────────────────────────
const DOC_TYPE_META = {
  RV:  { label: 'فاتورة',       color: 'var(--accent)' },
  DR:  { label: 'مدين إضافي',   color: 'var(--gold)'   },
  DG:  { label: 'إشعار دائن',   color: 'var(--green)'  },
  AB:  { label: 'تعديل',        color: 'var(--muted)'  },
  COD: { label: 'تحصيل/شحن COD', color: 'var(--accent)' },  // سمسا
  CM:  { label: 'إشعار دائن',   color: 'var(--green)'  },    // سمسا credit memo
};
const SHIPMENT_TYPE_LABEL = {
  domestic:           'محلي',
  domestic_other:     'محلي (DCF)',
  international_in:   'دولي وارد',
  international_out:  'دولي صادر',
};

const fmt = n => (n == null || Number.isNaN(n))
  ? '—'
  : Number(n).toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Carrier IDs that have a deterministic, non-AI parser. We auto-detect AI for
// every other carrier (or names that look like Aramex but use a different id).
const FAST_PARSER_IDS = new Set(['aramex']);
const isFastParser = (id) => FAST_PARSER_IDS.has(id) || /aramex|أرامكس|ارامكس/i.test(id ?? '');

// Module-level (NOT useRef): PageSlot keeps the page mounted and StrictMode
// double-fires effects in dev — a ref would reset between mounts (§2.2).
const CONSUMED_STATEMENT_IMPORTS = new Set();

export default function CarrierStatements({ carriers = [] }) {
  const { user } = useAuth();
  // Default carrier = first one configured by the admin.
  const initialId   = carriers[0]?.id   || '';
  const initialName = carriers[0]?.name || '';
  const [carrierId,   setCarrierId]   = useState(initialId);
  const [carrierName, setCarrierName] = useState(initialName);
  const [customName,  setCustomName]  = useState('');
  // Carrier-workspace scoping: /aramex-statements?carrier=X preselects the
  // carrier and shows the workspace tab bar. Depends on location (not [])
  // because PageSlot keeps the page mounted across navigations.
  const location = useLocation();
  const fromWorkspace = location.pathname === '/aramex-statements'
    && !!new URLSearchParams(location.search).get('carrier');
  useEffect(() => {
    if (location.pathname !== '/aramex-statements') return;
    const wanted = new URLSearchParams(location.search).get('carrier');
    if (!wanted) return;
    const found = carriers.find(c => c.id === wanted);
    if (found) { setCarrierId(found.id); setCarrierName(found.name); }
  }, [location.pathname, location.search, carriers]);
  const [state, setState] = useState('idle');     // idle | processing | done | error
  const [errorMsg, setErrorMsg] = useState('');
  const [result, setResult] = useState(null);      // { header, operations, totals, fileName, carrierId, carrierName, parserUsed }
  const [drag, setDrag] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [saving, setSaving] = useState(false);
  const [savedDiff, setSavedDiff] = useState(null); // { added, updated, reviewing, unchanged }
  // Pre-import ledger balance for this carrier — lets us show the operator
  // whether the carrier's claimed Total Balance matches what OUR books
  // computed BEFORE they commit the statement (balance-level reconciliation).
  const [preBalance, setPreBalance] = useState(null);
  const [aiStatus, setAiStatus] = useState('');
  // Map<doc_no, existing-op> populated after parser finishes. Drives the
  // "new / unchanged / changed" badges so the user sees deltas without
  // having to commit first. null means "we haven't checked yet".
  const [existingMap, setExistingMap] = useState(null);
  const [deltaLoading, setDeltaLoading] = useState(false);

  const processFile = useCallback(async (file) => {
    if (!file) return;
    const effectiveId   = carrierId === '__custom' ? customName.trim() : carrierId;
    const effectiveName = carrierId === '__custom' ? customName.trim() : carrierName;
    if (!effectiveId) {
      setErrorMsg('اختر شركة أولاً');
      setState('error');
      return;
    }
    setState('processing');
    setErrorMsg('');
    setAiStatus('');
    try {
      // Content-sniff which carrier actually issued this PDF so we route to
      // the right deterministic parser even if the operator picked the
      // wrong carrier in the dropdown. Falls back to the selected carrier's
      // id/name when sniffing is inconclusive. (Each parser gets a FRESH
      // arrayBuffer — pdfjs detaches the one it reads.)
      const sniff = await sniffStatementCarrier(await file.arrayBuffer());
      const wantSmsa   = sniff === 'smsa'
        || /smsa|سمسا/i.test(effectiveId) || /smsa|سمسا/i.test(effectiveName);
      const wantAramex = sniff === 'aramex'
        || isFastParser(effectiveId) || isFastParser(effectiveName);
      let parsed, parserUsed;

      if (wantSmsa) {
        parsed = await parseSmsaStatement(await file.arrayBuffer());
        parserUsed = 'smsa';
        if (parsed.operations.length === 0) {
          setAiStatus('✨ قارئ سمسا لم يلتقط شيئاً — يجرّب AI الآن...');
          parsed = await parseStatementWithAI(await file.arrayBuffer(), { carrierHint: effectiveName });
          parserUsed = 'ai-fallback';
        }
      } else if (wantAramex) {
        parsed = await parseAramexStatement(await file.arrayBuffer());
        parserUsed = 'aramex';
        if (parsed.operations.length === 0) {
          setAiStatus('✨ القارئ السريع لم يلتقط شيئاً — يجرّب AI الآن...');
          parsed = await parseStatementWithAI(await file.arrayBuffer(), { carrierHint: effectiveName });
          parserUsed = 'ai-fallback';
        }
      } else {
        setAiStatus('✨ AI يقرأ الكشف ويستخرج العمليات...');
        parsed = await parseStatementWithAI(await file.arrayBuffer(), { carrierHint: effectiveName });
        parserUsed = 'ai';
      }

      // Auto-route by statement account number. A carrier may declare its
      // account(s) in file_signature.statement_accounts (e.g. SMSA has two:
      // RX5251 = COD محلي/دولي → "سمسا", RX8668 = الفروع → "سمسا - فروع").
      // If the parsed account belongs to a DIFFERENT carrier, route there so
      // the two accounts never merge into one ledger.
      let routedId = effectiveId, routedName = effectiveName;
      const acct = parsed?.header?.accountNumber;
      if (acct && Array.isArray(carriers)) {
        const match = carriers.find(c =>
          (c.file_signature?.statement_accounts || []).includes(acct));
        if (match && match.id !== effectiveId) {
          routedId = match.id; routedName = match.name;
          toast(`وُجّه تلقائياً لـ«${match.name}» (حساب ${acct})`, 'info');
        }
      }

      setResult({ ...parsed, fileName: file.name, file, carrierId: routedId, carrierName: routedName, parserUsed });
      setState('done');
      toast(`تم استخراج ${parsed.operations.length} عملية` +
        (parserUsed.startsWith('ai') ? ' عبر AI' : ''), 'success');
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || 'تعذّر قراءة كشف الحساب');
      setState('error');
    }
    setAiStatus('');
  }, [carrierId, carrierName, customName, carriers]);

  // Smart-drop handoff: /drop stashes the statement bytes in sessionStorage
  // ('statementImport') then navigates here — same stash + pathname-listener
  // pattern as the webhook imports (§1.5). Module-level consumed-set guards
  // StrictMode double-fire; location dep because PageSlot keeps us mounted.
  useEffect(() => {
    if (location.pathname !== '/aramex-statements') return;
    let raw;
    try { raw = sessionStorage.getItem('statementImport'); } catch { return; }
    if (!raw) return;
    let payload;
    try { payload = JSON.parse(raw); } catch { sessionStorage.removeItem('statementImport'); return; }
    if (!payload?.base64 || !payload?.filename) return;
    if (CONSUMED_STATEMENT_IMPORTS.has(payload.filename)) return;
    CONSUMED_STATEMENT_IMPORTS.add(payload.filename);
    sessionStorage.removeItem('statementImport');
    try {
      const bin = atob(payload.base64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const file = new File([arr], payload.filename, { type: 'application/pdf' });
      if (payload.carrierId) {
        const found = carriers.find(c => c.id === payload.carrierId);
        if (found) { setCarrierId(found.id); setCarrierName(found.name); }
      }
      toast(`جارٍ تحليل الكشف: ${payload.filename}`, 'info');
      processFile(file);
    } catch (err) {
      CONSUMED_STATEMENT_IMPORTS.delete(payload.filename);
      toast(`فشل استيراد الكشف: ${err.message}`, 'error');
    }
  }, [location.pathname, processFile, carriers]);

  const handleDrop = (e) => {
    e.preventDefault();
    setDrag(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) processFile(file);
  };
  const handlePick = (e) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = '';
  };
  const reset = () => {
    setState('idle');
    setResult(null);
    setSearch('');
    setFilter('all');
    setErrorMsg('');
    setSavedDiff(null);
  };

  const handleSave = async () => {
    if (!result) return;
    setSaving(true);
    try {
      const { diff } = await saveCarrierStatement({
        carrierId:   result.carrierId   || carrierId,
        carrierName: result.carrierName || carrierName,
        fileName:    result.fileName,
        file:        result.file,
        parsed:      result,
        userId:      user?.id,
      });
      setSavedDiff(diff);
      toast(
        `تم الحفظ — ${diff.added} جديدة، ${diff.updated} محدّثة، ${diff.reviewing} تحت المراجعة`,
        'success',
      );
    } catch (e) {
      console.error(e);
      toast(`فشل الحفظ: ${e.message}`, 'error');
    }
    setSaving(false);
  };

  // After parsing, look up which doc_nos already exist in the ledger so
  // the preview can label each row 'new' / 'unchanged' / 'changed' before
  // commit. Saves the user from clicking save just to discover most rows
  // were already there.
  useEffect(() => {
    if (!result?.operations?.length || !result.carrierId) {
      setExistingMap(null);
      setPreBalance(null);
      return;
    }
    let cancelled = false;
    setDeltaLoading(true);
    const docNos = result.operations.map(o => String(o.docNo)).filter(Boolean);
    loadExistingOpsByDocNos(result.carrierId, docNos)
      .then(map => { if (!cancelled) setExistingMap(map); })
      .catch(() => { if (!cancelled) setExistingMap(new Map()); })
      .finally(() => { if (!cancelled) setDeltaLoading(false); });
    // Our current ledger balance for this carrier (pre-import) — for the
    // statement-vs-books reconciliation banner.
    loadOpenBalance(result.carrierId)
      .then(b => { if (!cancelled) setPreBalance(b?.balance ?? null); })
      .catch(() => { if (!cancelled) setPreBalance(null); });
    return () => { cancelled = true; };
  }, [result]);

  // Per-op delta classification. 'unchanged' = same doc_no + same
  // dr/cr (within 0.01 SAR); 'changed' = same doc_no but different
  // amount (will become reviewing on save); 'new' = first time.
  const deltaOf = useCallback((op) => {
    if (!existingMap) return 'unknown';
    const prior = existingMap.get(String(op.docNo));
    if (!prior) return 'new';
    // Settled ops (paid/partial) are FROZEN — re-importing never alters
    // them, so they're not "changed" even if the carrier restated the
    // amount/type across statement versions.
    if (prior.status === 'paid' || prior.status === 'partial') return 'frozen';
    const drDiff = Math.abs(Number(prior.amount_dr ?? 0) - Number(op.dr ?? 0));
    const crDiff = Math.abs(Number(prior.amount_cr ?? 0) - Number(op.cr ?? 0));
    return (drDiff > 0.01 || crDiff > 0.01) ? 'changed' : 'unchanged';
  }, [existingMap]);

  const deltaCounts = useMemo(() => {
    const c = { all: 0, new: 0, changed: 0, unchanged: 0, frozen: 0 };
    if (!result?.operations || !existingMap) return c;
    for (const op of result.operations) {
      c.all++;
      c[deltaOf(op)]++;
    }
    return c;
  }, [result, existingMap, deltaOf]);

  // When delta lands and there ARE existing ops, default the filter to
  // 'new' so the user sees the truly fresh rows first. If everything is
  // new (first upload for this carrier), keep 'all' since 'new' would
  // be the same set anyway and 'all' is more familiar.
  useEffect(() => {
    if (!existingMap) return;
    if (deltaCounts.unchanged + deltaCounts.changed > 0 && filter === 'all') {
      setFilter('new');
    }
  }, [existingMap, deltaCounts, filter]);

  // ── Derived ────────────────────────────────────────────────────────────
  const breakdown = useMemo(() => {
    if (!result) return { rv: 0, dr: 0, dg: 0, ab: 0 };
    return result.operations.reduce((acc, o) => {
      acc[o.docType.toLowerCase()] = (acc[o.docType.toLowerCase()] ?? 0) + 1;
      return acc;
    }, { rv: 0, dr: 0, dg: 0, ab: 0 });
  }, [result]);

  const filtered = useMemo(() => {
    if (!result) return [];
    let out = result.operations;
    // Doc-type filters (RV / DR / DG / AB)
    if (['RV','DR','DG','AB'].includes(filter)) {
      out = out.filter(o => o.docType === filter);
    }
    // Synthetic delta filters — only meaningful once existingMap loaded
    else if (filter === 'new'       && existingMap) out = out.filter(o => deltaOf(o) === 'new');
    else if (filter === 'changed'   && existingMap) out = out.filter(o => deltaOf(o) === 'changed');
    else if (filter === 'unchanged' && existingMap) out = out.filter(o => deltaOf(o) === 'unchanged');
    else if (filter === 'frozen'    && existingMap) out = out.filter(o => deltaOf(o) === 'frozen');
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter(o =>
        String(o.docNo).toLowerCase().includes(q)
        || String(o.referenceNo).toLowerCase().includes(q)
      );
    }
    return out;
  }, [result, filter, search, existingMap, deltaOf]);

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '32px 40px 80px', maxWidth: 1300, margin: '0 auto' }}>
      {fromWorkspace && (
        <CarrierTabs carrierId={carrierId} carrierName={carrierName} active="statements"/>
      )}
      <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 18, marginBottom: 4 }}>
        📑 رفع كشف <span style={{ color: 'var(--accent)' }}>حساب</span>
      </h2>
      <p style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 18 }}>
        اختر الشركة من شركاتك المُعرّفة وارفع ملف PDF.
      </p>

      {/* IDLE — carrier picker + drop zone */}
      {state === 'idle' && (
        <>
          <Card style={{ marginBottom: 14, padding: 14 }}>
            {carriers.length === 0 ? (
              <div style={{ padding: '12px 4px', fontSize: 13, color: 'var(--muted)' }}>
                لم تُعرَّف أي شركة شحن بعد.
                {' '}
                <a href="/carriers" style={{ color: 'var(--accent)' }}>أضف شركة من إدارة شركات الشحن</a>
                {' '}قبل رفع كشف.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: carrierId === '__custom' ? '1fr 1fr' : '1fr', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginBottom: 5 }}>الشركة</div>
                  <select
                    value={carrierId}
                    onChange={e => {
                      const v = e.target.value;
                      setCarrierId(v);
                      if (v === '__custom') return;
                      const found = carriers.find(c => c.id === v);
                      if (found) setCarrierName(found.name);
                    }}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, fontSize: 16 }}
                  >
                    {carriers.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.logo ? `${c.logo} ` : ''}{c.name}
                      </option>
                    ))}
                    <option value="__custom">+ شركة أخرى (مرة واحدة)</option>
                  </select>
                </div>
                {carrierId === '__custom' && (
                  <Input
                    label="اسم الشركة (يُحفَظ مع الكشف)"
                    value={customName}
                    onChange={e => setCustomName(e.target.value)}
                    placeholder="مثال: DHL Express"
                  />
                )}
              </div>
            )}
          </Card>

          <div
            onDragOver={e => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={handleDrop}
            onClick={() => document.getElementById('cs-file').click()}
            style={{
              border: `2px dashed ${drag ? 'var(--accent)' : 'var(--border2)'}`,
              borderRadius: 14, padding: '54px 24px', textAlign: 'center',
              background: drag ? 'rgba(45,212,191,.05)' : 'var(--surface)',
              cursor: 'pointer', transition: 'all .2s',
            }}
          >
            <Upload size={42} color="var(--muted)" style={{ marginBottom: 12 }}/>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>اسحب ملف كشف الحساب هنا</div>
            <div style={{ color: 'var(--muted)', fontSize: 12 }}>
              PDF · ستحلَّل تلقائياً ({(isFastParser(carrierId) || isFastParser(carrierName)
                || /smsa|سمسا/i.test(carrierId) || /smsa|سمسا/i.test(carrierName))
                ? 'قارئ سريع'
                : <>AI <Sparkles size={11} style={{ display: 'inline' }}/></>})
            </div>
            <input id="cs-file" type="file" accept=".pdf" style={{ display: 'none' }} onChange={handlePick}/>
          </div>
        </>
      )}

      {state === 'processing' && (
        <Card style={{ padding: 64, textAlign: 'center' }}>
          <Spinner size={36}/>
          <div style={{ color: 'var(--muted)', marginTop: 12, fontSize: 13 }}>
            {aiStatus || 'جارٍ قراءة الكشف...'}
          </div>
        </Card>
      )}

      {state === 'error' && (
        <Card>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <AlertCircle size={22} color="var(--red)" style={{ flexShrink: 0, marginTop: 2 }}/>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>تعذّر قراءة الملف</div>
              <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 14 }}>{errorMsg}</div>
              <Btn variant="primary" onClick={reset}>محاولة أخرى</Btn>
            </div>
          </div>
        </Card>
      )}

      {state === 'done' && result && (
        <>
          {/* Header card */}
          <Card style={{ marginBottom: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px,1fr))', gap: 18 }}>
              <KV label="العميل"           value={result.header.customer || '—'}/>
              <KV label="رقم الحساب"        value={result.header.accountNumber || '—'} mono/>
              <KV label="الفترة"            value={`${result.header.periodFrom || '—'} ← ${result.header.periodTo || '—'}`} mono/>
              <KV label="مدة الاستحقاق"     value={result.header.creditTerms || '—'}/>
              <KV label="الرقم الضريبي"      value={result.header.vatNo || '—'} mono/>
              <KV label="الملف"              value={result.fileName}/>
            </div>
          </Card>

          {/* Stat cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px,1fr))', gap: 12, marginBottom: 14 }}>
            <Stat label="الرصيد الإجمالي"   value={fmt(result.totals.totalBalance)} suffix="ر.س" color="var(--accent)" big/>
            <Stat label="حتى 30 يوم"       value={fmt(result.totals.aging?.d0_30)}  suffix="ر.س" color="var(--green)"/>
            <Stat label="31 إلى 60 يوم"   value={fmt(result.totals.aging?.d31_60)} suffix="ر.س" color="var(--gold)"/>
            <Stat label="61 إلى 90 يوم"   value={fmt(result.totals.aging?.d61_90)} suffix="ر.س" color="var(--warn)"/>
            <Stat label="فوق 90 يوم"      value={fmt(result.totals.aging?.over90)} suffix="ر.س" color="var(--red)"/>
          </div>

          {/* Balance reconciliation — statement's claimed total vs our books.
              Surfaces the gap BEFORE committing so the operator knows whether
              the carrier's view matches ours. */}
          {result.totals.totalBalance != null && preBalance != null && (() => {
            const stmt = Number(result.totals.totalBalance) || 0;
            const ours = Number(preBalance) || 0;
            const gap  = +(stmt - ours).toFixed(2);
            const aligned = Math.abs(gap) <= 0.5;
            return (
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px,1fr))', gap: 12,
                padding: '14px 16px', marginBottom: 14, borderRadius: 12,
                background: aligned ? 'rgba(16,185,129,.06)' : 'rgba(245,158,11,.06)',
                border: `1px solid ${aligned ? 'var(--green)' : 'var(--gold)'}`,
              }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, marginBottom: 3 }}>رصيد الكشف (الناقل)</div>
                  <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{fmt(stmt)} ر.س</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, marginBottom: 3 }}>رصيد دفترنا (قبل الاستيراد)</div>
                  <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{fmt(ours)} ر.س</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, marginBottom: 3 }}>الفرق</div>
                  <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-mono)', color: aligned ? 'var(--green)' : 'var(--gold)' }}>
                    {aligned ? '✓ مطابق' : `${gap > 0 ? '+' : ''}${fmt(gap)} ر.س`}
                  </div>
                </div>
                {!aligned && (
                  <div style={{ gridColumn: '1 / -1', fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6 }}>
                    الناقل يطالب بـ {fmt(Math.abs(gap))} ر.س {gap > 0 ? 'أكثر' : 'أقل'} مما يحسبه دفترنا.
                    راجع العمليات أدناه (الملوّنة «جديدة» غير موجودة في دفترنا) قبل الحفظ.
                  </div>
                )}
              </div>
            );
          })()}

          {/* Toolbar */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            {!savedDiff && (
              <Btn variant="primary" icon={saving ? <Spinner size={12}/> : <Save size={14}/>}
                onClick={handleSave} disabled={saving}>
                {saving
                  ? 'جارٍ الحفظ...'
                  : existingMap && (deltaCounts.unchanged + deltaCounts.changed > 0)
                    ? `حفظ ${deltaCounts.new} جديدة + تحديث ${deltaCounts.changed + deltaCounts.unchanged}`
                    : 'حفظ في الدفتر'
                }
              </Btn>
            )}
            <Btn variant="ghost" icon={<Trash2 size={14}/>} onClick={reset}>كشف جديد</Btn>
            <span style={{ color: 'var(--muted)', fontSize: 11, marginRight: 8, fontFamily: 'var(--font-mono)' }}>
              العمليات ({result.operations.length}) — RV {breakdown.rv} | DR {breakdown.dr} | DG {breakdown.dg} | AB {breakdown.ab}
            </span>
          </div>

          {/* Delta summary — only when at least some ops are already in
              the ledger (otherwise everything is new and chips are noise). */}
          {existingMap && (deltaCounts.unchanged + deltaCounts.changed > 0) && (
            <div style={{
              background: 'linear-gradient(135deg, rgba(45,212,191,.10), rgba(45,212,191,.02))',
              border: '1px solid var(--accent)', borderRadius: 9,
              padding: '9px 14px', marginBottom: 12,
              display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center',
              fontSize: 12,
            }}>
              <span style={{ fontWeight: 700, color: 'var(--accent)' }}>
                {deltaCounts.all} عملية:
              </span>
              <span><span style={{ color: 'var(--green)', fontWeight: 700 }}>🆕 {deltaCounts.new}</span> جديدة</span>
              <span><span style={{ color: 'var(--muted)', fontWeight: 700 }}>✓ {deltaCounts.unchanged}</span> موجودة</span>
              {deltaCounts.changed > 0 && (
                <span><span style={{ color: 'var(--gold)', fontWeight: 700 }}>🔄 {deltaCounts.changed}</span> متغيّرة</span>
              )}
              <span style={{ marginRight: 'auto', color: 'var(--muted)', fontSize: 11 }}>
                المعروض حالياً: {filter === 'new' ? '🆕 الجديدة فقط' : filter === 'changed' ? '🔄 المتغيّرة فقط' : filter === 'unchanged' ? '✓ الموجودة' : 'الكل'}
              </span>
            </div>
          )}
          {deltaLoading && (
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Spinner size={11}/> جارٍ مقارنة العمليات مع الدفتر...
            </div>
          )}

          {savedDiff && (
            <div style={{
              background: 'rgba(52,211,153,.08)', border: '1px solid rgba(52,211,153,.25)',
              borderRadius: 9, padding: '10px 14px', marginBottom: 12, fontSize: 12,
              color: 'var(--green)', display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center',
            }}>
              <span>✓ تم الحفظ في الدفتر</span>
              <span>✚ {savedDiff.added} جديدة</span>
              <span>✎ {savedDiff.updated} محدّثة</span>
              {savedDiff.reviewing > 0 && (
                <span style={{ color: 'var(--gold)' }}>
                  ⚠ {savedDiff.reviewing} تحت المراجعة (مبلغ تغيّر بعد التسديد/التدقيق)
                </span>
              )}
              <span style={{ color: 'var(--muted)' }}>· {savedDiff.unchanged} بدون تغيير</span>
              <a href={`/ledger?carrier=${result?.carrierId || carrierId}`} style={{
                marginRight: 'auto', color: 'var(--accent)', textDecoration: 'underline', fontSize: 12,
              }}>
                افتح الدفتر لإدارة الحالات وربط المراجعات →
              </a>
            </div>
          )}

          {/* Filter tabs — delta filters appear only when applicable */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            {[
              { k: 'all', l: `الكل (${result.operations.length})` },
              ...(existingMap && deltaCounts.new > 0 && (deltaCounts.unchanged + deltaCounts.changed > 0)
                ? [{ k: 'new', l: `🆕 جديدة (${deltaCounts.new})`, accent: 'var(--green)' }] : []),
              ...(existingMap && deltaCounts.changed > 0
                ? [{ k: 'changed', l: `🔄 متغيّرة (${deltaCounts.changed})`, accent: 'var(--gold)' }] : []),
              ...(existingMap && deltaCounts.unchanged > 0
                ? [{ k: 'unchanged', l: `✓ موجودة (${deltaCounts.unchanged})`, accent: 'var(--muted)' }] : []),
              ...(existingMap && deltaCounts.frozen > 0
                ? [{ k: 'frozen', l: `🔒 مثبّتة (${deltaCounts.frozen})`, accent: '#0EA5E9' }] : []),
              { k: 'RV',  l: `فواتير (${breakdown.rv})` },
              { k: 'DR',  l: `مدين (${breakdown.dr})` },
              { k: 'DG',  l: `دائن (${breakdown.dg})` },
              { k: 'AB',  l: `تعديلات (${breakdown.ab})` },
            ].map(t => {
              const active = filter === t.k;
              const accent = t.accent || 'var(--accent)';
              return (
                <button key={t.k} onClick={() => setFilter(t.k)} style={{
                  background: active ? `${accent}20` : 'transparent',
                  border: `1px solid ${active ? accent : 'var(--border)'}`,
                  color: active ? accent : 'var(--muted)',
                  borderRadius: 7, padding: '5px 13px', cursor: 'pointer',
                  fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 600,
                }}>{t.l}</button>
              );
            })}
          </div>

          {/* Search */}
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <Search size={14} style={{ position: 'absolute', right: 12, top: 11, color: 'var(--muted)' }}/>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="بحث برقم المستند أو المرجع..."
              style={{ width: '100%', padding: '9px 36px 9px 12px', borderRadius: 9, fontSize: 13 }}
            />
          </div>

          {/* Table */}
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ maxHeight: 600, overflowY: 'auto' }}>
              {filtered.length === 0
                ? <Empty icon="🔍" title="لا توجد عمليات مطابقة"/>
                : (
                  <table style={{ fontSize: 12, width: '100%' }}>
                    <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--surface)' }}>
                      <tr>
                        {existingMap && <th style={{ minWidth: 70 }}>الحالة</th>}
                        <th style={{ minWidth: 60 }}>النوع</th>
                        <th style={{ minWidth: 110 }}>رقم المستند</th>
                        <th style={{ minWidth: 200 }}>المرجع</th>
                        <th style={{ minWidth: 90 }}>تاريخ المستند</th>
                        <th style={{ minWidth: 90 }}>تاريخ الاستحقاق</th>
                        <th style={{ minWidth: 110 }}>مدين</th>
                        <th style={{ minWidth: 110 }}>دائن</th>
                        <th style={{ minWidth: 110 }}>الرصيد</th>
                        <th style={{ minWidth: 100 }}>نوع الشحنة</th>
                        <th style={{ minWidth: 90 }}>الحالة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((o, i) => {
                        const meta = DOC_TYPE_META[o.docType] ?? DOC_TYPE_META.RV;
                        const delta = existingMap ? deltaOf(o) : null;
                        const deltaMeta = delta === 'new'
                          ? { label: '🆕 جديدة', color: 'var(--green)' }
                          : delta === 'changed'
                            ? { label: '🔄 متغيّرة', color: 'var(--gold)' }
                            : delta === 'unchanged'
                              ? { label: '✓ موجودة', color: 'var(--muted)' }
                              : delta === 'frozen'
                                ? { label: '🔒 مثبّتة (مسدّدة)', color: '#0EA5E9' }
                                : null;
                        return (
                          <tr key={i} style={delta === 'new' ? { background: 'rgba(52,211,153,.04)' } : undefined}>
                            {existingMap && (
                              <td>
                                {deltaMeta && (
                                  <span style={{
                                    background: `${deltaMeta.color}20`,
                                    border: `1px solid ${deltaMeta.color}40`,
                                    color: deltaMeta.color, fontSize: 10, fontWeight: 700,
                                    padding: '2px 8px', borderRadius: 12,
                                    fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap',
                                  }}>
                                    {deltaMeta.label}
                                  </span>
                                )}
                              </td>
                            )}
                            <td>
                              <span style={{
                                background: `${meta.color}20`, border: `1px solid ${meta.color}40`,
                                color: meta.color, fontSize: 10, fontWeight: 700,
                                padding: '2px 8px', borderRadius: 12, fontFamily: 'var(--font-mono)',
                                whiteSpace: 'nowrap',
                              }}>
                                {o.docType} · {meta.label}
                              </span>
                            </td>
                            <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}>
                              {o.docNo}
                            </td>
                            <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>
                              {o.referenceNo}
                            </td>
                            <td style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{o.docDate || '—'}</td>
                            <td style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{o.dueDate || '—'}</td>
                            <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: o.dr > 0 ? 'var(--red)' : 'var(--muted3)' }}>
                              {o.dr > 0 ? fmt(o.dr) : ''}
                            </td>
                            <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: o.cr < 0 ? 'var(--green)' : 'var(--muted3)' }}>
                              {o.cr < 0 ? fmt(Math.abs(o.cr)) : ''}
                            </td>
                            <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{fmt(o.balance)}</td>
                            <td style={{ fontSize: 11 }}>
                              {o.shipmentType ? SHIPMENT_TYPE_LABEL[o.shipmentType] : '—'}
                            </td>
                            <td>
                              <Badge status="unknown" label={o.docType === 'RV' ? '⏳ معلّقة' : '—'}/>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )
              }
            </div>
          </Card>

          <p style={{ marginTop: 14, color: 'var(--muted)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
            <FileText size={12} style={{ display: 'inline', marginLeft: 4 }}/>
            المرحلة 1A — العمليات تُستخرج وتُعرض فقط (ما تنحفظ في DB بعد). المراحل التالية: حفظ + رفع الفواتير + التدقيق التلقائي.
          </p>
        </>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────
function KV({ label, value, mono }) {
  return (
    <div>
      <div style={{ color: 'var(--muted)', fontSize: 10, fontFamily: 'var(--font-mono)', marginBottom: 3 }}>{label}</div>
      <div style={{
        fontSize: 13, fontWeight: 600,
        fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{value}</div>
    </div>
  );
}

function Stat({ label, value, suffix, color, big }) {
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 11, padding: '13px 16px',
    }}>
      <div style={{ color: 'var(--muted)', fontSize: 10, fontFamily: 'var(--font-mono)', marginBottom: 3 }}>
        {label}
      </div>
      <div style={{
        color, fontSize: big ? 22 : 16,
        fontFamily: 'var(--font-mono)', fontWeight: 700,
        whiteSpace: 'nowrap',
      }}>
        {value}
        {suffix && <span style={{ fontSize: 10, color: 'var(--muted)', marginRight: 4 }}> {suffix}</span>}
      </div>
    </div>
  );
}

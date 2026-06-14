import { useState, useMemo, useCallback, useEffect } from 'react';
import { Upload, Download, Trash2, Search, Wallet, Calendar, AlertCircle, Link2, CheckCircle2 } from 'lucide-react';
import { Card, Btn, Modal, Spinner, Empty, toast } from '../components/UI.jsx';
import { parseExcelFile, generateCleanExcel, extractCarrierPayments } from '../engine/bankStatementProcessor.js';
import { suggestPaymentMatches, markOperationsPaid } from '../lib/carrierStatementsService.js';
import { loadCarriers } from '../lib/coreService.js';

// ── State machine: idle → processing → done | error ──
const fmtMoney = n =>
  (n == null || Number.isNaN(n))
    ? '—'
    : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Carrier aliases used for description matching (extends what's in the carrier name field)
const CARRIER_ALIASES = {
  aramex: ['أرامكس', 'ارامكس', 'aramex', 'ARAMEX', 'aramex saudi'],
  smsa:   ['سمسا', 'smsa', 'SMSA'],
};

export default function BankStatement() {
  const [state, setState] = useState('idle');           // idle | processing | done | error
  const [errorMsg, setErrorMsg] = useState('');
  const [result, setResult] = useState(null);            // { transactions, summary, hiddenFees, fileName }
  const [drag, setDrag]     = useState(false);
  const [search, setSearch] = useState('');
  const [carriers, setCarriers] = useState([]);
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [reconciledTxIds, setReconciledTxIds] = useState(new Set()); // tx index → matched

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
  }, []);

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
      debit:  sumDebit + sumFeesRemoved + (result.hiddenFees ?? 0),
      credit: sumCredit,
      fees:   sumFeesRemoved + (result.hiddenFees ?? 0),
    };
  }, [result]);

  const filtered = useMemo(() => {
    if (!result) return [];
    if (!search.trim()) return result.transactions;
    const q = search.trim().toLowerCase();
    return result.transactions.filter(t =>
      String(t.reference).toLowerCase().includes(q)
      || String(t.description).toLowerCase().includes(q)
    );
  }, [result, search]);

  // ── Export ────────────────────────────────────────────────────────────────
  const handleExport = () => {
    if (!result) return;
    try {
      const bytes = generateCleanExcel(result.transactions, result.summary);
      const blob  = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url   = URL.createObjectURL(blob);
      const a     = document.createElement('a');
      a.href      = url;
      a.download  = `كشف_حساب_صافي_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast('تم تصدير الكشف الصافي ✓', 'success');
    } catch (e) {
      toast(`خطأ في التصدير: ${e.message}`, 'error');
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '32px 40px 80px', maxWidth: 1200, margin: '0 auto' }}>
      <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 18, marginBottom: 4 }}>
        💼 كشف <span style={{ color: 'var(--accent)' }}>الحساب</span>
      </h2>
      <p style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 24 }}>
        ارفع كشف بنكي (Excel) ليتم استخراج العمليات وفصل الرسوم والضريبة عن المبلغ الأساسي.
      </p>

      {/* IDLE — drop zone */}
      {state === 'idle' && (
        <div
          onDragOver={e => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={handleDrop}
          onClick={() => document.getElementById('bs-file').click()}
          style={{
            border: `2px dashed ${drag ? 'var(--accent)' : 'var(--border2)'}`,
            borderRadius: 14, padding: '64px 24px', textAlign: 'center',
            background: drag ? 'rgba(45,212,191,.05)' : 'var(--surface)',
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
              <div style={{ display: 'flex', gap: 24 }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>الرصيد الختامي</div>
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

          {/* Stat cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 14 }}>
            <StatBlock label="إجمالي العمليات"   value={totals.count}             color="var(--accent)" mono/>
            <StatBlock label="إجمالي المدين"     value={fmtMoney(totals.debit)}   color="var(--red)"   suffix="ر.س"/>
            <StatBlock label="إجمالي الدائن"     value={fmtMoney(totals.credit)}  color="var(--green)" suffix="ر.س"/>
            <StatBlock label="إجمالي الرسوم المخصومة" value={fmtMoney(totals.fees)} color="var(--gold)"  suffix="ر.س"/>
          </div>

          {/* Toolbar */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <Btn variant="primary" icon={<Download size={14}/>} onClick={handleExport}>
              تحميل الكشف الصافي
            </Btn>
            {carrierTransfers.length > 0 && (
              <Btn variant="gold" icon={<Link2 size={14}/>} onClick={() => setReconcileOpen(true)}>
                💼 مطابقة الموردين ({carrierTransfers.length})
              </Btn>
            )}
            <Btn variant="ghost" icon={<Trash2 size={14}/>} onClick={reset}>
              ملف جديد
            </Btn>
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
            <div style={{ maxHeight: 600, overflowY: 'auto' }}>
              {filtered.length === 0
                ? <Empty icon="🔍" title="لا توجد عمليات مطابقة" sub="جرب نص بحث مختلف"/>
                : (
                  <table style={{ fontSize: 12, width: '100%' }}>
                    <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--surface)' }}>
                      <tr>
                        <th style={{ minWidth: 90 }}>التاريخ</th>
                        <th style={{ minWidth: 130 }}>الرقم المرجعي</th>
                        <th>الوصف</th>
                        <th style={{ minWidth: 90 }}>دائن</th>
                        <th style={{ minWidth: 90 }}>مدين (صافي)</th>
                        <th style={{ minWidth: 70 }}>الرسوم</th>
                        <th style={{ minWidth: 70 }}>الضريبة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((t, i) => (
                        <tr key={i}>
                          <td style={{ color: 'var(--muted)', fontSize: 11, whiteSpace: 'nowrap' }}>{t.date || '—'}</td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', whiteSpace: 'nowrap' }}>
                            {t.reference || '—'}
                          </td>
                          <td style={{ fontSize: 12, maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {t.description}
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--green)', fontWeight: 600 }}>
                            {t.credit != null ? fmtMoney(t.credit) : ''}
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--red)', fontWeight: 600 }}>
                            {t.debit != null && t.debit !== 0 ? fmtMoney(t.debit) : ''}
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--gold)' }}>
                            {t.fees > 0 ? t.fees.toFixed(2) : ''}
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
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

      {reconcileOpen && (
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
    <Modal title="💼 مطابقة دفعات الموردين" onClose={onClose} width={780}>
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
                        <Btn size="sm" variant="success" disabled={busyIdx === idx} onClick={() => confirm(row, idx)}>
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
function StatBlock({ label, value, color, suffix, mono }) {
  return (
    <div style={{
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

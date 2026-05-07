import { useState, useMemo, useCallback } from 'react';
import { Upload, Download, Trash2, Search, Wallet, Calendar, AlertCircle } from 'lucide-react';
import { Card, Btn, Spinner, Empty, toast } from '../components/UI.jsx';
import { parseExcelFile, generateCleanExcel } from '../engine/bankStatementProcessor.js';

// ── State machine: idle → processing → done | error ──
const fmtMoney = n =>
  (n == null || Number.isNaN(n))
    ? '—'
    : Number(n).toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function BankStatement() {
  const [state, setState] = useState('idle');           // idle | processing | done | error
  const [errorMsg, setErrorMsg] = useState('');
  const [result, setResult] = useState(null);            // { transactions, summary, hiddenFees, fileName }
  const [drag, setDrag]     = useState(false);
  const [search, setSearch] = useState('');

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
    <div style={{ padding: '32px 24px', maxWidth: 1200, margin: '0 auto' }}>
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
            background: drag ? 'rgba(56,189,248,.05)' : 'var(--surface)',
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
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <Btn variant="primary" icon={<Download size={14}/>} onClick={handleExport}>
              تحميل الكشف الصافي
            </Btn>
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
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────
function StatBlock({ label, value, color, suffix, mono }) {
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 11, padding: '13px 16px',
      borderTop: `3px solid ${color}`,
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

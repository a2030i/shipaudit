// «سجلات زوهو» /zoho-data — تصفّح احترافي لكل مرايا Zoho Books:
// فواتير/دفعات العملاء · المصاريف (فيها الرواتب بحساب «أجور الموظفين») ·
// فواتير/دفعات الموردين · القيود اليومية. قراءة فقط — المرايا تتغذى من
// zoho-sync (دلتا) ولا تُعدَّل هنا أبداً.

import { useState, useEffect, useMemo, useCallback } from 'react';
import { RefreshCw, Search, Database, Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import { rtl } from '../lib/xlsxRtl.js';
import { Card, Btn, Spinner, Empty, toast, PageHeader } from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import { ZOHO_MIRRORS, loadZohoMirror, syncZohoDocs, currentPnlPeriod,
  loadZohoInvoiceDashboard, zohoStatusAr } from '../lib/pnlService.js';

const fmt = (n) => (n == null || Number.isNaN(n)) ? '—'
  : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthLabel = (p) => {
  const [y, m] = p.split('-');
  const names = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  return `${names[+m - 1] || m} ${y}`;
};
// آخر 12 شهراً كخيارات
const monthOptions = () => {
  const out = [];
  const d = new Date();
  for (let i = 0; i < 12; i++) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
};

// أعمدة العرض لكل نوع (label + مفتاح + نوع القيمة)
const COLS = {
  invoices: [
    ['التاريخ', 'date'], ['الرقم', 'invoice_number', 'mono'], ['العميل', 'customer_name', 'main'],
    ['الحالة', 'status'], ['المبلغ', 'total', 'money'], ['المتبقي', 'balance', 'money-warn'],
  ],
  payments: [
    ['التاريخ', 'date'], ['العميل', 'customer_name', 'main'], ['الطريقة', 'mode'],
    ['الفواتير', 'invoice_numbers', 'mono'], ['المبلغ', 'amount', 'money-green'],
  ],
  expenses: [
    ['التاريخ', 'date'], ['الحساب', 'account_name', 'main'], ['المورد', 'vendor_name'],
    ['الوصف', 'description'], ['المبلغ', 'total', 'money'],
  ],
  bills: [
    ['التاريخ', 'date'], ['الرقم', 'bill_number', 'mono'], ['المورد', 'vendor_name', 'main'],
    ['الاستحقاق', 'due_date'], ['الحالة', 'status'], ['المبلغ', 'total', 'money'], ['المتبقي', 'balance', 'money-warn'],
  ],
  vendor_payments: [
    ['التاريخ', 'date'], ['المورد', 'vendor_name', 'main'], ['الطريقة', 'mode'],
    ['المرجع', 'reference_number', 'mono'], ['المبلغ', 'amount', 'money'],
  ],
  journals: [
    ['التاريخ', 'date'], ['القيد', 'entry_number', 'mono'], ['المرجع', 'reference_number', 'mono'],
    ['الملاحظات', 'notes', 'main'], ['المبلغ', 'total', 'money'],
  ],
};

export default function ZohoData({ isActive = true }) {
  const { can } = useAuth();
  const [type, setType] = useState('invoices');
  const [dash, setDash] = useState(null);
  const [period, setPeriod] = useState(currentPnlPeriod());
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');       // فلتر الحالة
  const [amtMin, setAmtMin] = useState('');        // نطاق المبلغ
  const [amtMax, setAmtMax] = useState('');
  const [sort, setSort] = useState({ col: 'date', dir: 'desc' });

  // إعادة ضبط الفلاتر عند تغيير النوع (الحالات تختلف)
  useEffect(() => { setStatus(''); setAmtMin(''); setAmtMax(''); setSort({ col: 'date', dir: 'desc' }); }, [type]);

  const load = useCallback(async (t, p) => {
    setRows(null);
    try { setRows(await loadZohoMirror(t, { period: p || null })); }
    catch (e) { toast(`فشل التحميل: ${e.message}`, 'error'); setRows([]); }
  }, []);
  useEffect(() => { if (isActive) load(type, period); }, [isActive, type, period, load]);

  // لوحة الفواتير (كل الأشهر) — تُحمَّل مرة عند دخول تبويب الفواتير
  useEffect(() => {
    if (!isActive || type !== 'invoices') { setDash(null); return; }
    let live = true;
    loadZohoInvoiceDashboard().then(d => { if (live) setDash(d); }).catch(() => {});
    return () => { live = false; };
  }, [isActive, type]);

  const doSync = async () => {
    setBusy(true);
    try {
      const r = await syncZohoDocs();
      const parts = Object.entries(r.results || r).filter(([k]) => k !== 'ok')
        .map(([k, v]) => `${ZOHO_MIRRORS[k === 'customerpayments' ? 'payments' : k === 'vendorpayments' ? 'vendor_payments' : k]?.label?.replace(/^[^\s]+\s/, '') || k}: ${v}`);
      toast(`مزامنة: ${parts.join(' · ')}`, 'success');
      load(type, period);
    } catch (e) { toast(`فشل المزامنة: ${e.message}`, 'error'); }
    setBusy(false);
  };

  const cfg = ZOHO_MIRRORS[type];
  const cols = COLS[type];

  // الحالات المتاحة فعلياً في البيانات المحمّلة (ديناميكي لكل نوع)
  const statuses = useMemo(() => {
    if (!rows) return [];
    return [...new Set(rows.map(r => r.status).filter(Boolean))].sort();
  }, [rows]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    let list = rows;
    const s = q.trim().toLowerCase();
    if (s) list = list.filter(r => Object.values(r).some(v => String(v ?? '').toLowerCase().includes(s)));
    if (status) list = list.filter(r => r.status === status);
    const min = amtMin === '' ? null : Number(amtMin);
    const max = amtMax === '' ? null : Number(amtMax);
    if (min != null || max != null) {
      list = list.filter(r => {
        const v = Number(r[cfg.amount]) || 0;
        return (min == null || v >= min) && (max == null || v <= max);
      });
    }
    // الترتيب بالعمود المختار (نصّي أو رقمي)
    const { col, dir } = sort;
    const numeric = ['total', 'amount', 'balance'].includes(col);
    return [...list].sort((a, b) => {
      let av = a[col], bv = b[col];
      if (numeric) { av = Number(av) || 0; bv = Number(bv) || 0; }
      else { av = String(av ?? ''); bv = String(bv ?? ''); }
      const cmp = numeric ? av - bv : av.localeCompare(bv, 'ar');
      return dir === 'asc' ? cmp : -cmp;
    });
  }, [rows, q, status, amtMin, amtMax, sort, cfg]);

  const filtersActive = !!(q.trim() || status || amtMin || amtMax);
  const toggleSort = (col) => setSort(s => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: col === 'date' ? 'desc' : 'asc' });
  const total = useMemo(() => +filtered.reduce((s, r) => s + (Number(r[cfg.amount]) || 0), 0).toFixed(2), [filtered, cfg]);
  const totalBalance = useMemo(() => +filtered.reduce((s, r) => s + (Number(r.balance) || 0), 0).toFixed(2), [filtered]);

  const exportXlsx = () => {
    if (!filtered.length) return;
    const aoa = [
      [`سجلات زوهو — ${cfg.label.replace(/^[^\s]+\s/, '')}${period ? ` — ${monthLabel(period)}` : ''}`],
      [],
      cols.map(c => c[0]),
      ...filtered.map(r => cols.map(c => c[1] === 'status' ? zohoStatusAr(r[c[1]]) : (r[c[1]] ?? ''))),
      [],
      ['الإجمالي', ...Array(cols.length - 2).fill(''), total],
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = cols.map(() => ({ wch: 18 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'سجلات');
    XLSX.writeFile(rtl(wb), `زوهو_${type}_${period || 'الكل'}.xlsx`);
    toast(`صُدّر ${filtered.length} سجلاً ✓`, 'success');
  };

  if (!can('money.pnl')) return <div style={{ padding: 40 }}><Empty icon="🔒" title="لا صلاحية" sub="تحتاج صلاحية «الوضع المالي»"/></div>;

  return (
    <div style={{ padding: '20px 26px 70px', maxWidth: 1360, margin: '0 auto' }}>
      <PageHeader icon={<Database size={22}/>} iconColor="#0EA5E9"
        title="سجلات زوهو"
        subtitle="كل ما يقرؤه الربط من Zoho Books — فواتير · دفعات · مصاريف (فيها الرواتب) · قيود"
        actions={
          <Btn size="sm" variant="ghost" icon={busy ? <Spinner size={13}/> : <RefreshCw size={14}/>} disabled={busy} onClick={doSync}>
            مزامنة من زوهو
          </Btn>
        }/>

      {/* مبدّل الأنواع */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {Object.entries(ZOHO_MIRRORS).map(([id, m]) => (
          <Btn key={id} size="sm" variant={type === id ? 'primary' : 'outline'} onClick={() => setType(id)}>
            {m.label}
          </Btn>
        ))}
      </div>

      {/* لوحة الفواتير — نظرة شهرية + أعلى المدينين */}
      {type === 'invoices' && dash && <InvoiceDashboard dash={dash} onPick={setQ}/>}

      {/* الفلاتر */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        <select value={period} onChange={e => setPeriod(e.target.value)} title="الفترة"
          style={{ padding: '7px 10px', borderRadius: 8, fontSize: 12.5 }}>
          <option value="">كل الفترات (حتى 5000)</option>
          {monthOptions().map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        {statuses.length > 0 && (
          <select value={status} onChange={e => setStatus(e.target.value)} title="الحالة"
            style={{ padding: '7px 10px', borderRadius: 8, fontSize: 12.5 }}>
            <option value="">كل الحالات</option>
            {statuses.map(s => <option key={s} value={s}>{zohoStatusAr(s)}</option>)}
          </select>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input value={amtMin} onChange={e => setAmtMin(e.target.value)} type="number" placeholder="مبلغ من"
            style={{ width: 90, padding: '7px 8px', borderRadius: 8, fontSize: 12, fontFamily: 'var(--font-mono)' }}/>
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>
          <input value={amtMax} onChange={e => setAmtMax(e.target.value)} type="number" placeholder="إلى"
            style={{ width: 90, padding: '7px 8px', borderRadius: 8, fontSize: 12, fontFamily: 'var(--font-mono)' }}/>
        </div>
        <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
          <Search size={14} style={{ position: 'absolute', right: 12, top: 9, color: 'var(--muted)' }}/>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="بحث بالعميل/المورد/الرقم/أي حقل…"
            style={{ width: '100%', padding: '8px 36px 8px 12px', borderRadius: 8, fontSize: 13 }}/>
        </div>
        {filtersActive && (
          <Btn size="sm" variant="ghost" onClick={() => { setQ(''); setStatus(''); setAmtMin(''); setAmtMax(''); }}>
            مسح الفلاتر
          </Btn>
        )}
        <Btn size="sm" variant="ghost" icon={<Download size={13}/>} onClick={exportXlsx} disabled={!filtered.length}>
          تصدير
        </Btn>
      </div>
      {rows != null && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
          عرض <b style={{ color: 'var(--text)' }}>{filtered.length}</b>{filtersActive ? ` من ${rows.length}` : ''} سجل ·
          الإجمالي <b style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{fmt(total)}</b> ر.س
          {cfg.amount === 'balance' || COLS[type].some(c => c[1] === 'balance')
            ? <> · المتبقي <b style={{ color: 'var(--gold)', fontFamily: 'var(--font-mono)' }}>{fmt(totalBalance)}</b> ر.س</> : null}
        </div>
      )}

      {rows == null ? <Card style={{ padding: 50, textAlign: 'center' }}><Spinner size={24}/></Card>
        : !filtered.length ? (
          <Card><Empty icon="📭" title="لا سجلات"
            sub={rows.length ? 'جرّب بحثاً مختلفاً' : 'اضغط «مزامنة من زوهو» — أو أعد الموافقة بالصلاحيات الموسّعة إن كان النوع جديداً'}/></Card>
        ) : (
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <div className="m-flow" style={{ maxHeight: 640, overflowY: 'auto' }}>
              <table className="m-cards" style={{ width: '100%', fontSize: 12.5 }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--surface)' }}>
                  <tr>{cols.map(c => {
                    const active = sort.col === c[1];
                    return (
                      <th key={c[0]} onClick={() => toggleSort(c[1])} title="ترتيب"
                        style={{ padding: '10px 12px', fontSize: 11, color: active ? 'var(--accent)' : 'var(--muted)',
                          whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}>
                        {c[0]}{active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                      </th>
                    );
                  })}</tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 800).map(r => (
                    <tr key={r.zoho_id} style={{ borderTop: '1px solid var(--border)' }}>
                      {cols.map(([label, key, kind]) => (
                        <td key={key} data-label={kind === 'main' ? '' : label}
                          style={{
                            padding: '9px 12px',
                            ...(kind === 'mono' ? { fontFamily: 'var(--font-mono)', fontSize: 11 } : {}),
                            ...(kind === 'main' ? { fontWeight: 600 } : {}),
                            ...(kind?.startsWith('money') ? {
                              fontFamily: 'var(--font-mono)', fontWeight: 600, whiteSpace: 'nowrap',
                              color: kind === 'money-green' ? 'var(--green)'
                                   : kind === 'money-warn' ? (Number(r[key]) > 0.5 ? 'var(--gold)' : 'var(--muted2)')
                                   : 'var(--text)',
                            } : {}),
                            ...(key === 'description' || key === 'notes' ? { maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : {}),
                          }}>
                          {kind?.startsWith('money') ? fmt(r[key])
                            : key === 'status' ? <StatusPill status={r[key]}/>
                            : (r[key] ?? '—')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filtered.length > 800 && (
              <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--muted)' }}>
                عرض أول 800 من {filtered.length} — ضيّق الفترة أو ابحث، والتصدير يشمل الكل
              </div>
            )}
          </Card>
        )}

      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 12, textAlign: 'center' }}>
        قراءة فقط — أي تعديل يتم في Zoho Books نفسه ثم «مزامنة». الرواتب: نوع «المصاريف» ← حساب «أجور الموظفين».
      </div>
    </div>
  );
}

// شارة حالة ملوّنة معرّبة
const STATUS_TONE = {
  paid: 'green', unpaid: 'gold', overdue: 'red', draft: 'muted',
  sent: 'accent', partially_paid: 'gold', partiallypaid: 'gold', void: 'muted', voided: 'muted',
};
function StatusPill({ status }) {
  if (!status) return <span style={{ color: 'var(--muted2)' }}>—</span>;
  const tone = STATUS_TONE[String(status).toLowerCase().trim()] || 'muted';
  const col = { green: 'var(--green)', gold: 'var(--gold)', red: 'var(--red)', accent: 'var(--accent)', muted: 'var(--muted)' }[tone];
  return (
    <span style={{
      display: 'inline-block', padding: '2px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700,
      color: col, background: `color-mix(in srgb, ${col} 13%, transparent)`, whiteSpace: 'nowrap',
    }}>{zohoStatusAr(status)}</span>
  );
}

// لوحة نظرة عامة على فواتير العملاء
function InvoiceDashboard({ dash, onPick }) {
  const names = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  const ml = (ym) => { const [y, m] = String(ym).split('-'); return `${names[+m - 1] || m} ${y}`; };
  const kpis = [
    { label: 'إجمالي غير المدفوع (باقٍ)', val: dash.openAr, sub: `${dash.openCnt} فاتورة مفتوحة`, tone: 'gold' },
    { label: 'متأخّرة عن السداد', val: dash.overdueAmt, sub: `${dash.overdueCnt} فاتورة`, tone: 'red' },
    { label: 'مسودّات', val: dash.draftTotal, sub: `${dash.draftCnt} فاتورة لم تُرسَل`, tone: 'muted' },
  ];
  const toneCol = { gold: 'var(--gold)', red: 'var(--red)', muted: 'var(--muted)' };
  return (
    <Card style={{ padding: 14, marginBottom: 12 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10, marginBottom: 14 }}>
        {kpis.map(k => (
          <div key={k.label} style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--surface2)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{k.label}</div>
            <div style={{ fontSize: 19, fontWeight: 800, fontFamily: 'var(--font-mono)', color: toneCol[k.tone] }}>{fmt(k.val)}</div>
            <div style={{ fontSize: 10.5, color: 'var(--muted2)', marginTop: 2 }}>{k.sub}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 16 }}>
        {/* شهرياً */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>غير المدفوع شهرياً</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {dash.monthly.slice(0, 7).map(m => {
              const rem = Number(m.remaining) || 0, tot = Number(m.total) || 1;
              const pct = Math.min(100, Math.round((rem / tot) * 100));
              return (
                <div key={m.ym} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5 }}>
                  <span style={{ width: 78, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{ml(m.ym)}</span>
                  <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--surface2)', overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: rem > 0.5 ? 'var(--gold)' : 'var(--green)' }}/>
                  </div>
                  <span style={{ width: 78, textAlign: 'left', fontFamily: 'var(--font-mono)', fontWeight: 700,
                    color: rem > 0.5 ? 'var(--gold)' : 'var(--muted2)' }}>{fmt(rem)}</span>
                </div>
              );
            })}
          </div>
        </div>
        {/* أعلى المدينين */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>أكثر العملاء ديناً (غير مسدّد)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {dash.debtors.slice(0, 8).map((d, i) => (
              <button key={d.cust} onClick={() => onPick(d.cust)} title="اعرض فواتير هذا العميل"
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', border: 'none',
                  background: 'transparent', cursor: 'pointer', textAlign: 'right', borderRadius: 6, width: '100%' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <span style={{ width: 16, color: 'var(--muted2)', fontSize: 11 }}>{i + 1}</span>
                <span style={{ flex: 1, fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.cust}</span>
                <span style={{ fontSize: 10, color: 'var(--muted2)' }}>{d.open_cnt}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12, color: 'var(--gold)', whiteSpace: 'nowrap' }}>{fmt(d.owed)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

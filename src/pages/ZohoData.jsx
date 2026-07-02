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
import { ZOHO_MIRRORS, loadZohoMirror, syncZohoDocs, currentPnlPeriod } from '../lib/pnlService.js';

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
  const [type, setType] = useState('expenses');
  const [period, setPeriod] = useState(currentPnlPeriod());
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (t, p) => {
    setRows(null);
    try { setRows(await loadZohoMirror(t, { period: p || null })); }
    catch (e) { toast(`فشل التحميل: ${e.message}`, 'error'); setRows([]); }
  }, []);
  useEffect(() => { if (isActive) load(type, period); }, [isActive, type, period, load]);

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

  const filtered = useMemo(() => {
    if (!rows) return [];
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(r => Object.values(r).some(v => String(v ?? '').toLowerCase().includes(s)));
  }, [rows, q]);

  const cfg = ZOHO_MIRRORS[type];
  const cols = COLS[type];
  const total = useMemo(() => +filtered.reduce((s, r) => s + (Number(r[cfg.amount]) || 0), 0).toFixed(2), [filtered, cfg]);

  const exportXlsx = () => {
    if (!filtered.length) return;
    const aoa = [
      [`سجلات زوهو — ${cfg.label.replace(/^[^\s]+\s/, '')}${period ? ` — ${monthLabel(period)}` : ''}`],
      [],
      cols.map(c => c[0]),
      ...filtered.map(r => cols.map(c => r[c[1]] ?? '')),
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

      {/* الفلاتر */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <select value={period} onChange={e => setPeriod(e.target.value)}
          style={{ padding: '7px 10px', borderRadius: 8, fontSize: 12.5 }}>
          <option value="">كل الفترات (حتى 5000)</option>
          {monthOptions().map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: 'absolute', right: 12, top: 9, color: 'var(--muted)' }}/>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="بحث في كل الحقول…"
            style={{ width: '100%', padding: '8px 36px 8px 12px', borderRadius: 8, fontSize: 13 }}/>
        </div>
        <Btn size="sm" variant="ghost" icon={<Download size={13}/>} onClick={exportXlsx} disabled={!filtered.length}>
          تصدير
        </Btn>
        {rows != null && (
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            {filtered.length} سجل · الإجمالي <b style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{fmt(total)}</b> ر.س
          </span>
        )}
      </div>

      {rows == null ? <Card style={{ padding: 50, textAlign: 'center' }}><Spinner size={24}/></Card>
        : !filtered.length ? (
          <Card><Empty icon="📭" title="لا سجلات"
            sub={rows.length ? 'جرّب بحثاً مختلفاً' : 'اضغط «مزامنة من زوهو» — أو أعد الموافقة بالصلاحيات الموسّعة إن كان النوع جديداً'}/></Card>
        ) : (
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <div className="m-flow" style={{ maxHeight: 640, overflowY: 'auto' }}>
              <table className="m-cards" style={{ width: '100%', fontSize: 12.5 }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--surface)' }}>
                  <tr>{cols.map(c => <th key={c[0]} style={{ padding: '10px 12px', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{c[0]}</th>)}</tr>
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
                          {kind?.startsWith('money') ? fmt(r[key]) : (r[key] ?? '—')}
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

// «فلوسي عند العملاء» — شاشة التحصيل الأولى (زوهو المرجع، جوال أولاً).
// سؤال واحد تجيبه: كم لي بالخارج، وعند مَن، وكيف أحصّله الآن؟
// مصدر الحقيقة الواحد: RPC customer_money_dashboard() (قاعدة «رقم واحد
// لكل مفهوم» 2026-07-03) — نفس أرقام /zoho-data ومتابعة العملاء.
// كل بطاقة عميل فيها 📞 اتصال و💬 واتساب مباشرين + فواتيره بنقرة.

import { useState, useEffect, useMemo } from 'react';
import { RefreshCw, Search, Download, Phone, MessageCircle, ChevronDown, HandCoins } from 'lucide-react';
import * as XLSX from 'xlsx';
import { rtl } from '../lib/xlsxRtl.js';
import { Card, Btn, Spinner, Empty, toast, PageHeader } from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import { loadCustomerMoneyDashboard, loadZohoOpenInvoices, zohoStatusAr } from '../lib/pnlService.js';
import { normalizeSaudiPhone } from '../lib/whatsappService.js';
import WhatsAppSendModal from '../components/WhatsAppSendModal.jsx';

const fmt = (n) => (n == null || Number.isNaN(n)) ? '—'
  : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtK = (n) => { const a = Math.abs(n); return a >= 1000 ? (n / 1000).toFixed(1) + 'ك' : String(Math.round(n)); };

// شرائح الأعمار — الترتيب من الأطزج للأخطر
const BUCKETS = [
  { key: 'b0', label: '0–30 يوم',  color: 'var(--green)' },
  { key: 'b1', label: '31–60',     color: 'var(--gold)' },
  { key: 'b2', label: '61–90',     color: '#F97316' },
  { key: 'b3', label: '+90',       color: 'var(--red)' },
];

export default function CustomerMoney({ isActive = true }) {
  const { can, user } = useAuth();
  const [d, setD] = useState(null);
  const [q, setQ] = useState('');
  const [bucket, setBucket] = useState('');        // '' | b0..b3
  const [sortBy, setSortBy] = useState('owed');    // owed | oldest
  const [waOpen, setWaOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    try { setD(await loadCustomerMoneyDashboard()); }
    catch (e) { toast(`فشل التحميل: ${e.message}`, 'error'); setD(prev => prev || { customers: [], aging: {} }); }
    setBusy(false);
  };
  useEffect(() => { if (isActive && d == null) refresh(); }, [isActive]); // eslint-disable-line

  const filtered = useMemo(() => {
    if (!d) return [];
    let list = d.customers;
    if (bucket) list = list.filter(c => (c[bucket] || 0) > 0.5);
    const s = q.trim().toLowerCase();
    if (s) list = list.filter(c =>
      [c.name, c.storeName, c.phone].some(v => String(v ?? '').toLowerCase().includes(s)));
    return [...list].sort((a, b) => sortBy === 'oldest' ? b.oldestDays - a.oldestDays : b.owed - a.owed);
  }, [d, q, bucket, sortBy]);
  const filteredTotal = useMemo(() => +filtered.reduce((s, c) => s + c.owed, 0).toFixed(2), [filtered]);

  const waRecipients = useMemo(() => filtered
    .filter(c => c.phone && c.owed > 0.5)
    .map(c => {
      const name = (c.storeName || c.name || '').trim();
      return {
        to: normalizeSaudiPhone(c.phone), name, amount: c.owed, count: c.invCnt,
        vars: [name, Number(c.owed).toLocaleString('en-US', { maximumFractionDigits: 2 }), String(c.invCnt)],
      };
    }), [filtered]);

  const exportXlsx = () => {
    if (!filtered.length) return;
    const aoa = [
      ['فلوسي عند العملاء — زوهو المرجع', '', new Date().toISOString().slice(0, 10)],
      [],
      ['العميل', 'المتجر', 'الهاتف', 'المستحق', 'متأخر', 'فواتير', 'أقدم (يوم)', '0-30', '31-60', '61-90', '+90', 'آخر دفعة', 'مبلغها'],
      ...filtered.map(c => [c.name, c.storeName || '', c.phone || '', c.owed, c.overdue, c.invCnt,
        c.oldestDays, c.b0, c.b1, c.b2, c.b3, c.lastPaymentDate || '', c.lastPaymentAmount || '']),
      [],
      ['الإجمالي', '', '', filteredTotal],
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = aoa[2].map((_, i) => ({ wch: i === 0 ? 32 : 12 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'فلوسي عند العملاء');
    XLSX.writeFile(rtl(wb), `فلوسي_عند_العملاء_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast(`صُدّر ${filtered.length} عميلاً ✓`, 'success');
  };

  if (!can('receivables.view')) return <div style={{ padding: 40 }}><Empty icon="🔒" title="لا صلاحية" sub="تحتاج صلاحية «عرض المديونيات»"/></div>;
  if (d == null) return <div style={{ padding: 60, textAlign: 'center' }}><Spinner size={26}/></div>;

  const agingTotal = BUCKETS.reduce((s, b) => s + (d.aging[b.key] || 0), 0) || 1;
  const colDelta = d.collectedPrevMonth > 0
    ? Math.round(((d.collectedThisMonth - d.collectedPrevMonth) / d.collectedPrevMonth) * 100) : null;

  return (
    <div style={{ padding: '18px 20px 80px', maxWidth: 1200, margin: '0 auto' }}>
      <PageHeader icon={<HandCoins size={22}/>} iconColor="var(--green)"
        title="فلوسي عند العملاء"
        subtitle="زوهو المرجع — كم لك بالخارج وكيف تحصّله الآن (نفس أرقام سجلات زوهو)"
        actions={
          <Btn size="sm" variant="ghost" icon={<RefreshCw size={14} className={busy ? 'spin' : ''}/>} onClick={refresh} disabled={busy}>
            تحديث
          </Btn>
        }/>

      {/* ── البطل: كم لك بالخارج ── */}
      <Card style={{ padding: '18px 20px', marginBottom: 12 }}>
        <div className="hero-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 14 }}>
          <div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>💰 لك عند العملاء الآن</div>
            <div style={{ fontSize: 30, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--gold)', lineHeight: 1.2 }}>
              {fmt(d.outstanding)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted2)' }}>{d.outstandingCnt} عميلاً — فواتير زوهو المفتوحة</div>
          </div>
          <div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>⏰ منها متأخّرة</div>
            <div style={{ fontSize: 30, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--red)', lineHeight: 1.2 }}>
              {fmt(d.overdueAmt)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted2)' }}>تجاوزت موعد السداد</div>
          </div>
          <div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>✅ حصّلنا هذا الشهر</div>
            <div style={{ fontSize: 30, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--green)', lineHeight: 1.2 }}>
              {fmt(d.collectedThisMonth)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted2)' }}>
              الشهر الماضي {fmtK(d.collectedPrevMonth)}{colDelta != null ? ` (${colDelta >= 0 ? '+' : ''}${colDelta}%)` : ''}
            </div>
          </div>
        </div>

        {/* شريط الأعمار — اضغط شريحة لفلترة العملاء */}
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 6 }}>أعمار الدين — اضغط شريحة لعرض عملائها</div>
          <div style={{ display: 'flex', height: 26, borderRadius: 8, overflow: 'hidden', cursor: 'pointer' }}>
            {BUCKETS.map(b => {
              const v = d.aging[b.key] || 0;
              const pct = Math.max((v / agingTotal) * 100, v > 0.5 ? 6 : 0);
              if (pct === 0) return null;
              const active = bucket === b.key;
              return (
                <div key={b.key} title={`${b.label}: ${fmt(v)} ر.س`}
                  onClick={() => setBucket(active ? '' : b.key)}
                  style={{ width: `${pct}%`, background: b.color, display: 'flex', alignItems: 'center',
                    justifyContent: 'center', color: '#fff', fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap',
                    overflow: 'hidden', outline: active ? '2.5px solid var(--text)' : 'none', outlineOffset: -2 }}>
                  {pct > 12 ? `${b.label} · ${fmtK(v)}` : ''}
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
            {BUCKETS.map(b => (
              <span key={b.key} onClick={() => setBucket(bucket === b.key ? '' : b.key)}
                style={{ fontSize: 10.5, color: bucket === b.key ? 'var(--text)' : 'var(--muted)', cursor: 'pointer',
                  fontWeight: bucket === b.key ? 800 : 500 }}>
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: b.color, marginInlineEnd: 4 }}/>
                {b.label}: {fmt(d.aging[b.key] || 0)}
              </span>
            ))}
          </div>
        </div>
      </Card>

      {/* ── أدوات القائمة ── */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 170 }}>
          <Search size={14} style={{ position: 'absolute', right: 12, top: 10, color: 'var(--muted)' }}/>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="ابحث بالعميل/المتجر/الهاتف…"
            style={{ width: '100%', padding: '9px 36px 9px 12px', borderRadius: 8, fontSize: 13 }}/>
        </div>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ padding: '8px 10px', borderRadius: 8, fontSize: 12.5 }}>
          <option value="owed">الأكبر ديناً أولاً</option>
          <option value="oldest">الأقدم ديناً أولاً</option>
        </select>
        {can('collections.view') && (
          <Btn size="sm" variant="accent" icon={<MessageCircle size={13}/>} onClick={() => waRecipients.length ? setWaOpen(true) : toast('لا مستلمين بأرقام في القائمة الحالية', 'info')}>
            حملة واتساب ({waRecipients.length})
          </Btn>
        )}
        <Btn size="sm" variant="ghost" icon={<Download size={13}/>} onClick={exportXlsx} disabled={!filtered.length}>تصدير</Btn>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 10 }}>
        عرض <b style={{ color: 'var(--text)' }}>{filtered.length}</b> من {d.customers.length} عميلاً
        {bucket ? ` — شريحة ${BUCKETS.find(b => b.key === bucket)?.label}` : ''} ·
        إجمالي المعروض <b style={{ color: 'var(--gold)', fontFamily: 'var(--font-mono)' }}>{fmt(filteredTotal)}</b> ر.س
      </div>

      {/* ── بطاقات العملاء ── */}
      {!filtered.length ? <Card><Empty icon="🎉" title="لا ديون في هذا العرض" sub="جرّب فلتراً آخر"/></Card> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(330px,100%),1fr))', gap: 10 }}>
          {filtered.map(c => <CustomerCard key={c.name} c={c} highlight={bucket}/>)}
        </div>
      )}

      <WhatsAppSendModal open={waOpen} onClose={() => setWaOpen(false)}
        recipients={waOpen ? waRecipients : []}
        bucketLabel={bucket ? `أعمار ${BUCKETS.find(b => b.key === bucket)?.label}` : 'فلوسي عند العملاء'}/>
    </div>
  );
}

// بطاقة عميل — الاسم والمبلغ وأزرار الفعل، وفواتيره بنقرة
function CustomerCard({ c, highlight }) {
  const [open, setOpen] = useState(false);
  const [invs, setInvs] = useState(null);
  const digits = String(c.phone || '').replace(/\D/g, '');
  const wa = digits ? `https://wa.me/${digits.startsWith('05') ? '966' + digits.slice(1) : digits}` : null;
  const tel = digits ? `tel:+${digits.startsWith('05') ? '966' + digits.slice(1) : digits}` : null;

  const toggleInvoices = async () => {
    const next = !open;
    setOpen(next);
    if (next && invs == null) {
      try { setInvs(await loadZohoOpenInvoices(c.name)); }
      catch { setInvs([]); }
    }
  };

  const ageColor = c.oldestDays > 90 ? 'var(--red)' : c.oldestDays > 60 ? '#F97316' : c.oldestDays > 30 ? 'var(--gold)' : 'var(--green)';

  return (
    <Card style={{ padding: '13px 15px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {c.storeName || c.name}
          </div>
          {c.storeName && c.storeName !== c.name && (
            <div style={{ fontSize: 10.5, color: 'var(--muted2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
          )}
        </div>
        <div style={{ textAlign: 'left' }}>
          <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--gold)', whiteSpace: 'nowrap' }}>{fmt(c.owed)}</div>
          <div style={{ fontSize: 9.5, color: 'var(--muted2)' }}>ر.س مستحقة</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 10.5 }}>
        <Chip color={ageColor}>أقدم فاتورة {c.oldestDays} يوم</Chip>
        <Chip color="var(--muted)">{c.invCnt} فاتورة</Chip>
        {c.lastPaymentDate
          ? <Chip color="var(--green)">آخر دفعة {c.lastPaymentDate} ({fmtK(c.lastPaymentAmount)})</Chip>
          : <Chip color="var(--red)">لم يدفع شيئاً بعد</Chip>}
      </div>

      {/* شريط أعمار مصغّر */}
      <div style={{ display: 'flex', height: 5, borderRadius: 3, overflow: 'hidden', background: 'var(--surface2)' }}>
        {BUCKETS.map(b => {
          const v = c[b.key] || 0;
          if (v <= 0.5) return null;
          return <div key={b.key} style={{ width: `${(v / c.owed) * 100}%`, background: b.color,
            opacity: !highlight || highlight === b.key ? 1 : 0.25 }}/>;
        })}
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {tel && (
          <a href={tel} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            padding: '8px 0', borderRadius: 8, background: 'var(--surface2)', border: '1px solid var(--border)',
            color: 'var(--text)', textDecoration: 'none', fontSize: 12, fontWeight: 700 }}>
            <Phone size={13}/> اتصال
          </a>
        )}
        {wa && (
          <a href={wa} target="_blank" rel="noreferrer" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            padding: '8px 0', borderRadius: 8, background: 'color-mix(in srgb, var(--green) 12%, transparent)',
            border: '1px solid color-mix(in srgb, var(--green) 35%, transparent)',
            color: 'var(--green)', textDecoration: 'none', fontSize: 12, fontWeight: 700 }}>
            <MessageCircle size={13}/> واتساب
          </a>
        )}
        {!digits && <span style={{ flex: 1, textAlign: 'center', fontSize: 11, color: 'var(--muted2)' }}>لا هاتف — اربط المتجر في /merchants</span>}
        <button onClick={toggleInvoices} title="الفواتير المفتوحة"
          style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '8px 10px', borderRadius: 8,
            background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', cursor: 'pointer', fontSize: 11.5 }}>
          الفواتير <ChevronDown size={12} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}/>
        </button>
      </div>

      {open && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          {invs == null ? <div style={{ textAlign: 'center', padding: 8 }}><Spinner size={16}/></div>
            : !invs.length ? <div style={{ fontSize: 11, color: 'var(--muted2)' }}>لا فواتير مفتوحة</div>
            : invs.map(inv => (
              <div key={inv.invoice_number} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', fontSize: 11.5 }}>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>{inv.invoice_number}</span>
                <span style={{ color: 'var(--muted2)' }}>{inv.date}</span>
                <span style={{ marginInlineStart: 'auto', fontSize: 10, color: 'var(--muted)' }}>{zohoStatusAr(inv.status)}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{fmt(inv.balance)}</span>
              </div>
            ))}
        </div>
      )}
    </Card>
  );
}

function Chip({ color, children }) {
  return (
    <span style={{ padding: '2px 8px', borderRadius: 999, fontWeight: 700, whiteSpace: 'nowrap',
      color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}>
      {children}
    </span>
  );
}

// Merchants directory page.
//
// Single home for the merchant data uploaded from the operational
// platform. Hosts:
//   • the snapshot upload modal (stores.xlsx → merchants table)
//   • headline KPIs (total, prepaid vs postpaid, active, new signups,
//     dormant, churned, wallets piling up)
//   • a searchable/filterable merchant table
//   • a one-click "auto-link" action that maps every receivables
//     customer to a merchant via fuzzy match
//
// Downstream pages (CustomerReceivables) read the data via the
// merchantsService and don't need their own upload UI.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import {
  Upload, RefreshCw, Download, Search, Users, ShoppingBag,
  CheckCircle2, AlertTriangle, Wallet, TrendingUp, ZapOff,
  Link as LinkIcon, X, Phone,
} from 'lucide-react';
import { Card, Btn, Spinner, Empty, Modal, toast } from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  parseStoresFile, uploadMerchantsSnapshot, loadLatestMerchants,
  computeMerchantInsights, autoLinkCustomers,
} from '../lib/merchantsService.js';
import { supabase } from '../lib/supabase.js';

const fmt = (n) =>
  (n == null || Number.isNaN(n)) ? '—'
  : Number(n).toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtCount = (n) =>
  (n == null) ? '—' : Number(n).toLocaleString('ar-SA');

const fmtDate = (iso) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('ar-SA', { year:'numeric', month:'2-digit', day:'2-digit' }); }
  catch { return iso; }
};

const daysAgo = (iso) => {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso)) / 86_400_000);
};

// ── Hero ────────────────────────────────────────────────────────
function Hero({ insights, snapshot }) {
  return (
    <div style={{
      position: 'relative',
      padding: '22px 28px', marginBottom: 18,
      borderRadius: 'var(--r-lg)',
      background: 'linear-gradient(135deg, #1B1E54 0%, #262A6E 55%, #2DD4BF 130%)',
      color: '#fff',
      overflow: 'hidden',
      boxShadow: '0 10px 32px rgba(27,30,84,.25)',
    }}>
      <div style={{ position: 'absolute', left: -50, top: -50, width: 240, height: 240, opacity: .07, pointerEvents: 'none' }}>
        <svg viewBox="0 0 64 64" fill="none">
          <path d="M32 6 L54 18 L54 46 L32 58 L10 46 L10 18 Z" fill="#fff"/>
        </svg>
      </div>
      <div style={{ position:'relative', display:'grid', gridTemplateColumns:'auto 1fr auto auto auto auto', gap:18, alignItems:'center' }}>
        <ShoppingBag size={36} style={{ opacity: .55 }}/>
        <div>
          <div style={{ fontSize:11, fontFamily:'var(--font-mono)', letterSpacing:3, textTransform:'uppercase', opacity:.7 }}>
            LAMHA · MERCHANT DIRECTORY
          </div>
          <h1 style={{ fontFamily:'var(--font-sans)', fontSize:22, fontWeight:800, color:'#fff', margin:0, marginTop:4 }}>
            متاجر المنصّة
          </h1>
          {snapshot && (
            <div style={{ fontSize:11, opacity:.75, marginTop:4 }}>
              snapshot {snapshot.id} · رُفع {fmtDate(snapshot.uploadedAt)}
            </div>
          )}
        </div>
        <HeroStat label="إجمالي" value={fmtCount(insights.total)} big/>
        <HeroStat label="نشط" value={fmtCount(insights.active)} color="#86EFAC"/>
        <HeroStat label="دفع مسبق" value={fmtCount(insights.prepaid)}/>
        <HeroStat label="دفع لاحق" value={fmtCount(insights.postpaid)} color="#FBBF24"/>
      </div>
    </div>
  );
}

function HeroStat({ label, value, big, color }) {
  return (
    <div style={{
      paddingInline: 16, paddingBlock: 6,
      borderInlineStart: '1px solid rgba(255,255,255,.18)',
      minWidth: big ? 110 : 90,
    }}>
      <div style={{ fontSize:10, opacity:.65, fontFamily:'var(--font-mono)', letterSpacing:2, textTransform:'uppercase', whiteSpace:'nowrap' }}>
        {label}
      </div>
      <div style={{
        fontSize: big ? 22 : 17, fontWeight: 800,
        color: color || '#fff', fontFamily: 'var(--font-mono)',
        marginTop: 2, whiteSpace: 'nowrap',
      }}>
        {value}
      </div>
    </div>
  );
}

// ── Insight cards ──────────────────────────────────────────────
function InsightGrid({ insights }) {
  const cards = [
    { k:'newLast30',     label:'جدد آخر 30 يوم',   value: insights.newLast30,     icon: TrendingUp,  color:'#10B981' },
    { k:'neverShipped',  label:'لم يشحن أبداً',     value: insights.neverShipped,  icon: AlertTriangle, color:'#EF4444', hint: 'تسرّب funnel' },
    { k:'dormantActive', label:'نشط بلا حركة +60', value: insights.dormantActive, icon: ZapOff,      color:'#F59E0B' },
    { k:'churned',       label:'فُقدوا (شحن ثم توقّف)', value: insights.churned,    icon: ZapOff,      color:'#7A82C4', hint: 'مرشحون لإعادة الاسترداد' },
    { k:'walletPiles',   label:'محافظ راكدة (+60ي)', value: `${fmtCount(insights.walletPilesUp)} · ${fmt(insights.walletPilesAmount)} ر.س`, icon: Wallet, color:'#F97316', raw: true, hint: 'رصيد دون نشاط' },
    { k:'walletTotal',   label:'إجمالي أرصدة المحافظ', value: `${fmt(insights.walletTotal)} ر.س`, icon: Wallet, color:'#3B82F6', raw: true },
  ];
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: 10, marginBottom: 14,
    }}>
      {cards.map(c => {
        const Icon = c.icon;
        return (
          <Card key={c.k} style={{ padding:'14px 18px', borderTop:`2px solid ${c.color}` }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:10, color:'var(--muted)', fontFamily:'var(--font-mono)', letterSpacing:2, textTransform:'uppercase' }}>
              <Icon size={12} color={c.color}/>
              {c.label}
            </div>
            <div style={{ fontSize: c.raw ? 16 : 22, fontWeight:800, color:c.color, fontFamily:'var(--font-mono)', marginTop:4 }}>
              {c.raw ? c.value : fmtCount(c.value)}
            </div>
            {c.hint && (
              <div style={{ fontSize:10.5, color:'var(--muted)', marginTop:3 }}>{c.hint}</div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ── Top-volume + churned panels ────────────────────────────────
// Two side-by-side mini-tables: the merchants who ship the most
// (focus celebration / retention), and the merchants who were active
// but went inactive (collection priorities + win-back leads).
function MerchantInsightsPanels({ insights }) {
  if (!insights.topByVolume?.length && !insights.churnedTop?.length) return null;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
      gap: 12, marginBottom: 14,
    }}>
      <MiniMerchantTable
        icon={TrendingUp}
        accent="#10B981"
        title={`أعلى ${insights.topByVolume?.length || 0} متجراً بالشحنات`}
        sub="فرص نموّ + علاقات استراتيجية"
        rows={insights.topByVolume || []}
        valueLabel="شحنة"
        valueFn={m => fmtCount(m.shipment_count)}
        emptyMsg="لا يوجد متاجر بشحنات بعد"
      />
      <MiniMerchantTable
        icon={ZapOff}
        accent="#7A82C4"
        title={`فُقدوا (${fmtCount(insights.churned || 0)}) — مرشّحون لاسترداد`}
        sub="مُعطَّلون في المنصّة لكن شحنوا سابقاً"
        rows={insights.churnedTop || []}
        valueLabel="آخر شحنة"
        valueFn={m => m.last_shipment_at ? `${fmtDate(m.last_shipment_at)} · ${daysAgo(m.last_shipment_at)}ي` : '—'}
        emptyMsg="لا يوجد عملاء فقدوا — ممتاز"
      />
    </div>
  );
}

function MiniMerchantTable({ icon: Icon, accent, title, sub, rows, valueLabel, valueFn, emptyMsg }) {
  return (
    <Card style={{ padding: 0, overflow: 'hidden', borderTop: `2px solid ${accent}` }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:10.5, color:'var(--muted)', fontFamily:'var(--font-mono)', letterSpacing:2, textTransform:'uppercase' }}>
          <Icon size={13} color={accent}/>
          {title}
        </div>
        <div style={{ fontSize:11, color:'var(--muted)', marginTop:3 }}>{sub}</div>
      </div>
      <div style={{ maxHeight: 280, overflowY: 'auto' }}>
        {!rows.length ? (
          <div style={{ padding:24, textAlign:'center', fontSize:12, color:'var(--muted)' }}>{emptyMsg}</div>
        ) : (
          <table style={{ width:'100%', fontSize:11.5 }}>
            <tbody>
              {rows.map((m, i) => (
                <tr key={m.id || m.store_id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding:'7px 12px', width: 22, color:'var(--muted)', fontFamily:'var(--font-mono)', fontSize:10 }}>{i + 1}</td>
                  <td style={{ padding:'7px 4px', fontWeight:600, color:'var(--text)' }}>
                    {m.store_name}
                    {m.phone && (
                      <div style={{ fontSize:10, color:'var(--muted)', fontFamily:'var(--font-mono)', direction:'ltr', textAlign:'right', marginTop:1 }}>
                        {m.phone}
                      </div>
                    )}
                  </td>
                  <td style={{ padding:'7px 12px', textAlign:'left', whiteSpace:'nowrap', fontFamily:'var(--font-mono)', fontWeight:700, color: accent, fontSize:11 }}>
                    {valueFn(m)}
                    <div style={{ fontSize:9, color:'var(--muted)', fontWeight:500, letterSpacing:1.5, textTransform:'uppercase' }}>{valueLabel}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}

// ── Upload modal ───────────────────────────────────────────────
function UploadModal({ onClose, onDone, userId }) {
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const handleFile = async (f) => {
    if (!f) return;
    setFile(f); setError(null); setParsed(null); setBusy(true);
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type:'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      // Stale-ref defence
      let mr=0,mc=0;
      for (const k of Object.keys(ws)) { if (k.startsWith('!')) continue; const a = XLSX.utils.decode_cell(k); if (a.r>mr) mr=a.r; if (a.c>mc) mc=a.c; }
      if (mr>0||mc>0) ws['!ref'] = XLSX.utils.encode_range({s:{r:0,c:0},e:{r:mr,c:mc}});
      const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:null, raw:true });
      const out = parseStoresFile(rows);
      setParsed(out);
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const handleSave = async () => {
    if (!parsed) return;
    setBusy(true);
    try {
      const res = await uploadMerchantsSnapshot({
        parsed, sourceFile: file?.name || null, userId,
      });
      toast(`تم رفع ${fmtCount(res.count)} متجر · ${res.prepaid} دفع مسبق · ${res.postpaid} دفع لاحق`, 'success');
      onDone();
    } catch (e) { toast(`فشل: ${e.message}`, 'error'); }
    setBusy(false);
  };

  const counts = useMemo(() => {
    if (!parsed?.rows) return null;
    return {
      total:    parsed.rows.length,
      prepaid:  parsed.rows.filter(r => r.billingType === 'دفع مسبق').length,
      postpaid: parsed.rows.filter(r => r.billingType === 'دفع لاحق').length,
      active:   parsed.rows.filter(r => r.status === 'نشط').length,
    };
  }, [parsed]);

  return (
    <Modal title="رفع كشف المتاجر" onClose={onClose} width={520}>
      {!file && (
        <div
          onClick={() => document.getElementById('merchants-file-input').click()}
          style={{
            padding:32, textAlign:'center', cursor:'pointer',
            border:'2px dashed var(--border2)', borderRadius:12,
            background:'var(--surface)',
          }}
        >
          <Upload size={28} color="var(--accent)" style={{ marginBottom: 8 }}/>
          <div style={{ fontWeight:700, fontSize:13.5 }}>اختر ملف Excel للمتاجر</div>
          <div style={{ fontSize:11, color:'var(--muted)', marginTop:6, lineHeight:1.7 }}>
            الملف لازم يحتوي على رأس فيه «رقم المتجر» و«اسم المتجر». أعمدة الهاتف ونوع الفوترة والحالة اختيارية لكنها مهمة.
          </div>
          <input id="merchants-file-input" type="file" hidden accept=".xlsx,.xls"
            onChange={e => handleFile(e.target.files?.[0])}/>
        </div>
      )}

      {busy && <div style={{ display:'flex', justifyContent:'center', padding:18 }}><Spinner size={22}/></div>}

      {error && (
        <div style={{
          marginTop:12, padding:'10px 14px',
          background:'rgba(239,68,68,.10)',
          border:'1px solid rgba(239,68,68,.35)',
          borderRadius:9, fontSize:12, color:'var(--red)',
        }}>⚠ {error}</div>
      )}

      {parsed && !busy && !error && counts && (
        <>
          <div style={{
            marginTop:12, padding:'12px 14px',
            background:'rgba(45,212,191,.08)',
            border:'1px solid rgba(45,212,191,.35)',
            borderRadius:9, fontSize:12, lineHeight:1.8,
          }}>
            <div style={{ fontWeight:700, color:'var(--accent)', marginBottom:4 }}>✓ تم تحليل الملف</div>
            <Row label="الملف" value={file?.name}/>
            <Row label="إجمالي المتاجر" value={fmtCount(counts.total)} accent/>
            <Row label="دفع مسبق" value={fmtCount(counts.prepaid)}/>
            <Row label="دفع لاحق" value={fmtCount(counts.postpaid)}/>
            <Row label="نشط حالياً" value={fmtCount(counts.active)}/>
          </div>
          <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:14 }}>
            <Btn variant="ghost" onClick={onClose}>إلغاء</Btn>
            <Btn variant="accent" icon={<CheckCircle2 size={14}/>} onClick={handleSave} disabled={busy}>
              حفظ كـ snapshot
            </Btn>
          </div>
        </>
      )}
    </Modal>
  );
}

function Row({ label, value, accent }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', fontSize:12 }}>
      <span style={{ color:'var(--muted)' }}>{label}</span>
      <span style={{ fontWeight: accent ? 800 : 600, color: accent ? 'var(--accent)' : 'var(--text)', fontFamily: 'var(--font-mono)' }}>{value}</span>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────
export default function Merchants({ isActive = true }) {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [data, setData] = useState({ snapshot: null, merchants: [] });
  const [insights, setInsights] = useState(computeMerchantInsights([]));
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');     // all | prepaid | postpaid
  const [filterStatus, setFilterStatus] = useState('all'); // all | active | inactive
  const [showUpload, setShowUpload] = useState(false);
  const [autoLinking, setAutoLinking] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const d = await loadLatestMerchants();
      setData(d);
      setInsights(computeMerchantInsights(d.merchants));
    } catch (e) {
      toast(`فشل التحميل: ${e.message}`, 'error');
    }
    setLoading(false);
  }, []);

  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh, location.pathname]);

  // Click "ربط تلقائي" → pull all distinct customer_names from
  // customer_receivables, run autoLinkCustomers against the current
  // merchants snapshot, report counts.
  const handleAutoLink = async () => {
    if (!data.merchants.length) { toast('ارفع المتاجر أولاً', 'warn'); return; }
    setAutoLinking(true);
    try {
      const { data: names, error } = await supabase
        .from('customer_receivables')
        .select('customer_name')
        .eq('is_summary', true);
      if (error) throw error;
      const distinct = [...new Set((names || []).map(r => r.customer_name).filter(Boolean))];
      const results = await autoLinkCustomers(distinct, data.merchants, { userId: user?.id });
      const matched   = [...results.values()].filter(r => r.storeId).length;
      const unmatched = distinct.length - matched;
      toast(`ربط ${matched}/${distinct.length} عميل (${unmatched} غير مرتبط — يحتاج ربط يدوي)`, 'success');
    } catch (e) {
      toast(`فشل الربط: ${e.message}`, 'error');
    }
    setAutoLinking(false);
  };

  const visible = useMemo(() => {
    let pool = data.merchants;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      pool = pool.filter(m =>
        (m.store_name || '').toLowerCase().includes(q) ||
        (m.store_id || '').toLowerCase().includes(q) ||
        (m.phone || '').includes(q),
      );
    }
    if (filterType !== 'all') {
      const target = filterType === 'prepaid' ? 'دفع مسبق' : 'دفع لاحق';
      pool = pool.filter(m => m.billing_type === target);
    }
    if (filterStatus !== 'all') {
      const target = filterStatus === 'active' ? 'نشط' : 'غير نشط';
      pool = pool.filter(m => m.status === target);
    }
    return [...pool].sort((a, b) => (b.shipment_count || 0) - (a.shipment_count || 0));
  }, [data.merchants, search, filterType, filterStatus]);

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1400 }}>
      <Hero insights={insights} snapshot={data.snapshot}/>

      {/* Action bar */}
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:14, flexWrap:'wrap' }}>
        <div style={{ fontSize:12, color:'var(--muted)' }}>
          {loading ? 'جارٍ التحميل…' : `${fmtCount(data.merchants.length)} متجر`}
        </div>
        <div style={{ marginInlineStart:'auto', display:'flex', gap:8 }}>
          {data.merchants.length > 0 && (
            <Btn size="sm" variant="ghost" icon={<LinkIcon size={13}/>} onClick={handleAutoLink} disabled={autoLinking}>
              {autoLinking ? 'جارٍ الربط…' : 'ربط تلقائي مع المديونيات'}
            </Btn>
          )}
          <Btn size="sm" variant="ghost" icon={<RefreshCw size={13}/>} onClick={refresh} disabled={loading}>
            تحديث
          </Btn>
          <Btn size="sm" variant="accent" icon={<Upload size={13}/>} onClick={() => setShowUpload(true)}>
            رفع كشف جديد
          </Btn>
        </div>
      </div>

      {loading ? (
        <div style={{ display:'flex', justifyContent:'center', padding:80 }}><Spinner size={28}/></div>
      ) : !data.merchants.length ? (
        <Card>
          <Empty
            icon="🏪"
            title="لم يُرفع أي كشف بعد"
            sub="ارفع stores.xlsx من النظام الداخلي لتشاهد المتاجر + الإحصاءات"
          />
          <div style={{ display:'flex', justifyContent:'center', marginTop:12 }}>
            <Btn variant="accent" icon={<Upload size={13}/>} onClick={() => setShowUpload(true)}>
              ارفع أول كشف
            </Btn>
          </div>
        </Card>
      ) : (
        <>
          <InsightGrid insights={insights}/>
          <MerchantInsightsPanels insights={insights}/>

          {/* Filter bar */}
          <Card style={{ padding:12, marginBottom:12 }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
              <div style={{ display:'flex', alignItems:'center', gap:6, flex:'1 1 200px', minWidth:0 }}>
                <Search size={14} color="var(--muted)"/>
                <input
                  value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="بحث بالاسم، الـID، أو الهاتف…"
                  style={{ flex:1, padding:'7px 10px', borderRadius:7, fontSize:12, minWidth:0 }}
                />
              </div>
              <Chip
                options={[
                  { v:'all',      l:'كل الأنواع' },
                  { v:'prepaid',  l:'دفع مسبق' },
                  { v:'postpaid', l:'دفع لاحق' },
                ]}
                value={filterType}
                onChange={setFilterType}
              />
              <Chip
                options={[
                  { v:'all',      l:'كل الحالات' },
                  { v:'active',   l:'نشط' },
                  { v:'inactive', l:'غير نشط' },
                ]}
                value={filterStatus}
                onChange={setFilterStatus}
              />
              <span style={{
                marginInlineStart:'auto',
                padding:'3px 10px', borderRadius:11,
                background: 'rgba(45,212,191,.10)',
                border: '1px solid rgba(45,212,191,.32)',
                fontSize:11, fontFamily:'var(--font-mono)', fontWeight:700, color:'var(--accent)',
                whiteSpace:'nowrap',
              }}>
                {fmtCount(visible.length)} نتيجة
              </span>
            </div>
          </Card>

          {/* Table */}
          <Card style={{ padding:0, overflow:'hidden' }}>
            <div style={{ maxHeight:600, overflowY:'auto' }}>
              <table style={{ fontSize:12, width:'100%' }}>
                <thead style={{ position:'sticky', top:0, background:'var(--surface)', zIndex:1 }}>
                  <tr>
                    <th style={thStyle}>الاسم</th>
                    <th style={{...thStyle, textAlign:'center'}}>ID</th>
                    <th style={thStyle}>الهاتف</th>
                    <th style={thStyle}>نوع الفوترة</th>
                    <th style={thStyle}>الحالة</th>
                    <th style={{...thStyle, textAlign:'center'}}>الشحنات</th>
                    <th style={thStyle}>آخر شحنة</th>
                    <th style={{...thStyle, textAlign:'left'}}>الرصيد</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.slice(0, 300).map(m => {
                    const lastDays = daysAgo(m.last_shipment_at);
                    const lastColor =
                      lastDays == null     ? 'var(--muted)' :
                      lastDays <= 7        ? '#10B981' :
                      lastDays <= 30       ? '#F59E0B' :
                      lastDays <= 60       ? '#F97316' :
                                              '#EF4444';
                    return (
                      <tr key={m.id} style={{ borderBottom:'1px solid var(--border)' }}>
                        <td style={{ fontSize:12, color:'var(--text)', fontWeight:600 }}>{m.store_name}</td>
                        <td style={{ textAlign:'center', fontFamily:'var(--font-mono)', fontSize:11, color:'var(--muted)' }}>{m.store_id}</td>
                        <td style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--muted)', direction:'ltr' }}>
                          {m.phone || '—'}
                        </td>
                        <td>
                          {m.billing_type === 'دفع لاحق' ? (
                            <span style={billingChip('#F59E0B')}>📋 دفع لاحق</span>
                          ) : m.billing_type === 'دفع مسبق' ? (
                            <span style={billingChip('#3B82F6')}>💳 دفع مسبق</span>
                          ) : <span style={{ color:'var(--muted)' }}>—</span>}
                        </td>
                        <td>
                          {m.status === 'نشط' ? (
                            <span style={statusChip('#10B981')}>● نشط</span>
                          ) : (
                            <span style={statusChip('var(--muted)')}>○ غير نشط</span>
                          )}
                        </td>
                        <td style={{ textAlign:'center', fontFamily:'var(--font-mono)', fontWeight:700 }}>{fmtCount(m.shipment_count)}</td>
                        <td style={{ fontSize:11, fontFamily:'var(--font-mono)', color: lastColor }}>
                          {m.last_shipment_at ? `${fmtDate(m.last_shipment_at)}${lastDays != null ? ` · ${lastDays}ي` : ''}` : '—'}
                        </td>
                        <td style={{ textAlign:'left', fontFamily:'var(--font-mono)', fontWeight:700, color: (m.wallet_balance||0) > 0 ? 'var(--accent)' : 'var(--muted)' }}>
                          {(m.wallet_balance || 0) > 0 ? fmt(m.wallet_balance) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {visible.length > 300 && (
                <div style={{ padding:10, textAlign:'center', fontSize:11, color:'var(--muted)', background:'var(--surface)' }}>
                  + {fmtCount(visible.length - 300)} متجر إضافي — استخدم البحث / الفلاتر لتضييق النتائج
                </div>
              )}
            </div>
          </Card>
        </>
      )}

      {showUpload && (
        <UploadModal
          userId={user?.id}
          onClose={() => setShowUpload(false)}
          onDone={() => { setShowUpload(false); refresh(); }}
        />
      )}
    </div>
  );
}

const thStyle = {
  textAlign: 'right',
  padding: '8px 12px',
  fontSize: 10.5, fontWeight: 700, color: 'var(--muted)',
  fontFamily: 'var(--font-mono)', letterSpacing: 1.5, textTransform: 'uppercase',
};
function billingChip(color) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '2px 9px', borderRadius: 11,
    background: color + '18', color, border: `1px solid ${color}40`,
    fontSize: 10.5, fontFamily: 'var(--font-mono)', fontWeight: 700, whiteSpace: 'nowrap',
  };
}
function statusChip(color) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '2px 8px', borderRadius: 10,
    color, fontSize: 10.5, fontFamily: 'var(--font-mono)', fontWeight: 700, whiteSpace: 'nowrap',
  };
}

function Chip({ options, value, onChange }) {
  return (
    <div style={{ display:'flex', gap:0, padding:3, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:9 }}>
      {options.map(o => (
        <button key={o.v} onClick={() => onChange(o.v)} style={{
          padding:'5px 12px',
          background: value === o.v ? 'var(--card)' : 'transparent',
          border:'none', borderRadius:7,
          cursor:'pointer', fontSize:11.5, fontWeight:600,
          color: value === o.v ? 'var(--text)' : 'var(--muted)',
        }}>{o.l}</button>
      ))}
    </div>
  );
}

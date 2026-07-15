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
import { Card, Btn, Spinner, Empty, Modal, toast, PageHero, PageHeader, DropZone } from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  parseStoresFile, uploadMerchantsSnapshot, loadLatestMerchants,
  computeMerchantInsights, autoLinkCustomers,
  loadUnmatchedCustomers, setCustomerMerchantLink,
} from '../lib/merchantsService.js';
import { supabase } from '../lib/supabase.js';

const fmt = (n) =>
  (n == null || Number.isNaN(n)) ? '—'
  : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtCount = (n) =>
  (n == null) ? '—' : Number(n).toLocaleString('en-US');

const fmtDate = (iso) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-GB', { year:'numeric', month:'2-digit', day:'2-digit' }); }
  catch { return iso; }
};

const daysAgo = (iso) => {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso)) / 86_400_000);
};

// ── Hero ────────────────────────────────────────────────────────
function Hero({ insights, snapshot }) {
  return (
    <PageHero
      variant="dark"
      icon={<ShoppingBag size={22}/>}
      tag="LAMHA · MERCHANT DIRECTORY"
      title="متاجر المنصّة"
      meta={snapshot ? `snapshot ${snapshot.id} · رُفع ${fmtDate(snapshot.uploadedAt)}` : null}
      stats={[
        { label: 'إجمالي',    value: fmtCount(insights.total), big: true },
        { label: 'نشط',       value: fmtCount(insights.active), color: '#86EFAC' },
        { label: 'دفع مسبق',  value: fmtCount(insights.prepaid) },
        { label: 'دفع لاحق',  value: fmtCount(insights.postpaid), color: '#FBBF24' },
      ]}
    />
  );
}

// ── Insight cards ──────────────────────────────────────────────
function InsightGrid({ insights }) {
  const cards = [
    { k:'newLast30',     label:'جدد آخر 30 يوم',   value: insights.newLast30,     icon: TrendingUp,  color:'var(--green)' },
    { k:'neverShipped',  label:'لم يشحن أبداً',     value: insights.neverShipped,  icon: AlertTriangle, color:'#EF4444', hint: 'تسرّب funnel' },
    { k:'dormantActive', label:'نشط بلا حركة +60', value: insights.dormantActive, icon: ZapOff,      color:'var(--gold)' },
    { k:'churned',       label:'فُقدوا (شحن ثم توقّف)', value: insights.churned,    icon: ZapOff,      color:'#7A82C4', hint: 'مرشحون لإعادة الاسترداد' },
    { k:'verified',      label:'متاجر موثقة', value: `${fmtCount(insights.verified || 0)} · زاتكا ${fmtCount(insights.zatcaDone || 0)}`, icon: CheckCircle2, color:'var(--green)', raw: true },
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
        accent="var(--green)"
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
      profileDone: parsed.rows.filter(r => r.profileStatus === 'مكتمل').length,
      vatRegistered: parsed.rows.filter(r => r.vatRegistered).length,
      zatcaDone: parsed.rows.filter(r => r.zatcaCompleted).length,
      verified: parsed.rows.filter(r => r.verificationStatus === 'موثق').length,
    };
  }, [parsed]);

  return (
    <Modal title="رفع كشف المتاجر" onClose={onClose} width={520}>
      {!file && (
        <DropZone
          onFile={handleFile}
          accept=".xlsx,.xls"
          title="اسحب كشف المتاجر هنا"
          hint={<>يحتاج رأس فيه «رقم المتجر» و«اسم المتجر». الهاتف ونوع الفوترة والحالة اختيارية لكنها مهمة.<br/>اسحب الملف أو <span style={{ color: 'var(--accent)', fontWeight: 600 }}>اضغط للاختيار</span></>}
        />
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
            background:'color-mix(in srgb, var(--accent) 8%, transparent)',
            border:'1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
            borderRadius:9, fontSize:12, lineHeight:1.8,
          }}>
            <div style={{ fontWeight:700, color:'var(--accent)', marginBottom:4 }}>✓ تم تحليل الملف</div>
            <Row label="الملف" value={file?.name}/>
            <Row label="إجمالي المتاجر" value={fmtCount(counts.total)} accent/>
            <Row label="دفع مسبق" value={fmtCount(counts.prepaid)}/>
            <Row label="دفع لاحق" value={fmtCount(counts.postpaid)}/>
            <Row label="نشط حالياً" value={fmtCount(counts.active)}/>
            <Row label="ملف مكتمل" value={fmtCount(counts.profileDone)}/>
            <Row label="مسجل في الضريبة" value={fmtCount(counts.vatRegistered)}/>
            <Row label="زاتكا مكتملة" value={fmtCount(counts.zatcaDone)}/>
            <Row label="موثق" value={fmtCount(counts.verified)}/>
          </div>
          <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:14 }}>
            <Btn variant="ghost" onClick={onClose}>إلغاء</Btn>
            <Btn variant="accent" icon={<CheckCircle2 size={14}/>} onClick={handleSave} disabled={busy}>
              حفظ كلقطة
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
  const [showUnmatched, setShowUnmatched] = useState(false);
  const [unmatchedCount, setUnmatchedCount] = useState(null);

  const refreshUnmatchedCount = useCallback(async () => {
    try {
      const list = await loadUnmatchedCustomers();
      setUnmatchedCount(list.length);
    } catch { /* non-fatal */ }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const d = await loadLatestMerchants();
      setData(d);
      setInsights(computeMerchantInsights(d.merchants));
      refreshUnmatchedCount();
    } catch (e) {
      toast(`فشل التحميل: ${e.message}`, 'error');
    }
    setLoading(false);
  }, [refreshUnmatchedCount]);

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
      refreshUnmatchedCount();
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
    <div style={{ padding: '24px 28px 80px', maxWidth: 1320, margin: '0 auto' }}>
      <PageHeader
        icon={<ShoppingBag size={22}/>}
        title="متاجر المنصّة"
        subtitle={loading ? 'جارٍ التحميل…' : `${fmtCount(data.merchants.length)} متجر مُسجَّل`}
        meta={data.snapshot ? `snapshot ${data.snapshot.id} · رُفع ${fmtDate(data.snapshot.uploadedAt)}` : null}
        actions={
          <>
            {data.merchants.length > 0 && (
              <Btn size="md" variant="ghost" icon={<LinkIcon size={14}/>} onClick={handleAutoLink} disabled={autoLinking}>
                {autoLinking ? 'جارٍ الربط…' : 'ربط تلقائي'}
              </Btn>
            )}
            {unmatchedCount > 0 && (
              <Btn size="sm" variant="ghost" icon={<AlertTriangle size={14}/>} onClick={() => setShowUnmatched(true)}>
                غير مرتبطين ({fmtCount(unmatchedCount)})
              </Btn>
            )}
            <Btn size="sm" variant="ghost" icon={<RefreshCw size={14} className={loading ? 'spin' : ''}/>} onClick={refresh} disabled={loading}>
              تحديث
            </Btn>
            <Btn size="md" variant="primary" icon={<Upload size={14}/>} onClick={() => setShowUpload(true)}>
              رفع كشف
            </Btn>
          </>
        }
      />
      <Hero insights={insights} snapshot={data.snapshot}/>

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
            <Btn size="md" variant="accent" icon={<Upload size={14}/>} onClick={() => setShowUpload(true)}>
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
                background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
                border: '1px solid color-mix(in srgb, var(--accent) 32%, transparent)',
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
              <table className="m-cards" style={{ fontSize:12, width:'100%' }}>
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
                      lastDays <= 7        ? 'var(--green)' :
                      lastDays <= 30       ? 'var(--gold)' :
                      lastDays <= 60       ? '#F97316' :
                                              '#EF4444';
                    return (
                      <tr key={m.id} style={{ borderBottom:'1px solid var(--border)' }}>
                        <td data-label="" style={{ fontSize:12, color:'var(--text)', fontWeight:600 }}>
                          {m.store_name}
                          <MerchantMetaChips merchant={m}/>
                        </td>
                        <td data-label="ID" style={{ textAlign:'center', fontFamily:'var(--font-mono)', fontSize:11, color:'var(--muted)' }}>{m.store_id}</td>
                        <td data-label="الهاتف" style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--muted)', direction:'ltr' }}>
                          {m.phone || '—'}
                        </td>
                        <td data-label="نوع الفوترة">
                          {m.billing_type === 'دفع لاحق' ? (
                            <span style={billingChip('var(--gold)')}>📋 دفع لاحق</span>
                          ) : m.billing_type === 'دفع مسبق' ? (
                            <span style={billingChip('#3B82F6')}>💳 دفع مسبق</span>
                          ) : <span style={{ color:'var(--muted)' }}>—</span>}
                        </td>
                        <td data-label="الحالة">
                          {m.status === 'نشط' ? (
                            <span style={statusChip('var(--green)')}>● نشط</span>
                          ) : (
                            <span style={statusChip('var(--muted)')}>○ غير نشط</span>
                          )}
                        </td>
                        <td data-label="الشحنات" style={{ textAlign:'center', fontFamily:'var(--font-mono)', fontWeight:700 }}>{fmtCount(m.shipment_count)}</td>
                        <td data-label="آخر شحنة" style={{ fontSize:11, fontFamily:'var(--font-mono)', color: lastColor }}>
                          {m.last_shipment_at ? `${fmtDate(m.last_shipment_at)}${lastDays != null ? ` · ${lastDays}ي` : ''}` : '—'}
                        </td>
                        <td data-label="الرصيد" style={{ textAlign:'left', fontFamily:'var(--font-mono)', fontWeight:700, color: (m.wallet_balance||0) > 0 ? 'var(--accent)' : 'var(--muted)' }}>
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

      {showUnmatched && (
        <UnmatchedModal
          merchants={data.merchants}
          userId={user?.id}
          onClose={() => setShowUnmatched(false)}
          onLinkSaved={() => refreshUnmatchedCount()}
        />
      )}
    </div>
  );
}

// ── Unmatched customers modal ─────────────────────────────────
// Lists every customer_name that the auto-linker couldn't find a
// merchant for (store_id is null OR match_method='unmatched'),
// enriched with the receivables debt + aging so the user knows who
// to prioritise. Each row offers a searchable store dropdown — on
// save we write a manual link that the auto-linker will never
// overwrite.
function UnmatchedModal({ merchants, userId, onClose, onLinkSaved }) {
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await loadUnmatchedCustomers();
      setRows(list);
    } catch (e) {
      toast(`فشل التحميل: ${e.message}`, 'error');
    }
    setLoading(false);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const visible = useMemo(() => {
    if (!rows) return [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => (r.customerName || '').toLowerCase().includes(q));
  }, [rows, search]);

  const handleLink = async (customerName, storeId) => {
    if (!storeId) return;
    try {
      await setCustomerMerchantLink({ customerName, storeId, method: 'manual', confidence: 1.0, userId });
      toast(`✓ ربط ${customerName}`, 'success');
      setRows(prev => (prev || []).filter(r => r.customerName !== customerName));
      onLinkSaved?.();
    } catch (e) {
      toast(`فشل الحفظ: ${e.message}`, 'error');
    }
  };

  const handleSkip = async (customerName) => {
    // Mark as "skipped" — store_id stays null, but method='manual'
    // so the auto-linker won't keep trying to match it.
    try {
      await setCustomerMerchantLink({ customerName, storeId: null, method: 'manual', confidence: 0, userId });
      toast(`✓ تم تجاهل ${customerName}`, 'success');
      setRows(prev => (prev || []).filter(r => r.customerName !== customerName));
      onLinkSaved?.();
    } catch (e) {
      toast(`فشل: ${e.message}`, 'error');
    }
  };

  return (
    <Modal title={`الربط اليدوي — ${rows?.length || 0} عميل غير مرتبط`} onClose={onClose} width={780}>
      <div style={{
        padding:'10px 14px', marginBottom:10,
        background:'rgba(245,158,11,.08)',
        border:'1px solid rgba(245,158,11,.3)',
        borderRadius:9, fontSize:12, lineHeight:1.7,
        color:'var(--text)',
      }}>
        <strong style={{ color:'var(--gold)' }}>⚠ هؤلاء العملاء بأسماء لم يستطع الـ auto-linker مطابقتها مع المتاجر.</strong>
        <div style={{ color:'var(--muted)', marginTop:3 }}>
          اختر المتجر الصحيح من القائمة (بحث بالاسم أو ID) — الربط اليدوي محمي ولن يُعاد كتابته في الرفعات القادمة.
          أو اضغط "تجاهل" لو العميل لا يطابق أي متجر.
        </div>
      </div>

      <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:10 }}>
        <Search size={14} color="var(--muted)"/>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="بحث باسم العميل…"
          autoComplete="off"
          data-lpignore="true"
          data-form-type="other"
          name="customer-search"
          style={{ flex:1, padding:'7px 10px', borderRadius:7, fontSize:12 }}
        />
        <span style={{ fontSize:11, color:'var(--muted)', fontFamily:'var(--font-mono)' }}>
          {fmtCount(visible.length)} / {fmtCount(rows?.length || 0)}
        </span>
      </div>

      {loading ? (
        <div style={{ display:'flex', justifyContent:'center', padding:40 }}><Spinner size={24}/></div>
      ) : !visible.length ? (
        <div style={{ padding:30, textAlign:'center', fontSize:12, color:'var(--muted)' }}>
          {rows?.length ? 'لا نتائج للبحث' : '🎉 كل العملاء مرتبطون'}
        </div>
      ) : (
        <div style={{ maxHeight:480, overflowY:'auto', border:'1px solid var(--border)', borderRadius:8 }}>
          {visible.map(r => (
            <UnmatchedRow
              key={r.customerName}
              row={r}
              merchants={merchants}
              onLink={(storeId) => handleLink(r.customerName, storeId)}
              onSkip={() => handleSkip(r.customerName)}
            />
          ))}
        </div>
      )}
    </Modal>
  );
}

// Single unmatched row: shows customer name + debt context, a
// searchable merchant dropdown, link/skip buttons.
function UnmatchedRow({ row, merchants, onLink, onSkip }) {
  const [storeQ, setStoreQ] = useState('');
  const [picked, setPicked] = useState(null);

  const options = useMemo(() => {
    const q = storeQ.trim().toLowerCase();
    if (!q) return [];
    return merchants.filter(m =>
      (m.store_name || '').toLowerCase().includes(q) ||
      (m.store_id   || '').toLowerCase().includes(q),
    ).slice(0, 8);
  }, [storeQ, merchants]);

  return (
    <div style={{
      padding:'12px 14px', borderBottom:'1px solid var(--border)',
      display:'grid', gridTemplateColumns:'1fr 1fr auto', gap:14, alignItems:'start',
    }}>
      <div>
        <div style={{ fontWeight:700, fontSize:12.5, color:'var(--text)', wordBreak:'break-word' }}>
          {row.customerName}
        </div>
        <div style={{ display:'flex', gap:8, marginTop:5, flexWrap:'wrap', fontSize:10.5 }}>
          {row.totalDue > 0 && (
            <span style={{ color:'#EF4444', fontFamily:'var(--font-mono)', fontWeight:700 }}>
              {fmt(row.totalDue)} ر.س
            </span>
          )}
          {row.daysOutstanding > 0 && (
            <span style={{ color: row.daysOutstanding > 60 ? 'var(--gold)' : 'var(--muted)' }}>
              {row.daysOutstanding}ي متأخر
            </span>
          )}
          {row.matchMethod === 'unmatched' && (
            <span style={{ color:'var(--muted)', fontStyle:'italic' }}>auto: لم يجد تطابق</span>
          )}
        </div>
      </div>

      <div style={{ position:'relative' }}>
        {picked ? (
          <div style={{
            display:'flex', alignItems:'center', gap:6,
            padding:'6px 10px', borderRadius:7,
            background:'color-mix(in srgb, var(--accent) 10%, transparent)', border:'1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
            fontSize:11.5,
          }}>
            <CheckCircle2 size={12} color="var(--accent)"/>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontWeight:700, color:'var(--text)' }}>{picked.store_name}</div>
              <div style={{ fontSize:10, color:'var(--muted)', fontFamily:'var(--font-mono)' }}>{picked.store_id}</div>
            </div>
            <button onClick={() => setPicked(null)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--muted)' }}>
              <X size={12}/>
            </button>
          </div>
        ) : (
          <>
            <input
              value={storeQ} onChange={e => setStoreQ(e.target.value)}
              placeholder="ابحث عن متجر بالاسم أو ID…"
              autoComplete="off"
              data-lpignore="true"
              data-form-type="other"
              name="merchant-search"
              style={{ width:'100%', padding:'6px 10px', borderRadius:7, fontSize:11.5 }}
            />
            {options.length > 0 && (
              <div style={{
                position:'absolute', insetInline:0, top:'100%',
                background:'var(--card)', border:'1px solid var(--border)',
                borderRadius:7, marginTop:3, zIndex:10,
                maxHeight:220, overflowY:'auto',
                boxShadow:'0 6px 18px rgba(0,0,0,.18)',
              }}>
                {options.map(m => (
                  <div key={m.id} onClick={() => { setPicked(m); setStoreQ(''); }} style={{
                    padding:'7px 10px', cursor:'pointer', fontSize:11.5,
                    borderBottom:'1px solid var(--border)',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <div style={{ fontWeight:600 }}>{m.store_name}</div>
                    <div style={{ fontSize:10, color:'var(--muted)', fontFamily:'var(--font-mono)' }}>
                      {m.store_id} · {m.phone || 'بدون هاتف'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div style={{ display:'flex', gap:6, alignItems:'center' }}>
        {picked && (
          <Btn size="sm" variant="accent" icon={<LinkIcon size={12}/>} onClick={() => { onLink(picked.store_id); setPicked(null); }}>
            ربط
          </Btn>
        )}
        <Btn size="sm" variant="ghost" onClick={onSkip}>
          تجاهل
        </Btn>
      </div>
    </div>
  );
}

function MerchantMetaChips({ merchant }) {
  const chips = [];
  if (merchant.profile_status) {
    chips.push({
      key: 'profile',
      label: merchant.profile_status,
      color: merchant.profile_status === 'مكتمل' ? 'var(--green)' : 'var(--gold)',
      title: 'حالة الملف الشخصي',
    });
  }
  if (merchant.vat_registered === true) {
    chips.push({ key: 'vat', label: 'ضريبة', color: '#3B82F6', title: 'مسجل في الضريبة' });
  }
  if (merchant.zatca_completed === true) {
    chips.push({ key: 'zatca', label: 'زاتكا', color: 'var(--accent)', title: 'مكمل بيانات زاتكا' });
  }
  if (merchant.verification_status) {
    chips.push({
      key: 'verify',
      label: merchant.verification_status,
      color: merchant.verification_status === 'موثق' ? 'var(--green)' : 'var(--muted)',
      title: 'حالة التوثيق',
    });
  }
  if (!chips.length) return null;
  return (
    <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginTop:4 }}>
      {chips.map(c => (
        <span key={c.key} title={c.title} style={miniMetaChip(c.color)}>
          {c.label}
        </span>
      ))}
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
function miniMetaChip(color) {
  return {
    display: 'inline-flex', alignItems: 'center',
    padding: '1px 6px', borderRadius: 9,
    background: `color-mix(in srgb, ${color} 12%, transparent)`,
    color,
    border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
    fontSize: 9.5, fontFamily: 'var(--font-mono)', fontWeight: 700,
    lineHeight: 1.5, whiteSpace: 'nowrap',
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

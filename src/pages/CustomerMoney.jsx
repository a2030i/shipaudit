// «تحصيل العملاء» — شاشة التحصيل الأولى (زوهو API المرجع، جوال أولاً).
// سؤال واحد تجيبه: كم لي بالخارج، وعند مَن، وكيف أحصّله الآن؟
// مصدر الحقيقة الواحد: RPC customer_money_dashboard() (قاعدة «رقم واحد
// لكل مفهوم» 2026-07-03) — نفس أرقام /zoho-data ومتابعة العملاء.
// كل بطاقة عميل فيها 📞 اتصال و💬 واتساب مباشرين + فواتيره بنقرة.

import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, Download, Phone, MessageCircle, ChevronDown, HandCoins } from 'lucide-react';
import * as XLSX from 'xlsx';
import { persistAndDownloadExport } from '../lib/internalExportsService.js';
import { Card, Btn, Spinner, Empty, toast, PageHeader, Modal, Input } from '../components/UI.jsx';
import DataConfidenceBar from '../components/DataConfidenceBar.jsx';
import { useAuth } from '../lib/auth.jsx';
import { loadCustomerMoneyDashboard, loadZohoOpenInvoices, zohoStatusAr, loadZohoUnusedCredits,
  planZohoApplyCredits, applyZohoCredits, getZohoWriteAuthUrl, syncZohoDocs } from '../lib/pnlService.js';
import { normalizeSaudiPhone, loadMorningBriefConfig, saveMorningBriefConfig,
  previewMorningBrief, sendMorningBriefNow, loadWhatsAppCampaignStatus, loadTemplateSentSet } from '../lib/whatsappService.js';
import WhatsAppSendModal from '../components/WhatsAppSendModal.jsx';
import IvrCallButton from '../components/IvrCallButton.jsx';
import CustomerCallLog from '../components/CustomerCallLog.jsx';
import CustomerCommTimeline from '../components/CustomerCommTimeline.jsx';
import TagButton from '../components/TagButton.jsx';

const fmt = (n) => (n == null || Number.isNaN(n)) ? '—'
  : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtK = (n) => { const a = Math.abs(n); return a >= 1000 ? (n / 1000).toFixed(1) + 'ك' : String(Math.round(n)); };
const fmtDate = (d) => { if (!d) return ''; try { return new Date(d).toLocaleDateString('ar-SA', { day: 'numeric', month: 'short' }); } catch { return String(d).slice(0, 10); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// شرائح الأعمار — الترتيب من الأطزج للأخطر
const BUCKETS = [
  { key: 'b0', label: '0–30 يوم',  color: 'var(--green)' },
  { key: 'b1', label: '31–60',     color: 'var(--gold)' },
  { key: 'b2', label: '61–90',     color: 'color-mix(in srgb, var(--gold) 50%, var(--red))' },
  { key: 'b3', label: '+90',       color: 'var(--red)' },
];

export default function CustomerMoney({ isActive = true }) {
  const { can, user, isAdmin } = useAuth();
  const [searchParams] = useSearchParams();
  const [applyTarget, setApplyTarget] = useState(null);   // { zohoId, name } عند فتح مودال التطبيق
  const [d, setD] = useState(null);
  const [q, setQ] = useState('');
  const [buckets, setBuckets] = useState(() => new Set());   // شرائح الأعمار المختارة (متعددة) — فارغ = كل الدين
  const toggleBucket = (key) => setBuckets(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const [sortBy, setSortBy] = useState('owed');    // owed | oldest
  const [waOpen, setWaOpen] = useState(false);
  const [waSingle, setWaSingle] = useState(null);          // مستلِم واحد عند «واتساب» من البطاقة
  const [waStatus, setWaStatus] = useState(() => new Map()); // حالة آخر حملة لكل هاتف
  const [busy, setBusy] = useState(false);
  const [syncingZoho, setSyncingZoho] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const [credits, setCredits] = useState(null);   // أرصدة دائنة غير مستخدمة
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);   // مودال «طبّق للكل»

  useEffect(() => {
    const customer = searchParams.get('customer');
    if (customer) setQ(customer);
  }, [searchParams]);

  const refresh = async () => {
    setBusy(true);
    try { setD(await loadCustomerMoneyDashboard()); }
    catch (e) { toast(`فشل التحميل: ${e.message}`, 'error'); setD(prev => prev || { customers: [], aging: {} }); }
    setBusy(false);
  };
  const handleSyncZoho = async () => {
    setSyncingZoho(true);
    try {
      const res = await syncZohoDocs();
      const count = res?.results?.invoices;
      toast(count != null ? `تمت مزامنة فواتير زوهو: ${count}` : 'تمت مزامنة زوهو', 'success');
      setCredits(null);
      await refresh();
    } catch (e) {
      toast(`فشلت مزامنة زوهو: ${e.message}`, 'error');
    } finally {
      setSyncingZoho(false);
    }
  };
  useEffect(() => { if (isActive && d == null) refresh(); }, [isActive]); // eslint-disable-line
  // حالة آخر حملة واتساب لكل عميل (تحميل كسول + بعد كل إرسال)
  const loadWaStatus = () => loadWhatsAppCampaignStatus().then(setWaStatus).catch(() => {});
  useEffect(() => { if (isActive) loadWaStatus(); }, [isActive]); // eslint-disable-line
  // مَن وصله قالب المطالبة (sadad) يوماً — لفلتر «لم تصلهم مطالبة» (فحص الوكلاء:
  // 29 من 40 مديناً بهاتف لم يُطالَبوا قط). يُعاد تحميله بعد كل إرسال.
  const [sadadSet, setSadadSet] = useState(() => new Set());
  const [unclaimedOnly, setUnclaimedOnly] = useState(false);
  const loadSadad = () => loadTemplateSentSet('sadad').then(setSadadSet).catch(() => {});
  useEffect(() => { if (isActive) loadSadad(); }, [isActive]); // eslint-disable-line
  // فتح حملة لعميل واحد من زر «واتساب» في بطاقته
  // مبلغ التحصيل لكل عميل = مجموع الشرائح المختارة فقط (أو كامل الدين إن لم تُختَر شريحة).
  // فحملة على شريحة 61–90 ترسل مبلغ تلك الشريحة لا كامل دين العميل.
  const bandAmt = (c) => buckets.size === 0 ? (c.owed || 0)
    : BUCKETS.reduce((s, b) => s + (buckets.has(b.key) ? (c[b.key] || 0) : 0), 0);
  // أعمدة التحصيل المتاحة لربط متغيرات القالب ديناميكياً (مودال الإرسال)
  const collectionFields = (c, amt = c.owed) => ({
    name: (c.storeName || c.name || '').trim(), amount: amt, count: c.invCnt,
    overdue: c.overdue, oldest_days: c.oldestDays, wallet: c.walletBalance,
    last_shipment: c.lastShipmentAt, last_payment: c.lastPaymentDate,
  });
  const openSingleWa = (c) => {
    const name = (c.storeName || c.name || '').trim();
    const amt = bandAmt(c);
    setWaSingle({
      to: normalizeSaudiPhone(c.phone), name, amount: amt, count: c.invCnt,
      vars: [name, Number(amt).toLocaleString('en-US', { maximumFractionDigits: 2 }), String(c.invCnt)],
      fields: collectionFields(c, amt),
    });
    setWaOpen(true);
  };
  // أرصدة دائنة غير مستخدمة (تحميل كسول مرة واحدة)
  useEffect(() => {
    if (!isActive || credits != null) return;
    loadZohoUnusedCredits().then(setCredits).catch(() => setCredits({ rows: [], totalApplicable: 0, clearsCount: 0 }));
  }, [isActive, credits]);
  // منح صلاحية الكتابة (invoices.UPDATE) لمرة واحدة — يفتح موافقة زوهو
  const grantWriteAccess = async () => {
    const r = await getZohoWriteAuthUrl();
    if (r?.ok && r.url) {
      toast('تُفتح صفحة موافقة زوهو — اضغط Accept. القراءة تبقى كما هي + صلاحية تطبيق فقط.', 'info');
      window.open(r.url, '_blank', 'noopener');
    } else toast(`تعذّر فتح الموافقة: ${r?.error || 'غير معروف'}`, 'error');
  };

  const filtered = useMemo(() => {
    if (!d) return [];
    let list = d.customers;
    if (buckets.size) list = list.filter(c => bandAmt(c) > 0.5);
    // «لم تصلهم مطالبة» = له هاتف ولم يصله قالب sadad قط
    if (unclaimedOnly) list = list.filter(c => c.phone && !sadadSet.has(normalizeSaudiPhone(c.phone)));
    const s = q.trim().toLowerCase();
    if (s) list = list.filter(c =>
      [c.name, c.storeName, c.phone].some(v => String(v ?? '').toLowerCase().includes(s)));
    return [...list].sort((a, b) => sortBy === 'oldest' ? b.oldestDays - a.oldestDays : bandAmt(b) - bandAmt(a));
  }, [d, q, buckets, sortBy, unclaimedOnly, sadadSet]);  // eslint-disable-line
  const filteredTotal = useMemo(() => +filtered.reduce((s, c) => s + bandAmt(c), 0).toFixed(2), [filtered, buckets]);  // eslint-disable-line

  const waRecipients = useMemo(() => filtered
    .filter(c => c.phone && bandAmt(c) > 0.5)
    .map(c => {
      const name = (c.storeName || c.name || '').trim();
      const amt = bandAmt(c);
      return {
        to: normalizeSaudiPhone(c.phone), name, amount: amt, count: c.invCnt,
        vars: [name, Number(amt).toLocaleString('en-US', { maximumFractionDigits: 2 }), String(c.invCnt)],
        fields: collectionFields(c, amt),
      };
    }), [filtered, buckets]);  // eslint-disable-line

  // ملف الحملة — زوهو المرجع للدين + سياق المتجر (هاتف/نوع فوترة/حالة/محفظة/آخر
  // شحنة) للفريق. يمرّ عبر persistAndDownloadExport (تخزين + سجل السحبات، §1.13).
  const exportXlsx = async () => {
    if (!filtered.length) return;
    const campLabel = buckets.size ? 'مبلغ الشرائح المختارة' : 'مبلغ التحصيل';
    const headers = ['العميل', 'المتجر', 'الهاتف', 'نوع الفوترة', 'الحالة في المنصّة', 'المستحق', 'متأخر',
      'فواتير', 'أقدم (يوم)', '0-30', '31-60', '61-90', '+90', 'المحفظة', 'آخر شحنة', 'آخر دفعة', 'مبلغها', campLabel];
    const owedTotal = +filtered.reduce((s, c) => s + (c.owed || 0), 0).toFixed(2);
    const aoa = [
      ['تحصيل العملاء — زوهو API المرجع', '', new Date().toISOString().slice(0, 10)],
      buckets.size ? [`الشرائح المختارة: ${BUCKETS.filter(b => buckets.has(b.key)).map(b => b.label).join(' + ')} — «مبلغ الشرائح المختارة» هو مجموع هذه الشرائح فقط`] : [],
      headers,
      ...filtered.map(c => [c.name, c.storeName || '', c.phone || '', c.billingType || '', c.platformStatus || '',
        c.owed, c.overdue, c.invCnt, c.oldestDays, c.b0, c.b1, c.b2, c.b3,
        c.walletBalance || 0, c.lastShipmentAt ? new Date(c.lastShipmentAt).toLocaleDateString('en-CA') : '',
        c.lastPaymentDate || '', c.lastPaymentAmount || '', bandAmt(c)]),
      [],
      ['الإجمالي', '', '', '', '', owedTotal, '', '', '', '', '', '', '', '', '', '', '', filteredTotal],
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = headers.map((_, i) => ({ wch: i === 0 ? 32 : (i === 1 ? 24 : 12) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'تحصيل العملاء');
    try {
      await persistAndDownloadExport({
        wb, fileName: `تحصيل_العملاء_${new Date().toISOString().slice(0, 10)}.xlsx`,
        kind: 'zoho_campaign', rowCount: filtered.length, total: +filteredTotal.toFixed(2), userId: user?.id || null,
      });
      toast(`صُدّر ${filtered.length} عميلاً ✓ (محفوظ في سجل السحبات)`, 'success');
    } catch (e) { toast(`فشل التصدير: ${e.message}`, 'error'); }
  };

  if (!can('receivables.view')) return <div style={{ padding: 40 }}><Empty icon="🔒" title="لا صلاحية" sub="تحتاج صلاحية «عرض المديونيات»"/></div>;
  if (d == null) return <div style={{ padding: 60, textAlign: 'center' }}><Spinner size={26}/></div>;

  const agingTotal = BUCKETS.reduce((s, b) => s + (d.aging[b.key] || 0), 0) || 1;
  const colDelta = d.collectedPrevMonth > 0
    ? Math.round(((d.collectedThisMonth - d.collectedPrevMonth) / d.collectedPrevMonth) * 100) : null;

  // أرصدة دائنة: قابل للتطبيق (رصيد + فاتورة مفتوحة) مقابل «رصيد قائم» (بلا فواتير)
  const applicableRows = (credits?.rows || []).filter(r => r.applicable > 0.5);
  const standingCount = (credits?.rows?.length || 0) - applicableRows.length;

  return (
    <div style={{ padding: '24px 28px 80px', maxWidth: 1320, margin: '0 auto' }}>
      <PageHeader icon={<HandCoins size={22}/>} iconColor="var(--green)"
        title="تحصيل العملاء"
        subtitle="زوهو API هو المرجع — كم لك بالخارج وكيف تحصّله الآن"
        actions={
          <>
            <Btn size="sm" variant="ghost" onClick={() => setBriefOpen(true)} title="رسالة واتساب يومية بأرقام هذه الشاشة">
              🌅 ملخّص الصباح
            </Btn>
          </>
        }/>

      <DataConfidenceBar
        active={isActive}
        sourceLabel="Zoho Books API"
        canSync={can?.('money.pnl')}
        syncing={syncingZoho}
        refreshing={busy}
        onSync={handleSyncZoho}
        onRefresh={() => { setCredits(null); refresh(); }}
        sourcePath="/zoho-data?type=invoices"
      />

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
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 6 }}>أعمار الدين — اختر شريحة أو أكثر (المبلغ والحملة يصيران لمجموع المختار فقط)</div>
          <div style={{ display: 'flex', height: 26, borderRadius: 8, overflow: 'hidden', cursor: 'pointer' }}>
            {BUCKETS.map(b => {
              const v = d.aging[b.key] || 0;
              const pct = Math.max((v / agingTotal) * 100, v > 0.5 ? 6 : 0);
              if (pct === 0) return null;
              const active = buckets.has(b.key);
              return (
                <div key={b.key} title={`${b.label}: ${fmt(v)} ر.س`}
                  onClick={() => toggleBucket(b.key)}
                  style={{ width: `${pct}%`, background: b.color, display: 'flex', alignItems: 'center',
                    justifyContent: 'center', color: '#fff', fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap',
                    overflow: 'hidden', outline: active ? '2.5px solid var(--text)' : 'none', outlineOffset: -2 }}>
                  {pct > 12 ? `${b.label} · ${fmtK(v)}` : ''}
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 6, alignItems: 'center' }}>
            {BUCKETS.map(b => (
              <span key={b.key} onClick={() => toggleBucket(b.key)}
                style={{ fontSize: 10.5, color: buckets.has(b.key) ? 'var(--text)' : 'var(--muted)', cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', padding: '6px 4px',
                  fontWeight: buckets.has(b.key) ? 800 : 500 }}>
                <input type="checkbox" checked={buckets.has(b.key)} readOnly
                  style={{ verticalAlign: 'middle', marginInlineEnd: 4, pointerEvents: 'none' }}/>
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: b.color, marginInlineEnd: 4 }}/>
                {b.label}: {fmt(d.aging[b.key] || 0)}
              </span>
            ))}
            {buckets.size > 0 && (
              <span onClick={() => setBuckets(new Set())} style={{ fontSize: 10.5, color: 'var(--accent)', cursor: 'pointer', fontWeight: 700 }}>✕ مسح التحديد</span>
            )}
          </div>
        </div>
      </Card>

      {/* ── أرصدة دائنة غير مستخدمة — طبّقها في زوهو لتصفير الدين ── */}
      {credits && credits.rows.length > 0 && (
        <Card style={{ padding: 0, marginBottom: 12, overflow: 'hidden',
          border: '1.5px solid color-mix(in srgb, var(--green) 30%, var(--border))' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', flexWrap: 'wrap',
            background: 'color-mix(in srgb, var(--green) 7%, transparent)' }}>
            <button onClick={() => setCreditsOpen(o => !o)}
              style={{ flex: 1, minWidth: 200, display: 'flex', alignItems: 'center', gap: 10,
                background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'right', padding: 0 }}>
              <span style={{ fontSize: 17 }}>💳</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 800 }}>
                  {credits.rows.length} عميل لهم أرصدة دائنة في زوهو
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                  {applicableRows.length > 0
                    ? <>قابل للتطبيق الآن: <b style={{ color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>{fmt(credits.totalApplicable)}</b> ر.س على {applicableRows.length} عميل · </>
                    : <>لا شيء قابل للتطبيق حالياً · </>}
                  {standingCount > 0 && <>{standingCount} رصيد بلا فواتير مفتوحة · </>}
                  افتح للتفاصيل
                </div>
              </div>
              <ChevronDown size={16} style={{ transform: creditsOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s', color: 'var(--muted)' }}/>
            </button>
            {isAdmin && (
              <>
                {/* صلاحيات v2: التطبيق كتابة مالية — مفتاح zoho.apply_credits الحسّاس */}
                {applicableRows.length > 0 && can('zoho.apply_credits') && (
                  <Btn size="sm" variant="accent" onClick={() => setBulkOpen(true)} title="يطبّق الأرصدة القابلة للتطبيق (لها فواتير مفتوحة) دفعة واحدة">
                    ⚡ طبّق للكل ({applicableRows.length})
                  </Btn>
                )}
                <Btn size="sm" variant="ghost" onClick={grantWriteAccess} title="مرة واحدة — يفعّل التطبيق">
                  🔑 منح صلاحية
                </Btn>
              </>
            )}
          </div>
          {creditsOpen && (
            <div className="m-flow" style={{ maxHeight: 340, overflowY: 'auto', borderTop: '1px solid var(--border)' }}>
              <table className="m-cards" style={{ width: '100%', fontSize: 12.5 }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
                  <tr>{['العميل', 'الدين', 'رصيد غير مستخدم', 'يُطبَّق', 'يبقى', ''].map(h => (
                    <th key={h} style={{ padding: '8px 12px', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {credits.rows.map(r => (
                    <tr key={r.zohoId} style={{ borderTop: '1px solid var(--border)' }}>
                      <td data-label="" style={{ padding: '8px 12px', fontWeight: 700, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</td>
                      <td data-label="الدين" style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{fmt(r.outstanding)}</td>
                      <td data-label="رصيد غير مستخدم" style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', color: 'var(--green)', whiteSpace: 'nowrap' }}>{fmt(r.unusedCredit)}</td>
                      <td data-label="يُطبَّق" style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontWeight: 800, whiteSpace: 'nowrap' }}>{fmt(r.applicable)}</td>
                      <td data-label="يبقى" style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap',
                        color: r.applicable > 0.5 ? (r.clearsFully ? 'var(--green)' : 'var(--gold)') : 'var(--muted2)' }}>
                        {r.applicable > 0.5 ? (r.clearsFully ? '✓ صفر' : fmt(r.remainingAfter)) : 'رصيد بلا فواتير مفتوحة'}
                      </td>
                      <td data-label="" style={{ padding: '8px 12px', whiteSpace: 'nowrap', display: 'flex', gap: 8, alignItems: 'center' }}>
                        {can('zoho.apply_credits') && r.applicable > 0.5 && (
                          <button onClick={() => setApplyTarget({ zohoId: r.zohoId, name: r.name, zohoUrl: r.zohoUrl })}
                            style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--green)', background: 'color-mix(in srgb, var(--green) 12%, transparent)',
                              border: '1px solid color-mix(in srgb, var(--green) 30%, transparent)', borderRadius: 7, padding: '4px 10px', cursor: 'pointer' }}>
                            طبّق تلقائياً
                          </button>
                        )}
                        {r.applicable <= 0.5 && <span style={{ fontSize: 10.5, color: 'var(--muted2)' }}>لا فواتير مفتوحة</span>}
                        {r.zohoUrl
                          ? <a href={r.zohoUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--accent)', textDecoration: 'none' }}>زوهو ↗</a>
                          : <span style={{ fontSize: 11, color: 'var(--muted2)' }}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ padding: '8px 14px', fontSize: 10.5, color: 'var(--muted2)', borderTop: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ flex: 1, minWidth: 180 }}>
                  «طبّق تلقائياً» يُطبّق الرصيد في زوهو (تطبيق فقط — لا إنشاء/حذف). أو افتح «زوهو ↗» وطبّق يدوياً.
                </span>
                {isAdmin && (
                  <button onClick={grantWriteAccess}
                    style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', background: 'transparent',
                      border: '1px solid var(--border)', borderRadius: 7, padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    🔑 منح صلاحية التطبيق (مرة واحدة)
                  </button>
                )}
              </div>
            </div>
          )}
        </Card>
      )}

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
        {/* «لم تصلهم مطالبة» — مدينون بهاتف لم يصلهم قالب sadad قط (سدّ فجوة الـ29) */}
        {(() => {
          const unclaimedCount = (d?.customers || []).filter(c =>
            c.phone && (c.owed || 0) > 0.5 && !sadadSet.has(normalizeSaudiPhone(c.phone))).length;
          return (
            <Btn size="sm" variant={unclaimedOnly ? 'primary' : 'outline'}
              onClick={() => setUnclaimedOnly(v => !v)}
              title="مدينون لهم هاتف ولم يصلهم قالب المطالبة (sadad) إطلاقاً">
              🔕 لم تصلهم مطالبة ({unclaimedCount})
            </Btn>
          );
        })()}
        {can('campaigns.send') && (
          <Btn size="sm" variant="accent" icon={<MessageCircle size={13}/>} onClick={() => waRecipients.length ? setWaOpen(true) : toast('لا مستلمين بأرقام في القائمة الحالية', 'info')}>
            حملة واتساب ({waRecipients.length})
          </Btn>
        )}
        <Btn size="sm" variant="ghost" icon={<Download size={13}/>} onClick={exportXlsx} disabled={!filtered.length}>تصدير</Btn>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 10 }}>
        عرض <b style={{ color: 'var(--text)' }}>{filtered.length}</b> من {d.customers.length} عميلاً
        {buckets.size ? ` — شرائح ${BUCKETS.filter(b => buckets.has(b.key)).map(b => b.label).join(' + ')}` : ''} ·
        {buckets.size ? 'مجموع الشرائح المختارة ' : 'إجمالي المعروض '}
        <b style={{ color: 'var(--gold)', fontFamily: 'var(--font-mono)' }}>{fmt(filteredTotal)}</b> ر.س
        {buckets.size > 0 && <span style={{ color: 'var(--muted2)' }}> — الحملة تُرسل بهذا المبلغ لا كامل الدين</span>}
      </div>

      {/* ── بطاقات العملاء ── */}
      {!filtered.length ? <Card><Empty icon="🎉" title="لا ديون في هذا العرض" sub="جرّب فلتراً آخر"/></Card> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(330px,100%),1fr))', gap: 10 }}>
          {filtered.map(c => (
            <CustomerCard key={c.name} c={c} highlight={buckets}
              wa={waStatus.get(normalizeSaudiPhone(c.phone))}
              onWa={can('campaigns.send') ? openSingleWa : null}/>
          ))}
        </div>
      )}

      <WhatsAppSendModal open={waOpen}
        onClose={() => { setWaOpen(false); setWaSingle(null); }}
        recipients={waOpen ? (waSingle ? [waSingle] : waRecipients) : []}
        bucketLabel={waSingle ? `العميل ${waSingle.name}` : (buckets.size ? `أعمار ${BUCKETS.filter(b => buckets.has(b.key)).map(b => b.label).join(' + ')}` : 'تحصيل العملاء')}
        onSent={() => { loadWaStatus(); loadSadad(); }}/>

      {briefOpen && <MorningBriefModal onClose={() => setBriefOpen(false)}/>}
      {bulkOpen && credits && (
        <BulkApplyModal rows={applicableRows} onGrant={grantWriteAccess}
          onClose={() => setBulkOpen(false)}
          onDone={() => { setBulkOpen(false); setCredits(null); refresh(); }}/>
      )}
      {applyTarget && (
        <ApplyCreditsModal target={applyTarget} onGrant={grantWriteAccess}
          onClose={() => setApplyTarget(null)}
          onDone={() => { setApplyTarget(null); setCredits(null); refresh(); }}/>
      )}
    </div>
  );
}

// مودال «طبّق للكل» — تطبيق أرصدة كل العملاء تسلسلياً مع تقدّم حيّ
function BulkApplyModal({ rows, onClose, onDone, onGrant }) {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [idx, setIdx] = useState(0);
  const [log, setLog] = useState([]);   // [{name, ok, applied, error}]
  const [rateHit, setRateHit] = useState(false);   // توقّف بسبب حصة زوهو
  const totalPlanned = rows.reduce((s, r) => s + r.applicable, 0);
  const appliedSum = log.filter(l => l.ok).reduce((s, l) => s + (l.applied || 0), 0);
  const authFailed = log.some(l => !l.ok && /authoriz|صلاح/i.test(l.error || ''));

  const run = async () => {
    setRunning(true);
    for (let i = 0; i < rows.length; i++) {
      setIdx(i + 1);
      const r = rows[i];
      const res = await applyZohoCredits(r.zohoId);
      // تجاوز حصة زوهو → أوقف واعرض بانر (يُكمل المستخدم لاحقاً بأمان)
      if (res?.rate_limited) { setRateHit(true); break; }
      const entry = res?.ok
        ? { name: r.name, ok: !(res.results || []).some(x => !x.ok), applied: res.applied,
            error: (res.results || []).find(x => !x.ok)?.error || null }
        : { name: r.name, ok: false, applied: 0, error: res?.error || 'فشل' };
      setLog(prev => [...prev, entry]);
      // أوقف فوراً لو المشكلة صلاحية (لا فائدة من إكمال البقية)
      if (!entry.ok && /authoriz|صلاح/i.test(entry.error || '')) break;
      // مباعدة بسيطة لتفادي ضرب حصة زوهو (~100 طلب/دقيقة)
      await sleep(1200);
    }
    setRunning(false);
    setDone(true);
  };

  const okCount = log.filter(l => l.ok).length;
  const failCount = log.filter(l => !l.ok).length;

  return (
    <Modal title={`تطبيق أرصدة كل العملاء (${rows.length})`} onClose={running ? undefined : onClose} width={560}>
      {!running && !done ? (
        <div>
          <div style={{ fontSize: 13, lineHeight: 1.8, marginBottom: 14 }}>
            سيُطبَّق الرصيد الدائن على فواتير <b>{rows.length}</b> عميلاً دفعة واحدة — إجمالي متوقّع
            <b style={{ color: 'var(--green)', fontFamily: 'var(--font-mono)' }}> {fmt(totalPlanned)}</b> ر.س.
            <br/><span style={{ fontSize: 12, color: 'var(--muted)' }}>
              عملية آمنة: تطبيق رصيد موجود على فاتورة موجودة فقط — لا إنشاء ولا حذف. تُكتب في Zoho Books.
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-start' }}>
            <Btn variant="accent" onClick={run}>⚡ ابدأ تطبيق الكل ({rows.length})</Btn>
            <Btn variant="ghost" onClick={onClose}>إلغاء</Btn>
          </div>
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            {running && <Spinner size={16}/>}
            <div style={{ fontSize: 13, fontWeight: 700 }}>
              {running ? `جارٍ… ${idx}/${rows.length}` : `انتهى — ✓ ${okCount} نجح${failCount ? ` · ✗ ${failCount} فشل` : ''}`}
            </div>
            <div style={{ marginInlineStart: 'auto', fontSize: 13, fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--green)' }}>
              {fmt(appliedSum)} ر.س
            </div>
          </div>
          {/* شريط تقدّم */}
          <div style={{ height: 6, borderRadius: 3, background: 'var(--surface2)', overflow: 'hidden', marginBottom: 12 }}>
            <div style={{ width: `${(log.length / rows.length) * 100}%`, height: '100%', background: 'var(--green)', transition: 'width .2s' }}/>
          </div>
          <div className="m-flow" style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}>
            {log.map((l, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, padding: '6px 10px', borderTop: i ? '1px solid var(--border)' : 'none' }}>
                <span>{l.ok ? '✓' : '✗'}</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</span>
                <span style={{ fontFamily: 'var(--font-mono)', color: l.ok ? 'var(--green)' : 'var(--red)' }}>
                  {l.ok ? fmt(l.applied) : (l.error || 'فشل').slice(0, 40)}
                </span>
              </div>
            ))}
          </div>
          {authFailed && (
            <div style={{ marginTop: 10, padding: '9px 12px', borderRadius: 8, fontSize: 12, background: 'color-mix(in srgb, var(--gold) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--gold) 30%, transparent)' }}>
              توقّف بسبب رفض صلاحية الكتابة. <Btn size="sm" variant="accent" onClick={onGrant} style={{ marginInlineStart: 8 }}>🔑 منح الصلاحية</Btn>
            </div>
          )}
          {rateHit && (
            <div style={{ marginTop: 10, padding: '9px 12px', borderRadius: 8, fontSize: 12, lineHeight: 1.7, background: 'color-mix(in srgb, var(--gold) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--gold) 30%, transparent)' }}>
              توقّف مؤقتاً — حصة زوهو ممتلئة (~100 طلب/دقيقة). انتظر دقيقة و«طبّق للكل» مجدداً؛ ما طُبِّق محفوظ والباقي يُكمَّل بأمان (لا ازدواج).
            </div>
          )}
          {done && (
            <div style={{ marginTop: 14, textAlign: 'left' }}>
              <Btn variant="primary" onClick={onDone}>تم</Btn>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// مودال تطبيق الأرصدة الدائنة — معاينة (قراءة) ثم تأكيد التطبيق (كتابة في زوهو)
function ApplyCreditsModal({ target, onClose, onDone, onGrant }) {
  const [plan, setPlan] = useState(null);   // null=جارٍ · {ok,...} · {error}
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    planZohoApplyCredits(target.zohoId).then(setPlan).catch(e => setPlan({ ok: false, error: String(e) }));
  }, [target.zohoId]);

  const doApply = async () => {
    setApplying(true);
    const r = await applyZohoCredits(target.zohoId);
    setApplying(false);
    if (r?.rate_limited) { toast('حصة زوهو ممتلئة مؤقتاً — انتظر دقيقة وأعد المحاولة', 'info'); if (r.applied > 0) setDone(r); return; }
    if (r?.ok) { setDone(r); if (!r.results?.some(x => !x.ok)) toast(`تم تطبيق ${fmt(r.applied)} ر.س ✓`, 'success'); }
    else toast(`فشل التطبيق: ${r?.error || 'غير معروف'}`, 'error');
  };

  return (
    <Modal title={`تطبيق الرصيد الدائن — ${target.name}`} onClose={onClose} width={560}>
      {plan == null ? <div style={{ padding: 30, textAlign: 'center' }}><Spinner/></div>
        : !plan.ok ? <div style={{ color: 'var(--red)', fontSize: 13, padding: 12 }}>خطأ: {plan.error}</div>
        : done ? (
          <div>
            {done.applied > 0 && (
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--green)', marginBottom: 10 }}>
                ✓ طُبِّق {fmt(done.applied)} ر.س على {done.count} فاتورة
              </div>
            )}
            {done.results?.filter(x => !x.ok).map((x, i) => (
              <div key={i} style={{ fontSize: 12, color: 'var(--red)' }}>{x.source || x.invoice}: {x.error}</div>
            ))}
            {(done.role_error || done.results?.some(x => !x.ok && /authoriz|scope|permission|صلاح/i.test(x.error || ''))) && (
              <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 8, fontSize: 12, lineHeight: 1.75,
                background: 'color-mix(in srgb, var(--gold) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--gold) 30%, transparent)' }}>
                زوهو رفض التطبيق الآلي (صلاحية OAuth للكتابة لم تُمنَح رغم إعادة الموافقة).
                <b> الأضمن: طبّقه يدوياً في زوهو بنقرة</b> — بحسابك الذي يملك الصلاحية كاملة:
                <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {target.zohoUrl && (
                    <a href={target.zohoUrl} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
                      <Btn size="sm" variant="accent">افتح العميل في زوهو ↗</Btn>
                    </a>
                  )}
                  <Btn size="sm" variant="ghost" onClick={onGrant}>🔑 إعادة منح الصلاحية</Btn>
                </div>
              </div>
            )}
            <div style={{ marginTop: 14, textAlign: 'left' }}><Btn variant="primary" onClick={onDone}>تم</Btn></div>
          </div>
        ) : !plan.plan?.length ? (
          <div style={{ fontSize: 13, color: 'var(--muted)', padding: 12 }}>لا فواتير مفتوحة لتطبيق الرصيد عليها.</div>
        ) : (
          <div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.7, marginBottom: 12 }}>
              سيُطبَّق <b style={{ color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>{fmt(plan.total_applied)}</b> ر.س
              من الرصيد الدائن على <b>{plan.plan.length}</b> فاتورة (الأقدم أولاً). **هذه العملية تكتب في Zoho Books** —
              تطبيق رصيد موجود فقط، لا تُنشئ ولا تحذف أي فاتورة.
            </div>
            <div className="m-flow" style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
              {plan.plan.map((p, i) => (
                <div key={p.invoice_id} style={{ padding: '9px 12px', borderTop: i ? '1px solid var(--border)' : 'none', fontSize: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>{p.number} · {p.date}</span>
                    <span>يُطبَّق <b style={{ color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>{fmt(p.applied)}</b>{p.remaining > 0.5 ? ` · يبقى ${fmt(p.remaining)}` : ' · يُصفَّر ✓'}</span>
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--muted2)', marginTop: 2 }}>{(p.detail || []).join(' · ')}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-start' }}>
              <Btn variant="accent" onClick={doApply} disabled={applying}>
                {applying ? <><Spinner size={13}/> جارٍ التطبيق في زوهو…</> : `أكّد التطبيق في زوهو (${fmt(plan.total_applied)} ر.س)`}
              </Btn>
              <Btn variant="ghost" onClick={onClose} disabled={applying}>إلغاء</Btn>
            </div>
          </div>
        )}
    </Modal>
  );
}

// إعداد ملخّص الصباح — رسالة واتساب يومية 7:15 صباحاً بأرقام هذه الشاشة
function MorningBriefModal({ onClose }) {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(null);
  const [sending, setSending] = useState(false);

  useEffect(() => { loadMorningBriefConfig().then(setCfg).catch(() => setCfg({ enabled: false, phone: '', templateName: '', templateLanguage: 'ar', channelId: '' })); }, []);

  const save = async (next) => {
    setCfg(next); setSaving(true);
    try { await saveMorningBriefConfig(next); } catch (e) { toast(`تعذّر الحفظ: ${e.message}`, 'error'); }
    setSaving(false);
  };
  const doPreview = async () => {
    setPreview('...');
    const r = await previewMorningBrief();
    setPreview(r?.ok ? r.vars : `خطأ: ${r?.error || 'غير معروف'}`);
  };
  const doSendNow = async () => {
    setSending(true);
    const r = await sendMorningBriefNow();
    setSending(false);
    if (r?.ok && !r.skipped) toast(`أُرسل الملخّص ✓ (نجح ${r.sent ?? 1})`, 'success');
    else if (r?.skipped) toast('الملخّص معطَّل — فعّله واحفظ أولاً', 'warn');
    else toast(`فشل الإرسال: ${r?.error || 'غير معروف'}`, 'error');
  };

  const VAR_LABELS = ['التاريخ', 'لك عند العملاء', 'منها متأخرة', 'حصّلنا هذا الشهر', 'أكبر 3 مدينين', 'فواتير تنتظر نظرتك'];

  return (
    <Modal title="🌅 ملخّص الصباح — واتساب يومي" onClose={onClose} width={540}>
      {!cfg ? <div style={{ padding: 30, textAlign: 'center' }}><Spinner/></div> : (
        <div>
          <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7, marginBottom: 12 }}>
            رسالة تصلك كل يوم <b>7:15 صباحاً</b> بأرقام هذه الشاشة: المستحق، المتأخر، التحصيل،
            أكبر المدينين، والفواتير المنتظرة. تحتاج قالباً معتمداً في Hatif بستة متغيّرات.
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
            <input type="checkbox" checked={cfg.enabled} onChange={e => save({ ...cfg, enabled: e.target.checked })}/>
            تفعيل الإرسال اليومي
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Input label="رقم المستلِم (05… أو 9665…)" value={cfg.phone}
              onChange={e => setCfg({ ...cfg, phone: e.target.value })}
              onBlur={() => save(cfg)} placeholder="05XXXXXXXX"/>
            <Input label="اسم القالب المعتمد" value={cfg.templateName}
              onChange={e => setCfg({ ...cfg, templateName: e.target.value })}
              onBlur={() => save(cfg)} placeholder="morning_brief"/>
            <Input label="لغة القالب" value={cfg.templateLanguage}
              onChange={e => setCfg({ ...cfg, templateLanguage: e.target.value })}
              onBlur={() => save(cfg)} placeholder="ar"/>
            <Input label="معرّف القناة (اختياري)" value={cfg.channelId}
              onChange={e => setCfg({ ...cfg, channelId: e.target.value })}
              onBlur={() => save(cfg)}/>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted2)', margin: '8px 0 12px' }}>
            متغيّرات القالب بالترتيب: {VAR_LABELS.map((l, i) => `{{${i + 1}}} ${l}`).join(' · ')}
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <Btn size="sm" variant="ghost" onClick={doPreview}>معاينة الأرقام</Btn>
            <Btn size="sm" variant="accent" onClick={doSendNow} disabled={sending || !cfg.enabled || !cfg.phone || !cfg.templateName}>
              {sending ? <Spinner size={13}/> : 'أرسل الآن (تجربة)'}
            </Btn>
            {saving && <span style={{ fontSize: 11, color: 'var(--muted)', alignSelf: 'center' }}>يحفظ…</span>}
          </div>

          {Array.isArray(preview) && (
            <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', fontSize: 12 }}>
              {preview.map((v, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, padding: '3px 0' }}>
                  <span style={{ color: 'var(--muted)', minWidth: 120 }}>{VAR_LABELS[i]}</span>
                  <b>{v}</b>
                </div>
              ))}
            </div>
          )}
          {typeof preview === 'string' && preview !== '...' && (
            <div style={{ color: 'var(--red)', fontSize: 12 }}>{preview}</div>
          )}
          {preview === '...' && <Spinner size={16}/>}
        </div>
      )}
    </Modal>
  );
}

// بطاقة عميل — الاسم والمبلغ وأزرار الفعل، وفواتيره بنقرة
// wa = حالة آخر حملة واتساب لهذا الهاتف (من whatsapp_campaign_status) · onWa = يطلق حملة لعميل واحد
function CustomerCard({ c, highlight, wa: waStat, onWa }) {
  const [open, setOpen] = useState(false);
  const [invs, setInvs] = useState(null);
  const digits = String(c.phone || '').replace(/\D/g, '');
  const waChat = digits ? `https://wa.me/${digits.startsWith('05') ? '966' + digits.slice(1) : digits}` : null;

  const toggleInvoices = async () => {
    const next = !open;
    setOpen(next);
    if (next && invs == null) {
      try { setInvs(await loadZohoOpenInvoices(c.name)); }
      catch { setInvs([]); }
    }
  };

  const ageColor = c.oldestDays > 90 ? 'var(--red)' : c.oldestDays > 60 ? 'color-mix(in srgb, var(--gold) 50%, var(--red))' : c.oldestDays > 30 ? 'var(--gold)' : 'var(--green)';

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
        {/* محفظة المنصّة — تُعرَض هنا حتى لا يحتاج المشغّل صفحة أخرى.
            دفع مسبق برصيد موجب يغطّي الدين = «خصم من المحفظة» لا تحصيل. */}
        {(c.walletBalance || 0) > 0.5 && (
          <Chip color="var(--green)">
            💰 محفظة +{fmt(c.walletBalance)}{c.walletBalance >= c.owed ? ' — تغطّي الدين' : ''}
          </Chip>
        )}
        {(c.walletBalance || 0) < -0.5 && (
          <Chip color="var(--red)">محفظة {fmt(c.walletBalance)} (دفع مسبق سالب)</Chip>
        )}
      </div>

      {/* حالة آخر حملة واتساب — متى استلمها + هل ردّ + هل سدّد بعدها */}
      {waStat && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 10, alignItems: 'center',
          borderTop: '1px dashed var(--border)', paddingTop: 6 }}>
          <span style={{ color: 'var(--muted2)' }}>📲 آخر حملة {fmtDate(waStat.lastSentAt)}{waStat.sends > 1 ? ` (${waStat.sends}×)` : ''}</span>
          {waStat.paidAfter
            ? <Chip color="var(--green)">✅ سدّد بعدها {waStat.paidAt ? fmtDate(waStat.paidAt) : ''}</Chip>
            : waStat.replied ? <Chip color="var(--brand)">💬 ردّ — لم يسدّد</Chip>
            : waStat.read ? <Chip color="var(--muted)">قرأها — لا رد</Chip>
            : waStat.delivered ? <Chip color="var(--muted)">وصلت</Chip>
            : waStat.status === 'Failed' ? <Chip color="var(--red)">فشل الإرسال</Chip>
            : <Chip color="var(--muted)">أُرسلت</Chip>}
        </div>
      )}

      {/* شريط أعمار مصغّر */}
      <div style={{ display: 'flex', height: 5, borderRadius: 3, overflow: 'hidden', background: 'var(--surface2)' }}>
        {BUCKETS.map(b => {
          const v = c[b.key] || 0;
          if (v <= 0.5) return null;
          return <div key={b.key} style={{ width: `${(v / c.owed) * 100}%`, background: b.color,
            opacity: (!highlight || highlight.size === 0 || highlight.has(b.key)) ? 1 : 0.25 }}/>;
        })}
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {digits && (
          <IvrCallButton phone={digits} name={c.storeName || c.name}
            fields={{ name: c.storeName || c.name, amount: c.owed, overdue: c.overdue, wallet: c.walletBalance,
              invoices_count: c.invCnt, oldest_days: c.oldestDays, last_shipment: c.lastShipmentAt }}
            label size={13} style={{ flex: 1, justifyContent: 'center', padding: '8px 0', fontSize: 12, fontWeight: 700 }}/>
        )}
        {digits && onWa && (
          <button onClick={() => onWa(c)} title="إطلاق حملة واتساب لهذا العميل (قالب معتمد)"
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            padding: '8px 0', borderRadius: 8, background: 'color-mix(in srgb, var(--green) 12%, transparent)',
            border: '1px solid color-mix(in srgb, var(--green) 35%, transparent)',
            color: 'var(--green)', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
            <MessageCircle size={13}/> حملة واتساب
          </button>
        )}
        {digits && waChat && (
          <a href={waChat} target="_blank" rel="noreferrer" title="محادثة يدوية (بلا قالب)"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 9px', borderRadius: 8,
            background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', textDecoration: 'none' }}>
            💬
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

      {digits && (
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <CustomerCallLog phone={digits}/>
          <TagButton phone={digits} name={c.storeName || c.name}
            suggest={[...(c.owed > 0.5 ? ['عليه مديونية'] : []), ...(c.oldestDays > 90 ? ['متأخر 90 يوم'] : []), ...(c.billingType === 'دفع مسبق' ? ['دفع مسبق'] : [])]}/>
        </div>
      )}
      {digits && <div style={{ marginTop: 4 }}><CustomerCommTimeline phone={digits}/></div>}
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

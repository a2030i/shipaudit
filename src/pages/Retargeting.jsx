// داشبورد إعادة استهداف العملاء (المرحلة 2) — يحوّل كشف المتاجر (stores.xlsx)
// إلى قائمة فرص قابلة للتنفيذ: مؤشّرات + نسبة التغيّر عند كل رفعة + توزيع
// الشرائح/الأولوية/الربط + فلاتر كاملة + جدول فرص مُرقّم. يقرأ محرّك التصنيف
// (v_crm_retargeting) عبر retargetingService — عميل فريد بالهاتف.
import { useState, useEffect, useCallback } from 'react';
import { Target, RefreshCw, Phone, MessageCircle, ChevronLeft, ChevronRight, Search, Send, Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import { rtl } from '../lib/xlsxRtl.js';
import { persistAndDownloadExport } from '../lib/internalExportsService.js';
import { Card, Btn, Spinner, Empty, PageHeader, Modal, toast } from '../components/UI.jsx';
import IvrCallButton from '../components/IvrCallButton.jsx';
import { useAuth } from '../lib/auth.jsx';
import { loadEmployees } from '../lib/employeeService.js';
import {
  loadRetargetingDashboard, loadRetargetingLeads, loadRetargetingFollowupStats, setRetargetingFollowup,
  loadRetargetingCampaign, loadRetargetingStatusChanges, bulkSetFollowups,
  SEGMENTS, PRIORITIES, CHANNELS, STATUSES, segmentMeta, priorityMeta, statusMeta,
} from '../lib/retargetingService.js';
import { loadWhatsAppCampaignStatus, normalizeSaudiPhone, waStatusBadge } from '../lib/whatsappService.js';
import WhatsAppSendModal from '../components/WhatsAppSendModal.jsx';
import { CustomerCampaignHistory } from '../components/WhatsAppCampaignLog.jsx';

const fmt0 = (n) => Number(n || 0).toLocaleString('en-US');
const fmt2 = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtK = (n) => { const a = Math.abs(n); return a >= 1000 ? (n / 1000).toFixed(1) + 'ك' : String(Math.round(n)); };
const fmtDate = (d) => { if (!d) return ''; try { return new Date(d).toLocaleDateString('ar-SA', { day: 'numeric', month: 'short' }); } catch { return String(d).slice(0, 10); } };
// عميل → مستلِم حملة: متغيّرات القالب {{1}} اسم المتجر · {{2}} عدد الشحنات · {{3}} أيام آخر شحنة
const leadToRecipient = (l) => ({
  to: normalizeSaudiPhone(l.phone), name: l.storeName, amount: null,
  vars: [l.storeName || '', String(l.totalShipments || 0), l.daysSinceLast == null ? '—' : `${l.daysSinceLast} يوم`],
  // أعمدة الصفحة المتاحة لربط متغيرات القالب ديناميكياً (مودال الإرسال)
  fields: {
    name: l.storeName, shipments: l.totalShipments,
    last_shipment: l.lastShipment, days_since: l.daysSinceLast,
    wallet: l.wallet,
  },
});
const waLink = (p) => { const d = String(p || '').replace(/\D/g, ''); return d ? `https://wa.me/${d}` : null; };
const telLink = (p) => { const d = String(p || '').replace(/\D/g, ''); return d ? `tel:+${d}` : null; };

// المؤشّرات: goodUp = هل ارتفاع الرقم إيجابي (لتلوين فرق الرفعة).
const KPIS = [
  { key: 'unique_customers', label: 'عملاء (بلا تكرار)', color: '#06B6D4', goodUp: true },
  { key: 'prio_a',           label: 'أولوية A (اتصال)', color: 'var(--red)', goodUp: false },
  { key: 'stopped',          label: 'متوقّفون', color: '#F97316', goodUp: false },
  { key: 'never_shipped',    label: 'سجّلوا ولم يشحنوا', color: '#8B5CF6', goodUp: false },
  { key: 'high_value',       label: 'قيمة عالية', color: 'var(--gold)', goodUp: true },
  { key: 'active',           label: 'نشطون', color: 'var(--green)', goodUp: true },
  { key: 'with_balance',     label: 'لهم رصيد', color: '#0EA5E9', goodUp: true },
  { key: 'negative_balance', label: 'رصيد سالب', color: 'var(--red)', goodUp: false },
];

function Delta({ d, goodUp }) {
  if (!d || Math.abs(d.abs) < 0.5) return <span style={{ fontSize: 10.5, color: 'var(--muted2)' }}>= لا تغيّر</span>;
  const up = d.abs > 0;
  const good = up === goodUp;
  const col = good ? 'var(--green)' : 'var(--red)';
  return (
    <span style={{ fontSize: 10.5, color: col, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
      {up ? '▲' : '▼'} {fmtK(Math.abs(d.abs))}{d.pct != null ? ` (${d.pct > 0 ? '+' : ''}${d.pct}%)` : ''}
    </span>
  );
}

function Sel({ value, onChange, children }) {
  return (
    <select value={value} onChange={onChange} style={{
      padding: '8px 10px', border: '1px solid var(--border2)', borderRadius: 9,
      background: 'var(--surface)', color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-sans)', width: '100%',
    }}>{children}</select>
  );
}

const LIMIT = 50;

export default function Retargeting({ isActive = true }) {
  const { can, user, isAdmin } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [bulkOwner, setBulkOwner] = useState('');   // إسناد جماعي للنتائج المفلترة
  const [assigning, setAssigning] = useState(false);
  const [dash, setDash] = useState(null);
  const [fuStats, setFuStats] = useState(null);
  const [campaign, setCampaign] = useState(null);
  const [statusChanges, setStatusChanges] = useState([]);
  const [view, setView] = useState('leads');   // 'leads' | 'campaign'
  const [employees, setEmployees] = useState([]);
  const [leads, setLeads] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [followUp, setFollowUp] = useState(null);   // العميل المفتوح في مودال المتابعة
  const [waStatus, setWaStatus] = useState(() => new Map());   // حالة آخر حملة لكل هاتف
  const [waRecipients, setWaRecipients] = useState(null);      // مستلمو حملة (bulk أو عميل واحد)
  const [prepCampaign, setPrepCampaign] = useState(false);     // يجهّز كل المطابق للحملة
  // الموظف يفتح على «المسندة لي» افتراضياً (§1.37) — المدير يرى الكل
  const [filters, setFilters] = useState(() => ({
    segment: '', priority: '', integration: '', billing: '', hasBalance: false, q: '',
    status: '', ownerId: (!isAdmin && user?.id) ? user.id : '', unassigned: false, includeExcluded: false,
    campaign: '', page: 0,   // آخر حملة منذ: '' | none | within7 | within30 | older30
  }));

  const loadDash = useCallback(async () => {
    setLoading(true);
    try {
      const [d, fs, emp, camp, chg] = await Promise.all([
        loadRetargetingDashboard(),
        loadRetargetingFollowupStats().catch(() => null),
        loadEmployees().catch(() => []),
        loadRetargetingCampaign().catch(() => null),
        loadRetargetingStatusChanges(40).catch(() => []),
      ]);
      setDash(d); setFuStats(fs); setEmployees(emp || []); setCampaign(camp); setStatusChanges(chg || []);
    } catch (e) { toast(`فشل تحميل الداشبورد: ${e.message}`, 'error'); }
    setLoading(false);
  }, []);

  const loadList = useCallback(async () => {
    setListLoading(true);
    try {
      const r = await loadRetargetingLeads({
        segment: filters.segment || null, priority: filters.priority || null,
        integration: filters.integration || null, billing: filters.billing || null,
        hasBalance: filters.hasBalance ? true : null, q: filters.q || null,
        status: filters.status || null, ownerId: filters.ownerId || null,
        unassigned: filters.unassigned ? true : null, includeExcluded: filters.includeExcluded,
        campaign: filters.campaign || null,
        page: filters.page, limit: LIMIT,
      });
      setLeads(r.rows); setCount(r.count);
    } catch (e) { toast(`فشل تحميل الفرص: ${e.message}`, 'error'); }
    setListLoading(false);
  }, [filters]);

  const loadWa = useCallback(() => loadWhatsAppCampaignStatus().then(setWaStatus).catch(() => {}), []);

  useEffect(() => { if (isActive) loadDash(); }, [isActive, loadDash]);
  useEffect(() => { if (isActive) loadList(); }, [isActive, loadList]);
  useEffect(() => { if (isActive) loadWa(); }, [isActive, loadWa]);

  const setFilter = (patch) => setFilters(prev => ({ ...prev, ...patch, page: patch.page ?? 0 }));

  // تصدير كل النتائج بالفلاتر الحالية (لا الصفحة المعروضة فقط) — صفحات 500
  // (فخّ PostgREST-1000 §1.34) عبر persistAndDownloadExport (قاعدة §1.13).
  const exportXlsx = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const base = {
        segment: filters.segment || null, priority: filters.priority || null,
        integration: filters.integration || null, billing: filters.billing || null,
        hasBalance: filters.hasBalance ? true : null, q: filters.q || null,
        status: filters.status || null, ownerId: filters.ownerId || null,
        unassigned: filters.unassigned ? true : null, includeExcluded: filters.includeExcluded,
        campaign: filters.campaign || null,
      };
      const all = [];
      for (let page = 0; page < 60; page++) {
        const r = await loadRetargetingLeads({ ...base, page, limit: 500 });
        all.push(...r.rows);
        if (!r.rows.length || all.length >= r.count) break;
      }
      if (!all.length) { toast('لا نتائج للتصدير بالفلاتر الحالية', 'info'); setExporting(false); return; }
      const headers = ['المتجر', 'الهاتف', 'المجموعة', 'الأولوية', 'القناة المقترحة', 'الشحنات',
        'آخر شحنة', 'أيام منذ آخر شحنة', 'المحفظة', 'نوع الفوترة', 'الربط', 'حالة المتابعة', 'المسؤول', 'ملاحظات'];
      const aoa = [
        ['إعادة استهداف العملاء', '', new Date().toISOString().slice(0, 10)],
        [],
        headers,
        ...all.map(l => [l.storeName, l.phone || '', segmentMeta(l.segment).label, priorityMeta(l.priority).label,
          CHANNELS[l.channel] || l.channel || '', l.totalShipments,
          l.lastShipment ? new Date(l.lastShipment).toLocaleDateString('en-CA') : '',
          l.daysSinceLast ?? '', l.wallet, l.billingType || '', l.integrationType || '',
          statusMeta(l.status).label, l.ownerName || '', l.notes || '']),
      ];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = headers.map((_, i) => ({ wch: i === 0 ? 30 : (i === 13 ? 36 : 13) }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'الفرص');
      rtl(wb);
      await persistAndDownloadExport({
        wb, fileName: `اعادة_الاستهداف_${new Date().toISOString().slice(0, 10)}.xlsx`,
        kind: 'retargeting', rowCount: all.length, userId: user?.id || null,
      });
      toast(`صُدّر ${fmt0(all.length)} عميل ✓ (محفوظ في سجل الملفات)`, 'success');
    } catch (e) { toast(`فشل التصدير: ${e.message}`, 'error'); }
    setExporting(false);
  };

  // إسناد جماعي: كل النتائج المطابقة للفلاتر (لا الصفحة فقط) — يجمع الهواتف
  // صفحات-صفحات ثم RPC واحدة (§1.37 — كان الإسناد فردياً عبر المودال فقط)
  const bulkAssign = async () => {
    if (!bulkOwner) return;
    const emp = employees.find(e => e.id === bulkOwner);
    if (!window.confirm(`إسناد كل النتائج المطابقة (${fmt0(count)} فرصة) إلى ${emp?.name || 'الموظف'}؟`)) return;
    setAssigning(true);
    try {
      const base = {
        segment: filters.segment || null, priority: filters.priority || null,
        integration: filters.integration || null, billing: filters.billing || null,
        hasBalance: filters.hasBalance ? true : null, q: filters.q || null,
        status: filters.status || null, ownerId: filters.ownerId || null,
        unassigned: filters.unassigned ? true : null, includeExcluded: filters.includeExcluded,
        campaign: filters.campaign || null,
      };
      const phones = [];
      for (let page = 0; page < 60; page++) {
        const r = await loadRetargetingLeads({ ...base, page, limit: 500 });
        phones.push(...r.rows.map(x => x.phone).filter(Boolean));
        if (!r.rows.length || phones.length >= r.count) break;
      }
      const n = await bulkSetFollowups(phones, { ownerId: bulkOwner });
      toast(`أُسندت ${fmt0(n)} فرصة إلى ${emp?.name || 'الموظف'} ✓`, 'success');
      setBulkOwner('');
      loadList(); loadDash();
    } catch (e) { toast(`فشل الإسناد: ${e.message}`, 'error'); }
    setAssigning(false);
  };

  const canCampaign = can('campaigns.send');
  // إطلاق حملة على **كل** المطابق للفلاتر (لا الصفحة المعروضة فقط) — نفس نمط
  // exportXlsx/bulkAssign: صفحات 500 حتى الاكتمال. الجدولة تقسّمها دفعات آلياً.
  const openBulkCampaign = async () => {
    if (prepCampaign) return;
    setPrepCampaign(true);
    try {
      const base = {
        segment: filters.segment || null, priority: filters.priority || null,
        integration: filters.integration || null, billing: filters.billing || null,
        hasBalance: filters.hasBalance ? true : null, q: filters.q || null,
        status: filters.status || null, ownerId: filters.ownerId || null,
        unassigned: filters.unassigned ? true : null, includeExcluded: filters.includeExcluded,
        campaign: filters.campaign || null,
      };
      const all = [];
      for (let page = 0; page < 60; page++) {
        const r = await loadRetargetingLeads({ ...base, page, limit: 500 });
        all.push(...r.rows);
        if (!r.rows.length || all.length >= r.count) break;
      }
      const recs = all.filter(l => l.phone).map(leadToRecipient);
      if (!recs.length) { toast('لا مستلمون بأرقام بالفلاتر الحالية', 'info'); return; }
      setWaRecipients(recs);
    } catch (e) { toast(`تعذّر تجهيز المستلمين: ${e.message}`, 'error'); }
    finally { setPrepCampaign(false); }
  };

  // تفصيص 2026-07-16: sales.view = هذا التبويب حصراً (أُزيل fallback crm.view)
  if (!can('sales.view')) return <div style={{ padding: 40 }}><Empty icon="🔒" title="لا صلاحية" sub="تحتاج صلاحية «تبويب إعادة الاستهداف»"/></div>;

  const st = dash?.stats || {};
  const totalPages = Math.max(1, Math.ceil(count / LIMIT));
  const integrations = Object.entries(dash?.integrations || {}).sort((a, b) => b[1] - a[1]);

  return (
    <div style={{ padding: '24px 28px 80px', maxWidth: 1320, margin: '0 auto' }}>
      <PageHeader icon={<Target size={22}/>} iconColor="#8B5CF6"
        title="إعادة استهداف العملاء"
        subtitle="كشف المتاجر → فرص قابلة للتنفيذ · عميل واحد لكل رقم · أولوية واضحة"
        meta={dash ? `${fmt0(st.unique_customers)} عميل (بلا تكرار) · ${fmt0(st.total_stores)} متجر · ${fmt0(st.total_shipments)} شحنة` : null}
        actions={
          <>
            {can('sales.export') && (
              <Btn size="sm" variant="ghost" icon={exporting ? <Spinner size={13}/> : <Download size={13}/>}
                onClick={exportXlsx} disabled={exporting || !count}>
                {exporting ? 'يصدّر…' : `تصدير النتائج (${fmt0(count)})`}
              </Btn>
            )}
            <Btn size="sm" variant="ghost" onClick={() => { loadDash(); loadList(); }} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''}/></Btn>
          </>
        }
      />

      {!dash && loading ? <div style={{ padding: 60, textAlign: 'center' }}><Spinner/></div> : dash && (<>
        {/* نسبة التغيّر عند الرفع */}
        <div style={{ fontSize: 12, marginBottom: 12, color: dash.hasPrevious ? 'var(--text2)' : 'var(--muted)' }}>
          {dash.hasPrevious
            ? <>📊 المقارنة مع الرفعة السابقة — الأسهم أسفل كل مؤشّر</>
            : <>📊 هذه أول رفعة مُلتقَطة — نسبة التغيّر ستظهر تلقائياً عند رفع ملف متاجر جديد</>}
        </div>

        {/* ملخّص المتابعة */}
        {fuStats && (
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, marginBottom: 12, color: 'var(--text2)' }}>
            <span>📞 مُسنَدون: <b style={{ fontFamily: 'var(--font-mono)' }}>{fmt0(fuStats.assigned)}</b></span>
            <span>⏰ متابعة مستحقّة اليوم: <b style={{ color: '#F97316', fontFamily: 'var(--font-mono)' }}>{fmt0(fuStats.dueToday)}</b></span>
            <span>✅ عادوا للشحن: <b style={{ color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>{fmt0(fuStats.returned)}</b></span>
            <span>🤝 مهتمّون: <b style={{ fontFamily: 'var(--font-mono)' }}>{fmt0(fuStats.byStatus?.interested || 0)}</b></span>
          </div>
        )}

        {/* مبدّل العرض: الفرص / أداء الحملة */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {[['leads', '🎯 الفرص'], ['campaign', '📈 أداء الحملة']].map(([v, lbl]) => (
            <button key={v} onClick={() => setView(v)} style={{
              padding: '8px 16px', borderRadius: 9, cursor: 'pointer', fontSize: 12.5, fontWeight: 700,
              border: `1.5px solid ${view === v ? '#8B5CF6' : 'var(--border)'}`,
              background: view === v ? 'color-mix(in srgb, #8B5CF6 12%, transparent)' : 'transparent', color: 'var(--text)',
            }}>{lbl}</button>
          ))}
        </div>

        {view === 'campaign' && <CampaignView campaign={campaign} changes={statusChanges}/>}

        {view === 'leads' && (<>
        {/* المؤشّرات + فرق الرفعة */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }} className="hero-grid">
          {KPIS.map(k => (
            <Card key={k.key} style={{ padding: '12px 14px', borderTop: `3px solid ${k.color}` }}>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 4 }}>{k.label}</div>
              <div style={{ fontSize: 21, fontWeight: 800, color: k.color, fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
                {fmt0(st[k.key])}
              </div>
              {k.key === 'with_balance' && <div style={{ fontSize: 10, color: 'var(--muted2)', marginTop: 2 }}>{fmt2(st.balance_total)} ر.س</div>}
              {dash.hasPrevious && <div style={{ marginTop: 4 }}><Delta d={dash.delta[k.key]} goodUp={k.goodUp}/></div>}
            </Card>
          ))}
        </div>

        {/* توزيع الشرائح */}
        <SectionTitle>الشرائح</SectionTitle>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          {Object.entries(dash.segments).sort((a, b) => b[1] - a[1]).map(([seg, cnt]) => {
            const m = segmentMeta(seg);
            const on = filters.segment === seg;
            return (
              <button key={seg} onClick={() => setFilter({ segment: on ? '' : seg })} style={{
                display: 'flex', alignItems: 'center', gap: 7, padding: '7px 12px', borderRadius: 10, cursor: 'pointer',
                border: `1.5px solid ${on ? m.color : 'var(--border)'}`,
                background: on ? `color-mix(in srgb, ${m.color} 14%, transparent)` : 'transparent',
              }}>
                <span>{m.icon}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{m.label}</span>
                <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{fmt0(cnt)}</span>
              </button>
            );
          })}
        </div>
        {/* توضيح: شرائح «لم يشحن» الثلاث = تقسيم إجمالي من لم يشحن نهائياً (لا أرقام متناقضة) */}
        {(() => {
          const nt = (dash.segments.registered_no_ship || 0) + (dash.segments.linked_no_ship || 0) + (dash.segments.topped_no_ship || 0);
          if (!nt) return null;
          return (
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: -6, marginBottom: 14, lineHeight: 1.7 }}>
              ℹ️ «سجّل ولم يشحن» + «ربط ولم يشحن» + «شحن رصيد ولم يشحن» = تقسيم الـ<b style={{ color: 'var(--text)' }}>{fmt0(nt)}</b> متجر
              الذين <b>لم يشحنوا نهائياً</b> (نفس رقم فلتر «آخر شحنة = لم يشحن» في المتاجر) — كل متجر في شريحة واحدة، فلا تكرار.
            </div>
          );
        })()}

        {/* توزيع الأولوية + الربط */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginBottom: 16 }}>
          <Card style={{ padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: 'var(--muted)' }}>الأولوية</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {['A', 'B', 'C', 'D', 'FIN', 'none'].filter(p => dash.priorities[p]).map(p => {
                const m = priorityMeta(p); const on = filters.priority === p;
                return (
                  <button key={p} onClick={() => setFilter({ priority: on ? '' : p })} style={{
                    padding: '5px 10px', borderRadius: 999, cursor: 'pointer', fontSize: 11.5, fontWeight: 700,
                    border: `1.5px solid ${m.color}`, color: on ? '#fff' : m.color,
                    background: on ? m.color : `color-mix(in srgb, ${m.color} 10%, transparent)`,
                  }}>{m.label} · {fmt0(dash.priorities[p])}</button>
                );
              })}
            </div>
          </Card>
          <Card style={{ padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: 'var(--muted)' }}>نوع الربط</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {integrations.map(([intg, cnt]) => {
                const val = intg === '(بلا ربط)' ? 'none' : intg;
                const on = filters.integration === val;
                return (
                  <button key={intg} onClick={() => setFilter({ integration: on ? '' : val })} style={{
                    padding: '5px 10px', borderRadius: 999, cursor: 'pointer', fontSize: 11.5, fontWeight: 600,
                    border: `1.5px solid ${on ? '#8B5CF6' : 'var(--border)'}`,
                    background: on ? 'color-mix(in srgb, #8B5CF6 14%, transparent)' : 'transparent', color: 'var(--text)',
                  }}>{intg} · {fmt0(cnt)}</button>
                );
              })}
            </div>
          </Card>
        </div>

        {/* الفلاتر الكاملة */}
        <Card style={{ padding: 12, marginBottom: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 1.4fr) repeat(4, minmax(120px, 1fr))', gap: 8 }} className="crm-lead-filters">
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', top: 10, insetInlineStart: 10, color: 'var(--muted)' }}/>
              <input value={filters.q} onChange={e => setFilter({ q: e.target.value })} placeholder="ابحث باسم المتجر أو الجوال..."
                style={{ width: '100%', padding: '8px 32px 8px 10px', border: '1px solid var(--border2)', borderRadius: 9, background: 'var(--surface)', color: 'var(--text)' }}/>
            </div>
            <Sel value={filters.segment} onChange={e => setFilter({ segment: e.target.value })}>
              <option value="">كل الشرائح</option>
              {Object.entries(SEGMENTS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
            </Sel>
            <Sel value={filters.priority} onChange={e => setFilter({ priority: e.target.value })}>
              <option value="">كل الأولويات</option>
              {Object.entries(PRIORITIES).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
            </Sel>
            <Sel value={filters.integration} onChange={e => setFilter({ integration: e.target.value })}>
              <option value="">كل أنواع الربط</option>
              <option value="none">بلا ربط</option>
              {integrations.filter(([i]) => i !== '(بلا ربط)').map(([i]) => <option key={i} value={i}>{i}</option>)}
            </Sel>
            <Sel value={filters.billing} onChange={e => setFilter({ billing: e.target.value })}>
              <option value="">كل الفوترة</option>
              <option value="دفع مسبق">دفع مسبق</option>
              <option value="دفع لاحق">دفع لاحق</option>
            </Sel>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 150 }}>
              <Sel value={filters.status} onChange={e => setFilter({ status: e.target.value })}>
                <option value="">كل حالات المتابعة</option>
                {Object.entries(STATUSES).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
              </Sel>
            </div>
            <div style={{ minWidth: 150 }}>
              <Sel value={filters.ownerId} onChange={e => setFilter({ ownerId: e.target.value, unassigned: false })}>
                <option value="">كل الموظفين</option>
                {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name || emp.email}</option>)}
              </Sel>
            </div>
            {/* آخر حملة منذ — كي لا نراسل من راسلناه قريباً (خادمياً، فلا حدود للعدد) */}
            <div style={{ minWidth: 160 }}>
              <Sel value={filters.campaign} onChange={e => setFilter({ campaign: e.target.value })}>
                <option value="">📲 آخر حملة: الكل</option>
                <option value="none">بلا حملة إطلاقاً</option>
                <option value="within7">راسلناه خلال 7 أيام</option>
                <option value="within30">راسلناه خلال 30 يوم</option>
                <option value="older30">آخر حملة أقدم من 30 يوم</option>
              </Sel>
            </div>
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--muted)' }}>
              <input type="checkbox" checked={filters.hasBalance} onChange={e => setFilter({ hasBalance: e.target.checked })}/> له رصيد فقط
            </label>
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--muted)' }}>
              <input type="checkbox" checked={filters.unassigned} onChange={e => setFilter({ unassigned: e.target.checked, ownerId: '' })}/> بدون موظف
            </label>
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--muted)' }}>
              <input type="checkbox" checked={filters.includeExcluded} onChange={e => setFilter({ includeExcluded: e.target.checked })}/> إظهار المستبعَدين (بلاك لست/تجريبي)
            </label>
            {isAdmin && (
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <select value={bulkOwner} onChange={e => setBulkOwner(e.target.value)}
                  style={{ padding: '6px 10px', borderRadius: 8, fontSize: 12, border: '1px solid var(--border2)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }}>
                  <option value="">إسناد النتائج لموظف…</option>
                  {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name || emp.email}</option>)}
                </select>
                {bulkOwner && (
                  <Btn size="sm" variant="accent" onClick={bulkAssign} disabled={assigning || !count}>
                    {assigning ? 'يُسند…' : `إسناد ${fmt0(count)}`}
                  </Btn>
                )}
              </span>
            )}
            {canCampaign && (
              <Btn size="sm" variant="accent" icon={<Send size={13}/>} style={{ marginInlineStart: 'auto' }}
                onClick={openBulkCampaign} disabled={prepCampaign || !count}>
                {prepCampaign ? 'يجهّز المستلمين…' : `إطلاق حملة لكل المطابق (${fmt0(count)})`}
              </Btn>
            )}
            <span style={{ marginInlineStart: canCampaign ? 0 : 'auto', fontSize: 12, color: 'var(--muted)' }}>عرض {leads.length} من {fmt0(count)} فرصة</span>
          </div>
        </Card>

        {/* جدول الفرص */}
        {listLoading && !leads.length ? <div style={{ padding: 40, textAlign: 'center' }}><Spinner/></div>
          : !leads.length ? <Empty icon="🎯" title="لا فرص بهذه الفلاتر" sub="خفّف الفلاتر أو ارفع كشف متاجر أحدث"/>
          : (
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <table className="m-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr style={{ background: 'var(--surface2)', textAlign: 'right' }}>
                {['المتجر', 'الجوال', 'الشحنات', 'آخر شحنة', 'المحفظة', 'الربط', 'الشريحة', 'الأولوية', 'المتابعة', 'إجراء'].map(h =>
                  <th key={h} style={{ padding: '10px 12px', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {leads.map((l, i) => {
                  const sm = segmentMeta(l.segment); const pm = priorityMeta(l.priority); const stm = statusMeta(l.status);
                  return (
                    <tr key={l.phone + i} onClick={() => setFollowUp(l)} style={{ borderTop: '1px solid var(--border)', cursor: 'pointer' }}>
                      <td data-label="المتجر" style={{ padding: '10px 12px', fontWeight: 700 }}>
                        {l.storeName}{l.highValue && <span title="قيمة عالية" style={{ marginInlineStart: 4 }}>⭐</span>}
                        {l.storeCount > 1 && (
                          <div title={(l.storeNames || []).join(' · ')} style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>
                            {l.storeCount} متاجر: {(l.storeNames || []).slice(0, 3).join(' · ')}{(l.storeNames || []).length > 3 ? ' …' : ''}
                          </div>
                        )}
                      </td>
                      <td data-label="الجوال" style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', direction: 'ltr', textAlign: 'right' }}>{l.phone || '—'}</td>
                      <td data-label="الشحنات" style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)' }}>{fmt0(l.totalShipments)}</td>
                      <td data-label="آخر شحنة" style={{ padding: '10px 12px', color: 'var(--muted)' }}>{l.daysSinceLast == null ? '—' : `${l.daysSinceLast} يوم`}</td>
                      <td data-label="المحفظة" style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', color: l.wallet < 0 ? 'var(--red)' : l.wallet > 0.5 ? 'var(--green)' : 'var(--muted)' }}>{fmt2(l.wallet)}</td>
                      <td data-label="الربط" style={{ padding: '10px 12px', color: 'var(--muted)', fontSize: 11.5 }}>{l.integrationType || 'بلا'} · {l.billingType || '—'}</td>
                      <td data-label="الشريحة" style={{ padding: '10px 12px' }}>
                        <span style={{ display: 'inline-flex', gap: 4, padding: '2px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, color: sm.color, background: `color-mix(in srgb, ${sm.color} 12%, transparent)` }}>{sm.icon} {sm.label}</span>
                      </td>
                      <td data-label="الأولوية" style={{ padding: '10px 12px' }}>
                        <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, color: '#fff', background: pm.color }}>{l.priority}</span>
                        <div style={{ fontSize: 10, color: 'var(--muted2)', marginTop: 2 }}>{CHANNELS[l.channel] || l.channel}</div>
                      </td>
                      <td data-label="المتابعة" style={{ padding: '10px 12px' }}>
                        <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, color: stm.color, background: `color-mix(in srgb, ${stm.color} 12%, transparent)` }}>{stm.label}</span>
                        {l.ownerName && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>👤 {l.ownerName}</div>}
                        {l.nextActionAt && <div style={{ fontSize: 10, color: '#F97316', marginTop: 2 }}>⏰ {new Date(l.nextActionAt).toLocaleDateString('en-CA')}</div>}
                        {l.notes && <div title={l.notes} style={{ fontSize: 10, color: 'var(--text2)', marginTop: 2, maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📝 {l.notes}</div>}
                        {(() => { const w = waStatus.get(normalizeSaudiPhone(l.phone)); if (!w) return null;
                          const st = waStatusBadge(w);
                          return <div style={{ fontSize: 10, color: st.c, fontWeight: 600, marginTop: 2 }}>📲 حملة {fmtDate(w.lastSentAt)}{w.sends > 1 ? ` (${w.sends}×)` : ''} · {st.t}</div>; })()}
                      </td>
                      <td data-label="إجراء" style={{ padding: '10px 12px' }}>
                        {/* «كل شي على هاتف» (2026-07-16): wa.me الحرة أُزيلت — زر الحملة
                            يظهر للجميع والمودال يوضّح الصلاحية الناقصة (لا إخفاء صامت) */}
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          {l.phone && <IvrCallButton phone={l.phone} name={l.storeName}
                            fields={{ name: l.storeName, shipments: l.totalShipments, last_shipment: l.lastShipment, days_since: l.daysSinceLast, wallet: l.wallet }} size={15}/>}
                          {l.phone && <button onClick={e => { e.stopPropagation(); setWaRecipients([leadToRecipient(l)]); }} title="إرسال واتساب عبر هاتف (قالب معتمد — يُسجَّل)" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--green)', padding: 0, display: 'flex' }}><Send size={15}/></button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}

        {/* الترقيم */}
        {count > LIMIT && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center', marginTop: 14 }}>
            <Btn size="sm" variant="ghost" disabled={filters.page <= 0} onClick={() => setFilter({ page: Math.max(0, filters.page - 1) })}><ChevronRight size={14}/> السابق</Btn>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>صفحة {filters.page + 1} من {totalPages}</span>
            <Btn size="sm" variant="ghost" disabled={filters.page + 1 >= totalPages} onClick={() => setFilter({ page: filters.page + 1 })}>التالي <ChevronLeft size={14}/></Btn>
          </div>
        )}
        </>)}
      </>)}

      {followUp && (
        <FollowupModal
          lead={followUp} employees={employees}
          canCampaign={canCampaign}
          onCampaign={(l) => { setFollowUp(null); setWaRecipients([leadToRecipient(l)]); }}
          onClose={() => setFollowUp(null)}
          onSaved={() => { setFollowUp(null); loadList(); loadDash(); }}
        />
      )}

      {waRecipients && (
        <WhatsAppSendModal open={!!waRecipients} recipients={waRecipients}
          bucketLabel="إعادة الاستهداف"
          onClose={() => setWaRecipients(null)}
          onSent={(r) => {
            // ختم حالة المتابعة «أُرسل واتساب» للمستلمين (§1.37 — كان الإرسال
            // الرسمي لا يلمس المتابعة بينما wa.me اليدوية تختمها). المجدولة لا
            // تُختم الآن (لم تُرسل بعد — المشغّل يرسلها لاحقاً).
            const phones = (waRecipients || []).map(x => x.to).filter(Boolean);
            setWaRecipients(null); loadWa();
            if (!r?.scheduled && phones.length) {
              bulkSetFollowups(phones, { status: 'whatsapp_sent', touch: true })
                .then(() => loadList()).catch(() => {});
            }
          }}/>
      )}
    </div>
  );
}

function SectionTitle({ children }) {
  return <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text2)', margin: '4px 0 8px' }}>{children}</div>;
}

// عرض أداء الحملة (المرحلة 4): قمع التحويل + أداء الموظفين + الشرائح + سجلّ التغيّرات.
function CampaignView({ campaign, changes }) {
  if (!campaign) return <div style={{ padding: 40, textAlign: 'center' }}><Spinner/></div>;
  const f = campaign.funnel || {};
  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
  const steps = [
    { k: 'worked', label: 'عُمل عليه', val: f.worked, of: f.universe, green: false },
    { k: 'contacted', label: 'تم التواصل', val: f.contacted, of: f.worked, green: false },
    { k: 'interested', label: 'مهتم', val: f.interested, of: f.contacted, green: false },
    { k: 'returned', label: 'عاد للشحن ✅', val: f.returned, of: f.interested, green: true },
  ];
  const th = { padding: '8px 10px', textAlign: 'right', fontSize: 11, color: 'var(--muted)' };
  const td = { padding: '8px 10px', fontFamily: 'var(--font-mono)' };
  return (<>
    {!f.worked && <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 12 }}>لا نشاط بعد — ابدأ العمل على الفرص (اتصال/واتساب/تحديث الحالة) لتظهر نتائج الحملة هنا.</div>}
    {/* العودة الآلية — مقارنة الشحنات بين أحدث رفعتين (موضوعية، بلا تعليم يدوي) */}
    {campaign.reactivations?.hasPrevious && (() => {
      const rx = campaign.reactivations;
      return (
        <div style={{ marginBottom: 16 }}>
          <SectionTitle>العودة الآلية للشحن — بين رفعتَي {rx.previousDate} ← {rx.currentDate}</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }} className="hero-grid">
            <Card style={{ padding: '12px 14px', borderTop: '3px solid var(--green)' }}>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 4 }}>عادوا بفضل الحملة</div>
              <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--green)', lineHeight: 1 }}>{fmt0(rx.workedReactivated)}</div>
              <div style={{ fontSize: 10.5, color: 'var(--muted2)', marginTop: 3 }}>من {fmt0(rx.workedTotal)} عميل عُمل عليه</div>
            </Card>
            <Card style={{ padding: '12px 14px', borderTop: '3px solid var(--green)' }}>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 4 }}>شحنات ناتجة (الحملة)</div>
              <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--green)', lineHeight: 1 }}>{fmt0(rx.workedShipments)}</div>
            </Card>
            <Card style={{ padding: '12px 14px', borderTop: '3px solid #06B6D4' }}>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 4 }}>إجمالي العائدين (المنصّة)</div>
              <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--font-mono)', color: '#06B6D4', lineHeight: 1 }}>{fmt0(rx.allReactivated)}</div>
              <div style={{ fontSize: 10.5, color: 'var(--muted2)', marginTop: 3 }}>{fmt0(rx.allShipments)} شحنة إجمالاً</div>
            </Card>
          </div>
        </div>
      );
    })()}
    <SectionTitle>مراحل التحويل (النجاح = عاد للشحن)</SectionTitle>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }} className="hero-grid">
      {steps.map(s => (
        <Card key={s.k} style={{ padding: '12px 14px', borderTop: `3px solid ${s.green ? 'var(--green)' : '#8B5CF6'}` }}>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 4 }}>{s.label}</div>
          <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--font-mono)', color: s.green ? 'var(--green)' : 'var(--text)', lineHeight: 1 }}>{fmt0(s.val)}</div>
          <div style={{ fontSize: 10.5, color: 'var(--muted2)', marginTop: 3 }}>{pct(s.val, s.of)}% من السابق</div>
        </Card>
      ))}
      <Card style={{ padding: '12px 14px', borderTop: '3px solid var(--red)' }}>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 4 }}>خسارة/عوائق</div>
        <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--red)', lineHeight: 1 }}>{fmt0((f.lost || 0) + (f.blocked || 0))}</div>
        <div style={{ fontSize: 10.5, color: 'var(--muted2)', marginTop: 3 }}>{fmt0(f.lost)} غير مهتم · {fmt0(f.blocked)} عائق</div>
      </Card>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '10px 12px', fontWeight: 700, fontSize: 12.5, background: 'var(--surface2)' }}>أداء الموظفين</div>
        {!campaign.byOwner.length ? <div style={{ padding: 16, fontSize: 12, color: 'var(--muted)' }}>لا إسنادات بعد</div> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead><tr>{['الموظف', 'عُمل', 'تواصل', 'مهتم', 'عاد'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{campaign.byOwner.map((o, i) => (
              <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ ...td, fontWeight: 600, fontFamily: 'var(--font-sans)' }}>{o.name}</td>
                <td style={td}>{fmt0(o.worked)}</td><td style={td}>{fmt0(o.contacted)}</td><td style={td}>{fmt0(o.interested)}</td>
                <td style={{ ...td, color: 'var(--green)', fontWeight: 700 }}>{fmt0(o.returned)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '10px 12px', fontWeight: 700, fontSize: 12.5, background: 'var(--surface2)' }}>أداء الشرائح</div>
        {!campaign.bySegment.length ? <div style={{ padding: 16, fontSize: 12, color: 'var(--muted)' }}>لا نشاط بعد</div> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead><tr>{['الشريحة', 'عُمل', 'مهتم', 'عاد'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{campaign.bySegment.map((s, i) => { const m = segmentMeta(s.segment); return (
              <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ ...td, fontFamily: 'var(--font-sans)' }}><span style={{ color: m.color, fontWeight: 700 }}>{m.icon} {m.label}</span></td>
                <td style={td}>{fmt0(s.worked)}</td><td style={td}>{fmt0(s.interested)}</td>
                <td style={{ ...td, color: 'var(--green)', fontWeight: 700 }}>{fmt0(s.returned)}</td>
              </tr>
            ); })}</tbody>
          </table>
        )}
      </Card>
    </div>
    {changes && changes.length > 0 && (
      <div style={{ marginTop: 16 }}>
        <SectionTitle>آخر تغييرات الحالات (تبقى عبر رفعات الملفات)</SectionTitle>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead><tr>{['المتجر', 'من', 'إلى', 'بواسطة', 'التاريخ'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{changes.map((c, i) => {
              const from = c.oldStatus ? statusMeta(c.oldStatus) : { label: '—', color: 'var(--muted)' };
              const to = statusMeta(c.newStatus);
              return (
                <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ ...td, fontFamily: 'var(--font-sans)', fontWeight: 600 }}>{c.storeName || c.phone}</td>
                  <td style={{ ...td, color: from.color, fontFamily: 'var(--font-sans)' }}>{from.label}</td>
                  <td style={{ ...td, color: to.color, fontWeight: 700, fontFamily: 'var(--font-sans)' }}>{to.label}</td>
                  <td style={{ ...td, fontFamily: 'var(--font-sans)' }}>{c.changedBy}</td>
                  <td style={{ ...td, color: 'var(--muted)' }}>{new Date(c.changedAt).toLocaleDateString('en-CA')}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </Card>
      </div>
    )}
  </>);
}

const inp = { width: '100%', padding: '8px 10px', border: '1px solid var(--border2)', borderRadius: 9, background: 'var(--surface)', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--font-sans)' };
const lbl = { fontSize: 12, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 };

function FollowupModal({ lead, employees, onClose, onSaved, canCampaign, onCampaign }) {
  const [status, setStatus] = useState(lead.status || 'new');
  const [ownerId, setOwnerId] = useState(lead.ownerId || '');
  const [nextAt, setNextAt] = useState(lead.nextActionAt ? String(lead.nextActionAt).slice(0, 10) : '');
  const [notes, setNotes] = useState(lead.notes || '');
  const [saving, setSaving] = useState(false);

  const save = async (touch, overrideStatus) => {
    setSaving(true);
    try {
      await setRetargetingFollowup(lead.phone, {
        status: overrideStatus || status, ownerId: ownerId || null,
        nextAt: nextAt ? new Date(nextAt).toISOString() : null, notes, touch: !!touch,
      });
      toast('تم حفظ المتابعة', 'success');
      onSaved();
    } catch (e) { toast(`فشل الحفظ: ${e.message}`, 'error'); setSaving(false); }
  };
  const quick = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 9, textDecoration: 'none', fontSize: 12.5, fontWeight: 700, border: '1px solid var(--border2)' };

  return (
    <Modal title={`متابعة — ${lead.storeName}`} onClose={onClose} width={480}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} className="m-flow">
        <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--font-mono)', direction: 'ltr' }}>{lead.phone}</span>
          <span>{fmt0(lead.totalShipments)} شحنة</span>
          <span>{lead.daysSinceLast == null ? 'لم يشحن' : `آخر شحنة ${lead.daysSinceLast}ي`}</span>
          {lead.wallet > 0.5 && <span style={{ color: 'var(--green)' }}>محفظة {fmt2(lead.wallet)}</span>}
        </div>
        {lead.storeCount > 1 && (
          <div style={{ fontSize: 11.5, color: 'var(--text2)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px' }}>
            🏬 متاجره ({lead.storeCount}): {(lead.storeNames || []).join(' · ')}
          </div>
        )}
        {/* أزرار سريعة: تفتح القناة وتسجّل الحالة + آخر تواصل */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {telLink(lead.phone) && <a href={telLink(lead.phone)} onClick={() => save(true, 'contacted')} style={{ ...quick, color: 'var(--text)' }}><Phone size={14}/> اتصلت</a>}
          {/* «كل شي على هاتف»: wa.me أُزيلت (كانت تختم whatsapp_sent وهي محادثة يدوية
              بلا قالب ولا تسجيل — قياس مضلِّل). زر الحملة للجميع والمودال يوضّح الصلاحية */}
          {lead.phone && <button onClick={() => onCampaign?.(lead)} style={{ ...quick, color: 'var(--green)', background: 'color-mix(in srgb, var(--green) 10%, transparent)', cursor: 'pointer' }}><Send size={14}/> إرسال واتساب (هاتف)</button>}
          <Btn size="sm" variant="ghost" onClick={() => save(false, 'blacklist')} disabled={saving}>🚫 بلاك لست</Btn>
          <Btn size="sm" variant="ghost" onClick={() => save(false, 'test')} disabled={saving}>🧪 تجريبي</Btn>
        </div>

        {/* تاريخ الحملات المُرسَلة لهذا العميل */}
        <div>
          <label style={lbl}>📲 الحملات المُرسَلة لهذا العميل</label>
          <CustomerCampaignHistory phone={lead.phone}/>
        </div>
        <div><label style={lbl}>الحالة / نتيجة التواصل</label>
          <Sel value={status} onChange={e => setStatus(e.target.value)}>{Object.entries(STATUSES).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}</Sel></div>
        <div><label style={lbl}>الموظف المسؤول</label>
          <Sel value={ownerId} onChange={e => setOwnerId(e.target.value)}><option value="">— بلا —</option>{employees.map(e => <option key={e.id} value={e.id}>{e.name || e.email}</option>)}</Sel></div>
        <div><label style={lbl}>موعد المتابعة القادمة</label>
          <input type="date" value={nextAt} onChange={e => setNextAt(e.target.value)} style={inp}/></div>
        <div><label style={lbl}>ملاحظات (سبب التوقّف / تفاصيل)</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} style={{ ...inp, resize: 'vertical' }}/></div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <Btn variant="ghost" onClick={onClose} disabled={saving}>إلغاء</Btn>
          <Btn variant="accent" onClick={() => save(false, null)} disabled={saving}>حفظ المتابعة</Btn>
        </div>
      </div>
    </Modal>
  );
}

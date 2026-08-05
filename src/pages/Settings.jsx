import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import CarrierTabs from '../components/CarrierTabs.jsx';
import {
  ExternalLink, Package, History, Search, Filter, Trash2,
  CheckCircle2, AlertTriangle, Calendar, FileText, Truck, X,
} from 'lucide-react';
import { Card, Btn, Input, Select, Modal, Empty, Spinner, toast, PageHeader } from '../components/UI.jsx';
import { History as HistoryIcon } from 'lucide-react';
import { loadAuditsFromDB, deleteAuditFromDB, loadAuditByIdFromDB, loadCarriers, loadAuditShipments } from '../lib/coreService.js';
import { loadLinkedAuditIndex } from '../lib/carrierStatementsService.js';
import { exportMergedExcessWeights } from '../engine/export.js';
import { useAuth } from '../lib/auth.jsx';

const TABS = [
  { id: 'ai',          label: '✨ الذكاء الاصطناعي' },
  { id: 'data',        label: '🗄️ البيانات' },
];

// ── Settings ──────────────────────────────────────────────────────────────────
export function SettingsPage({ carriers = [], tab = 'ai' }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const setTab = (id) => navigate(`/settings/${id}`);
  const handleExport = async () => {
    if (!can('reports.export')) {
      toast('لا تملك صلاحية إنشاء وتنزيل النسخة الاحتياطية', 'error');
      return;
    }
    try {
      const audits = await loadAuditsFromDB(200);
      const data = { carriers, audits };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `shipaudit_backup_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      toast('تم تصدير البيانات', 'success');
    } catch (e) {
      toast(`خطأ في التصدير: ${e.message}`, 'error');
    }
  };

  return (
    <div style={{padding:'28px 32px',maxWidth:620}}>
      <h2 style={{fontFamily:'var(--font-mono)',color:'var(--accent)',marginBottom:20}}>⚙️ الإعدادات</h2>

      {/* Tabs */}
      <div style={{display:'flex',gap:4,marginBottom:24,background:'var(--surface)',borderRadius:10,padding:4,border:'1px solid var(--border)'}}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex:1, padding:'8px 4px', borderRadius:7, border:'none', cursor:'pointer',
            fontFamily:'var(--font-sans)', fontSize:12, fontWeight: tab===t.id ? 700 : 400,
            background: tab===t.id ? 'var(--card)' : 'transparent',
            color: tab===t.id ? 'var(--text)' : 'var(--muted)',
            boxShadow: tab===t.id ? '0 1px 4px rgba(0,0,0,.3)' : 'none',
            transition:'all .15s',
          }}>{t.label}</button>
        ))}
      </div>


      {/* Nav Permissions tab */}

      {/* Data tab */}
      <div style={{display: tab==='data' ? 'block' : 'none'}}>
        <Card>
          <h3 style={{fontSize:14,fontWeight:700,marginBottom:14}}>🗄️ البيانات</h3>
          <div style={{display:'flex',gap:10}}>
            {can('reports.export') && <Btn size="sm" variant="ghost" onClick={handleExport}>
              ⬇️ تصدير نسخة احتياطية
            </Btn>}
          </div>
        </Card>
      </div>

      {/* AI tab */}
      {tab === 'ai' && <>
      <Card style={{marginBottom:20}}>
        <h3 style={{fontSize:14,fontWeight:700,marginBottom:16,display:'flex',alignItems:'center',gap:8}}>
          <span>✨</span> الذكاء الاصطناعي الآمن
        </h3>

        <div style={{background:'color-mix(in srgb, var(--green) 9%, var(--surface))',border:'1px solid color-mix(in srgb, var(--green) 30%, var(--border))',borderRadius:8,padding:'12px 14px',marginBottom:16,fontSize:12,lineHeight:1.8}}>
          <strong style={{color:'var(--green)'}}>إعداد الخادم محمي</strong><br/>
          المفتاح والنموذج يُداران داخل أسرار الخادم، ولا يُحفظان في المتصفح أو على جهاز الموظف.
        </div>

        <div style={{background:'var(--surface)',borderRadius:8,padding:'10px 14px',marginBottom:16,fontSize:12,lineHeight:1.8,color:'var(--muted)'}}>
          <strong style={{color:'var(--text)'}}>حدود الاستخدام الحالية:</strong><br/>
          • المساعد متاح فقط لمن يملك صلاحية «استخدام المساعد الذكي».<br/>
          • التقارير المسموحة مجمّعة ومحددة مسبقاً من الخادم.<br/>
          • لا تُرسل صفوف Excel أو أسماء العملاء أو أرقام الفواتير إلى مزود الذكاء الاصطناعي.<br/>
          • لا يستطيع المساعد تعديل البيانات أو تنفيذ استعلامات حرة.
        </div>
      </Card>
      </>}
    </div>
  );
}

// Visual map for the per-audit type badge. Keys match deriveAuditType()
// in src/engine/audit.js — keep in sync.
const AUDIT_TYPE_META = {
  domestic:      { label: 'محلي',                 icon: '🇸🇦', color: 'var(--green)' },
  international: { label: 'دولي',                 icon: '🌐', color: 'var(--gold)' },
  cod:           { label: 'دفع عند الاستلام',     icon: '💰', color: 'var(--accent)' },
  mixed:         { label: 'مختلط',                icon: '🔀', color: 'var(--accent3)' },
  unknown:       { label: 'غير محدد',             icon: '❓', color: 'var(--muted)' },
};

// ── Audits History ─────────────────────────────────────────────────────────────
export function AuditsHistory({ onOpen, isActive = true }) {
  const navigate = useNavigate();
  // Carrier-workspace scoping: /audits?carrier=X narrows the history to one
  // carrier and shows the workspace tab bar (CarrierTabs) so the user can hop
  // between the carrier's screens without losing context.
  const [historySearchParams] = useSearchParams();
  const scopedCarrierId = historySearchParams.get('carrier') || null;
  const [audits,  setAudits]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState(null);
  const [opening, setOpening] = useState(null);
  // Map(audit_id → { opId, docNo, carrierId }) — which op (if any) each audit
  // is linked to. Drives the "🔗 مرتبطة بـ X" badge + the "افتح في الدفتر"
  // jump button + disables the delete button.
  const [linkedIndex, setLinkedIndex] = useState(new Map());
  // Set<auditId> for the merged excess-weight export. Cleared on
  // successful export and on isActive transitions.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [exporting, setExporting] = useState(false);

  // Re-fetch each time the page becomes active so newly-saved audits show up.
  useEffect(() => {
    if (!isActive) return;
    setLoading(true);
    Promise.all([
      loadAuditsFromDB(),
      loadLinkedAuditIndex().catch(() => new Map()),
    ])
      .then(([data, idx]) => {
        setAudits(data);
        setLinkedIndex(idx);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [isActive]);

  const handleDelete = async (id) => {
    try {
      await deleteAuditFromDB(id);
      setAudits(prev => prev.filter(a => a.id !== id));
      toast('تم حذف المراجعة', 'info');
    } catch (e) {
      // Service throws a localized message when the audit is linked to an op.
      toast(e.message || 'فشل الحذف', 'error');
    }
    setConfirm(null);
  };

  const handleOpen = async (id) => {
    setOpening(id);
    try {
      const full = await loadAuditByIdFromDB(id);
      onOpen(full);
    } catch (e) {
      toast(`خطأ في التحميل: ${e.message}`, 'error');
    }
    setOpening(null);
  };

  const toggleSelect = (id) => setSelectedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Multi-audit excess-weight export — load each selected audit's full
  // results (the list view doesn't include them), resolve the active
  // contract per audit, and hand off to exportMergedExcessWeights.
  const handleExportMergedExcess = async () => {
    if (!selectedIds.size) return;
    setExporting(true);
    try {
      const ids = [...selectedIds];
      const [carriers, ...fullAudits] = await Promise.all([
        loadCarriers(),
        ...ids.map(id => loadAuditByIdFromDB(id)),
      ]);
      // Hydrate ALL shipments from audit_shipments — `results` carries only
      // the issues (§1.8), so a clean audit would contribute ZERO rows and
      // its excess weights would silently vanish (same trap as the weights
      // pull, fixed 2026-06-12). Legacy audits with no shipment rows keep
      // their inline results.
      for (const a of fullAudits) {
        const all = [];
        for (let from = 0; ; from += 1000) {
          const page = await loadAuditShipments(a.id, { from, limit: 1000 });
          all.push(...page);
          if (page.length < 1000) break;
        }
        if (all.length) a.results = all;
      }
      const result = exportMergedExcessWeights(fullAudits, carriers);
      if (result.ok) {
        toast(
          `تم تصدير ${result.count} شحنة بوزن إضافي ` +
          `من ${result.auditCount}/${result.selectedCount} مراجعة ✓`,
          'success',
        );
        setSelectedIds(new Set());
      } else if (result.reason === 'empty') {
        toast(
          'لا توجد شحنات تجاوزت الوزن المسموح في المراجعات المحددة',
          'info',
        );
      } else {
        toast('فشل التصدير', 'error');
      }
    } catch (e) {
      toast(`فشل: ${e.message}`, 'error');
    }
    setExporting(false);
  };

  // Jump to the ledger row this audit is linked to (carrier dropdown picks
  // the right carrier; doc_no goes into the search filter so the row is
  // immediately visible).
  const jumpToLedger = (link) => {
    if (!link) return;
    const params = new URLSearchParams();
    if (link.carrierId) params.set('carrier', link.carrierId);
    if (link.docNo)     params.set('doc',     link.docNo);
    navigate(`/ledger?${params.toString()}`);
  };

  if (loading) return (
    <div style={{ display:'flex', justifyContent:'center', padding:60 }}>
      <Spinner size={22}/>
    </div>
  );

  const scopedAudits = scopedCarrierId
    ? audits.filter(a => a.carrierId === scopedCarrierId)
    : audits;
  const scopedCarrierName = scopedCarrierId
    ? (scopedAudits[0]?.carrierName || scopedCarrierId)
    : null;
  const legacyCount = scopedAudits.filter(a => a.verificationStatus !== 'verified').length;

  return (
    <div style={{ padding: '24px 28px 80px', maxWidth: 1320, margin: '0 auto' }}>
      {scopedCarrierId && (
        <CarrierTabs carrierId={scopedCarrierId} carrierName={scopedCarrierName} active="audits"/>
      )}
      <PageHeader
        icon={<HistoryIcon size={22}/>}
        title="سجل المراجعات"
        subtitle="كل فاتورة تم تدقيقها — بحث، فلترة، فتح، ودمج للأوزان الإضافية"
        meta={`${scopedAudits.length} مراجعة في السجل`}
      />

      {legacyCount > 0 && (
        <div style={{
          marginBottom: 14, padding: '12px 14px', borderRadius: 10,
          background: 'color-mix(in srgb, var(--gold) 10%, transparent)',
          border: '1px solid color-mix(in srgb, var(--gold) 40%, transparent)',
          color: 'var(--text)', fontSize: 12.5, lineHeight: 1.7,
        }}>
          <strong style={{ color: 'var(--gold)' }}>{legacyCount} مراجعة قديمة بلا إثبات تدقيق عقدي.</strong>{' '}
          تبقى للرجوع التاريخي، لكنها لا تُربط بقيد مالي ولا تدخل تصدير الأوزان حتى يُعاد رفع ملفها عبر مسار التدقيق الآمن.
        </div>
      )}

      {/* Floating bulk-action bar */}
      {selectedIds.size > 0 && (
        <div style={{
          position: 'sticky', top: 0, zIndex: 5, marginBottom: 14,
          background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 20%, transparent) 0%, rgba(27,30,84,.18) 100%)',
          border: '1px solid var(--accent)', borderRadius: 12,
          padding: '12px 16px',
          display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
          backdropFilter: 'blur(8px)',
          boxShadow: '0 6px 24px color-mix(in srgb, var(--accent) 16%, transparent)',
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'color-mix(in srgb, var(--accent) 25%, transparent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 14, color: 'var(--accent)',
          }}>
            {selectedIds.size}
          </div>
          <span style={{ fontSize: 13, color: 'var(--text)', flex: 1, fontWeight: 600 }}>
            مراجعة محددة — يمكن دمج أوزانها الإضافية في ملف Excel واحد
          </span>
          <Btn size="sm" variant="accent" disabled={exporting} onClick={handleExportMergedExcess}>
            {exporting
              ? <><Spinner size={12}/> جارٍ التصدير...</>
              : <><Package size={12}/> تصدير أوزان مدمجة</>
            }
          </Btn>
          <Btn size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
            إلغاء التحديد
          </Btn>
        </div>
      )}

      <AuditsFilter audits={scopedAudits}>
        {filtered => filtered.length === 0
          ? <Empty icon="🔍" title="لا توجد مراجعات مطابقة" sub="عدّل الفلاتر أو ارفع ملف جديد"/>
          : (() => {
            const visibleIds = filtered
              .filter(a => a.verificationStatus === 'verified')
              .map(a => a.id);
            const allVisibleSelected = visibleIds.length > 0
              && visibleIds.every(id => selectedIds.has(id));
            const toggleSelectAllVisible = () => setSelectedIds(prev => {
              const next = new Set(prev);
              if (allVisibleSelected) {
                for (const id of visibleIds) next.delete(id);
              } else {
                for (const id of visibleIds) next.add(id);
              }
              return next;
            });
            return (
              <>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap',
                  padding: '4px 4px 14px',
                }}>
                  <label style={{
                    display: 'inline-flex', alignItems: 'center', gap: 9,
                    cursor: 'pointer', userSelect: 'none', fontSize: 12.5, color: 'var(--text2)',
                    fontWeight: 600,
                  }}>
                    <input type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAllVisible}
                      style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--accent)' }}
                    />
                    {allVisibleSelected
                      ? `إلغاء التحديد (${filtered.length})`
                      : `تحديد الكل (${filtered.length})`}
                  </label>
                  <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                    {filtered.length} من {audits.length}
                  </span>
                </div>
                <div className="stagger" style={{ display: 'grid', gap: 10 }}>
                  {filtered.map(a => {
                const link       = linkedIndex.get(a.id);
                const typeMeta   = AUDIT_TYPE_META[a.auditType] ?? AUDIT_TYPE_META.unknown;
                const isSelected = selectedIds.has(a.id);
                const isVerified = a.verificationStatus === 'verified';
                const hasIssues  = (a.issueCount ?? 0) > 0;
                const diff       = Number(a.diff ?? 0);
                // Color the left edge by audit health: teal for clean,
                // red for mismatches, gold when selected.
                const stripeColor = !isVerified ? 'var(--gold)'
                                  : isSelected ? 'var(--gold)'
                                  : hasIssues  ? 'var(--red)'
                                  :              'var(--accent)';
                const review = a.reviewStatus || 'pending';
                const reviewMeta = review === 'approved'
                  ? { color: 'var(--accent)', label: '✓ معتمدة', bg: 'color-mix(in srgb, var(--accent) 10%, transparent)', bd: 'color-mix(in srgb, var(--accent) 32%, transparent)' }
                  : review === 'rejected'
                    ? { color: 'var(--red)', label: '✗ مرفوضة', bg: 'color-mix(in srgb, var(--red) 10%, transparent)', bd: 'color-mix(in srgb, var(--red) 32%, transparent)' }
                    : { color: 'var(--gold)', label: '⏳ بانتظار الاعتماد', bg: 'color-mix(in srgb, var(--gold) 10%, transparent)', bd: 'color-mix(in srgb, var(--gold) 32%, transparent)' };
                return (
                  <Card key={a.id} style={{
                    padding: 0, overflow: 'hidden',
                    position: 'relative',
                    border: isSelected ? '1px solid rgba(251,191,36,.55)' : undefined,
                    background: isSelected ? 'rgba(251,191,36,.04)' : undefined,
                    opacity: review === 'rejected' ? 0.65 : 1,
                    transition: 'all .2s',
                  }}>
                    {/* Left status stripe */}
                    <div style={{
                      position: 'absolute', insetInlineStart: 0, top: 0, bottom: 0,
                      width: 4, background: stripeColor,
                    }}/>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'auto 1fr auto auto',
                      gap: 16, padding: '14px 18px 14px 22px', alignItems: 'center',
                    }}>
                      {/* Checkbox + icon */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={!isVerified}
                          onChange={() => isVerified && toggleSelect(a.id)}
                          title={isVerified ? 'حدد لتصدير الأوزان الإضافية مدمجة' : 'أعد رفع الملف أولاً لإثبات التسعير من العقد'}
                          style={{ width: 16, height: 16, cursor: isVerified ? 'pointer' : 'not-allowed', accentColor: 'var(--accent)' }}
                        />
                        <div style={{
                          width: 44, height: 44, borderRadius: 11,
                          background: hasIssues
                            ? 'linear-gradient(135deg, rgba(248,113,113,.18), rgba(248,113,113,.06))'
                            : 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 18%, transparent), rgba(27,30,84,.10))',
                          border: `1px solid ${hasIssues ? 'rgba(248,113,113,.32)' : 'color-mix(in srgb, var(--accent) 32%, transparent)'}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          flexShrink: 0,
                        }}>
                          <Truck size={20} color={hasIssues ? 'var(--red)' : 'var(--accent)'}/>
                        </div>
                      </div>

                      {/* Info */}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--text)' }}>{a.carrierName}</span>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            padding: '2px 9px', borderRadius: 999,
                            background: isVerified
                              ? 'color-mix(in srgb, var(--green) 10%, transparent)'
                              : 'color-mix(in srgb, var(--gold) 10%, transparent)',
                            border: `1px solid ${isVerified ? 'var(--green)' : 'var(--gold)'}`,
                            color: isVerified ? 'var(--green)' : 'var(--gold)',
                            fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap',
                          }}>
                            {isVerified ? '✓ موثقة من العقد' : '⚠ قديمة غير موثقة'}
                          </span>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            padding: '2px 9px', borderRadius: 999,
                            background: reviewMeta.bg,
                            border: `1px solid ${reviewMeta.bd}`,
                            color: reviewMeta.color, fontSize: 10.5, fontWeight: 700,
                            fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap',
                          }}>
                            {reviewMeta.label}
                          </span>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            padding: '2px 9px', borderRadius: 999,
                            background: `color-mix(in srgb, ${typeMeta.color} 14%, transparent)`,
                            border: `1px solid color-mix(in srgb, ${typeMeta.color} 38%, transparent)`,
                            color: typeMeta.color, fontSize: 10.5, fontWeight: 600,
                            fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap',
                          }}>
                            {typeMeta.icon} {typeMeta.label}
                          </span>
                          {link && (
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', gap: 5,
                              padding: '2px 9px', borderRadius: 999,
                              background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
                              border: '1px solid color-mix(in srgb, var(--accent) 32%, transparent)',
                              color: 'var(--accent)', fontSize: 10.5, fontWeight: 600,
                              fontFamily: 'var(--font-mono)',
                            }}>
                              🔗 {link.docNo}
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--muted)' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Calendar size={11}/> {a.period}
                          </span>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Package size={11}/> {(a.rowCount ?? 0).toLocaleString('en-US')} شحنة
                          </span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, opacity: .75 }}>
                            {new Date(a.date).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })}
                          </span>
                        </div>
                      </div>

                      {/* Status panel */}
                      <div style={{
                        padding: '8px 14px', minWidth: 110, textAlign: 'center',
                        background: hasIssues ? 'rgba(248,113,113,.06)' : 'color-mix(in srgb, var(--accent) 6%, transparent)',
                        border: `1px solid ${hasIssues ? 'rgba(248,113,113,.22)' : 'color-mix(in srgb, var(--accent) 22%, transparent)'}`,
                        borderRadius: 10,
                      }}>
                        {!isVerified ? (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--gold)', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12 }}>
                            <AlertTriangle size={12}/> تحتاج إعادة رفع
                          </div>
                        ) : hasIssues ? (
                          <>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--red)', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 13 }}>
                              <AlertTriangle size={12}/> {a.issueCount} فرق
                            </div>
                            <div style={{ color: diff >= 0 ? 'var(--red)' : 'var(--green)', fontFamily: 'var(--font-mono)', fontSize: 11.5, marginTop: 2, fontWeight: 600 }}>
                              {diff >= 0 ? '+' : ''}{diff.toFixed(2)} ر.س
                            </div>
                          </>
                        ) : (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--green)', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 13 }}>
                            <CheckCircle2 size={13}/> مطابق
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        {link && (
                          <Btn size="sm" variant="ghost"
                            title="افتح العملية المرتبطة في الدفتر"
                            onClick={() => jumpToLedger(link)}
                            icon={<ExternalLink size={12}/>}>
                            الدفتر
                          </Btn>
                        )}
                        <Btn size="sm" variant="accent" disabled={opening===a.id}
                          onClick={() => handleOpen(a.id)}>
                          {opening === a.id ? <Spinner size={12}/> : 'فتح'}
                        </Btn>
                        <button
                          disabled={!!link}
                          title={link ? `لا يمكن حذف مراجعة مرتبطة (${link.docNo})` : 'حذف المراجعة'}
                          onClick={() => !link && setConfirm(a.id)}
                          style={{
                            background: link ? 'var(--surface)' : 'rgba(248,113,113,.08)',
                            border: `1px solid ${link ? 'var(--border)' : 'rgba(248,113,113,.28)'}`,
                            color: link ? 'var(--muted3)' : 'var(--red)',
                            cursor: link ? 'not-allowed' : 'pointer',
                            padding: '6px 8px', borderRadius: 8,
                            display: 'inline-flex', alignItems: 'center',
                            opacity: link ? .5 : 1,
                          }}>
                          <Trash2 size={13}/>
                        </button>
                      </div>
                    </div>
                  </Card>
                );
              })}
                </div>
              </>
            );
          })()
        }
      </AuditsFilter>

      {confirm && (
        <Modal title="⚠️ حذف المراجعة" onClose={()=>setConfirm(null)} width={360}>
          <p style={{color:'var(--muted)',marginBottom:20}}>سيتم حذف هذه المراجعة نهائياً.</p>
          <div style={{display:'flex',gap:9,justifyContent:'flex-end'}}>
            <Btn variant="ghost" onClick={()=>setConfirm(null)}>إلغاء</Btn>
            <Btn variant="danger" onClick={()=>handleDelete(confirm)}>حذف</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Audits filter (carrier · month · status · search) ─────────────────────
function AuditsFilter({ audits, children }) {
  const [carrier, setCarrier]   = useState('all');
  const [month,   setMonth]     = useState('all');
  const [status,  setStatus]    = useState('all');
  const [review,  setReview]    = useState('all');
  const [query,   setQuery]     = useState('');

  // Build option lists from data
  const carriers = useMemo(
    () => [...new Set(audits.map(a => a.carrierName).filter(Boolean))].sort(),
    [audits],
  );
  const months = useMemo(
    () => [...new Set(audits.map(a => (a.date || '').slice(0, 7)).filter(Boolean))].sort().reverse(),
    [audits],
  );

  const filtered = useMemo(() => audits.filter(a => {
    if (carrier !== 'all' && a.carrierName !== carrier) return false;
    if (month !== 'all' && (a.date || '').slice(0, 7) !== month) return false;
    if (status === 'issues' && !((a.issueCount ?? 0) > 0)) return false;
    if (status === 'clean'  &&  ((a.issueCount ?? 0) > 0)) return false;
    if (review !== 'all' && (a.reviewStatus || 'pending') !== review) return false;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      const hay = `${a.carrierName} ${a.period} ${a.fileName ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }), [audits, carrier, month, status, review, query]);

  const reset = () => { setCarrier('all'); setMonth('all'); setStatus('all'); setReview('all'); setQuery(''); };
  const hasFilter = carrier !== 'all' || month !== 'all' || status !== 'all' || review !== 'all' || query !== '';

  if (!audits.length) {
    return <Empty icon="📋" title="لا توجد مراجعات بعد" sub="ارفع ملف Excel لبدء أول مراجعة"/>;
  }

  return (
    <>
      <Card style={{ marginBottom: 16, padding: '14px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Filter size={14} color="var(--accent)"/>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>فلترة وبحث</span>
          {hasFilter && (
            <Btn size="sm" variant="ghost" onClick={reset} style={{ marginInlineStart: 'auto' }}>
              <X size={11}/> مسح الفلاتر
            </Btn>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, alignItems: 'flex-end' }}>
          <Select label="الشركة" value={carrier} onChange={e => setCarrier(e.target.value)}>
            <option value="all">كل الشركات</option>
            {carriers.map(c => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Select label="الشهر" value={month} onChange={e => setMonth(e.target.value)}>
            <option value="all">كل الشهور</option>
            {months.map(m => <option key={m} value={m}>{m}</option>)}
          </Select>
          <Select label="الحالة" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="all">الكل</option>
            <option value="issues">بفروق فقط</option>
            <option value="clean">مطابقة فقط</option>
          </Select>
          <Select label="المراجعة" value={review} onChange={e => setReview(e.target.value)}>
            <option value="all">الكل</option>
            <option value="pending">⏳ بانتظار الاعتماد</option>
            <option value="approved">✓ معتمدة</option>
            <option value="rejected">✗ مرفوضة</option>
          </Select>
          <Input label="بحث" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="اسم / فترة / ملف..."/>
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          {filtered.length} من أصل {audits.length}
        </div>
      </Card>
      {children(filtered)}
    </>
  );
}

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wifi, WifiOff, ExternalLink, Package } from 'lucide-react';
import { Card, Btn, Input, Select, Modal, Empty, Spinner, toast } from '../components/UI.jsx';
import { loadSettings, saveSettings } from '../data/carriers.js';
import { loadAuditsFromDB, deleteAuditFromDB, loadAuditByIdFromDB, loadCarriers } from '../lib/coreService.js';
import { loadLinkedAuditIndex } from '../lib/carrierStatementsService.js';
import { exportMergedExcessWeights } from '../engine/export.js';
import { OR_MODELS, testConnection } from '../engine/openrouter.js';
import { getNavPermissions, saveNavPermissions } from '../lib/permissionsService.js';

const TABS = [
  { id: 'ai',          label: '✨ الذكاء الاصطناعي' },
  { id: 'permissions', label: '🔐 صلاحيات التنقل' },
  { id: 'data',        label: '🗄️ البيانات' },
];

// ── Settings ──────────────────────────────────────────────────────────────────
export function SettingsPage({ carriers = [], tab = 'ai' }) {
  const navigate = useNavigate();
  const setTab = (id) => navigate(`/settings/${id}`);
  const [s,       setS]       = useState(loadSettings());
  const [vis,     setVis]     = useState(false);
  const [testing, setTesting] = useState(false);
  const [testOk,  setTestOk]  = useState(null);

  const save = () => {
    saveSettings(s);
    toast('تم حفظ الإعدادات ✓', 'success');
    setTestOk(null);
  };

  const handleTest = async () => {
    saveSettings(s);
    setTesting(true);
    setTestOk(null);
    try {
      await testConnection();
      setTestOk(true);
      toast('الاتصال يعمل بشكل صحيح ✓', 'success');
    } catch (e) {
      setTestOk(false);
      toast(`فشل الاتصال: ${e.message}`, 'error');
    }
    setTesting(false);
  };

  const handleExport = async () => {
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
      {tab === 'permissions' && <NavPermissionsTab/>}

      {/* Data tab */}
      <div style={{display: tab==='data' ? 'block' : 'none'}}>
        <Card>
          <h3 style={{fontSize:14,fontWeight:700,marginBottom:14}}>🗄️ البيانات</h3>
          <div style={{display:'flex',gap:10}}>
            <Btn size="sm" variant="ghost" onClick={handleExport}>
              ⬇️ تصدير نسخة احتياطية
            </Btn>
          </div>
        </Card>
      </div>

      {/* AI tab */}
      {tab === 'ai' && <>
      <Card style={{marginBottom:20}}>
        <h3 style={{fontSize:14,fontWeight:700,marginBottom:16,display:'flex',alignItems:'center',gap:8}}>
          <span>✨</span> OpenRouter AI
        </h3>

        <div style={{marginBottom:14}}>
          <label style={{display:'block',color:'var(--muted)',fontSize:11,marginBottom:5}}>
            API Key
            <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer"
              style={{color:'var(--accent)',marginRight:6,textDecoration:'none',fontSize:10}}>
              احصل على مفتاح ↗
            </a>
          </label>
          <div style={{display:'flex',gap:8}}>
            <input
              type={vis?'text':'password'}
              value={s.openrouterKey}
              onChange={e=>setS({...s,openrouterKey:e.target.value})}
              placeholder="sk-or-..."
              style={{flex:1,padding:'8px 11px',borderRadius:7,fontSize:13,fontFamily:'var(--font-mono)'}}/>
            <Btn size="sm" variant="ghost" onClick={()=>setVis(v=>!v)}>{vis?'🙈':'👁'}</Btn>
          </div>
        </div>

        <div style={{marginBottom:16}}>
          <label style={{display:'block',color:'var(--muted)',fontSize:11,marginBottom:5}}>النموذج</label>
          <div style={{display:'flex',flexDirection:'column',gap:7}}>
            {OR_MODELS.map(m=>(
              <button key={m.id} onClick={()=>setS({...s,openrouterModel:m.id})}
                style={{
                  display:'grid',gridTemplateColumns:'1fr auto',gap:'4px 12px',
                  padding:'10px 14px',borderRadius:9,cursor:'pointer',textAlign:'right',
                  background:s.openrouterModel===m.id?'rgba(56,189,248,.1)':'var(--surface)',
                  border:`1px solid ${s.openrouterModel===m.id?'rgba(56,189,248,.3)':'var(--border)'}`,
                  transition:'all .15s',
                }}>
                <div style={{display:'flex',alignItems:'center',gap:7}}>
                  {s.openrouterModel===m.id&&<span style={{color:'var(--accent)',fontSize:11}}>●</span>}
                  <span style={{fontWeight:600,fontSize:12,color:s.openrouterModel===m.id?'var(--accent)':'var(--text)'}}>{m.label}</span>
                  {m.best&&<span style={{background:'rgba(251,191,36,.15)',color:'var(--gold)',fontSize:9,padding:'1px 6px',borderRadius:4,fontFamily:'var(--font-mono)'}}>مُوصى</span>}
                </div>
                <div style={{color:'var(--green)',fontSize:10,fontFamily:'var(--font-mono)',gridColumn:'1',paddingRight:s.openrouterModel===m.id?18:0}}>{m.cost}</div>
                <div style={{color:'var(--muted)',fontSize:10,gridColumn:'1',paddingRight:s.openrouterModel===m.id?18:0}}>{m.note}</div>
              </button>
            ))}
          </div>
        </div>

        <div style={{background:'var(--surface)',borderRadius:8,padding:'10px 14px',marginBottom:16,fontSize:12,lineHeight:1.8,color:'var(--muted)'}}>
          <strong style={{color:'var(--text)'}}>ما يفعله AI في ShipAudit:</strong><br/>
          • تعيين أعمدة الملف تلقائياً ✨<br/>
          • تحليل نتائج التدقيق وإعداد تقرير احترافي 📊<br/>
          • الإجابة على أسئلتك حول الفروق والعقود 💬<br/>
          • استخراج التسعيرة من نص العقد مستقبلاً 📄
        </div>

        <div style={{display:'flex',gap:9}}>
          <Btn variant="primary" onClick={save} style={{flex:1,justifyContent:'center'}}>
            حفظ الإعدادات
          </Btn>
          <Btn
            variant={testOk===true?'success':testOk===false?'danger':'ghost'}
            onClick={handleTest}
            disabled={testing||!s.openrouterKey}
            style={{minWidth:130,justifyContent:'center',gap:7}}
          >
            {testing
              ? <><Spinner size={13}/> يختبر...</>
              : testOk===true
                ? <><Wifi size={13}/> متصل</>
                : testOk===false
                  ? <><WifiOff size={13}/> فشل</>
                  : <><Wifi size={13}/> اختبار الاتصال</>
            }
          </Btn>
        </div>
      </Card>
      </>}
    </div>
  );
}

// ── Nav Permissions Tab ────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { id: 'dashboard',        label: 'الرئيسية'           },
  { id: 'carriers',         label: 'شركات الشحن'        },
  { id: 'upload',           label: 'مراجعة جديدة'       },
  { id: 'audits',           label: 'السجل'              },
  { id: 'ledger',           label: 'الدفتر'             },
  { id: 'aramex-stmt',      label: 'رفع كشف'            },
  { id: 'cod-settlements',  label: 'تسويات COD'         },
  { id: 'payments',         label: 'الدفعات'            },
  { id: 'carrier-kpi',      label: 'أداء الناقلين'      },
  { id: 'activity-log',     label: 'سجل النشاط'         },
  { id: 'employees',        label: 'الموظفون'           },
];
const ROLES_CONFIG = [
  { id: 'accountant1', label: 'محاسب أول',  color: 'var(--green)' },
  { id: 'accountant2', label: 'محاسب ثانٍ', color: 'var(--gold)'  },
];

function NavPermissionsTab() {
  const [perms,   setPerms]   = useState(null);
  const [saving,  setSaving]  = useState(false);

  useEffect(() => {
    getNavPermissions().then(setPerms);
  }, []);

  const toggle = (role, pageId) => {
    setPerms(prev => {
      const current = prev[role] ?? [];
      const next = current.includes(pageId)
        ? current.filter(x => x !== pageId)
        : [...current, pageId];
      return { ...prev, [role]: next };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveNavPermissions(perms);
      toast('تم حفظ الصلاحيات ✓', 'success');
    } catch (e) { toast(e.message, 'error'); }
    setSaving(false);
  };

  if (!perms) return <div style={{padding:40,textAlign:'center'}}><Spinner size={22}/></div>;

  return (
    <Card>
      <h3 style={{fontSize:14,fontWeight:700,marginBottom:4}}>🔐 صلاحيات التنقل</h3>
      <p style={{fontSize:12,color:'var(--muted)',marginBottom:20}}>
        تحكم في الصفحات التي يراها كل موظف في القائمة الجانبية. المدير يرى كل شيء دائماً.
      </p>

      <div style={{display:'grid',gridTemplateColumns:'160px repeat(2,1fr)',gap:0,borderRadius:10,overflow:'hidden',border:'1px solid var(--border)'}}>
        {/* Header */}
        <div style={{padding:'10px 14px',background:'var(--surface)',fontSize:11,color:'var(--muted)',fontWeight:600}}>الصفحة</div>
        {ROLES_CONFIG.map(r => (
          <div key={r.id} style={{padding:'10px 14px',background:'var(--surface)',fontSize:12,fontWeight:700,color:r.color,textAlign:'center'}}>
            {r.label}
          </div>
        ))}

        {/* Rows */}
        {NAV_ITEMS.map((item, i) => (
          <>
            <div key={`lbl-${item.id}`} style={{
              padding:'12px 14px',
              background: i%2===0 ? 'var(--bg)' : 'var(--card)',
              fontSize:13, borderTop:'1px solid var(--border)',
            }}>
              {item.label}
            </div>
            {ROLES_CONFIG.map(r => {
              const on = item.id === 'mail' || (perms[r.id] ?? ['mail']).includes(item.id);
              const locked = item.id === 'mail';
              return (
                <div key={`${r.id}-${item.id}`} style={{
                  padding:'12px 14px', textAlign:'center',
                  background: i%2===0 ? 'var(--bg)' : 'var(--card)',
                  borderTop:'1px solid var(--border)',
                }}>
                  <button
                    onClick={() => !locked && toggle(r.id, item.id)}
                    title={locked ? 'لا يمكن إيقاف البريد' : ''}
                    style={{
                      width:32,height:32,borderRadius:8,cursor: locked ? 'not-allowed' : 'pointer',
                      border:`1px solid ${on ? r.color+'60' : 'var(--border2)'}`,
                      background: on ? `color-mix(in srgb,${r.color} 15%,transparent)` : 'var(--surface)',
                      color: on ? r.color : 'var(--muted)',
                      fontSize:15, transition:'all .15s',
                      opacity: locked ? 0.5 : 1,
                    }}
                  >
                    {on ? '✓' : '–'}
                  </button>
                </div>
              );
            })}
          </>
        ))}
      </div>

      <div style={{marginTop:16,display:'flex',justifyContent:'flex-end'}}>
        <Btn onClick={handleSave} disabled={saving}>
          {saving ? <Spinner size={14}/> : 'حفظ الصلاحيات'}
        </Btn>
      </div>
    </Card>
  );
}

// Visual map for the per-audit type badge. Keys match deriveAuditType()
// in src/engine/audit.js — keep in sync.
const AUDIT_TYPE_META = {
  domestic:      { label: 'محلي',                 icon: '🇸🇦', color: '#22c55e' },
  international: { label: 'دولي',                 icon: '🌐', color: '#f59e0b' },
  cod:           { label: 'دفع عند الاستلام',     icon: '💰', color: '#a855f7' },
  mixed:         { label: 'مختلط',                icon: '🔀', color: '#06b6d4' },
  unknown:       { label: 'غير محدد',             icon: '❓', color: 'var(--muted)' },
};

// ── Audits History ─────────────────────────────────────────────────────────────
export function AuditsHistory({ onOpen, isActive = true }) {
  const navigate = useNavigate();
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

  return (
    <div style={{padding:'28px 32px',maxWidth:900}}>
      <h2 style={{fontFamily:'var(--font-mono)',color:'var(--accent)',marginBottom:18}}>📋 سجل المراجعات</h2>

      {/* Floating action bar — appears whenever the user has selected at
          least one audit. The merged excess-weights export is the only
          bulk action right now; more can slot in later. */}
      {selectedIds.size > 0 && (
        <div style={{
          position: 'sticky', top: 0, zIndex: 5, marginBottom: 12,
          background: 'linear-gradient(135deg, rgba(251,191,36,.16), rgba(251,191,36,.04))',
          border: '1px solid var(--gold)', borderRadius: 11,
          padding: '10px 14px',
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <span style={{
            fontFamily: 'var(--font-mono)', fontWeight: 700,
            fontSize: 14, color: 'var(--gold)',
          }}>
            {selectedIds.size}
          </span>
          <span style={{ fontSize: 12, color: 'var(--muted)', flex: 1 }}>
            مراجعة محددة — يمكن دمج أوزانها الإضافية في ملف Excel واحد
          </span>
          <Btn size="sm" variant="primary" disabled={exporting}
            onClick={handleExportMergedExcess}>
            {exporting
              ? <><Spinner size={12}/> جارٍ التصدير...</>
              : <><Package size={12}/> تصدير أوزان إضافية مدمجة</>
            }
          </Btn>
          <Btn size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
            إلغاء التحديد
          </Btn>
        </div>
      )}

      <AuditsFilter audits={audits}>
        {filtered => filtered.length === 0
          ? <Empty icon="🔍" title="لا توجد مراجعات مطابقة" sub="عدّل الفلاتر أو ارفع ملف جديد"/>
          : (() => {
            const visibleIds = filtered.map(a => a.id);
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
                  display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                  padding: '8px 4px 12px',
                }}>
                  <label style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    cursor: 'pointer', userSelect: 'none', fontSize: 12, color: 'var(--muted)',
                  }}>
                    <input type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAllVisible}
                      style={{ width: 17, height: 17, cursor: 'pointer', accentColor: 'var(--gold)' }}
                    />
                    {allVisibleSelected
                      ? `إلغاء تحديد الكل (${filtered.length})`
                      : `تحديد الكل المعروض (${filtered.length})`}
                  </label>
                </div>
                <div className="stagger">
                  {filtered.map(a => {
                const link = linkedIndex.get(a.id);
                const typeMeta = AUDIT_TYPE_META[a.auditType] ?? AUDIT_TYPE_META.unknown;
                const isSelected = selectedIds.has(a.id);
                return (
                  <Card key={a.id} style={{
                    marginBottom: 12, padding: 0, overflow: 'hidden',
                    border: isSelected ? '1px solid var(--gold)' : undefined,
                    background: isSelected ? 'rgba(251,191,36,.05)' : undefined,
                  }}>
                    <div style={{display:'grid',gridTemplateColumns:'auto 1fr auto',gap:14,padding:'14px 18px',alignItems:'center'}}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(a.id)}
                        title="حدد لتصدير الأوزان الإضافية مدمجة"
                        style={{ width: 17, height: 17, cursor: 'pointer', accentColor: 'var(--gold)' }}
                      />
                      <div style={{display:'flex',gap:14,alignItems:'center'}}>
                        <div style={{fontSize:28}}>📦</div>
                        <div>
                          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:3,flexWrap:'wrap'}}>
                            <span style={{fontWeight:700,fontSize:14}}>{a.carrierName}</span>
                            <span style={{
                              display:'inline-flex',alignItems:'center',gap:5,
                              padding:'2px 9px',borderRadius:999,
                              background:`${typeMeta.color}1F`,
                              border:`1px solid ${typeMeta.color}55`,
                              color:typeMeta.color,fontSize:10,fontWeight:700,
                              fontFamily:'var(--font-mono)',whiteSpace:'nowrap',
                            }}>
                              {typeMeta.icon} {typeMeta.label}
                            </span>
                          </div>
                          <div style={{color:'var(--muted)',fontSize:12}}>
                            {a.period} · {a.rowCount ?? 0} شحنة · {new Date(a.date).toLocaleString('ar-SA')}
                          </div>
                          {link && (
                            <div style={{
                              marginTop: 6, display: 'inline-flex', alignItems: 'center',
                              gap: 6, padding: '3px 9px', borderRadius: 999,
                              background: 'rgba(56,189,248,.10)',
                              border: '1px solid rgba(56,189,248,.35)',
                              color: 'var(--accent)', fontSize: 11,
                              fontFamily: 'var(--font-mono)',
                            }}>
                              🔗 مرتبطة بعملية {link.docNo}
                            </div>
                          )}
                        </div>
                      </div>
                      <div style={{display:'flex',gap:8,alignItems:'center'}}>
                        <div style={{textAlign:'center',minWidth:80}}>
                          <div style={{color:(a.issueCount??0)>0?'var(--red)':'var(--green)',fontFamily:'var(--font-mono)',fontWeight:700,fontSize:14}}>
                            {(a.issueCount??0)>0 ? `✗ ${a.issueCount}` : '✓ كامل'}
                          </div>
                          {(a.issueCount??0)>0 && (
                            <div style={{color:'var(--red)',fontFamily:'var(--font-mono)',fontSize:11}}>
                              +{Number(a.diff??0).toFixed(2)} ر.س
                            </div>
                          )}
                        </div>
                        {link && (
                          <Btn size="sm" variant="ghost"
                            title="افتح العملية المرتبطة في الدفتر"
                            onClick={() => jumpToLedger(link)}>
                            <ExternalLink size={12}/> الدفتر
                          </Btn>
                        )}
                        <Btn size="sm" variant="primary" disabled={opening===a.id}
                          onClick={() => handleOpen(a.id)}>
                          {opening === a.id ? <Spinner size={12}/> : 'فتح'}
                        </Btn>
                        <Btn size="sm" variant="danger"
                          disabled={!!link}
                          title={link ? `لا يمكن حذف مراجعة مرتبطة (${link.docNo})` : 'حذف'}
                          onClick={() => !link && setConfirm(a.id)}>🗑</Btn>
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
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      const hay = `${a.carrierName} ${a.period} ${a.fileName ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }), [audits, carrier, month, status, query]);

  const reset = () => { setCarrier('all'); setMonth('all'); setStatus('all'); setQuery(''); };
  const hasFilter = carrier !== 'all' || month !== 'all' || status !== 'all' || query !== '';

  if (!audits.length) {
    return <Empty icon="📋" title="لا توجد مراجعات بعد" sub="ارفع ملف Excel لبدء أول مراجعة"/>;
  }

  return (
    <>
      <Card style={{ marginBottom: 14, padding: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 2fr auto', gap: 8, alignItems: 'center' }}>
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
          <Input label="بحث" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="اسم/فترة/ملف..."/>
          {hasFilter && <Btn size="sm" variant="ghost" onClick={reset}>مسح</Btn>}
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          {filtered.length} من أصل {audits.length}
        </div>
      </Card>
      {children(filtered)}
    </>
  );
}

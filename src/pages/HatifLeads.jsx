// فرص من هاتف — أرقام تحدّثت معنا في واتساب لكنها **ليست** في كشف متاجرنا:
// مستفسرون لم يسجّلوا · موردون · ضجيج. المصدر hatif_unknown_contacts (جرد
// hatif-contacts-sync action=audit). الأثمن = من سمّاه موظف يدوياً (اسم فيه حروف).
import { useState, useEffect, useMemo, useCallback } from 'react';
import { UserPlus, RefreshCw, Phone, MessageCircle, Send, Search, Download } from 'lucide-react';
import { Card, Btn, Spinner, Empty, PageHeader, toast } from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import { loadHatifLeads, updateHatifLead, computeLeadStats, syncHatifLeads,
  LEAD_STATUSES, statusMeta, kindMeta } from '../lib/hatifLeadsService.js';
import { normalizeSaudiPhone, loadWhatsAppCampaignStatus } from '../lib/whatsappService.js';
import WhatsAppSendModal from '../components/WhatsAppSendModal.jsx';
import { CustomerCampaignHistory } from '../components/WhatsAppCampaignLog.jsx';

const fmt0 = (n) => Number(n || 0).toLocaleString('en-US');
const fmtDate = (d) => { if (!d) return '—'; try { return new Date(d).toLocaleDateString('ar-SA', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return String(d).slice(0, 10); } };
const telLink = (p) => { const d = String(p || '').replace(/\D/g, ''); return d ? `tel:+${d}` : null; };
const waLink  = (p) => { const d = String(p || '').replace(/\D/g, ''); return d ? `https://wa.me/${d}` : null; };
const display = (l) => l.name || l.phone;

const selStyle = { padding: '8px 10px', border: '1px solid var(--border2)', borderRadius: 9, background: 'var(--surface)', color: 'var(--text)', fontSize: 12 };

export default function HatifLeads({ isActive = true }) {
  const { can, user } = useAuth();
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [namedOnly, setNamedOnly] = useState(false);
  const [waRecipients, setWaRecipients] = useState(null);
  const [waStatus, setWaStatus] = useState(() => new Map());
  const [detail, setDetail] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await loadHatifLeads()); }
    catch (e) { toast(`فشل التحميل: ${e.message}`, 'error'); setRows([]); }
    setLoading(false);
  }, []);

  // مزامنة فورية من هاتف (الـcron يفعلها كل ساعتين أيضاً)
  const doSync = async () => {
    setSyncing(true);
    const r = await syncHatifLeads();
    setSyncing(false);
    if (r?.ok) { toast(`تمت المزامنة — ${r.in_hatif_not_ours} فرصة (${r.saved} محفوظة)`, 'success'); await load(); }
    else toast(`فشلت المزامنة: ${r?.error || 'غير معروف'}`, 'error');
  };
  useEffect(() => { if (isActive) load(); }, [isActive, load]);
  const loadWa = useCallback(() => loadWhatsAppCampaignStatus().then(setWaStatus).catch(() => {}), []);
  useEffect(() => { if (isActive) loadWa(); }, [isActive, loadWa]);

  const stats = useMemo(() => (rows ? computeLeadStats(rows) : null), [rows]);
  const filtered = useMemo(() => {
    if (!rows) return [];
    const s = q.trim().toLowerCase();
    return rows.filter(l => {
      if (namedOnly && !l.namedManually) return false;
      if (status && l.status !== status) return false;
      if (s && ![l.name, l.phone, l.company].some(v => String(v ?? '').toLowerCase().includes(s))) return false;
      return true;
    });
  }, [rows, q, status, namedOnly]);

  if (!can('sales.view') && !can('crm.view')) return <div style={{ padding: 40 }}><Empty icon="🔒" title="لا صلاحية"/></div>;

  // متغيّر القالب: {{1}} الاسم (أو الرقم لمن بلا اسم) — الفرص ليس لها شحنات/دين
  const toRecipient = (l) => ({ to: normalizeSaudiPhone(l.phone), name: display(l), amount: null, vars: [display(l)] });
  const openBulk = () => {
    const recs = filtered.map(toRecipient);
    if (!recs.length) { toast('لا أرقام في العرض الحالي', 'info'); return; }
    setWaRecipients(recs);
  };
  const setStat = async (l, v) => {
    try {
      await updateHatifLead(l.phone, { status: v });
      setRows(prev => prev.map(x => x.phone === l.phone ? { ...x, status: v } : x));
    } catch (e) { toast(`فشل الحفظ: ${e.message}`, 'error'); }
  };
  const exportXlsx = async () => {
    try {
      const XLSX = await import('xlsx');
      const { rtl } = await import('../lib/xlsxRtl.js');
      const { persistAndDownloadExport } = await import('../lib/internalExportsService.js');
      const data = filtered.map(l => ({
        'الاسم': l.name || '', 'الجوال': l.phone, 'الشركة': l.company || '',
        'سُمّي يدوياً': l.namedManually ? 'نعم' : 'لا',
        'الحالة': statusMeta(l.status).label, 'أول ظهور في هاتف': l.createdAt ? String(l.createdAt).slice(0, 10) : '',
        'ملاحظة': l.note || '',
      }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'فرص من هاتف');
      await persistAndDownloadExport({ wb: rtl(wb), fileName: `فرص-من-هاتف-${new Date().toISOString().slice(0, 10)}.xlsx`,
        kind: 'hatif_leads', rowCount: data.length, total: null, userId: user?.id || null });
      toast(`صُدِّر ${data.length} فرصة`, 'success');
    } catch (e) { toast(`فشل التصدير: ${e.message}`, 'error'); }
  };

  return (
    <div style={{ padding: '20px 24px 70px', maxWidth: 1360, margin: '0 auto' }}>
      <PageHeader icon={<UserPlus size={22}/>} iconColor="#F97316"
        title="فرص من هاتف"
        subtitle="جوّالات سعودية تحدّثت معنا في واتساب وليست في كشف متاجرنا — مستفسرون لم يسجّلوا"
        meta={stats ? `${fmt0(stats.total)} فرصة · ${fmt0(stats.named)} باسم حقيقي` : null}
        actions={<>
          <Btn size="sm" variant="primary" icon={<RefreshCw size={13} className={syncing ? 'spin' : ''}/>}
            onClick={doSync} disabled={syncing || loading}>{syncing ? 'جارٍ المزامنة…' : 'مزامنة من هاتف'}</Btn>
          <Btn size="sm" variant="ghost" onClick={load} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''}/></Btn>
        </>}
      />

      {!rows && loading ? <div style={{ padding: 60, textAlign: 'center' }}><Spinner/></div> : !rows?.length ? (
        <Card><Empty icon="📭" title="لا فرص بعد" sub="شغّل الجرد (audit) لالتقاط أرقام هاتف غير المسجّلة"/></Card>
      ) : (<>
        {/* المؤشّرات */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 14 }} className="hero-grid">
          <Stat label="إجمالي الفرص" value={stats.total} color="#F97316" sub="جوال سعودي — كلها قابلة للحملات"/>
          <Stat label="باسم حقيقي ⭐" value={stats.named} color="var(--green)" sub="سمّاهم موظف — الأثمن"/>
          <Stat label="عملاء محتملون" value={stats.byStatus.lead || 0} color="var(--gold)"/>
          <Stat label="لم تُصنَّف بعد" value={stats.byStatus.new || 0} color="#3B82F6"/>
        </div>

        {/* الفلاتر */}
        <Card style={{ padding: 12, marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 190 }}>
              <Search size={14} style={{ position: 'absolute', top: 10, insetInlineStart: 10, color: 'var(--muted)' }}/>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="ابحث بالاسم أو الجوال…"
                style={{ ...selStyle, width: '100%', padding: '8px 32px 8px 10px' }}/>
            </div>
            <select value={status} onChange={e => setStatus(e.target.value)} style={selStyle}>
              <option value="">كل الحالات</option>
              {Object.entries(LEAD_STATUSES).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
            </select>
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--muted)' }}>
              <input type="checkbox" checked={namedOnly} onChange={e => setNamedOnly(e.target.checked)}/> باسم حقيقي فقط ⭐
            </label>
            {can('campaigns.send') && (
              <Btn size="sm" variant="accent" icon={<Send size={13}/>} onClick={openBulk} disabled={!filtered.length}>
                إطلاق حملة ({fmt0(filtered.length)})
              </Btn>
            )}
            <Btn size="sm" variant="ghost" icon={<Download size={13}/>} onClick={exportXlsx} disabled={!filtered.length}>تصدير</Btn>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 8 }}>
            عرض <b style={{ color: 'var(--text)' }}>{fmt0(filtered.length)}</b> من {fmt0(stats.total)}
            
          </div>
        </Card>

        {/* الجدول */}
        {!filtered.length ? <Card><Empty icon="🔍" title="لا نتائج" sub="خفّف الفلاتر"/></Card> : (
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <table className="m-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr style={{ background: 'var(--surface2)', textAlign: 'right' }}>
                {['الاسم', 'الجوال', 'أول ظهور', 'الحالة', 'إجراء'].map(h =>
                  <th key={h} style={{ padding: '10px 12px', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {filtered.slice(0, 300).map(l => {
                  const w = waStatus.get(normalizeSaudiPhone(l.phone));
                  return (
                    <tr key={l.phone} onClick={() => setDetail(l)} style={{ borderTop: '1px solid var(--border)', cursor: 'pointer' }}>
                      <td data-label="الاسم" style={{ padding: '10px 12px', fontWeight: 700 }}>
                        {l.namedManually && <span title="سمّاه موظف">⭐ </span>}{display(l)}
                        {l.company && <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{l.company}</div>}
                        {w && <div style={{ fontSize: 10, color: w.replied ? '#3B82F6' : 'var(--muted2)', marginTop: 2 }}>
                          📲 حملة {fmtDate(w.lastSentAt)} · {w.replied ? 'ردّ' : w.read ? 'قُرئت' : w.delivered ? 'وصلت' : 'أُرسلت'}</div>}
                      </td>
                      <td data-label="الجوال" style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', direction: 'ltr', textAlign: 'right' }}>{l.phone}</td>
                      <td data-label="أول ظهور" style={{ padding: '10px 12px', color: 'var(--muted)' }}>{fmtDate(l.createdAt)}</td>
                      <td data-label="الحالة" style={{ padding: '10px 12px' }} onClick={e => e.stopPropagation()}>
                        <select value={l.status} onChange={e => setStat(l, e.target.value)}
                          style={{ ...selStyle, fontSize: 11, padding: '4px 8px', color: statusMeta(l.status).color, fontWeight: 700 }}>
                          {Object.entries(LEAD_STATUSES).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
                        </select>
                      </td>
                      <td data-label="إجراء" style={{ padding: '10px 12px' }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          {telLink(l.phone) && <a href={telLink(l.phone)} title="اتصال" style={{ color: 'var(--text)' }}><Phone size={15}/></a>}
                          {can('campaigns.send') && (
                            <button onClick={() => setWaRecipients([toRecipient(l)])} title="إطلاق حملة قالب"
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--green)', padding: 0, display: 'flex' }}><Send size={15}/></button>
                          )}
                          {waLink(l.phone) && <a href={waLink(l.phone)} target="_blank" rel="noreferrer" title="محادثة يدوية" style={{ color: 'var(--muted)' }}><MessageCircle size={15}/></a>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length > 300 && (
              <div style={{ padding: '10px 12px', fontSize: 11.5, color: 'var(--muted)', borderTop: '1px solid var(--border)' }}>
                يُعرَض أول 300 صف — ضيّق الفلاتر أو صدّر Excel للقائمة كاملة ({fmt0(filtered.length)}).
              </div>
            )}
          </Card>
        )}
      </>)}

      {detail && <LeadModal lead={detail} onClose={() => setDetail(null)}
        onSaved={(patch) => { setRows(prev => prev.map(x => x.phone === detail.phone ? { ...x, ...patch } : x)); setDetail(null); }}/>}

      {waRecipients && (
        <WhatsAppSendModal open={!!waRecipients} recipients={waRecipients} bucketLabel="فرص من هاتف"
          onClose={() => setWaRecipients(null)}
          onSent={() => { setWaRecipients(null); loadWa(); }}/>
      )}
    </div>
  );
}

function Stat({ label, value, color, sub }) {
  return (
    <Card style={{ padding: '12px 14px', borderTop: `3px solid ${color}` }}>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 21, fontWeight: 800, color, fontFamily: 'var(--font-mono)', lineHeight: 1 }}>{fmt0(value)}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--muted2)', marginTop: 3 }}>{sub}</div>}
    </Card>
  );
}

function LeadModal({ lead, onClose, onSaved }) {
  const [status, setStatus] = useState(lead.status);
  const [note, setNote] = useState(lead.note || '');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try { await updateHatifLead(lead.phone, { status, note }); toast('تم الحفظ', 'success'); onSaved({ status, note }); }
    catch (e) { toast(`فشل الحفظ: ${e.message}`, 'error'); setSaving(false); }
  };
  return (
    <div role="dialog" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }} onClick={onClose}>
      <Card onClick={e => e.stopPropagation()} style={{ width: 'min(520px, 94vw)', maxHeight: '88vh', overflowY: 'auto', padding: 18 }} className="m-flow">
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>{display(lead)}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--font-mono)', direction: 'ltr', textAlign: 'right', marginBottom: 12 }}>{lead.phone}</div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--muted)', marginBottom: 12 }}>
          <span>{kindMeta(lead.kind).label}</span>
          <span>أول ظهور: {fmtDate(lead.createdAt)}</span>
          {lead.namedManually && <span style={{ color: 'var(--green)' }}>⭐ سمّاه موظف</span>}
          {lead.company && <span>الشركة: {lead.company}</span>}
        </div>
        <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>التصنيف</label>
        <select value={status} onChange={e => setStatus(e.target.value)} style={{ ...selStyle, width: '100%', marginBottom: 12 }}>
          {Object.entries(LEAD_STATUSES).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
        </select>
        <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>ملاحظة</label>
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
          style={{ ...selStyle, width: '100%', resize: 'vertical', marginBottom: 14, fontSize: 13 }}/>
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>📲 الحملات المُرسَلة</label>
          <CustomerCampaignHistory phone={lead.phone}/>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="ghost" onClick={onClose} disabled={saving}>إلغاء</Btn>
          <Btn variant="accent" onClick={save} disabled={saving}>حفظ</Btn>
        </div>
      </Card>
    </div>
  );
}

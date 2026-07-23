// إطلاق حملة مكالمات آلية (Outbound IVR) عبر Voxa/Hatif — معاينة → تأكيد → نتائج.
// لا تُطلَق أي مكالمة قبل ضغط «ابدأ الاتصال». مصمَّم للوصول لمن لا يملك واتساب.
// البوابة المركزية: campaigns.ivr (تُفحَص هنا + سيرفرياً في hatif-ivr).
import { useState, useEffect, useMemo } from 'react';
import { PhoneCall, ShieldCheck, X, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Modal, Btn, Spinner, toast } from './UI.jsx';
import { loadIvrConfig, launchIvrCampaign, scheduleIvrQueue } from '../lib/ivrService.js';
import { useAuth } from '../lib/auth.jsx';

const BATCH = 40;   // دفعة الاستدعاء الواحد (كل مكالمة ~0.4ث تسجيل + إطلاق)

// recipients: [{ phone, name, fields? }]
export default function IvrCampaignModal({ open, onClose, recipients = [], bucketLabel, onDone }) {
  const { can, user } = useAuth();
  const allowed = can('campaigns.ivr');
  const [cfg, setCfg] = useState(null);
  const [scriptKey, setScriptKey] = useState('');
  const [campName, setCampName] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [launching, setLaunching] = useState(false);
  const [progress, setProgress] = useState(null);   // {done,total,placed,failed}
  const [results, setResults] = useState(null);
  const [schedOn, setSchedOn] = useState(false);     // ⏰ جدولة بدل الاتصال الآن
  const [schedAt, setSchedAt] = useState('');

  useEffect(() => {
    if (!open) return;
    loadIvrConfig().then(c => {
      setCfg(c);
      // الافتراضي قد يشير لسكربت محذوف (معطّل) → القائمة تعرض الأول بصرياً لكن القيمة
      // معطّلة فيفشل «اختر سكربتاً». نهيّئ دائماً بمفتاح موجود فعلاً.
      const valid = (c.scripts || []).some(s => s.key === c.defaultScript);
      setScriptKey(valid ? c.defaultScript : (c.scripts?.[0]?.key || ''));
    });
    setCampName(bucketLabel || '');
    setResults(null); setProgress(null);
  }, [open, bucketLabel]);

  // مفتاح الاختيار = الهاتف (رقم = مكالمة واحدة)
  const valid = useMemo(() => recipients.filter(r => r && r.phone), [recipients]);
  useEffect(() => { if (open) setSelected(new Set(valid.map(r => String(r.phone)))); }, [open, valid]);

  const script = cfg?.scripts?.find(s => s.key === scriptKey) || null;
  const chosen = valid.filter(r => selected.has(String(r.phone)));
  // إزالة تكرار الهاتف (رقم = مكالمة واحدة)
  const dedup = useMemo(() => {
    const seen = new Set(); const out = [];
    for (const r of chosen) { const k = String(r.phone); if (seen.has(k)) continue; seen.add(k); out.push(r); }
    return out;
  }, [chosen]);

  const toggle = (ph) => setSelected(prev => { const n = new Set(prev); n.has(ph) ? n.delete(ph) : n.add(ph); return n; });

  async function launch() {
    if (!allowed) return;
    if (!script) { toast('اختر سكربتاً صوتياً', 'error'); return; }
    if (!campName.trim()) { toast('اكتب اسم الحملة', 'error'); return; }
    if (!dedup.length) { toast('لا مستلمين', 'error'); return; }
    // جدولة: تُدرَج في الطابور ويطلقها ivr-runner في وقتها (ضمن ساعات الاتصال)
    if (schedOn) {
      if (!schedAt) { toast('اختر وقت الجدولة', 'error'); return; }
      setLaunching(true);
      try {
        const recs = dedup.map(r => ({ phone: String(r.phone), name: r.name || null, fields: r.fields || null }));
        const { queued } = await scheduleIvrQueue({ recipients: recs, scriptKey, campaignName: campName.trim(), runAt: new Date(schedAt).toISOString(), userId: user?.id || null });
        setResults({ scheduled: true, queued });
        toast(`جُدولت ${queued} مكالمة`, 'success');
        onDone && onDone({ scheduled: true, queued });
      } catch (e) { toast(e.message || 'فشل الجدولة', 'error'); }
      finally { setLaunching(false); }
      return;
    }
    setLaunching(true); setResults(null);
    const agg = { total: dedup.length, placed: 0, failed: 0, skipped: 0, results: [] };
    try {
      for (let i = 0; i < dedup.length; i += BATCH) {
        const batch = dedup.slice(i, i + BATCH).map(r => ({ phone: String(r.phone), name: r.name || null, fields: r.fields || null }));
        setProgress({ done: i, total: dedup.length, placed: agg.placed, failed: agg.failed });
        const res = await launchIvrCampaign({ recipients: batch, scriptKey, campaignName: campName.trim() });
        agg.placed += res.placed || 0; agg.failed += res.failed || 0; agg.skipped += res.skipped || 0;
        if (Array.isArray(res.results)) agg.results.push(...res.results);
      }
      setProgress({ done: dedup.length, total: dedup.length, placed: agg.placed, failed: agg.failed });
      setResults(agg);
      toast(`تم إطلاق ${agg.placed} مكالمة`, agg.placed ? 'success' : 'error');
      onDone && onDone(agg);
    } catch (e) {
      toast(e.message || 'فشل إطلاق المكالمات', 'error');
      if (agg.placed || agg.failed) setResults(agg);
    } finally { setLaunching(false); }
  }

  if (!open) return null;

  return (
    <Modal onClose={launching ? undefined : onClose} title="📞 مكالمة آلية (IVR)" width={640}>
      <div className="m-flow" style={{ display: 'grid', gap: 14, maxHeight: '70vh', overflowY: 'auto', padding: 2 }}>
        {!allowed && (
          <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', borderRadius: 10, padding: 12, fontSize: 14 }}>
            <AlertTriangle size={16} style={{ verticalAlign: -3 }} /> تحتاج صلاحية «إطلاق مكالمات آلية IVR» — راجع مدير النظام.
          </div>
        )}
        {cfg && cfg.enabled === false && (
          <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E', borderRadius: 10, padding: 12, fontSize: 14 }}>
            مكالمات IVR غير مُفعَّلة — فعّلها من «إعدادات واتساب ← المكالمات الآلية».
          </div>
        )}
        {!cfg && <Spinner />}

        {cfg && (
          <>
            <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 600 }}>
              اسم الحملة
              <input value={campName} onChange={e => setCampName(e.target.value)} placeholder="مثال: تذكير تحصيل يوليو"
                style={{ padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 9, fontSize: 14 }} />
            </label>

            <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 600 }}>
              السكربت الصوتي
              <select value={scriptKey} onChange={e => setScriptKey(e.target.value)}
                style={{ padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 9, fontSize: 14 }}>
                {(cfg.scripts || []).map(s => <option key={s.key} value={s.key}>{s.label || s.key}</option>)}
              </select>
            </label>

            {script && (
              <div style={{ background: 'var(--panel, #F8FAFC)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, fontSize: 13, lineHeight: 1.7 }}>
                {script.audioUrl ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--green2)', fontWeight: 600 }}>🔊 صوت مرفوع</span>
                    <span style={{ color: 'var(--muted)', fontSize: 12 }}>يُشغَّل كما سُجِّل — بلا متغيّرات (المتغيّرات في قالب الواتساب فقط)</span>
                  </div>
                ) : (
                  <>
                    <div style={{ color: 'var(--muted)', marginBottom: 4 }}>نص المكالمة (المتغيّرات تُملأ لكل عميل):</div>
                    <div style={{ fontWeight: 500 }}>{script.ttsText || '—'}</div>
                  </>
                )}
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {(script.options || []).map(o => (
                    <span key={o.digit} style={{ background: '#EEF2FF', color: '#3730A3', borderRadius: 999, padding: '3px 10px', fontSize: 12 }}>
                      {o.digit}: {o.description}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              المستلمون: <b style={{ color: 'var(--text)' }}>{dedup.length}</b> رقم فريد
              {chosen.length !== dedup.length && <span> (من {chosen.length} صف)</span>}
            </div>

            <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
              {valid.slice(0, 400).map((r, i) => {
                const ph = String(r.phone);
                return (
                  <label key={ph + i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 11px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                    <input type="checkbox" checked={selected.has(ph)} onChange={() => toggle(ph)} />
                    <span style={{ flex: 1 }}>{r.name || '—'}</span>
                    <span style={{ direction: 'ltr', color: 'var(--muted)', fontFamily: 'monospace' }}>{ph}</span>
                  </label>
                );
              })}
              {valid.length > 400 && <div style={{ padding: 8, fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>… وعرض 400 من {valid.length} (التحديد يشمل الكل)</div>}
            </div>

            {progress && !results && (
              <div style={{ fontSize: 13 }}>
                جارٍ الإطلاق… {progress.done}/{progress.total} — نجح {progress.placed} · فشل {progress.failed}
                <div style={{ height: 6, background: 'var(--border)', borderRadius: 999, marginTop: 6, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%`, background: 'var(--accent)' }} />
                </div>
                <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>لا تُغلق النافذة حتى تكتمل الدفعات.</div>
              </div>
            )}

            {/* ⏰ جدولة بدل الاتصال الآن — يعالجها ivr-runner ضمن ساعات الاتصال */}
            {!results && !progress && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, cursor: 'pointer' }}>
                  <input type="checkbox" checked={schedOn} onChange={e => setSchedOn(e.target.checked)}/> ⏰ جدولة لوقت لاحق
                </label>
                {schedOn && (
                  <input type="datetime-local" value={schedAt} onChange={e => setSchedAt(e.target.value)}
                    style={{ padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12.5, background: 'var(--bg)', color: 'var(--text)' }}/>
                )}
                {schedOn && <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>تُطلَق ضمن ساعات الاتصال المضبوطة في الإعدادات.</span>}
              </div>
            )}

            {results && (
              <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', color: '#166534', borderRadius: 10, padding: 12, fontSize: 14 }}>
                <CheckCircle2 size={16} style={{ verticalAlign: -3 }} />{' '}
                {results.scheduled
                  ? <>جُدولت <b>{results.queued}</b> مكالمة — تُطلَق آلياً في وقتها ضمن ساعات الاتصال.</>
                  : <>أُطلقت <b>{results.placed}</b> مكالمة{results.failed ? ` · فشل ${results.failed}` : ''}{results.skipped ? ` · محظور ${results.skipped}` : ''}.</>}
                <div style={{ fontSize: 12, marginTop: 4 }}>النتائج والضغطات تظهر في «إعدادات واتساب ← سجل المكالمات».</div>
              </div>
            )}
          </>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 14 }}>
        <Btn variant="ghost" onClick={onClose} disabled={launching}><X size={15} /> {results ? 'إغلاق' : 'إلغاء'}</Btn>
        {!results && (
          <Btn variant="accent" onClick={launch} disabled={!allowed || launching || !cfg || cfg.enabled === false || !dedup.length}>
            {launching ? <Spinner size={15} /> : <PhoneCall size={15} />} {schedOn ? `جدولة (${dedup.length})` : `ابدأ الاتصال (${dedup.length})`}
          </Btn>
        )}
      </div>
    </Modal>
  );
}

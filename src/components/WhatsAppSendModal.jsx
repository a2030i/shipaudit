// إرسال حملة واتساب عبر Hatif/Voxa — معاينة → تأكيد → نتائج.
// External action: nothing is sent until the operator presses «إرسال الآن».
// The API key lives only in the edge function; this UI never sees it.

import { useState, useEffect } from 'react';
import { MessageCircle, ShieldCheck, Send, X, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Modal, Btn, Spinner, toast } from './UI.jsx';
import { loadWhatsAppConfig, verifyWhatsAppKey, sendWhatsAppCampaign } from '../lib/whatsappService.js';
import { useAuth } from '../lib/auth.jsx';

const fmt = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

// recipients: [{ to, name, amount, count, vars:[] }]
export default function WhatsAppSendModal({ open, onClose, recipients = [], bucketLabel, onSent }) {
  const { user } = useAuth();
  const [cfg, setCfg]       = useState(null);
  const [verifying, setVer] = useState(false);
  const [verified, setVerified] = useState(null); // null | true | false
  const [sending, setSending]   = useState(false);
  const [results, setResults]   = useState(null);
  const [selected, setSelected] = useState(() => new Set());   // أرقام المستلِمين المختارين
  const [tpl, setTpl]           = useState('');                // القالب المختار لهذه الحملة

  useEffect(() => {
    if (!open) return;
    setResults(null); setVerified(null);
    setSelected(new Set(recipients.filter(r => r.to && r.to.length >= 11).map(r => r.to)));  // الكل افتراضياً
    loadWhatsAppConfig()
      .then(c => { setCfg(c); setTpl(c.templateName || (c.templates || [])[0] || ''); })
      .catch(() => { setCfg({ templates: [], templateName: '', templateLanguage: 'ar' }); setTpl(''); });
  }, [open]);

  if (!open) return null;

  const valid = recipients.filter(r => r.to && r.to.length >= 11);
  const skipped = recipients.length - valid.length;
  const selectedValid = valid.filter(r => selected.has(r.to));
  const overLimit = selectedValid.length > 200;

  const toggle = (to) => setSelected(prev => { const n = new Set(prev); n.has(to) ? n.delete(to) : n.add(to); return n; });
  const allOn  = () => setSelected(new Set(valid.map(r => r.to)));
  const allOff = () => setSelected(new Set());

  const doVerify = async () => {
    setVer(true); setVerified(null);
    const r = await verifyWhatsAppKey();
    setVer(false);
    if (r?.ok) { setVerified(true); toast('المفتاح يعمل ✓', 'success'); }
    else { setVerified(false); toast(`فشل التحقق: ${r?.error || 'غير معروف'}`, 'error'); }
  };

  const doSend = async () => {
    if (!tpl) { toast('اختر قالباً — أو أضفه من «إعدادات واتساب»', 'warn'); return; }
    if (!selectedValid.length) { toast('اختر مستلِماً واحداً على الأقل', 'warn'); return; }
    if (overLimit) { toast('الحد 200 لكل دفعة — قلّل الاختيار', 'warn'); return; }
    setSending(true);
    const r = await sendWhatsAppCampaign({
      templateName: tpl,
      templateLanguage: 'ar',
      channelId: null,
      items: selectedValid.map(v => ({ to: v.to, vars: v.vars, name: v.name, amount: v.amount })),
      campaign: { name: bucketLabel ? `تحصيل — ${bucketLabel}` : 'تحصيل', bucket: bucketLabel || null, userId: user?.id || null },
    });
    setSending(false);
    if (r?.ok) {
      setResults(r);
      toast(`تم الإرسال — ${r.sent || 0} نجحت · ${r.failed || 0} فشلت`, (r.failed ? 'warn' : 'success'));
      onSent?.(r);
    } else {
      toast(`فشل الإرسال: ${r?.error || 'غير معروف'}`, 'error');
    }
  };

  return (
    <Modal title="📲 إرسال حملة واتساب" onClose={onClose} width={560}>
      {!cfg ? <div style={{ padding: 40, textAlign: 'center' }}><Spinner/></div> : results ? (
        // ── Results view ──
        <div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
            <ResultStat label="نجحت" value={results.sent || 0} color="var(--green2)"/>
            <ResultStat label="فشلت" value={results.failed || 0} color={results.failed ? 'var(--red)' : '#6B7280'}/>
            <ResultStat label="الإجمالي" value={results.total || valid.length} color="#3B82F6"/>
          </div>
          {Array.isArray(results.results) && results.results.some(x => !x.success) && (
            <div style={{ maxHeight: 200, overflow: 'auto', fontSize: 12, border: '1px solid var(--border)', borderRadius: 8 }}>
              {results.results.filter(x => !x.success).map((x, i) => (
                <div key={i} style={{ padding: '7px 11px', borderTop: i ? '1px solid var(--border)' : 'none', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', direction: 'ltr' }}>{x.to}</span>
                  <span style={{ color: 'var(--red)' }}>{x.error || 'فشل'}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 16, textAlign: 'left' }}>
            <Btn variant="primary" onClick={onClose}>تم</Btn>
          </div>
        </div>
      ) : (
        // ── اختيار المستلِمين + إرسال (القالب/القناة/اللغة مثبّتة من الإعدادات) ──
        <div>
          {/* اختيار القالب لهذه الحملة (القائمة من «إعدادات واتساب») + تحقّق سريع */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12,
            background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 12px' }}>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>القالب:</span>
            {(cfg.templates || []).length > 0 ? (
              <select value={tpl} onChange={e => setTpl(e.target.value)}
                style={{ fontSize: 12.5, padding: '5px 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
                {(cfg.templates || []).map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            ) : (
              <span style={{ fontSize: 11, color: 'var(--red)' }}>لا قوالب — أضف من «إعدادات واتساب»</span>
            )}
            <Btn size="sm" variant="ghost" onClick={doVerify} disabled={verifying} style={{ marginInlineStart: 'auto' }}>
              <ShieldCheck size={13}/> {verifying ? 'تحقّق…' : 'تحقّق'}
            </Btn>
            {verified === true  && <span style={{ color: 'var(--green2)', fontSize: 12 }}><CheckCircle2 size={13}/></span>}
            {verified === false && <span style={{ color: 'var(--red)', fontSize: 12 }}><X size={13}/></span>}
          </div>

          {/* اختيار المستلِمين */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 12.5, flexWrap: 'wrap' }}>
            <b>المستلِمون: {selectedValid.length} / {valid.length}</b>
            <Btn size="sm" variant="ghost" onClick={allOn}>تحديد الكل</Btn>
            <Btn size="sm" variant="ghost" onClick={allOff}>إلغاء الكل</Btn>
            {skipped > 0 && <span style={{ color: 'var(--muted)', marginInlineStart: 'auto' }}>تُخطّي {skipped} بلا رقم</span>}
          </div>
          <div className="m-flow" style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 12 }}>
            {valid.map((r, i) => (
              <label key={r.to + i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                borderTop: i ? '1px solid var(--border)' : 'none', cursor: 'pointer' }}>
                <input type="checkbox" checked={selected.has(r.to)} onChange={() => toggle(r.to)}/>
                <span style={{ flex: 1, fontWeight: 600, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name || r.to}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--muted)', direction: 'ltr' }}>{r.to}</span>
                {r.amount != null && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--gold)' }}>{fmt(r.amount)}</span>}
              </label>
            ))}
            {!valid.length && <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--muted)' }}>لا مستلِمون بأرقام صالحة</div>}
          </div>

          {overLimit && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--red)', fontSize: 12, marginBottom: 10 }}>
              <AlertTriangle size={15}/> {selectedValid.length} مختار — الحد 200 لكل دفعة. قلّل الاختيار.
            </div>
          )}

          <div style={{ background: 'rgba(217,119,6,.07)', border: '1px solid rgba(217,119,6,.3)', borderRadius: 8, padding: '9px 12px', fontSize: 11.5, color: '#92400E', marginBottom: 14 }}>
            ⚠️ سيُرسَل القالب لـ{selectedValid.length} عميل مختار عبر واتساب. لا يمكن التراجع بعد الإرسال.
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-start' }}>
            <Btn variant="accent" onClick={doSend} disabled={sending || !selectedValid.length || overLimit || !tpl}>
              {sending ? <><Spinner size={14}/> جارٍ الإرسال…</> : <><Send size={14}/> إرسال ({selectedValid.length})</>}
            </Btn>
            <Btn variant="ghost" onClick={onClose} disabled={sending}>إلغاء</Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}
function ResultStat({ label, value, color }) {
  return (
    <div style={{ flex: 1, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 9, padding: '11px 14px', textAlign: 'center' }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-mono)', color }}>{value}</div>
    </div>
  );
}

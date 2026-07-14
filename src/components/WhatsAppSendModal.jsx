// إرسال حملة واتساب عبر Hatif/Voxa — معاينة → تأكيد → نتائج.
// External action: nothing is sent until the operator presses «إرسال الآن».
// The API key lives only in the edge function; this UI never sees it.

import { useState, useEffect } from 'react';
import { MessageCircle, ShieldCheck, Send, X, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Modal, Btn, Input, Spinner, toast } from './UI.jsx';
import {
  loadWhatsAppConfig, saveWhatsAppConfig, verifyWhatsAppKey, sendWhatsAppCampaign,
} from '../lib/whatsappService.js';
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

  useEffect(() => {
    if (!open) return;
    setResults(null); setVerified(null);
    loadWhatsAppConfig().then(setCfg).catch(() => setCfg({ channelId: '', templateName: '', templateLanguage: 'ar' }));
  }, [open]);

  if (!open) return null;

  const valid = recipients.filter(r => r.to && r.to.length >= 11);
  const skipped = recipients.length - valid.length;
  const amountTotal = valid.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const overLimit = valid.length > 200;

  const saveCfg = async (next) => {
    setCfg(next);
    try { await saveWhatsAppConfig(next); } catch (e) { toast(`تعذّر حفظ الإعداد: ${e.message}`, 'error'); }
  };

  const doVerify = async () => {
    setVer(true); setVerified(null);
    const r = await verifyWhatsAppKey();
    setVer(false);
    if (r?.ok) { setVerified(true); toast('المفتاح يعمل ✓', 'success'); }
    else { setVerified(false); toast(`فشل التحقق: ${r?.error || 'غير معروف'}`, 'error'); }
  };

  const doSend = async () => {
    if (!cfg?.templateName) { toast('اسم القالب مطلوب', 'warn'); return; }
    if (!valid.length) { toast('لا يوجد مستلِمون بأرقام صالحة', 'warn'); return; }
    if (overLimit) { toast('الحد 200 مستلِم لكل دفعة — صفِّ القائمة أكثر', 'warn'); return; }
    setSending(true);
    const r = await sendWhatsAppCampaign({
      templateName: cfg.templateName,
      templateLanguage: cfg.templateLanguage || 'ar',
      channelId: cfg.channelId || null,
      items: valid.map(v => ({ to: v.to, vars: v.vars, name: v.name, amount: v.amount })),
      campaign: { name: bucketLabel ? `تحصيل — ${bucketLabel}` : 'تحصيل', bucketFilter: bucketLabel || null, userId: user?.id || null },
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
        // ── Preview + config view ──
        <div>
          {/* Config — الإرسال عبر Hatif */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 8 }}>
            <Input label="اسم القالب المعتمد" value={cfg.templateName}
              onChange={e => saveCfg({ ...cfg, templateName: e.target.value })} placeholder="مثال: dues_notice"/>
            <Input label="لغة القالب" value={cfg.templateLanguage}
              onChange={e => saveCfg({ ...cfg, templateLanguage: e.target.value })} placeholder="ar"/>
          </div>
          <Input label="معرّف القناة (ChannelId) — مطلوب" value={cfg.channelId}
            onChange={e => saveCfg({ ...cfg, channelId: e.target.value })} placeholder="ChannelId من لوحة Hatif"/>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0 14px' }}>
            <Btn size="sm" variant="ghost" onClick={doVerify} disabled={verifying}>
              <ShieldCheck size={14}/> {verifying ? 'جارٍ التحقق…' : 'تحقّق من المفتاح'}
            </Btn>
            {verified === true  && <span style={{ color: 'var(--green2)', fontSize: 12 }}><CheckCircle2 size={13}/> المفتاح يعمل</span>}
            {verified === false && <span style={{ color: 'var(--red)', fontSize: 12 }}><X size={13}/> فشل — راجع المفتاح/الخطة</span>}
          </div>

          {/* Preview */}
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '13px 16px', marginBottom: 12 }}>
            <Row label="الشريحة" value={bucketLabel || 'كل العملاء المعروضين'}/>
            <Row label="مستلِمون صالحون" value={`${valid.length}${skipped ? ` (تُخطّي ${skipped} بلا رقم)` : ''}`}/>
            <Row label="إجمالي المبالغ" value={`${fmt(amountTotal)} ر.س`}/>
            <Row label="المتغيّرات" value="الاسم · المبلغ · عدد الفواتير"/>
          </div>

          {overLimit && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--red)', fontSize: 12, marginBottom: 10 }}>
              <AlertTriangle size={15}/> {valid.length} مستلِم — الحد 200 لكل دفعة. صفِّ القائمة أكثر.
            </div>
          )}

          <div style={{ background: 'rgba(217,119,6,.07)', border: '1px solid rgba(217,119,6,.3)', borderRadius: 8, padding: '9px 12px', fontSize: 11.5, color: '#92400E', marginBottom: 14 }}>
            ⚠️ سيُرسَل القالب فعلياً لـ{valid.length} عميل عبر واتساب. لا يمكن التراجع بعد الإرسال.
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-start' }}>
            <Btn variant="accent" onClick={doSend} disabled={sending || !valid.length || overLimit}>
              {sending ? <><Spinner size={14}/> جارٍ الإرسال…</> : <><Send size={14}/> إرسال الآن ({valid.length})</>}
            </Btn>
            <Btn variant="ghost" onClick={onClose} disabled={sending}>إلغاء</Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 12.5 }}>
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
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

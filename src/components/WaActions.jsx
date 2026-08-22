// WaActions — أزرار التواصل الموحّدة لأي صف/بطاقة فيها هاتف:
//   📞 اتصال · ✈️ إطلاق حملة قالب (الفعل الرئيسي — مسجَّل ومتتبَّع)
// يدير مودال WhatsAppSendModal بنفسه (مستلِم واحد) — فيُزرَع في أي صفحة بلا سباكة.
// قاعدة §1.29: أي إرسال قالب يمرّ عبر sendWhatsAppCampaign (تسجيل+تتبّع).
// قرار المستخدم (2026-07-16): «كل شي على هاتف» — wa.me الحرّة مطفأة افتراضياً
// (كانت تظهر وحدها لمن لا يملك campaigns.send فتضيع المحادثة خارج النظام)،
// وزر الحملة يظهر للجميع والمودال نفسه يوضّح الصلاحية الناقصة.
import { useState } from 'react';
import { MessageCircle, Send } from 'lucide-react';
import { normalizeSaudiPhone } from '../lib/whatsappService.js';
import WhatsAppSendModal from './WhatsAppSendModal.jsx';
import IvrCallButton from './IvrCallButton.jsx';

// props: phone (خام — يُطبَّع داخلياً) · name · amount? · count? · vars? (افتراضها [name])
//        campaignLabel? (اسم الحملة في السجل) · size? (حجم الأيقونات) · showTel?/showChat?
export default function WaActions({ phone, name, amount = null, count = null, vars = null,
  fields = null, campaignLabel = null, size = 15, showTel = true, showChat = false,
  salesAudience = false }) {
  const [open, setOpen] = useState(false);
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  const normalized = normalizeSaudiPhone(digits);
  const chat = `https://wa.me/${normalized}`;
  const displayName = (name || '').trim() || normalized;

  const recipient = {
    to: normalized, name: displayName, amount, count,
    vars: vars || [displayName],
    fields: { name: displayName, amount, count, phone: normalized, ...(fields || {}) },
  };

  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
      {showTel && (
        <IvrCallButton phone={normalized} name={displayName} fields={recipient.fields} size={size}/>
      )}
      <button onClick={() => setOpen(true)} title="إرسال واتساب عبر هاتف (قالب معتمد — يُسجَّل ويُتتبَّع)"
        className="wa-icon-btn"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--green)', padding: 0, display: 'inline-flex' }}>
        <Send size={size}/>
      </button>
      {showChat && (
        <a href={chat} target="_blank" rel="noreferrer" title="محادثة يدوية (بلا قالب — لا تُسجَّل كحملة)"
          style={{ color: 'var(--muted)', display: 'inline-flex' }}><MessageCircle size={size}/></a>
      )}
      {open && (
        <WhatsAppSendModal open={open} recipients={[recipient]}
          bucketLabel={campaignLabel || `العميل ${displayName}`}
          salesAudience={salesAudience}
          onClose={() => setOpen(false)} onSent={() => setOpen(false)}/>
      )}
    </span>
  );
}

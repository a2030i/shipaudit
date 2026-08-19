// IvrCallButton — زر «اتصال» موحّد يطلق مكالمة IVR آلية (بدل فتح هاتف الجهاز).
// قرار المستخدم (2026-07-22): كل «اتصال» في النظام يمرّ عبر IVR. يدير مودال الإطلاق
// بنفسه (مستلِم واحد) فيُزرَع في أي بطاقة/صف بلا سباكة. الصلاحية campaigns.ivr
// تُفحَص داخل المودال (يعرض قفلاً لمن لا يملكها) + سيرفرياً في hatif-ivr.
import { useState } from 'react';
import { PhoneCall } from 'lucide-react';
import IvrCampaignModal from './IvrCampaignModal.jsx';

// props: phone (خام) · name · fields? (لملء متغيّرات النص {name}/{amount}) · size · label (يُظهر كلمة «اتصال») · style?
export default function IvrCallButton({ phone, name, fields = null, size = 15, label = false, labelText = 'اتصال', style = {} }) {
  const [open, setOpen] = useState(false);
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  const displayName = (name || '').trim() || digits;

  return (
    <>
      <button type="button" onClick={e => { e.stopPropagation(); setOpen(true); }} title="اتصال آلي (IVR)"
        aria-label={`${labelText} — ${displayName}`}
        className={label ? undefined : 'wa-icon-btn'}
        style={label ? {
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 9,
          border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)',
          cursor: 'pointer', fontSize: 13, fontWeight: 600, ...style,
        } : {
          background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)', padding: 0,
          display: 'inline-flex', ...style,
        }}>
        <PhoneCall size={size}/>{label && <span>{labelText}</span>}
      </button>
      {open && (
        <IvrCampaignModal open={open} recipients={[{ phone: digits, name: displayName, fields: fields || { name: displayName } }]}
          bucketLabel={`اتصال ${displayName}`} onClose={() => setOpen(false)}/>
      )}
    </>
  );
}

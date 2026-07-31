// TagButton — وسم محادثة العميل في هاتف يدوياً بحالته (VIP/عليه مديونية/متوقف…).
// يجلب التاقات والاختيار الحالي من هاتف، ثم يطبّق القائمة الكاملة على أحدث محادثة.
// قراءة الحالة أولاً تمنع مسح تاقات الموظفين أو تاقات لمحة بلا قصد.
import { useState } from 'react';
import { Tag, X } from 'lucide-react';
import { Modal, Btn, Spinner, toast } from './UI.jsx';
import { loadHatifTags, applyConversationTags } from '../lib/whatsappService.js';
import { useAuth } from '../lib/auth.jsx';

// props: phone (خام) · name · suggest? (أسماء تاقات مقترحة من حالة العميل، تُعلَّم مبدئياً)
export default function TagButton({ phone, name, suggest = [], size = 13, compact = false }) {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const [tags, setTags] = useState(null);
  const [sel, setSel] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits || !can('campaigns.send')) return null;

  const openModal = async () => {
    setOpen(true);
    if (tags == null) {
      const current = await loadHatifTags(digits);
      const t = current.tags || [];
      setTags(t);
      // ابدأ بما هو مطبّق فعلاً، ثم أضف المقترحات المبنية على حالة العميل.
      const sg = new Set((suggest || []).map(s => String(s).trim()));
      setSel(new Set([
        ...(current.selectedTagIds || []),
        ...t.filter(x => sg.has(String(x.name).trim())).map(x => x.id),
      ]));
    }
  };
  const toggle = (id) => setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const apply = async () => {
    setBusy(true);
    try {
      await applyConversationTags(digits, Array.from(sel));
      toast(sel.size ? `وُسِم بـ${sel.size} تاق ✓` : 'أُزيلت كل التاقات ✓', 'success');
      setOpen(false);
    } catch (e) { toast(e.message || 'فشل الوسم', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <>
      <button onClick={e => { e.stopPropagation(); openModal(); }} title="وسم المحادثة في هاتف"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', padding: 0,
          display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: compact ? size : 11.5, fontWeight: 600 }}>
        <Tag size={size}/>{!compact && ' وسم'}
      </button>
      {open && (
        <Modal onClose={busy ? undefined : () => setOpen(false)} title={`🏷️ وسم ${name || digits} في هاتف`} width={440}>
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>يُطبَّق على أحدث محادثة واتساب للعميل في هاتف — فيراه فريقك في صندوق الوارد.</div>
            {tags == null ? <div style={{ padding: 20, textAlign: 'center' }}><Spinner/></div>
            : !tags.length ? <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>لا تاقات في هاتف — أنشئها من واجهة هاتف أولاً (Tags).</div>
            : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {tags.map(t => {
                  const on = sel.has(t.id);
                  return (
                    <button key={t.id} onClick={() => toggle(t.id)}
                      style={{ padding: '6px 12px', borderRadius: 999, cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
                        border: `1.5px solid ${on ? (t.color || 'var(--accent)') : 'var(--border)'}`,
                        background: on ? (t.color ? `color-mix(in srgb, ${t.color} 18%, transparent)` : 'color-mix(in srgb, var(--accent) 15%, transparent)') : 'transparent',
                        color: 'var(--text)' }}>
                      {on ? '✓ ' : ''}{t.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 16 }}>
            <Btn variant="ghost" onClick={() => setOpen(false)} disabled={busy}><X size={15}/> إلغاء</Btn>
            {tags?.length ? (
              <Btn variant="accent" onClick={apply} disabled={busy}>{busy ? <Spinner size={15}/> : <Tag size={15}/>} {sel.size ? `تطبيق (${sel.size})` : 'إزالة كل التاقات'}</Btn>
            ) : null}
          </div>
        </Modal>
      )}
    </>
  );
}

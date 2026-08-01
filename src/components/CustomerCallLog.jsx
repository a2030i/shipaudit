// سجل مكالمات العميل — سجل هاتف الكامل (يدوية للفريق + آلية) مع اسم الموظف
// والتسجيل والملخّص. قابل للطيّ، ويُحمّل عند الفتح.
import { useState } from 'react';
import { PhoneCall, ChevronDown } from 'lucide-react';
import { loadHatifCallsByPhone, HATIF_SENTIMENT, HATIF_CALL_STATUS } from '../lib/ivrService.js';

import { saDateTime as fmtDate } from '../lib/saTime.js';   // توقيت السعودية
const fmtDur = (s) => { s = Number(s) || 0; if (!s) return ''; const m = Math.floor(s / 60), ss = s % 60; return `${m}:${String(ss).padStart(2, '0')}`; };

export default function CustomerCallLog({ phone, compact = true }) {
  const [open, setOpen] = useState(false);
  const [calls, setCalls] = useState(null);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    const next = !open; setOpen(next);
    if (next && calls == null) {
      setLoading(true);
      try { setCalls(await loadHatifCallsByPhone(phone)); } catch { setCalls([]); }
      setLoading(false);
    }
  };
  if (!phone) return null;

  return (
    <div style={{ marginTop: 6 }}>
      <button onClick={toggle} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 11.5, fontWeight: 600, padding: 0 }}>
        <PhoneCall size={12}/> سجل المكالمات {calls?.length ? `(${calls.length})` : ''} <ChevronDown size={12} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}/>
      </button>
      {open && (
        <div style={{ marginTop: 6, display: 'grid', gap: 6 }}>
          {loading ? <div style={{ fontSize: 11, color: 'var(--muted)' }}>جارٍ التحميل…</div>
          : !calls?.length ? <div style={{ fontSize: 11, color: 'var(--muted)' }}>لا مكالمات مسجّلة لهذا الرقم في سجل هاتف.</div>
          : calls.map(c => {
            const sent = HATIF_SENTIMENT[c.sentiment] || null;
            const st = HATIF_CALL_STATUS[c.status] || c.status || '';
            return (
              <div key={c.id} style={{ border: '1px solid var(--border)', borderRadius: 9, padding: '8px 10px', fontSize: 11.5, background: 'var(--surface2)' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600 }}>{c.call_type === 1 ? '↙ وارد' : '↗ صادر'}</span>
                  {c.agent_name && <span style={{ color: 'var(--muted)' }}>· {c.agent_name}</span>}
                  {st && <span style={{ color: 'var(--muted)' }}>· {st}</span>}
                  {c.duration_seconds ? <span style={{ color: 'var(--muted)', direction: 'ltr' }}>· {fmtDur(c.duration_seconds)}</span> : null}
                  {sent && sent.e && <span style={{ color: sent.c }}>· {sent.e} {sent.t}</span>}
                  <span style={{ color: 'var(--muted2)', marginInlineStart: 'auto' }}>{fmtDate(c.started_at || c.created_at)}</span>
                </div>
                {c.summary && <div style={{ marginTop: 5, color: 'var(--text)', lineHeight: 1.6 }}>📝 {c.summary}</div>}
                {c.recording_url && (
                  <audio src={c.recording_url} controls preload="none" style={{ height: 30, width: '100%', marginTop: 5 }}/>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// سجلّ تواصل العميل الموحّد — يُعرض في بطاقة العميل (مركز العمليات، بلا دخول هاتف).
// يجمع حملات واتساب + مكالمات IVR (تسجيل + ملخّص + مشاعر) + مَن تولّى محادثته.
// المصدر: RPC customer_comm_timeline (كل ما هو مربوط برقم العميل فعلاً).
import { useState, useEffect, useMemo } from 'react';
import { Spinner } from './UI.jsx';
import CallTranscript from './CallTranscript.jsx';
import { loadCustomerCommTimeline, loadHatifUsers } from '../lib/whatsappService.js';

const fmtWhen = (iso) => { if (!iso) return '—'; try { return new Date(iso).toLocaleString('ar-SA', { dateStyle: 'medium', timeStyle: 'short' }); } catch { return String(iso).slice(0, 16); } };
const sentLabel = (v) => { const n = Number(v); if (!n) return null; return n >= 4 ? `😊 إيجابي` : n <= 2 ? `😞 سلبي` : `😐 محايد`; };

const KIND = {
  campaign: { icon: '📲', label: 'حملة واتساب', color: '#0EA5E9' },
  ivr:      { icon: '🤖', label: 'مكالمة آلية', color: '#8B5CF6' },
  handled:  { icon: '💬', label: 'تولّى موظف محادثته', color: 'var(--green)' },
};
const STATUS_AR = { sent: 'أُرسلت', delivered: 'وصلت', read: 'قُرئت', replied: 'ردّ ✓', failed: 'فشلت' };
const STATUS_COLOR = { sent: 'var(--muted)', delivered: '#0EA5E9', read: '#8B5CF6', replied: 'var(--green)', failed: 'var(--red)' };

export default function CustomerCommTimeline({ phone, title = 'سجلّ تواصل العميل' }) {
  const [rows, setRows] = useState(null);
  const [users, setUsers] = useState([]);
  const [open, setOpen] = useState(null);

  useEffect(() => { setRows(null); if (phone) loadCustomerCommTimeline(phone).then(setRows).catch(() => setRows([])); else setRows([]); }, [phone]);
  useEffect(() => { loadHatifUsers().then(setUsers).catch(() => {}); }, []);
  const nameById = useMemo(() => { const m = new Map(); users.forEach(u => { if (u.userId) m.set(String(u.userId), u.name || u.email); }); return m; }, [users]);

  if (rows == null) return <div style={{ padding: 20, textAlign: 'center' }}><Spinner/></div>;

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text)' }}>🕘 {title}</div>
      {!rows.length ? (
        <div style={{ fontSize: 12, color: 'var(--muted)', padding: '6px 2px' }}>
          لا تواصل مسجَّل لهذا الرقم بعد (حملات/مكالمات آلية/محادثات). المكالمات الصوتية اليدوية لا تُنسَب للعميل بعد — بانتظار هاتف.
        </div>
      ) : rows.map((r, i) => {
        const k = KIND[r.kind] || { icon: '•', label: r.kind, color: 'var(--muted)' };
        const isOpen = open === i;
        const sum = r.ai_summary?.summary;
        const expandable = r.recording_url || (Array.isArray(sum) && sum.length) || r.reply_body;
        return (
          <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 9, overflow: 'hidden' }}>
            <div onClick={() => expandable && setOpen(isOpen ? null : i)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', flexWrap: 'wrap', fontSize: 12.5, cursor: expandable ? 'pointer' : 'default' }}>
              <span style={{ fontSize: 15 }}>{k.icon}</span>
              <b style={{ color: k.color }}>{r.title || k.label}</b>
              {r.detail && <span style={{ color: 'var(--muted)' }}>· {r.detail}</span>}
              {r.status && STATUS_AR[r.status] && (
                <span style={{ padding: '1px 8px', borderRadius: 20, fontSize: 10.5, fontWeight: 700, background: `color-mix(in srgb, ${STATUS_COLOR[r.status]} 15%, transparent)`, color: STATUS_COLOR[r.status] }}>{STATUS_AR[r.status]}</span>
              )}
              {sentLabel(r.sentiment) && <span style={{ fontSize: 11 }}>{sentLabel(r.sentiment)}</span>}
              {r.agent_id && nameById.get(String(r.agent_id)) && <span style={{ fontSize: 11, color: 'var(--muted)' }}>— {nameById.get(String(r.agent_id))}</span>}
              <span style={{ marginInlineStart: 'auto', fontSize: 11, color: 'var(--muted2)' }}>{fmtWhen(r.occurred_at)}</span>
              {expandable && <span style={{ color: 'var(--muted2)', fontSize: 11 }}>{isOpen ? '▲' : '▼'}</span>}
            </div>
            {isOpen && expandable && (
              <div style={{ padding: '4px 12px 12px', borderTop: '1px solid var(--border)', display: 'grid', gap: 8, fontSize: 12.5 }}>
                {r.reply_body && <div style={{ background: 'color-mix(in srgb, var(--green) 8%, transparent)', borderRadius: 8, padding: '6px 10px' }}><b>ردّ العميل:</b> {r.reply_body}</div>}
                {r.recording_url && <audio controls preload="none" src={r.recording_url} style={{ width: '100%', height: 34 }}/>}
                {Array.isArray(sum) && sum.length > 0 && (
                  <div>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>📄 ملخّص المكالمة</div>
                    <ul style={{ margin: 0, paddingInlineStart: 18, lineHeight: 1.8 }}>{sum.map((s, j) => <li key={j}>{s}</li>)}</ul>
                  </div>
                )}
                {r.ai_summary?.transcription?.words && <CallTranscript words={r.ai_summary.transcription.words}/>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

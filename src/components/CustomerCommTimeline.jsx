// سجلّ تواصل العميل الموحّد — يُعرض في بطاقة العميل (مركز العمليات، بلا دخول هاتف).
// يجمع حملات واتساب + مكالمات IVR (تسجيل + ملخّص + مشاعر) + مَن تولّى محادثته.
// المصدر: RPC customer_comm_timeline (كل ما هو مربوط برقم العميل فعلاً).
import { useState, useEffect, useMemo } from 'react';
import { Spinner } from './UI.jsx';
import CallTranscript from './CallTranscript.jsx';
import { loadCustomerCommTimeline, loadHatifUsers, hatifInboxUrl } from '../lib/whatsappService.js';

const fmtWhen = (iso) => { if (!iso) return '—'; try { return new Date(iso).toLocaleString('ar-SA', { dateStyle: 'medium', timeStyle: 'short' }); } catch { return String(iso).slice(0, 16); } };
const sentLabel = (v) => { const n = Number(v); if (!n) return null; return n >= 4 ? `😊 إيجابي` : n <= 2 ? `😞 سلبي` : `😐 محايد`; };

const KIND = {
  campaign: { icon: '📲', label: 'حملة واتساب', color: 'var(--accent3)' },
  ivr:      { icon: '🤖', label: 'مكالمة آلية', color: 'var(--accent)' },
  voice_call: { icon: '📞', label: 'مكالمة هاتف', color: 'var(--blue)' },
  handled:  { icon: '💬', label: 'تولّى موظف محادثته', color: 'var(--green)' },
};
const STATUS_AR = { sent: 'أُرسلت', delivered: 'وصلت', read: 'قُرئت', replied: 'ردّ ✓', failed: 'فشلت', answered: 'تم الرد', not_answered: 'لم يُردّ' };
const STATUS_COLOR = { sent: 'var(--muted)', delivered: 'var(--accent3)', read: 'var(--accent)', replied: 'var(--green)', failed: 'var(--red)', answered: 'var(--green)', not_answered: 'var(--gold)' };
// تصنيف نية ردّ العميل — يبرز مَن مهتمّ بالحملة (طلب المستخدم).
const INTENT_META = {
  interested:     { label: '🔥 مهتمّ', color: 'var(--accent)' },
  wants_call:     { label: '📞 يطلب اتصالاً', color: 'var(--accent3)' },
  price:          { label: '💰 اعتراض سعر', color: 'var(--gold)' },
  not_interested: { label: '🚫 غير مهتمّ', color: 'var(--muted)' },
};
const summaryPoints = (value) => {
  if (!value) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(summaryPoints);
  if (typeof value === 'object') return Object.values(value).flatMap(summaryPoints);
  return [];
};

export default function CustomerCommTimeline({ phone, title = 'سجلّ تواصل العميل' }) {
  const [rows, setRows] = useState(null);
  const [users, setUsers] = useState([]);
  const [open, setOpen] = useState(null);
  // مطوي افتراضياً — بطاقة العميل صارت طويلة جداً بسجلّ ١٠+ أحداث (طلب
  // المستخدم 2026-07-28). الترويسة تُلخّص (العدد + آخر تواصل) والنقر يفتح.
  const [expanded, setExpanded] = useState(false);

  useEffect(() => { setRows(null); if (phone) loadCustomerCommTimeline(phone).then(setRows).catch(() => setRows([])); else setRows([]); }, [phone]);
  useEffect(() => { loadHatifUsers().then(setUsers).catch(() => {}); }, []);
  const nameById = useMemo(() => { const m = new Map(); users.forEach(u => { if (u.userId) m.set(String(u.userId), u.name || u.email); }); return m; }, [users]);

  if (rows == null) return <div style={{ padding: 20, textAlign: 'center' }}><Spinner/></div>;

  // أحدث محادثة لها conversation_id → رابط فتحها في هاتف (rows مرتّبة تنازلياً).
  const convId = rows.find(r => r.conversation_id)?.conversation_id;
  const inboxUrl = hatifInboxUrl(convId);

  const last = rows[0]?.occurred_at;

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div onClick={() => setExpanded(v => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', cursor: 'pointer',
          background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 9, padding: '8px 10px' }}>
        <span style={{ color: 'var(--muted2)', fontSize: 11 }}>{expanded ? '▲' : '▼'}</span>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text)' }}>🕘 {title}</div>
        {rows.length > 0 && (
          <span style={{ padding: '1px 8px', borderRadius: 20, fontSize: 10.5, fontWeight: 800,
            background: 'color-mix(in srgb, var(--accent) 15%, transparent)', color: 'var(--accent)' }}>{rows.length}</span>
        )}
        {!expanded && last && <span style={{ fontSize: 11, color: 'var(--muted)' }}>آخر تواصل: {fmtWhen(last)}</span>}
        {inboxUrl && (
          <a href={inboxUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
            style={{ marginInlineStart: 'auto', fontSize: 11.5, fontWeight: 700, color: '#fff', background: '#25D366',
              padding: '5px 11px', borderRadius: 999, textDecoration: 'none', display: 'inline-flex', gap: 5, alignItems: 'center' }}>
            💬 افتح المحادثة في هاتف ↗
          </a>
        )}
      </div>
      {!expanded ? null : !rows.length ? (
        <div style={{ fontSize: 12, color: 'var(--muted)', padding: '6px 2px' }}>
          لا تواصل مسجَّل لهذا الرقم بعد (حملات/مكالمات/محادثات).
        </div>
      ) : rows.map((r, i) => {
        const k = KIND[r.kind] || { icon: '•', label: r.kind, color: 'var(--muted)' };
        const isOpen = open === i;
        const sum = summaryPoints(r.ai_summary?.summary);
        const expandable = r.recording_url || sum.length || r.reply_body;
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
              {r.reply_intent && INTENT_META[r.reply_intent] && (
                <span style={{ padding: '1px 8px', borderRadius: 20, fontSize: 10.5, fontWeight: 800, background: `color-mix(in srgb, ${INTENT_META[r.reply_intent].color} 18%, transparent)`, color: INTENT_META[r.reply_intent].color }}>{INTENT_META[r.reply_intent].label}</span>
              )}
              {r.agent_id && nameById.get(String(r.agent_id)) && <span style={{ fontSize: 11, color: 'var(--muted)' }}>— {nameById.get(String(r.agent_id))}</span>}
              <span style={{ marginInlineStart: 'auto', fontSize: 11, color: 'var(--muted2)' }}>{fmtWhen(r.occurred_at)}</span>
              {expandable && <span style={{ color: 'var(--muted2)', fontSize: 11 }}>{isOpen ? '▲' : '▼'}</span>}
            </div>
            {/* مختصر ردّ العميل ظاهر في السطر (لا مخفياً) — طلب المستخدم: نعرف مَن مهتمّ بالحملة */}
            {r.reply_body && !isOpen && (
              <div style={{ padding: '0 12px 8px 34px', fontSize: 11.5, color: 'var(--text)', lineHeight: 1.5 }}>
                💬 <b style={{ color: 'var(--green)' }}>ردّه:</b> {r.reply_body.length > 90 ? r.reply_body.slice(0, 90).replace(/\n/g, ' ') + '…' : r.reply_body.replace(/\n/g, ' ')}
              </div>
            )}
            {isOpen && expandable && (
              <div style={{ padding: '4px 12px 12px', borderTop: '1px solid var(--border)', display: 'grid', gap: 8, fontSize: 12.5 }}>
                {r.reply_body && <div style={{ background: 'color-mix(in srgb, var(--green) 8%, transparent)', borderRadius: 8, padding: '6px 10px' }}><b>ردّ العميل:</b> {r.reply_body}</div>}
                {r.recording_url && <audio controls preload="none" src={r.recording_url} style={{ width: '100%', height: 34 }}/>}
                {sum.length > 0 && (
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

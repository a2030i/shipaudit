// جدول سجل حملات واتساب — مرجعية كاملة: المستلِم/القالب/الحملة/المُرسِل/الوقت/الحالة.
// يُستخدَم في تاب «الحملات» بالإعدادات (كامل مع فلاتر) وفي تاريخ العميل (مُدمَج، phone).
import { useState, useEffect } from 'react';
import { Spinner, Empty } from './UI.jsx';
import { loadWhatsAppLog } from '../lib/whatsappService.js';

const fmtDateTime = (d) => { if (!d) return '—'; try { return new Date(d).toLocaleString('ar-SA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return String(d).slice(0, 16); } };

// حالة الرسالة موحّدة → شارة ملوّنة (رد > فشل > قُرئت > وصلت > أُرسلت)
export function campaignStatusBadge(r) {
  if (r.repliedAt) return { label: '💬 ردّ', color: '#3B82F6' };
  if (r.status === 'Failed' || r.error) return { label: 'فشل', color: 'var(--red)' };
  if (r.readAt) return { label: 'قُرئت', color: 'var(--green2)' };
  if (r.deliveredAt) return { label: 'وصلت', color: 'var(--muted)' };
  return { label: 'أُرسلت', color: 'var(--muted2)' };
}

// شارة صغيرة
function Pill({ label, color }) {
  return <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, color, background: `color-mix(in srgb, ${color} 13%, transparent)`, whiteSpace: 'nowrap' }}>{label}</span>;
}

// جدول تقديمي (لا تحميل) — يستقبل الصفوف جاهزة
export function CampaignLogTable({ rows, compact = false }) {
  if (!rows?.length) return <Empty icon="📭" title="لا رسائل بعد" sub="ستظهر كل حملة أُرسلت هنا"/>;
  const th = { padding: '9px 11px', fontSize: 10.5, color: 'var(--muted)', whiteSpace: 'nowrap', textAlign: 'right' };
  const td = { padding: '9px 11px', fontSize: 12, verticalAlign: 'top' };
  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
      <table className="m-cards" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr style={{ background: 'var(--surface2)' }}>
          {['المستلِم', ...(compact ? [] : ['الجوال']), 'القالب', ...(compact ? [] : ['الحملة']), 'المُرسِل', 'الوقت', 'الحالة'].map(h => <th key={h} style={th}>{h}</th>)}
        </tr></thead>
        <tbody>
          {rows.map((r) => {
            const st = campaignStatusBadge(r);
            return (
              <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td data-label="المستلِم" style={{ ...td, fontWeight: 600 }}>{r.name || '—'}</td>
                {!compact && <td data-label="الجوال" style={{ ...td, fontFamily: 'var(--font-mono)', direction: 'ltr', textAlign: 'right', color: 'var(--muted)' }}>{r.phone}</td>}
                <td data-label="القالب" style={{ ...td, fontFamily: 'var(--font-mono)', fontSize: 11 }}>{r.template || '—'}</td>
                {!compact && <td data-label="الحملة" style={{ ...td, color: 'var(--muted)', fontSize: 11 }}>{r.campaign || '—'}</td>}
                <td data-label="المُرسِل" style={{ ...td }}>{r.sentBy || '—'}</td>
                <td data-label="الوقت" style={{ ...td, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{fmtDateTime(r.sentAt)}</td>
                <td data-label="الحالة" style={{ ...td }}>
                  <Pill {...st}/>
                  {r.repliedAt && r.replyBody && <div title={r.replyBody} style={{ fontSize: 10, color: 'var(--text2)', marginTop: 3, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>“{r.replyBody}”</div>}
                  {r.error && <div style={{ fontSize: 10, color: 'var(--red)', marginTop: 3 }}>{r.error}</div>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// تاريخ حملات عميل واحد (بالهاتف) — يُحمِّل ذاتياً، مُدمَج
export function CustomerCampaignHistory({ phone }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!phone) { setRows([]); return; }
    loadWhatsAppLog({ phone: String(phone).replace(/\D/g, ''), limit: 50 }).then(r => { if (alive) setRows(r); }).catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [phone]);
  if (rows == null) return <div style={{ padding: 14, textAlign: 'center' }}><Spinner size={16}/></div>;
  if (!rows.length) return <div style={{ fontSize: 12, color: 'var(--muted)', padding: '6px 2px' }}>لم تُرسَل حملات لهذا العميل بعد.</div>;
  return <CampaignLogTable rows={rows} compact/>;
}

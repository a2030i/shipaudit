// نصّ المكالمة الكامل — يجمّع كلمات aiSummary.transcription.words في أسطر
// حسب المتحدّث (Agent=الموظف / Customer=العميل). داخل <details> فلا يحتاج حالة.
export default function CallTranscript({ words }) {
  if (!Array.isArray(words) || !words.length) return null;
  const lines = [];
  let cur = null;
  for (const w of words) {
    const sp = w.speaker || '—';
    if (!cur || cur.speaker !== sp) { cur = { speaker: sp, text: w.text || '' }; lines.push(cur); }
    else cur.text += ' ' + (w.text || '');
  }
  const who = (s) => s === 'Agent' ? 'الموظف' : s === 'Customer' ? 'العميل' : s;
  const color = (s) => s === 'Agent' ? '#0EA5E9' : s === 'Customer' ? 'var(--green)' : 'var(--muted)';
  return (
    <details style={{ fontSize: 12 }}>
      <summary style={{ cursor: 'pointer', color: 'var(--accent)', fontWeight: 700, fontSize: 11.5 }}>📝 النص الكامل ({lines.length} مقطع)</summary>
      <div className="m-flow" style={{ maxHeight: 220, overflowY: 'auto', marginTop: 6, display: 'grid', gap: 4, padding: '6px 2px' }}>
        {lines.map((l, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, lineHeight: 1.6 }}>
            <b style={{ color: color(l.speaker), minWidth: 46, flexShrink: 0 }}>{who(l.speaker)}:</b>
            <span style={{ color: 'var(--text)' }}>{l.text}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

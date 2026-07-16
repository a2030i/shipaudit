// «يومي» — أول تبويب في مركز المبيعات (§1.37): يوم موظف المبيعات في شاشة
// واحدة. يجيب سؤالاً واحداً: بمن أبدأ الآن؟
//   ١) متابعاتي المستحقّة/المتأخرة (الأولوية القصوى)
//   ٢) ردود واتساب آخر 48 ساعة (أحرّ الفرص)
//   ٣) جهاتي الخارجية الجديدة التي لم أكلّمها
//   ٤) مهامي/مواعيدي المستحقّة
// المصدر: RPC sales_today() — استدعاء واحد. المدير يرى نفسه (ويستطيع لاحقاً
// اختيار موظف). كل بند ينقل لتبويبه الصحيح.
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sunrise, RefreshCw, Phone, MessageCircle, CalendarClock, UserPlus, CheckCircle2 } from 'lucide-react';
import { Card, Btn, Spinner, Empty, toast, PageHeader } from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import { loadSalesToday, statusMeta } from '../lib/retargetingService.js';
import WaActions from '../components/WaActions.jsx';

const fmtWhen = (d) => { try { return new Date(d).toLocaleString('ar-SA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return String(d || '').slice(0, 16); } };

function Section({ icon, title, count, color, children }) {
  return (
    <Card style={{ padding: '14px 16px', borderTop: `3px solid ${color}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        {icon}
        <span style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text)' }}>{title}</span>
        <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)', color, marginInlineStart: 'auto' }}>{count}</span>
      </div>
      {children}
    </Card>
  );
}

const rowStyle = { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 9, background: 'var(--surface)', border: '1px solid var(--border)' };

export default function SalesToday({ isActive = true }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    try { setD(await loadSalesToday()); }
    catch (e) { toast(`فشل التحميل: ${e.message}`, 'error'); setD(prev => prev || { dueFollowups: [], replies: [], myNewLeads: [], myTasks: [], myNewLeadsCount: 0, myFollowupsTotal: 0 }); }
    setBusy(false);
  };
  useEffect(() => { if (isActive && d == null) refresh(); }, [isActive]); // eslint-disable-line

  if (d == null) return <div style={{ padding: 60, textAlign: 'center' }}><Spinner size={26}/></div>;

  const nothing = !d.dueFollowups.length && !d.replies.length && !d.myNewLeads.length && !d.myTasks.length;

  return (
    <div style={{ padding: '24px 28px 80px', maxWidth: 1320, margin: '0 auto' }}>
      <PageHeader icon={<Sunrise size={22}/>} iconColor="#F97316"
        title="يومي — بمن أبدأ الآن؟"
        subtitle="متابعاتك المستحقّة، مَن ردّ عليك، جهاتك الجديدة، ومواعيدك — في شاشة واحدة"
        meta={`${d.myFollowupsTotal} متابعة نشطة مسندة لك`}
        actions={<Btn size="sm" variant="ghost" icon={<RefreshCw size={14} className={busy ? 'spin' : ''}/>} onClick={refresh} disabled={busy}>تحديث</Btn>}/>

      {nothing ? (
        <Card><Empty icon="🎉" title="لا شيء عاجلاً الآن" sub="لا متابعات مستحقّة ولا ردود جديدة — افتح «إعادة الاستهداف» واعمل على فرص جديدة"/></Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>

          {/* ١) الردود — أحرّ الفرص أولاً */}
          <Section icon={<MessageCircle size={16} color="var(--green)"/>} title="ردّوا عليك (آخر 48 ساعة)" count={d.replies.length} color="var(--green)">
            {!d.replies.length ? <div style={{ fontSize: 12, color: 'var(--muted2)' }}>لا ردود جديدة</div> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {d.replies.map((r, i) => (
                  <div key={i} style={rowStyle}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700 }}>{r.name || r.phone}</div>
                      {r.reply && <div style={{ fontSize: 11.5, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>💬 {r.reply}</div>}
                      <div style={{ fontSize: 10.5, color: 'var(--muted2)' }}>{fmtWhen(r.replied_at)} · {r.template}</div>
                    </div>
                    <WaActions phone={r.phone} name={r.name} campaignLabel="متابعة رد" size={14}/>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* ٢) المتابعات المستحقّة */}
          <Section icon={<CalendarClock size={16} color="var(--red)"/>} title="متابعات مستحقّة اليوم / متأخرة" count={d.dueFollowups.length} color="var(--red)">
            {!d.dueFollowups.length ? <div style={{ fontSize: 12, color: 'var(--muted2)' }}>لا متابعات مستحقّة ✓</div> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {d.dueFollowups.map((f, i) => {
                  const m = statusMeta(f.status);
                  return (
                    <div key={i} style={rowStyle}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 700 }}>{f.store || f.phone}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--muted2)' }}>
                          <span style={{ color: m.color, fontWeight: 700 }}>{m.label}</span>
                          {f.days_over > 0 && <span style={{ color: 'var(--red)', fontWeight: 700 }}> · متأخرة {f.days_over} يوم</span>}
                          {f.notes && <span> · {String(f.notes).slice(0, 40)}</span>}
                        </div>
                      </div>
                      <WaActions phone={f.phone} name={f.store} campaignLabel="متابعة مستحقة" size={14}/>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          {/* ٣) جهاتي الجديدة */}
          <Section icon={<UserPlus size={16} color="#0EA5E9"/>} title="جهاتك الجديدة (لم تُكلَّم بعد)" count={d.myNewLeadsCount} color="#0EA5E9">
            {!d.myNewLeads.length ? <div style={{ fontSize: 12, color: 'var(--muted2)' }}>لا جهات جديدة مسندة لك</div> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {d.myNewLeads.map((l) => (
                  <div key={l.id} style={rowStyle}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700 }}>{l.name}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--muted2)' }}>{l.category || ''}</div>
                    </div>
                    <WaActions phone={l.phone} name={l.name} campaignLabel="جهة جديدة" size={14}/>
                  </div>
                ))}
                {d.myNewLeadsCount > d.myNewLeads.length && (
                  <button onClick={() => navigate('/retargeting?tab=external')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--accent)', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-sans)', padding: 4 }}>
                    +{d.myNewLeadsCount - d.myNewLeads.length} أخرى — افتح «عملاء خارج المنصّة»
                  </button>
                )}
              </div>
            )}
          </Section>

          {/* ٤) مهامي/مواعيدي */}
          <Section icon={<CheckCircle2 size={16} color="var(--gold)"/>} title="مهامك ومواعيدك المستحقّة" count={d.myTasks.length} color="var(--gold)">
            {!d.myTasks.length ? <div style={{ fontSize: 12, color: 'var(--muted2)' }}>لا مهام مستحقّة ✓</div> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {d.myTasks.map((t) => (
                  <div key={t.id} style={rowStyle}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700 }}>{t.title}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--muted2)' }}>{fmtWhen(t.due_at)}{t.entity ? ` · ${t.entity}` : ''}</div>
                    </div>
                    <Btn size="sm" variant="ghost" onClick={() => navigate('/crm?tab=tasks')}>فتح</Btn>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

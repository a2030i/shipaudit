// «يومي» — أول تبويب في مركز المبيعات (§1.37): يوم موظف المبيعات في شاشة
// واحدة. يجيب سؤالاً واحداً: بمن أبدأ الآن؟
//   ١) متابعاتي المستحقّة/المتأخرة (الأولوية القصوى)
//   ٢) أعلى فرص متاجر المنصّة غير المستلمة
//   ٣) الجهات الخارجية الجديدة التي وصلت من ملف/ويب هوك
//   ٤) مهامي/مواعيدي المستحقّة
// ردود واتساب لا تفتح Lead هنا: المحادثة ومسؤوليتها التشغيلية داخل هاتف.
// المصدر: RPC sales_today() — استدعاء واحد. المدير يرى نفسه (ويستطيع لاحقاً
// اختيار موظف). كل بند ينقل لتبويبه الصحيح.
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sunrise, RefreshCw, CalendarClock, UserPlus, CheckCircle2, AlertTriangle, TimerReset, Store, WalletCards, RotateCcw } from 'lucide-react';
import { Card, Btn, Spinner, Empty, toast, PageHeader } from '../components/UI.jsx';
import { loadSalesToday, segmentMeta, setRetargetingFollowup, statusMeta } from '../lib/retargetingService.js';
import { useAuth } from '../lib/auth.jsx';
import WaActions from '../components/WaActions.jsx';

const fmtWhen = (d) => { try { return new Date(d).toLocaleString('ar-SA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return String(d || '').slice(0, 16); } };
const leadStageLabel = (s) => ({
  new: 'جديد', attempting: 'جارٍ التواصل', contacted: 'تم الرد', qualified: 'مؤهّل',
  proposal: 'عرض مقدّم', negotiation: 'تفاوض', nurture: 'متابعة لاحقة',
}[s] || s || '—');
const platformReason = (o) => {
  if (o.segment === 'topped_no_ship') return `شحن رصيد ${Number(o.wallet || 0).toLocaleString('en-US')} ر.س ولم يبدأ الشحن`;
  if (o.segment === 'stopped_recent') return `توقّف منذ ${o.days_since_last || '—'} يوم · ${Number(o.total_shipments || 0).toLocaleString('en-US')} شحنة سابقة`;
  if (o.segment === 'stopped_long') return `عميل مرتفع القيمة متوقف · ${Number(o.total_shipments || 0).toLocaleString('en-US')} شحنة سابقة`;
  if (o.segment === 'linked_no_ship') return 'أكمل الربط ولم ينفّذ أول شحنة';
  return 'سجّل حديثاً ولم ينفّذ أول شحنة';
};

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
  const navigate = useNavigate();
  const { user } = useAuth();
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const [claiming, setClaiming] = useState('');
  const [error, setError] = useState('');

  const refresh = async () => {
    setBusy(true);
    setError('');
    try { setD(await loadSalesToday()); }
    catch (e) { setError(e.message); toast(`فشل التحميل: ${e.message}`, 'error'); }
    setBusy(false);
  };
  useEffect(() => { if (isActive && d == null) refresh(); }, [isActive]); // eslint-disable-line

  const claimPlatformLead = async (lead) => {
    if (!user?.id || claiming) return;
    setClaiming(lead.phone);
    try {
      await setRetargetingFollowup(lead.phone, { ownerId: user.id, status: 'new' });
      toast(`أُسند متجر «${lead.store || lead.phone}» لك`, 'success');
      await refresh();
    } catch (e) {
      toast(`تعذّر استلام الفرصة: ${e.message}`, 'error');
    }
    setClaiming('');
  };

  if (d == null && error) return (
    <div style={{ padding: 40, maxWidth: 720, margin: '0 auto' }}>
      <Card style={{ borderColor: 'var(--red)', textAlign: 'center' }}>
        <AlertTriangle size={28} color="var(--red)" style={{ marginBottom: 8 }}/>
        <div style={{ fontWeight: 900 }}>تعذّر تحميل قائمة العمل</div>
        <div style={{ color: 'var(--muted)', fontSize: 12, margin: '6px 0 14px' }}>لم نعرض قائمة فارغة لأن الخطأ لا يعني عدم وجود فرص.</div>
        <Btn variant="primary" onClick={refresh}>إعادة المحاولة</Btn>
      </Card>
    </div>
  );
  if (d == null) return <div style={{ padding: 60, textAlign: 'center' }}><Spinner size={26}/></div>;

  const nothing = !d.platformOpportunities?.length && !d.unassignedInbound?.length && !d.leadActions?.length && !d.dueFollowups.length && !d.myNewLeads.length && !d.myTasks.length;

  return (
    <div style={{ padding: '24px 28px 80px', maxWidth: 1320, margin: '0 auto' }}>
      <PageHeader icon={<Sunrise size={22}/>} iconColor="var(--gold)"
        title="يومي — بمن أبدأ الآن؟"
        subtitle="الأولوية لمتاجر المنصّة: فعّل الجديد، تابع من شحن رصيداً، واستعد العميل المتوقف"
        meta={`${d.myFollowupsTotal} متابعة لك · ${d.platformOpportunityCount} فرصة منصة جاهزة`}
        actions={<Btn size="sm" variant="ghost" icon={<RefreshCw size={14} className={busy ? 'spin' : ''}/>} onClick={refresh} disabled={busy}>تحديث</Btn>}/>

      {nothing ? (
        <Card><Empty icon="🎉" title="لا شيء عاجلاً الآن" sub="لا متابعات مستحقّة ولا فرص منصة جاهزة — راجع العملاء الخارجيين أو خطّط لحملة جديدة"/></Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>

          <Section icon={<Store size={16} color="var(--brand)"/>} title="فرص متاجر المنصّة" count={d.platformOpportunityCount} color="var(--brand)">
            <div style={{ fontSize: 10.5, color: 'var(--muted)', margin: '-4px 0 9px' }}>
              يولّدها سلوك المتجر داخل لمحة، لا ردود واتساب. استلم الفرصة لتدخل متابعاتك.
            </div>
            {!d.platformOpportunities?.length ? <div style={{ fontSize: 12, color: 'var(--muted2)' }}>لا فرص منصة غير مستلمة الآن ✓</div> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {d.platformOpportunities.map((o) => {
                  const segment = segmentMeta(o.segment);
                  const SignalIcon = o.segment === 'topped_no_ship' ? WalletCards : o.segment?.startsWith('stopped') ? RotateCcw : UserPlus;
                  return (
                    <div key={o.phone} style={rowStyle}>
                      <SignalIcon size={15} color={segment.color}/>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 800 }}>{o.store || o.phone}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--muted2)' }}>{platformReason(o)}</div>
                      </div>
                      <Btn size="sm" variant="accent" disabled={!!claiming} onClick={() => claimPlatformLead(o)}>
                        {claiming === o.phone ? 'جارٍ الاستلام…' : 'استلام'}
                      </Btn>
                    </div>
                  );
                })}
                {d.platformOpportunityCount > d.platformOpportunities.length && (
                  <button onClick={() => navigate('/retargeting?tab=activation')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--brand)', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-sans)', padding: 4 }}>
                    +{d.platformOpportunityCount - d.platformOpportunities.length} فرصة أخرى — فتح قوائم التفعيل والاستعادة
                  </button>
                )}
              </div>
            )}
          </Section>

          <Section icon={<AlertTriangle size={16} color="var(--red)"/>} title="وارد جديد بلا مسؤول" count={d.unassignedInbound?.length || 0} color="var(--red)">
            {!d.unassignedInbound?.length ? <div style={{ fontSize: 12, color: 'var(--muted2)' }}>كل المهتمين الجدد مسندون ✓</div> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {d.unassignedInbound.map(l => (
                  <div key={l.id} style={rowStyle}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 800 }}>{l.name}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--red)' }}>{l.campaign_name || 'حملة واردة'} · وصل {fmtWhen(l.received_at)}</div>
                    </div>
                    <Btn size="sm" variant="primary" onClick={() => navigate('/retargeting?tab=external')}>إسناد</Btn>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section icon={<TimerReset size={16} color="var(--gold)"/>} title="إجراءات Leads مستحقة" count={d.leadActions?.length || 0} color="var(--gold)">
            {!d.leadActions?.length ? <div style={{ fontSize: 12, color: 'var(--muted2)' }}>لا مواعيد Leads مستحقة ✓</div> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {d.leadActions.map(l => (
                  <div key={l.id} style={rowStyle}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 800 }}>{l.name}</div>
                      <div style={{ fontSize: 10.5, color: new Date(l.next_at) < new Date() ? 'var(--red)' : 'var(--muted2)' }}>
                        {leadStageLabel(l.status)} · {fmtWhen(l.next_at)}
                      </div>
                    </div>
                    <WaActions phone={l.phone} name={l.name} campaignLabel="موعد Lead" size={14}/>
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
          <Section icon={<UserPlus size={16} color="var(--accent3)"/>} title="مهتمون جدد من الحملات" count={d.myNewLeadsCount} color="var(--accent3)">
            {!d.myNewLeads.length ? <div style={{ fontSize: 12, color: 'var(--muted2)' }}>لا مهتمين جدد مسندين لك</div> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {d.myNewLeads.map((l) => (
                  <div key={l.id} style={rowStyle}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700 }}>{l.name}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--muted2)' }}>{l.campaign_name || l.category || 'حملة واردة'} · {fmtWhen(l.received_at)}</div>
                    </div>
                    <WaActions phone={l.phone} name={l.name} campaignLabel="مهتم جديد" size={14}/>
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

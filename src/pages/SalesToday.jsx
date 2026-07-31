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
import { Sunrise, RefreshCw, CalendarClock, UserPlus, CheckCircle2, AlertTriangle, TimerReset, Store, WalletCards, RotateCcw, Archive, Gauge } from 'lucide-react';
import { Card, Btn, Spinner, Empty, toast, PageHeader } from '../components/UI.jsx';
import { claimPlatformSalesOpportunity, loadSalesToday, segmentMeta, statusMeta } from '../lib/retargetingService.js';
import { useAuth } from '../lib/auth.jsx';
import WaActions from '../components/WaActions.jsx';

const fmtWhen = (d) => { try { return new Date(d).toLocaleString('ar-SA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return String(d || '').slice(0, 16); } };
const leadStageLabel = (s) => ({
  new: 'جديد', attempting: 'جارٍ التواصل', contacted: 'تم الرد', qualified: 'مؤهّل',
  proposal: 'عرض مقدّم', negotiation: 'تفاوض', nurture: 'متابعة لاحقة',
}[s] || s || '—');
const platformReason = (o) => {
  if (o.next_step) return o.next_step;
  if (o.segment === 'topped_no_ship') return `شحن رصيد ${Number(o.wallet || 0).toLocaleString('en-US')} ر.س ولم يبدأ الشحن`;
  if (o.segment === 'stopped_recent') return `توقّف منذ ${o.days_since_last || '—'} يوم · ${Number(o.total_shipments || 0).toLocaleString('en-US')} شحنة سابقة`;
  if (o.segment === 'stopped_long') return `عميل مرتفع القيمة متوقف · ${Number(o.total_shipments || 0).toLocaleString('en-US')} شحنة سابقة`;
  if (o.segment === 'linked_no_ship') return 'أكمل الربط ولم ينفّذ أول شحنة';
  return 'سجّل حديثاً ولم ينفّذ أول شحنة';
};

const routeLabel = (route) => ({
  sales_activation: 'تفعيل مبيعات',
  sales_recovery: 'استعادة',
  onboarding: 'تهيئة المتجر',
  account_management: 'حساب رئيسي',
  sales_growth: 'تنمية',
  collections: 'تحصيل',
}[route] || '');

function OpportunityContext({ opportunity }) {
  const chips = [
    opportunity.readiness_score != null ? `جاهزية ${opportunity.readiness_score}%` : null,
    opportunity.store_count > 1 ? `${opportunity.store_count} متاجر` : null,
    routeLabel(opportunity.team_route),
  ].filter(Boolean);
  if (!chips.length) return null;
  return (
    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 4 }}>
      {chips.map(chip => (
        <span key={chip} style={{ fontSize: 9.5, color: 'var(--brand)', background: 'color-mix(in srgb, var(--brand) 9%, var(--surface))', border: '1px solid color-mix(in srgb, var(--brand) 20%, var(--border))', borderRadius: 999, padding: '2px 6px', fontWeight: 700 }}>
          {chip}
        </span>
      ))}
    </div>
  );
}

const DAILY_PLATFORM_LIMIT = 12;
const DAILY_CONTACT_TARGET = 20;

function Section({ icon, title, count, color, order = 0, children }) {
  return (
    <Card style={{ padding: '14px 16px', borderTop: `3px solid ${color}`, order }}>
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
      await claimPlatformSalesOpportunity(lead.phone, new Date().toISOString());
      toast(`أُضيف متجر «${lead.store || lead.phone}» إلى قائمة اليوم`, 'success');
      await refresh();
    } catch (e) {
      if (String(e.message).includes('already_claimed')) {
        toast('سبق أن استلم موظف آخر هذه الفرصة — حُدّثت القائمة', 'warning');
        await refresh();
      } else {
        toast(`تعذّر إضافة الفرصة: ${e.message}`, 'error');
      }
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

  const dailyPlatform = (d.platformOpportunities || []).slice(0, DAILY_PLATFORM_LIMIT);
  const mandatoryCount = d.dueFollowups.length
    + d.leadActions.length
    + d.myNewLeads.length
    + d.myTasks.length;
  const dailyQueueCount = mandatoryCount + dailyPlatform.length;
  const poolCount = d.platformOpportunityCount || 0;
  const targetFill = Math.min(100, Math.round((dailyQueueCount / DAILY_CONTACT_TARGET) * 100));
  const nothing = !dailyPlatform.length && !d.unassignedInbound?.length && !d.leadActions?.length && !d.dueFollowups.length && !d.myNewLeads.length && !d.myTasks.length;

  return (
    <div style={{ padding: '24px 28px 80px', maxWidth: 1320, margin: '0 auto' }}>
      <PageHeader icon={<Sunrise size={22}/>} iconColor="var(--gold)"
        title="يومي — بمن أبدأ الآن؟"
        subtitle="قائمة تنفيذ محدودة: المستحق أولًا، ثم أعلى فرص المنصّة قيمة"
        meta={`${mandatoryCount} إجراء ملزم الآن · ${dailyPlatform.length} فرصة مقترحة · ${poolCount} في مخزون الفرص`}
        actions={<Btn size="sm" variant="ghost" icon={<RefreshCw size={14} className={busy ? 'spin' : ''}/>} onClick={refresh} disabled={busy}>تحديث</Btn>}/>

      <Card style={{
        padding: '18px 20px', marginBottom: 14,
        background: 'linear-gradient(135deg, color-mix(in srgb, var(--brand) 13%, var(--surface)) 0%, color-mix(in srgb, var(--accent) 7%, var(--surface)) 100%)',
        borderColor: 'color-mix(in srgb, var(--brand) 25%, var(--border))',
      }}>
        <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{
            width: 48, height: 48, borderRadius: 15, display: 'grid', placeItems: 'center',
            color: 'var(--brand)', background: 'var(--surface)', border: '1px solid var(--border)',
          }}><Gauge size={24}/></span>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ color: 'var(--brand)', fontSize: 11, fontWeight: 900, marginBottom: 3 }}>حصتك الواقعية اليوم</div>
            <h2 style={{ margin: 0, fontSize: 21, color: 'var(--text)' }}>
              أمامك {dailyQueueCount} حالة الآن — وليس {poolCount} اتصالًا
            </h2>
            <p style={{ margin: '5px 0 0', color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.7 }}>
              الرقم الكبير هو مخزون فرص للفريق. ابدأ بالإجراءات الملزمة، ثم اختر من المقترحات الأعلى أولوية.
              ردود واتساب تبقى لدى فريق هاتف ولا تنشئ Lead هنا.
            </p>
          </div>
          <div style={{ minWidth: 210 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 11, marginBottom: 7 }}>
              <span style={{ color: 'var(--muted)' }}>نطاق يوم نوعي</span>
              <strong style={{ color: 'var(--brand)' }}>{dailyQueueCount} / {DAILY_CONTACT_TARGET}</strong>
            </div>
            <div style={{ height: 7, borderRadius: 99, background: 'var(--surface2)', overflow: 'hidden', marginBottom: 10 }}>
              <div style={{ width: `${targetFill}%`, height: '100%', borderRadius: 99, background: 'linear-gradient(90deg, var(--brand), var(--accent))' }}/>
            </div>
            <Btn size="sm" variant="ghost" onClick={() => navigate('/retargeting?tab=pipeline')}>
              استعراض مخزون الفرص
            </Btn>
          </div>
        </div>
      </Card>

      {(
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 14 }}>
          {[
            { icon: <CalendarClock size={16}/>, label: 'ملزم الآن', value: mandatoryCount, tone: mandatoryCount ? 'var(--red)' : 'var(--green)' },
            { icon: <Store size={16}/>, label: 'دفعة المنصّة المقترحة', value: dailyPlatform.length, tone: 'var(--brand)' },
            { icon: <UserPlus size={16}/>, label: 'مهتمون جدد لك', value: d.myNewLeadsCount, tone: 'var(--accent3)' },
            { icon: <Archive size={16}/>, label: 'مخزون مؤهل للفريق', value: poolCount, tone: 'var(--muted)' },
          ].map(item => (
            <Card key={item.label} style={{ padding: '11px 13px', display: 'flex', alignItems: 'center', gap: 9, borderInlineStart: `3px solid ${item.tone}` }}>
              <span style={{ color: item.tone }}>{item.icon}</span>
              <div>
                <div style={{ fontSize: 10.5, color: 'var(--muted2)' }}>{item.label}</div>
                <div style={{ fontSize: 18, fontWeight: 900, fontFamily: 'var(--font-mono)', color: item.tone }}>{item.value}</div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {nothing ? (
        <Card><Empty icon="🎉" title="لا شيء عاجلاً الآن" sub="لا متابعات مستحقّة ولا فرص منصة جاهزة — راجع العملاء الخارجيين أو خطّط لحملة جديدة"/></Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>

          <Section icon={<Store size={16} color="var(--brand)"/>} title="دفعة المنصّة المقترحة اليوم" count={`${dailyPlatform.length} فقط`} color="var(--brand)" order={4}>
            <div style={{ fontSize: 10.5, color: 'var(--muted)', margin: '-4px 0 9px' }}>
              أعلى فرص غير مستلمة حسب النية والقيمة. «أضف لليوم» يسندها لك ويضع موعدها الآن؛ الباقي يبقى مخزونًا للفريق.
            </div>
            {!dailyPlatform.length ? <div style={{ fontSize: 12, color: 'var(--muted2)' }}>لا فرص منصة غير مستلمة الآن ✓</div> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {dailyPlatform.map((o) => {
                  const segment = segmentMeta(o.segment);
                  const SignalIcon = o.segment === 'topped_no_ship' ? WalletCards : o.segment?.startsWith('stopped') ? RotateCcw : UserPlus;
                  return (
                    <div key={o.phone} style={rowStyle}>
                      <SignalIcon size={15} color={segment.color}/>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 800 }}>{o.store || o.phone}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--muted2)' }}>{platformReason(o)}</div>
                        <OpportunityContext opportunity={o}/>
                      </div>
                      <Btn size="sm" variant="accent" disabled={!!claiming} onClick={() => claimPlatformLead(o)}>
                        {claiming === o.phone ? 'جارٍ الإضافة…' : 'أضف لليوم'}
                      </Btn>
                    </div>
                  );
                })}
                {poolCount > dailyPlatform.length && (
                  <button onClick={() => navigate('/retargeting?tab=pipeline')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--brand)', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-sans)', padding: 4 }}>
                    {poolCount - dailyPlatform.length} فرصة أخرى في المخزون — ليست مطلوبة كلها اليوم
                  </button>
                )}
              </div>
            )}
          </Section>

          <Section icon={<AlertTriangle size={16} color="var(--red)"/>} title="وارد جديد بلا مسؤول" count={d.unassignedInbound?.length || 0} color="var(--red)" order={5}>
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

          <Section icon={<TimerReset size={16} color="var(--gold)"/>} title="إجراءات Leads مستحقة" count={d.leadActions?.length || 0} color="var(--gold)" order={2}>
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
          <Section icon={<CalendarClock size={16} color="var(--red)"/>} title="متابعات مستحقّة اليوم / متأخرة" count={d.dueFollowups.length} color="var(--red)" order={1}>
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
          <Section icon={<UserPlus size={16} color="var(--accent3)"/>} title="مهتمون جدد من الحملات" count={d.myNewLeadsCount} color="var(--accent3)" order={3}>
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
          <Section icon={<CheckCircle2 size={16} color="var(--gold)"/>} title="مهامك ومواعيدك المستحقّة" count={d.myTasks.length} color="var(--gold)" order={6}>
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

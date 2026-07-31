// مركز قيادة هدف العملاء النشطين. العميل = رقم هاتف فريد مهما تعددت متاجره.
// النجاح الموضوعي = آخر شحنة خلال نافذة النشاط؛ ردود واتساب في هاتف لا تنشئ Lead.
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, CalendarClock,
  CheckCircle2, CircleDollarSign, Clock3, PlugZap, RefreshCw, Save,
  ShieldAlert, Target as TargetIcon, TrendingUp, UserRoundCheck, UsersRound,
} from 'lucide-react';
import { Card, Btn, Spinner, Empty, PageHeader, toast } from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  loadActivationConfig,
  loadCustomerActivationCommandCenter,
  saveActivationConfig,
} from '../lib/retargetingService.js';

const fmt = value => Number(value || 0).toLocaleString('en-US');
const pct = value => `${Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
const fmtDate = value => {
  if (!value) return '—';
  try { return new Date(value).toLocaleDateString('ar-SA', { day: 'numeric', month: 'short' }); }
  catch { return String(value).slice(0, 10); }
};
const fmtAge = minutes => {
  const value = Number(minutes || 0);
  if (value < 60) return `منذ ${fmt(value)} دقيقة`;
  if (value < 1440) return `منذ ${fmt(Math.floor(value / 60))} ساعة`;
  return `منذ ${fmt(Math.floor(value / 1440))} يوم`;
};

function Metric({ icon, label, value, sub, color = 'var(--accent3)', tone = 'blue' }) {
  return (
    <div style={{
      padding: '15px 16px', borderRadius: 16,
      border: `1px solid color-mix(in srgb, ${color} 22%, var(--border))`,
      background: `linear-gradient(145deg, color-mix(in srgb, ${color} 9%, var(--surface)) 0%, var(--surface) 72%)`,
      minWidth: 0,
    }} data-tone={tone}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--muted)', fontSize: 12.5, marginBottom: 9 }}>
        <span style={{ display: 'grid', placeItems: 'center', color }}>{icon}</span>
        <span>{label}</span>
      </div>
      <div style={{ fontSize: 25, fontWeight: 800, fontFamily: 'var(--font-mono)', color, lineHeight: 1.15 }}>{fmt(value)}</div>
      {sub && <div style={{ color: 'var(--muted)', fontSize: 11.5, lineHeight: 1.7, marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

function QueueRow({ label, value, hint, color, icon, onClick }) {
  return (
    <button type="button" onClick={onClick} style={{
      width: '100%', display: 'grid', gridTemplateColumns: '40px minmax(0,1fr) auto',
      alignItems: 'center', gap: 10, padding: '11px 12px', borderRadius: 13,
      border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)',
      cursor: onClick ? 'pointer' : 'default', textAlign: 'start', fontFamily: 'inherit',
    }}>
      <span style={{ width: 36, height: 36, borderRadius: 11, display: 'grid', placeItems: 'center', color,
        background: `color-mix(in srgb, ${color} 11%, var(--surface))` }}>{icon}</span>
      <span style={{ minWidth: 0 }}>
        <strong style={{ display: 'block', fontSize: 13 }}>{label}</strong>
        <small style={{ color: 'var(--muted)', lineHeight: 1.6 }}>{hint}</small>
      </span>
      <strong style={{ color, fontFamily: 'var(--font-mono)', fontSize: 18 }}>{fmt(value)}</strong>
    </button>
  );
}

export default function StoreActivation({ isActive = true }) {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [cfg, setCfg] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [editTarget, setEditTarget] = useState('');
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const config = await loadActivationConfig();
      setCfg(config);
      setEditTarget(String(config.target));
      setData(await loadCustomerActivationCommandCenter(config.days, config.target, 24));
    } catch (error) {
      toast(`فشل تحميل مركز القيادة: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh]);

  const saveTarget = async () => {
    const target = Math.round(Number(editTarget) || 0);
    if (target < 1) { toast('أدخل هدفًا صحيحًا', 'warn'); return; }
    setSaving(true);
    try {
      await saveActivationConfig({ target, days: cfg.days });
      setCfg({ ...cfg, target });
      setData(await loadCustomerActivationCommandCenter(cfg.days, target, 24));
      toast('حُفظ الهدف ✓', 'success');
    } catch (error) {
      toast(`فشل الحفظ: ${error.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!cfg || data == null) return <div style={{ padding: 40, textAlign: 'center' }}><Spinner/></div>;
  if (!data.trend.length) return (
    <div style={{ padding: '24px 28px' }}>
      <Empty icon="📈" title="لا توجد لقطات متاجر بعد" sub="ارفع كشف المتاجر أو أرسل لقطة كاملة عبر Webhook"/>
    </div>
  );

  const current = data.current;
  const movement = data.movement;
  const execution = data.execution;
  const outcomes = data.outcomes30d;
  const sync = data.sync;
  const progress = Math.min(100, Number(current.progress_pct) || 0);
  const entered = Number(movement.entered) || 0;
  const exited = Number(movement.exited) || 0;
  const net = Number(movement.net) || 0;
  const maxActive = Math.max(Number(current.target) || 1, ...data.trend.map(row => row.active));
  const openPipeline = (bucket = 'all', work = 'all') => navigate(`/retargeting?tab=pipeline&bucket=${bucket}&work=${work}`);

  return (
    <div style={{ padding: '24px 28px 96px', maxWidth: 1380, margin: '0 auto' }}>
      <PageHeader
        icon={<TrendingUp size={22}/>} iconColor="var(--green)"
        title={`مركز قيادة ${fmt(current.target)} عميل نشط`}
        subtitle={`العميل النشط = رقم هاتف فريد نفّذ شحنة خلال آخر ${cfg.days} أيام؛ تعدد المتاجر لا يكرر العميل`}
        actions={<Btn size="sm" variant="ghost" onClick={refresh} disabled={loading} title="تحديث"><RefreshCw size={14} className={loading ? 'spin' : ''}/></Btn>}
      />

      <Card style={{
        overflow: 'hidden', marginBottom: 14,
        border: '1px solid color-mix(in srgb, var(--brand) 24%, var(--border))',
        background: 'linear-gradient(135deg, color-mix(in srgb, var(--brand-navy) 97%, black) 0%, color-mix(in srgb, var(--brand) 78%, var(--brand-navy)) 100%)',
        color: '#fff',
      }}>
        <div style={{ padding: '22px 24px 18px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(260px,100%),1fr))', gap: 24 }}>
          <div>
            <div style={{ color: 'rgba(255,255,255,.7)', fontSize: 12.5, marginBottom: 7 }}>العملاء النشطون الآن</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 50, lineHeight: 1, fontFamily: 'var(--font-mono)' }}>{fmt(current.active)}</strong>
              <span style={{ color: 'rgba(255,255,255,.72)', fontSize: 15 }}>من {fmt(current.target)}</span>
            </div>
            <div style={{ height: 12, marginTop: 18, borderRadius: 999, background: 'rgba(255,255,255,.16)', overflow: 'hidden' }}>
              <div style={{ width: `${progress}%`, height: '100%', background: 'linear-gradient(90deg,#2DD4BF,#A7F3D0)', borderRadius: 999 }}/>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 8, fontSize: 12.5, color: 'rgba(255,255,255,.76)', flexWrap: 'wrap' }}>
              <span>{pct(progress)} من الهدف</span>
              <span>الفجوة: <strong style={{ color: '#fff' }}>{fmt(current.gap)} عميل</strong></span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 10 }}>
            <div style={{ padding: 13, borderRadius: 14, background: 'rgba(255,255,255,.10)', border: '1px solid rgba(255,255,255,.14)' }}>
              <div style={{ color: 'rgba(255,255,255,.7)', fontSize: 11.5 }}>دخلوا النشاط أسبوعيًا</div>
              <strong style={{ display: 'block', fontSize: 25, color: '#A7F3D0', marginTop: 5, fontFamily: 'var(--font-mono)' }}>+{fmt(entered)}</strong>
            </div>
            <div style={{ padding: 13, borderRadius: 14, background: 'rgba(255,255,255,.10)', border: '1px solid rgba(255,255,255,.14)' }}>
              <div style={{ color: 'rgba(255,255,255,.7)', fontSize: 11.5 }}>خرجوا من النشاط</div>
              <strong style={{ display: 'block', fontSize: 25, color: '#FECACA', marginTop: 5, fontFamily: 'var(--font-mono)' }}>−{fmt(exited)}</strong>
            </div>
            <div style={{ gridColumn: '1 / -1', padding: 13, borderRadius: 14, background: 'rgba(255,255,255,.10)', border: '1px solid rgba(255,255,255,.14)', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <span style={{ color: 'rgba(255,255,255,.78)', fontSize: 12 }}>صافي الأسبوع</span>
              <strong style={{ color: net >= 0 ? '#A7F3D0' : '#FECACA', fontFamily: 'var(--font-mono)', fontSize: 20 }}>{net >= 0 ? '+' : ''}{fmt(net)}</strong>
            </div>
          </div>
        </div>
        <div style={{ padding: '11px 24px', background: 'rgba(0,0,0,.13)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', fontSize: 11.5, color: 'rgba(255,255,255,.72)' }}>
          <span>آخر بيانات: {fmtAge(sync.age_minutes)} · {sync.source === 'webhook' ? 'تحديث آلي عبر API' : 'رفع Excel يدوي'}</span>
          <span>{fmt(current.total_customers)} عميل فريد · {fmt(current.total_stores)} متجر</span>
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 12, marginBottom: 14 }}>
        <Metric icon={<TargetIcon size={17}/>} label="المطلوب إدخالهم أسبوعيًا" value={current.required_weekly_entrants}
          sub="لإغلاق الفجوة خلال 4 أسابيع مع تعويض من يخرج" color="var(--brand)"/>
        <Metric icon={<UserRoundCheck size={17}/>} label={`نشط خلال ${cfg.days} أيام`} value={current.active}
          sub={`${fmt(current.active_30d)} نشط خلال 30 يومًا`} color="var(--green2)"/>
        <Metric icon={<ShieldAlert size={17}/>} label="نشط وعليه معلّق مالي" value={current.active_financial_hold}
          sub="يظل ضمن الهدف التشغيلي، لكن لا يذهب للمبيعات" color="var(--red)"/>
        <Metric icon={<UsersRound size={17}/>} label="عملاء متاحون للمبيعات" value={current.active_sales_eligible}
          sub="نشطون بلا مديونية زوهو أو محفظة سالبة" color="var(--accent3)"/>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(330px,100%),1fr))', gap: 14, marginBottom: 14 }}>
        <Card style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 13 }}>
            <Activity size={18} style={{ color: 'var(--brand)' }}/>
            <div>
              <strong style={{ display: 'block', fontSize: 14 }}>روافع الوصول إلى 500</strong>
              <small style={{ color: 'var(--muted)' }}>مخزون فرص، لا يعني الاتصال بها كلها اليوم</small>
            </div>
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            <QueueRow label="لايف جديد عالي النية" value={execution.hot_live} hint="ربط متجره خلال 5 أيام ولم يبدأ" color="var(--brand)" icon={<PlugZap size={17}/>} onClick={() => openPipeline('hot_live_new')}/>
            <QueueRow label="تجاوز 5 أيام بلا شحنة" value={execution.recent_stop} hint="الأقرب للتوقف أولًا، لا الأقدم" color="var(--gold)" icon={<Clock3 size={17}/>} onClick={() => openPipeline('recent_stop')}/>
            <QueueRow label="رصيد عالق بلا نشاط" value={execution.wallet_stranded} hint="نفهم العائق قبل أن تُهجر المحفظة" color="var(--green2)" icon={<CircleDollarSign size={17}/>} onClick={() => openPipeline('wallet_stranded')}/>
            <QueueRow label="لايف أصبح غير نشط" value={execution.live_inactive} hint="نعرف سبب فك الربط أو تعطله" color="var(--red)" icon={<AlertTriangle size={17}/>} onClick={() => openPipeline('live_inactive')}/>
          </div>
        </Card>

        <Card style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 13 }}>
            <CalendarClock size={18} style={{ color: 'var(--gold)' }}/>
            <div>
              <strong style={{ display: 'block', fontSize: 14 }}>انضباط تنفيذ الفريق</strong>
              <small style={{ color: 'var(--muted)' }}>الفجوات التي تمنع الإدارة من قيادة العمل</small>
            </div>
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            <QueueRow label="لم نتواصل معهم" value={execution.never_contacted} hint="فرص مؤهلة بلا أول محاولة مسجلة" color="var(--red)" icon={<ArrowUpRight size={17}/>} onClick={() => openPipeline('all', 'never_contacted')}/>
            <QueueRow label="بلا مسؤول" value={execution.unassigned} hint="لا يملكها موظف محدد" color="var(--gold)" icon={<UsersRound size={17}/>} onClick={() => openPipeline('all', 'unassigned')}/>
            <QueueRow label="متابعة مستحقة" value={execution.overdue} hint="موعدها انتهى وتحتاج إجراء الآن" color="var(--red)" icon={<Clock3 size={17}/>} onClick={() => openPipeline('all', 'due')}/>
            <QueueRow label="تواصل بلا موعد تالٍ" value={execution.contacted_no_next} hint="سجل مفتوح قد يضيع من الفريق" color="var(--gold)" icon={<ArrowDownRight size={17}/>} onClick={() => openPipeline('all', 'contacted_no_next')}/>
          </div>
        </Card>

        <Card style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 13 }}>
            <CheckCircle2 size={18} style={{ color: 'var(--green2)' }}/>
            <div>
              <strong style={{ display: 'block', fontSize: 14 }}>النتيجة الموضوعية — آخر 30 يومًا</strong>
              <small style={{ color: 'var(--muted)' }}>من Snapshot المنصة، لا من ادعاء مرحلة البيع</small>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 9, marginBottom: 12 }}>
            <Metric label="أول شحنة" value={outcomes.first_shipments} color="var(--green2)" icon={<PlugZap size={15}/>}/>
            <Metric label="عاد للشحن" value={outcomes.resumed} color="var(--accent3)" icon={<RefreshCw size={15}/>}/>
            <Metric label="بعد تواصل مسجل" value={outcomes.attributed_after_contact} color="var(--brand)" icon={<UserRoundCheck size={15}/>}/>
            <Metric label="معلّم فائزًا" value={outcomes.marked_won} color="var(--gold)" icon={<TargetIcon size={15}/>}/>
          </div>
          <div style={{ padding: '10px 12px', borderRadius: 12, background: 'color-mix(in srgb, var(--gold) 9%, var(--surface2))', border: '1px solid color-mix(in srgb, var(--gold) 24%, var(--border))', color: 'var(--muted)', fontSize: 11.5, lineHeight: 1.7 }}>
            النجاح يُثبت عندما تظهر أول شحنة أو عودة شحن. إذا ارتفع النجاح الموضوعي وبقي «معلّم فائزًا» منخفضًا فالمشكلة في تسجيل الفريق، لا في المنصة.
          </div>
        </Card>
      </div>

      <Card style={{ padding: '17px 20px', marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
          <div>
            <strong style={{ display: 'block', fontSize: 14 }}>اتجاه العملاء النشطين عبر لقطات المنصة</strong>
            <small style={{ color: 'var(--muted)' }}>كل عمود = عملاء فريدون بالهاتف، وليس عدد المتاجر</small>
          </div>
          <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>الأسبوع: +{fmt(entered)} دخل · −{fmt(exited)} خرج · الصافي {net >= 0 ? '+' : ''}{fmt(net)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 7, height: 210, position: 'relative', paddingTop: 22 }}>
          <div style={{ position: 'absolute', insetInline: 0, top: `${22 + (1 - Number(current.target) / maxActive) * 170}px`, borderTop: '2px dashed color-mix(in srgb, var(--green) 60%, transparent)', pointerEvents: 'none' }}>
            <span style={{ position: 'absolute', insetInlineEnd: 0, top: -17, fontSize: 10.5, color: 'var(--green2)', fontWeight: 700 }}>الهدف {fmt(current.target)}</span>
          </div>
          {data.trend.map(row => {
            const height = Math.max(3, Math.round((row.active / maxActive) * 170));
            return (
              <div key={row.snapshotId} style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 4 }} title={`${fmtDate(row.snapDate)}: ${fmt(row.active)} عميل نشط من ${fmt(row.totalCustomers)}`}>
                <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>{fmt(row.active)}</span>
                <div style={{ width: '100%', maxWidth: 36, height, borderRadius: '6px 6px 2px 2px', background: row.active >= current.target ? 'var(--green)' : 'linear-gradient(180deg,var(--brand),var(--accent3))' }}/>
                <span style={{ fontSize: 9.5, color: 'var(--muted2)', whiteSpace: 'nowrap', transform: 'rotate(-40deg)', transformOrigin: 'center', marginTop: 5 }}>{fmtDate(row.snapDate)}</span>
              </div>
            );
          })}
        </div>
      </Card>

      {isAdmin && (
        <Card style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <TargetIcon size={17} style={{ color: 'var(--brand)' }}/>
          <span style={{ fontSize: 13, fontWeight: 700 }}>هدف العملاء النشطين:</span>
          <input type="number" value={editTarget} onChange={event => setEditTarget(event.target.value)} style={{ width: 110, padding: '7px 10px', borderRadius: 9, border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 14 }}/>
          <Btn size="sm" variant="accent" onClick={saveTarget} disabled={saving} icon={<Save size={13}/>}>{saving ? 'يحفظ…' : 'حفظ الهدف'}</Btn>
          <span style={{ fontSize: 11.5, color: 'var(--muted)', marginInlineStart: 'auto' }}>نافذة النشاط: آخر {cfg.days} أيام · القياس على العميل الفريد</span>
        </Card>
      )}
    </div>
  );
}

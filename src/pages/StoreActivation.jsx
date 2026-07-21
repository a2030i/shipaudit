// داشبورد «هدف تنشيط المتاجر» (2026-07-21) — يقيس أثر فريق المبيعات:
// عدد المتاجر النشطة (آخر شحنة خلال N يوم) مقابل هدف ثابت، واتجاهه عبر لقطات
// كشف المتاجر (stores.xlsx). المصدر الوحيد: RPC store_activation_trend
// (لا حساب محلي — §1.25). الهدف/النافذة في app_settings عبر retargetingService.
import { useState, useEffect, useCallback } from 'react';
import { TrendingUp, Target as TargetIcon, RefreshCw, Save } from 'lucide-react';
import { Card, Btn, Spinner, Empty, PageHeader, StatCard, toast } from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import { loadStoreActivationTrend, loadActivationConfig, saveActivationConfig } from '../lib/retargetingService.js';

const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const fmtDate = (d) => { try { return new Date(d).toLocaleDateString('ar-SA', { day: 'numeric', month: 'short' }); } catch { return String(d).slice(5, 10); } };

export default function StoreActivation({ isActive = true }) {
  const { isAdmin } = useAuth();
  const [cfg, setCfg]     = useState(null);
  const [rows, setRows]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [editTarget, setEditTarget] = useState('');
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const c = await loadActivationConfig();
      setCfg(c); setEditTarget(String(c.target));
      const r = await loadStoreActivationTrend(c.days, 24);
      setRows(r);
    } catch (e) { toast(`فشل التحميل: ${e.message}`, 'error'); }
    setLoading(false);
  }, []);
  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh]);

  const saveTarget = async () => {
    const t = Math.round(Number(editTarget) || 0);
    if (t < 1) { toast('أدخل هدفاً صحيحاً', 'warn'); return; }
    setSaving(true);
    try { await saveActivationConfig({ target: t, days: cfg.days }); setCfg({ ...cfg, target: t }); toast('حُفظ الهدف ✓', 'success'); }
    catch (e) { toast(`فشل الحفظ: ${e.message}`, 'error'); }
    setSaving(false);
  };

  if (!cfg || rows == null) return <div style={{ padding: 40, textAlign: 'center' }}><Spinner/></div>;
  if (!rows.length) return <div style={{ padding: '24px 28px' }}><Empty icon="📈" title="لا لقطات متاجر بعد" sub="ارفع كشف المتاجر (stores.xlsx) لبناء الاتجاه"/></div>;

  const cur  = rows[rows.length - 1];
  const prev = rows.length > 1 ? rows[rows.length - 2] : null;
  const first = rows[0];
  const pct = Math.min(100, Math.round((cur.active / cfg.target) * 100));
  const gap = Math.max(0, cfg.target - cur.active);
  const dChange = prev ? cur.active - prev.active : 0;         // مقابل اللقطة السابقة
  const totalChange = cur.active - first.active;               // منذ أول لقطة معروضة
  const onTrack = cur.active >= cfg.target;
  const maxActive = Math.max(cfg.target, ...rows.map(r => r.active));

  return (
    <div style={{ padding: '24px 28px 80px', maxWidth: 1320, margin: '0 auto' }}>
      <PageHeader icon={<TrendingUp size={22}/>} iconColor="#059669"
        title="هدف تنشيط المتاجر"
        subtitle={`المتاجر النشطة = آخر شحنة خلال ${cfg.days} أيام · الهدف ${fmt(cfg.target)} متجر — لقياس أثر فريق المبيعات`}
        actions={<Btn size="sm" variant="ghost" onClick={refresh} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''}/></Btn>}/>

      {/* الحالة مقابل الهدف — بطاقة رئيسية */}
      <Card style={{ padding: '18px 20px', marginBottom: 14, border: `1.5px solid ${onTrack ? 'color-mix(in srgb, var(--green) 40%, var(--border))' : 'color-mix(in srgb, var(--gold) 40%, var(--border))'}` }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <span style={{ fontSize: 40, fontWeight: 800, fontFamily: 'var(--font-mono)', color: onTrack ? 'var(--green2)' : 'var(--text)', lineHeight: 1 }}>{fmt(cur.active)}</span>
          <span style={{ fontSize: 16, color: 'var(--muted)' }}>من هدف {fmt(cfg.target)} متجر نشط</span>
          <span style={{ marginInlineStart: 'auto', display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
            {dChange !== 0 && (
              <span style={{ fontWeight: 700, color: dChange > 0 ? 'var(--green2)' : 'var(--red)' }}>
                {dChange > 0 ? '▲' : '▼'} {fmt(Math.abs(dChange))} عن الكشف السابق
              </span>
            )}
          </span>
        </div>
        {/* شريط التقدّم نحو الهدف */}
        <div style={{ height: 14, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 999, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: onTrack ? 'var(--green)' : 'var(--gold)', transition: 'width .5s' }}/>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
          <span>{pct}% من الهدف{gap > 0 ? ` · يتبقّى ${fmt(gap)} متجر` : ' · تحقّق الهدف 🎉'}</span>
          <span>{totalChange >= 0 ? `▲ ${fmt(totalChange)}` : `▼ ${fmt(Math.abs(totalChange))}`} منذ {fmtDate(first.snapDate)}</span>
        </div>
      </Card>

      {/* بطاقات فرعية */}
      <div className="hero-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 14 }}>
        <StatCard label={`نشط (${cfg.days} أيام)`} value={fmt(cur.active)} color="var(--green2)" icon="✅"
          sub={prev ? `${dChange >= 0 ? '+' : ''}${dChange} عن السابق` : null}/>
        <StatCard label="نشط (30 يوم)" value={fmt(cur.active30)} color="#0EA5E9" icon="📦"/>
        <StatCard label="نشط دفع مسبق" value={fmt(cur.prepaid)} color="#8B5CF6" icon="💳"/>
        <StatCard label="نشط دفع لاحق" value={fmt(cur.postpaid)} color="#D97706" icon="🧾"/>
        <StatCard label="إجمالي المتاجر" value={fmt(cur.total)} color="var(--muted)" icon="🏪"
          sub={`${Math.round((cur.active / cur.total) * 100)}% منها نشط`}/>
      </div>

      {/* الاتجاه — أعمدة عبر اللقطات */}
      <Card style={{ padding: '16px 20px', marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>📈 اتجاه المتاجر النشطة عبر كشوف المتاجر</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 200, position: 'relative', paddingTop: 20 }}>
          {/* خط الهدف */}
          <div style={{ position: 'absolute', left: 0, right: 0, top: `${20 + (1 - cfg.target / maxActive) * 180}px`,
            borderTop: '2px dashed color-mix(in srgb, var(--green) 55%, transparent)', pointerEvents: 'none' }}>
            <span style={{ position: 'absolute', right: 0, top: -16, fontSize: 10.5, color: 'var(--green2)', fontWeight: 700 }}>الهدف {fmt(cfg.target)}</span>
          </div>
          {rows.map((r, i) => {
            const h = Math.max(3, Math.round((r.active / maxActive) * 180));
            const hit = r.active >= cfg.target;
            return (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 0 }}
                title={`${fmtDate(r.snapDate)}: ${r.active} نشط من ${r.total}`}>
                <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>{r.active}</span>
                <div style={{ width: '100%', maxWidth: 34, height: h, borderRadius: '5px 5px 0 0',
                  background: hit ? 'var(--green)' : 'color-mix(in srgb, var(--gold) 75%, transparent)' }}/>
                <span style={{ fontSize: 9.5, color: 'var(--muted2)', whiteSpace: 'nowrap', transform: 'rotate(-40deg)', transformOrigin: 'center', marginTop: 4 }}>{fmtDate(r.snapDate)}</span>
              </div>
            );
          })}
        </div>
      </Card>

      {/* إعداد الهدف — للمدير */}
      {isAdmin && (
        <Card style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <TargetIcon size={16} style={{ color: 'var(--muted)' }}/>
          <span style={{ fontSize: 13, fontWeight: 600 }}>هدف المتاجر النشطة:</span>
          <input type="number" value={editTarget} onChange={e => setEditTarget(e.target.value)}
            style={{ width: 110, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 14 }}/>
          <Btn size="sm" variant="accent" onClick={saveTarget} disabled={saving} icon={<Save size={13}/>}>{saving ? 'يحفظ…' : 'حفظ الهدف'}</Btn>
          <span style={{ fontSize: 11.5, color: 'var(--muted)', marginInlineStart: 'auto' }}>
            نافذة النشاط: آخر {cfg.days} أيام (تعريف المتجر النشط)
          </span>
        </Card>
      )}
    </div>
  );
}

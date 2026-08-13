// «سلامة البيانات» — runs the integrity_check() RPC and shows one card per
// check: green = healthy, amber/red = inconsistencies with samples and a
// jump/fix action. Read-mostly; the only mutation is the explicit per-check
// auto-fix button (e.g. resetting wrongly-skipped weight audits).

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, RefreshCw, ArrowLeft, Wrench } from 'lucide-react';
import { Card, Btn, Spinner, toast, PageHeader, WorkspaceLoadingState } from '../components/UI.jsx';
import { loadIntegrityChecks, loadCronHealth, FIXES } from '../lib/integrityService.js';

const SEV = {
  red:   { bg: 'rgba(239,68,68,.07)',  bd: 'rgba(239,68,68,.35)',  color: 'var(--red)' },
  amber: { bg: 'rgba(217,119,6,.07)',  bd: 'rgba(217,119,6,.35)',  color: '#D97706' },
  ok:    { bg: 'rgba(16,185,129,.06)', bd: 'rgba(16,185,129,.25)', color: 'var(--green2)' },
};

const fmt = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

export default function IntegrityCheck({ isActive }) {
  const navigate = useNavigate();
  const [checks, setChecks]   = useState(null);
  const [crons, setCrons]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [fixing, setFixing]   = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    // صحّة المهام تُجلَب بالتوازي وفشلها لا يُسقط فحص السلامة
    const [c, h] = await Promise.allSettled([loadIntegrityChecks(), loadCronHealth()]);
    if (c.status === 'fulfilled') setChecks(c.value);
    else toast(`تعذّر الفحص: ${c.reason?.message || c.reason}`, 'error');
    setCrons(h.status === 'fulfilled' ? h.value : []);
    setLoading(false);
  }, []);
  useEffect(() => { if (isActive && !checks) refresh(); }, [isActive, checks, refresh]);

  const runFix = async (check) => {
    const fn = FIXES[check.fix];
    if (!fn) return;
    setFixing(check.key);
    try {
      const n = await fn(check.samples);
      toast(`تم الإصلاح — ${n} عنصر`, 'success');
      refresh();
    } catch (e) { toast(`فشل الإصلاح: ${e.message}`, 'error'); }
    setFixing(null);
  };

  const issues  = (checks || []).filter(c => c.count > 0);
  const healthy = (checks || []).filter(c => c.count === 0);

  return (
    <div style={{ padding: '24px 28px 80px', maxWidth: 1320, margin: '0 auto' }}>
      <PageHeader
        icon={<ShieldCheck size={22}/>}
        title="سلامة البيانات"
        subtitle="فحص ذاتي يصطاد التناقضات الصامتة بين المراجعات والدفتر والتحصيلات قبل أن تمسّ أرقامك"
        actions={
          <Btn size="sm" variant="primary" onClick={refresh} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''}/> {loading ? 'جارٍ الفحص…' : 'افحص الآن'}
          </Btn>
        }
      />

      {!checks && loading && <WorkspaceLoadingState title="جارٍ فحص سلامة الأرقام" source="قاعدة البيانات والمهام الدورية" rows={4}/>}

      {checks && (
        <>
          {/* Verdict strip */}
          <Card style={{
            marginBottom: 18, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12,
            borderColor: issues.length ? SEV[issues[0].severity].bd : SEV.ok.bd,
            background: issues.length ? SEV[issues.some(i => i.severity === 'red') ? 'red' : 'amber'].bg : SEV.ok.bg,
          }}>
            <span style={{ fontSize: 22 }}>{issues.length ? '⚠️' : '✅'}</span>
            <div style={{ fontWeight: 700, fontSize: 14 }}>
              {issues.length
                ? `${issues.length} ${issues.length === 1 ? 'رقم غير متطابق يحتاج مراجعتك' : 'أرقام غير متطابقة تحتاج مراجعتك'}`
                : 'كل الفحوص سليمة — بياناتك متّسقة'}
            </div>
          </Card>

          {/* Issues first */}
          {issues.map(c => {
            const s = SEV[c.severity] || SEV.amber;
            return (
              <Card key={c.key} style={{ marginBottom: 12, padding: '16px 18px', borderColor: s.bd, background: s.bg }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 18, color: s.color,
                    minWidth: 34, textAlign: 'center',
                  }}>{c.count}</span>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{c.label}
                      {c.total > 0.5 && (
                        <span style={{ color: s.color, fontFamily: 'var(--font-mono)', fontSize: 12 }}> · {fmt(c.total)} ر.س</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3, lineHeight: 1.6 }}>{c.desc}</div>
                    {c.samples.length > 0 && (
                      <div style={{ fontSize: 10.5, fontFamily: 'var(--font-mono)', color: 'var(--muted)', marginTop: 6, direction: 'ltr', textAlign: 'right' }}>
                        {c.samples.slice(0, 6).join(' · ')}{c.samples.length > 6 ? ' …' : ''}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {c.fix && (
                      <Btn size="sm" variant="primary" onClick={() => runFix(c)} disabled={fixing === c.key}>
                        <Wrench size={13}/> {fixing === c.key ? 'جارٍ…' : c.fixLabel}
                      </Btn>
                    )}
                    {c.goto && (
                      <Btn size="sm" variant="ghost" onClick={() => navigate(c.goto)}>
                        عرض موضع المشكلة <ArrowLeft size={13}/>
                      </Btn>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}

          {/* صحّة المهام المجدولة — تُقاس بالأثر لا برد الشبكة (سجلّ الكرون
              يقول «نجح» دائماً لأنه يقيس إرسال الطلب فقط). */}
          {crons && crons.length > 0 && (() => {
            const late = crons.filter(c => !c.healthy);
            return (
              <Card style={{ marginBottom: 12, padding: '16px 18px',
                borderColor: late.length ? SEV.amber.bd : SEV.ok.bd,
                background:  late.length ? SEV.amber.bg : SEV.ok.bg }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                  <span style={{ fontSize: 16 }}>{late.length ? '⏱️' : '✅'}</span>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>
                    المهام التلقائية — {late.length
                      ? `${late.length} متأخّرة عن أثرها المتوقّع`
                      : `الـ${crons.length} كلها تعمل وتترك أثرها`}
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--muted)', marginInlineStart: 'auto' }}>
                    تُقاس بآخر صف كتبته المهمة فعلاً، لا برد الشبكة
                  </span>
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  {crons.map(c => (
                    <div key={c.job} style={{
                      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                      fontSize: 12.5, padding: '6px 10px', borderRadius: 8,
                      background: c.healthy ? 'transparent' : SEV.amber.bg,
                      border: `1px solid ${c.healthy ? 'var(--border)' : SEV.amber.bd}`,
                    }}>
                      <span style={{ color: c.healthy ? SEV.ok.color : SEV.amber.color, fontWeight: 700 }}>
                        {c.healthy ? '✓' : '⚠'}
                      </span>
                      <b style={{ minWidth: 150 }}>{c.label}</b>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', direction: 'ltr' }}>
                        {c.schedule}
                      </span>
                      <span style={{ color: 'var(--muted)', flex: 1, minWidth: 180 }}>{c.detail}</span>
                      {c.gapMinutes != null && (
                        <span style={{
                          fontFamily: 'var(--font-mono)', fontSize: 11,
                          color: c.healthy ? 'var(--muted)' : SEV.amber.color,
                        }}>
                          منذ {c.gapMinutes < 90
                            ? `${Math.round(c.gapMinutes)} د`
                            : `${(c.gapMinutes / 60).toFixed(1)} س`}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            );
          })()}

          {/* Healthy checks — compact roll-up */}
          {healthy.length > 0 && (
            <Card style={{ padding: '14px 18px' }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, fontWeight: 600 }}>
                فحوص سليمة ({healthy.length})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {healthy.map(c => (
                  <span key={c.key} style={{
                    fontSize: 11.5, padding: '4px 10px', borderRadius: 999,
                    background: SEV.ok.bg, color: SEV.ok.color, border: `1px solid ${SEV.ok.bd}`,
                  }}>✓ {c.label}</span>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

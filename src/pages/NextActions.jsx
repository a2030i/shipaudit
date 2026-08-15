// شاشة الفعل التالي — «آلة القرار» التي تجعل مركز العمليات أقوى من هاتف:
// قائمة مرتّبة لكل عميل تحتاج إجراءً اليوم، بسبب واضح (ردّ/دين/محفظة/توقّف) +
// الإجراء المقترح + أزرار تنفيذه (اتصال IVR / حملة واتساب / عرض العميل).
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Phone, Eye, ShieldCheck, ListChecks } from 'lucide-react';
import { Card, Btn, Spinner, Empty, Modal, PageHeader, toast } from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import { loadEmployees } from '../lib/employeeService.js';
import { loadNextBestActions, NBA_META, TEMPLATE_INTENT_LABELS } from '../lib/nextActionsService.js';
import { setRetargetingFollowup, STATUSES } from '../lib/retargetingService.js';

// نتائج المتابعة السريعة (إغلاق الحلقة) — تُسجَّل في retargeting_followups + تلمس آخر تواصل.
const OUTCOMES = [
  ['contacted', 'تم التواصل'], ['interested', 'مهتم'], ['no_answer', 'لم يرد'],
  ['needs_followup', 'يحتاج متابعة'], ['returned', 'عاد للشحن'], ['converted', 'تحوّل ✅'],
  ['not_interested', 'غير مهتم'], ['price_issue', 'مشكلة سعر'],
];
import IvrCallButton from '../components/IvrCallButton.jsx';

const fmt0 = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const daysAgo = (d) => d ? Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000) : null;

export default function NextActions({ isActive = true }) {
  const navigate = useNavigate();
  const { user, canAny } = useAuth();
  const [rows, setRows] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [mine, setMine] = useState(false);
  const [group, setGroup] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [previewRows, setPreviewRows] = useState(null);

  const refresh = useCallback(async () => {
    setRows(null);
    try {
      const [list, emp] = await Promise.all([
        loadNextBestActions({ owner: mine ? user?.id || null : null, limit: 1000 }),
        loadEmployees().catch(() => []),
      ]);
      setRows(list); setEmployees(emp); setSelected(new Set());
    } catch (e) { toast(`تعذّر التحميل: ${e.message}`, 'error'); setRows([]); }
  }, [mine, user?.id]);
  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh]);

  const nameById = useMemo(() => { const m = new Map(); employees.forEach(e => m.set(e.id, e.name || e.email)); return m; }, [employees]);
  const filtered = useMemo(() => (rows || []).filter(r => !group || NBA_META[r.reasonCode]?.group === group), [rows, group]);
  const totals = useMemo(() => {
    const t = { count: filtered.length, money: 0, ready: 0, held: 0, byGroup: {} };
    for (const r of filtered) {
      t.money += r.amount || 0;
      if (r.sendEligible) t.ready += 1; else t.held += 1;
      const g = NBA_META[r.reasonCode]?.group || '—';
      t.byGroup[g] = (t.byGroup[g] || 0) + 1;
    }
    return t;
  }, [filtered]);
  const selectedRows = useMemo(() => {
    if (!selected.size) return [];
    return (rows || []).filter(r => selected.has(actionKey(r)));
  }, [rows, selected]);

  if (!canAny(['collections.view', 'sales.view', 'overview.view'])) return <Pad><Empty icon="🔒" title="لا صلاحية"/></Pad>;

  const toggleSelected = (r) => setSelected(prev => {
    const next = new Set(prev);
    const key = actionKey(r);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const selectFiltered = () => setSelected(prev => {
    const next = new Set(prev);
    filtered.forEach(r => next.add(actionKey(r)));
    return next;
  });

  // إغلاق الحلقة: تسجيل نتيجة المتابعة (يلمس آخر تواصل فيخرج من SLA) + إخراجه من القائمة.
  const recordOutcome = async (r, status) => {
    if (!status) return;
    try {
      await setRetargetingFollowup(r.phone, { status, ownerId: r.ownerId || user?.id || null, touch: true });
      setRows(prev => (prev || []).filter(x => !(x.phone === r.phone && x.reasonCode === r.reasonCode)));
      setSelected(prev => { const next = new Set(prev); next.delete(actionKey(r)); return next; });
      toast(`سُجّلت النتيجة: ${STATUSES[status]?.label || status}`, 'success');
    } catch (e) { toast(`تعذّر التسجيل: ${e.message}`, 'error'); }
  };

  return (
    <Pad>
      <PageHeader icon={<Phone size={22}/>} title="مهام العملاء اليوم" subtitle="قائمة تنفيذ موحّدة — من تتصل به، ولماذا، وما الخطوة المقترحة الآن"
        actions={<Btn size="sm" variant="ghost" onClick={refresh} disabled={rows == null}><RefreshCw size={14} className={rows == null ? 'spin' : ''}/></Btn>}/>

      <Card style={{ padding: '11px 14px', marginBottom: 12, borderColor: 'color-mix(in srgb, #2563EB 35%, var(--border2))', background: 'color-mix(in srgb, #2563EB 7%, var(--card))' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <ShieldCheck size={18} color="#2563EB"/>
          <div style={{ flex: 1, minWidth: 220 }}>
            <b style={{ fontSize: 13 }}>وضع تجريبي — الإرسال غير مفعّل</b>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>النظام يبني الجمهور والقالب والحواجز للمعاينة فقط، ولا ترتبط هذه الشاشة بأي دالة إرسال واتساب.</div>
          </div>
          <Btn size="sm" variant="outline" icon={<Eye size={13}/>} disabled={!filtered.length} onClick={() => setPreviewRows(filtered)}>معاينة نتائج الفلتر</Btn>
        </div>
      </Card>

      {/* شريط الملخّص */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
        <Kpi label="إجراءات مطلوبة" value={fmt0(totals.count)} color="#06B6D4"/>
        <Kpi label="مال معرّض (دين+محفظة)" value={`${fmt0(totals.money)} ر.س`} color="var(--red)"/>
        <Kpi label="تحصيل" value={fmt0(totals.byGroup['تحصيل'] || 0)} color="var(--red)"/>
        <Kpi label="مؤهل مبدئيًا" value={fmt0(totals.ready)} color="#16A34A"/>
        <Kpi label="متابعة بشرية/محمي" value={fmt0(totals.held)} color="var(--gold)"/>
      </div>

      {/* الفلاتر */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12.5, color: 'var(--muted)' }}>
          <input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)}/> المسندة لي فقط
        </label>
        {['', 'الجدد', 'المتوقفون', 'متابعة', 'تحصيل', 'تواصل'].map(g => (
          <Btn key={g || 'all'} size="sm" variant={group === g ? 'primary' : 'outline'} onClick={() => setGroup(g)}>{g || 'الكل'}</Btn>
        ))}
        <span style={{ flex: 1 }}/>
        <Btn size="sm" variant="outline" icon={<ListChecks size={13}/>} disabled={!filtered.length} onClick={selectFiltered}>تحديد نتائج الفلتر</Btn>
        {selected.size ? <Btn size="sm" variant="ghost" onClick={() => setSelected(new Set())}>إلغاء التحديد ({selected.size})</Btn> : null}
        <Btn size="sm" variant="primary" icon={<Eye size={13}/>} disabled={!selectedRows.length} onClick={() => setPreviewRows(selectedRows)}>معاينة المحدد ({selectedRows.length})</Btn>
      </div>

      {rows == null ? <div style={{ padding: 40, textAlign: 'center' }}><Spinner/></div>
        : !filtered.length ? <Empty icon="✅" title="لا إجراءات مطلوبة" sub="لا عميل يحتاج فعلاً الآن بهذا الفلتر."/>
        : (
          <div style={{ display: 'grid', gap: 8 }}>
            {filtered.map((r, i) => {
              const m = NBA_META[r.reasonCode] || { icon: '•', label: r.reasonCode, color: 'var(--muted)' };
              return (
                <Card key={`${r.phone}-${i}`} style={{ padding: '10px 14px', borderInlineStart: `4px solid ${m.color}`, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input type="checkbox" checked={selected.has(actionKey(r))} onChange={() => toggleSelected(r)} aria-label={`تحديد ${r.name}`}/>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 16 }}>{m.icon}</span>
                      <b style={{ fontSize: 13.5 }}>{r.name}</b>
                      <span style={{ padding: '1px 8px', borderRadius: 20, fontSize: 10.5, fontWeight: 700, background: `color-mix(in srgb, ${m.color} 15%, transparent)`, color: m.color }}>{m.label}</span>
                      {r.ownerId && <span style={{ fontSize: 10.5, color: 'var(--muted2)' }}>👤 {nameById.get(r.ownerId) || '—'}</span>}
                      <span style={{ padding: '1px 8px', borderRadius: 20, fontSize: 10.5, fontWeight: 700,
                        background: r.sendEligible ? 'color-mix(in srgb, #16A34A 14%, transparent)' : 'color-mix(in srgb, var(--gold) 14%, transparent)',
                        color: r.sendEligible ? '#16A34A' : 'var(--gold)' }}>
                        {r.sendEligible ? 'مؤهل مبدئيًا' : 'محمي من التواصل'}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
                      {r.reason} → <b style={{ color: 'var(--text)' }}>{r.action}</b>
                      {r.amount ? <span style={{ color: 'var(--red)', fontWeight: 700 }}> · {fmt0(r.amount)} ر.س</span> : null}
                      {r.lastTouch ? <span> · آخر تواصل قبل {daysAgo(r.lastTouch)} يوم</span> : null}
                    </div>
                    <div style={{ fontSize: 11, color: r.sendEligible ? '#16A34A' : 'var(--muted2)', marginTop: 4 }}>
                      {r.guardReason}
                      {r.recommendedTemplateKey ? ` · ${TEMPLATE_INTENT_LABELS[r.recommendedTemplateKey] || r.recommendedTemplateKey}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <IvrCallButton phone={r.phone} name={r.name} fields={{ name: r.name, amount: r.amount }} label size={13}
                      style={{ borderRadius: 999, padding: '7px 12px', background: 'var(--accent)', color: '#fff', border: 'none', fontSize: 12, cursor: 'pointer' }}/>
                    <Btn size="sm" variant="outline" icon={<Eye size={12}/>} onClick={() => setPreviewRows([r])}>معاينة</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => navigate('/customer-money?q=' + encodeURIComponent(r.phone))}>عرض</Btn>
                    {/* إغلاق الحلقة: تسجيل النتيجة → يخرج من القائمة + يُنهي SLA */}
                    <select defaultValue="" onChange={e => { recordOutcome(r, e.target.value); e.target.value = ''; }}
                      title="سجّل نتيجة المتابعة" style={{ padding: '6px 8px', borderRadius: 8, fontSize: 11.5, border: '1px solid var(--border2)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }}>
                      <option value="">✓ النتيجة…</option>
                      {OUTCOMES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

      {previewRows ? <EngagementPlanPreview rows={previewRows} onClose={() => setPreviewRows(null)}/> : null}
    </Pad>
  );
}

const actionKey = (row) => `${row.phone}|${row.reasonCode}`;

function EngagementPlanPreview({ rows, onClose }) {
  const summary = useMemo(() => {
    const out = { ready: 0, held: 0, templates: new Map(), guards: new Map(), journeys: new Map() };
    for (const row of rows) {
      if (row.sendEligible) out.ready += 1; else out.held += 1;
      const template = TEMPLATE_INTENT_LABELS[row.recommendedTemplateKey] || 'متابعة بشرية بلا قالب';
      out.templates.set(template, (out.templates.get(template) || 0) + 1);
      out.guards.set(row.guardReason || 'تحتاج مراجعة', (out.guards.get(row.guardReason || 'تحتاج مراجعة') || 0) + 1);
      const journey = NBA_META[row.reasonCode]?.group || 'أخرى';
      out.journeys.set(journey, (out.journeys.get(journey) || 0) + 1);
    }
    return out;
  }, [rows]);

  return (
    <Modal title={`معاينة خطة التواصل — ${rows.length} عميل`} onClose={onClose} width={760}>
      <div style={{ display: 'grid', gap: 14 }}>
        <div style={{ padding: '10px 12px', borderRadius: 10, background: 'color-mix(in srgb, #2563EB 8%, var(--surface))', border: '1px solid color-mix(in srgb, #2563EB 30%, var(--border2))' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: '#2563EB', fontWeight: 800, fontSize: 13 }}><ShieldCheck size={16}/> محاكاة فقط — لا يوجد زر إرسال</div>
          <div style={{ color: 'var(--muted)', fontSize: 11.5, marginTop: 4 }}>هذه النافذة تعرض ما سيحدث لو فُعّل المسار مستقبلًا. لا تنشئ حملة ولا تستدعي هاتف ولا تسجل أي إرسال.</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
          <Kpi label="إجمالي الخطة" value={fmt0(rows.length)} color="#2563EB"/>
          <Kpi label="مؤهل مبدئيًا" value={fmt0(summary.ready)} color="#16A34A"/>
          <Kpi label="محمي/بشري" value={fmt0(summary.held)} color="var(--gold)"/>
        </div>

        <PreviewBreakdown title="الرحلات" values={summary.journeys}/>
        <PreviewBreakdown title="القوالب المقترحة" values={summary.templates}/>
        <PreviewBreakdown title="حواجز التواصل" values={summary.guards}/>

        {rows.length === 1 ? (
          <Card style={{ padding: 12 }}>
            <b>{rows[0].name}</b>
            <div style={{ marginTop: 5, fontSize: 12, color: 'var(--muted)' }}>{rows[0].reason} → {rows[0].action}</div>
            <div style={{ marginTop: 5, fontSize: 11.5, color: rows[0].sendEligible ? '#16A34A' : 'var(--gold)' }}>{rows[0].guardReason}</div>
          </Card>
        ) : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}><Btn variant="primary" onClick={onClose}>إغلاق المعاينة</Btn></div>
      </div>
    </Modal>
  );
}

function PreviewBreakdown({ title, values }) {
  return (
    <div>
      <b style={{ fontSize: 12.5 }}>{title}</b>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 7 }}>
        {[...values.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => (
          <span key={label} style={{ padding: '5px 9px', borderRadius: 999, background: 'var(--surface)', border: '1px solid var(--border2)', fontSize: 11.5 }}>{label} · <b>{fmt0(count)}</b></span>
        ))}
      </div>
    </div>
  );
}

function Pad({ children }) { return <div style={{ padding: '24px 28px 80px', maxWidth: 1320, margin: '0 auto' }}>{children}</div>; }
function Kpi({ label, value, color }) {
  return (
    <div className="stat-card" style={{
      background: 'var(--card)', border: '1px solid var(--border2)',
      borderRadius: 'var(--r-lg)', padding: '12px 14px',
      '--sc-tone': color || 'var(--accent)',
    }}>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'var(--font-mono)', color: color || 'var(--text)' }}>{value}</div>
    </div>
  );
}

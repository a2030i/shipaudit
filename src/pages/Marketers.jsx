import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BadgeDollarSign, CalendarCheck2, CheckCircle2, CircleAlert, Gauge,
  History, Plus, Save, ShieldCheck, Target, TrendingUp, UserPlus, WalletCards,
} from 'lucide-react';
import { Btn, Card, Empty, Input, Modal, PageHeader, Spinner, toast } from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  closeMarketerMonth,
  computeBreakEvenOrders,
  createCompensationPlan,
  createMarketer,
  loadMarketersDashboard,
  saveMarketerMonth,
  validateCommissionTiers,
} from '../lib/marketersService.js';
import './Marketers.css';

const STATUS = {
  green: { label: 'مستقر', hint: 'يحقق نقطة التعادل', color: 'var(--green)', className: 'green' },
  yellow: { label: 'تحت المراقبة', hint: 'شهر واحد دون التعادل', color: 'var(--gold)', className: 'yellow' },
  red: { label: 'عالي المخاطرة', hint: 'شهران دون التعادل', color: 'var(--red)', className: 'red' },
  stopped: { label: 'متوقف', hint: 'ثلاثة أشهر دون التعادل', color: 'var(--muted)', className: 'stopped' },
};

const saMonth = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit',
}).format(new Date());
const monthDate = (month) => `${month}-01`;
const monthLabel = (period) => new Intl.DateTimeFormat('ar-SA-u-ca-gregory', {
  month: 'long', year: 'numeric', timeZone: 'Asia/Riyadh',
}).format(new Date(`${period}T12:00:00+03:00`));
const fmt = (value, digits = 2) => Number(value || 0).toLocaleString('en-US', {
  minimumFractionDigits: digits, maximumFractionDigits: digits,
});
const pct = (value) => `${Math.max(0, Math.min(100, Number(value) || 0))}%`;

const EMPTY_FORM = {
  name: '', phone: '', startMonth: saMonth(), effectiveMonth: saMonth(),
  monthlySalary: '', targetCostPerOrder: '', monthlyOrderTarget: '', notes: '',
  tiers: [{ fromOrder: 1, toOrder: null, ratePerOrder: '' }],
};

function contractLabel(plan) {
  if (!plan) return 'لا توجد خطة';
  const hasSalary = Number(plan.monthly_salary) > 0;
  const hasCommission = plan.tiers?.some((tier) => Number(tier.rate_per_order) > 0);
  if (hasSalary && hasCommission) return 'راتب + عمولة';
  if (hasSalary) return 'راتب فقط';
  return 'عمولة فقط';
}

function Kpi({ icon, label, value, sub, tone = 'blue' }) {
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <div className={`mk-kpi ${tone}`}>
        <span className="mk-kpi-icon">{icon}</span>
        <div>
          <small>{label}</small>
          <strong>{value}</strong>
          <span>{sub}</span>
        </div>
      </div>
    </Card>
  );
}

function TierEditor({ tiers, onChange }) {
  const update = (index, patch) => onChange(tiers.map((tier, i) => i === index ? { ...tier, ...patch } : tier));
  const addTier = () => {
    const last = tiers[tiers.length - 1];
    const end = Math.max(Number(last.fromOrder) || 1, Number(last.toOrder) || ((Number(last.fromOrder) || 1) + 999));
    onChange([
      ...tiers.slice(0, -1),
      { ...last, toOrder: end },
      { fromOrder: end + 1, toOrder: null, ratePerOrder: last.ratePerOrder },
    ]);
  };
  const removeLast = () => {
    if (tiers.length === 1) return;
    const rows = tiers.slice(0, -1);
    rows[rows.length - 1] = { ...rows[rows.length - 1], toOrder: null };
    onChange(rows);
  };
  return (
    <div className="mk-tier-editor">
      <div className="mk-field-heading">
        <div><strong>شرائح العمولة</strong><span>العمولة متدرجة على الطلبات داخل كل شريحة.</span></div>
        <div className="mk-tier-actions">
          {tiers.length > 1 && <Btn size="sm" variant="ghost" onClick={removeLast}>حذف الأخيرة</Btn>}
          <Btn size="sm" variant="ghost" icon={<Plus size={14}/>} onClick={addTier}>إضافة شريحة</Btn>
        </div>
      </div>
      {tiers.map((tier, index) => (
        <div className="mk-tier-row" key={`${index}-${tier.fromOrder}`}>
          <Input label="من الطلب" type="number" min="1" value={tier.fromOrder}
            disabled={index === 0}
            onChange={(event) => update(index, { fromOrder: Number(event.target.value) })}/>
          <Input label="إلى الطلب" type="number" min={tier.fromOrder} value={tier.toOrder ?? ''}
            placeholder={index === tiers.length - 1 ? 'مفتوحة' : ''}
            disabled={index === tiers.length - 1}
            onChange={(event) => update(index, { toOrder: event.target.value === '' ? null : Number(event.target.value) })}/>
          <Input label="عمولة كل طلب (ر.س)" type="number" min="0" step="0.01" value={tier.ratePerOrder}
            onChange={(event) => update(index, { ratePerOrder: event.target.value })}/>
        </div>
      ))}
    </div>
  );
}

function PlanFields({ form, setForm, includeIdentity = false }) {
  const previewBreakEven = computeBreakEvenOrders({
    monthlySalary: form.monthlySalary,
    targetCostPerOrder: form.targetCostPerOrder,
    tiers: form.tiers,
  });
  return (
    <div className="mk-form-grid">
      {includeIdentity && <>
        <Input label="اسم المسوّق *" value={form.name} autoFocus
          onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}/>
        <Input label="رقم التواصل" value={form.phone}
          onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}/>
      </>}
      <Input label={includeIdentity ? 'شهر بداية التعاقد *' : 'تسري الخطة من شهر *'} type="month"
        value={includeIdentity ? form.startMonth : form.effectiveMonth}
        onChange={(event) => setForm((current) => includeIdentity
          ? { ...current, startMonth: event.target.value }
          : { ...current, effectiveMonth: event.target.value })}/>
      <Input label="الراتب الشهري (ر.س)" type="number" min="0" step="0.01" value={form.monthlySalary}
        onChange={(event) => setForm((current) => ({ ...current, monthlySalary: event.target.value }))}/>
      <Input label="التكلفة المستهدفة للطلب *" hint="راتب + عمولة ÷ عدد الطلبات" type="number" min="0.0001" step="0.01"
        value={form.targetCostPerOrder}
        onChange={(event) => setForm((current) => ({ ...current, targetCostPerOrder: event.target.value }))}/>
      <Input label="هدف الطلبات التشغيلي" hint="اختياري، منفصل عن نقطة التعادل" type="number" min="0"
        value={form.monthlyOrderTarget}
        onChange={(event) => setForm((current) => ({ ...current, monthlyOrderTarget: event.target.value }))}/>
      <div className={`mk-break-even-preview ${previewBreakEven === null ? 'impossible' : ''}`}>
        <span>نقطة التعادل المحسوبة</span>
        <strong>{previewBreakEven === null ? 'غير ممكنة بهذه الخطة' : `${fmt(previewBreakEven, 0)} طلب`}</strong>
        <small>{previewBreakEven === null
          ? 'العمولة في الشريحة المفتوحة تساوي أو تتجاوز التكلفة المستهدفة.'
          : 'يتغير الرقم مباشرة عند تعديل الراتب أو العمولة.'}</small>
      </div>
      <div className="mk-form-wide">
        <TierEditor tiers={form.tiers} onChange={(tiers) => setForm((current) => ({ ...current, tiers }))}/>
      </div>
      {includeIdentity && <div className="mk-form-wide">
        <label className="mk-textarea-label">ملاحظات التعاقد</label>
        <textarea rows="3" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}/>
      </div>}
    </div>
  );
}

export default function Marketers({ isActive = true }) {
  const { can } = useAuth();
  const [month, setMonth] = useState(saMonth());
  const period = monthDate(month);
  const [data, setData] = useState({ marketers: [], history: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [planFor, setPlanFor] = useState(null);
  const [ordersFor, setOrdersFor] = useState(null);
  const [closeFor, setCloseFor] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [ordersForm, setOrdersForm] = useState({ orders: '', notes: '' });

  const reload = useCallback(async () => {
    if (!isActive) return;
    setLoading(true);
    try { setData(await loadMarketersDashboard(period)); }
    catch (error) { toast(`تعذّر تحميل المسوقين: ${error.message}`, 'error'); }
    finally { setLoading(false); }
  }, [isActive, period]);

  useEffect(() => { reload(); }, [reload]);

  const summary = useMemo(() => {
    const rows = data.marketers.filter((row) => row.plan && row.lifecycle_status !== 'stopped');
    const withMetrics = rows.filter((row) => row.preview);
    const totalOrders = withMetrics.reduce((sum, row) => sum + row.preview.orders, 0);
    const totalCost = withMetrics.reduce((sum, row) => sum + row.preview.totalCost, 0);
    return {
      people: rows.length,
      totalOrders,
      totalCost,
      effective: totalOrders ? totalCost / totalOrders : 0,
      achieved: withMetrics.filter((row) => row.preview.achieved).length,
      watched: data.marketers.filter((row) => ['yellow', 'red'].includes(row.lifecycle_status)).length,
    };
  }, [data.marketers]);

  const currentMonth = month === saMonth();

  const openAdd = () => {
    setForm({ ...EMPTY_FORM, startMonth: month, effectiveMonth: month, tiers: [{ fromOrder: 1, toOrder: null, ratePerOrder: '' }] });
    setAddOpen(true);
  };
  const openPlan = (marketer) => {
    const source = marketer.plan;
    setForm({
      ...EMPTY_FORM,
      effectiveMonth: month,
      monthlySalary: source?.monthly_salary ?? '',
      targetCostPerOrder: source?.target_cost_per_order ?? '',
      monthlyOrderTarget: source?.monthly_order_target ?? '',
      tiers: source?.tiers?.length
        ? source.tiers.map((tier) => ({ fromOrder: tier.from_order, toOrder: tier.to_order, ratePerOrder: tier.rate_per_order }))
        : [{ fromOrder: 1, toOrder: null, ratePerOrder: '' }],
    });
    setPlanFor(marketer);
  };
  const openOrders = (marketer) => {
    setOrdersForm({ orders: marketer.performance?.eligible_orders ?? '', notes: marketer.performance?.notes ?? '' });
    setOrdersFor(marketer);
  };

  const submitNew = async () => {
    if (!form.name.trim() || !form.targetCostPerOrder || !form.startMonth) return toast('أكمل الاسم والشهر والتكلفة المستهدفة.', 'warn');
    const tierError = validateCommissionTiers(form.tiers);
    if (tierError) return toast(tierError, 'warn');
    setSaving(true);
    try {
      await createMarketer({ ...form, startMonth: monthDate(form.startMonth) });
      toast('أُضيف المسوّق وخطته الأولى.', 'success');
      setAddOpen(false);
      await reload();
    } catch (error) { toast(error.message, 'error'); }
    finally { setSaving(false); }
  };
  const submitPlan = async () => {
    const tierError = validateCommissionTiers(form.tiers);
    if (tierError) return toast(tierError, 'warn');
    if (!form.targetCostPerOrder || !form.effectiveMonth) return toast('أكمل شهر بداية الخطة والتكلفة المستهدفة.', 'warn');
    setSaving(true);
    try {
      await createCompensationPlan(planFor.id, { ...form, effectiveMonth: monthDate(form.effectiveMonth) });
      toast('حُفظت خطة جديدة دون تغيير تاريخ الأشهر السابقة.', 'success');
      setPlanFor(null);
      await reload();
    } catch (error) { toast(error.message, 'error'); }
    finally { setSaving(false); }
  };
  const submitOrders = async () => {
    if (ordersForm.orders === '' || Number(ordersForm.orders) < 0) return toast('أدخل عدد طلبات صحيحاً.', 'warn');
    setSaving(true);
    try {
      await saveMarketerMonth(ordersFor.id, period, ordersForm.orders, ordersForm.notes);
      toast('حُفظت نتيجة الشهر كمسودة.', 'success');
      setOrdersFor(null);
      await reload();
    } catch (error) { toast(error.message, 'error'); }
    finally { setSaving(false); }
  };
  const confirmClose = async () => {
    setSaving(true);
    try {
      await closeMarketerMonth(closeFor.id, period);
      toast('أُقفل الشهر وتحدّث نطاق المسوّق رسمياً.', 'success');
      setCloseFor(null);
      await reload();
    } catch (error) { toast(error.message, 'error'); }
    finally { setSaving(false); }
  };

  return (
    <div className="mk-page">
      <PageHeader
        icon={<BadgeDollarSign size={24}/>} title="المسوّقون والعمولات"
        subtitle="اعرف هل يغطي كل مسوّق تكلفته الفعلية، وتابع تحوّل حالته شهراً بعد شهر."
        meta={<span>المعيار: (الراتب + عمولة المسوّق) ÷ الطلبات</span>}
        actions={<>
          <label className="mk-month-picker"><span>شهر القياس</span><input type="month" value={month} onChange={(event) => event.target.value && setMonth(event.target.value)}/></label>
          {can('marketers.manage') && <Btn variant="primary" icon={<UserPlus size={16}/>} onClick={openAdd}>إضافة مسوّق</Btn>}
        </>}
      />

      <div className="mk-rule-strip">
        <ShieldCheck size={20}/>
        <div><strong>اللون الرسمي لا يتغير أثناء الشهر.</strong><span>{currentMonth ? 'الأرقام الحالية توقع مباشر، ويثبت الحكم بعد انتهاء الشهر وإقفاله.' : 'هذا شهر سابق ويمكن إقفال نتيجته بعد مراجعة عدد الطلبات.'}</span></div>
      </div>

      <div className="mk-kpis">
        <Kpi icon={<BadgeDollarSign/>} label="تكلفة فريق التسويق" value={`${fmt(summary.totalCost)} ر.س`} sub={monthLabel(period)} tone="navy"/>
        <Kpi icon={<Target/>} label="الطلبات المسجلة" value={fmt(summary.totalOrders, 0)} sub={`${summary.people} مسوّق نشط`} tone="blue"/>
        <Kpi icon={<Gauge/>} label="تكلفة الطلب الفعلية" value={`${fmt(summary.effective, 3)} ر.س`} sub="إجمالي الفريق" tone="teal"/>
        <Kpi icon={<CheckCircle2/>} label="حققوا التعادل" value={`${summary.achieved} / ${summary.people}`} sub={`${summary.watched} تحت المراقبة`} tone="green"/>
      </div>

      {loading ? <div className="mk-loading"><Spinner size={28}/><span>نحسب تكاليف الشهر…</span></div> : data.marketers.length === 0 ? (
        <Empty icon="📣" title="لا يوجد مسوّقون بعد" sub="أضف أول مسوّق وحدد الراتب والعمولة والتكلفة المستهدفة لكل طلب."
          action={can('marketers.manage') ? <Btn variant="primary" onClick={openAdd}>إضافة أول مسوّق</Btn> : null}/>
      ) : (
        <div className="mk-grid">
          {data.marketers.map((marketer) => {
            const plan = marketer.plan;
            const metrics = marketer.preview;
            const closed = marketer.performance?.close_state === 'closed';
            const displayedStatus = closed && marketer.performance?.resulting_status
              ? marketer.performance.resulting_status
              : marketer.lifecycle_status;
            const status = STATUS[displayedStatus] || STATUS.green;
            return (
              <Card key={marketer.id} style={{ padding: 0, overflow: 'hidden' }}>
                <article className={`mk-card ${status.className}`}>
                  <header>
                    <div className="mk-person">
                      <span className="mk-avatar">{marketer.name[0]}</span>
                      <div><h2>{marketer.name}</h2><p>{contractLabel(plan)} · بدأ {monthLabel(marketer.start_month)}</p></div>
                    </div>
                    <span className={`mk-status ${status.className}`}><i/>{status.label}</span>
                  </header>

                  {!plan ? <div className="mk-no-plan"><CircleAlert size={18}/> لا توجد خطة سارية لهذا الشهر.</div> : <>
                    <div className="mk-primary-metric">
                      <div><span>{closed ? 'نتيجة الشهر المعتمدة' : 'التكلفة الحالية لكل طلب'}</span>
                        <strong>{metrics?.effectiveCost === null ? '—' : `${fmt(metrics?.effectiveCost, 3)} ر.س`}</strong>
                        <small>المستهدف ≤ {fmt(plan.target_cost_per_order, 3)} ر.س</small>
                      </div>
                      <div className={`mk-result-orb ${metrics?.achieved ? 'done' : ''}`}>
                        {metrics?.achieved ? <CheckCircle2/> : <TrendingUp/>}
                        <span>{metrics?.achieved ? 'متحقق' : 'قيد التقدم'}</span>
                      </div>
                    </div>
                    <div className="mk-progress-copy"><span>{fmt(metrics?.orders, 0)} طلب</span><span>نقطة التعادل: {metrics?.breakEvenOrders === null ? 'غير ممكنة' : fmt(metrics?.breakEvenOrders, 0)}{plan.monthly_order_target !== null ? ` · هدف التشغيل: ${fmt(plan.monthly_order_target, 0)}` : ''}</span></div>
                    <div className="mk-progress"><i style={{ width: pct(metrics?.progress) }}/></div>
                    <div className="mk-card-stats">
                      <div><span>الراتب</span><strong>{fmt(plan.monthly_salary)} ر.س</strong></div>
                      <div><span>العمولة المستحقة</span><strong>{fmt(metrics?.variableCommission)} ر.س</strong></div>
                      <div><span>إجمالي تكلفة المسوّق</span><strong>{fmt(metrics?.totalCost)} ر.س</strong></div>
                      <div><span>{metrics?.achieved ? 'فوق التعادل' : 'المتبقي للتعادل'}</span><strong>{metrics?.breakEvenOrders === null ? 'غير ممكن' : `${fmt(metrics?.gapOrders, 0)} طلب`}</strong></div>
                    </div>
                  </>}

                  <footer>
                    {can('marketers.record_month') && !closed && <Btn variant="accent" size="sm" icon={<Save size={14}/>} onClick={() => openOrders(marketer)}>تسجيل طلبات الشهر</Btn>}
                    {can('marketers.manage') && <Btn variant="ghost" size="sm" icon={<WalletCards size={14}/>} onClick={() => openPlan(marketer)}>خطة تعويض جديدة</Btn>}
                    {can('marketers.close_month') && !currentMonth && !closed && marketer.performance && <Btn variant="ghost" size="sm" icon={<CalendarCheck2 size={14}/>} onClick={() => setCloseFor(marketer)}>إقفال الشهر</Btn>}
                    {closed && <span className="mk-closed"><CheckCircle2 size={14}/> شهر مقفل</span>}
                  </footer>
                </article>
              </Card>
            );
          })}
        </div>
      )}

      {data.history.length > 0 && <Card style={{ padding: 0, overflow: 'hidden' }}>
        <section className="mk-history">
          <div className="mk-section-title"><div><History size={19}/><span><strong>سجل تغيّر النطاق</strong><small>الأثر الرسمي لكل شهر مقفل</small></span></div></div>
          <div className="mk-table-wrap"><table><thead><tr><th>الشهر</th><th>المسوّق</th><th>الطلبات</th><th>نقطة التعادل</th><th>النتيجة</th><th>الحركة</th></tr></thead>
            <tbody>{data.history.map((row) => {
              const marketer = data.marketers.find((item) => item.id === row.marketer_id);
              return <tr key={row.id}><td>{monthLabel(row.period)}</td><td>{marketer?.name || '—'}</td><td>{fmt(row.eligible_orders, 0)}</td><td>{row.break_even_orders === null ? 'غير ممكنة' : fmt(row.break_even_orders, 0)}</td><td><span className={row.achieved_break_even ? 'mk-pass' : 'mk-fail'}>{row.achieved_break_even ? 'حقق' : 'لم يحقق'}</span></td><td><span className={`mk-status ${row.to_status}`}><i/>من {STATUS[row.from_status]?.label} إلى {STATUS[row.to_status]?.label}</span></td></tr>;
            })}</tbody>
          </table></div>
        </section>
      </Card>}

      {addOpen && <Modal title="إضافة مسوّق وخطته الأولى" width={780} onClose={() => !saving && setAddOpen(false)}>
        <div className="m-flow mk-modal-flow"><PlanFields form={form} setForm={setForm} includeIdentity/></div>
        <div className="mk-modal-footer"><Btn variant="ghost" onClick={() => setAddOpen(false)} disabled={saving}>إلغاء</Btn><Btn variant="accent" onClick={submitNew} disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ المسوّق'}</Btn></div>
      </Modal>}

      {planFor && <Modal title={`خطة تعويض جديدة — ${planFor.name}`} width={780} onClose={() => !saving && setPlanFor(null)}>
        <div className="mk-plan-warning"><CircleAlert size={17}/><span>الخطة الجديدة تبدأ من الشهر الذي تختاره. الخطط والنتائج السابقة لن تتغير.</span></div>
        <div className="m-flow mk-modal-flow"><PlanFields form={form} setForm={setForm}/></div>
        <div className="mk-modal-footer"><Btn variant="ghost" onClick={() => setPlanFor(null)} disabled={saving}>إلغاء</Btn><Btn variant="accent" onClick={submitPlan} disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'اعتماد الخطة الجديدة'}</Btn></div>
      </Modal>}

      {ordersFor && <Modal title={`طلبات ${monthLabel(period)} — ${ordersFor.name}`} width={560} onClose={() => !saving && setOrdersFor(null)}>
        <div className="mk-orders-form">
          <Input label="عدد الطلبات المؤهلة للعمولة *" type="number" min="0" autoFocus value={ordersForm.orders}
            onChange={(event) => setOrdersForm((current) => ({ ...current, orders: event.target.value }))}/>
          <label className="mk-textarea-label">ملاحظة داخلية<textarea rows="4" value={ordersForm.notes} placeholder="مثال: العدد من تقرير المنصة بتاريخ…" onChange={(event) => setOrdersForm((current) => ({ ...current, notes: event.target.value }))}/></label>
          <div className="mk-draft-note"><ShieldCheck size={17}/> الحفظ هنا مسودة ولا يغيّر لون المسوّق.</div>
        </div>
        <div className="mk-modal-footer"><Btn variant="ghost" onClick={() => setOrdersFor(null)} disabled={saving}>إلغاء</Btn><Btn variant="accent" onClick={submitOrders} disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ المسودة'}</Btn></div>
      </Modal>}

      {closeFor && <Modal title="اعتماد نتيجة الشهر" width={540} onClose={() => !saving && setCloseFor(null)}>
        <div className="mk-close-box"><CalendarCheck2 size={28}/><h3>{closeFor.name}</h3><p>سيُعتمد <strong>{fmt(closeFor.preview?.orders, 0)} طلب</strong> مقابل نقطة تعادل <strong>{closeFor.preview?.breakEvenOrders === null ? 'غير ممكنة' : fmt(closeFor.preview?.breakEvenOrders, 0)}</strong>، ثم يتغير النطاق الرسمي حسب النتيجة.</p><small>لا يمكن تعديل الشهر بعد إقفاله من هذه الشاشة.</small></div>
        <div className="mk-modal-footer"><Btn variant="ghost" onClick={() => setCloseFor(null)} disabled={saving}>إلغاء</Btn><Btn variant="accent" onClick={confirmClose} disabled={saving}>{saving ? 'جارٍ الإقفال…' : 'اعتماد وإقفال الشهر'}</Btn></div>
      </Modal>}
    </div>
  );
}

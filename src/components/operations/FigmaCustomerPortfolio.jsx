import { useMemo } from 'react';
import {
  ArrowLeft,
  Download,
  Megaphone,
  Search,
  UserRoundCheck,
  UserRoundCog,
  UserRoundX,
  WalletCards,
} from 'lucide-react';
import './figma-customer-portfolio.css';

const amount = (value) => Number(value || 0).toLocaleString('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const normalize = (value) => String(value || '').trim().toLowerCase();
const isPrepaid = (customer) => {
  const value = normalize(customer?.billingType);
  return value.includes('مسبق') || value.includes('prepaid') || value.includes('pre-paid');
};
const platformState = (customer) => {
  const value = normalize(customer?.platformStatus);
  if (value === 'active' || value === 'نشط') return 'active';
  if (value === 'inactive' || value === 'غير نشط') return 'inactive';
  return 'unknown';
};
const overThirty = (customer) => (
  Number(customer?.inv31_60 ?? customer?.b1 ?? 0)
  + Number(customer?.inv61_90 ?? customer?.b2 ?? 0)
  + Number(customer?.inv90p ?? Math.max(0, Number(customer?.b3 || 0) - Number(customer?.opening || 0)))
);

function Metric({ tone, icon: Icon, title, value, note, active, onClick }) {
  return (
    <button type="button" className={`fcp-metric fcp-metric--${tone}${active ? ' is-active' : ''}`} onClick={onClick}>
      <span className="fcp-metric__icon"><Icon size={19}/></span>
      <span className="fcp-metric__copy"><small>{title}</small><strong>{value}</strong><em>{note}</em></span>
      <ArrowLeft size={16}/>
    </button>
  );
}

function customerDecision(customer, task) {
  const prepaid = isPrepaid(customer);
  const state = platformState(customer);
  const late = overThirty(customer);
  const wallet = Number(customer?.walletBalance || 0);
  const debt = Number(customer?.owed || 0);

  if (prepaid && wallet > 0.5 && debt > 0.5) return { key: 'deduct', label: 'خصم الرصيد', tone: 'blue' };
  if (!prepaid && state === 'active' && late > 0.5) return { key: 'stop', label: 'إيقاف الحساب', tone: 'red' };
  if (!prepaid && state === 'inactive' && late <= 0.5) return { key: 'activate', label: 'تشغيل الحساب', tone: 'green' };
  if (!task?.assigned_to) return { key: 'assign', label: 'تعيين ومتابعة', tone: 'amber' };
  return { key: 'collect', label: 'متابعة التحصيل', tone: 'navy' };
}

export default function FigmaCustomerPortfolio({
  customers = [],
  query,
  onQueryChange,
  taskByCustomer,
  assigneeById,
  onFocusCustomer,
  onExport,
  onCampaign,
  campaignPanel,
  campaignActionLabel = 'اختيار شرائح الحملة',
  segment = 'all',
  onSegmentChange,
  sourceUpdatedAt,
  sourceHealthy = true,
}) {
  const model = useMemo(() => customers.map((customer) => {
    const task = taskByCustomer?.get(customer.name) || null;
    const decision = customerDecision(customer, task);
    return {
      customer,
      task,
      decision,
      assignee: assigneeById?.get(task?.assigned_to) || '',
      late: overThirty(customer),
    };
  }), [customers, taskByCustomer, assigneeById]);

  const groups = useMemo(() => ({
    stop: model.filter((row) => row.decision.key === 'stop'),
    activate: model.filter((row) => row.decision.key === 'activate'),
    deduct: model.filter((row) => row.decision.key === 'deduct'),
    assign: model.filter((row) => !row.task?.assigned_to),
  }), [model]);

  const visible = useMemo(() => {
    const base = segment === 'all' ? model : (groups[segment] || []);
    const needle = normalize(query);
    if (!needle) return base;
    return base.filter(({ customer }) => [customer.name, customer.storeName, customer.storeId, customer.phone]
      .some((value) => normalize(value).includes(needle)));
  }, [model, groups, query, segment]);

  const updated = sourceUpdatedAt
    ? new Date(sourceUpdatedAt).toLocaleString('ar-SA', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })
    : 'بانتظار أول قراءة';

  return (
    <section className="figma-customer-portfolio" dir="rtl">
      <header className="fcp-header">
        <div>
          <span>مركز العمليات المالية</span>
          <h1>محفظة العملاء</h1>
          <p>عملاؤك مرتّبون حسب القرار المطلوب، لا حسب صفحة البيانات.</p>
        </div>
        <div className="fcp-header__actions">
          <button type="button" className="fcp-action fcp-action--secondary" onClick={onExport}><Download size={16}/> تصدير Excel</button>
          <button type="button" className="fcp-action fcp-action--primary" onClick={onCampaign}><Megaphone size={16}/> {campaignActionLabel}</button>
        </div>
      </header>

      {campaignPanel && <div className="fcp-campaign-panel">{campaignPanel}</div>}

      <div className="fcp-metrics">
        <Metric tone="red" icon={UserRoundX} title="أوقف الحسابات المتأخرة" value={groups.stop.length} note="دفع لاحق · نشط · +30 يوم" active={segment === 'stop'} onClick={() => onSegmentChange?.(segment === 'stop' ? 'all' : 'stop')}/>
        <Metric tone="green" icon={UserRoundCheck} title="شغّل الحسابات الجاهزة" value={groups.activate.length} note="غير نشط · بلا مستحق متأخر" active={segment === 'activate'} onClick={() => onSegmentChange?.(segment === 'activate' ? 'all' : 'activate')}/>
        <Metric tone="blue" icon={WalletCards} title="اخصم الرصيد المقدم" value={groups.deduct.length} note="دفع مسبق · رصيد + فواتير" active={segment === 'deduct'} onClick={() => onSegmentChange?.(segment === 'deduct' ? 'all' : 'deduct')}/>
        <Metric tone="amber" icon={UserRoundCog} title="عيّن مسؤول متابعة" value={groups.assign.length} note="حسابات بلا مسؤول حالي" active={segment === 'assign'} onClick={() => onSegmentChange?.(segment === 'assign' ? 'all' : 'assign')}/>
      </div>

      <div className="fcp-tools">
        <label className="fcp-search"><Search size={17}/><input aria-label="البحث في محفظة العملاء" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="ابحث باسم العميل أو رقم المتجر أو الجوال…"/></label>
        <div className="fcp-segments" aria-label="فلاتر قرارات العملاء">
          {[
            ['all', `كل القرارات ${model.length}`],
            ['stop', `إيقاف ${groups.stop.length}`],
            ['activate', `تشغيل ${groups.activate.length}`],
            ['deduct', `خصم رصيد ${groups.deduct.length}`],
            ['assign', `بلا مسؤول ${groups.assign.length}`],
          ].map(([key, label]) => <button type="button" key={key} className={segment === key ? 'is-active' : ''} aria-pressed={segment === key} onClick={() => onSegmentChange?.(key)}>{label}</button>)}
        </div>
      </div>

      <div className="fcp-table-wrap">
        <table className="fcp-table">
          <thead><tr><th>العميل</th><th>نموذج الدفع</th><th>الحالة</th><th>المديونية / الرصيد</th><th>أقدم استحقاق</th><th>المسؤول</th><th>الإجراء الآن</th></tr></thead>
          <tbody>
            {visible.slice(0, 40).map(({ customer, task, decision, assignee, late }) => (
              <tr key={`${customer.name}-${customer.storeId || ''}`}>
                <td data-label="العميل"><strong>{customer.storeName || customer.name}</strong><small>{customer.storeId ? `متجر #${customer.storeId}` : customer.name}</small></td>
                <td data-label="نموذج الدفع"><span>{isPrepaid(customer) ? 'دفع مسبق' : 'دفع لاحق'}</span></td>
                <td data-label="الحالة"><span className={`fcp-status fcp-status--${platformState(customer)}`}>{platformState(customer) === 'active' ? 'نشط' : platformState(customer) === 'inactive' ? 'غير نشط' : 'غير معروف'}</span></td>
                <td data-label="الدين / الرصيد"><strong className={Number(customer.owed || 0) > 0.5 ? 'is-debt' : 'is-clear'}>{amount(customer.owed)} ر.س</strong>{Number(customer.walletBalance || 0) > 0.5 && <small>رصيد {amount(customer.walletBalance)}</small>}</td>
                <td data-label="أقدم تأخير"><strong className={late > 0.5 ? 'is-late' : ''}>{customer.oldestDays ? `${customer.oldestDays} يوم` : 'لا يوجد +30'}</strong><small>{customer.invCnt || 0} فاتورة</small></td>
                <td data-label="المسؤول"><strong>{assignee || 'غير مسند'}</strong><small>{task?.stage ? 'مهمة تحصيل مفتوحة' : 'لا توجد مهمة'}</small></td>
                <td data-label="الإجراء الآن"><button type="button" className={`fcp-row-action fcp-row-action--${decision.tone}`} onClick={() => onFocusCustomer(customer)}>{decision.label}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!visible.length && <div className="fcp-empty">لا توجد حسابات مطابقة لهذا القرار.</div>}
        {visible.length > 40 && <button type="button" className="fcp-more" onClick={onFocusCustomer}>عرض جميع النتائج ({visible.length})</button>}
      </div>

      <footer className="fcp-sources">
        <strong>مصادر القرار</strong>
        <span className={sourceHealthy ? 'is-good' : 'is-warning'}><i/> Zoho <small>{sourceHealthy ? 'متصل' : 'آخر قراءة ناجحة'}</small></span>
        <span className="is-good"><i/> لمحة <small>حالة المتجر</small></span>
        <span className="is-good"><i/> التحصيل <small>المهام والمسؤول</small></span>
        <time>{updated}</time>
      </footer>
    </section>
  );
}

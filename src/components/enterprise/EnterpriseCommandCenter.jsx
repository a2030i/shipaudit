import { CalendarDays, RefreshCw } from 'lucide-react';
import { Button, DataTable, Money, Page, PageHeader, Section, SourceStamp, StatStrip, StatusBadge } from '../../design-system/EnterpriseUI.jsx';
import './enterprise-workspaces.css';

const monthLabel = period => {
  if (!period) return 'الفترة الحالية';
  const [year, month] = period.split('-').map(Number);
  return `${['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'][month - 1] || month} ${year}`;
};

const sourceStatus = state => state?.status === 'unavailable' ? 'unavailable' : state?.status === 'fresh' ? 'fresh' : 'stale';
const sum = (rows, pick) => (rows || []).reduce((total, row) => total + Number(pick(row) || 0), 0);

export default function EnterpriseCommandCenter({
  data, vat, executiveFinance, customerGrowth, period, refreshing,
  onRefresh, onPrevious, onNext, onCurrent, isCurrent, navigate,
}) {
  const decisions = data?.customerDecisions || {};
  const stopRows = decisions.stopPostpaid || [];
  const deductRows = decisions.deductPrepaid || [];
  const negativeRows = decisions.negativePrepaid || [];
  const cash = data?.cashPosition || {};
  const sources = Object.values(data?.primarySourceStates || data?.sourceStates || {});
  const invoiceOps = data?.invoiceOperations || {};
  const merchantPulse = data?.merchantPulse || {};
  const closeReadiness = data?.closeReadiness || { ready: false, completed: 0, required: 0, blockers: [] };
  const firstCloseBlocker = closeReadiness.blockers?.[0];
  const closeBlockerLabel = typeof firstCloseBlocker === 'string'
    ? firstCloseBlocker
    : firstCloseBlocker?.label || (firstCloseBlocker?.reason ? 'تعذر التحقق من جاهزية الإقفال' : 'الدورة الشهرية غير جاهزة للإقفال');
  const pnl = executiveFinance?.period === period ? executiveFinance?.snapshot : null;
  const totalPriority = stopRows.length + deductRows.length + negativeRows.length + Number(invoiceOps.zatcaTodayCount || 0) + Number(invoiceOps.zatcaOverdueCount || 0);
  const priorities = [
    stopRows.length ? { id: 'stop', severity: 'danger', title: 'حسابات دفع لاحق تجاوزت سياسة التحصيل', owner: 'المالية', age: '+30 يوم', count: stopRows.length, amount: sum(stopRows, row => row.overdueOver30 ?? row.debt), action: 'مراجعة الإيقاف', path: '/customer-money?decision=stop&returnTo=%2Foverview' } : null,
    deductRows.length ? { id: 'deduct', severity: 'warning', title: 'رصيد محفظة متاح مقابل فواتير مفتوحة', owner: 'التحصيل', age: 'الآن', count: deductRows.length, amount: sum(deductRows, row => Math.min(Number(row.walletBalance || 0), Number(row.debt || 0))), action: 'مراجعة الخصم', path: '/customer-money?decision=deduct&returnTo=%2Foverview' } : null,
    negativeRows.length ? { id: 'negative', severity: 'danger', title: 'أرصدة محافظ سالبة تحتاج تحققًا', owner: 'التشغيل', age: 'الآن', count: negativeRows.length, amount: sum(negativeRows, row => Math.abs(Number(row.walletBalance || 0))), action: 'فتح النتائج', path: '/customer-money?decision=negative&returnTo=%2Foverview' } : null,
    Number(invoiceOps.zatcaTodayCount || 0) + Number(invoiceOps.zatcaOverdueCount || 0) ? { id: 'zatca', severity: Number(invoiceOps.zatcaOverdueCount || 0) ? 'danger' : 'warning', title: 'فواتير تحتاج إجراء زاتكا', owner: 'المحاسبة', age: Number(invoiceOps.zatcaOverdueCount || 0) ? 'متأخر' : 'اليوم', count: Number(invoiceOps.zatcaTodayCount || 0) + Number(invoiceOps.zatcaOverdueCount || 0), amount: Number(invoiceOps.zatcaTodayTotal || 0) + Number(invoiceOps.zatcaOverdueTotal || 0), action: 'فتح الفواتير', path: '/zoho-data?tab=customers&type=invoices&focus=zatca' } : null,
    !closeReadiness.ready ? { id: 'close', severity: 'warning', title: closeBlockerLabel, owner: 'التشغيل', age: monthLabel(period), count: Math.max(0, Number(closeReadiness.required || 0) - Number(closeReadiness.completed || 0)), amount: null, action: 'فتح الدورة', path: `/accounting-cycle?period=${period}` } : null,
  ].filter(Boolean).slice(0, 6);

  const riskRows = [
    ...sources.filter(source => source?.status === 'unavailable').map((source, index) => ({ id: `source-${index}`, severity: 'danger', risk: `المصدر غير متاح: ${source.label || source.source || 'مصدر تشغيلي'}`, category: 'مصادر البيانات', owner: 'الإدارة', path: '/operations' })),
    ...sources.filter(source => source?.status && source.status !== 'fresh' && source.status !== 'unavailable').map((source, index) => ({ id: `stale-${index}`, severity: 'warning', risk: `مصدر يحتاج تحديثًا: ${source.label || source.source || 'مصدر تشغيلي'}`, category: 'حداثة البيانات', owner: 'الإدارة', path: '/operations' })),
    Number(merchantPulse.neverShipped || 0) ? { id: 'never-shipped', severity: 'warning', risk: `${Number(merchantPulse.neverShipped).toLocaleString('en-US')} متجرًا لم يبدأ الشحن`, category: 'نمو العملاء', owner: 'المبيعات', path: '/workspace/sales' } : null,
  ].filter(Boolean).slice(0, 5);

  const activityRows = sources.slice(0, 6).map((source, index) => ({
    id: source.key || source.source || index,
    type: source.status === 'fresh' ? 'تحديث مصدر' : 'حالة مصدر',
    description: source.label || source.source || 'مصدر تشغيلي',
    status: sourceStatus(source),
    at: source.updatedAt || source.loadedAt || data?.loadedAt,
  }));

  const priorityColumns = [
    { key: 'severity', label: 'الأولوية', render: row => <StatusBadge tone={row.severity}>{row.severity === 'danger' ? 'عالية' : 'متوسطة'}</StatusBadge> },
    { key: 'title', className: 'mobile-wide', label: 'البند', render: row => <><strong>{row.title}</strong><small>{row.count.toLocaleString('en-US')} حالة</small></> },
    { key: 'owner', className: 'mobile-hide', label: 'المالك' },
    { key: 'age', className: 'mobile-hide', label: 'العمر' },
    { key: 'amount', label: 'الأثر المالي', render: row => row.amount == null ? '—' : <Money value={row.amount}/> },
    { key: 'action', label: 'الإجراء التالي', render: row => <span className="enterprise-link">{row.action}</span> },
  ];

  return <Page className="enterprise-workspace enterprise-command-center">
    <PageHeader
      title="مركز القيادة"
      description="الأولوية أولًا: ما يحتاج انتباهك، ثم الوضع المالي والتشغيلي، ثم آخر التغييرات."
      meta={data?.loadedAt ? `آخر تحديث ${new Date(data.loadedAt).toLocaleString('ar-SA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : null}
      actions={<div className="enterprise-period-controls"><Button size="sm" onClick={onPrevious}>السابق</Button><span><CalendarDays size={14}/>{monthLabel(period)}</span>{!isCurrent ? <Button size="sm" onClick={onNext}>التالي</Button> : null}{!isCurrent ? <Button size="sm" onClick={onCurrent}>الشهر الحالي</Button> : null}<Button size="sm" icon={<RefreshCw size={14}/>} onClick={onRefresh} disabled={refreshing}>تحديث</Button></div>}
    />

    <StatStrip items={[
      { key: 'bank', label: 'النقد والبنوك', value: <Money value={cash.bankBalance}/>, note: cash.bankBalanceComplete ? 'الأرصدة المسجلة مكتملة' : 'حسب الحسابات المتاحة', onClick: () => navigate('/workspace/finance?view=banks') },
      { key: 'ar', label: 'القابل للتحصيل', value: <Money value={cash.totalAR}/>, note: 'ذمم العملاء التشغيلية', onClick: () => navigate('/customer-money') },
      { key: 'ap', label: 'مستحقات الناقلين', value: <Money value={cash.totalAP}/>, note: 'وفق القيود المتاحة', onClick: () => navigate('/workspace/operations') },
      { key: 'profit', label: 'صافي الربح', value: pnl ? <Money value={pnl.net}/> : 'غير متاح', note: monthLabel(period), tone: pnl && Number(pnl.net) < 0 ? 'danger' : undefined, onClick: () => navigate('/pnl') },
      { key: 'attention', label: 'يحتاج إجراء الآن', value: totalPriority.toLocaleString('en-US'), note: 'حالات قابلة للفتح', tone: totalPriority ? 'warning' : 'success', onClick: () => navigate('/decisions') },
    ]}/>

    <Section title="يحتاج إجراء الآن" description="مرتبة حسب الخطر والأثر وقابلية التنفيذ" meta={<SourceStamp label="مصادر التشغيل" updatedAt={data?.loadedAt} status={sources.some(source => source?.status === 'unavailable') ? 'unavailable' : 'fresh'}/>} action={<Button size="sm" onClick={() => navigate('/decisions')}>عرض كل القرارات</Button>}>
      <DataTable caption="القرارات التي تحتاج إجراء الآن" columns={priorityColumns} rows={priorities} getRowKey={row => row.id} getRowLabel={row => `فتح ${row.title}`} onRowClick={row => navigate(row.path)} empty="لا توجد قرارات عاجلة في البيانات المتاحة"/>
    </Section>

    <div className="enterprise-grid enterprise-grid--balanced">
      <Section title="استثناءات ومخاطر" description="مشكلات المصدر أو التشغيل التي تغيّر القرار">
        <DataTable columns={[
          { key: 'severity', label: 'الحالة', render: row => <StatusBadge tone={row.severity}>{row.severity === 'danger' ? 'خطر' : 'تنبيه'}</StatusBadge> },
          { key: 'risk', className: 'mobile-wide', label: 'الاستثناء', render: row => <strong>{row.risk}</strong> },
          { key: 'category', className: 'mobile-hide', label: 'الفئة' },
          { key: 'owner', className: 'mobile-hide', label: 'المالك' },
        ]} rows={riskRows} getRowKey={row => row.id} getRowLabel={row => `فتح ${row.risk}`} onRowClick={row => navigate(row.path)} empty="لا توجد استثناءات ظاهرة" caption="الاستثناءات والمخاطر"/>
      </Section>
      <Section title="الوضع المالي والتشغيلي" description="قراءة مختصرة؛ كل صف يفتح مصدره">
        <div className="enterprise-definition-list">
          <button onClick={() => navigate('/customer-money')}><span>ذمم العملاء التشغيلية</span><Money value={cash.totalAR}/><StatusBadge tone={Number(cash.totalAR) > 0 ? 'warning' : 'success'}>{Number(cash.totalAR) > 0 ? 'مفتوحة' : 'مسددة'}</StatusBadge></button>
          <button onClick={() => navigate('/money')}><span>النقد المسجل</span><Money value={cash.bankBalance}/><StatusBadge tone={cash.bankBalanceComplete ? 'success' : 'warning'}>{cash.bankBalanceComplete ? 'مكتمل' : 'جزئي'}</StatusBadge></button>
          <button onClick={() => navigate('/pnl')}><span>صافي الربح للفترة</span>{pnl ? <Money value={pnl.net}/> : <span>غير متاح</span>}<StatusBadge tone={pnl && Number(pnl.net) < 0 ? 'danger' : 'neutral'}>{pnl ? 'من قائمة الدخل' : 'المصدر غير متاح'}</StatusBadge></button>
          <button onClick={() => navigate(`/accounting-cycle?period=${period}`)}><span>جاهزية إقفال الدورة</span><bdi dir="ltr">{closeReadiness.completed || 0}/{closeReadiness.required || 0}</bdi><StatusBadge tone={closeReadiness.ready ? 'success' : 'warning'}>{closeReadiness.ready ? 'جاهزة' : 'تحتاج عملًا'}</StatusBadge></button>
          <button onClick={() => navigate('/workspace/sales')}><span>نمو العملاء</span><bdi dir="ltr">{Number(customerGrowth?.data?.movement?.net || 0).toLocaleString('en-US')}</bdi><StatusBadge tone={customerGrowth?.error ? 'danger' : 'neutral'}>{customerGrowth?.error ? 'غير متاح' : 'الحركة الصافية'}</StatusBadge></button>
        </div>
      </Section>
    </div>

    <Section title="آخر الأنشطة والتغييرات" description="آخر آثار المصادر التي بُنيت عليها القراءة">
      <DataTable columns={[
        { key: 'at', label: 'الوقت', render: row => row.at ? new Date(row.at).toLocaleString('ar-SA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'غير مسجل' },
        { key: 'type', label: 'النوع' },
        { key: 'description', className: 'mobile-wide', label: 'الوصف', render: row => <strong>{row.description}</strong> },
        { key: 'status', label: 'الحالة', render: row => <StatusBadge tone={row.status === 'fresh' ? 'success' : row.status === 'unavailable' ? 'danger' : 'warning'}>{row.status === 'fresh' ? 'محدّث' : row.status === 'unavailable' ? 'غير متاح' : 'يحتاج تحديثًا'}</StatusBadge> },
      ]} rows={activityRows} getRowKey={row => row.id} caption="آخر الأنشطة والتغييرات"/>
    </Section>
  </Page>;
}

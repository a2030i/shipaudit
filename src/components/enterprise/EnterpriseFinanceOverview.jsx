import { CalendarDays, RefreshCw } from 'lucide-react';
import {
  Alert, Button, DataTable, Money, Page, PageHeader, Section, SourceStamp,
  StatStrip, StatusBadge,
} from '../../design-system/EnterpriseUI.jsx';
import FinanceWorkspaceNav from './FinanceWorkspaceNav.jsx';
import './enterprise-workspaces.css';

const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const periodLabel = period => {
  const [year, month] = String(period || '').split('-').map(Number);
  return year && month ? `${MONTHS[month - 1]} ${year}` : 'الفترة الحالية';
};

function treasuryRows(financial) {
  return (financial?.treasuries || []).map((row, index) => ({
    id: row.id || row.account_id || index,
    name: row.name || row.account_name || row.display_name || 'حساب مالي',
    type: row.type || row.account_type || row.kind || 'خزينة',
    bank: row.bank_name || row.institution_name || row.currency_code || '—',
    balance: row.balance ?? row.current_balance ?? row.closing_balance ?? null,
    updatedAt: row.updated_at || row.last_synced_at || row.as_of || null,
  }));
}

export default function EnterpriseFinanceOverview({
  state, period, snapshot, cash, vendor, bills, bank, netProfit,
  operationalCollectible, accountingOutstanding, residual, vendorPayable,
  onPeriodChange, onReload, navigate,
}) {
  const priorities = [
    operationalCollectible > 0 ? { id: 'ar', tone: 'warning', title: 'ذمم عملاء قابلة للتحصيل', detail: 'افتح قائمة العمل المقيدة بمصادر التحصيل.', amount: operationalCollectible, owner: 'التحصيل', path: '/customer-money?worklist=1&returnTo=%2Fworkspace%2Ffinance' } : null,
    Number(bills?.overdue_count || 0) > 0 ? { id: 'bills', tone: 'danger', title: `${Number(bills.overdue_count).toLocaleString('en-US')} فاتورة مورد متأخرة`, detail: 'راجع الاستحقاقات من مرآة Zoho قبل أي إجراء دفع.', amount: bills.overdue_total ?? bills.overdue_amount ?? vendorPayable, owner: 'الحسابات الدائنة', path: '/zoho-data?tab=vendors&type=bills' } : null,
    Number(state?.vat?.netDue || 0) > 0 ? { id: 'vat', tone: 'warning', title: `التزام ضريبي — ${state.vat.quarter || 'الربع الحالي'}`, detail: 'القيمة من بيانات الفترة المتاحة وليست أمر دفع.', amount: state.vat.netDue, owner: 'المالية', path: '/pnl' } : null,
    Number(state?.forecast?.projectedBalance) < 0 ? { id: 'cash', tone: 'danger', title: 'توقع سيولة سالب خلال 7 أيام', detail: 'راجع التدفقات المؤرخة التي كوّنت التوقع.', amount: state.forecast.projectedBalance, owner: 'الخزينة', path: '/forecast' } : null,
    state?.partial ? { id: 'source', tone: 'warning', title: 'بعض المصادر المالية لم تستجب', detail: 'تظهر القيم المتاحة فقط دون استبدال الناقص بصفر.', amount: null, owner: 'الإدارة', path: '/operations' } : null,
  ].filter(Boolean);

  const pnlRows = snapshot ? [
    { id: 'income', label: 'الدخل', value: Number(snapshot.income || 0), tone: 'neutral' },
    { id: 'cogs', label: 'تكلفة المبيعات', value: Number(snapshot.cogs || 0), tone: 'neutral' },
    { id: 'opex', label: 'المصروفات التشغيلية', value: Number(snapshot.opex || 0), tone: 'neutral' },
    { id: 'net', label: 'صافي الربح', value: Number(snapshot.net || 0), tone: Number(snapshot.net || 0) < 0 ? 'danger' : 'success' },
  ] : [];
  const accounts = treasuryRows(state?.financial);

  return <Page className="enterprise-workspace enterprise-finance">
    <PageHeader
      title="مركز المالية"
      description="السيولة، الذمم، الالتزامات والمطابقة في مساحة عمل واحدة؛ التفاصيل تفتح مصدرها مباشرة."
      meta={state?.loadedAt ? `آخر قراءة ${new Date(state.loadedAt).toLocaleString('ar-SA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : null}
      actions={<div className="enterprise-period-controls"><Button size="sm" onClick={() => onPeriodChange(-1)}>السابق</Button><span><CalendarDays size={14}/>{periodLabel(period)}</span><Button size="sm" onClick={() => onPeriodChange(1)} disabled={period >= new Date().toISOString().slice(0, 7)}>التالي</Button><Button size="sm" icon={<RefreshCw size={14}/>} onClick={onReload} disabled={state?.loading}>تحديث</Button></div>}
    />

    <FinanceWorkspaceNav active="overview" onNavigate={navigate}/>

    {state?.partial ? <Alert tone="warning" title="مصدر جزئي">بعض القراءات لم تستجب؛ لا تُعرض أصفار بديلة.</Alert> : null}

    <StatStrip items={[
      { key: 'cash', label: 'النقد والبنوك', value: cash?.bankBalance == null ? 'غير متاح' : <Money value={cash.bankBalance}/>, note: cash?.bankBalanceComplete ? 'الأرصدة مكتملة' : 'حسب المتاح', onClick: () => navigate('/money?tab=banks') },
      { key: 'ar', label: 'قابل للتحصيل', value: operationalCollectible == null ? 'غير متاح' : <Money value={operationalCollectible}/>, note: accountingOutstanding == null ? 'الرصيد المحاسبي غير متاح' : `الرصيد المحاسبي ${Number(accountingOutstanding).toLocaleString('en-US')}`, onClick: () => navigate('/customer-money') },
      { key: 'ap', label: 'صافي الموردين', value: vendorPayable == null ? 'غير متاح' : <Money value={vendorPayable}/>, note: `${Number(bills?.overdue_count || 0).toLocaleString('en-US')} فاتورة متأخرة`, tone: Number(bills?.overdue_count || 0) ? 'warning' : undefined, onClick: () => navigate('/zoho-data?tab=vendors&type=bills') },
      { key: 'net', label: 'صافي الربح', value: netProfit == null ? 'غير متاح' : <Money value={netProfit}/>, note: periodLabel(period), tone: netProfit != null ? (netProfit < 0 ? 'danger' : 'success') : undefined, onClick: () => navigate('/pnl') },
      { key: 'forecast', label: 'الرصيد المتوقع · 7 أيام', value: state?.forecast?.projectedBalance == null ? 'غير متاح' : <Money value={state.forecast.projectedBalance}/>, note: 'من التدفقات المؤرخة', tone: Number(state?.forecast?.projectedBalance) < 0 ? 'danger' : undefined, onClick: () => navigate('/forecast') },
    ]}/>

    <Section title="يحتاج إجراء مالي" description="مرتبة حسب الاستحقاق والخطر؛ لا تنفذ أي معاملة من هذا الملخص" meta={<SourceStamp label="Zoho + التشغيل" updatedAt={state?.loadedAt} status={state?.partial ? 'stale' : 'fresh'}/>}>
      <DataTable caption="الإجراءات المالية ذات الأولوية" rows={priorities} getRowKey={row => row.id} getRowLabel={row => `فتح ${row.title}`} onRowClick={row => navigate(row.path)} empty="لا توجد إجراءات مالية عاجلة في البيانات المتاحة" columns={[
        { key: 'tone', label: 'الأولوية', render: row => <StatusBadge tone={row.tone}>{row.tone === 'danger' ? 'عالية' : 'متوسطة'}</StatusBadge> },
        { key: 'title', className: 'mobile-wide', label: 'البند', render: row => <><strong>{row.title}</strong><small>{row.detail}</small></> },
        { key: 'owner', className: 'mobile-hide', label: 'المالك' },
        { key: 'amount', label: 'القيمة', render: row => row.amount == null ? '—' : <Money value={row.amount}/> },
        { key: 'action', label: 'الإجراء التالي', render: () => <span className="enterprise-link">فتح التفاصيل</span> },
      ]}/>
    </Section>

    <div className="enterprise-grid enterprise-grid--balanced">
      <Section title="قائمة الدخل" description={periodLabel(period)} action={<Button size="sm" onClick={() => navigate('/pnl')}>التقرير الكامل</Button>}>
        <DataTable caption="ملخص قائمة الدخل" rows={pnlRows} getRowKey={row => row.id} getRowLabel={row => `فتح ${row.label}`} onRowClick={() => navigate('/pnl')} empty="قائمة الدخل غير متاحة لهذه الفترة" columns={[
          { key: 'label', label: 'البند', render: row => <strong>{row.label}</strong> },
          { key: 'value', label: 'القيمة', render: row => <StatusBadge tone={row.tone} dot={false}><Money value={row.value}/></StatusBadge> },
        ]}/>
      </Section>
      <Section title="المركز بعد الالتزامات" description="قراءة رأس المال العامل من القيم المتاحة" action={<Button size="sm" onClick={() => navigate('/money')}>فتح المركز المالي</Button>}>
        <div className="enterprise-definition-list">
          <button onClick={() => navigate('/money?tab=banks')}><span>النقد</span>{cash?.bankBalance == null ? <b>غير متاح</b> : <Money value={cash.bankBalance}/>}<StatusBadge tone="neutral">بنوك وخزائن</StatusBadge></button>
          <button onClick={() => navigate('/customer-money')}><span>قابل للتحصيل</span>{operationalCollectible == null ? <b>غير متاح</b> : <Money value={operationalCollectible}/>}<StatusBadge tone="neutral">عملاء</StatusBadge></button>
          <button onClick={() => navigate('/zoho-data?tab=vendors&type=bills')}><span>التزامات الموردين</span>{vendorPayable == null ? <b>غير متاح</b> : <Money value={vendorPayable}/>}<StatusBadge tone={vendorPayable > 0 ? 'warning' : 'neutral'}>موردون</StatusBadge></button>
          <button onClick={() => navigate('/pnl')}><span>ضريبة القيمة المضافة</span>{state?.vat ? <Money value={state.vat.netDue}/> : <b>غير متاح</b>}<StatusBadge tone="neutral">{state?.vat?.quarter || 'الفترة'}</StatusBadge></button>
          {residual != null && Math.abs(residual) >= .01 ? <button onClick={() => navigate('/customer-money')}><span>رصيد هامشي غير تشغيلي</span><Money value={residual}/><StatusBadge tone="neutral">لا يدخل التحصيل</StatusBadge></button> : null}
        </div>
      </Section>
    </div>

    <Section title="الحسابات البنكية والخزائن" description="القيم المتاحة من مصدر المالية" action={<Button size="sm" onClick={() => navigate('/zoho-data?tab=banks&type=bank_accounts')}>كل الحسابات</Button>}>
      <DataTable caption="الحسابات البنكية والخزائن" rows={accounts.slice(0, 8)} getRowKey={row => row.id} getRowLabel={row => `فتح حساب ${row.name}`} onRowClick={() => navigate('/money?tab=banks')} empty="لا توجد تفاصيل حسابات متاحة؛ افتح مصدر البنوك للتحقق" columns={[
        { key: 'name', label: 'الحساب', render: row => <strong>{row.name}</strong> },
        { key: 'type', label: 'النوع' }, { key: 'bank', label: 'الجهة' },
        { key: 'balance', label: 'الرصيد', render: row => row.balance == null ? 'غير متاح' : <Money value={row.balance}/> },
        { key: 'updatedAt', label: 'آخر تحديث', render: row => row.updatedAt ? new Date(row.updatedAt).toLocaleString('ar-SA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'غير مسجل' },
      ]}/>
    </Section>
  </Page>;
}

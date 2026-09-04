import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import {
  Button, DataTable, EmptyState, ErrorState, LoadingState, Money, NumberValue,
  OverflowMenu, Page, PageHeader, Section, StatStrip, StatusBadge,
} from '../../design-system/EnterpriseUI.jsx';
import { loadCarriersHub } from '../../lib/carriersHubService.js';
import { operationalDetailPath } from '../../lib/workspaceJourneyNavigation.js';
import OperationsWorkspaceNav from './OperationsWorkspaceNav.jsx';
import './enterprise-workspaces.css';

const balanceTone = value => Math.abs(Number(value || 0)) < 0.01 ? 'neutral' : Number(value) > 0 ? 'danger' : 'success';
const balanceLabel = value => Math.abs(Number(value || 0)) < 0.01 ? 'متوازن' : Number(value) > 0 ? 'لها علينا' : 'لنا عليها';

function exceptionRows(rows) {
  return rows.flatMap(row => {
    const items = [];
    if (Number(row.pendingAudits || 0) > 0) items.push({
      id: `${row.carrierId}:audit`, carrier: row.name, kind: 'invoice', priority: 'high',
      label: 'فاتورة تحتاج مراجعة', count: row.pendingAudits,
      path: `/carrier?id=${encodeURIComponent(row.carrierId)}&view=invoices`,
    });
    if (Number(row.unauditedRv?.count || 0) > 0) items.push({
      id: `${row.carrierId}:unmatched`, carrier: row.name, kind: 'mismatch', priority: 'high',
      label: 'عملية غير مرتبطة بمراجعة', count: row.unauditedRv.count,
      path: `/carrier?id=${encodeURIComponent(row.carrierId)}&view=account&panel=ledger&status=unaudited`,
    });
    if (Number(row.webhookPending || 0) > 0) items.push({
      id: `${row.carrierId}:webhook`, carrier: row.name, kind: 'source', priority: 'medium',
      label: 'ملف وارد ينتظر المعالجة', count: row.webhookPending,
      path: `/webhook?carrier=${encodeURIComponent(row.carrierId)}`,
    });
    if (Number(row.setupCompleteness || 0) < 100) items.push({
      id: `${row.carrierId}:setup`, carrier: row.name, kind: 'setup', priority: 'medium',
      label: 'إعداد الناقل غير مكتمل', count: `${Number(row.setupCompleteness || 0)}%`,
      path: `/carrier?id=${encodeURIComponent(row.carrierId)}`,
    });
    return items;
  });
}

export default function EnterpriseOperationsOverview({ isActive = true, navigate }) {
  const location = useLocation();
  const [state, setState] = useState({ loading: true, error: null, rows: [], totals: {}, loadedAt: null });
  const refresh = useCallback(async () => {
    setState(current => ({ ...current, loading: true, error: null }));
    try {
      const result = await loadCarriersHub();
      setState({ loading: false, error: null, rows: result.rows || [], totals: result.totals || {}, loadedAt: new Date().toISOString() });
    } catch (error) {
      setState(current => ({ ...current, loading: false, error }));
    }
  }, []);
  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh]);

  const exceptions = useMemo(() => exceptionRows(state.rows), [state.rows]);
  const codOutstanding = state.rows.reduce((total, row) => total + Number(row.codOutstanding || 0), 0);
  const unaudited = state.rows.reduce((total, row) => total + Number(row.unauditedRv?.count || 0), 0);
  const incomplete = state.rows.filter(row => Number(row.setupCompleteness || 0) < 100).length;
  const net = Number(state.totals?.totalDr || 0) - Number(state.totals?.totalCr || 0);
  const openDetail = path => navigate(operationalDetailPath(path, `${location.pathname}${location.search}`));

  return <Page className="enterprise-workspace enterprise-operations">
    <PageHeader
      title="مركز التشغيل"
      description="الناقلون والاستثناءات ودورة المحاسب في مساحة عمل واحدة؛ كل مؤشر يفتح السجلات التي كوّنته."
      meta={state.loadedAt ? `آخر قراءة ${new Date(state.loadedAt).toLocaleString('ar-SA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : null}
      actions={<Button variant="primary" size="sm" onClick={() => navigate('/hub?action=upload-invoice')}>رفع فاتورة ناقل</Button>}
    />
    <OperationsWorkspaceNav active="overview" onNavigate={navigate}/>

    {state.loading ? <LoadingState title="جارٍ تحميل حالة التشغيل" description="نقرأ ملف الناقلين والاستثناءات الحالية دون تغييرها."/> : null}
    {state.error ? <ErrorState title="تعذر تحميل حالة التشغيل" description={state.error.message} onRetry={refresh}/> : null}
    {!state.loading && !state.error ? <>
      <StatStrip items={[
        { key: 'carriers', label: 'شركات الشحن', value: <NumberValue value={state.rows.length}/>, note: `${incomplete.toLocaleString('en-US')} إعداد غير مكتمل`, onClick: () => navigate('/hub') },
        { key: 'actions', label: 'استثناءات تحتاج إجراء', value: <NumberValue value={exceptions.length}/>, note: `${unaudited.toLocaleString('en-US')} عملية غير مرتبطة`, tone: exceptions.length ? 'warning' : undefined, onClick: () => navigate('/tasks') },
        { key: 'cod', label: 'COD تاريخي متبقّي', value: <Money value={codOutstanding}/>, note: 'للتصفية التاريخية فقط', tone: codOutstanding > 0 ? 'warning' : undefined, onClick: () => navigate('/money?tab=cod') },
        { key: 'net', label: balanceLabel(net), value: <Money value={Math.abs(net)}/>, note: 'من دفتر الناقلين الحالي', tone: balanceTone(net), onClick: () => navigate('/hub') },
        { key: 'cycle', label: 'دورة المحاسب', value: 'فتح الدورة', note: 'الحالة من خدمة الدورة نفسها', onClick: () => navigate('/accounting-cycle') },
      ]}/>

      <Section title="يحتاج إجراء تشغيلي" description="Result set مرتب حسب نوع الاستثناء؛ لا تُغيّر هذه القائمة أهلية أي إجراء">
        <DataTable caption="الاستثناءات التشغيلية الحالية" rows={exceptions.slice(0, 12)} getRowKey={row => row.id} getRowLabel={row => `فتح ${row.label} لدى ${row.carrier}`} onRowClick={row => openDetail(row.path)} empty="لا توجد استثناءات تشغيلية في البيانات المتاحة" columns={[
          { key: 'priority', label: 'الأولوية', render: row => <StatusBadge tone={row.priority === 'high' ? 'danger' : 'warning'}>{row.priority === 'high' ? 'عالية' : 'متوسطة'}</StatusBadge> },
          { key: 'carrier', label: 'شركة الشحن', className: 'mobile-wide', render: row => <strong>{row.carrier}</strong> },
          { key: 'label', label: 'الاستثناء', className: 'mobile-wide' },
          { key: 'count', label: 'السجلات', render: row => typeof row.count === 'number' ? <NumberValue value={row.count}/> : <bdi dir="ltr">{row.count}</bdi> },
          { key: 'action', label: 'الإجراء التالي', render: () => <span className="enterprise-link">فتح التفاصيل</span> },
        ]}/>
      </Section>

      <Section title="حالة شركات الشحن" description="أهم بيانات الناقل دون تحويل الملف إلى بطاقات منفصلة" action={<Button size="sm" onClick={refresh} icon={<RefreshCw size={14}/>}>تحديث</Button>}>
        <DataTable className="enterprise-operations-table" caption="حالة شركات الشحن" rows={state.rows} getRowKey={row => row.carrierId} getRowLabel={row => `فتح ملف ${row.name}`} onRowClick={row => openDetail(`/carrier?id=${encodeURIComponent(row.carrierId)}`)} empty="لا توجد شركات شحن مسجلة" columns={[
          { key: 'name', label: 'شركة الشحن', className: 'mobile-wide', render: row => <><strong>{row.name}</strong><small>آخر نشاط: {row.lastActivityAt ? new Date(row.lastActivityAt).toLocaleDateString('ar-SA') : 'غير مسجل'}</small></> },
          { key: 'balance', label: 'الرصيد', render: row => <StatusBadge tone={balanceTone(row.balance)} dot={false}><Money value={Math.abs(Number(row.balance || 0))}/></StatusBadge> },
          { key: 'invoice', label: 'الفواتير', render: row => <Money value={row.totalDr || 0}/> },
          { key: 'cod', label: 'COD تاريخي', render: row => <Money value={row.codOutstanding || 0}/> },
          { key: 'setup', label: 'الإعداد', render: row => <StatusBadge tone={Number(row.setupCompleteness) < 100 ? 'warning' : 'success'}>{Number(row.setupCompleteness || 0)}%</StatusBadge> },
          { key: 'actions', label: 'الإجراءات', render: row => <OverflowMenu items={[
            { key: 'upload', label: 'رفع فاتورة', onClick: () => openDetail(`/carrier?id=${encodeURIComponent(row.carrierId)}&view=invoices&mode=upload`) },
            { key: 'account', label: 'فتح الحساب', onClick: () => openDetail(`/carrier?id=${encodeURIComponent(row.carrierId)}&view=account&panel=ledger`) },
            { key: 'cod', label: 'COD التاريخي', onClick: () => openDetail(`/carrier?id=${encodeURIComponent(row.carrierId)}&view=account&panel=cod`) },
          ]}/> },
        ]}/>
      </Section>
    </> : null}
  </Page>;
}

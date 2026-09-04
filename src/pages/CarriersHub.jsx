import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Button, DataTable, EmptyState, ErrorState, FilterBar, Money,
  NumberValue, OverflowMenu, Page, PageHeader, SearchInput, StatStrip, StatusBadge,
} from '../design-system/EnterpriseUI.jsx';
import { loadCarriersHub } from '../lib/carriersHubService.js';
import OperationsWorkspaceNav from '../components/enterprise/OperationsWorkspaceNav.jsx';

const relativeDate = value => {
  if (!value) return 'لا نشاط بعد';
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
  if (days <= 0) return 'اليوم';
  if (days === 1) return 'أمس';
  if (days < 7) return `قبل ${days} أيام`;
  if (days < 30) return `قبل ${Math.floor(days / 7)} أسابيع`;
  if (days < 365) return `قبل ${Math.floor(days / 30)} شهور`;
  return `قبل ${Math.floor(days / 365)} سنوات`;
};

const balanceMeta = value => {
  const balance = Number(value || 0);
  if (Math.abs(balance) < 0.01) return { label: 'متوازن', tone: 'neutral' };
  return balance > 0 ? { label: 'لها علينا', tone: 'danger' } : { label: 'لنا عليها', tone: 'success' };
};

export default function CarriersHub({ isActive = true }) {
  const navigate = useNavigate();
  const location = useLocation();
  const uploadMode = new URLSearchParams(location.search).get('action') === 'upload-invoice';
  const [state, setState] = useState({ rows: [], totals: {}, loading: true, error: null });
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState({ key: 'balance', direction: 'desc' });

  const refresh = useCallback(async () => {
    setState(current => ({ ...current, loading: true, error: null }));
    try {
      const result = await loadCarriersHub();
      setState({ rows: result.rows || [], totals: result.totals || {}, loading: false, error: null });
    } catch (error) {
      setState(current => ({ ...current, loading: false, error }));
    }
  }, []);

  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh]);

  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ar');
    const filtered = needle
      ? state.rows.filter(row => `${row.name || ''} ${row.carrierId || ''}`.toLocaleLowerCase('ar').includes(needle))
      : state.rows;
    const direction = sort.direction === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sort.key === 'name') return String(a.name || '').localeCompare(String(b.name || ''), 'ar') * direction;
      return (Number(a[sort.key] || 0) - Number(b[sort.key] || 0)) * direction;
    });
  }, [query, sort, state.rows]);

  const toggleSort = key => setSort(current => ({ key, direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc' }));
  const owed = Number(state.totals?.totalDr || 0) - Number(state.totals?.totalCr || 0);
  const pending = state.rows.reduce((total, row) => total + Number(row.pendingAudits || 0) + Number(row.webhookPending || 0), 0);
  const incomplete = state.rows.filter(row => Number(row.setupCompleteness || 0) < 100).length;

  return <Page className="enterprise-workspace enterprise-carriers-directory">
    <PageHeader
      title="شركات الشحن"
      description="حالة كل ناقل ورصيده واستثناءاته؛ افتح Carrier 360 للتفاصيل والإجراءات."
      meta={state.loading ? 'جارٍ التحديث' : `${state.rows.length.toLocaleString('en-US')} شركة شحن`}
      actions={<>
        <Button variant="primary" size="sm" onClick={() => navigate('/hub?action=upload-invoice')}>+ رفع فاتورة شركة شحن</Button>
        <Button size="sm" icon={<RefreshCw size={14}/>} onClick={refresh} disabled={state.loading}>تحديث</Button>
        <OverflowMenu items={[
          { key: 'inbox', label: 'فتح الوارد', onClick: () => navigate('/webhook') },
          { key: 'manage', label: 'إدارة الشركات', onClick: () => navigate('/carriers') },
        ]}/>
      </>}
    />
    <OperationsWorkspaceNav active="carriers"/>

    <StatStrip items={[
      { key: 'dr', label: 'المطلوب منّا (DR)', value: <Money value={state.totals?.totalDr || 0}/>, note: 'من دفتر الناقلين الحالي' },
      { key: 'cr', label: 'المدفوع/لنا (CR)', value: <Money value={state.totals?.totalCr || 0}/>, note: 'من دفتر الناقلين الحالي' },
      { key: 'net', label: owed >= 0 ? 'نحن مدينون' : 'الشركات مدينة', value: <Money value={Math.abs(owed)}/>, tone: Math.abs(owed) < 0.01 ? undefined : owed >= 0 ? 'danger' : 'success' },
      { key: 'pending', label: 'إجراءات معلّقة', value: <NumberValue value={pending}/>, note: 'مراجعات وملفات واردة', tone: pending ? 'warning' : undefined, onClick: () => navigate('/tasks') },
      { key: 'setup', label: 'إعداد غير مكتمل', value: <NumberValue value={incomplete}/>, note: 'عقد أو قارئ أو بريد', tone: incomplete ? 'warning' : undefined },
    ]}/>

    {uploadMode ? <div className="ds-alert is-info" role="status"><strong>اختر شركة الشحن</strong><div>سيفتح معالج «رفع فاتورة للمراجعة» مقيدًا بالناقل المختار.</div></div> : null}

    <FilterBar>
      <SearchInput value={query} onChange={event => setQuery(event.target.value)} placeholder="بحث باسم شركة الشحن أو المعرّف" aria-label="بحث شركات الشحن"/>
      <span className="ds-filter-bar__result"><NumberValue value={rows.length}/> نتيجة</span>
    </FilterBar>

    {state.error ? <ErrorState description={state.error.message} onRetry={refresh}/> : null}
    {!state.error ? <DataTable
      className="enterprise-operations-table"
      caption="دليل شركات الشحن التشغيلي"
      rows={rows}
      loading={state.loading}
      sort={sort}
      onSort={toggleSort}
      getRowKey={row => row.carrierId}
      getRowLabel={row => `فتح الشركة ${row.name}`}
      onRowClick={row => navigate(`/carrier?id=${encodeURIComponent(row.carrierId)}`)}
      empty="ما فيه شركات شحن مسجّلة"
      columns={[
        { key: 'name', label: 'شركة الشحن', sortable: true, className: 'mobile-wide', render: row => <><strong>{row.name}</strong><small><bdi dir="ltr">{row.carrierId}</bdi> · آخر نشاط {relativeDate(row.lastActivityAt)}</small></> },
        { key: 'balance', label: 'الرصيد', sortable: true, render: row => { const meta = balanceMeta(row.balance); return <><Money value={Math.abs(Number(row.balance || 0))}/><small><StatusBadge tone={meta.tone}>{meta.label}</StatusBadge></small></>; } },
        { key: 'totalDr', label: 'الفواتير', sortable: true, render: row => <Money value={row.totalDr || 0}/> },
        { key: 'codOutstanding', label: 'COD تاريخي', sortable: true, render: row => <Money value={row.codOutstanding || 0}/> },
        { key: 'status', label: 'الحالة', render: row => <div className="enterprise-status-stack">
          {Number(row.pendingAudits || 0) > 0 ? <Button size="sm" ariaLabel={`فاتورة تحتاج مراجعة لدى ${row.name}`} onClick={() => navigate(`/carrier?id=${encodeURIComponent(row.carrierId)}&view=invoices`)}>{row.pendingAudits} مراجعة بانتظار الاعتماد</Button> : null}
          {Number(row.unauditedRv?.count || 0) > 0 ? <StatusBadge tone="danger">{row.unauditedRv.count} فاتورة غير مدققة</StatusBadge> : null}
          {!Number(row.pendingAudits || 0) && !Number(row.webhookPending || 0) ? <StatusBadge tone="success">لا عمل معلّق</StatusBadge> : null}
        </div> },
        { key: 'setupCompleteness', label: 'الإعداد', sortable: true, render: row => <StatusBadge tone={Number(row.setupCompleteness) < 100 ? 'warning' : 'success'}>{Number(row.setupCompleteness || 0)}%</StatusBadge> },
        { key: 'actions', label: 'الإجراءات', render: row => uploadMode
          ? <Button size="sm" variant="primary" onClick={() => navigate(`/carrier?id=${encodeURIComponent(row.carrierId)}&view=invoices&mode=upload`)}>رفع فاتورة</Button>
          : <div className="enterprise-row-actions"><Button size="sm" onClick={() => navigate(`/carrier?id=${encodeURIComponent(row.carrierId)}`)}>فتح الشركة</Button><OverflowMenu items={[
              { key: 'upload', label: 'رفع فاتورة', onClick: () => navigate(`/carrier?id=${encodeURIComponent(row.carrierId)}&view=invoices&mode=upload`) },
              { key: 'review', label: 'مراجعة الفواتير', onClick: () => navigate(`/carrier?id=${encodeURIComponent(row.carrierId)}&view=invoices`) },
              { key: 'ledger', label: 'الكشف الكامل للحساب', onClick: () => navigate(`/carrier?id=${encodeURIComponent(row.carrierId)}&view=account&panel=ledger`) },
              { key: 'cod', label: 'COD التاريخي', onClick: () => navigate(`/carrier?id=${encodeURIComponent(row.carrierId)}&view=account&panel=cod`) },
            ]}/></div> },
      ]}
    /> : null}
  </Page>;
}

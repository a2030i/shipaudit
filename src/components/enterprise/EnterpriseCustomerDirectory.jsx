import { useEffect, useMemo, useState } from 'react';
import { Download, MoreHorizontal, RefreshCw } from 'lucide-react';
import {
  BulkActionBar, Button, ColumnVisibilityMenu, DataTable, FilterBar, Identifier,
  Money, NumberValue, Page, PageHeader, Pagination, PhoneNumber, SearchInput, Section,
  SourceStamp, StatStrip, StatusBadge, Tabs,
} from '../../design-system/EnterpriseUI.jsx';
import { isLamhaAccountDisabled } from '../../lib/lamhaAccountState.js';
import { applyVerifiedFinancialPosition, buildCustomerDirectoryRows } from '../../lib/customerDirectoryPresentation.js';
import { loadStore360CoreRpc } from '../../lib/store360Shadow.js';
import './enterprise-workspaces.css';

const PAGE_SIZE = 25;
const financialTruthCache = new Map();
const ANOMALY_LABELS = {
  negative_wallet: 'محفظة سالبة',
  prepaid_with_debt: 'دفع مسبق مع دين',
  active_with_debt: 'نشط مع دين',
  postpaid_overdue: 'متأخر +60 يوم',
  inactive_with_debt: 'غير نشط مع دين',
};

const lower = value => String(value || '').trim().toLocaleLowerCase('ar');
const dateLabel = value => value
  ? new Date(value).toLocaleDateString('ar-SA', { day: 'numeric', month: 'short', year: 'numeric' })
  : 'لا توجد شحنة';

export default function EnterpriseCustomerDirectory({
  data, loading, error, query, onQueryChange, view, onViewChange,
  onOpenCustomer, onReload, onSync, syncing, onExport, onNavigate,
}) {
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState('all');
  const [billing, setBilling] = useState('all');
  const [sort, setSort] = useState({ key: 'lastShipmentAt', direction: 'desc' });
  const [selected, setSelected] = useState(() => new Set());
  const [hiddenColumns, setHiddenColumns] = useState(() => new Set());
  const [financialTruth, setFinancialTruth] = useState(() => new Map(financialTruthCache));

  const allRows = useMemo(() => buildCustomerDirectoryRows(data), [data]);
  const filtered = useMemo(() => {
    const needle = lower(query);
    const rows = allRows.filter(row => {
      if (view === 'risks' && !row.risk) return false;
      if (view === 'lists' && row.shipments <= 0 && row.debt <= 0 && row.wallet === 0) return false;
      if (status === 'active' && isLamhaAccountDisabled(row.platformStatus)) return false;
      if (status === 'inactive' && !isLamhaAccountDisabled(row.platformStatus)) return false;
      if (billing !== 'all' && row.billingType !== billing) return false;
      return !needle || [row.name, row.storeName, row.storeId, row.phone].some(value => lower(value).includes(needle));
    });
    const direction = sort.direction === 'asc' ? 1 : -1;
    return rows.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (sort.key === 'lastShipmentAt') return ((Date.parse(av) || 0) - (Date.parse(bv) || 0)) * direction;
      if (typeof av === 'number' || typeof bv === 'number') return (Number(av || 0) - Number(bv || 0)) * direction;
      return String(av || '').localeCompare(String(bv || ''), 'ar') * direction;
    });
  }, [allRows, query, view, status, billing, sort]);

  useEffect(() => { setPage(0); }, [query, view, status, billing]);
  useEffect(() => { setSelected(new Set()); }, [view]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  useEffect(() => { setPage(current => Math.min(current, pages - 1)); }, [pages]);
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const financialCandidatesKey = pageRows.filter(row => Number(row.debt) > 0 && /^\d+$/.test(String(row.storeId))).map(row => row.storeId).join(',');
  useEffect(() => {
    const pending = pageRows.filter(row => Number(row.debt) > 0 && /^\d+$/.test(String(row.storeId)) && !financialTruthCache.has(String(row.storeId)));
    if (!pending.length) return undefined;
    let live = true;
    for (const row of pending) financialTruthCache.set(String(row.storeId), { status: 'loading' });
    setFinancialTruth(new Map(financialTruthCache));
    Promise.allSettled(pending.map(async row => ({ id: String(row.storeId), core: await loadStore360CoreRpc(row.storeId) })))
      .then(results => {
        if (!live) return;
        results.forEach((result, index) => {
          const id = String(pending[index].storeId);
          financialTruthCache.set(id, result.status === 'fulfilled'
            ? { status: 'verified', core: result.value.core }
            : { status: 'error', error: result.reason });
        });
        setFinancialTruth(new Map(financialTruthCache));
      });
    return () => { live = false; };
  }, [financialCandidatesKey]);
  const visibleRows = pageRows.map(row => {
    const truth = financialTruth.get(String(row.storeId));
    if (!truth) return row;
    if (truth.status === 'loading') return { ...row, financialVerification: 'loading' };
    if (truth.status === 'error') return { ...row, debt: null, financialVerification: 'error', risk: null };
    return applyVerifiedFinancialPosition(row, truth.core);
  });
  const toggleColumn = key => setHiddenColumns(current => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const columns = [
    { key: 'name', className: 'mobile-identity', label: 'العميل / المتجر', sortable: true, render: row => <><strong>{row.name}</strong><small><Identifier value={row.storeId}/>{row.phone ? <> · <PhoneNumber value={row.phone}/></> : null}</small></> },
    { key: 'platformStatus', label: 'حالة الحساب', render: row => <StatusBadge tone={isLamhaAccountDisabled(row.platformStatus) ? 'neutral' : 'success'}>{isLamhaAccountDisabled(row.platformStatus) ? 'غير نشط' : 'يعمل'}</StatusBadge> },
    { key: 'billingType', className: 'mobile-hide', label: 'نمط الدفع', sortable: true },
    { key: 'lastShipmentAt', className: 'mobile-third', label: 'آخر شحنة', sortable: true, render: row => <><span>{dateLabel(row.lastShipmentAt)}</span><small><NumberValue value={row.shipments}/> شحنة</small></> },
    { key: 'debt', label: 'القابل للتحصيل', sortable: true, render: row => row.financialVerification === 'loading'
      ? <StatusBadge tone="neutral">جارٍ التحقق</StatusBadge>
      : row.financialVerification === 'error' ? <StatusBadge tone="warning">المصدر غير متاح</StatusBadge> : <Money value={row.debt}/> },
    { key: 'wallet', className: 'mobile-hide', label: 'رصيد المحفظة', sortable: true, render: row => <Money value={row.wallet}/> },
    { key: 'risk', className: 'mobile-third', label: 'المخاطر', render: row => row.risk ? <StatusBadge tone="warning">{ANOMALY_LABELS[row.risk] || row.risk}</StatusBadge> : <StatusBadge tone="neutral">لا يوجد تنبيه</StatusBadge> },
    { key: 'owner', className: 'mobile-hide', label: 'المسؤول', render: () => 'غير مسند' },
    { key: 'actions', className: 'mobile-third', label: '', render: row => <button className="enterprise-overflow" aria-label={`إجراءات ${row.name}`} onClick={event => { event.stopPropagation(); onOpenCustomer(row.entry); }}><MoreHorizontal size={16}/></button> },
  ];

  const exportRows = selected.size ? allRows.filter(row => selected.has(row.id)) : filtered;
  const totals = data?.totals || {};

  return <Page className="enterprise-workspace enterprise-customer-directory">
    <PageHeader
      title="العملاء والمتاجر"
      description="دليل موحد يربط المتجر، حالة الحساب، الشحن، الذمم والمحفظة؛ الضغط على الصف يفتح Customer 360."
      meta={data?.snapshot?.merchants?.uploadedAt ? `لقطة لمحة ${dateLabel(data.snapshot.merchants.uploadedAt)}` : 'مصدر لمحة وزوهو'}
      actions={<><Button size="sm" onClick={() => onNavigate('/customer-money')}>الذمم والتحصيل</Button><Button size="sm" icon={<RefreshCw size={14}/>} onClick={onSync} disabled={syncing || loading}>{syncing ? 'جارٍ التحديث' : 'تحديث زوهو'}</Button></>}
    />

    <StatStrip items={[
      { key: 'customers', label: 'المتاجر في الدليل', value: <NumberValue value={totals.merchantsCount}/>, note: 'أحدث لقطة معتمدة' },
      { key: 'active', label: 'حسابات تعمل', value: <NumberValue value={totals.activeCount}/>, note: 'وفق عقد حالة لمحة', tone: 'success' },
      { key: 'debt', label: 'الذمم المفتوحة', value: <Money value={totals.totalDebt}/>, note: `${Number(totals.debtorsCount || 0).toLocaleString('en-US')} عميل` },
      { key: 'risks', label: 'تنبيهات تحتاج مراجعة', value: <NumberValue value={totals.anomalyCount}/>, note: 'قابلة للتصفية', tone: Number(totals.anomalyCount) ? 'warning' : 'success', onClick: () => onViewChange('risks') },
      { key: 'new', label: 'جدد آخر 30 يومًا', value: <NumberValue value={totals.newLast30Days}/>, note: 'من دليل المتاجر' },
    ]}/>

    <Tabs active={view} onChange={onViewChange} items={[
      { id: 'overview', label: 'الدليل', count: allRows.length },
      { id: 'risks', label: 'المخاطر', count: Number(totals.anomalyCount || 0) },
      { id: 'lists', label: 'قوائم المتابعة' },
    ]}/>

    <FilterBar>
      <SearchInput value={query} onChange={event => onQueryChange(event.target.value)} placeholder="ابحث بالاسم أو رقم المتجر أو الجوال" aria-label="بحث العملاء"/>
      <select value={status} onChange={event => setStatus(event.target.value)} aria-label="حالة الحساب"><option value="all">كل حالات الحساب</option><option value="active">يعمل</option><option value="inactive">غير نشط</option></select>
      <select value={billing} onChange={event => setBilling(event.target.value)} aria-label="نمط الدفع"><option value="all">كل أنماط الدفع</option><option value="دفع مسبق">دفع مسبق</option><option value="دفع لاحق">دفع لاحق</option></select>
      <ColumnVisibilityMenu hiddenKeys={hiddenColumns} onToggle={toggleColumn} columns={['billingType','lastShipmentAt','wallet','risk','owner'].map(key => ({ key, label: { billingType:'نمط الدفع', lastShipmentAt:'آخر شحنة', wallet:'المحفظة', risk:'المخاطر', owner:'المسؤول' }[key] }))}/>
      <Button size="sm" icon={<Download size={14}/>} onClick={() => onExport(exportRows)}>{selected.size ? `تصدير المحدد (${selected.size})` : 'تصدير النتائج'}</Button>
    </FilterBar>

    <BulkActionBar count={selected.size} onClear={() => setSelected(new Set())}>الإجراءات الجماعية لا تغيّر حالة العميل دون مراجعة مستقلة.</BulkActionBar>

    <Section title={view === 'risks' ? 'عملاء يحتاجون مراجعة' : 'سجل العملاء'} description={`${filtered.length.toLocaleString('en-US')} نتيجة`} meta={<SourceStamp label="لمحة + زوهو" updatedAt={data?.snapshot?.merchants?.uploadedAt} status={data ? 'fresh' : 'unavailable'}/>}>
      <DataTable
        className="enterprise-customer-table"
        columns={columns}
        rows={visibleRows}
        getRowKey={row => row.id}
        getRowLabel={row => `فتح ملف ${row.name}`}
        onRowClick={row => onOpenCustomer(row.entry)}
        sort={sort}
        onSort={key => setSort(current => ({ key, direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc' }))}
        hiddenColumnKeys={hiddenColumns}
        selection={{ selectedKeys: selected, onChange: setSelected, labelForRow: row => `تحديد ${row.name}` }}
        loading={loading && !data}
        error={!data ? error : null}
        onRetry={onReload}
        empty="لا توجد نتائج مطابقة للفلاتر"
        caption="سجل العملاء والمتاجر"
      />
      <Pagination page={page} pages={pages} onChange={setPage} total={filtered.length} pageSize={PAGE_SIZE}/>
    </Section>
  </Page>;
}

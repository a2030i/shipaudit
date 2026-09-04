import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ExternalLink, History, Package, Trash2 } from 'lucide-react';
import OperationsWorkspaceNav from '../components/enterprise/OperationsWorkspaceNav.jsx';
import {
  Alert, BulkActionBar, Button, DataTable, DateTime, Dialog, EmptyState,
  FilterBar, Money, NumberValue, OverflowMenu, Page, PageHeader, Pagination,
  SearchInput, SelectInput, Spinner, StatusBadge,
} from '../design-system/EnterpriseUI.jsx';
import {
  deleteAuditFromDB, loadAuditByIdFromDB, loadAuditsFromDB,
  loadAuditShipments, loadCarriers,
} from '../lib/coreService.js';
import { loadLinkedAuditIndex } from '../lib/carrierStatementsService.js';
import { exportMergedExcessWeights } from '../engine/export.js';
import { toast } from '../lib/toast.js';

const PAGE_SIZE = 25;
const TYPE_LABELS = {
  domestic: 'محلي', international: 'دولي', cod: 'دفع عند الاستلام',
  mixed: 'مختلط', unknown: 'غير محدد',
};

const reviewMeta = status => status === 'approved'
  ? ['معتمدة', 'success']
  : status === 'rejected'
    ? ['مرفوضة', 'danger']
    : ['تحتاج مراجعة', 'warning'];

export default function EnterpriseAuditsHistory({ onOpen, isActive = true }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const scopedCarrierId = searchParams.get('carrier') || null;
  const [audits, setAudits] = useState([]);
  const [linkedIndex, setLinkedIndex] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [opening, setOpening] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [exporting, setExporting] = useState(false);
  const [query, setQuery] = useState('');
  const [carrier, setCarrier] = useState('all');
  const [month, setMonth] = useState('all');
  const [status, setStatus] = useState('all');
  const [review, setReview] = useState('all');
  const [sort, setSort] = useState({ key: 'date', direction: 'desc' });
  const [page, setPage] = useState(0);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [rows, links] = await Promise.all([
        loadAuditsFromDB(),
        loadLinkedAuditIndex().catch(() => new Map()),
      ]);
      setAudits(rows);
      setLinkedIndex(links);
    } catch (error) {
      setLoadError(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isActive) load();
  }, [isActive]);

  const scopedAudits = useMemo(() => scopedCarrierId
    ? audits.filter(audit => audit.carrierId === scopedCarrierId)
    : audits, [audits, scopedCarrierId]);
  const carrierOptions = useMemo(() => [...new Set(scopedAudits.map(audit => audit.carrierName).filter(Boolean))].sort(), [scopedAudits]);
  const monthOptions = useMemo(() => [...new Set(scopedAudits.map(audit => (audit.date || '').slice(0, 7)).filter(Boolean))].sort().reverse(), [scopedAudits]);
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const rows = scopedAudits.filter(audit => {
      if (carrier !== 'all' && audit.carrierName !== carrier) return false;
      if (month !== 'all' && (audit.date || '').slice(0, 7) !== month) return false;
      if (status === 'issues' && Number(audit.issueCount || 0) <= 0) return false;
      if (status === 'clean' && Number(audit.issueCount || 0) > 0) return false;
      if (review !== 'all' && (audit.reviewStatus || 'pending') !== review) return false;
      return !normalizedQuery || `${audit.carrierName} ${audit.period} ${audit.fileName || ''}`.toLowerCase().includes(normalizedQuery);
    });
    return rows.sort((left, right) => {
      const a = sort.key === 'carrier' ? left.carrierName : sort.key === 'variance' ? Number(left.diff || 0) : left.date || '';
      const b = sort.key === 'carrier' ? right.carrierName : sort.key === 'variance' ? Number(right.diff || 0) : right.date || '';
      return (a > b ? 1 : a < b ? -1 : 0) * (sort.direction === 'asc' ? 1 : -1);
    });
  }, [carrier, month, query, review, scopedAudits, sort, status]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visibleRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const legacyCount = scopedAudits.filter(audit => audit.verificationStatus !== 'verified').length;

  useEffect(() => { setPage(0); }, [carrier, month, query, review, scopedCarrierId, status]);

  const handleSort = key => setSort(current => current.key === key
    ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
    : { key, direction: 'asc' });

  const handleOpen = async id => {
    setOpening(id);
    try {
      onOpen(await loadAuditByIdFromDB(id));
    } catch (error) {
      toast(`خطأ في التحميل: ${error.message}`, 'error');
    } finally {
      setOpening(null);
    }
  };

  const handleDelete = async () => {
    const id = confirm;
    if (!id) return;
    try {
      await deleteAuditFromDB(id);
      setAudits(current => current.filter(audit => audit.id !== id));
      setSelectedIds(current => { const next = new Set(current); next.delete(id); return next; });
      toast('تم حذف المراجعة', 'info');
    } catch (error) {
      toast(error.message || 'فشل الحذف', 'error');
    } finally {
      setConfirm(null);
    }
  };

  const handleMergedExport = async () => {
    if (!selectedIds.size) return;
    setExporting(true);
    try {
      const ids = [...selectedIds];
      const [carriers, ...fullAudits] = await Promise.all([loadCarriers(), ...ids.map(loadAuditByIdFromDB)]);
      for (const audit of fullAudits) {
        const shipments = [];
        for (let from = 0; ; from += 1000) {
          const batch = await loadAuditShipments(audit.id, { from, limit: 1000 });
          shipments.push(...batch);
          if (batch.length < 1000) break;
        }
        if (shipments.length) audit.results = shipments;
      }
      const result = exportMergedExcessWeights(fullAudits, carriers);
      if (result.ok) {
        toast(`تم تصدير ${result.count} شحنة من ${result.auditCount}/${result.selectedCount} مراجعة ✓`, 'success');
        setSelectedIds(new Set());
      } else if (result.reason === 'empty') {
        toast('لا توجد شحنات تجاوزت الوزن المسموح في المراجعات المحددة', 'info');
      } else toast('فشل التصدير', 'error');
    } catch (error) {
      toast(`فشل: ${error.message}`, 'error');
    } finally {
      setExporting(false);
    }
  };

  const resetFilters = () => {
    setQuery(''); setCarrier('all'); setMonth('all'); setStatus('all'); setReview('all');
  };

  const columns = [
    { key: 'carrier', label: 'شركة الشحن', sortable: true, className: 'mobile-identity', render: audit => <><strong>{audit.carrierName}</strong><small>{audit.period || 'الفترة غير متاحة'}</small></> },
    { key: 'file', label: 'الفاتورة', className: 'mobile-wide', render: audit => <><strong>{audit.fileName || 'فاتورة محفوظة'}</strong><small>{TYPE_LABELS[audit.auditType] || TYPE_LABELS.unknown}</small></> },
    { key: 'date', label: 'التاريخ', sortable: true, render: audit => <DateTime value={audit.date}/> },
    { key: 'rows', label: 'الشحنات', render: audit => <NumberValue value={audit.rowCount || 0}/> },
    { key: 'variance', label: 'الفرق', sortable: true, render: audit => <Money value={Number(audit.diff || 0)}/> },
    { key: 'status', label: 'الحالة', render: audit => { const [label, tone] = reviewMeta(audit.reviewStatus); return <div className="enterprise-status-stack"><StatusBadge tone={audit.verificationStatus === 'verified' ? 'success' : 'warning'}>{audit.verificationStatus === 'verified' ? 'موثقة' : 'تاريخية غير موثقة'}</StatusBadge><StatusBadge tone={tone}>{label}</StatusBadge></div>; } },
    { key: 'issues', label: 'المخالفات', render: audit => <StatusBadge tone={Number(audit.issueCount || 0) ? 'danger' : 'success'}>{Number(audit.issueCount || 0) ? `${audit.issueCount} فرق` : 'مطابقة'}</StatusBadge> },
    { key: 'actions', label: 'الإجراءات', className: 'mobile-wide', render: audit => {
      const link = linkedIndex.get(audit.id);
      return <div className="enterprise-row-actions"><Button variant="primary" size="sm" disabled={opening === audit.id} onClick={() => handleOpen(audit.id)}>{opening === audit.id ? <Spinner size={12}/> : 'فتح'}</Button><OverflowMenu items={[
        ...(link ? [{ label: `فتح القيد ${link.docNo || ''}`, icon: <ExternalLink size={13}/>, onClick: () => { const params = new URLSearchParams(); if (link.carrierId) params.set('carrier', link.carrierId); if (link.docNo) params.set('doc', link.docNo); navigate(`/ledger?${params}`); } }] : []),
        { label: link ? 'الحذف غير متاح لمراجعة مرتبطة' : 'حذف المراجعة', icon: <Trash2 size={13}/>, variant: 'danger', disabled: Boolean(link), onClick: () => setConfirm(audit.id) },
      ]}/></div>;
    } },
  ];

  return <Page className="enterprise-workspace enterprise-operations-page">
    <PageHeader eyebrow="التشغيل / الفواتير والملفات" title="سجل مراجعة فواتير الناقلين" description="بحث وفلترة وفتح النتائج من قائمة تشغيلية واحدة؛ لا تتغير أهلية الاعتماد أو الحذف." meta={`${scopedAudits.length.toLocaleString('en-US')} مراجعة`} actions={<Button variant="primary" onClick={() => navigate('/hub?action=upload-invoice')}>رفع فاتورة</Button>}/>
    <OperationsWorkspaceNav active="invoices"/>
    {legacyCount ? <Alert tone="warning" title={`${legacyCount.toLocaleString('en-US')} مراجعة تاريخية غير موثقة`}>تبقى للقراءة ولا تُمنح أهلية ربط مالي أو تصدير أوزان حتى إعادة رفع المصدر عبر المسار الآمن.</Alert> : null}
    <FilterBar>
      <SearchInput aria-label="بحث سجل المراجعات" placeholder="اسم الشركة أو الفترة أو الملف" value={query} onChange={event => setQuery(event.target.value)}/>
      <SelectInput aria-label="شركة الشحن" value={carrier} onChange={event => setCarrier(event.target.value)}><option value="all">كل الشركات</option>{carrierOptions.map(value => <option key={value}>{value}</option>)}</SelectInput>
      <SelectInput aria-label="الشهر" value={month} onChange={event => setMonth(event.target.value)}><option value="all">كل الشهور</option>{monthOptions.map(value => <option key={value}>{value}</option>)}</SelectInput>
      <SelectInput aria-label="حالة المطابقة" value={status} onChange={event => setStatus(event.target.value)}><option value="all">كل النتائج</option><option value="issues">بفروق فقط</option><option value="clean">مطابقة فقط</option></SelectInput>
      <SelectInput aria-label="حالة المراجعة" value={review} onChange={event => setReview(event.target.value)}><option value="all">كل حالات المراجعة</option><option value="pending">تحتاج مراجعة</option><option value="approved">معتمدة</option><option value="rejected">مرفوضة</option></SelectInput>
      <Button size="sm" onClick={resetFilters}>مسح الفلاتر</Button>
    </FilterBar>
    <BulkActionBar count={selectedIds.size} onClear={() => setSelectedIds(new Set())}><Button variant="primary" size="sm" disabled={exporting} onClick={handleMergedExport}>{exporting ? 'جارٍ التصدير…' : <><Package size={13}/> تصدير الأوزان المدمجة</>}</Button></BulkActionBar>
    {!loading && !loadError && !scopedAudits.length ? <EmptyState title="لا توجد مراجعات بعد" description="ارفع فاتورة لبدء أول مراجعة."/> : null}
    <DataTable caption="سجل مراجعة فواتير الناقلين" columns={columns} rows={visibleRows} getRowKey={audit => audit.id} getRowLabel={audit => `فتح مراجعة ${audit.fileName || audit.period} لدى ${audit.carrierName}`} onRowClick={audit => handleOpen(audit.id)} sort={sort} onSort={handleSort} loading={loading} error={loadError} onRetry={load} empty="لا توجد مراجعات مطابقة" selection={{ selectedKeys: selectedIds, onChange: setSelectedIds, isRowSelectable: audit => audit.verificationStatus === 'verified', labelForRow: audit => `تحديد مراجعة ${audit.fileName || audit.period}` }}/>
    <Pagination page={page} pages={pages} onChange={setPage} total={filtered.length} pageSize={PAGE_SIZE}/>
    <Dialog open={Boolean(confirm)} title="حذف المراجعة" description="إجراء نهائي لا يمكن التراجع عنه." onClose={() => setConfirm(null)} footer={<><Button onClick={() => setConfirm(null)}>إلغاء</Button><Button variant="danger" onClick={handleDelete}>حذف نهائي</Button></>}><p>سيُحذف سجل المراجعة المحدد فقط. المراجعة المرتبطة بقيد لا تصل إلى هذا التأكيد.</p></Dialog>
  </Page>;
}

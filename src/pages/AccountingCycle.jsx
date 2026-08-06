import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import {
  AlertTriangle, ArrowLeft, CalendarDays, Check, CheckCircle2, Circle,
  ClipboardCheck, Download, FileSpreadsheet, LockKeyhole, PackageCheck,
  RefreshCw, Store, Upload, WalletCards,
} from 'lucide-react';
import { Btn, Card, DropZone, PageHeader, Select, Spinner, toast } from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  closeAccountingCycle,
  loadAccountingCycle,
  parseLamhaShipmentWorkbook,
  recordAccountingCycleEvent,
  uploadLamhaShipmentSnapshot,
} from '../lib/accountingCycleService.js';
import { uploadFile } from '../lib/uploadsHubService.js';
import {
  downloadApprovedShipmentNumbers,
  exportPendingExcessWeights,
  redownloadWeightExport,
} from '../lib/weightBillingService.js';
import { parseConsolidatedExpected, saveConsolidatedExpected } from '../lib/codSettlementService.js';
import { REMITTANCE_PARSERS } from '../engine/codParsers/index.js';
import UploadWizard from './UploadWizard.jsx';
import AuditResults from './AuditResults.jsx';
import { UploadModal as SettlementUploadModal } from './CodSettlements.jsx';

const STAGE_ICONS = {
  carrier_audits: ClipboardCheck,
  weight_export: Download,
  lamha_shipments: PackageCheck,
  lamha_sources: Store,
  carrier_collections: WalletCards,
  lamha_collections: FileSpreadsheet,
  period_close: LockKeyhole,
};

const STATUS = {
  complete: { label: 'مكتمل', color: 'var(--green)', Icon: CheckCircle2 },
  ready: { label: 'جاهز الآن', color: 'var(--accent)', Icon: ArrowLeft },
  attention: { label: 'يحتاج مراجعة', color: 'var(--gold)', Icon: AlertTriangle },
  pending: { label: 'لم يبدأ', color: 'var(--muted)', Icon: Circle },
  blocked: { label: 'ينتظر مرحلة سابقة', color: 'var(--muted2)', Icon: LockKeyhole },
};

const REQUIREMENT_STATUS = {
  complete: { label: 'مكتمل', color: 'var(--green)', Icon: CheckCircle2 },
  uploaded: { label: 'مكتمل', color: 'var(--green)', Icon: CheckCircle2 },
  automatic: { label: 'مكتمل تلقائيًا', color: 'var(--green)', Icon: CheckCircle2 },
  not_required: { label: 'غير مطلوب', color: 'var(--muted)', Icon: Check },
  pending: { label: 'ناقص', color: 'var(--accent)', Icon: Upload },
  unsupported: { label: 'القارئ غير مهيأ', color: 'var(--gold)', Icon: AlertTriangle },
  unclassified: { label: 'الجدول غير محدد', color: 'var(--gold)', Icon: AlertTriangle },
};

function CarrierRequirementChecklist({ items = [], title }) {
  if (!items.length) return null;
  return (
    <section style={{ marginBottom: 16 }} aria-label={title}>
      <strong style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>{title}</strong>
      <div style={{ display: 'grid', gap: 8 }}>
        {items.map(item => {
          const meta = REQUIREMENT_STATUS[item.status] || REQUIREMENT_STATUS.unclassified;
          const StatusIcon = meta.Icon;
          return (
            <div key={item.carrierId} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 10,
              alignItems: 'center', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 10,
              background: 'var(--surface2)' }}>
              <div style={{ minWidth: 0 }}>
                <strong style={{ display: 'block', fontSize: 13 }}>{item.carrierName}</strong>
                {item.scheduleText && <span style={{ display: 'block', marginTop: 2, color: 'var(--text2)', fontSize: 11.5 }}>{item.scheduleText}</span>}
                <span style={{ display: 'block', marginTop: 3, color: 'var(--muted)', fontSize: 11.5, lineHeight: 1.6 }}>{item.note}</span>
              </div>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: meta.color, fontSize: 11.5, fontWeight: 800, whiteSpace: 'nowrap' }}>
                <StatusIcon size={14}/>{meta.label}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function fmtDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ar-SA', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function useCompactCycleLayout() {
  const query = '(max-width: 760px)';
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);

  useEffect(() => {
    const media = window.matchMedia(query);
    const sync = () => setCompact(media.matches);
    sync();
    media.addEventListener?.('change', sync);
    return () => media.removeEventListener?.('change', sync);
  }, []);

  return compact;
}

function fileOf(record) {
  return record?.file_name || record?.source_file || record?.fileName || null;
}

function dateOf(record) {
  return record?.uploaded_at || record?.approved_at || record?.exported_at || record?.created_at || record?.upload_date || null;
}

function stageActionLabel(stage) {
  const labels = {
    carrier_audits: stage.status === 'complete' ? 'رفع مراجعة إضافية' : 'رفع ومراجعة فاتورة',
    weight_export: 'تنزيل ملف الأوزان',
    lamha_shipments: stage.status === 'complete' ? 'رفع نسخة أحدث' : 'رفع شحنات لمحة',
    lamha_sources: 'تحديث ملفات لمحة',
    carrier_collections: 'رفع تحصيل شركة شحن',
    lamha_collections: 'رفع تحصيل لمحة',
    period_close: 'مراجعة وإقفال الشهر',
  };
  return labels[stage.id];
}

function StageCard({ stage, index, selected, onSelect }) {
  const cfg = STATUS[stage.status] || STATUS.pending;
  const Icon = STAGE_ICONS[stage.id] || Circle;
  const StatusIcon = cfg.Icon;
  const lastFile = fileOf(stage.last);
  return (
    <button
      type="button"
      className={`accounting-cycle-stage${selected ? ' is-selected' : ''}`}
      onClick={onSelect}
      aria-current={selected ? 'step' : undefined}
    >
      <span className="accounting-cycle-stage__index" style={{ '--stage-tone': cfg.color }}>
        {stage.status === 'complete' ? <Check size={16}/> : index + 1}
      </span>
      <span className="accounting-cycle-stage__body">
        <span className="accounting-cycle-stage__title"><Icon size={17}/>{stage.label}</span>
        <span className="accounting-cycle-stage__reason">{stage.reason}</span>
        {(lastFile || dateOf(stage.last)) && (
          <span className="accounting-cycle-stage__last">
            {lastFile && <b>{lastFile}</b>}
            {dateOf(stage.last) && <span>{fmtDate(dateOf(stage.last))}</span>}
          </span>
        )}
      </span>
      <span className="accounting-cycle-stage__status" style={{ '--stage-tone': cfg.color }}>
        <StatusIcon size={14}/>{cfg.label}
      </span>
    </button>
  );
}

const HISTORY_SOURCE_LABELS = {
  internal_settlement: 'كشف حساب لمحة',
  merchants: 'دليل متاجر لمحة',
  weight_billing: 'تصدير الأوزان',
  in: 'تحصيل مستلم من شركة شحن',
  out: 'تحصيل لمحة',
};

const HISTORY_STATUS_LABELS = {
  approved: 'معتمد',
  pending: 'بانتظار الاعتماد',
  rejected: 'مرفوض',
  success: 'تم بنجاح',
  warning: 'تم مع تنبيه',
  error: 'فشل',
  failed: 'فشل',
  exported: 'تم التصدير',
  billed: 'تمت الفوترة',
  skipped: 'لا يحتاج تصديرًا',
  closed: 'مقفل',
};

function isDownloadableWeightExport(record) {
  return Boolean(
    record?.file_path
    || record?.result?.exportId
    || record?.export_id
    || Array.isArray(record?.audit_ids)
    || ['exported', 'billed'].includes(record?.status),
  );
}

function fmtScheduleDate(value) {
  if (!value) return '—';
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00+03:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ar-SA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

function StageHistory({ stage, busy, onRedownload }) {
  const history = Array.isArray(stage?.history) ? stage.history : [];
  return (
    <section className="accounting-cycle-history" aria-label={`سجل ${stage?.label || 'المرحلة'}`}>
      <div className="accounting-cycle-history__head">
        <div>
          <strong>سجل ملفات هذه المرحلة</strong>
          <span>خاص بالشهر المختار، ويثبت ما رُفع أو نُزّل فعلًا</span>
        </div>
        <b>{history.length}</b>
      </div>
      {history.length ? (
        <div className="accounting-cycle-history__list">
          {history.map((record, index) => {
            const sourceLabel = HISTORY_SOURCE_LABELS[record.source_kind]
              || (record.carrier_name ? 'مراجعة شركة شحن' : null);
            const name = fileOf(record)
              || sourceLabel
              || record.carrier_name
              || record.settlement_ref
              || `سجل تشغيل ${index + 1}`;
            const rowCount = record.row_count ?? record.saved_count ?? record.count;
            const total = record.total ?? record.total_balance;
            const state = HISTORY_STATUS_LABELS[record.review_status || record.status];
            return (
              <article className="accounting-cycle-history__item" key={record.id || record.upload_id || record.snapshot_id || `${name}-${index}`}>
                <div className="accounting-cycle-history__name">
                  <FileSpreadsheet size={16}/>
                  <div>
                    <strong>{name}</strong>
                    {(sourceLabel || (record.carrier_name && name !== record.carrier_name)) && (
                      <span>{[sourceLabel, record.carrier_name && name !== record.carrier_name ? record.carrier_name : null].filter(Boolean).join(' · ')}</span>
                    )}
                  </div>
                </div>
                <div className="accounting-cycle-history__meta">
                  {rowCount != null && <span>{Number(rowCount).toLocaleString('en-US')} صف</span>}
                  {total != null && <span>{Number(total).toLocaleString('en-US', { maximumFractionDigits: 2 })} ر.س</span>}
                  {state && <span>{state}</span>}
                  {dateOf(record) && <time>{fmtDate(dateOf(record))}</time>}
                  {stage?.id === 'weight_export' && isDownloadableWeightExport(record) && (
                    <Btn
                      variant="ghost"
                      size="sm"
                      icon={<Download size={13}/>}
                      onClick={() => onRedownload(record)}
                      disabled={busy}
                    >
                      {busy ? 'جارٍ التنزيل…' : 'تنزيل هذا الملف مرة أخرى'}
                    </Btn>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="accounting-cycle-history__empty">لا يوجد ملف مسجل لهذه المرحلة في الشهر المختار.</div>
      )}
    </section>
  );
}

function SourceUpload({ sourceId, title, done, busy, onFile }) {
  return (
    <div className={`accounting-cycle-source${done ? ' is-done' : ''}`}>
      <div className="accounting-cycle-source__head">
        <div>
          <strong>{title}</strong>
          <span>{done ? 'موجود لهذه الفترة' : 'مطلوب لإكمال المرحلة'}</span>
        </div>
        {done && <CheckCircle2 size={20} color="var(--green)"/>}
      </div>
      <DropZone
        title={busy ? 'جارٍ معالجة الملف…' : `اختر ${title}`}
        hint="Excel · يتم التحقق من المصدر قبل الحفظ"
        onFile={file => onFile(sourceId, file)}
        accept=".xlsx,.xls"
      />
    </div>
  );
}

export default function AccountingCycle({ carriers = [], isActive = false }) {
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const compactLayout = useCompactCycleLayout();
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [snapshot, setSnapshot] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [auditDraft, setAuditDraft] = useState(null);
  const [shipmentPreview, setShipmentPreview] = useState(null);
  const [lamhaCollectionPreview, setLamhaCollectionPreview] = useState(null);
  const [settlement, setSettlement] = useState(null);
  const [carrierId, setCarrierId] = useState(() => carriers[0]?.id || '');
  const [collectionScheduleSlot, setCollectionScheduleSlot] = useState('');

  const refresh = useCallback(async ({ advance = false } = {}) => {
    setLoading(true);
    setLoadError('');
    try {
      const data = await loadAccountingCycle(period);
      setSnapshot(data);
      setSelectedId(current => {
        if (!current || advance) return data.next?.id || data.stages?.[0]?.id || '';
        return data.stages?.some(stage => stage.id === current) ? current : (data.next?.id || data.stages?.[0]?.id || '');
      });
    } catch (error) {
      setLoadError(error.message || 'تعذر تحميل بيانات الدورة');
      toast(`تعذر تحميل دورة المحاسب: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { if (isActive) refresh(); }, [isActive, period]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!carrierId && carriers[0]?.id) setCarrierId(carriers[0].id);
  }, [carrierId, carriers]);

  useEffect(() => { setCollectionScheduleSlot(''); }, [carrierId, period]);

  const selected = useMemo(
    () => snapshot?.stages?.find(stage => stage.id === selectedId) || snapshot?.stages?.[0] || null,
    [snapshot, selectedId],
  );
  const percent = snapshot ? Math.round((snapshot.completed / snapshot.total) * 100) : 0;

  const selectStage = stage => {
    setSelectedId(stage.id);
    setAuditDraft(null);
  };

  const recordFailure = async ({ stage, sourceKind = null, fileName = null, error, result = {} }) => {
    try {
      await recordAccountingCycleEvent({
        period,
        stage,
        eventType: 'stage_attempt_failed',
        status: 'error',
        sourceKind,
        fileName,
        result: { ...result, error: error?.message || String(error) },
        userId: user?.id,
      });
    } catch (eventError) {
      console.warn('accounting cycle failure event failed:', eventError.message);
    }
  };

  const exportWeights = async () => {
    setBusy('weight_export');
    try {
      const result = await exportPendingExcessWeights({ carriers, userId: user?.id, trigger: 'internal-exports', period });
      if (!result.ok) {
        toast(result.reason === 'empty' ? 'لا توجد مراجعات معلقة للأوزان في هذه الفترة' : 'لا توجد شحنات قابلة للتصدير', 'info');
      } else {
        try {
          await recordAccountingCycleEvent({
            period,
            stage: 'weight_export',
            eventType: 'weight_file_exported',
            sourceKind: 'weight_billing',
            fileName: result.fileName,
            rowCount: result.count,
            result: { auditCount: result.auditCount, exportId: result.exportId },
            userId: user?.id,
          });
        } catch (eventError) {
          console.warn('accounting cycle event failed:', eventError.message);
        }
        toast(`تم تنزيل ${result.count} شحنة في ملف الأوزان`, 'success');
      }
      await refresh({ advance: true });
    } catch (error) {
      await recordFailure({ stage: 'weight_export', sourceKind: 'weight_billing', error });
      await refresh();
      toast(`فشل تصدير الأوزان: ${error.message}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const downloadShipmentNumbers = async () => {
    setBusy('lamha_shipment_numbers');
    try {
      const result = await downloadApprovedShipmentNumbers({ period });
      if (!result.ok && result.reason === 'complete') toast('كل أرقام الشحنات المعتمدة موجودة بالفعل في ملفات لمحة المرفوعة', 'success');
      else if (!result.ok) toast('لا توجد أرقام شحنات من مراجعات معتمدة في هذه الفترة', 'info');
      else toast(`تم تنزيل ${result.count.toLocaleString('en-US')} رقم شحنة للبحث الجماعي في لمحة`, 'success');
    } catch (error) {
      toast(`تعذر تنزيل أرقام الشحنات: ${error.message}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const redownloadWeights = async record => {
    setBusy(`weight_redownload:${record?.result?.exportId || record?.id || record?.file_name || ''}`);
    try {
      await redownloadWeightExport(record);
      toast('تمت إعادة تنزيل ملف الأوزان نفسه دون إنشاء تصدير جديد', 'success');
    } catch (error) {
      toast(`تعذر إعادة تنزيل ملف الأوزان: ${error.message}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const parseShipments = async file => {
    setBusy('lamha_shipments');
    try {
      const parsed = await parseLamhaShipmentWorkbook(file, period);
      setShipmentPreview(parsed);
    } catch (error) {
      await recordFailure({ stage: 'lamha_shipments', sourceKind: 'lamha_shipments', fileName: file?.name, error });
      await refresh();
      toast(error.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const saveShipments = async () => {
    if (!shipmentPreview) return;
    setBusy('lamha_shipments');
    try {
      await uploadLamhaShipmentSnapshot({ parsed: shipmentPreview, period, userId: user?.id });
      toast(`تم حفظ ${shipmentPreview.rowCount} شحنة من لمحة`, 'success');
      setShipmentPreview(null);
      await refresh({ advance: true });
    } catch (error) {
      await recordFailure({ stage: 'lamha_shipments', sourceKind: 'lamha_shipments', fileName: shipmentPreview?.fileName, error });
      await refresh();
      toast(`فشل حفظ شحنات لمحة: ${error.message}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const parseLamhaCollections = async file => {
    setBusy('lamha_collections');
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!worksheet) throw new Error('ملف تحصيل لمحة لا يحتوي ورقة قابلة للقراءة');
      let maxRow = 0;
      let maxCol = 0;
      for (const cell of Object.keys(worksheet)) {
        if (cell.startsWith('!')) continue;
        const address = XLSX.utils.decode_cell(cell);
        maxRow = Math.max(maxRow, address.r);
        maxCol = Math.max(maxCol, address.c);
      }
      if (maxRow > 0 || maxCol > 0) {
        worksheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRow, c: maxCol } });
      }
      const allRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true, defval: '' });
      const parsed = parseConsolidatedExpected(allRows);
      const carrierCount = Object.keys(parsed.byCarrier).length;
      const saveableRows = Object.values(parsed.byCarrier).flat();
      const total = saveableRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
      setLamhaCollectionPreview({ file, allRows, ...parsed, carrierCount, saveableCount: saveableRows.length, total: +total.toFixed(2) });
    } catch (error) {
      await recordFailure({ stage: 'lamha_collections', sourceKind: 'out', fileName: file?.name, error });
      await refresh();
      toast(`تعذر فحص تحصيل لمحة: ${error.message}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const saveLamhaCollections = async () => {
    if (!lamhaCollectionPreview) return;
    setBusy('lamha_collections');
    try {
      const saved = await saveConsolidatedExpected({
        allRows: lamhaCollectionPreview.allRows,
        fileName: lamhaCollectionPreview.file.name,
        userId: user?.id,
      });
      const added = saved.results.reduce((sum, row) => sum + Number(row.added || 0), 0);
      const duplicates = saved.results.reduce((sum, row) => sum + Number(row.dups || 0), 0);
      const failures = saved.results.filter(row => row.error);
      if (failures.length === saved.results.length) throw new Error(failures.map(row => row.error).join(' · '));
      try {
        await recordAccountingCycleEvent({
          period,
          stage: 'lamha_collections',
          eventType: 'consolidated_lamha_collection_uploaded',
          sourceKind: 'out',
          fileName: lamhaCollectionPreview.file.name,
          rowCount: lamhaCollectionPreview.saveableCount,
          total: lamhaCollectionPreview.total,
          result: {
            submitted: saved.stats.delivered,
            added,
            duplicates,
            carrierCount: saved.results.length,
            unmapped: saved.unmapped,
            failures: failures.map(row => ({ carrierId: row.carrierId, error: row.error })),
          },
          userId: user?.id,
        });
      } catch (eventError) {
        console.warn('accounting cycle event failed:', eventError.message);
      }
      toast(`تم توزيع وحفظ ${added} عملية تحصيل لمحة على ${saved.results.length} ناقل`, 'success');
      setLamhaCollectionPreview(null);
      await refresh({ advance: true });
    } catch (error) {
      await recordFailure({ stage: 'lamha_collections', sourceKind: 'out', fileName: lamhaCollectionPreview?.file?.name, error });
      await refresh();
      toast(`فشل حفظ تحصيل لمحة: ${error.message}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const uploadSource = async (sourceId, file) => {
    setBusy(sourceId);
    try {
      const result = await uploadFile({ sourceId, file, userId: user?.id });
      try {
        await recordAccountingCycleEvent({
          period,
          stage: 'lamha_sources',
          eventType: 'lamha_source_uploaded',
          sourceKind: sourceId,
          fileName: file.name,
          rowCount: result.rowCount,
          total: result.total,
          result: { matched: result.matched, message: result.message },
          userId: user?.id,
        });
      } catch (eventError) {
        console.warn('accounting cycle event failed:', eventError.message);
      }
      toast(`${sourceId === 'merchants' ? 'دليل المتاجر' : 'كشف الحساب'}: ${result.message}`, 'success');
      await refresh({ advance: true });
    } catch (error) {
      await recordFailure({ stage: 'lamha_sources', sourceKind: sourceId, fileName: file?.name, error });
      await refresh();
      toast(`تعذر رفع الملف: ${error.message}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const closePeriod = async () => {
    setBusy('period_close');
    try {
      await closeAccountingCycle({ period, userId: user?.id });
      toast('تم إقفال دورة التشغيل الشهرية', 'success');
      await refresh({ advance: true });
    } catch (error) {
      await recordFailure({ stage: 'period_close', error });
      await refresh();
      toast(error.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const openSettlement = (direction, selectedCarrierId = carrierId, scheduleSlot = null) => {
    if (!selectedCarrierId) {
      toast('اختر شركة الشحن أولًا', 'error');
      return;
    }
    setSettlement({ direction, carrier: selectedCarrierId, scheduleSlot });
  };

  const settlementDone = async result => {
    const stage = result.direction === 'in' ? 'carrier_collections' : 'lamha_collections';
    const processedCount = Number(result.savedCount || 0) + Number(result.skippedCount || 0);
    try {
      await recordAccountingCycleEvent({
        period,
        stage,
        eventType: 'settlement_uploaded',
        status: result.ledgerError ? 'warning' : 'success',
        sourceKind: result.direction,
        fileName: result.fileNames?.join(' · ') || null,
        rowCount: processedCount,
        total: result.total,
        result: {
          carrier: result.carrier,
          savedCount: result.savedCount,
          skippedCount: result.skippedCount,
          fileCount: result.fileCount,
          scheduleSlot: settlement?.scheduleSlot || null,
          ledgerError: result.ledgerError || null,
        },
        userId: user?.id,
      });
    } catch (error) {
      console.warn('accounting cycle event failed:', error.message);
    }
    setSettlement(null);
    await refresh({ advance: true });
  };

  const settlementFailed = async result => {
    const stage = result.direction === 'in' ? 'carrier_collections' : 'lamha_collections';
    await recordFailure({
      stage,
      sourceKind: result.direction,
      fileName: result.fileNames?.join(' · ') || null,
      error: result.error,
      result: { carrier: result.carrier || carrierId || null, scheduleSlot: settlement?.scheduleSlot || null },
    });
    await refresh();
  };

  const auditApproved = async result => {
    if (result.ledgerErr || result.codExtractErr) {
      await refresh();
      return;
    }
    setAuditDraft(null);
    await refresh({ advance: true });
  };

  const renderStage = stage => {
    if (!stage) return null;
    const allowed = can(stage.permission);
    if (stage.id === 'carrier_audits') {
      if (auditDraft) {
        return (
          <div className="accounting-cycle-embedded">
            <div className="accounting-cycle-embedded__bar">
              <strong>نتيجة المراجعة الحالية</strong>
              <Btn variant="ghost" size="sm" onClick={() => { setAuditDraft(null); refresh({ advance: true }); }}>العودة للدورة</Btn>
            </div>
            <AuditResults
              audit={auditDraft}
              carriers={carriers}
              onApproved={auditApproved}
              onNewAudit={() => { setAuditDraft(null); refresh({ advance: true }); }}
            />
          </div>
        );
      }
      return (
        <div className="accounting-cycle-embedded">
          <p className="accounting-cycle-help">ارفع فاتورة شركة الشحن، راجع نتيجة المطابقة، ثم اعتمدها من نفس المسار. الناقل ذو الملف الأسبوعي الموحّد يحتاج كل ملفات الشهر، بينما الناقل ذو الفاتورة الشهرية يحتاج فاتورة واحدة مستقلة عن دفعات التحصيل.</p>
          <CarrierRequirementChecklist items={stage.detail?.carriers || []} title="اكتمال فواتير الناقلين حسب الجدول" />
          {(stage.detail?.carriers || []).some(item => item.status === 'unclassified') && (
            <Btn variant="ghost" size="sm" onClick={() => navigate('/tasks')} style={{ marginBottom: 14 }}>
              ضبط جداول استلام الناقلين
            </Btn>
          )}
          {allowed ? <UploadWizard key={period} carriers={carriers} onComplete={setAuditDraft} initialPeriod={period}/> : <NoPermission/>}
        </div>
      );
    }
    if (stage.id === 'weight_export') {
      const shipmentCoverage = snapshot?.stages?.find(item => item.id === 'lamha_shipments')?.detail?.coverage || {};
      const missingShipmentCount = Number(shipmentCoverage.missingCount || 0);
      const latestWeightExport = (stage.history || []).find(isDownloadableWeightExport) || null;
      return (
        <div style={{ display: 'grid', gap: 14 }}>
          <StageAction
            title="1 — تنزيل أرقام الشحنات من النظام"
            text={missingShipmentCount
              ? `سأعطيك ${missingShipmentCount.toLocaleString('en-US')} رقم شحنة في ملف بعمود واحد. استخدمه في البحث الجماعي داخل لمحة، ثم صدّر Admin Order Export وارفعه في المرحلة 3.`
              : 'كل أرقام الشحنات المعتمدة موجودة بالفعل في ملفات لمحة المرفوعة، لذلك لا يوجد ملف ناقص لتنزيله.'}
            disabled={!can('internal_exports.pull') || busy === 'lamha_shipment_numbers' || !missingShipmentCount}
            button={missingShipmentCount ? `تنزيل ${missingShipmentCount.toLocaleString('en-US')} رقم شحنة للبحث في لمحة` : 'لا توجد أرقام شحنات ناقصة'}
            onClick={downloadShipmentNumbers}
            busy={busy === 'lamha_shipment_numbers'}
          />
          <StageAction
            title="2 — تنزيل ملف الأوزان الجديد لرفعه إلى لمحة"
            text={Number(stage.count || 0) > 0
              ? 'الملف يأخذ مراجعات هذا الشهر المعتمدة فقط، ويحتوي رقم الشحنة والوزن. بعد التنزيل لن تتكرر الشحنات في السحبة التالية.'
              : 'لا توجد مراجعات معتمدة تحمل أوزانًا جديدة معلقة. إذا سبق تنزيل ملف لهذه الفترة، استخدم زر إعادة التنزيل أدناه لاسترجاع الملف نفسه.'}
            disabled={!allowed || busy === stage.id || stage.status === 'blocked' || Number(stage.count || 0) === 0}
            button={Number(stage.count || 0) > 0 ? 'تنزيل ملف الأوزان لهذه الفترة' : 'لا توجد أوزان جديدة معلقة'}
            onClick={exportWeights}
            busy={busy === stage.id}
          />
          {latestWeightExport && (
            <StageAction
              title="إعادة تنزيل ملف الأوزان السابق نفسه"
              text={`آخر ملف محفوظ: ${fileOf(latestWeightExport) || 'ملف أوزان هذه الفترة'}. إعادة التنزيل تسترجع الملف نفسه ولا تنشئ تصديرًا جديدًا ولا تكرر الشحنات.`}
              disabled={String(busy || '').startsWith('weight_redownload:')}
              button="إعادة تنزيل آخر ملف أوزان"
              onClick={() => redownloadWeights(latestWeightExport)}
              busy={String(busy || '').startsWith('weight_redownload:')}
            />
          )}
        </div>
      );
    }
    if (stage.id === 'lamha_shipments') {
      const coverage = stage.detail?.coverage || {};
      const missingShipmentCount = Number(coverage.missingCount || 0);
      return (
        <div>
          <StageAction
            title="أرقام الشحنات المطلوب البحث عنها في لمحة"
            text={missingShipmentCount
              ? `المراجعات المعتمدة تحتوي ${Number(coverage.expectedCount || 0).toLocaleString('en-US')} شحنة؛ الموجود من لمحة ${Number(coverage.importedExpectedCount || 0).toLocaleString('en-US')}، والمتبقي ${missingShipmentCount.toLocaleString('en-US')}. نزّل المتبقي فقط ثم ارفع Admin Order Export أدناه.`
              : 'كل أرقام الشحنات المعتمدة موجودة في ملفات لمحة المرفوعة؛ لا يلزم تنزيل قائمة جديدة.'}
            disabled={!can('internal_exports.pull') || busy === 'lamha_shipment_numbers' || !missingShipmentCount}
            button={missingShipmentCount ? `تنزيل ${missingShipmentCount.toLocaleString('en-US')} رقم متبقي` : 'اكتملت أرقام لمحة'}
            onClick={downloadShipmentNumbers}
            busy={busy === 'lamha_shipment_numbers'}
          />
          <p className="accounting-cycle-help" style={{ marginTop: 14 }}>بعد البحث الجماعي ارفع تصدير الطلبات من لمحة. ترتيب الأعمدة لا يهم؛ النظام يقرأ أسماء الأعمدة ويحفظ بيانات الطلب والمتجر والناقل والـAWB والتكلفة والتواريخ.</p>
          {!allowed ? <NoPermission/> : shipmentPreview ? (
            <Card className="accounting-cycle-preview">
              <h3>معاينة قبل الحفظ</h3>
              <div className="accounting-cycle-preview__stats">
                <span><b>{shipmentPreview.rowCount}</b> شحنة</span>
                <span><b>{shipmentPreview.duplicateCount}</b> مكرر داخل الملف</span>
                <span><b>{shipmentPreview.outsidePeriodCount}</b> خارج الشهر المحدد</span>
                <span><b>{shipmentPreview.shippingCostTotal.toLocaleString('en-US', { maximumFractionDigits: 2 })}</b> ر.س تكلفة شحن</span>
              </div>
              <div className="accounting-cycle-preview__range">الفترة داخل الملف: {shipmentPreview.minOrderDate || '—'} ← {shipmentPreview.maxOrderDate || '—'}</div>
              {shipmentPreview.outsidePeriodCount > 0 && <div className="accounting-cycle-warning">لن تُحذف الصفوف خارج الشهر؛ ستُحفظ بفترتها الحقيقية ويظهر عددها في سجل الاستيراد.</div>}
              <div className="accounting-cycle-actions">
                <Btn variant="accent" onClick={saveShipments} disabled={busy === stage.id}>{busy === stage.id ? <Spinner size={14}/> : 'تأكيد حفظ الشحنات'}</Btn>
                <Btn variant="ghost" onClick={() => setShipmentPreview(null)}>اختيار ملف آخر</Btn>
              </div>
            </Card>
          ) : (
            <DropZone onFile={parseShipments} accept=".xlsx,.xls" title={busy === stage.id ? 'جارٍ فحص كل الصفوف…' : 'اختر ملف شحنات لمحة'} hint="Admin Order Export · أي ترتيب للأعمدة"/>
          )}
        </div>
      );
    }
    if (stage.id === 'lamha_sources') {
      return !allowed ? <NoPermission/> : (
        <div className="accounting-cycle-sources">
          <SourceUpload
            sourceId="internal_settlement"
            title="كشف حساب لمحة"
            done={!!stage.detail?.balanceSnapshot}
            busy={busy === 'internal_settlement'}
            onFile={uploadSource}
          />
          <SourceUpload
            sourceId="merchants"
            title="دليل متاجر لمحة"
            done={!!stage.detail?.merchantSnapshot}
            busy={busy === 'merchants'}
            onFile={uploadSource}
          />
        </div>
      );
    }
    if (stage.id === 'lamha_collections') {
      if (!allowed) return <NoPermission/>;
      if (lamhaCollectionPreview) {
        return (
          <Card className="accounting-cycle-preview">
            <h3>معاينة تحصيل لمحة المجمّع</h3>
            <div className="accounting-cycle-preview__stats">
              <span><b>{lamhaCollectionPreview.stats.delivered.toLocaleString('en-US')}</b> صف تم توصيله</span>
              <span><b>{lamhaCollectionPreview.saveableCount.toLocaleString('en-US')}</b> مؤهل للحفظ</span>
              <span><b>{lamhaCollectionPreview.carrierCount.toLocaleString('en-US')}</b> شركة شحن</span>
              <span><b>{lamhaCollectionPreview.total.toLocaleString('en-US', { maximumFractionDigits: 2 })}</b> ر.س جاهزة</span>
              <span><b>{lamhaCollectionPreview.stats.unmapped.toLocaleString('en-US')}</b> بلا ناقل مطابق</span>
            </div>
            <div className="accounting-cycle-preview__range">
              سيُوزّع النظام كل صف تلقائيًا على شركة الشحن الموجودة في الملف، ويستبعد المرتجع والمبلغ الصفري والمكرر سابقًا.
            </div>
            {lamhaCollectionPreview.unmapped.length > 0 && (
              <div className="accounting-cycle-warning">
                شركات غير معرّفة لن تُحفظ: {lamhaCollectionPreview.unmapped.map(row => `${row.name} (${row.n})`).join(' · ')}
              </div>
            )}
            <div className="accounting-cycle-actions">
              <Btn variant="accent" onClick={saveLamhaCollections} disabled={busy === stage.id}>
                {busy === stage.id ? <Spinner size={14}/> : 'تأكيد توزيع وحفظ التحصيل'}
              </Btn>
              <Btn variant="ghost" onClick={() => setLamhaCollectionPreview(null)}>اختيار ملف آخر</Btn>
            </div>
          </Card>
        );
      }
      return (
        <div>
          <p className="accounting-cycle-help">ارفع ملف تحصيل لمحة المجمّع مرة واحدة. يقرأ النظام شركة الشحن من كل صف ويوزّع العمليات تلقائيًا على جميع الناقلين، مع معاينة قبل الحفظ ومنع التكرار.</p>
          <DropZone
            onFile={parseLamhaCollections}
            accept=".xlsx,.xls"
            title={busy === stage.id ? 'جارٍ فحص وتوزيع كل الصفوف…' : 'اختر ملف تحصيل لمحة المجمّع'}
            hint="شركة الشحن · حالة الطلب · المبلغ · رقم الشحنة"
          />
        </div>
      );
    }
    if (stage.id === 'carrier_collections') {
      const checklist = stage.detail?.carriers || [];
      const manualIds = new Set(checklist
        .filter(item => item.requiresManualUpload && item.status === 'pending')
        .map(item => String(item.carrierId)));
      const available = carriers.filter(carrier => REMITTANCE_PARSERS[carrier.id]
        && (!checklist.length || manualIds.has(String(carrier.id))));
      const selectedCarrierId = available.some(carrier => String(carrier.id) === String(carrierId))
        ? carrierId
        : (available[0]?.id || '');
      const selectedRequirement = checklist.find(item => String(item.carrierId) === String(selectedCarrierId)) || null;
      const missingCollectionSlots = (selectedRequirement?.missingSlots || []).filter(Boolean);
      const effectiveCollectionSlot = missingCollectionSlots.length === 1
        ? missingCollectionSlots[0]
        : collectionScheduleSlot;
      return (
        <div>
          <p className="accounting-cycle-help">كل دفعة أسبوعية تُحسب ملفًا مستقلًا. الفاتورة الشهرية لا تكمل التحصيل الأسبوعي، والملف الموحّد فقط هو الذي يثبت الفاتورة والتحصيل معًا.</p>
          <CarrierRequirementChecklist items={checklist} title="اكتمال تحصيلات الناقلين حسب الجدول" />
          {checklist.some(item => item.status === 'unclassified') && (
            <Btn variant="ghost" size="sm" onClick={() => navigate('/tasks')} style={{ marginBottom: 14 }}>
              ضبط جداول الفواتير والتحصيل
            </Btn>
          )}
          {available.length > 0 ? (
            <>
              <Select label="شركة الشحن" value={selectedCarrierId} onChange={event => {
                setCarrierId(event.target.value);
                setCollectionScheduleSlot('');
              }}>
                <option value="">اختر شركة الشحن…</option>
                {available.map(carrier => <option key={carrier.id} value={carrier.id}>{carrier.label || carrier.name || carrier.id}</option>)}
              </Select>
              {missingCollectionSlots.length > 0 && (
                <Select
                  label="موعد التحصيل الذي يغطيه الملف"
                  value={effectiveCollectionSlot}
                  onChange={event => setCollectionScheduleSlot(event.target.value)}
                  disabled={missingCollectionSlots.length === 1}
                >
                  {missingCollectionSlots.length > 1 && <option value="">اختر موعد التحصيل…</option>}
                  {missingCollectionSlots.map(dueDate => (
                    <option key={dueDate} value={dueDate}>{fmtScheduleDate(dueDate)}</option>
                  ))}
                </Select>
              )}
              <Btn
                variant="primary"
                icon={<Upload size={16}/>}
                onClick={() => openSettlement('in', selectedCarrierId, effectiveCollectionSlot || null)}
                disabled={!allowed || !selectedCarrierId || (missingCollectionSlots.length > 1 && !effectiveCollectionSlot)}
                style={{ marginTop: 14 }}
              >
                رفع ملف التحصيل المستلم من الناقل
              </Btn>
            </>
          ) : checklist.length > 0 ? (
            <div style={{ border: '1px solid color-mix(in srgb, var(--green) 35%, var(--border))', borderRadius: 10,
              padding: '10px 12px', color: checklist.every(item => ['uploaded', 'automatic', 'not_required'].includes(item.status)) ? 'var(--green)' : 'var(--gold)',
              background: 'var(--surface2)', fontSize: 12.5, fontWeight: 700 }}>
              {checklist.every(item => ['uploaded', 'automatic', 'not_required'].includes(item.status))
                ? 'لا توجد ملفات تحصيل ناقصة لهذا الشهر.'
                : 'لا يمكن الرفع الآن: أكمل إعداد طريقة التحصيل أو قارئ الملف للناقل الموضح أعلاه.'}
            </div>
          ) : (
            <div className="accounting-cycle-warning">لا توجد مراجعات معتمدة مرتبطة بناقل في هذا الشهر؛ أكمل مرحلة المراجعات أولًا.</div>
          )}
        </div>
      );
    }
    if (stage.id === 'period_close') {
      return (
        <StageAction
          title="إقفال دورة التشغيل"
          text={snapshot?.prerequisiteComplete
            ? 'تحققت المراحل الست من سجلات النظام. الإقفال يثبت اكتمال الدورة ولا ينشئ قيدًا محاسبيًا.'
            : 'لا يمكن الإقفال حتى تصبح المراحل الست السابقة مكتملة فعليًا.'}
          disabled={!allowed || !snapshot?.prerequisiteComplete || snapshot?.cycle?.status === 'closed' || busy === stage.id}
          button={snapshot?.cycle?.status === 'closed' ? 'الشهر مقفل' : 'تأكيد إقفال الشهر'}
          onClick={closePeriod}
          busy={busy === stage.id}
        />
      );
    }
    return null;
  };

  return (
    <div className="accounting-cycle-page">
      <PageHeader
        icon={<ClipboardCheck size={24}/>}
        title="دورة تشغيل المحاسب"
        subtitle="مسار شهري واحد: مراجعة الناقلين ← الأوزان ← لمحة ← التحصيل ← الإقفال"
        meta={loading
          ? 'جارٍ التحقق من سجلات الشهر…'
          : loadError
            ? 'تعذر تحديث حالة الدورة'
            : snapshot?.next
              ? `الإجراء التالي: ${snapshot.next.label}`
              : snapshot
                ? 'الدورة مكتملة'
                : 'اختر شهر العمل'}
        actions={
          <div className="accounting-cycle-header-actions">
            <label>
              <CalendarDays size={15}/>
              <input type="month" value={period} onChange={event => {
                setPeriod(event.target.value);
                setSnapshot(null);
                setLoadError('');
                setSelectedId('');
                setShipmentPreview(null);
                setLamhaCollectionPreview(null);
                setAuditDraft(null);
              }}/>
            </label>
            <Btn variant="ghost" size="sm" icon={<RefreshCw size={14}/>} onClick={refresh} disabled={loading}>تحديث حالة الدورة</Btn>
          </div>
        }
      />

      {loading && !snapshot ? (
        <Card className="accounting-cycle-loading"><Spinner size={24}/><span>جارٍ جمع حالة كل المراحل…</span></Card>
      ) : loadError && !snapshot ? (
        <Card className="accounting-cycle-warning accounting-cycle-action-card" role="alert">
          <strong>تعذر تحميل دورة {period}</strong>
          <span>{loadError}</span>
          <Btn variant="ghost" size="sm" icon={<RefreshCw size={14}/>} onClick={refresh}>إعادة المحاولة</Btn>
        </Card>
      ) : snapshot ? (
        <>
          {loadError && (
            <Card className="accounting-cycle-warning accounting-cycle-action-card" role="alert">
              <strong>تعذر تحديث البيانات؛ المعروض هو آخر تحميل ناجح.</strong>
              <span>{loadError}</span>
              <Btn variant="ghost" size="sm" icon={<RefreshCw size={14}/>} onClick={refresh}>إعادة المحاولة</Btn>
            </Card>
          )}
          {snapshot.sourceErrors?.length > 0 && (
            <Card className="accounting-cycle-warning accounting-cycle-action-card" role="alert">
              <strong>لم يتمكن النظام من التحقق من كل مصادر الشهر، لذلك الإقفال متوقف.</strong>
              <span>{snapshot.sourceErrors.map(error => `${error.label}: ${error.message}`).join(' · ')}</span>
              <Btn variant="ghost" size="sm" icon={<RefreshCw size={14}/>} onClick={refresh}>إعادة فحص المصادر</Btn>
            </Card>
          )}
          <Card className="accounting-cycle-summary">
            <div className="accounting-cycle-summary__copy">
              <span>تقدم دورة {period}</span>
              <strong>{snapshot.completed} من {snapshot.total} مراحل مكتملة</strong>
              <small>{snapshot.next ? `التالي: ${snapshot.next.label} — ${snapshot.next.reason}` : 'لا يوجد إجراء متبقٍ'}</small>
            </div>
            <div className="accounting-cycle-summary__progress" aria-label={`${percent}% مكتمل`}>
              <span style={{ width: `${percent}%` }}/>
            </div>
            <b className="accounting-cycle-summary__percent">{percent}%</b>
          </Card>

          <div className="accounting-cycle-layout">
            <div className="accounting-cycle-list">
              {snapshot.stages.map((stage, index) => (
                <div key={stage.id} className="accounting-cycle-stage-wrap">
                  <StageCard stage={stage} index={index} selected={selected?.id === stage.id} onSelect={() => selectStage(stage)}/>
                  {compactLayout && selected?.id === stage.id && (
                    <div className="accounting-cycle-detail accounting-cycle-detail--mobile">
                      {renderStage(stage)}
                      <StageHistory stage={stage} busy={String(busy || '').startsWith('weight_redownload:')} onRedownload={redownloadWeights}/>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {!compactLayout && <Card className="accounting-cycle-detail accounting-cycle-detail--desktop">
              {selected && (
                <>
                  <div className="accounting-cycle-detail__head">
                    <span>المرحلة {snapshot.stages.findIndex(stage => stage.id === selected.id) + 1}</span>
                    <h2>{selected.label}</h2>
                    <p>{selected.reason}</p>
                  </div>
                  {renderStage(selected)}
                  <StageHistory stage={selected} busy={String(busy || '').startsWith('weight_redownload:')} onRedownload={redownloadWeights}/>
                </>
              )}
            </Card>}
          </div>
        </>
      ) : null}

      {settlement && (
        <SettlementUploadModal
          direction={settlement.direction}
          carrier={settlement.carrier}
          userId={user?.id}
          onClose={() => setSettlement(null)}
          onDone={settlementDone}
          onError={settlementFailed}
        />
      )}
    </div>
  );
}

function StageAction({ title, text, button, onClick, disabled, busy }) {
  return (
    <div className="accounting-cycle-action-card">
      <h3>{title}</h3>
      <p>{text}</p>
      <Btn variant="primary" onClick={onClick} disabled={disabled}>
        {busy ? <><Spinner size={14}/> جارٍ التنفيذ…</> : button}
      </Btn>
    </div>
  );
}

function NoPermission() {
  return <div className="accounting-cycle-warning">لا تملك صلاحية تنفيذ هذه المرحلة. يمكنك رؤية حالتها فقط.</div>;
}

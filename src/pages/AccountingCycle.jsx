import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { exportPendingExcessWeights } from '../lib/weightBillingService.js';
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

function fmtDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ar-SA', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
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

export default function AccountingCycle({ carriers = [] }) {
  const { user, can } = useAuth();
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [snapshot, setSnapshot] = useState(null);
  const [selectedId, setSelectedId] = useState('carrier_audits');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [auditDraft, setAuditDraft] = useState(null);
  const [shipmentPreview, setShipmentPreview] = useState(null);
  const [settlement, setSettlement] = useState(null);
  const [carrierId, setCarrierId] = useState(() => carriers[0]?.id || '');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await loadAccountingCycle(period);
      setSnapshot(data);
      if (!selectedId && data.next) setSelectedId(data.next.id);
    } catch (error) {
      toast(`تعذر تحميل دورة المحاسب: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [period, selectedId]);

  useEffect(() => { refresh(); }, [period]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!carrierId && carriers[0]?.id) setCarrierId(carriers[0].id);
  }, [carrierId, carriers]);

  const selected = useMemo(
    () => snapshot?.stages?.find(stage => stage.id === selectedId) || snapshot?.stages?.[0] || null,
    [snapshot, selectedId],
  );
  const percent = snapshot ? Math.round((snapshot.completed / snapshot.total) * 100) : 0;

  const selectStage = stage => {
    setSelectedId(stage.id);
    setAuditDraft(null);
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
      await refresh();
    } catch (error) {
      toast(`فشل تصدير الأوزان: ${error.message}`, 'error');
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
      await refresh();
    } catch (error) {
      toast(`فشل حفظ شحنات لمحة: ${error.message}`, 'error');
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
      await refresh();
    } catch (error) {
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
      await refresh();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const openSettlement = direction => {
    if (!carrierId) {
      toast('اختر شركة الشحن أولًا', 'error');
      return;
    }
    setSettlement({ direction, carrier: carrierId });
  };

  const settlementDone = async result => {
    const stage = result.direction === 'in' ? 'carrier_collections' : 'lamha_collections';
    try {
      await recordAccountingCycleEvent({
        period,
        stage,
        eventType: 'settlement_uploaded',
        sourceKind: result.direction,
        fileName: result.fileNames?.join(' · ') || null,
        rowCount: result.savedCount,
        total: result.total,
        result: { carrier: result.carrier, skippedCount: result.skippedCount, fileCount: result.fileCount },
        userId: user?.id,
      });
    } catch (error) {
      console.warn('accounting cycle event failed:', error.message);
    }
    setSettlement(null);
    await refresh();
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
              <Btn variant="ghost" size="sm" onClick={() => { setAuditDraft(null); refresh(); }}>العودة للدورة</Btn>
            </div>
            <AuditResults audit={auditDraft} carriers={carriers} onNewAudit={() => setAuditDraft(null)}/>
          </div>
        );
      }
      return (
        <div className="accounting-cycle-embedded">
          <p className="accounting-cycle-help">ارفع فاتورة شركة الشحن، راجع نتيجة المطابقة، ثم اعتمدها من نفس المسار. تظهر حالة المرحلة تلقائيًا بعد الاعتماد.</p>
          {allowed ? <UploadWizard key={period} carriers={carriers} onComplete={setAuditDraft} initialPeriod={period}/> : <NoPermission/>}
        </div>
      );
    }
    if (stage.id === 'weight_export') {
      return (
        <StageAction
          title="ملف الأوزان الجاهز للرفع إلى لمحة"
          text="الملف يأخذ مراجعات هذا الشهر المعتمدة فقط، ويحتوي رقم الشحنة والوزن. بعد التنزيل لن تتكرر الشحنات في السحبة التالية."
          disabled={!allowed || busy === stage.id || stage.status === 'blocked'}
          button="تنزيل ملف الأوزان لهذه الفترة"
          onClick={exportWeights}
          busy={busy === stage.id}
        />
      );
    }
    if (stage.id === 'lamha_shipments') {
      return (
        <div>
          <p className="accounting-cycle-help">ارفع تصدير الطلبات من لمحة. ترتيب الأعمدة لا يهم؛ النظام يقرأ أسماء الأعمدة ويحفظ بيانات الطلب والمتجر والناقل والـAWB والتكلفة والتواريخ.</p>
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
    if (stage.id === 'carrier_collections' || stage.id === 'lamha_collections') {
      const isIn = stage.id === 'carrier_collections';
      const available = isIn
        ? carriers.filter(carrier => REMITTANCE_PARSERS[carrier.id])
        : carriers;
      return (
        <div>
          <p className="accounting-cycle-help">اختر الناقل أولًا، ثم ارفع ملفه. يمنع النظام تكرار رقم الشحنة بين الملفات ويعرض عدد المحفوظ والمتجاوز.</p>
          <Select label="شركة الشحن" value={carrierId} onChange={event => setCarrierId(event.target.value)}>
            <option value="">اختر شركة الشحن…</option>
            {available.map(carrier => <option key={carrier.id} value={carrier.id}>{carrier.label || carrier.name || carrier.id}</option>)}
          </Select>
          <Btn
            variant="primary"
            icon={<Upload size={16}/>}
            onClick={() => openSettlement(isIn ? 'in' : 'out')}
            disabled={!allowed || !carrierId}
            style={{ marginTop: 14 }}
          >
            {isIn ? 'رفع ملف التحصيل المستلم من الناقل' : 'رفع ملف التحصيل من لمحة'}
          </Btn>
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
        meta={snapshot?.next ? `الإجراء التالي: ${snapshot.next.label}` : 'الدورة مكتملة'}
        actions={
          <div className="accounting-cycle-header-actions">
            <label>
              <CalendarDays size={15}/>
              <input type="month" value={period} onChange={event => {
                setPeriod(event.target.value);
                setShipmentPreview(null);
                setAuditDraft(null);
              }}/>
            </label>
            <Btn variant="ghost" size="sm" icon={<RefreshCw size={14}/>} onClick={refresh} disabled={loading}>تحديث حالة الدورة</Btn>
          </div>
        }
      />

      {loading && !snapshot ? (
        <Card className="accounting-cycle-loading"><Spinner size={24}/><span>جارٍ جمع حالة كل المراحل…</span></Card>
      ) : snapshot ? (
        <>
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
                  {selected?.id === stage.id && <div className="accounting-cycle-detail accounting-cycle-detail--mobile">{renderStage(stage)}</div>}
                </div>
              ))}
            </div>
            <Card className="accounting-cycle-detail accounting-cycle-detail--desktop">
              {selected && (
                <>
                  <div className="accounting-cycle-detail__head">
                    <span>المرحلة {snapshot.stages.findIndex(stage => stage.id === selected.id) + 1}</span>
                    <h2>{selected.label}</h2>
                    <p>{selected.reason}</p>
                  </div>
                  {renderStage(selected)}
                </>
              )}
            </Card>
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

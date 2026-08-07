import { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertTriangle, BarChart3, CheckCircle2, Download, RefreshCw, UserRoundX,
} from 'lucide-react';
import { Btn, Card, Empty, PageHeader, Spinner, toast } from '../components/UI.jsx';
import { loadCollectionTeamPerformance } from '../lib/collectionsService.js';
import { rtl } from '../lib/xlsxRtl.js';
import './collection-team-performance.css';

const fmt = (n) => Number(n || 0).toLocaleString('en-US', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const fmtInt = (n) => Number(n || 0).toLocaleString('en-US');
const currentRiyadhMonth = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit',
}).format(new Date());

function Metric({ label, value, hint, tone = 'var(--accent3)' }) {
  return (
    <Card className="collection-performance__metric" style={{ '--metric-tone': tone }}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </Card>
  );
}

function CollectorCard({ row }) {
  const due = row.promisesDue;
  const keptRate = due ? Math.round((row.promisesKept / due) * 100) : null;
  const needsAttention = row.isUnassigned || row.promisesBroken > 0 || row.overduePromises > 0;
  return (
    <Card className={`collection-performance__collector${needsAttention ? ' is-warning' : ''}`}>
      <div className="collection-performance__collector-head">
        <div>
          <span className="collection-performance__eyebrow">
            {row.isUnassigned ? 'تحتاج توزيعاً' : 'محصّل'}
          </span>
          <h3>{row.collectorName}</h3>
        </div>
        <div className={`collection-performance__status${needsAttention ? ' is-warning' : ''}`}>
          {row.isUnassigned ? <UserRoundX size={16}/> : needsAttention ? <AlertTriangle size={16}/> : <CheckCircle2 size={16}/>}
          {row.isUnassigned ? 'غير مسند' : needsAttention ? 'تحتاج متابعة' : 'مستقر'}
        </div>
      </div>

      <div className="collection-performance__collector-grid">
        <div><span>المهام المفتوحة</span><b>{fmtInt(row.openTasks)}</b></div>
        <div><span>الدين تحت المتابعة</span><b>{fmt(row.openDebt)} ر.س</b></div>
        <div><span>المحصّل بعد وعد</span><b className="is-positive">{fmt(row.verifiedCollected)} ر.س</b></div>
        <div><span>أُنجز خلال الشهر</span><b>{fmtInt(row.completedInPeriod)}</b></div>
        <div><span>وعود مستحقة / ملتزمة</span><b>{fmtInt(row.promisesDue)} / {fmtInt(row.promisesKept)}</b></div>
        <div><span>نسبة الوفاء</span><b>{keptRate == null ? 'لا توجد وعود مستحقة' : `${keptRate}%`}</b></div>
        <div><span>وعود متأخرة الآن</span><b className={row.overduePromises ? 'is-negative' : ''}>{fmtInt(row.overduePromises)}</b></div>
        <div><span>متوسط عمر المهمة</span><b>{fmtInt(row.avgOpenAgeDays)} يوم</b></div>
      </div>
    </Card>
  );
}

export default function CollectionTeamPerformance({ isActive = true }) {
  const [period, setPeriod] = useState(currentRiyadhMonth);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await loadCollectionTeamPerformance(period));
    } catch (error) {
      setReport(null);
      toast(`تعذر تحميل أداء فريق التحصيل: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh]);

  const summary = report?.summary || {};
  const assignedRows = useMemo(
    () => (report?.rows || []).filter(row => !row.isUnassigned),
    [report],
  );
  const unassigned = useMemo(
    () => (report?.rows || []).find(row => row.isUnassigned),
    [report],
  );

  const exportReport = () => {
    if (!report?.rows?.length) return;
    const headers = [
      'المحصّل', 'مهام مفتوحة', 'الدين تحت المتابعة', 'مكتمل خلال الشهر',
      'وعود مسجلة', 'وعود مستحقة', 'وعود ملتزمة', 'وعود مكسورة',
      'وعود متأخرة الآن', 'تحصيل متحقق بعد وعد', 'نسبة تحقيق مبلغ الوعود %',
    ];
    const rows = report.rows.map(row => [
      row.collectorName, row.openTasks, row.openDebt, row.completedInPeriod,
      row.promisesMade, row.promisesDue, row.promisesKept, row.promisesBroken,
      row.overduePromises, row.verifiedCollected, row.promiseFulfillmentPct,
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...rows]), 'أداء التحصيل');
    XLSX.writeFile(rtl(wb), `أداء_فريق_التحصيل_${report.period}.xlsx`);
    toast('تم تصدير تقرير أداء فريق التحصيل', 'success');
  };

  if (loading) return <div className="collection-performance__loading"><Spinner size={28}/></div>;

  return (
    <div className="collection-performance">
      <PageHeader
        icon={<BarChart3 size={22}/>}
        iconColor="var(--accent3)"
        title="أداء فريق التحصيل"
        subtitle="قياس مالي للوعود والدفعات المتحققة، وليس عدد المكالمات فقط"
        meta={report?.generatedAt ? `آخر احتساب ${new Date(report.generatedAt).toLocaleString('ar-SA')}` : ''}
        actions={(
          <div className="collection-performance__actions">
            <label>
              <span>شهر التقرير</span>
              <input type="month" value={period} max={currentRiyadhMonth()} onChange={e => setPeriod(e.target.value)}/>
            </label>
            <Btn size="sm" variant="ghost" icon={<RefreshCw size={14}/>} onClick={refresh}>تحديث التقرير</Btn>
            <Btn size="sm" variant="outline" icon={<Download size={14}/>} onClick={exportReport} disabled={!report?.rows?.length}>تصدير التقرير</Btn>
          </div>
        )}
      />

      <div className="collection-performance__definition">
        <b>ما الذي يُحتسب؟</b>
        تُنسب دفعة Zoho إلى آخر وعد سداد مسجل للعميل قبل الدفعة، ولا تُحتسب الدفعة لأكثر من وعد أو موظف. المبالغ غير المرتبطة بوعد تبقى خارج تقييم الموظف.
      </div>

      <div className="collection-performance__metrics">
        <Metric label="تحصيل متحقق بعد وعد" value={`${fmt(summary.verifiedCollected)} ر.س`} hint="من دفعات Zoho خلال الشهر" tone="var(--green)"/>
        <Metric label="وعود مستحقة" value={fmtInt(summary.promisesDue)} hint={`${fmtInt(summary.promisesKept)} ملتزمة`} tone="var(--accent3)"/>
        <Metric label="نسبة تحقيق مبلغ الوعود" value={`${fmtInt(summary.promiseFulfillmentPct)}%`} hint="المبلغ المحصّل ÷ مبلغ الوعود" tone="var(--green)"/>
        <Metric label="وعود متأخرة الآن" value={fmtInt(summary.overduePromises)} hint={`${fmtInt(summary.promisesBroken)} مكسورة في الفترة`} tone="var(--red)"/>
        <Metric label="مهام غير مسندة" value={fmtInt(unassigned?.openTasks || 0)} hint={`${fmt(unassigned?.openDebt || 0)} ر.س تحتاج توزيعاً`} tone="var(--gold)"/>
      </div>

      {unassigned?.openTasks > 0 && (
        <div className="collection-performance__warning">
          <AlertTriangle size={18}/>
          <div><b>يوجد {fmtInt(unassigned.openTasks)} حسابًا بلا مسؤول.</b><span>لن تُنسب نتائجها لأي موظف حتى تُوزّع من قائمة التحصيل.</span></div>
        </div>
      )}

      <div className="collection-performance__section-head">
        <div><span>تفصيل الفريق</span><h2>النتيجة حسب المحصّل</h2></div>
        <small>{assignedRows.length} موظف في التقرير · الفترة {report?.period}</small>
      </div>

      {!report?.rows?.length ? (
        <Empty title="لا توجد بيانات أداء لهذا الشهر" sub="ابدأ بإسناد مهام التحصيل وتسجيل وعود السداد."/>
      ) : (
        <div className="collection-performance__collectors">
          {report.rows.map(row => <CollectorCard key={row.collectorId || 'unassigned'} row={row}/>)}
        </div>
      )}
    </div>
  );
}

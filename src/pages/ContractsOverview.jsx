// Single page that shows every carrier's contracts in one table, plus
// a contract-change history feed underneath. Built for screenshotting
// and sharing with management / accounting partners.

import { useState, useEffect, useCallback } from 'react';
import {
  FileSpreadsheet, RefreshCw, Printer, Clock, History, ArrowUpRight,
  ArrowDownRight, CheckCircle2, Calendar, Plus, Trash2, Edit3, FileText,
  AlertTriangle, ShieldCheck,
} from 'lucide-react';
import { Card, Btn, Spinner, Empty, toast, PageHeader } from '../components/UI.jsx';
import { ClipboardList } from 'lucide-react';
import {
  loadAllContractsOverview,
  loadContractHistory,
  loadContractReadiness,
} from '../lib/contractHistoryService.js';
import * as XLSX from 'xlsx';
import { rtl } from '../lib/xlsxRtl.js';

const fmt = (v, suffix = '') => {
  if (v == null || v === '') return '—';
  if (typeof v === 'number') return `${v.toLocaleString('en-US')} ${suffix}`.trim();
  return v;
};
const pct = (v) => v == null ? '—' : `${(v * 100).toFixed(1)}%`;
const fmtDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' });
  } catch { return iso; }
};
const fmtDateOnly = (iso) => iso || '—';

const ACTION_META = {
  created:  { color: 'var(--green)',  bg: 'color-mix(in srgb, var(--accent) 10%, transparent)',  Icon: Plus,    label: 'إضافة' },
  updated:  { color: 'var(--gold)',   bg: 'rgba(251,191,36,.10)',  Icon: Edit3,   label: 'تعديل' },
  deleted:  { color: 'var(--red)',    bg: 'rgba(248,113,113,.10)', Icon: Trash2,  label: 'حذف'   },
};

const FIELD_AR = {
  label:        'التسمية',
  startDate:    'تاريخ البداية',
  endDate:      'تاريخ النهاية',
  rss:          'RSS',
  rssFixed:     'RSS ثابت',
  rssStartDate: 'بداية RSS',
  rssEndDate:   'نهاية RSS',
  fuelPct:      'نسبة الوقود',
  fuelBase:     'أساس الوقود',
  fuelStartDate:'بداية الوقود',
  fuelEndDate:  'نهاية الوقود',
  fuelHistory:  'تاريخ الوقود',
  codFee:       'رسوم COD',
  pricing:      'التسعير',
  notes:        'ملاحظات',
};

function renderValue(v) {
  if (v == null) return <span style={{ color: 'var(--muted)' }}>—</span>;
  if (typeof v === 'number') return <span style={{ fontFamily: 'var(--font-mono)' }}>{v}</span>;
  if (typeof v === 'string') return v;
  // Objects / arrays — show abbreviated JSON
  const s = JSON.stringify(v);
  return <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{s.length > 60 ? s.slice(0, 60) + '…' : s}</span>;
}

export default function ContractsOverview({ isActive = true }) {
  const [rows,     setRows]    = useState([]);
  const [history,  setHistory] = useState([]);
  const [readiness, setReadiness] = useState([]);
  const [loading,  setLoading] = useState(true);
  const [expandedRow, setExpandedRow] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [r, h, ready] = await Promise.all([
        loadAllContractsOverview(),
        loadContractHistory({ limit: 80 }),
        loadContractReadiness(),
      ]);
      setRows(r);
      setHistory(h);
      setReadiness(ready);
    } catch (e) {
      toast(`فشل التحميل: ${e.message}`, 'error');
    }
    setLoading(false);
  }, []);

  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh]);

  const handleExport = () => {
    if (!rows.length) { toast('ما فيه عقود للتصدير', 'info'); return; }
    const data = rows.map(r => ({
      'الشركة':            r.carrierName,
      'العقد':              r.contractLabel,
      'بداية العقد':        r.startDate || '—',
      'نهاية العقد':        r.endDate || 'مفتوح',
      'الحد الأساسي (كغ)':  r.baseUpTo ?? '—',
      'السعر الأساسي (ر.س)': r.basePrice ?? '—',
      'الكيلو الزائد (ر.س)': r.excessPerKg != null ? `${r.excessPerKg} / ${r.excessUnit}كغ` : '—',
      'الوقود':              r.fuelPct != null ? `${(r.fuelPct * 100).toFixed(1)}%` : '—',
      'رسوم أمنية %':                r.rssPct != null ? `${(r.rssPct * 100).toFixed(1)}%` : '—',
      'رسوم COD':           r.codFee ?? '—',
      'الوجهات':            r.destinations.length,
      'ساري':                r.isActive ? '✓' : '—',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'العقود');
    XLSX.writeFile(rtl(wb), `جدول_العقود_${new Date().toISOString().slice(0,10)}.xlsx`);
    toast('تم تصدير الجدول', 'success');
  };

  const handlePrint = () => window.print();
  const missingContracts = readiness.filter(row => !row.hasContract);
  const missingFileKinds = readiness.filter(row => !row.hasFileKind);
  const missingDocuments = readiness.filter(row => !row.hasOfficialDocument);
  const configuredCount = readiness.filter(row => row.operationallyConfigured).length;

  return (
    <div style={{ padding: '24px 28px 80px', maxWidth: 1320, margin: '0 auto' }}>
      <PageHeader
        icon={<ClipboardList size={22}/>}
        title="جدول عقود شركات الشحن"
        subtitle="نظرة شاملة على شروط التسعير والرسوم لكل شركة — جاهزة للطباعة أو التصدير"
        actions={
          <>
            <Btn size="md" variant="ghost" icon={<RefreshCw size={14} className={loading ? 'spin' : ''}/>} onClick={refresh} disabled={loading}>تحديث بيانات العقود</Btn>
            <Btn size="md" variant="ghost" icon={<FileSpreadsheet size={14}/>} onClick={handleExport}>Excel</Btn>
            <Btn size="md" variant="primary" icon={<Printer size={14}/>} onClick={handlePrint}>طباعة</Btn>
          </>
        }
      />

      <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 22 }}>
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, color: 'var(--text)' }}>
              <ShieldCheck size={18} color="var(--accent)"/> جاهزية عقود النصف الثاني 2026
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
              الجاهزية هنا تعني وجود عقد ساري ونوع ملف معروف؛ اعتماد الفاتورة يبقى مشروطاً بفحص ملف يوليو نفسه.
            </div>
          </div>
          <span style={{ fontSize: 12, color: configuredCount === readiness.length ? 'var(--green)' : 'var(--gold)', fontWeight: 800 }}>
            {loading ? 'جارٍ فحص الجاهزية…' : `${configuredCount} من ${readiness.length} مهيأة تشغيلياً`}
          </span>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 34 }}><Spinner size={24}/></div>
        ) : <div style={{ padding: 18 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 10 }}>
            {[
              ['إجمالي الشركات', readiness.length, 'var(--text)'],
              ['عقد وتشغيل مسجل', configuredCount, 'var(--green)'],
              ['بلا عقد ساري', missingContracts.length, missingContracts.length ? 'var(--red)' : 'var(--green)'],
              ['مستند عقد رسمي', readiness.length - missingDocuments.length, missingDocuments.length ? 'var(--gold)' : 'var(--green)'],
            ].map(([label, value, color]) => (
              <div key={label} style={{ padding: '13px 14px', border: '1px solid var(--border2)', borderRadius: 12, background: 'var(--surface2)' }}>
                <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{label}</div>
                <div style={{ marginTop: 4, fontSize: 23, fontWeight: 850, color, fontFamily: 'var(--font-mono)' }}>{value}</div>
              </div>
            ))}
          </div>

          {(missingContracts.length > 0 || missingFileKinds.length > 0 || missingDocuments.length > 0) && (
            <div style={{ marginTop: 14, padding: '13px 15px', borderRadius: 12, border: '1px solid rgba(245,158,11,.28)', background: 'rgba(245,158,11,.07)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 800, color: 'var(--gold)', fontSize: 13 }}>
                <AlertTriangle size={16}/> نواقص يجب إغلاقها
              </div>
              {missingContracts.length > 0 && (
                <div style={{ marginTop: 7, fontSize: 12.5, color: 'var(--text2)' }}>
                  <strong>بلا عقد:</strong> {missingContracts.map(row => row.carrierName).join('، ')}
                </div>
              )}
              {missingFileKinds.length > 0 && (
                <div style={{ marginTop: 5, fontSize: 12.5, color: 'var(--text2)' }}>
                  <strong>نوع الملف غير محدد:</strong> {missingFileKinds.map(row => row.carrierName).join('، ')}
                </div>
              )}
              {missingDocuments.length > 0 && (
                <div style={{ marginTop: 5, fontSize: 12.5, color: 'var(--text2)' }}>
                  لا توجد نسخة عقد رسمية مرفوعة لـ{missingDocuments.length} شركة؛ التسعير المسجل يعمل، لكن الإثبات التعاقدي غير مكتمل.
                </div>
              )}
            </div>
          )}
        </div>}
      </Card>

      {/* ── CONTRACTS TABLE ───────────────────────────────────────────── */}
      <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 22 }}>
        <div style={{
          padding: '14px 20px', borderBottom: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8,
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
            <FileText size={15} color="var(--accent)"/> العقود ({rows.length})
          </span>
          <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
            {rows.filter(r => r.isActive).length} ساري · {rows.length - rows.filter(r => r.isActive).length} منتهي
          </span>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner size={26}/></div>
        ) : rows.length === 0 ? (
          <Empty icon="📄" title="ما فيه عقود مسجّلة" sub="أضف عقد من صفحة شركات الشحن"/>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="m-cards contracts-overview-table">
              <thead>
                <tr>
                  <th style={{ minWidth: 160 }}>الشركة</th>
                  <th style={{ minWidth: 140 }}>العقد</th>
                  <th style={{ minWidth: 110 }}>الفترة</th>
                  <th style={{ minWidth: 110, background: 'color-mix(in srgb, var(--accent) 6%, transparent)' }}>الحد الأساسي</th>
                  <th style={{ minWidth: 110, background: 'color-mix(in srgb, var(--accent) 6%, transparent)' }}>السعر الأساسي</th>
                  <th style={{ minWidth: 130, background: 'rgba(251,191,36,.06)' }}>كل كيلو زائد</th>
                  <th style={{ minWidth: 80,  background: 'rgba(58,173,120,.06)' }}>الوقود</th>
                  <th style={{ minWidth: 80,  background: 'rgba(168,85,247,.06)' }}>رسوم أمنية %</th>
                  <th style={{ minWidth: 90,  background: 'color-mix(in srgb, var(--accent) 6%, transparent)' }}>رسوم COD</th>
                  <th style={{ minWidth: 80 }}>الوجهات</th>
                  <th style={{ minWidth: 70 }}>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr key={`${r.carrierId}-${r.contractId}`} style={{ background: idx % 2 === 0 ? 'transparent' : 'var(--surface2)' }}>
                    <td data-label="">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <span style={{ fontSize: 18 }}>{r.carrierLogo}</span>
                        <span style={{ fontWeight: 700, color: 'var(--text)' }}>{r.carrierName}</span>
                      </div>
                    </td>
                    <td data-label="العقد" style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--accent)' }}>
                      {r.contractLabel}
                    </td>
                    <td data-label="الفترة" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                      {fmtDateOnly(r.startDate)}
                      <br/>
                      <span style={{ opacity: .6 }}>→ {r.endDate || 'مفتوح'}</span>
                    </td>
                    <td data-label="الحد الأساسي" style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{fmt(r.baseUpTo, 'كغ')}</td>
                    <td data-label="السعر الأساسي" style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent)' }}>{fmt(r.basePrice, 'ر.س')}</td>
                    <td data-label="كل كيلو زائد" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--gold)', fontWeight: 600 }}>
                      {r.excessPerKg != null ? `${r.excessPerKg} ر.س / ${r.excessUnit}كغ` : '—'}
                    </td>
                    <td data-label="الوقود" style={{ fontFamily: 'var(--font-mono)', color: 'var(--green)' }}>{pct(r.fuelPct)}</td>
                    <td data-label="رسوم أمنية" style={{ fontFamily: 'var(--font-mono)', color: 'var(--purple)' }}>{pct(r.rssPct)}</td>
                    <td data-label="رسوم COD" style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{fmt(r.codFee, 'ر.س')}</td>
                    <td data-label="الوجهات" style={{ fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>{r.destinations.length}</td>
                    <td data-label="الحالة">
                      {r.isActive ? (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          padding: '2px 9px', borderRadius: 12,
                          background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
                          border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
                          color: 'var(--accent)', fontSize: 10.5, fontWeight: 700,
                        }}>
                          <CheckCircle2 size={10}/> ساري
                        </span>
                      ) : (
                        <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── CHANGE HISTORY ────────────────────────────────────────────── */}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{
          padding: '14px 20px', borderBottom: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
            <History size={15} color="var(--accent)"/> سجل تغييرات العقود
          </span>
          <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
            آخر {history.length} تغيير
          </span>
        </div>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner size={26}/></div>
        ) : history.length === 0 ? (
          <Empty icon="📭" title="ما فيه تغييرات بعد" sub="أي إضافة أو تعديل لعقد يُسجَّل هنا تلقائياً"/>
        ) : (
          <div style={{ maxHeight: 600, overflowY: 'auto' }}>
            {history.map(h => {
              const meta = ACTION_META[h.action] || ACTION_META.updated;
              const Icon = meta.Icon;
              const carrier = rows.find(r => r.carrierId === h.carrier_id);
              const isExpanded = expandedRow === h.id;
              return (
                <div key={h.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <button
                    onClick={() => setExpandedRow(isExpanded ? null : h.id)}
                    style={{
                      width: '100%', background: 'transparent', border: 'none',
                      padding: '14px 20px', cursor: 'pointer', textAlign: 'right',
                      display: 'grid', gridTemplateColumns: 'auto 1fr auto auto', gap: 14, alignItems: 'center',
                    }}>
                    <div style={{
                      width: 34, height: 34, borderRadius: 9,
                      background: meta.bg, border: `1px solid ${meta.color}40`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      <Icon size={15} color={meta.color}/>
                    </div>
                    <div style={{ minWidth: 0, textAlign: 'right' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                        {meta.label} عقد — <span style={{ color: 'var(--accent)' }}>{h.contract_label || h.contract_id}</span>
                        <span style={{ color: 'var(--muted)', fontWeight: 500, marginInlineStart: 6 }}>
                          · {carrier?.carrierName || h.carrier_id}
                        </span>
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Clock size={10}/> {fmtDate(h.changed_at)}
                        </span>
                        {h.fields_changed?.length > 0 && (
                          <span>
                            <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{h.fields_changed.length}</span> حقل تغيّر
                            {!isExpanded && ': '}
                            {!isExpanded && (
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>
                                {h.fields_changed.slice(0, 3).map(f => FIELD_AR[f] || f).join('، ')}
                                {h.fields_changed.length > 3 && ` +${h.fields_changed.length - 3}`}
                              </span>
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                    <span style={{
                      padding: '3px 9px', borderRadius: 12,
                      background: meta.bg, color: meta.color, border: `1px solid ${meta.color}40`,
                      fontSize: 10.5, fontWeight: 700, fontFamily: 'var(--font-sans)',
                    }}>{meta.label}</span>
                    {isExpanded ? <ArrowDownRight size={14} color="var(--muted)"/> : <ArrowUpRight size={14} color="var(--muted)"/>}
                  </button>

                  {isExpanded && h.changes?.fields && (
                    <div style={{
                      padding: '0 20px 16px',
                      background: 'var(--surface)',
                      borderTop: '1px solid var(--border)',
                    }}>
                      <table className="m-cards" style={{ marginTop: 12 }}>
                        <thead>
                          <tr>
                            <th style={{ minWidth: 130 }}>الحقل</th>
                            <th style={{ minWidth: 200, background: 'rgba(248,113,113,.05)' }}>قبل</th>
                            <th style={{ minWidth: 200, background: 'color-mix(in srgb, var(--accent) 5%, transparent)' }}>بعد</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(h.changes.fields).map(([field, { before, after }]) => (
                            <tr key={field}>
                              <td data-label="" style={{ fontWeight: 600, color: 'var(--text)' }}>
                                {FIELD_AR[field] || field}
                              </td>
                              <td data-label="قبل" style={{ background: 'rgba(248,113,113,.03)' }}>{renderValue(before)}</td>
                              <td data-label="بعد" style={{ background: 'color-mix(in srgb, var(--accent) 3%, transparent)' }}>{renderValue(after)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

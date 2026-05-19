// Single page that shows every carrier's contracts in one table, plus
// a contract-change history feed underneath. Built for screenshotting
// and sharing with management / accounting partners.

import { useState, useEffect, useCallback } from 'react';
import {
  FileSpreadsheet, RefreshCw, Printer, Clock, History, ArrowUpRight,
  ArrowDownRight, CheckCircle2, Calendar, Plus, Trash2, Edit3, FileText,
} from 'lucide-react';
import { Card, Btn, Spinner, Empty, toast } from '../components/UI.jsx';
import { loadAllContractsOverview, loadContractHistory } from '../lib/contractHistoryService.js';
import * as XLSX from 'xlsx';

const fmt = (v, suffix = '') => {
  if (v == null || v === '') return '—';
  if (typeof v === 'number') return `${v.toLocaleString('ar-SA')} ${suffix}`.trim();
  return v;
};
const pct = (v) => v == null ? '—' : `${(v * 100).toFixed(1)}%`;
const fmtDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ar-SA', { dateStyle: 'short', timeStyle: 'short' });
  } catch { return iso; }
};
const fmtDateOnly = (iso) => iso || '—';

const ACTION_META = {
  created:  { color: 'var(--green)',  bg: 'rgba(45,212,191,.10)',  Icon: Plus,    label: 'إضافة' },
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
  const [loading,  setLoading] = useState(true);
  const [expandedRow, setExpandedRow] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [r, h] = await Promise.all([
        loadAllContractsOverview(),
        loadContractHistory({ limit: 80 }),
      ]);
      setRows(r);
      setHistory(h);
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
      'RSS':                r.rssPct != null ? `${(r.rssPct * 100).toFixed(1)}%` : '—',
      'رسوم COD':           r.codFee ?? '—',
      'الوجهات':            r.destinations.length,
      'ساري':                r.isActive ? '✓' : '—',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'العقود');
    XLSX.writeFile(wb, `جدول_العقود_${new Date().toISOString().slice(0,10)}.xlsx`);
    toast('تم تصدير الجدول', 'success');
  };

  const handlePrint = () => window.print();

  return (
    <div style={{ padding: '32px 40px 80px', maxWidth: 1440 }}>
      {/* ── HERO ──────────────────────────────────────────────────────── */}
      <div style={{
        position: 'relative',
        padding: '22px 28px',
        marginBottom: 22,
        borderRadius: 'var(--r-lg)',
        background: '#0A0A0B',
        color: '#fff',
        overflow: 'hidden',
        boxShadow: '0 16px 40px rgba(0,0,0,.18), 0 4px 12px rgba(0,0,0,.06)',
      }}>
        <div style={{ position: 'absolute', left: -40, top: -40, width: 220, height: 220, opacity: .08, pointerEvents: 'none' }}>
          <svg viewBox="0 0 64 64" fill="none">
            <path d="M32 6 L54 18 L54 46 L32 58 L10 46 L10 18 Z" fill="#fff"/>
          </svg>
        </div>
        <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 14 }}>
          <div>
            <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', letterSpacing: 3, textTransform: 'uppercase', opacity: .7, marginBottom: 8 }}>
              LAMHA · CONTRACTS OVERVIEW
            </div>
            <h1 style={{ fontFamily: 'var(--font-sans)', fontSize: 24, fontWeight: 800, color: '#fff', marginBottom: 6, lineHeight: 1.2 }}>
              جدول عقود شركات الشحن
            </h1>
            <p style={{ color: 'rgba(255,255,255,.78)', fontSize: 13, margin: 0 }}>
              نظرة شاملة على شروط التسعير والرسوم لكل شركة — جاهزة للطباعة أو التصدير.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={refresh} disabled={loading} style={{
              background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.22)',
              color: '#fff', padding: '8px 16px', borderRadius: 9, fontSize: 12, fontWeight: 600,
              cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
              fontFamily: 'var(--font-sans)', backdropFilter: 'blur(6px)',
            }}>
              <RefreshCw size={13} className={loading ? 'spin' : ''}/> تحديث
            </button>
            <button onClick={handleExport} style={{
              background: 'rgba(255,255,255,.18)', border: '1px solid rgba(255,255,255,.28)',
              color: '#fff', padding: '8px 16px', borderRadius: 9, fontSize: 12, fontWeight: 600,
              cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
              fontFamily: 'var(--font-sans)',
            }}>
              <FileSpreadsheet size={13}/> Excel
            </button>
            <button onClick={handlePrint} style={{
              background: 'rgba(255,255,255,.18)', border: '1px solid rgba(255,255,255,.28)',
              color: '#fff', padding: '8px 16px', borderRadius: 9, fontSize: 12, fontWeight: 600,
              cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
              fontFamily: 'var(--font-sans)',
            }}>
              <Printer size={13}/> طباعة
            </button>
          </div>
        </div>
      </div>

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
            <table>
              <thead>
                <tr>
                  <th style={{ minWidth: 160 }}>الشركة</th>
                  <th style={{ minWidth: 140 }}>العقد</th>
                  <th style={{ minWidth: 110 }}>الفترة</th>
                  <th style={{ minWidth: 110, background: 'rgba(45,212,191,.06)' }}>الحد الأساسي</th>
                  <th style={{ minWidth: 110, background: 'rgba(45,212,191,.06)' }}>السعر الأساسي</th>
                  <th style={{ minWidth: 130, background: 'rgba(251,191,36,.06)' }}>كل كيلو زائد</th>
                  <th style={{ minWidth: 80,  background: 'rgba(58,173,120,.06)' }}>الوقود</th>
                  <th style={{ minWidth: 80,  background: 'rgba(168,85,247,.06)' }}>RSS</th>
                  <th style={{ minWidth: 90,  background: 'rgba(45,212,191,.06)' }}>رسوم COD</th>
                  <th style={{ minWidth: 80 }}>الوجهات</th>
                  <th style={{ minWidth: 70 }}>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr key={`${r.carrierId}-${r.contractId}`} style={{ background: idx % 2 === 0 ? 'transparent' : 'var(--surface2)' }}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <span style={{ fontSize: 18 }}>{r.carrierLogo}</span>
                        <span style={{ fontWeight: 700, color: 'var(--text)' }}>{r.carrierName}</span>
                      </div>
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--accent)' }}>
                      {r.contractLabel}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                      {fmtDateOnly(r.startDate)}
                      <br/>
                      <span style={{ opacity: .6 }}>→ {r.endDate || 'مفتوح'}</span>
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{fmt(r.baseUpTo, 'كغ')}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent)' }}>{fmt(r.basePrice, 'ر.س')}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--gold)', fontWeight: 600 }}>
                      {r.excessPerKg != null ? `${r.excessPerKg} ر.س / ${r.excessUnit}كغ` : '—'}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--green)' }}>{pct(r.fuelPct)}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--purple)' }}>{pct(r.rssPct)}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{fmt(r.codFee, 'ر.س')}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>{r.destinations.length}</td>
                    <td>
                      {r.isActive ? (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          padding: '2px 9px', borderRadius: 12,
                          background: 'rgba(45,212,191,.10)',
                          border: '1px solid rgba(45,212,191,.30)',
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
                      <table style={{ marginTop: 12 }}>
                        <thead>
                          <tr>
                            <th style={{ minWidth: 130 }}>الحقل</th>
                            <th style={{ minWidth: 200, background: 'rgba(248,113,113,.05)' }}>قبل</th>
                            <th style={{ minWidth: 200, background: 'rgba(45,212,191,.05)' }}>بعد</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(h.changes.fields).map(([field, { before, after }]) => (
                            <tr key={field}>
                              <td style={{ fontWeight: 600, color: 'var(--text)' }}>
                                {FIELD_AR[field] || field}
                              </td>
                              <td style={{ background: 'rgba(248,113,113,.03)' }}>{renderValue(before)}</td>
                              <td style={{ background: 'rgba(45,212,191,.03)' }}>{renderValue(after)}</td>
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

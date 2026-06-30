// FulfillmentAudit.jsx — تدقيق فواتير شركاء التجهيز/التخزين (3PL).
//
// ارفع فاتورة المورّد (ديسباتش) → النظام يعدّ الطلبات، يحسب المتوقّع من عقد
// المتجر (سعر per-order)، يقارنه بالمفوتر، ويكشف التكرار. مسار منفصل عن
// تدقيق الشحن. MVP: ديسباتش (رسم تجهيز ثابت لكل متجر، تخزين مجاني).

import { useState, useEffect, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { Boxes, Upload, RefreshCw, Trash2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Card, Btn, Select, Empty, Spinner, toast, PageHeader, DropZone, Badge } from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  loadWarehouses, parseDispatchInvoice, auditFulfillmentInvoice,
  saveFulfillmentInvoice, loadFulfillmentInvoices, deleteFulfillmentInvoice,
} from '../lib/fulfillmentService.js';

const fmt = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function FulfillmentAudit({ isActive = true }) {
  const { user, can } = useAuth();
  const [warehouses, setWarehouses] = useState([]);
  const [warehouse, setWarehouse] = useState('dispatch');
  const [audit, setAudit] = useState(null);     // نتيجة التدقيق الحالية
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [invoices, setInvoices] = useState([]);

  const refresh = useCallback(async () => {
    try {
      const [wh, inv] = await Promise.all([loadWarehouses().catch(() => []), loadFulfillmentInvoices().catch(() => [])]);
      setWarehouses(wh); setInvoices(inv);
      if (wh.length && !wh.find((w) => w.id === warehouse)) setWarehouse(wh[0].id);
    } catch (e) { toast(e.message, 'error'); }
  }, [warehouse]);
  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh]);

  const onFile = async (file) => {
    setBusy(true); setAudit(null);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const parsed = parseDispatchInvoice(wb);
      const res = await auditFulfillmentInvoice({ warehouseId: warehouse, parsed, fileName: file.name });
      setAudit({ ...res, parsed, fileName: file.name });
    } catch (e) { toast(`فشل التحليل: ${e.message}`, 'error'); }
    setBusy(false);
  };

  const save = async () => {
    if (!audit) return;
    setSaving(true);
    try {
      await saveFulfillmentInvoice({ warehouseId: warehouse, parsed: audit.parsed, audit, fileName: audit.fileName, userId: user?.id });
      toast('حُفظت الفاتورة', 'success'); setAudit(null); refresh();
    } catch (e) { toast(`فشل الحفظ: ${e.message}`, 'error'); }
    setSaving(false);
  };

  if (!can('audits.view')) return <Pad><Empty icon="🔒" title="لا صلاحية"/></Pad>;

  return (
    <Pad>
      <PageHeader icon={<Boxes size={22}/>} title="تدقيق فواتير التجهيز (3PL)"
        subtitle="ارفع فاتورة المورّد → عدّ الطلبات × سعر المتجر مقابل المفوتر + كشف التكرار"
        actions={
          <Select value={warehouse} onChange={(e) => setWarehouse(e.target.value)} style={{ minWidth: 160 }}>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
        }/>

      <Card style={{ marginBottom: 16, borderRight: '3px solid #8B5CF6' }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>📦 رفع فاتورة {warehouses.find((w) => w.id === warehouse)?.name || ''}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
          ملف Excel بأوراق SHIPPING/SUMMARY (صيغة ديسباتش). يُكتشف المتجر تلقائياً ويُقارَن بعقده.
        </div>
        {busy ? <div style={{ padding: 24, textAlign: 'center' }}><Spinner/></div>
          : <DropZone onFile={onFile} title="اختر فاتورة المورّد" hint="SHIPPING = الطلبات · SUMMARY = المفوتر"/>}
      </Card>

      {audit && <AuditResult audit={audit} onSave={save} saving={saving} canSave={can('audits.create')}/>}

      {/* الفواتير المحفوظة */}
      <div style={{ fontSize: 13, fontWeight: 700, margin: '20px 0 10px' }}>الفواتير المحفوظة</div>
      {!invoices.length ? <Empty icon="🗂" title="لا فواتير بعد"/> : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <table className="m-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ background: 'var(--surface2)', textAlign: 'right' }}>
              {['المتجر', 'الفترة', 'طلبات', 'المفوتر', 'الفرق', 'تكرار', ''].map((h) => <th key={h} style={{ padding: '9px 12px', fontSize: 11.5, color: 'var(--muted)' }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {invoices.map((v) => (
                <tr key={v.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td data-label="المتجر" style={{ padding: '9px 12px', fontWeight: 600 }}>{v.store_name}</td>
                  <td data-label="الفترة" style={{ padding: '9px 12px' }}>{v.period || '—'}</td>
                  <td data-label="طلبات" style={{ padding: '9px 12px' }}>{v.order_count}</td>
                  <td data-label="المفوتر" style={{ padding: '9px 12px', fontFamily: 'var(--font-mono)' }}>{fmt(v.total_invoiced)}</td>
                  <td data-label="الفرق" style={{ padding: '9px 12px', fontFamily: 'var(--font-mono)', color: Math.abs(v.drift || 0) > 0.5 ? '#DC2626' : '#10B981' }}>{fmt(v.drift)}</td>
                  <td data-label="تكرار" style={{ padding: '9px 12px', color: v.dup_count ? '#DC2626' : 'var(--muted)' }}>{v.dup_count || 0}</td>
                  <td style={{ padding: '9px 12px' }}>
                    {can('audits.delete') && <Btn size="sm" variant="danger" icon={<Trash2 size={13}/>} title="حذف"
                      onClick={async () => { if (!confirm(`حذف فاتورة ${v.store_name}؟`)) return; await deleteFulfillmentInvoice(v.id); refresh(); }}/>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </Pad>
  );
}

function AuditResult({ audit, onSave, saving, canSave }) {
  const matched = audit.diff != null && Math.abs(audit.diff) <= 0.5;
  return (
    <Card style={{ marginBottom: 16, borderRight: `3px solid ${audit.missingContract ? '#F59E0B' : matched ? '#10B981' : '#DC2626'}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{audit.store || 'متجر غير معروف'} · {audit.period || '—'}</div>
          {audit.missingContract && <div style={{ color: '#B45309', fontSize: 12, marginTop: 4 }}>⚠️ لا عقد لهذا المتجر — أضِف سعره أولاً</div>}
        </div>
        {canSave && !audit.missingContract && <Btn variant="accent" disabled={saving} onClick={onSave}>{saving ? 'جارٍ الحفظ…' : 'حفظ الفاتورة'}</Btn>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginTop: 14 }}>
        <Stat label="الطلبات" value={audit.orders}/>
        <Stat label="سعر الطلب" value={audit.rate != null ? `${fmt(audit.rate)} ر.س` : '—'}/>
        <Stat label="المتوقّع (+ضريبة)" value={`${fmt(audit.expectedWithVat)} ر.س`} color="#10B981"/>
        <Stat label="المفوتر" value={audit.billed != null ? `${fmt(audit.billed)} ر.س` : '—'}/>
        <Stat label="الفرق" value={audit.diff != null ? `${fmt(audit.diff)} ر.س` : '—'} color={matched ? '#10B981' : '#DC2626'}/>
        <Stat label="تكرار" value={audit.dupCount} color={audit.dupCount ? '#DC2626' : undefined}/>
      </div>

      <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {matched
          ? <span style={{ color: '#10B981', fontSize: 13, fontWeight: 600 }}><CheckCircle2 size={14} style={{ verticalAlign: -2 }}/> مطابق — الحساب صحيح</span>
          : audit.diff != null && <span style={{ color: '#DC2626', fontSize: 13, fontWeight: 600 }}><AlertTriangle size={14} style={{ verticalAlign: -2 }}/> فرق {fmt(audit.diff)} ر.س — راجع</span>}
        <span style={{ marginInlineStart: 'auto', fontSize: 12, color: 'var(--muted)' }}>
          الحالات: {Object.entries(audit.byStatus).map(([k, v]) => `${k}: ${v}`).join(' · ')}
        </span>
      </div>

      {/* تنبيه المرتجعات — معلوماتي (يُفوتَر على كل مُجهَّز حسب العقد) */}
      {(() => {
        const ret = Object.entries(audit.byStatus).filter(([k]) => /return/i.test(k)).reduce((s, [, v]) => s + v, 0);
        return ret > 0 ? (
          <div style={{ background: '#F59E0B12', color: '#B45309', borderRadius: 8, padding: '8px 12px', fontSize: 12, marginTop: 10 }}>
            ℹ️ {ret} طلب مرتجع مُفوتَر (رسم التجهيز يُحتسب على كل مُجهَّز حسب عقدك — هذا متوقّع، لا خطأ).
          </div>
        ) : null;
      })()}
    </Card>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={{ background: 'var(--surface2)', borderRadius: 9, padding: '10px 12px' }}>
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 800, color: color || 'var(--text)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>{value}</div>
    </div>
  );
}

function Pad({ children }) { return <div style={{ padding: '24px 28px 80px', maxWidth: 1080, margin: '0 auto' }}>{children}</div>; }

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Upload, RefreshCw, Search, FileSpreadsheet, Trash2, CheckCircle2,
  Receipt, X, AlertCircle,
} from 'lucide-react';
import { Card, Btn, Input, Select, Modal, Empty, Spinner, toast } from '../components/UI.jsx';
import {
  readExcelForExcess, detectExcessColumns,
  buildExcessShipments, summariseByCustomer,
} from '../engine/excessWeightProcessor.js';
import {
  saveExcessShipments, loadShipments, loadCustomersAR,
  markBilled, markPaid, markWaived, deleteShipments,
} from '../lib/excessWeightService.js';
import { useAuth } from '../lib/auth.jsx';

const fmt = n => (n == null || Number.isNaN(n))
  ? '—'
  : Number(n).toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS_META = {
  pending: { label: '⏳ معلّقة', color: 'var(--gold)'   },
  billed:  { label: '🧾 مفوترة', color: 'var(--accent)' },
  paid:    { label: '✓ مسدّدة',  color: 'var(--green)'  },
  waived:  { label: '— ملغاة',   color: 'var(--muted)'  },
};

export default function ExcessWeight({ isActive = true }) {
  const { user } = useAuth();
  const [tab, setTab] = useState('upload'); // upload | customers | shipments
  const [summary, setSummary] = useState({ summary: [], totals: null });
  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [ar, ships] = await Promise.all([
        loadCustomersAR(),
        loadShipments({ limit: 1000 }),
      ]);
      setSummary(ar);
      setShipments(ships);
    } catch (e) {
      toast(`خطأ: ${e.message}`, 'error');
    }
    setLoading(false);
  }, []);

  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh]);

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1300 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', margin: 0 }}>
            ⚖️ فوترة الوزن الزائد
          </h2>
          <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4, marginBottom: 0 }}>
            ارفع شحنات العملاء بوزنها الفعلي → النظام يحسب الزيادة عن الوزن المعلَن ويولّد فواتير لكل عميل.
          </p>
        </div>
        <Btn size="sm" variant="ghost" icon={<RefreshCw size={14}/>} onClick={refresh} disabled={loading}>
          {loading ? 'تحديث...' : 'تحديث'}
        </Btn>
      </div>

      {/* HERO totals */}
      {summary.totals && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px,1fr))', gap: 12, marginBottom: 16 }}>
          <Stat label="مستحق من العملاء" value={fmt(summary.totals.openDue)} suffix="ر.س" color="var(--red)" big/>
          <Stat label="معلّقة (لم تُفوتر)" value={fmt(summary.totals.pendingDue)} suffix="ر.س" color="var(--gold)"/>
          <Stat label="مفوترة"             value={fmt(summary.totals.billedDue)}  suffix="ر.س" color="var(--accent)"/>
          <Stat label="محصّلة"             value={fmt(summary.totals.paidDue)}    suffix="ر.س" color="var(--green)"/>
          <Stat label="عملاء"             value={summary.totals.customers}     color="var(--accent)"/>
          <Stat label="شحنات بزائد"        value={summary.totals.shipments}      color="var(--muted)"/>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {[
          { k: 'upload',    l: '📥 رفع جديد' },
          { k: 'customers', l: `👥 العملاء (${summary.summary?.length ?? 0})` },
          { k: 'shipments', l: `📋 الشحنات (${shipments.length})` },
        ].map(t => (
          <button key={t.k} onClick={() => setTab(t.k)} style={{
            background: tab === t.k ? 'var(--accent)20' : 'transparent',
            border: `1px solid ${tab === t.k ? 'var(--accent)' : 'var(--border)'}`,
            color:  tab === t.k ? 'var(--accent)' : 'var(--muted)',
            borderRadius: 7, padding: '8px 16px', cursor: 'pointer',
            fontSize: 13, fontWeight: 600,
          }}>{t.l}</button>
        ))}
      </div>

      {tab === 'upload'    && <UploadTab    onSaved={refresh} userId={user?.id}/>}
      {tab === 'customers' && <CustomersTab summary={summary.summary}/>}
      {tab === 'shipments' && <ShipmentsTab shipments={shipments} onRefresh={refresh}/>}
    </div>
  );
}

// ─── Upload tab ───────────────────────────────────────────────────────────
function UploadTab({ onSaved, userId }) {
  const [file, setFile] = useState(null);
  const [drag, setDrag] = useState(false);
  const [preview, setPreview] = useState(null); // { headers, rawRows, colMap }
  const [ratePerKg, setRatePerKg] = useState('');
  const [defaultDeclared, setDefaultDeclared] = useState('1');
  const [carrierId, setCarrierId] = useState('aramex');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handlePick = (f) => {
    if (!f) return;
    setError('');
    setFile(f);
    f.arrayBuffer().then(buf => {
      try {
        const data = readExcelForExcess(buf);
        const colMap = detectExcessColumns(data.headers);
        setPreview({ ...data, colMap });
      } catch (e) {
        setError(e.message);
        setPreview(null);
      }
    });
  };

  const computed = useMemo(() => {
    if (!preview) return null;
    const rows = buildExcessShipments(preview.rawRows, preview.colMap, {
      ratePerKg:        Number(ratePerKg) || 0,
      defaultDeclared:  Number(defaultDeclared) || 0,
      carrierId,
      sourceFile:       file?.name,
    });
    return { rows, summary: summariseByCustomer(rows) };
  }, [preview, ratePerKg, defaultDeclared, carrierId, file]);

  const reset = () => {
    setFile(null);
    setPreview(null);
    setRatePerKg('');
    setDefaultDeclared('1');
  };

  const save = async () => {
    if (!computed?.rows?.length) return;
    if (!Number(ratePerKg)) { toast('أدخل سعر الكيلو الزائد أولاً', 'warn'); return; }
    setSaving(true);
    try {
      const { inserted } = await saveExcessShipments(computed.rows, userId);
      toast(`تم حفظ ${inserted} شحنة بزيادة`, 'success');
      reset();
      onSaved?.();
    } catch (e) {
      toast(`فشل الحفظ: ${e.message}`, 'error');
    }
    setSaving(false);
  };

  return (
    <>
      {!preview && (
        <div
          onDragOver={e => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); handlePick(e.dataTransfer?.files?.[0]); }}
          onClick={() => document.getElementById('ew-file').click()}
          style={{
            border: `2px dashed ${drag ? 'var(--accent)' : 'var(--border2)'}`,
            borderRadius: 14, padding: '54px 24px', textAlign: 'center',
            background: drag ? 'rgba(56,189,248,.05)' : 'var(--surface)',
            cursor: 'pointer', transition: 'all .2s',
          }}
        >
          <Upload size={42} color="var(--muted)" style={{ marginBottom: 12 }}/>
          <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>اسحب ملف Excel هنا</div>
          <div style={{ color: 'var(--muted)', fontSize: 12, lineHeight: 1.6 }}>
            الأعمدة المتوقَّعة: العميل · رقم الشحنة · الوزن المعلَن · الوزن الفعلي
            <br/>
            (لا يحتاج كل العمود — لو وزن معلَن غير موجود، نستخدم القيمة الافتراضية)
          </div>
          <input id="ew-file" type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
            onChange={e => handlePick(e.target.files?.[0])}/>
        </div>
      )}

      {error && (
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <AlertCircle size={20} color="var(--red)"/>
            <div style={{ color: 'var(--red)' }}>{error}</div>
          </div>
        </Card>
      )}

      {preview && (
        <>
          {/* Settings + column mapping */}
          <Card style={{ marginBottom: 14, padding: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: 10, marginBottom: 14 }}>
              <Input label="سعر الكيلو الزائد (ر.س)"
                value={ratePerKg}
                onChange={e => setRatePerKg(e.target.value)}
                placeholder="مثال: 5"
                type="number"/>
              <Input label="الوزن المعلَن الافتراضي (كغ)"
                value={defaultDeclared}
                onChange={e => setDefaultDeclared(e.target.value)}
                placeholder="1"
                type="number"/>
              <Select label="شركة الشحن" value={carrierId} onChange={e => setCarrierId(e.target.value)}>
                <option value="aramex">أرامكس</option>
                <option value="smsa">سمسا</option>
                <option value="other">أخرى</option>
              </Select>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                <Btn size="sm" variant="ghost" icon={<X size={12}/>} onClick={reset} style={{ width: '100%' }}>
                  ملف جديد
                </Btn>
              </div>
            </div>

            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, fontFamily: 'var(--font-mono)' }}>
              تعيين الأعمدة — عدّل إذا احتجت
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px,1fr))', gap: 8 }}>
              {[
                ['customer', 'العميل', true],
                ['actual',   'الوزن الفعلي', true],
                ['declared', 'الوزن المعلَن', false],
                ['awb',      'رقم الشحنة', false],
                ['shipDate', 'تاريخ الشحن', false],
              ].map(([k, label, required]) => (
                <div key={k}>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 3 }}>
                    {label} {required && <span style={{ color: 'var(--red)' }}>*</span>}
                  </div>
                  <select value={preview.colMap[k] || ''}
                    onChange={e => setPreview(p => ({ ...p, colMap: { ...p.colMap, [k]: e.target.value || null } }))}
                    style={{ width: '100%', padding: '7px 10px', borderRadius: 7, fontSize: 12 }}>
                    <option value="">— غير محدد —</option>
                    {preview.headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </Card>

          {/* Computed preview */}
          {computed && (
            <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 12 }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent)' }}>
                  معاينة قبل الحفظ — {computed.rows.length} شحنة بزيادة من {computed.summary.length} عميل
                </span>
                <Btn variant="success" icon={<CheckCircle2 size={14}/>} disabled={saving || !computed.rows.length || !Number(ratePerKg)}
                  onClick={save}>
                  {saving ? <Spinner size={11}/> : `💾 حفظ (${fmt(computed.rows.reduce((s,r)=>s+r.amount_due,0))} ر.س)`}
                </Btn>
              </div>
              {computed.summary.length === 0 ? (
                <Empty icon="🔍" title="لا توجد شحنات بزيادة" sub="إما الوزن الفعلي ≤ المعلَن، أو لم يُلتقط عمود الوزن"/>
              ) : (
                <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                  <table style={{ fontSize: 12, width: '100%' }}>
                    <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)' }}>
                      <tr>
                        <th>العميل</th>
                        <th>شحنات</th>
                        <th>وزن زائد</th>
                        <th>المبلغ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {computed.summary.map(c => (
                        <tr key={c.customer}>
                          <td style={{ fontWeight: 600 }}>{c.customer}</td>
                          <td style={{ fontFamily: 'var(--font-mono)', textAlign: 'center' }}>{c.shipments}</td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>
                            {fmt(c.totalExcess)} <span style={{ fontSize: 10, color: 'var(--muted)' }}>كغ</span>
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--red)' }}>
                            {fmt(c.totalDue)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </>
  );
}

// ─── Customers tab ────────────────────────────────────────────────────────
function CustomersTab({ summary }) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    if (!search.trim()) return summary;
    const q = search.trim().toLowerCase();
    return summary.filter(c => c.customer.toLowerCase().includes(q));
  }, [summary, search]);

  if (!summary?.length) return <Empty icon="👥" title="لا يوجد عملاء بعد" sub="ارفع ملف من تبويب 'رفع جديد'"/>;

  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: 10, borderBottom: '1px solid var(--border)', position: 'relative' }}>
        <Search size={14} style={{ position: 'absolute', right: 22, top: 21, color: 'var(--muted)' }}/>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="بحث بالاسم..."
          style={{ width: '100%', padding: '9px 36px 9px 12px', borderRadius: 8, fontSize: 13 }}/>
      </div>
      <div style={{ maxHeight: 600, overflowY: 'auto' }}>
        <table style={{ fontSize: 12, width: '100%' }}>
          <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)' }}>
            <tr>
              <th>العميل</th>
              <th>شحنات</th>
              <th>وزن زائد</th>
              <th>معلّقة</th>
              <th>مفوترة</th>
              <th>محصّلة</th>
              <th>إجمالي مفتوح</th>
              <th>آخر شحنة</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(c => {
              const open = c.pendingDue + c.billedDue;
              return (
                <tr key={c.customer}>
                  <td style={{ fontWeight: 600 }}>{c.customer}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', textAlign: 'center' }}>{c.shipments}</td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{fmt(c.totalExcess)} كغ</td>
                  <td style={{ fontFamily: 'var(--font-mono)', color: c.pendingDue > 0 ? 'var(--gold)' : 'var(--muted3)' }}>
                    {c.pendingDue > 0 ? fmt(c.pendingDue) : '—'}
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', color: c.billedDue > 0 ? 'var(--accent)' : 'var(--muted3)' }}>
                    {c.billedDue > 0 ? fmt(c.billedDue) : '—'}
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', color: c.paidDue > 0 ? 'var(--green)' : 'var(--muted3)' }}>
                    {c.paidDue > 0 ? fmt(c.paidDue) : '—'}
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: open > 0 ? 'var(--red)' : 'var(--green)' }}>
                    {open > 0 ? fmt(open) : '✓'}
                  </td>
                  <td style={{ fontSize: 11, color: 'var(--muted)' }}>{c.lastShipDate || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ─── Shipments tab ────────────────────────────────────────────────────────
function ShipmentsTab({ shipments, onRefresh }) {
  const [filterStatus, setFilterStatus]   = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(null); // { action, ids }

  const filtered = useMemo(() => {
    return shipments.filter(s => {
      if (filterStatus !== 'all' && s.status !== filterStatus) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const hay = `${s.customer_name} ${s.awb ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [shipments, filterStatus, search]);

  const counts = useMemo(() => {
    const c = { all: shipments.length, pending: 0, billed: 0, paid: 0, waived: 0 };
    for (const s of shipments) c[s.status] = (c[s.status] ?? 0) + 1;
    return c;
  }, [shipments]);

  const toggle = id => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map(s => s.id)));
  };

  const bulkAction = async (kind, payload) => {
    if (!selected.size) return;
    setBusy(true);
    try {
      const ids = [...selected];
      if (kind === 'billed')  await markBilled(ids, payload);
      if (kind === 'paid')    await markPaid(ids, payload);
      if (kind === 'waived')  await markWaived(ids, payload);
      if (kind === 'delete')  await deleteShipments(ids);
      toast(`تم تطبيق العملية على ${ids.length} شحنة`, 'success');
      setSelected(new Set());
      onRefresh?.();
    } catch (e) {
      toast(`فشل: ${e.message}`, 'error');
    }
    setBusy(false);
    setModal(null);
  };

  return (
    <>
      {/* Filter + bulk actions */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {[
          { k: 'all',     l: `الكل (${counts.all})`        },
          { k: 'pending', l: `معلّقة (${counts.pending ?? 0})`   },
          { k: 'billed',  l: `مفوترة (${counts.billed ?? 0})`    },
          { k: 'paid',    l: `مسدّدة (${counts.paid ?? 0})`      },
          { k: 'waived',  l: `ملغاة (${counts.waived ?? 0})`      },
        ].map(t => (
          <button key={t.k} onClick={() => setFilterStatus(t.k)} style={{
            background: filterStatus === t.k ? 'var(--accent)20' : 'transparent',
            border: `1px solid ${filterStatus === t.k ? 'var(--accent)' : 'var(--border)'}`,
            color:  filterStatus === t.k ? 'var(--accent)' : 'var(--muted)',
            borderRadius: 7, padding: '5px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
          }}>{t.l}</button>
        ))}
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="بحث..." style={{ flex: 1, minWidth: 150, padding: '7px 12px', borderRadius: 7, fontSize: 12 }}/>
        {selected.size > 0 && (
          <>
            <Btn size="sm" variant="primary" disabled={busy} onClick={() => setModal({ action: 'billed' })}>
              🧾 فوترة ({selected.size})
            </Btn>
            <Btn size="sm" variant="success" disabled={busy} onClick={() => setModal({ action: 'paid' })}>
              ✓ تسديد
            </Btn>
            <Btn size="sm" variant="ghost" disabled={busy} onClick={() => setModal({ action: 'waived' })}>
              — إلغاء
            </Btn>
            <Btn size="sm" variant="danger" disabled={busy} onClick={() => bulkAction('delete')}>
              🗑 حذف
            </Btn>
          </>
        )}
      </div>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ maxHeight: 560, overflowY: 'auto' }}>
          {filtered.length === 0
            ? <Empty icon="📋" title="لا توجد شحنات"/>
            : (
              <table style={{ fontSize: 12, width: '100%' }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
                  <tr>
                    <th style={{ width: 32 }}>
                      <input type="checkbox"
                        checked={selected.size === filtered.length && filtered.length > 0}
                        onChange={toggleAll}/>
                    </th>
                    <th>الحالة</th>
                    <th>العميل</th>
                    <th>الشحنة</th>
                    <th>التاريخ</th>
                    <th>وزن معلَن</th>
                    <th>وزن فعلي</th>
                    <th>زائد</th>
                    <th>سعر/كغ</th>
                    <th>المبلغ</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(s => {
                    const meta = STATUS_META[s.status] ?? STATUS_META.pending;
                    return (
                      <tr key={s.id} style={{ background: selected.has(s.id) ? 'rgba(56,189,248,.06)' : 'transparent' }}>
                        <td>
                          <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)}/>
                        </td>
                        <td>
                          <span style={{
                            background: `${meta.color}20`, border: `1px solid ${meta.color}40`, color: meta.color,
                            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 12,
                            fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap',
                          }}>{meta.label}</span>
                        </td>
                        <td style={{ fontWeight: 600 }}>{s.customer_name}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}>{s.awb || '—'}</td>
                        <td style={{ fontSize: 11, color: 'var(--muted)' }}>{s.ship_date || '—'}</td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{Number(s.declared_weight).toFixed(2)}</td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{Number(s.actual_weight).toFixed(2)}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--gold)' }}>
                          {Number(s.excess_weight).toFixed(2)}
                        </td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{Number(s.rate_per_kg).toFixed(2)}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--red)' }}>
                          {fmt(s.amount_due)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          }
        </div>
      </Card>

      {modal && (
        <BulkActionModal
          action={modal.action} count={selected.size}
          onClose={() => setModal(null)}
          onConfirm={(payload) => bulkAction(modal.action, payload)}
        />
      )}
    </>
  );
}

function BulkActionModal({ action, count, onClose, onConfirm }) {
  const [val, setVal] = useState('');
  const labels = {
    billed: { title: '🧾 فوترة شحنات', field: 'رقم الفاتورة (اختياري)', placeholder: 'INV-...' },
    paid:   { title: '✓ تأكيد التسديد', field: 'رقم الإيصال أو الحوالة', placeholder: 'مثال: FT26120A23' },
    waived: { title: '— إلغاء الشحنات',  field: 'سبب الإلغاء',          placeholder: 'مثال: خصم وفاء أو خطأ إدخال' },
  };
  const meta = labels[action] ?? labels.billed;

  return (
    <Modal title={meta.title} onClose={onClose} width={420}>
      <div style={{ marginBottom: 12, color: 'var(--muted)', fontSize: 13 }}>
        سيتم تطبيق العملية على <span style={{ color: 'var(--text)', fontWeight: 700 }}>{count}</span> شحنة.
      </div>
      <Input label={meta.field} value={val} onChange={e => setVal(e.target.value)} placeholder={meta.placeholder}/>
      <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end', marginTop: 18 }}>
        <Btn variant="ghost" onClick={onClose}>إلغاء</Btn>
        <Btn variant="primary" onClick={() => onConfirm(val)}>تأكيد</Btn>
      </div>
    </Modal>
  );
}

// ── Stat block ─────────────────────────────────────────────────────────────
function Stat({ label, value, suffix, color, big }) {
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 11, padding: '13px 16px',
      borderTop: `3px solid ${color}`,
    }}>
      <div style={{ color: 'var(--muted)', fontSize: 10, fontFamily: 'var(--font-mono)', marginBottom: 3 }}>
        {label}
      </div>
      <div style={{ color, fontSize: big ? 22 : 16, fontFamily: 'var(--font-mono)', fontWeight: 700, whiteSpace: 'nowrap' }}>
        {value}
        {suffix && <span style={{ fontSize: 10, color: 'var(--muted)', marginRight: 4 }}> {suffix}</span>}
      </div>
    </div>
  );
}

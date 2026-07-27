// «شركات المنصّة المفعّلة» — الناقلون الظاهرون للعملاء الآن + تكلفتهم.
// التكلفة الأساسية تُقرأ حيّاً من العقد؛ سعر التكلفة = الأساسية + هامش قياسي (افتراضي
// 2 ر.س). سعر البيع يُملأ لاحقاً. تعديل التفعيل/الهامش/البيع يتطلب carriers.edit_contract.
import { useState, useEffect, useMemo, useCallback } from 'react';
import { Truck, RefreshCw, Download, Save } from 'lucide-react';
import { Card, Btn, Spinner, Empty, PageHeader, toast } from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import { loadPlatformCarriers, savePlatformCarrier, loadPlatformMarkup, savePlatformMarkup } from '../lib/platformCarriersService.js';

const fmt2 = (n) => n == null ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cell = { padding: '10px 12px', fontSize: 12.5, whiteSpace: 'nowrap' };
const th   = { padding: '10px 12px', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', textAlign: 'right' };

export default function PlatformCarriers({ isActive = true }) {
  const { can, user } = useAuth();
  const canEdit = can('carriers.edit_contract');
  const [rows, setRows] = useState(null);
  const [markup, setMarkup] = useState(2);
  const [markupInput, setMarkupInput] = useState('2');
  const [savingMk, setSavingMk] = useState(false);
  const [sellDraft, setSellDraft] = useState({});   // carrierId → نص سعر البيع قيد التحرير

  const load = useCallback(async () => {
    setRows(null);
    try {
      const [list, mk] = await Promise.all([loadPlatformCarriers(), loadPlatformMarkup()]);
      setRows(list); setMarkup(mk); setMarkupInput(String(mk));
    } catch (e) { toast(`فشل التحميل: ${e.message}`, 'error'); setRows([]); }
  }, []);
  useEffect(() => { if (isActive) load(); }, [isActive, load]);

  const sorted = useMemo(() => {
    if (!rows) return [];
    return [...rows].sort((a, b) =>
      (b.isActive - a.isActive) || (b.hasContract - a.hasContract) || ((a.base ?? 1e9) - (b.base ?? 1e9)));
  }, [rows]);
  const activeCount = useMemo(() => (rows || []).filter(r => r.isActive).length, [rows]);
  const noContract = useMemo(() => (rows || []).filter(r => r.isActive && !r.hasContract).length, [rows]);

  if (!can('carriers.view')) return <Pad><Empty icon="🔒" title="لا صلاحية" sub="تحتاج صلاحية عرض شركات الشحن"/></Pad>;

  const patch = async (id, p) => {
    // تحديث متفائل
    setRows(prev => prev.map(r => r.id === id ? recompute({ ...r, ...p }, markup) : r));
    try { await savePlatformCarrier(id, p, user?.id); }
    catch (e) { toast(`تعذّر الحفظ: ${e.message}`, 'error'); load(); }
  };

  const saveMarkup = async () => {
    const m = Number(markupInput);
    if (!Number.isFinite(m) || m < 0) { toast('هامش غير صالح', 'error'); return; }
    setSavingMk(true);
    try {
      await savePlatformMarkup(m); setMarkup(m);
      setRows(prev => prev.map(r => recompute(r, m)));
      toast(`الهامش القياسي = ${m} ر.س ✓`, 'success');
    } catch (e) { toast(`تعذّر الحفظ: ${e.message}`, 'error'); }
    setSavingMk(false);
  };

  const saveSell = async (id) => {
    const raw = sellDraft[id];
    const v = raw === '' || raw == null ? null : Number(raw);
    if (v != null && !Number.isFinite(v)) { toast('سعر بيع غير صالح', 'error'); return; }
    await patch(id, { sell_price: v });
    setSellDraft(d => { const n = { ...d }; delete n[id]; return n; });
    toast('حُفظ سعر البيع ✓', 'success');
  };

  const exportXlsx = async () => {
    try {
      const XLSX = await import('xlsx');
      const { rtl } = await import('../lib/xlsxRtl.js');
      const { persistAndDownloadExport } = await import('../lib/internalExportsService.js');
      const data = sorted.filter(r => r.isActive).map(r => ({
        'الشركة': r.name,
        'التكلفة الأساسية (عقد)': r.base ?? '',
        'وقود %': r.fuelPct ? (r.fuelPct * 100) : '',
        'الهامش': r.markup,
        'سعر التكلفة': r.costPrice ?? '',
        'سعر البيع': r.sellPrice ?? '',
        'الربح': (r.sellPrice != null && r.costPrice != null) ? Number((r.sellPrice - r.costPrice).toFixed(2)) : '',
        'الربح بعد الوقود': (r.sellPrice != null && r.costPrice != null) ? Number((r.sellPrice - r.costPrice - ((r.base || 0) * (r.fuelPct || 0))).toFixed(2)) : '',
        'رجيع مجاني': r.freeReturn ? 'نعم' : 'لا',
        'العقد': r.hasContract ? (r.contractLabel || 'موجود') : 'بلا عقد',
      }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'شركات المنصّة');
      await persistAndDownloadExport({ wb: rtl(wb), fileName: `شركات-المنصة-المفعلة-${new Date().toISOString().slice(0, 10)}.xlsx`,
        kind: 'platform_carriers', rowCount: data.length, total: null, userId: user?.id || null });
      toast(`صُدِّر ${data.length} شركة`, 'success');
    } catch (e) { toast(`فشل التصدير: ${e.message}`, 'error'); }
  };

  return (
    <Pad>
      <PageHeader icon={<Truck size={22}/>} iconColor="#3B82F6"
        title="شركات المنصّة المفعّلة"
        subtitle="الناقلون الظاهرون للعملاء الآن — سعر التكلفة = تكلفة العقد + هامش قياسي. سعر البيع يُضاف لاحقاً."
        meta={rows ? `${activeCount} مفعّلة${noContract ? ` · ${noContract} بلا عقد` : ''}` : null}
        actions={<Btn size="sm" variant="ghost" onClick={load} disabled={rows == null}><RefreshCw size={14} className={rows == null ? 'spin' : ''}/></Btn>}/>

      {/* الهامش القياسي */}
      <Card style={{ padding: 12, marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, fontWeight: 700 }}>الهامش القياسي على التكلفة</span>
        <input type="number" step="0.5" value={markupInput} onChange={e => setMarkupInput(e.target.value)} disabled={!canEdit}
          style={{ width: 90, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--font-mono)', textAlign: 'center' }}/>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>ر.س</span>
        {canEdit && Number(markupInput) !== markup && (
          <Btn size="sm" variant="accent" icon={<Save size={13}/>} onClick={saveMarkup} disabled={savingMk}>حفظ الهامش</Btn>
        )}
        <span style={{ fontSize: 11.5, color: 'var(--muted2)', marginInlineStart: 'auto' }}>سعر التكلفة = التكلفة الأساسية + {markup} ر.س</span>
      </Card>

      {rows == null ? <div style={{ padding: 50, textAlign: 'center' }}><Spinner/></div>
        : !sorted.length ? <Card><Empty icon="🚚" title="لا شركات" sub="أضف شركات من إدارة الشركات"/></Card>
        : (
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="m-cards" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: 'var(--surface2)' }}>
                  {['مفعّلة', 'الشركة', 'التكلفة الأساسية', 'التفاصيل', 'الهامش', 'سعر التكلفة', 'سعر البيع', 'الربح', 'رجيع مجاني'].map(h => <th key={h} style={th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {sorted.map(r => {
                    // الربح = البيع − التكلفة. للناقلين ذوي الوقود (نتحمّله للناقل) نعرض
                    // «بعد الوقود» = الربح − (الأساس × الوقود%) لصورة أدق.
                    const profit = (r.sellPrice != null && r.costPrice != null) ? r.sellPrice - r.costPrice : null;
                    const fuelCost = (r.base != null && r.fuelPct) ? r.base * r.fuelPct : 0;
                    const profitNet = profit != null ? profit - fuelCost : null;
                    const pColor = profit == null ? 'var(--muted2)' : profit <= 0 ? 'var(--red)' : profit < 1.5 ? 'var(--gold)' : 'var(--green)';
                    return (
                    <tr key={r.id} style={{ borderTop: '1px solid var(--border)', opacity: r.isActive ? 1 : 0.5 }}>
                      <td data-label="مفعّلة" style={cell}>
                        <input type="checkbox" checked={r.isActive} disabled={!canEdit}
                          onChange={e => patch(r.id, { is_active: e.target.checked })} style={{ cursor: canEdit ? 'pointer' : 'default', width: 16, height: 16 }}/>
                      </td>
                      <td data-label="الشركة" style={{ ...cell, fontWeight: 700 }}>
                        {r.name}
                        {!r.hasContract && <span style={{ marginInlineStart: 6, fontSize: 9.5, fontWeight: 700, color: 'var(--gold)', background: 'color-mix(in srgb, var(--gold) 15%, transparent)', padding: '1px 6px', borderRadius: 20 }}>بلا عقد</span>}
                      </td>
                      <td data-label="التكلفة الأساسية" style={{ ...cell, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                        {r.base != null ? `${fmt2(r.base)} ر.س` : <span style={{ color: 'var(--muted2)', fontFamily: 'var(--font-sans)', fontWeight: 400 }}>{r.costReason || '—'}</span>}
                      </td>
                      <td data-label="التفاصيل" style={{ ...cell, fontSize: 11, color: 'var(--muted)', whiteSpace: 'normal' }}>
                        {r.base != null && [
                          r.upTo ? `حتى ${r.upTo}كغ` : 'وزن ثابت',
                          r.excessPerKg ? `+${r.excessPerKg}/كغ` : null,
                          r.fuelPct ? `وقود ${(r.fuelPct * 100).toFixed(1)}%` : null,
                          r.inclusiveVat ? 'شامل الضريبة' : null,
                        ].filter(Boolean).join(' · ')}
                      </td>
                      <td data-label="الهامش" style={{ ...cell, fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>+{fmt2(r.markup)}</td>
                      <td data-label="سعر التكلفة" style={{ ...cell, fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--accent)' }}>
                        {r.costPrice != null ? `${fmt2(r.costPrice)} ر.س` : '—'}
                      </td>
                      <td data-label="سعر البيع" style={cell} onClick={e => e.stopPropagation()}>
                        {canEdit ? (
                          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                            <input type="number" step="0.5" placeholder="—"
                              value={sellDraft[r.id] ?? (r.sellPrice ?? '')}
                              onChange={e => setSellDraft(d => ({ ...d, [r.id]: e.target.value }))}
                              onKeyDown={e => { if (e.key === 'Enter') saveSell(r.id); }}
                              style={{ width: 76, padding: '5px 8px', borderRadius: 7, border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--font-mono)', textAlign: 'center' }}/>
                            {sellDraft[r.id] != null && sellDraft[r.id] !== String(r.sellPrice ?? '') && (
                              <button onClick={() => saveSell(r.id)} title="حفظ" style={{ border: 'none', background: 'var(--accent)', color: '#fff', borderRadius: 6, cursor: 'pointer', padding: '4px 6px', display: 'flex' }}><Save size={12}/></button>
                            )}
                          </span>
                        ) : (r.sellPrice != null ? `${fmt2(r.sellPrice)} ر.س` : '—')}
                      </td>
                      <td data-label="الربح" style={{ ...cell, fontFamily: 'var(--font-mono)', fontWeight: 800, color: pColor }}>
                        {profit != null ? `${profit > 0 ? '+' : ''}${fmt2(profit)}` : '—'}
                        {profit != null && fuelCost > 0 && (
                          <div style={{ fontSize: 9.5, color: 'var(--muted2)', fontFamily: 'var(--font-sans)', fontWeight: 400 }}>
                            بعد الوقود {profitNet > 0 ? '+' : ''}{fmt2(profitNet)}
                          </div>
                        )}
                      </td>
                      <td data-label="رجيع مجاني" style={cell}>
                        <input type="checkbox" checked={r.freeReturn} disabled={!canEdit}
                          onChange={e => patch(r.id, { free_return: e.target.checked })} style={{ cursor: canEdit ? 'pointer' : 'default', width: 16, height: 16 }}/>
                      </td>
                    </tr>
                  );})}
                </tbody>
              </table>
            </div>
          </Card>
        )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
        {can('carriers.view') && rows?.length ? (
          <Btn size="sm" variant="ghost" icon={<Download size={13}/>} onClick={exportXlsx}>تصدير المفعّلة</Btn>
        ) : null}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--muted2)', marginTop: 8 }}>
        سعر البيع فارغ الآن — سيُملأ من إكسل الأسعار اللايف لاحقاً. التكلفة الأساسية تتبع العقد تلقائياً.
      </div>
    </Pad>
  );
}

// إعادة حساب سعر التكلفة عند تغيّر الهامش أو تجاوزه لناقل.
function recompute(r, globalMarkup) {
  const m = r.markupOverride != null ? r.markupOverride : globalMarkup;
  return { ...r, markup: m, costPrice: r.base != null ? Number((r.base + m).toFixed(2)) : null };
}

function Pad({ children }) { return <div style={{ padding: '24px 28px 80px', maxWidth: 1320, margin: '0 auto' }}>{children}</div>; }

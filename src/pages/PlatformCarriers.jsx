// «شركات المنصّة المفعّلة» — الناقلون الظاهرون للعملاء الآن + تكلفتهم.
// التكلفة الأساسية تُقرأ حيّاً من العقد؛ سعر التكلفة = الأساسية + هامش قياسي (افتراضي
// 2 ر.س). سعر البيع يُملأ لاحقاً. تعديل التفعيل/الهامش/البيع يتطلب carriers.edit_contract.
import { useState, useEffect, useMemo, useCallback } from 'react';
import { Truck, RefreshCw, Download, Save } from 'lucide-react';
import { Card, Btn, Spinner, Empty, PageHeader, toast } from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import { loadPlatformCarriers, savePlatformCarrier, savePlatformCompetitor, loadPlatformMarkup, savePlatformMarkup } from '../lib/platformCarriersService.js';

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
  const [showAll, setShowAll] = useState(false);       // إظهار غير المفعّلة (إدارة فقط)
  // الافتراض: **شركات لمحة النشطة فقط** — هي محلّ القرار. الشركات غير
  // الموجودة في لمحة (منافس صرف) تُخفى حتى تُطلَب صراحةً، وإلا اختلط
  // «ما نبيعه» بـ«ما يبيعه غيرنا» في جدول واحد (قرار المستخدم 2026-07-29).
  const [showComp, setShowComp] = useState(false);

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
    // ترتيب القرار (قاعدة المستخدم 2026-07-29): الأهم هو ما **يمكن مقارنته**.
    //   ١) نشطة في لمحة ولها سعر في أوتو **و** طرود  → مقارنة كاملة
    //   ٢) نشطة في لمحة ولها سعر في أوتو **أو** طرود → مقارنة جزئية
    //   ٣) الباقي (بلا منافس مُدخَل) ثم المنافس الصرف
    // وداخل كل مرتبة: الأرخص أولاً.
    const tier = (r) => {
      if (r.sellPrice == null) return 3;                       // منافس صرف
      const n = (r.sellAuto != null ? 1 : 0) + (r.sellTorod != null ? 1 : 0);
      if (!r.isActive) return 2 + (n ? 0 : 0.5);               // غير نشطة تحت النشطة
      return n === 2 ? 0 : n === 1 ? 1 : 2;
    };
    return [...rows].sort((a, b) => {
      const ta = tier(a), tb = tier(b);
      if (ta !== tb) return ta - tb;
      const ap = a.sellPrice != null ? a.sellPrice : (a.sellAuto ?? 1e9);
      const bp = b.sellPrice != null ? b.sellPrice : (b.sellAuto ?? 1e9);
      return ap - bp;
    });
  }, [rows]);
  // صفحة مقارنة منافسين → تعرض فقط الناقلين الموجودين في إكسل أسعار البيع (المفعّلين).
  // غير الموجودين (بوليصة/فارنير/داخلية) لا تظهر إطلاقاً. «إظهار الكل» للإدارة فقط.
  const visible = useMemo(() => sorted.filter(r =>
    (showAll  || r.isActive) &&          // النشطة فقط ما لم يُطلب غيرها
    (showComp || !r.competitorOnly)      // شركات لمحة فقط ما لم تُطلب الخارجية
  ), [sorted, showAll, showComp]);
  const activeCount = useMemo(() => (rows || []).filter(r => r.isActive && !r.isCompetitor).length, [rows]);
  const hiddenCount = useMemo(() => (rows || []).filter(r => !r.isActive).length, [rows]);
  const compCount   = useMemo(() => (rows || []).filter(r => r.competitorOnly && r.isActive).length, [rows]);
  // شركات لمحة النشطة التي لا تُعرف تكلفتها — لا ربح محسوب ولا تدقيق ممكن
  const noCostRows  = useMemo(() => (rows || [])
    .filter(r => r.isActive && !r.competitorOnly && r.costPrice == null), [rows]);
  // عدد الشركات النشطة لكل منصّة — للمقارنة
  const platCounts = useMemo(() => {
    const rs = (rows || []).filter(r => r.isActive);
    return {
      lamha: rs.filter(r => !r.competitorOnly).length,   // كل شركات لمحة (بسعر أو بلا)
      auto:  rs.filter(r => r.sellAuto != null).length,
      torod: rs.filter(r => r.sellTorod != null).length,
    };
  }, [rows]);

  if (!can('carriers.view')) return <Pad><Empty icon="🔒" title="لا صلاحية" sub="تحتاج صلاحية عرض شركات الشحن"/></Pad>;

  const patch = async (id, p) => {
    const row = (rows || []).find(r => r.id === id);
    // تحديث متفائل بأسماء حقول الصف (is_active→isActive · free_return→freeReturn)
    const rowPatch = {};
    if ('is_active' in p) rowPatch.isActive = p.is_active;
    if ('free_return' in p) rowPatch.freeReturn = p.free_return;
    setRows(prev => prev.map(r => r.id === id ? recompute({ ...r, ...rowPatch }, markup) : r));
    try {
      if (row?.isCompetitor) {
        // جدول المنافسين: is_active→active (لا free_return)
        if ('is_active' in p) await savePlatformCompetitor(row.compId, { active: p.is_active }, user?.id);
      } else await savePlatformCarrier(id, p, user?.id);
    } catch (e) { toast(`تعذّر الحفظ: ${e.message}`, 'error'); load(); }
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

  // مفاتيح صفوف أسعار المنصّات (للعرض فقط — لا تحرير من الشاشة)
  const PRICE_COLS = { lamha: 'sellPrice', auto: 'sellAuto', torod: 'sellTorod' };

  // خلية سعر — **للعرض فقط** (قرار المستخدم 2026-07-29).
  //
  // كانت قابلة للتحرير مباشرةً، والتحرير السريع هو ما ينتج الأخطاء التي
  // اصطدنا اليوم: سعر شامل الضريبة يُكتب في عمود بلا ضريبة (فرق 13%)، أو
  // سعر النسخة V2 يُكتب على سجلّ العقد V1 (الحصري)، أو خانة فارغة تُقرأ
  // «غير متاحة». كل هذه أخطاء **صامتة** لا يكشفها الجدول.
  // فالأسعار تُدخَل من مسار واحد مضبوط، والشاشة تعرض لا تحرّر.
  const priceCellNode = (r, plat) => {
    // منصّة لا تقدّم هذا الناقل → «غير متاحة» (لا تدخل المقارنة)
    if ((r.unavailable || []).includes(plat)) return <span style={{ fontSize: 10.5, color: 'var(--muted2)' }}>غير متاحة</span>;
    const cur = r[PRICE_COLS[plat]];
    return <span style={{ fontFamily: 'var(--font-mono)' }}>{cur != null ? fmt2(cur) : '—'}</span>;
  };

  const exportXlsx = async () => {
    try {
      const XLSX = await import('xlsx');
      const { rtl } = await import('../lib/xlsxRtl.js');
      const { persistAndDownloadExport } = await import('../lib/internalExportsService.js');
      const data = sorted.filter(r => r.isActive).map(r => {
        const profit = (r.sellPrice != null && r.costPrice != null) ? Number((r.sellPrice - r.costPrice).toFixed(2)) : '';
        const prices = [['لمحة', r.sellPrice], ['أوتو', r.sellAuto], ['طرود', r.sellTorod]].filter(([, v]) => v != null);
        // نفس حارس الشاشة: سعر واحد ليس مقارنة (انظر التعليق في جدول الصفحة)
        const best = prices.length >= 2 ? prices.reduce((a, b) => (b[1] < a[1] ? b : a)) : null;
        return {
          'اسم شركة الشحن': r.displayName,
          'الحالة في لمحة': r.competitorOnly ? 'منافس' : (r.isActive ? 'نشط' : 'غير نشط'),
          'تكلفة الناقل': r.costPrice != null ? Number((r.costPrice - (r.markup||0)).toFixed(2)) : '',
          'رسوم لمحة': r.costPrice != null ? (r.markup||0) : '',
          'ربح لمحة': profit,
          'البيع في لمحة': r.sellPrice ?? '',
          'البيع في أوتو': r.sellAuto ?? '',
          'البيع في طرود': r.sellTorod ?? '',
          'أفضل سعر': best ? best[1] : '',
          'أرخص منصّة': best ? best[0] : (prices.length === 1 ? 'لا سعر منافس مُدخَل' : ''),
          'منصّات بسعر مُدخَل': prices.length,
        };
      });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'شركات المنصّة');
      await persistAndDownloadExport({ wb: rtl(wb), fileName: `شركات-المنصة-المفعلة-${new Date().toISOString().slice(0, 10)}.xlsx`,
        kind: 'platform_carriers', rowCount: data.length, total: null, userId: user?.id || null });
      toast(`صُدِّر ${data.length} شركة`, 'success');
    } catch (e) { toast(`فشل التصدير: ${e.message}`, 'error'); }
  };

  return (
    <Pad>
      <PageHeader icon={<Truck size={22}/>} iconColor="var(--brand)"
        title="شركات المنصّة المفعّلة"
        subtitle="مقارنة أسعار البيع: لمحة مقابل أوتو وطرود — مع تكلفة لمحة (من العقد + هامش) وربحها، و«أفضل سعر» يبرز الأرخص. كل الأرقام هنا بدون ضريبة."
        meta={rows ? `${activeCount} شركة في المقارنة` : null}
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
        {compCount > 0 && (
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 11.5, color: 'var(--muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={showComp} onChange={e => setShowComp(e.target.checked)}/>
            إظهار الشركات غير الموجودة في لمحة ({compCount})
          </label>
        )}
        {hiddenCount > 0 && (
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 11.5, color: 'var(--muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)}/>
            إظهار غير النشطة في لمحة ({hiddenCount})
          </label>
        )}
        <span style={{ fontSize: 11.5, color: 'var(--muted2)', marginInlineStart: 'auto' }}>سعر التكلفة = الأساس + الوقود + هامش {markup} ر.س</span>
      </Card>

      {/* عدد الشركات لكل منصّة */}
      {rows && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {[['لمحة', platCounts.lamha, 'var(--brand)'], ['أوتو', platCounts.auto, 'var(--gold)'], ['طرود', platCounts.torod, 'var(--accent)']].map(([lbl, n, col]) => (
            <div key={lbl} style={{ flex: '1 1 120px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '9px 13px', borderTop: `3px solid ${col}` }}>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 2 }}>{lbl}</div>
              <div style={{ fontSize: 19, fontWeight: 800, fontFamily: 'var(--font-mono)', color: col }}>{n} <span style={{ fontSize: 11, color: 'var(--muted2)', fontWeight: 400 }}>شركة</span></div>
            </div>
          ))}
        </div>
      )}

      {/* تنبيه جامع: شركات نشطة تبيع بلا تكلفة معروفة — تظهر أعلى الصفحة
          كي لا تحتاج تمريراً لاكتشافها (طلب المستخدم 2026-07-29). */}
      {noCostRows.length > 0 && (
        <Card style={{ marginBottom: 12, padding: '12px 16px',
          borderColor: 'color-mix(in srgb, var(--red) 35%, transparent)',
          background: 'color-mix(in srgb, var(--red) 7%, transparent)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
            ⚠️ {noCostRows.length} شركة نشطة تبيع بلا تكلفة معروفة
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 8, lineHeight: 1.7 }}>
            ربحها غير محسوب، وفواتيرها <b>لا يمكن تدقيقها</b> — المحرّك يقيس المفوتر على العقد وبلا عقد لا مرجع.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {noCostRows.map(r => (
              <span key={r.id} style={{
                fontSize: 11, padding: '3px 10px', borderRadius: 20,
                background: 'var(--surface)', border: '1px solid var(--border)',
              }}>
                {r.displayName}
                {r.sellPrice != null && (
                  <b style={{ color: 'var(--red)', fontFamily: 'var(--font-mono)' }}> · تبيع بـ{fmt2(r.sellPrice)}</b>
                )}
              </span>
            ))}
          </div>
        </Card>
      )}

      {rows == null ? <div style={{ padding: 50, textAlign: 'center' }}><Spinner/></div>
        : !visible.length ? <Card><Empty icon="🚚" title="لا شركات في المقارنة" sub="فعّل الشركات الموجودة في إكسل أسعار البيع"/></Card>
        : (
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="m-cards" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: 'var(--surface2)' }}>
                  {['اسم شركة الشحن', 'الحالة في لمحة', 'تكلفة الناقل', 'رسوم لمحة', 'ربح لمحة', 'البيع في لمحة', 'البيع في أوتو', 'البيع في طرود', 'أفضل سعر'].map((h, i) => <th key={i} style={th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {visible.map(r => {
                    // التكلفة تشمل الوقود، فالربح = البيع − التكلفة صافٍ مباشرة
                    const profit = (r.sellPrice != null && r.costPrice != null) ? r.sellPrice - r.costPrice : null;
                    const pColor = profit == null ? 'var(--muted2)' : profit <= 0 ? 'var(--red)' : profit < 1.5 ? 'var(--gold)' : 'var(--green)';
                    // أفضل سعر = الأقل بين المنصّات الأربع (يُحسب حيّاً من الصف).
                    // ⚠️ الخانة الفارغة تعني «لم يُدخَل سعر» لا «غير متاح على تلك
                    // المنصّة» — فمقارنة سعر لمحة وحده بلا منافس ليست مقارنة.
                    // بلا هذا الحارس كانت الشاشة تعلن «🟢 لمحة الأرخص» لخمسة
                    // ناقلين لا نملك عنهم أي سعر منافس (إيمايل · J&T · ثابت ·
                    // ويبك · أتاك) — استنتاج تسعيري خاطئ من غياب البيانات.
                    const prices = [['لمحة', r.sellPrice], ['أوتو', r.sellAuto], ['طرود', r.sellTorod]].filter(([, v]) => v != null && Number.isFinite(v));
                    const comparable = prices.length >= 2;
                    const best = comparable ? prices.reduce((a, b) => (b[1] < a[1] ? b : a)) : null;
                    const bestIsLamha = best && best[0] === 'لمحة';
                    const missingCount = 3 - prices.length;
                    return (
                    <tr key={r.id} style={{ borderTop: '1px solid var(--border)', opacity: r.isActive ? 1 : 0.5 }}>
                      <td data-label="اسم شركة الشحن" style={{ ...cell, fontWeight: 700 }}>
                        {r.displayName}
                      </td>
                      <td data-label="الحالة في لمحة" style={cell}>
                        {r.competitorOnly
                          ? <span style={{ fontSize: 10.5, color: 'var(--muted2)' }}>منافس</span>
                          : <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 9px', borderRadius: 20,
                              color: r.isActive ? 'var(--green)' : 'var(--red)',
                              background: r.isActive ? 'color-mix(in srgb, var(--green) 14%, transparent)' : 'color-mix(in srgb, var(--red) 14%, transparent)' }}>
                              {r.isActive ? 'نشط' : 'غير نشط'}
                            </span>}
                      </td>
                      {/* تكلفة الناقل وحدها — بلا رسوم لمحة. كانت مدموجتين في
                          رقم واحد اسمه «سعر التكلفة»، فيختفي ما تكسبه لمحة
                          داخل بند اسمه «تكلفة» (قرار المستخدم 2026-07-29). */}
                      <td data-label="تكلفة الناقل" style={{ ...cell, fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--accent)' }}>
                        {r.costPrice != null
                          ? fmt2(r.costPrice - (r.markup || 0))
                          : (
                            // ⚠️ شركة **نشطة تبيع بلا تكلفة معروفة** — لا ربح
                            // محسوب، ولا فاتورة قابلة للتدقيق (المحرّك يقيس
                            // المفوتر على العقد). العلامة تجعلها ظاهرة بدل أن
                            // تُكتشف بالصدفة (طلب المستخدم 2026-07-29).
                            <span title="نشطة وتبيع بلا تكلفة معروفة — الربح غير محسوب وفواتيرها لا تُدقَّق"
                              style={{
                                fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 10.5,
                                color: 'var(--red)', background: 'color-mix(in srgb, var(--red) 12%, transparent)',
                                border: '1px solid color-mix(in srgb, var(--red) 35%, transparent)',
                                borderRadius: 20, padding: '2px 9px', whiteSpace: 'nowrap',
                              }}>
                              ⚠️ {r.costReason || 'بلا تكلفة'}
                            </span>
                          )}
                      </td>
                      <td data-label="رسوم لمحة" style={{ ...cell, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--brand)' }}>
                        {r.costPrice != null ? fmt2(r.markup || 0) : '—'}
                      </td>
                      <td data-label="ربح لمحة" style={{ ...cell, fontFamily: 'var(--font-mono)', fontWeight: 800, color: pColor }}>
                        {profit != null ? `${profit > 0 ? '+' : ''}${fmt2(profit)}` : '—'}
                      </td>
                      <td data-label="البيع في لمحة" style={cell}>{priceCellNode(r, 'lamha')}</td>
                      <td data-label="البيع في أوتو" style={cell}>{priceCellNode(r, 'auto')}</td>
                      <td data-label="البيع في طرود" style={cell}>{priceCellNode(r, 'torod')}</td>
                      <td data-label="أفضل سعر" style={{ ...cell, fontWeight: 800 }}>
                        {best ? (
                          <span style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1.25 }}>
                            <span style={{ fontFamily: 'var(--font-mono)' }}>{fmt2(best[1])}</span>
                            <span style={{ fontSize: 10, fontWeight: 700, color: bestIsLamha ? 'var(--green)' : 'var(--gold)' }}>
                              {bestIsLamha ? '🟢 لمحة الأرخص' : `🟡 ${best[0]} أرخص`}
                            </span>
                            {missingCount > 0 && (
                              <span style={{ fontSize: 9, fontWeight: 400, color: 'var(--muted2)', fontFamily: 'var(--font-sans)' }}>
                                من {prices.length} منصّات · {missingCount} بلا سعر
                              </span>
                            )}
                          </span>
                        ) : (
                          <span style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1.25 }}>
                            <span style={{ color: 'var(--muted2)' }}>—</span>
                            <span style={{ fontSize: 9.5, fontWeight: 400, color: 'var(--muted2)', fontFamily: 'var(--font-sans)' }}>
                              {prices.length === 1 ? 'لا سعر منافس مُدخَل' : 'لا أسعار مُدخَلة'}
                            </span>
                          </span>
                        )}
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
        <b>كل الأرقام بدون ضريبة</b>، و<b>أسعار البيع للعرض فقط</b> — تُدخَل من مسار واحد مضبوط لا من الجدول، لأن الخطأ هنا صامت (سعر شامل الضريبة في عمود بلا ضريبة، أو سعر النسخة القياسية على سجلّ النسخة الحصرية).
        أسعار طرود وصلت شاملة الضريبة وأُدخلت مقسومة على 1.15 (لا مضروبة في 0.85 — الفرق ~1.7% لكل سعر).
        الخانة الفارغة تعني <b>لم يُدخَل سعر</b>، و«غير متاحة» تعني أن المنصّة لا تقدّم هذه الشركة. و«أفضل سعر» لا يُعلن فائزاً إلا بوجود سعرين فأكثر. سعر التكلفة يتبع العقد.
      </div>
    </Pad>
  );
}

// إعادة حساب سعر التكلفة عند تغيّر الهامش أو تجاوزه لناقل.
function recompute(r, globalMarkup) {
  const m = r.markupOverride != null ? r.markupOverride : globalMarkup;
  const fuelAmt = r.base != null ? Number((r.base * (r.fuelPct || 0)).toFixed(2)) : 0;
  return { ...r, markup: m, fuelAmt, costPrice: r.base != null ? Number((r.base + fuelAmt + m).toFixed(2)) : null };
}

function Pad({ children }) { return <div style={{ padding: '24px 28px 80px', maxWidth: 1320, margin: '0 auto' }}>{children}</div>; }

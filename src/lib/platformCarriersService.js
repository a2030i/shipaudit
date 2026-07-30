// شركات المنصّة المفعّلة — طبقة العرض/البيع فوق العقود.
// التكلفة الأساسية تُقرأ **حيّاً** من عقد كل ناقل (لا تُخزَّن) فتتبع أي تعديل عقد،
// وسعر التكلفة = التكلفة الأساسية + هامش قياسي (افتراضي 2 ر.س، قابل للتعديل).
// سعر البيع يُملأ لاحقاً (من إكسل). المصدر: جدول platform_carriers + carriers.
import { supabase } from './supabase.js';
import { loadCarriers } from './coreService.js';

// يستخرج التكلفة الأساسية المحلية من عقد الناقل (سعر أول شريحة للسعودية).
// يتعامل مع: مصفوفة مسطّحة (ثابت)، مصفوفة بشرائح (حتى Xكغ ثم /كغ)، مناطق (Zone A)،
// الوسيط (subCarrier — متعدد)، والدولي (جدول lookup — لا أساس محلي).
export function extractBaseCost(carrier) {
  const contracts = (carrier?.contracts || []).filter(x => x && x.pricing);
  if (!contracts.length) return { base: null, reason: 'بلا عقد' };
  // فضّل العقد **المحلي** (له شريحة Saudi Arabia مصفوفة) — سمسا مثلاً لها عقدان
  // (GCC أولاً + محلي) وأخذ الأول يعطي سعر عُمان 35 بدل المحلي 13.
  let c = null, arr = null;
  for (const ct of contracts) {
    if (Array.isArray(ct.pricing?.['Saudi Arabia']) && ct.pricing['Saudi Arabia'].length) { c = ct; arr = ct.pricing['Saudi Arabia']; break; }
  }
  if (!arr) {   // لا عقد محلي صريح — Zone A ثم أي مصفوفة (تجاهل الوسيط)
    for (const ct of contracts) {
      if (ct.pricingKey === 'subCarrier') continue;
      const a = ct.pricing['Zone A'] || Object.values(ct.pricing).find(v => Array.isArray(v));
      if (Array.isArray(a) && a.length) { c = ct; arr = a; break; }
    }
  }
  if (!c || !arr) {
    if (contracts.some(x => x.pricingKey === 'subCarrier')) return { base: null, reason: 'وسيط (أسعار متعددة)' };
    return { base: null, reason: 'دولي/جدول' };
  }
  const first = arr[0];
  const base = Number(first.price);
  if (!Number.isFinite(base)) return { base: null, reason: 'غير محدّد' };
  // ⚠️ **لا تقسم على 1.15 هنا.** سعر العقد **قبل الضريبة دائماً** — بما فيه
  // ويبك. العلم `deliveryInclusiveVat` يصف **عمود الفاتورة** لا سعر العقد:
  // ويبك تكتب التوصيل في فاتورتها شاملاً الضريبة، فيقسمه `auditRow` على
  // 1.15 ليطابق **سعر العقد قبل الضريبة** (انظر التعليق في engine/audit.js).
  // قسمة الأساس هنا تُنقص التكلفة 1.83 ر.س وتُظهر ربحاً وهمياً.
  const excess = arr[1]?.pricePerUnit ?? c.excessPerKg ?? null;
  return {
    base,
    upTo: first.upTo ?? null,                              // حتى كم كغ يشمل الأساس
    excessPerKg: excess != null ? Number(excess) : null,  // /كغ زائد
    fuelPct: Number(c.fuelPct) || 0,
    codFee: Number(c.codFee) || 0,
    posFeePct: Number(c.posFeePct) || 0,
    inclusiveVat: !!c.deliveryInclusiveVat,
    label: c.label || null,
    reason: null,
  };
}

export async function loadPlatformMarkup() {
  const { data } = await supabase.from('app_settings').select('value').eq('key', 'platform_markup').maybeSingle();
  const m = Number(data?.value?.markup);
  return Number.isFinite(m) ? m : 2;
}

export async function savePlatformMarkup(markup) {
  const { error } = await supabase.from('app_settings')
    .upsert({ key: 'platform_markup', value: { markup: Number(markup) || 0 } }, { onConflict: 'key' });
  if (error) throw error;
}

export async function loadPlatformCarriers() {
  const [carriers, pcRes, compRes, markup] = await Promise.all([
    loadCarriers(),
    supabase.from('platform_carriers').select('*'),
    supabase.from('platform_competitors').select('*').order('sell_auto', { ascending: true, nullsFirst: false }),
    loadPlatformMarkup(),
  ]);
  const pcMap = new Map((pcRes.data || []).map(r => [r.carrier_id, r]));
  const ourRows = (carriers || []).map(cr => {
    const pc = pcMap.get(cr.id) || {};
    const cost = extractBaseCost(cr);
    const m = pc.markup != null ? Number(pc.markup) : markup;
    // التكلفة تشمل الوقود (ندفعه للناقل): الأساس + (الأساس × الوقود%) + الهامش
    const fuelAmt = cost.base != null ? Number((cost.base * (cost.fuelPct || 0)).toFixed(2)) : 0;
    const costPrice = cost.base != null ? Number((cost.base + fuelAmt + m).toFixed(2)) : null;
    const sellPrice = pc.sell_price != null ? Number(pc.sell_price) : null;
    // أسعار المنافسين + أفضل سعر (الأقل بين المنصّات الأربع) واسم صاحبه
    const plat = [
      { key: 'lamha', label: 'لمحة',  v: sellPrice },
      { key: 'auto',  label: 'أوتو',  v: pc.sell_auto  != null ? Number(pc.sell_auto)  : null },
      { key: 'torod', label: 'طرود',  v: pc.sell_torod != null ? Number(pc.sell_torod) : null },
    ].filter(x => x.v != null && Number.isFinite(x.v));
    const best = plat.length ? plat.reduce((a, b) => (b.v < a.v ? b : a)) : null;
    return {
      id: cr.id, name: cr.name,
      // اسم المنصّة (كما في إكسل العملاء) للعرض — يسقط لاسم النظام إن لم يُضبط
      displayName: pc.platform_name || cr.name,
      platformName: pc.platform_name || null,
      isActive: !!pc.is_active,
      freeReturn: !!pc.free_return,
      unavailable: pc.unavailable || [],   // منصّات لا تقدّم هذا الناقل → «غير متاحة»
      sellPrice,
      sellAuto:  pc.sell_auto  != null ? Number(pc.sell_auto)  : null,
      sellTorod: pc.sell_torod != null ? Number(pc.sell_torod) : null,
      bestPrice: best ? best.v : null,
      bestPlatform: best ? best.label : null,
      bestIsLamha: best ? best.key === 'lamha' : false,
      markup: m,
      markupOverride: pc.markup != null ? Number(pc.markup) : null,
      base: cost.base,
      costReason: cost.reason,
      upTo: cost.upTo,
      excessPerKg: cost.excessPerKg,
      fuelPct: cost.fuelPct || 0,
      fuelAmt,
      codFee: cost.codFee || 0,
      posFeePct: cost.posFeePct || 0,
      inclusiveVat: !!cost.inclusiveVat,
      costPrice,
      contractLabel: cost.label,
      hasContract: (cr.contracts || []).length > 0,
      notes: pc.notes || null,
    };
  });

  // شركات لدى المنافسين فقط — تُعرَض كصفوف عادية بـ«لمحة = غير متاحة» (بلا عقد/تكلفة).
  const compRows = (compRes.data || []).map(c => {
    const isLamha = c.is_lamha === true;   // شركة لمحة (نشطة أو لا، بسعر أو بلا) مقابل منافس صرف
    const lamhaPrice = c.sell_lamha != null ? Number(c.sell_lamha) : null;
    const plat = [
      { key: 'lamha', label: 'لمحة', v: lamhaPrice },
      { key: 'auto',  label: 'أوتو', v: c.sell_auto  != null ? Number(c.sell_auto)  : null },
      { key: 'torod', label: 'طرود', v: c.sell_torod != null ? Number(c.sell_torod) : null },
    ].filter(x => x.v != null && Number.isFinite(x.v));
    const best = plat.length ? plat.reduce((a, b) => (b.v < a.v ? b : a)) : null;
    return {
      id: `comp_${c.id}`, compId: c.id, isCompetitor: true,
      // شركة لمحة (بلا عقد) مقابل منافس صرف (لمحة غير متاحة)
      competitorOnly: !isLamha,
      name: c.name, displayName: c.name, platformName: c.name,   // الاسم طبق إكسل لمحة بالضبط
      service: c.service || null,
      isActive: c.active !== false, freeReturn: false,           // غير النشط في لمحة يُخفى
      competitorRow: true,
      unavailable: isLamha ? [] : ['lamha'],   // لمحة غير متاحة فقط للمنافس الصرف (شركة لمحة تقبل سعراً)
      sellPrice: lamhaPrice,
      sellAuto:  c.sell_auto  != null ? Number(c.sell_auto)  : null,
      sellTorod: c.sell_torod != null ? Number(c.sell_torod) : null,
      bestPrice: best ? best.v : null, bestPlatform: best ? best.label : null, bestIsLamha: best ? best.key === 'lamha' : false,
      markup, markupOverride: null,
      base: null, costReason: null, fuelPct: 0, fuelAmt: 0, codFee: 0, posFeePct: 0,
      // تكلفة يدوية للصفوف بلا عقد. عمود `cost` يحمل **تكلفة الناقل وحدها**،
      // بينما `costPrice` في صفوف عقودنا يشمل رسوم لمحة — فنضيفها هنا ليصير
      // المعنى واحداً في الجدول كله (وإلا طُرحت رسوم لم تُضَف: صفوف V2 كانت
      // تعرض تكلفة ناقل أقل بـ2 ر.س وربحاً أعلى بالقدر نفسه).
      costPrice: c.cost != null ? Number((Number(c.cost) + markup).toFixed(2)) : null,
      hasContract: false, notes: c.note || null,
    };
  });

  return [...ourRows, ...compRows];
}

// خيارات شركات الشحن كما يراها موظف لمحة في صفحة المقارنة بالضبط.
// لا نعرض منافسي المنصّات ولا الشركات غير النشطة، ونحفظ displayName مع
// التذكرة حتى يبقى الاسم التجاري واضحاً حتى لو تغيّر لاحقاً في الإعدادات.
export async function loadLamhaCarrierOptions() {
  const rows = await loadPlatformCarriers();
  return rows
    .filter(r => r.isActive && !r.competitorOnly)
    .map(r => ({
      id: r.id,
      name: r.displayName || r.name,
      sourceName: r.name,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}

// حفظ سعر منافس (أوتو/طرود) — للشركات الموجودة لدى المنافسين فقط.
export async function savePlatformCompetitor(compId, patch, userId = null) {
  const { error } = await supabase.from('platform_competitors')
    .update({ ...patch, updated_at: new Date().toISOString(), updated_by: userId }).eq('id', compId);
  if (error) throw error;
}

// حفظ حقل واحد أو أكثر لناقل منصّة (upsert آمن — الصف قد لا يكون موجوداً).
export async function savePlatformCarrier(carrierId, patch, userId = null) {
  const row = { carrier_id: carrierId, updated_at: new Date().toISOString(), updated_by: userId, ...patch };
  const { error } = await supabase.from('platform_carriers').upsert(row, { onConflict: 'carrier_id' });
  if (error) throw error;
}

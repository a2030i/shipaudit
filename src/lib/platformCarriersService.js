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
  const [carriers, pcRes, markup] = await Promise.all([
    loadCarriers(),
    supabase.from('platform_carriers').select('*'),
    loadPlatformMarkup(),
  ]);
  const pcMap = new Map((pcRes.data || []).map(r => [r.carrier_id, r]));
  return (carriers || []).map(cr => {
    const pc = pcMap.get(cr.id) || {};
    const cost = extractBaseCost(cr);
    const m = pc.markup != null ? Number(pc.markup) : markup;
    const costPrice = cost.base != null ? Number((cost.base + m).toFixed(2)) : null;
    const sellPrice = pc.sell_price != null ? Number(pc.sell_price) : null;
    // أسعار المنافسين + أفضل سعر (الأقل بين المنصّات الأربع) واسم صاحبه
    const plat = [
      { key: 'lamha', label: 'لمحة',  v: sellPrice },
      { key: 'auto',  label: 'أوتو',  v: pc.sell_auto  != null ? Number(pc.sell_auto)  : null },
      { key: 'torod', label: 'طرود',  v: pc.sell_torod != null ? Number(pc.sell_torod) : null },
      { key: 'trek',  label: 'تريك',  v: pc.sell_trek  != null ? Number(pc.sell_trek)  : null },
    ].filter(x => x.v != null && Number.isFinite(x.v));
    const best = plat.length ? plat.reduce((a, b) => (b.v < a.v ? b : a)) : null;
    return {
      id: cr.id, name: cr.name,
      isActive: !!pc.is_active,
      freeReturn: !!pc.free_return,
      sellPrice,
      sellAuto:  pc.sell_auto  != null ? Number(pc.sell_auto)  : null,
      sellTorod: pc.sell_torod != null ? Number(pc.sell_torod) : null,
      sellTrek:  pc.sell_trek  != null ? Number(pc.sell_trek)  : null,
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
      codFee: cost.codFee || 0,
      posFeePct: cost.posFeePct || 0,
      inclusiveVat: !!cost.inclusiveVat,
      costPrice,
      contractLabel: cost.label,
      hasContract: (cr.contracts || []).length > 0,
      notes: pc.notes || null,
    };
  });
}

// حفظ حقل واحد أو أكثر لناقل منصّة (upsert آمن — الصف قد لا يكون موجوداً).
export async function savePlatformCarrier(carrierId, patch, userId = null) {
  const row = { carrier_id: carrierId, updated_at: new Date().toISOString(), updated_by: userId, ...patch };
  const { error } = await supabase.from('platform_carriers').upsert(row, { onConflict: 'carrier_id' });
  if (error) throw error;
}

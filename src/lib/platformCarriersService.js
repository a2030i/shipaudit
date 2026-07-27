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
  const c = (carrier?.contracts || []).find(x => x && x.pricing) || null;
  if (!c) return { base: null, reason: 'بلا عقد' };
  if (c.pricingKey === 'subCarrier') return { base: null, reason: 'وسيط (أسعار متعددة)' };
  const pr = c.pricing || {};
  const arr = pr['Saudi Arabia'] || pr['Zone A']
    || Object.values(pr).find(v => Array.isArray(v));   // أول منطقة مصفوفة
  if (!Array.isArray(arr) || !arr.length) return { base: null, reason: 'دولي/جدول' };
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
    return {
      id: cr.id, name: cr.name,
      isActive: !!pc.is_active,
      freeReturn: !!pc.free_return,
      sellPrice: pc.sell_price != null ? Number(pc.sell_price) : null,
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

import { supabase } from './supabase.js';

const money = (value, digits = 2) => Number(Number(value || 0).toFixed(digits));

export function normalizeCommissionTiers(tiers = []) {
  return [...tiers]
    .map((tier) => ({
      fromOrder: Number(tier.fromOrder ?? tier.from_order ?? 0),
      toOrder: tier.toOrder === null || tier.to_order === null || tier.toOrder === '' || tier.to_order === ''
        ? null
        : Number(tier.toOrder ?? tier.to_order),
      ratePerOrder: Number(tier.ratePerOrder ?? tier.rate_per_order ?? 0),
    }))
    .sort((a, b) => a.fromOrder - b.fromOrder);
}

export function validateCommissionTiers(tiers = []) {
  const rows = normalizeCommissionTiers(tiers);
  if (!rows.length) return 'أضف شريحة عمولة واحدة على الأقل.';
  if (rows[0].fromOrder !== 1) return 'يجب أن تبدأ أول شريحة من الطلب رقم 1.';
  for (let index = 0; index < rows.length; index += 1) {
    const tier = rows[index];
    if (!Number.isFinite(tier.ratePerOrder) || tier.ratePerOrder < 0) return 'قيمة العمولة لا يمكن أن تكون سالبة.';
    if (tier.toOrder !== null && tier.toOrder < tier.fromOrder) return 'نهاية الشريحة يجب أن تكون بعد بدايتها.';
    if (index < rows.length - 1) {
      if (tier.toOrder === null) return 'الشريحة المفتوحة يجب أن تكون الأخيرة.';
      if (rows[index + 1].fromOrder !== tier.toOrder + 1) return 'شرائح العمولة يجب أن تكون متصلة بلا فجوات.';
    } else if (tier.toOrder !== null) {
      return 'اترك نهاية آخر شريحة مفتوحة لتغطية جميع الطلبات.';
    }
  }
  return null;
}

export function computeVariableCommission(tiers, orders) {
  const count = Math.max(0, Math.floor(Number(orders) || 0));
  return money(normalizeCommissionTiers(tiers).reduce((total, tier) => {
    const upper = tier.toOrder === null ? count : Math.min(count, tier.toOrder);
    const tierOrders = Math.max(0, upper - tier.fromOrder + 1);
    return total + (tierOrders * tier.ratePerOrder);
  }, 0));
}

export function computeBreakEvenOrders({ monthlySalary, targetCostPerOrder, tiers }) {
  const salary = Math.max(0, Number(monthlySalary) || 0);
  const target = Number(targetCostPerOrder) || 0;
  if (target <= 0 || validateCommissionTiers(tiers)) return null;

  let progress = 0;
  for (const tier of normalizeCommissionTiers(tiers)) {
    const margin = target - tier.ratePerOrder;
    if (tier.toOrder === null) {
      if (margin === 0 && progress >= salary) return tier.fromOrder;
      if (margin <= 0) return null;
      return (tier.fromOrder - 1) + Math.max(1, Math.ceil((salary - progress) / margin));
    }
    const width = tier.toOrder - tier.fromOrder + 1;
    if (margin === 0 && progress >= salary) return tier.fromOrder;
    if (margin > 0 && progress + (width * margin) >= salary) {
      return (tier.fromOrder - 1) + Math.max(1, Math.ceil((salary - progress) / margin));
    }
    progress += width * margin;
  }
  return null;
}

export function computeMarketerPreview(plan, performance) {
  if (!plan) return null;
  const orders = Math.max(0, Number(performance?.eligible_orders) || 0);
  const variableCommission = computeVariableCommission(plan.tiers, orders);
  const totalCost = money(Number(plan.monthly_salary || 0) + variableCommission);
  const effectiveCost = orders > 0 ? money(totalCost / orders, 4) : null;
  const breakEvenOrders = computeBreakEvenOrders({
    monthlySalary: plan.monthly_salary,
    targetCostPerOrder: plan.target_cost_per_order,
    tiers: plan.tiers,
  });
  return {
    orders,
    variableCommission,
    totalCost,
    effectiveCost,
    breakEvenOrders,
    achieved: breakEvenOrders !== null && orders >= breakEvenOrders,
    gapOrders: breakEvenOrders === null ? null : Math.max(0, breakEvenOrders - orders),
    progress: breakEvenOrders ? Math.min(100, Math.round((orders / breakEvenOrders) * 100)) : 0,
  };
}

function activePlanForMonth(plans, period) {
  return plans
    .filter((plan) => plan.effective_month <= period)
    .sort((a, b) => b.effective_month.localeCompare(a.effective_month))[0] || null;
}

export async function loadMarketersDashboard(period) {
  const [marketersResult, plansResult, tiersResult, monthsResult, historyResult] = await Promise.all([
    supabase.from('marketing_marketers').select('*').order('created_at'),
    supabase.from('marketing_compensation_plans').select('*').order('effective_month'),
    supabase.from('marketing_commission_tiers').select('*').order('from_order'),
    supabase.from('marketing_monthly_performance').select('*').order('period', { ascending: false }),
    supabase.from('marketing_status_history').select('*').order('period', { ascending: false }).limit(100),
  ]);
  const failed = [marketersResult, plansResult, tiersResult, monthsResult, historyResult].find((result) => result.error);
  if (failed) throw failed.error;

  const tiersByPlan = new Map();
  for (const tier of tiersResult.data || []) {
    const rows = tiersByPlan.get(tier.plan_id) || [];
    rows.push(tier);
    tiersByPlan.set(tier.plan_id, rows);
  }
  const plansByMarketer = new Map();
  for (const plan of plansResult.data || []) {
    const rows = plansByMarketer.get(plan.marketer_id) || [];
    rows.push({ ...plan, tiers: tiersByPlan.get(plan.id) || [] });
    plansByMarketer.set(plan.marketer_id, rows);
  }
  const performanceByKey = new Map((monthsResult.data || []).map((row) => [`${row.marketer_id}:${row.period}`, row]));

  const marketers = (marketersResult.data || []).map((marketer) => {
    const plans = plansByMarketer.get(marketer.id) || [];
    const plan = activePlanForMonth(plans, period);
    const performance = performanceByKey.get(`${marketer.id}:${period}`) || null;
    const preview = performance?.close_state === 'closed'
      ? {
          orders: Number(performance.eligible_orders) || 0,
          variableCommission: Number(performance.variable_commission_snapshot) || 0,
          totalCost: Number(performance.total_cost_snapshot) || 0,
          effectiveCost: performance.effective_cost_snapshot === null ? null : Number(performance.effective_cost_snapshot),
          breakEvenOrders: performance.break_even_orders_snapshot === null ? null : Number(performance.break_even_orders_snapshot),
          achieved: Boolean(performance.achieved_break_even),
          gapOrders: performance.break_even_orders_snapshot === null ? null : Math.max(0, Number(performance.break_even_orders_snapshot) - Number(performance.eligible_orders || 0)),
          progress: performance.break_even_orders_snapshot
            ? Math.min(100, Math.round((Number(performance.eligible_orders || 0) / Number(performance.break_even_orders_snapshot)) * 100))
            : 0,
        }
      : computeMarketerPreview(plan, performance);
    return { ...marketer, plans, plan, performance, preview };
  });

  return {
    marketers,
    history: historyResult.data || [],
    allPerformance: monthsResult.data || [],
  };
}

function rpcError(error) {
  const code = error?.message || '';
  const messages = {
    not_allowed: 'لا تملك الصلاحية المطلوبة.',
    tiers_required: 'أضف شريحة عمولة واحدة على الأقل.',
    tiers_must_be_contiguous_and_open_ended: 'شرائح العمولة يجب أن تبدأ من 1، تكون متصلة، وتنتهي بشريحة مفتوحة.',
    month_already_closed: 'هذا الشهر مقفل ولا يمكن تعديله.',
    month_not_finished: 'لا يمكن اعتماد النتيجة الرسمية قبل انتهاء الشهر.',
    close_months_in_order: 'أقفل الأشهر بالترتيب الزمني حتى لا تتشوّه حركة اللون.',
    orders_not_recorded: 'سجّل عدد الطلبات أولاً ثم أقفل الشهر.',
    plan_not_found_for_month: 'لا توجد خطة تعويض سارية لهذا الشهر.',
    plan_month_locked: 'هذه الخطة استُخدمت في شهر مقفل؛ أنشئ خطة من شهر أحدث.',
  };
  const key = Object.keys(messages).find((item) => code.includes(item));
  return new Error(key ? messages[key] : code || 'تعذّر تنفيذ العملية.');
}

export async function createMarketer(payload) {
  const errorMessage = validateCommissionTiers(payload.tiers);
  if (errorMessage) throw new Error(errorMessage);
  const { data, error } = await supabase.rpc('marketing_create_marketer', {
    p_name: payload.name,
    p_phone: payload.phone || null,
    p_start_month: payload.startMonth,
    p_monthly_salary: Number(payload.monthlySalary) || 0,
    p_target_cost_per_order: Number(payload.targetCostPerOrder),
    p_monthly_order_target: payload.monthlyOrderTarget === '' ? null : Number(payload.monthlyOrderTarget),
    p_tiers: normalizeCommissionTiers(payload.tiers).map((tier) => ({
      from_order: tier.fromOrder,
      to_order: tier.toOrder,
      rate_per_order: tier.ratePerOrder,
    })),
    p_notes: payload.notes || null,
  });
  if (error) throw rpcError(error);
  return data;
}

export async function createCompensationPlan(marketerId, payload) {
  const errorMessage = validateCommissionTiers(payload.tiers);
  if (errorMessage) throw new Error(errorMessage);
  const { data, error } = await supabase.rpc('marketing_create_plan', {
    p_marketer_id: marketerId,
    p_effective_month: payload.effectiveMonth,
    p_monthly_salary: Number(payload.monthlySalary) || 0,
    p_target_cost_per_order: Number(payload.targetCostPerOrder),
    p_monthly_order_target: payload.monthlyOrderTarget === '' ? null : Number(payload.monthlyOrderTarget),
    p_tiers: normalizeCommissionTiers(payload.tiers).map((tier) => ({
      from_order: tier.fromOrder,
      to_order: tier.toOrder,
      rate_per_order: tier.ratePerOrder,
    })),
  });
  if (error) throw rpcError(error);
  return data;
}

export async function saveMarketerMonth(marketerId, period, eligibleOrders, notes) {
  const { data, error } = await supabase.rpc('marketing_save_month', {
    p_marketer_id: marketerId,
    p_period: period,
    p_eligible_orders: Number(eligibleOrders) || 0,
    p_notes: notes || null,
  });
  if (error) throw rpcError(error);
  return data;
}

export async function closeMarketerMonth(marketerId, period) {
  const { data, error } = await supabase.rpc('marketing_close_month', {
    p_marketer_id: marketerId,
    p_period: period,
  });
  if (error) throw rpcError(error);
  return Array.isArray(data) ? data[0] : data;
}

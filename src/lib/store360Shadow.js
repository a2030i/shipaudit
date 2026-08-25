import { supabase } from './supabase.js';

const runtimeEnv = import.meta.env || {};
export const STORE_360_CORE_READ_MODE = runtimeEnv.VITE_STORE_360_CORE_READ_MODE || 'core';
const enabled = runtimeEnv.VITE_STORE_360_CORE_SHADOW_READ === '1'
  || STORE_360_CORE_READ_MODE === 'shadow';

const money = value => Number(Number(value ?? 0).toFixed(2));
const sameMoney = (left, right) => Math.abs(money(left) - money(right)) < 0.01;

function compare(oldCore, nextCore) {
  const finance = nextCore?.sections?.finance;
  const next = finance?.visibility === 'visible' ? finance.data : null;
  const old = oldCore?.financial;
  const mismatches = [];

  if (String(nextCore?.storeId || '') !== String(oldCore?.store?.storeId || '')) {
    mismatches.push({ field: 'storeId' });
  }

  if (old && next) {
    const checks = [
      ['collectibleDue', old.outstanding, next.collectibleDue],
      ['overdue', old.overdue, next.overdue],
      ['aging.invoice1To15', old.aging?.b0_15, next.aging?.invoice1To15],
      ['aging.invoice16To30', old.aging?.b16_30, next.aging?.invoice16To30],
      ['aging.invoice31To60', old.aging?.b31_60, next.aging?.invoice31To60],
      ['aging.invoice61To90', old.aging?.b61_90, next.aging?.invoice61To90],
      ['aging.invoiceOver90', old.aging?.b90p, next.aging?.invoiceOver90],
      ['aging.openingBalance', old.aging?.opening, next.aging?.openingBalance],
    ];
    for (const [field, before, after] of checks) {
      if (!sameMoney(before, after)) mismatches.push({ field, before: money(before), after: money(after) });
    }
  } else if (Boolean(old) !== Boolean(next) && !['ambiguous', 'unlinked', 'unresolved'].includes(finance?.status)) {
    mismatches.push({ field: 'finance.availability' });
  }

  return mismatches;
}

function sectionSource(section, label) {
  if (section?.visibility === 'restricted') {
    return { status: 'restricted', label, updatedAt: null, freshnessStatus: null, error: null };
  }
  const value = section?.source;
  if (!value || value.availabilityStatus === 'unavailable') {
    return {
      status: 'unavailable', label, updatedAt: value?.dataAsOf || null,
      freshnessStatus: value?.freshnessStatus || 'unavailable',
      error: value?.errorCode || 'المصدر غير متاح',
    };
  }
  return {
    status: section?.status === 'empty' ? 'empty' : 'available',
    label,
    updatedAt: value.dataAsOf || value.lastSuccessfulSyncAt || null,
    freshnessStatus: value.freshnessStatus || null,
    error: value.errorCode || null,
  };
}

function normalizedTask(data) {
  if (!data) return null;
  return {
    id: data.taskId || null,
    trigger: data.trigger || null,
    stage: data.stage || null,
    assigned_to: data.assignedTo || null,
    promise_amount: data.promiseAmount ?? null,
    promise_date: data.promiseDate || null,
    promise_status: data.promiseStatus || null,
    snooze_until: data.snoozeUntil || null,
    updated_at: data.updatedAt || null,
  };
}

function prefetchedWork(sections) {
  const salesData = sections?.sales?.visibility === 'visible' ? sections.sales.data : null;
  const task = sections?.collections?.visibility === 'visible'
    ? normalizedTask(sections.collections.data)
    : null;
  const account = salesData ? {
    sales_stage: salesData.stage || null,
    last_outcome: salesData.lastOutcome || null,
    owner_id: salesData.ownerId || null,
    owner_name: salesData.ownerName || null,
    next_action_at: salesData.nextActionAt || null,
    next_action_type: salesData.nextActionType || null,
    last_touch_at: salesData.lastTouchAt || null,
    updated_at: salesData.updatedAt || null,
  } : null;
  const candidates = [
    account?.next_action_at ? { at: account.next_action_at, label: account.next_action_type || 'متابعة مبيعات', source: 'المبيعات' } : null,
    task?.promise_date ? { at: task.promise_date, label: 'وعد تحصيل', source: 'التحصيل' } : null,
    task?.snooze_until ? { at: task.snooze_until, label: 'متابعة تحصيل', source: 'التحصيل' } : null,
  ].filter(Boolean).sort((a, b) => new Date(a.at) - new Date(b.at));
  return {
    sales: { account, activities: [], lifecycle: [], statusChanges: [] },
    tasks: task ? [task] : [], activeTask: task,
    nextAction: candidates[0] || null,
    owner: account?.owner_name || null,
    isCoreSummary: true,
    sources: {
      sales: sectionSource(sections?.sales, 'مسار مبيعات المنصة'),
      collections: sectionSource(sections?.collections, 'قائمة التحصيل'),
    },
  };
}

export function adaptStore360Core(nextCore) {
  const sections = nextCore?.sections || {};
  const identity = sections.identity?.data;
  if (sections.identity?.visibility !== 'visible' || !identity?.storeId) {
    const error = new Error('تعذر قراءة هوية المتجر من المسار المركزي');
    error.code = 'STORE_360_CORE_IDENTITY_UNAVAILABLE';
    throw error;
  }
  const finance = sections.finance?.visibility === 'visible' ? sections.finance.data : null;
  const payment = sections.lastPayment?.visibility === 'visible' ? sections.lastPayment.data : null;
  const link = sections.financialLink?.visibility === 'visible' ? sections.financialLink.data : null;
  const store = {
    storeId: identity.storeId, storeName: identity.storeName || '', phone: identity.phone || '',
    shipmentCount: Number(identity.shipmentCount) || 0,
    lastShipmentAt: identity.lastShipmentAt || null,
    integrationType: identity.integrationType || '', billingType: identity.billingType || '',
    status: identity.status || '', walletBalance: Number(identity.walletBalance) || 0,
    createdAt: identity.createdAt || null, lastTopupAt: identity.lastTopupAt || null,
  };
  return {
    store,
    customerName: link?.status === 'resolved' ? link.customerName || null : null,
    financial: finance ? {
      zohoId: finance.zohoContactId || null,
      outstanding: Number(finance.collectibleDue) || 0,
      overdue: Number(finance.overdue) || 0,
      oldestDays: Number(finance.oldestAgeDays) || 0,
      aging: {
        b0_15: Number(finance.aging?.invoice1To15) || 0,
        b16_30: Number(finance.aging?.invoice16To30) || 0,
        b31_60: Number(finance.aging?.invoice31To60) || 0,
        b61_90: Number(finance.aging?.invoice61To90) || 0,
        b90p: Number(finance.aging?.invoiceOver90) || 0,
        opening: Number(finance.aging?.openingBalance) || 0,
      },
      lastPaymentDate: payment?.date || null,
      lastPaymentAmount: Number(payment?.amount) || 0,
      invoiceCount: Number(finance.openInvoiceCount) || 0,
      balanceSyncIssue: !!finance.balanceSyncIssue,
      balanceSyncGap: Number(finance.balanceSyncGap) || 0,
      balanceSyncOverage: Number(finance.balanceSyncOverage) || 0,
    } : null,
    sharedContactStores: Array.isArray(identity.sharedContactStores) ? identity.sharedContactStores : [],
    sources: {
      identity: sectionSource(sections.identity, 'دليل متاجر لمحة'),
      finance: sectionSource(sections.finance, 'Zoho Books + محفظة لمحة'),
      payments: sectionSource(sections.lastPayment, 'دفعات Zoho Books'),
    },
    prefetchedWork: prefetchedWork(sections),
    coreSections: sections,
    readPath: 'store_360_core',
  };
}

export async function loadStore360CoreRpc(storeId, client = supabase) {
  const value = String(storeId || '').trim();
  if (!value) {
    const error = new Error('رقم المتجر مطلوب');
    error.code = 'INVALID_STORE_ID';
    throw error;
  }
  const { data, error } = await client.rpc('store_360_core', { p_store_id: value });
  if (error) throw error;
  return adaptStore360Core(data);
}

export async function runStore360CoreShadow({ storeId, oldCore, client = supabase, sink } = {}) {
  if (!enabled && !sink) return { status: 'disabled' };
  if (!storeId) return { status: 'skipped', reason: 'missing_store_id' };

  const started = performance.now();
  try {
    const { data, error } = await client.rpc('store_360_core', { p_store_id: String(storeId) });
    if (error) throw error;
    const mismatches = compare(oldCore, data);
    const result = {
      status: mismatches.length ? 'mismatch' : 'match',
      storeId: String(storeId),
      durationMs: Number((performance.now() - started).toFixed(2)),
      payloadBytes: new TextEncoder().encode(JSON.stringify(data ?? null)).length,
      mismatches,
    };
    sink?.(result);
    return result;
  } catch (error) {
    const result = {
      status: 'error', storeId: String(storeId),
      durationMs: Number((performance.now() - started).toFixed(2)),
      errorCode: error?.code || 'SHADOW_READ_FAILED',
    };
    sink?.(result);
    return result;
  }
}

export function scheduleStore360CoreShadow(args) {
  if (!enabled) return;
  queueMicrotask(() => { void runStore360CoreShadow(args); });
}

import { supabase } from './supabase.js';
import { loadCustomerMoneyDashboard } from './pnlService.js';
import { loadLatestMerchants, merchantSnapshotSourceState } from './merchantsService.js';
import { loadRetargetingLeads } from './retargetingService.js';
import {
  loadHatifTouchedPhones,
  loadNoWhatsappSet,
  loadWeakWhatsappSet,
  normalizeSaudiPhone,
} from './whatsappService.js';
import { describeCollectionAgingFilter } from './tahseelPortalTemplate.js';

export const SMART_CAMPAIGN_OBJECTIVES = Object.freeze({
  general: Object.freeze({ label: 'حملة عامة', description: 'أرقام يدوية أو Excel دون ربطها بالتحصيل أو زوهو' }),
  collection: Object.freeze({ label: 'تحصيل وسداد', description: 'فواتير زوهو والمحفظة وأعمار الدين' }),
  reactivation: Object.freeze({ label: 'إعادة تنشيط', description: 'متاجر توقفت عن الشحن حديثاً أو قديماً' }),
  sales: Object.freeze({ label: 'مبيعات وترقية', description: 'فرص المنصة والعملاء الجدد والنشطون' }),
  service: Object.freeze({ label: 'خدمة وتنبيه', description: 'رسائل تشغيلية مرتبطة بحالة المتجر' }),
});

export const SMART_CAMPAIGN_CHANNELS = Object.freeze({
  whatsapp: Object.freeze({ label: 'واتساب عبر هاتف' }),
  ivr: Object.freeze({ label: 'IVR' }),
  employee_task: Object.freeze({ label: 'مهمة للموظف' }),
  export: Object.freeze({ label: 'تصدير فقط' }),
});

export const DEFAULT_AUDIENCE_DEFINITIONS = Object.freeze({
  general: Object.freeze({
    manualRows: Object.freeze([]),
  }),
  collection: Object.freeze({
    buckets: Object.freeze(['inv61_90', 'inv90p']),
    platformStatus: 'all',
  }),
  reactivation: Object.freeze({
    segments: Object.freeze(['stopped_recent', 'stopped_long']),
    minimumIdleDays: 60,
  }),
  sales: Object.freeze({
    segments: Object.freeze(['new_active', 'topped_no_ship', 'linked_no_ship', 'registered_no_ship', 'active']),
    highValueOnly: false,
  }),
  service: Object.freeze({
    platformStatus: 'active',
    profileIncompleteOnly: false,
  }),
});

const COLLECTION_BUCKETS = Object.freeze(['inv1_15', 'inv16_30', 'inv31_60', 'inv61_90', 'inv90p', 'opening']);
const MAX_RETARGETING_ROWS = 5000;
const PAGE_SIZE = 500;

const cloneDefinition = (objective) => {
  const base = DEFAULT_AUDIENCE_DEFINITIONS[objective] || DEFAULT_AUDIENCE_DEFINITIONS.collection;
  return {
    ...base,
    ...(base.buckets ? { buckets: [...base.buckets] } : {}),
    ...(base.segments ? { segments: [...base.segments] } : {}),
    ...(base.manualRows ? { manualRows: base.manualRows.map(row => ({ ...row })) } : {}),
  };
};

export function defaultAudienceDefinition(objective = 'collection') {
  return cloneDefinition(objective);
}

function customerKey(customer, index) {
  if (customer.storeId) return `store:${customer.storeId}`;
  if (customer.zohoId) return `zoho:${customer.zohoId}`;
  return `customer:${customer.name || index}`;
}

function normalizeCollectionCustomer(customer, index) {
  const amounts = Object.fromEntries(COLLECTION_BUCKETS.map(key => [key, Math.max(0, Number(customer[key]) || 0)]));
  const name = (customer.storeName || customer.name || '').trim();
  return {
    key: customerKey(customer, index),
    to: normalizeSaudiPhone(customer.phone),
    phone: normalizeSaudiPhone(customer.phone),
    name,
    storeId: customer.storeId || null,
    source: 'customer_money',
    amounts,
    totalAmount: Math.max(0, Number(customer.owed) || 0),
    invoiceCount: Number(customer.invCnt) || 0,
    platformStatus: customer.platformStatus || '',
    lastShipmentAt: customer.lastShipmentAt || null,
    financialHold: !!customer.balanceSyncIssue,
    debtor: Math.max(0, Number(customer.owed) || 0) > 0.5,
    fields: {
      name,
      store_id: customer.storeId || '',
      full_amount: Math.max(0, Number(customer.owed) || 0),
      invoice_count: Number(customer.invCnt) || 0,
      last_shipment_at: customer.lastShipmentAt || '',
    },
  };
}

async function loadAllRetargetingRows() {
  const rows = [];
  for (let page = 0; rows.length < MAX_RETARGETING_ROWS; page += 1) {
    const result = await loadRetargetingLeads({ page, limit: PAGE_SIZE });
    rows.push(...result.rows);
    if (!result.rows.length || rows.length >= result.count || result.rows.length < PAGE_SIZE) break;
  }
  return rows.slice(0, MAX_RETARGETING_ROWS);
}

function normalizeRetargetingRow(row, index, debtorPhones) {
  const phone = normalizeSaudiPhone(row.phone);
  const name = (row.storeName || row.storeNames?.[0] || phone || `عميل ${index + 1}`).trim();
  return {
    key: phone ? `phone:${phone}` : `retargeting:${index}`,
    to: phone,
    phone,
    name,
    storeId: null,
    source: 'retargeting',
    segment: row.segment || '',
    priority: row.priority || 'none',
    highValue: !!row.highValue,
    shipmentCount: Number(row.totalShipments) || 0,
    daysSinceLast: row.daysSinceLast == null ? null : Number(row.daysSinceLast),
    wallet: Number(row.wallet) || 0,
    lastShipmentAt: row.lastShipment || null,
    financialHold: false,
    debtor: debtorPhones.has(phone),
    amount: 0,
    invoiceCount: 0,
    fields: {
      name,
      segment: row.segment || '',
      shipment_count: Number(row.totalShipments) || 0,
      days_since_last: row.daysSinceLast == null ? '' : Number(row.daysSinceLast),
      wallet: Number(row.wallet) || 0,
      last_shipment_at: row.lastShipment || '',
    },
  };
}

function normalizeMerchant(merchant, index, debtorPhones) {
  const phone = normalizeSaudiPhone(merchant.phone);
  const name = (merchant.store_name || phone || `متجر ${index + 1}`).trim();
  return {
    key: merchant.store_id ? `store:${merchant.store_id}` : `merchant:${index}`,
    to: phone,
    phone,
    name,
    storeId: merchant.store_id || null,
    source: 'merchant_snapshot',
    platformStatus: merchant.status || '',
    profileDone: merchant.profile_status === 'مكتمل',
    shipmentCount: Number(merchant.shipment_count) || 0,
    lastShipmentAt: merchant.last_shipment_at || null,
    wallet: Number(merchant.wallet_balance) || 0,
    financialHold: false,
    debtor: debtorPhones.has(phone),
    amount: 0,
    invoiceCount: 0,
    fields: {
      name,
      store_id: merchant.store_id || '',
      platform_status: merchant.status || '',
      shipment_count: Number(merchant.shipment_count) || 0,
      last_shipment_at: merchant.last_shipment_at || '',
      wallet: Number(merchant.wallet_balance) || 0,
    },
  };
}

function debtorPhoneSet(money) {
  return new Set((money?.customers || [])
    .filter(customer => Number(customer.owed || 0) > 0.5)
    .map(customer => normalizeSaudiPhone(customer.phone))
    .filter(Boolean));
}

export async function loadSmartAudienceUniverse(objective = 'collection') {
  if (objective === 'general') {
    return {
      objective,
      rows: [],
      sources: ['أرقام يدوية أو ملف Excel'],
      sourceState: { status: 'fresh', message: 'الحملة العامة مستقلة عن التحصيل وزوهو ولمحة.' },
    };
  }

  if (objective === 'collection') {
    const money = await loadCustomerMoneyDashboard();
    return {
      objective,
      rows: (money.customers || []).map(normalizeCollectionCustomer),
      sources: ['فواتير زوهو', 'محفظة لمحة', 'حالة المتجر', 'آخر شحنة'],
      sourceState: { status: 'fresh', message: 'بيانات التحصيل والجمهور متاحة.' },
    };
  }

  if (objective === 'reactivation' || objective === 'sales') {
    const [retargetingRows, money] = await Promise.all([
      loadAllRetargetingRows(),
      loadCustomerMoneyDashboard(),
    ]);
    const debtors = debtorPhoneSet(money);
    return {
      objective,
      rows: retargetingRows.map((row, index) => normalizeRetargetingRow(row, index, debtors)),
      sources: ['دليل متاجر لمحة', 'آخر شحنة', 'المحفظة', 'متابعة المبيعات'],
      sourceState: { status: 'fresh', message: 'فرص المنصة وحالة الدين متاحتان.' },
    };
  }

  const [merchantResult, money] = await Promise.all([
    loadLatestMerchants(),
    loadCustomerMoneyDashboard(),
  ]);
  const debtors = debtorPhoneSet(money);
  return {
    objective,
    rows: (merchantResult.merchants || []).map((row, index) => normalizeMerchant(row, index, debtors)),
    sources: ['دليل متاجر لمحة', 'حالة المتجر', 'آخر شحنة', 'المحفظة'],
    sourceState: merchantSnapshotSourceState(merchantResult),
  };
}

function campaignAmount(row, buckets) {
  return (buckets || []).reduce((sum, key) => sum + Math.max(0, Number(row.amounts?.[key]) || 0), 0);
}

export function filterSmartAudience(universe, objective, definition) {
  const rows = Array.isArray(universe?.rows) ? universe.rows : [];
  if (objective === 'general') {
    return normalizeManualAudienceRows(definition?.manualRows || []);
  }
  if (objective === 'collection') {
    const buckets = Array.isArray(definition?.buckets) ? definition.buckets : [];
    const agingLabel = describeCollectionAgingFilter(buckets);
    const selectionKeys = new Set(Array.isArray(definition?.selectionKeys) ? definition.selectionKeys : []);
    return rows.flatMap(row => {
      if (selectionKeys.size && !selectionKeys.has(row.key)) return [];
      if (definition?.platformStatus && definition.platformStatus !== 'all') {
        const status = row.platformStatus === 'نشط' || row.platformStatus === 'active' ? 'active'
          : row.platformStatus === 'غير نشط' || row.platformStatus === 'inactive' ? 'inactive' : 'unknown';
        if (status !== definition.platformStatus) return [];
      }
      const amount = campaignAmount(row, buckets);
      if (amount <= 0.5) return [];
      return [{
        ...row,
        amount: +amount.toFixed(2),
        count: row.invoiceCount,
        vars: [row.name, amount.toLocaleString('en-US', { maximumFractionDigits: 2 }), String(row.invoiceCount || 0)],
        fields: { ...row.fields, filtered_overdue_amount: +amount.toFixed(2), aging_filter: agingLabel },
      }];
    });
  }

  if (objective === 'reactivation') {
    const segments = new Set(definition?.segments || []);
    const minimumIdleDays = Math.max(0, Number(definition?.minimumIdleDays) || 0);
    return rows.filter(row => segments.has(row.segment)
      && (row.daysSinceLast == null || row.daysSinceLast >= minimumIdleDays));
  }

  if (objective === 'sales') {
    const segments = new Set(definition?.segments || []);
    return rows.filter(row => segments.has(row.segment) && (!definition?.highValueOnly || row.highValue));
  }

  const wantedStatus = definition?.platformStatus || 'all';
  return rows.filter(row => {
    const status = row.platformStatus === 'نشط' || row.platformStatus === 'active' ? 'active'
      : row.platformStatus === 'غير نشط' || row.platformStatus === 'inactive' ? 'inactive' : 'unknown';
    if (wantedStatus !== 'all' && status !== wantedStatus) return false;
    if (definition?.profileIncompleteOnly && row.profileDone) return false;
    return true;
  });
}

export function normalizeManualAudienceRows(rows = []) {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : []).flatMap((row, index) => {
    const raw = row && typeof row === 'object' ? row : { phone: row };
    const phone = normalizeSaudiPhone(raw.phone || raw.to || raw.mobile || raw['رقم الجوال'] || raw['الجوال']);
    if (!phone || seen.has(phone)) return [];
    seen.add(phone);
    const name = String(raw.name || raw['الاسم'] || raw.customer || raw['العميل'] || `مستلم ${index + 1}`).trim();
    return [{
      key: `manual:${phone}`,
      to: phone,
      phone,
      name,
      source: 'manual_campaign',
      amount: Math.max(0, Number(raw.amount || raw['المبلغ']) || 0),
      count: Math.max(0, Number(raw.count || raw['العدد']) || 0),
      financialHold: false,
      debtor: false,
      fields: {
        name,
        phone,
        source: 'manual_campaign',
      },
    }];
  });
}

export async function loadSmartCampaignProtections() {
  const [noWhatsapp, hatifTouched, weakPhones] = await Promise.all([
    loadNoWhatsappSet(),
    loadHatifTouchedPhones(30),
    loadWeakWhatsappSet(),
  ]);
  return { noWhatsapp, hatifTouched, weakPhones };
}

function fromCampaignRow(row) {
  return {
    id: row.id,
    name: row.name,
    objective: row.objective,
    status: row.status,
    audienceDefinition: row.audience_definition || {},
    sourceKeys: row.source_keys || [],
    channel: row.channel || null,
    channelConfig: row.channel_config || {},
    assignedHatifUserId: row.assigned_hatif_user_id || null,
    assignedHatifUserName: row.assigned_hatif_user_name || null,
    protectionSnapshot: row.protection_snapshot || {},
    audienceCount: Number(row.audience_count) || 0,
    readyCount: Number(row.ready_count) || 0,
    excludedCount: Number(row.excluded_count) || 0,
    financialAmount: Number(row.financial_amount) || 0,
    resultSummary: row.result_summary || {},
    scheduledAt: row.scheduled_at || null,
    launchedAt: row.launched_at || null,
    completedAt: row.completed_at || null,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

export async function loadSmartCampaigns(limit = 100) {
  const { data, error } = await supabase
    .from('smart_campaigns')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map(fromCampaignRow);
}

export async function saveSmartCampaign(payload, userId) {
  const row = {
    name: String(payload.name || '').trim(),
    objective: payload.objective,
    status: payload.status || 'draft',
    audience_definition: payload.audienceDefinition || {},
    source_keys: payload.sourceKeys || [],
    channel: payload.channel || null,
    channel_config: payload.channelConfig || {},
    assigned_hatif_user_id: payload.assignedHatifUserId || null,
    assigned_hatif_user_name: payload.assignedHatifUserName || null,
    protection_snapshot: payload.protectionSnapshot || {},
    audience_count: Math.max(0, Number(payload.audienceCount) || 0),
    ready_count: Math.max(0, Number(payload.readyCount) || 0),
    excluded_count: Math.max(0, Number(payload.excludedCount) || 0),
    financial_amount: Number(payload.financialAmount) || 0,
    result_summary: payload.resultSummary || {},
    scheduled_at: payload.scheduledAt || null,
    launched_at: payload.launchedAt || null,
    completed_at: payload.completedAt || null,
    updated_by: userId,
  };
  let result;
  if (payload.id) {
    result = await supabase.from('smart_campaigns').update(row).eq('id', payload.id).select('*').single();
  } else {
    result = await supabase.from('smart_campaigns').insert({ ...row, created_by: userId }).select('*').single();
  }
  if (result.error) throw result.error;
  const campaign = fromCampaignRow(result.data);
  const { error: eventError } = await supabase.from('smart_campaign_events').insert({
    campaign_id: campaign.id,
    event_type: payload.id ? 'draft_updated' : 'draft_created',
    payload: {
      status: campaign.status,
      audience_count: campaign.audienceCount,
      ready_count: campaign.readyCount,
      excluded_count: campaign.excludedCount,
      channel: campaign.channel,
    },
    created_by: userId,
  });
  if (eventError) throw eventError;
  return campaign;
}

export async function updateSmartCampaignOutcome(campaignId, patch, userId, eventType = 'channel_result') {
  const row = {
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.channel ? { channel: patch.channel } : {}),
    ...(patch.resultSummary ? { result_summary: patch.resultSummary } : {}),
    ...(patch.scheduledAt !== undefined ? { scheduled_at: patch.scheduledAt } : {}),
    ...(patch.launchedAt !== undefined ? { launched_at: patch.launchedAt } : {}),
    ...(patch.completedAt !== undefined ? { completed_at: patch.completedAt } : {}),
    updated_by: userId,
  };
  const { data, error } = await supabase.from('smart_campaigns').update(row).eq('id', campaignId).select('*').single();
  if (error) throw error;
  const { error: eventError } = await supabase.from('smart_campaign_events').insert({
    campaign_id: campaignId,
    event_type: eventType,
    payload: patch.resultSummary || {},
    created_by: userId,
  });
  if (eventError) throw eventError;
  return fromCampaignRow(data);
}

export async function createSmartCampaignTasks(campaignId, recipients, userId) {
  const rows = recipients.map((recipient, index) => ({
    campaign_id: campaignId,
    recipient_key: recipient.key || recipient.storeId || recipient.to || `recipient:${index}`,
    phone: recipient.to || null,
    display_name: recipient.name || null,
    amount: Number(recipient.amount) || 0,
    assigned_to: userId,
    status: 'todo',
    context: recipient.fields || {},
    created_by: userId,
  }));
  let saved = 0;
  for (let offset = 0; offset < rows.length; offset += 400) {
    const chunk = rows.slice(offset, offset + 400);
    const { error } = await supabase.from('smart_campaign_tasks')
      .upsert(chunk, { onConflict: 'campaign_id,recipient_key', ignoreDuplicates: true });
    if (error) throw error;
    saved += chunk.length;
  }
  return saved;
}

import { supabase } from './supabase.js';
import {
  aggregateFinancialPositions, buildFinancialPosition, loadCustomerFinancialPositions,
} from './customerFinancialPosition.js';

const runtimeEnv = import.meta.env || {};
export const RECEIVABLES_READ_MODE = runtimeEnv.VITE_RECEIVABLES_READ_MODE || 'core';

const number = value => Number(value) || 0;
const mapSettlement = row => ({
  name: row.name, zohoId: row.zoho_id || '', storeName: row.store_name,
  storeId: row.store_id || '', phone: row.phone,
  grossDue: number(row.gross_due), unusedCredit: number(row.unused_credit),
  creditOffset: number(row.credit_offset), collectibleDue: number(row.collectible_due),
  creditSurplus: number(row.credit_surplus), openingGross: number(row.opening_gross),
  openingCollectible: number(row.opening_collectible), coveredFully: !!row.covered_fully,
});

function adaptSummary(source = {}, pageRows = [], financialPositions = []) {
  const aging = source.aging || {};
  const campaign = source.campaignAging || {};
  const financialTotals = aggregateFinancialPositions(financialPositions);
  const outstanding = financialPositions.length
    ? financialTotals.operationalCollectible
    : number(source.outstanding);
  const unpaid = source.zohoUnpaidInvoices == null ? null : number(source.zohoUnpaidInvoices);
  return {
    grossOutstanding: financialPositions.length
      ? financialTotals.accountingOutstanding
      : number(source.gross_outstanding),
    accountingOutstanding: financialTotals.accountingOutstanding,
    operationalCollectible: outstanding,
    residualBalance: financialTotals.residualBalance,
    financialPositionReconciled: financialPositions.length
      ? financialTotals.reconciledExactly
      : false,
    creditOffset: number(source.credit_offset),
    unusedCredits: number(source.unused_credits),
    creditSurplus: number(source.credit_surplus),
    outstanding,
    outstandingCnt: number(source.outstanding_cnt),
    overdueAmt: number(source.overdue_amt),
    settlementCount: number(source.settlement_count),
    settlementTotal: number(source.settlement_total),
    settlements: (source.settlements || []).map(mapSettlement),
    collectedThisMonth: number(source.collected_this_month),
    collectedPrevMonth: number(source.collected_prev_month),
    monthlyCollected: source.monthly_collected || [],
    zohoUnpaidInvoices: unpaid,
    zohoUnpaidInvoicesAvailable: unpaid != null,
    zohoDraftOutstanding: number(source.zohoDraftOutstanding),
    zohoDraftCount: number(source.zohoDraftCount),
    zohoOpeningAndAdjustments: unpaid == null ? null : Number((number(source.gross_outstanding) - unpaid).toFixed(2)),
    balanceSyncIssueCount: number(source.balanceSyncIssueCount),
    balanceSyncGapTotal: number(source.balanceSyncGapTotal),
    aging: {
      b0_15: number(aging.b0_15), b16_30: number(aging.b16_30),
      b0: number(aging.b0_30), b1: number(aging.b31_60),
      b2: number(aging.b61_90), b3: number(aging.b90p),
      opening: number(aging.opening_balance), openingGross: number(aging.opening_gross),
    },
    campaignAging: {
      inv1_15: number(campaign.inv1_15), inv16_30: number(campaign.inv16_30),
      inv31_60: number(campaign.inv31_60), inv61_90: number(campaign.inv61_90),
      inv90p: number(campaign.inv90p), opening: number(campaign.opening),
    },
    platformCounts: source.platformCounts || { all: 0, active: 0, inactive: 0, unknown: 0 },
    unclaimedCount: number(source.unclaimedCount),
    // Compatibility for the secondary customer cards. Only the current server
    // page is present; no hidden all-customer payload is downloaded.
    customers: pageRows.map(row => row.customer),
  };
}

export function receivablesRpcArgs(filters = {}) {
  return {
    p_aging: [...(filters.aging || [])],
    p_search: filters.search || null,
    p_status: filters.status || 'all',
    p_owner: filters.owner || 'all',
    p_collection: filters.collection || 'all',
    p_promise: filters.promise || 'all',
    p_contact: filters.contact || 'all',
    p_action: filters.action || 'all',
    p_source: filters.source || 'all',
    p_min_amount: filters.minAmount === '' || filters.minAmount == null ? null : Number(filters.minAmount),
    p_max_amount: filters.maxAmount === '' || filters.maxAmount == null ? null : Number(filters.maxAmount),
    p_sort: filters.sort || 'amount',
    p_page: Math.max(1, Number(filters.page) || 1),
    p_page_size: Math.min(100, Math.max(1, Number(filters.pageSize) || 20)),
  };
}

export function adaptReceivablesWorkQueue(payload, financialPositions = []) {
  if (!payload?.page || !payload?.summary) throw new Error('استجابة مسار التحصيل المركزي غير مكتملة');
  const positionByZohoId = new Map(financialPositions.map(row => [String(row.zohoId), row]));
  const rows = (Array.isArray(payload.page.rows) ? payload.page.rows : []).map(row => {
    const sourcePosition = positionByZohoId.get(String(row.customer?.zohoId || ''));
    const position = sourcePosition || buildFinancialPosition(row.customer?.grossDue, row.customer?.owed);
    return {
      ...row,
      customer: {
        ...row.customer,
        grossDue: position.accountingOutstanding,
        accountingOutstanding: position.accountingOutstanding,
        operationalCollectible: position.operationalCollectible,
        residualBalance: position.residualBalance,
        financialPositionReconciled: sourcePosition?.sourceReconciledExactly !== false && position.reconciledExactly,
        owed: position.operationalCollectible,
      },
    };
  });
  return {
    dashboard: adaptSummary(payload.summary, rows, financialPositions),
    page: { ...payload.page, rows },
    permissions: payload.permissions || {},
    assignees: Array.isArray(payload.assignees) ? payload.assignees : [],
    sources: payload.sources || {},
    identity: payload.identity || {},
    generatedAt: payload.generatedAt || null,
    readPath: 'customer_receivables_work_queue',
  };
}

export async function loadCustomerReceivablesWorkQueue(filters, client = supabase) {
  const [{ data, error }, financialPositions] = await Promise.all([
    client.rpc('customer_receivables_work_queue', receivablesRpcArgs(filters)),
    loadCustomerFinancialPositions(client),
  ]);
  if (error) throw error;
  return adaptReceivablesWorkQueue(data, financialPositions);
}

export async function loadAllCustomerReceivablesRows(filters, client = supabase) {
  const result = await loadAllCustomerReceivablesResult(filters, client);
  return result.rows;
}

export async function loadAllCustomerReceivablesResult(filters, client = supabase) {
  const first = await loadCustomerReceivablesWorkQueue({ ...filters, page: 1, pageSize: 100 }, client);
  const rows = [...first.page.rows];
  for (let page = 2; page <= first.page.totalPages; page += 1) {
    const next = await loadCustomerReceivablesWorkQueue({ ...filters, page, pageSize: 100 }, client);
    rows.push(...next.page.rows);
  }
  return {
    rows,
    dashboard: first.dashboard,
    permissions: first.permissions,
    assignees: first.assignees,
    sources: first.sources || {},
    generatedAt: first.generatedAt || null,
  };
}

export function compareReceivablesFinancials(legacy, next) {
  const checks = [
    ['outstanding', legacy?.outstanding, next?.dashboard?.outstanding],
    ['overdue', legacy?.overdueAmt, next?.dashboard?.overdueAmt],
    ['aging.1_15', legacy?.campaignAging?.inv1_15, next?.dashboard?.campaignAging?.inv1_15],
    ['aging.16_30', legacy?.campaignAging?.inv16_30, next?.dashboard?.campaignAging?.inv16_30],
    ['aging.31_60', legacy?.campaignAging?.inv31_60, next?.dashboard?.campaignAging?.inv31_60],
    ['aging.61_90', legacy?.campaignAging?.inv61_90, next?.dashboard?.campaignAging?.inv61_90],
    ['aging.90p', legacy?.campaignAging?.inv90p, next?.dashboard?.campaignAging?.inv90p],
    ['aging.opening', legacy?.campaignAging?.opening, next?.dashboard?.campaignAging?.opening],
  ];
  return checks.flatMap(([field, before, after]) => (
    number(before) === number(after) ? [] : [{ field, before: number(before), after: number(after) }]
  ));
}

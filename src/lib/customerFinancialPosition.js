import { supabase } from './supabase.js';

export const OPERATIONAL_SOURCE_BALANCE_THRESHOLD = 0.50;

export function moneyToMinorUnits(value) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100);
}

export function minorUnitsToMoney(value) {
  return Number((Number(value || 0) / 100).toFixed(2));
}

export function validateFinancialPosition({
  accountingOutstanding = 0,
  operationalCollectible = 0,
  residualBalance = 0,
} = {}) {
  return moneyToMinorUnits(accountingOutstanding)
    === moneyToMinorUnits(operationalCollectible) + moneyToMinorUnits(residualBalance);
}

export function buildFinancialPosition(accountingOutstanding, operationalCollectible) {
  const accountingMinor = moneyToMinorUnits(accountingOutstanding);
  const operationalMinor = moneyToMinorUnits(operationalCollectible);
  const residualMinor = accountingMinor - operationalMinor;
  const position = {
    accountingOutstanding: minorUnitsToMoney(accountingMinor),
    operationalCollectible: minorUnitsToMoney(operationalMinor),
    residualBalance: minorUnitsToMoney(residualMinor),
  };
  return { ...position, reconciledExactly: validateFinancialPosition(position) };
}

// Contract helper for tests and import adapters that start from raw invoice
// balances. The comparison is deliberately strict: 0.50 is residual, 0.51 is
// operational. No monetary tolerance is used.
export function buildFinancialPositionFromBalances(balances = []) {
  let accountingMinor = 0;
  let operationalMinor = 0;
  for (const balance of balances) {
    const minor = moneyToMinorUnits(balance);
    accountingMinor += minor;
    if (minor > moneyToMinorUnits(OPERATIONAL_SOURCE_BALANCE_THRESHOLD)) {
      operationalMinor += minor;
    }
  }
  return buildFinancialPosition(minorUnitsToMoney(accountingMinor), minorUnitsToMoney(operationalMinor));
}

function adaptPosition(row = {}) {
  const position = {
    zohoId: String(row.zoho_id || ''),
    customerName: row.contact_name || '',
    ...buildFinancialPosition(row.accounting_outstanding, row.operational_collectible),
    creditOffset: minorUnitsToMoney(moneyToMinorUnits(row.credit_offset)),
    operationalSourceBalanceThreshold: Number(row.operational_source_balance_threshold ?? OPERATIONAL_SOURCE_BALANCE_THRESHOLD),
  };
  // Validate the source-provided residual too; deriving a replacement must not
  // hide a broken database contract.
  position.sourceReconciledExactly = row.reconciled_exactly === true
    && validateFinancialPosition({ ...position, residualBalance: row.residual_balance });
  return position;
}

export function aggregateFinancialPositions(rows = []) {
  let accountingMinor = 0;
  let operationalMinor = 0;
  let residualMinor = 0;
  let sourceReconciledExactly = true;
  for (const row of rows) {
    accountingMinor += moneyToMinorUnits(row.accountingOutstanding);
    operationalMinor += moneyToMinorUnits(row.operationalCollectible);
    residualMinor += moneyToMinorUnits(row.residualBalance);
    sourceReconciledExactly = sourceReconciledExactly && row.sourceReconciledExactly !== false;
  }
  const totals = {
    accountingOutstanding: minorUnitsToMoney(accountingMinor),
    operationalCollectible: minorUnitsToMoney(operationalMinor),
    residualBalance: minorUnitsToMoney(residualMinor),
  };
  return {
    ...totals,
    reconciledExactly: sourceReconciledExactly && validateFinancialPosition(totals),
  };
}

export async function loadCustomerFinancialPositions(client = supabase) {
  const rows = [];
  const pageSize = 1000;
  for (let page = 0; ; page += 1) {
    const from = page * pageSize;
    const { data, error } = await client
      .from('customer_financial_operational_position')
      .select('zoho_id, contact_name, accounting_outstanding, operational_collectible, residual_balance, credit_offset, operational_source_balance_threshold, reconciled_exactly')
      .order('zoho_id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data?.length || data.length < pageSize) break;
  }
  return rows.map(adaptPosition);
}

export async function loadCustomerFinancialPosition(zohoId, client = supabase) {
  const id = String(zohoId || '').trim();
  if (!id) return null;
  const { data, error } = await client
    .from('customer_financial_operational_position')
    .select('zoho_id, contact_name, accounting_outstanding, operational_collectible, residual_balance, credit_offset, operational_source_balance_threshold, reconciled_exactly')
    .eq('zoho_id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? adaptPosition(data) : null;
}

export const LAMHA_FINANCIAL_GUARD_KEY = 'lamha_financial_guard';
export const LAMHA_FINANCIAL_GRACE_DAYS = 30;

type AnyRecord = Record<string, unknown>;

const asRecord = (value: unknown): AnyRecord => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : {}
);

const first = (...values: unknown[]) => values.find(value => value !== null && value !== undefined && value !== '');

const text = (...values: unknown[]) => {
  const value = first(...values);
  return value === undefined ? '' : String(value).trim();
};

const number = (...values: unknown[]) => {
  const value = Number(first(...values));
  return Number.isFinite(value) ? value : null;
};

const bool = (...values: unknown[]) => {
  const value = first(...values);
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || String(value).toLowerCase() === 'true') return true;
  if (value === 0 || value === '0' || String(value).toLowerCase() === 'false') return false;
  return null;
};

const dateText = (...values: unknown[]) => {
  const value = text(...values);
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const isDraft = (value: unknown) => ['draft', 'مسودة'].includes(text(value).toLowerCase());

const normalizeBillingType = (...values: unknown[]) => {
  const value = text(...values);
  const normalized = value.toLowerCase().replace(/[\s_-]+/g, ' ');
  if (['prepaid', 'pre paid', 'دفع مسبق'].includes(normalized)) return 'دفع مسبق';
  if (['postpaid', 'post paid', 'دفع لاحق'].includes(normalized)) return 'دفع لاحق';
  return value || null;
};

export function parseLamhaAccountActive(...values: unknown[]): boolean | null {
  for (const value of values) {
    if (typeof value === 'boolean') return value;
    if (value === 1 || value === '1') return true;
    if (value === 0 || value === '0') return false;
    const record = asRecord(value);
    const candidate = text(record.value, record.key, record.slug, record.name, value)
      .toLowerCase().replace(/[\s_-]+/g, ' ');
    if (candidate === 'true') return true;
    if (candidate === 'false') return false;
    if (['inactive', 'غير نشط'].includes(candidate)) return false;
    // Lamha's account contract is negative: only `inactive` blocks shipment
    // creation. idle/stopped are lifecycle or activity labels, not account
    // disablement. Keep unknown non-empty Lamha statuses operational rather
    // than silently turning them into an indeterminate financial-guard state.
    if (candidate) return true;
  }
  return null;
}

function arrayCandidate(value: unknown): AnyRecord[] | null {
  if (!Array.isArray(value)) return null;
  const rows = value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as AnyRecord[];
  return rows.length || value.length === 0 ? rows : null;
}

export function extractLamhaStorePage(payload: unknown) {
  const root = asRecord(payload);
  const data = asRecord(root.data);
  const candidates = [root.data, root.stores, root.items, root.results, data.data, data.stores, data.items, data.results];
  const rows = candidates.map(arrayCandidate).find(Boolean) || [];
  const meta = asRecord(first(root.meta, data.meta));
  const currentPage = number(meta.current_page, meta.currentPage, data.current_page, data.currentPage, root.current_page, root.currentPage) || 1;
  const lastPage = number(meta.last_page, meta.lastPage, data.last_page, data.lastPage, root.last_page, root.lastPage);
  const total = number(meta.total, data.total, root.total);
  const perPage = number(meta.per_page, meta.perPage, data.per_page, data.perPage, root.per_page, root.perPage);
  const inferredLast = lastPage || (total && perPage ? Math.max(1, Math.ceil(total / perPage)) : currentPage);
  return { rows, currentPage, lastPage: inferredLast, total, perPage };
}

export function normalizeLamhaStoreRow(raw: unknown, previous: AnyRecord = {}) {
  const row = asRecord(raw);
  const metrics = asRecord(first(row.metrics, row.statistics, row.stats));
  const profile = asRecord(first(row.profile, row.store));
  const status = first(row.status, row.store_status, row.storeStatus, profile.status);
  const storeId = number(row.id, row.store_id, row.storeId, row.business_id, row.businessId, profile.id);
  const normalized = {
    store_id: storeId ? String(Math.trunc(storeId)) : '',
    store_name: text(row.name, row.store_name, row.storeName, row.title, profile.name, previous.store_name),
    phone: text(row.phone, row.mobile, row.phone_number, row.phoneNumber, profile.phone, profile.mobile, previous.phone),
    shipment_count: Math.max(0, Math.trunc(number(
      row.shipments_count, row.shipment_count, row.shipmentsCount, row.orders_count, metrics.shipments_count,
      metrics.shipmentsCount, previous.shipment_count,
    ) || 0)),
    last_shipment_at: dateText(
      row.last_shipment_at, row.lastShipmentAt, row.last_shipment, row.lastShipment,
      row.last_shipment_date, row.lastShipmentDate,
      metrics.last_shipment_at, metrics.lastShipmentAt, previous.last_shipment_at,
    ),
    integration_type: text(row.integration_type, row.integrationType, row.platform, row.store_type, profile.integration_type, previous.integration_type) || null,
    billing_type: normalizeBillingType(
      row.billing_type, row.billingType, row.invoice_type, row.invoiceType,
      row.invoice_status, row.invoiceStatus, profile.billing_type, previous.billing_type,
    ),
    status: text(asRecord(status).label, asRecord(status).name, asRecord(status).value, status, previous.status) || null,
    created_at_platform: dateText(
      row.joined_at, row.joinedAt, row.join_date, row.joinDate,
      row.created_at, row.createdAt, profile.created_at, previous.created_at_platform,
    ),
    last_topup_at: dateText(row.last_topup_at, row.lastTopupAt, metrics.last_topup_at, metrics.lastTopupAt, previous.last_topup_at),
    // Unknown is not zero. Lamha currently exposes wallet-transaction presence
    // but not the balance itself, so a missing Excel enrichment must remain
    // null instead of manufacturing a financial value.
    wallet_balance: number(row.wallet_balance, row.walletBalance, metrics.wallet_balance, metrics.walletBalance, previous.wallet_balance) ?? null,
    profile_status: text(row.profile_status, row.profileStatus, profile.profile_status, previous.profile_status) || null,
    vat_registered: bool(row.vat_registered, row.vatRegistered, profile.vat_registered, previous.vat_registered) ?? null,
    zatca_completed: bool(row.zatca_completed, row.zatcaCompleted, profile.zatca_completed, previous.zatca_completed) ?? null,
    verification_status: bool(row.verified, profile.verified) === true
      ? 'موثق'
      : bool(row.verified, profile.verified) === false
        ? 'غير موثق'
        : text(row.verification_status, row.verificationStatus, profile.verification_status, previous.verification_status) || null,
  };
  return normalized;
}

export type FinancialGuardRow = {
  storeId: number;
  storeName: string;
  customerNames: string[];
  overdue30Amount: number;
  overdue30InvoiceAmount: number;
  overdue30OpeningBalanceAmount: number;
  overdue30InvoiceCount: number;
  overdue30OpeningBalanceCount: number;
  oldestOverdueDays: number;
  financeValid: boolean;
  visualActive: boolean | null;
};

export function buildFinancialGuardRows(input: {
  merchants: AnyRecord[];
  links: AnyRecord[];
  lines: AnyRecord[];
  validCustomers: Set<string>;
}): FinancialGuardRow[] {
  const merchantById = new Map<number, AnyRecord>();
  for (const merchant of input.merchants) {
    const id = number(merchant.store_id);
    if (id && Number.isSafeInteger(id)) merchantById.set(id, merchant);
  }

  const finance = new Map<string, {
    amount: number;
    invoiceAmount: number;
    openingBalanceAmount: number;
    invoices: Set<string>;
    openingBalances: Set<string>;
    oldest: number;
  }>();
  for (const line of input.lines) {
    const lineKind = text(line.line_kind).toLowerCase();
    if (!['invoice', 'opening_balance'].includes(lineKind)) continue;
    if (lineKind === 'invoice' && isDraft(line.status)) continue;
    const customer = text(line.contact_name);
    const age = number(line.age_days) || 0;
    const amount = Math.max(0, number(line.collectible_amount) || 0);
    if (!customer || age <= LAMHA_FINANCIAL_GRACE_DAYS || amount <= 0.005) continue;
    const current = finance.get(customer) || {
      amount: 0,
      invoiceAmount: 0,
      openingBalanceAmount: 0,
      invoices: new Set<string>(),
      openingBalances: new Set<string>(),
      oldest: 0,
    };
    current.amount = +(current.amount + amount).toFixed(2);
    if (lineKind === 'opening_balance') {
      current.openingBalanceAmount = +(current.openingBalanceAmount + amount).toFixed(2);
      current.openingBalances.add(text(line.line_id, `${customer}:opening:${age}:${amount}`));
    } else {
      current.invoiceAmount = +(current.invoiceAmount + amount).toFixed(2);
      current.invoices.add(text(line.line_id, line.invoice_number, `${customer}:${age}:${amount}`));
    }
    current.oldest = Math.max(current.oldest, age);
    finance.set(customer, current);
  }

  const stores = new Map<number, FinancialGuardRow>();
  for (const link of input.links) {
    const customer = text(link.customer_name);
    const storeId = number(link.store_id);
    if (!customer || !storeId || !merchantById.has(storeId)) continue;
    const merchant = merchantById.get(storeId)!;
    const row = stores.get(storeId) || {
      storeId,
      storeName: text(merchant.store_name, `متجر #${storeId}`),
      customerNames: [],
      overdue30Amount: 0,
      overdue30InvoiceAmount: 0,
      overdue30OpeningBalanceAmount: 0,
      overdue30InvoiceCount: 0,
      overdue30OpeningBalanceCount: 0,
      oldestOverdueDays: 0,
      financeValid: true,
      visualActive: parseLamhaAccountActive(merchant.status),
    };
    row.customerNames.push(customer);
    row.financeValid &&= input.validCustomers.has(customer);
    const customerFinance = finance.get(customer);
    if (customerFinance) {
      row.overdue30Amount = +(row.overdue30Amount + customerFinance.amount).toFixed(2);
      row.overdue30InvoiceAmount = +(row.overdue30InvoiceAmount + customerFinance.invoiceAmount).toFixed(2);
      row.overdue30OpeningBalanceAmount = +(row.overdue30OpeningBalanceAmount + customerFinance.openingBalanceAmount).toFixed(2);
      row.overdue30InvoiceCount += customerFinance.invoices.size;
      row.overdue30OpeningBalanceCount += customerFinance.openingBalances.size;
      row.oldestOverdueDays = Math.max(row.oldestOverdueDays, customerFinance.oldest);
    }
    stores.set(storeId, row);
  }
  return [...stores.values()].map(row => ({ ...row, customerNames: [...new Set(row.customerNames)] }));
}

export function financialGuardDecision(row: FinancialGuardRow, autoDeactivated: boolean) {
  if (!row.financeValid) return { action: 'exclude' as const, reason: 'financial_integrity_not_valid' };
  if (row.overdue30Amount > 0.005) {
    if (row.visualActive === false) return { action: 'aligned' as const, reason: 'already_inactive' };
    return { action: 'deactivate' as const, reason: 'collectible_amount_overdue_more_than_30_days' };
  }
  if (row.visualActive === true) return { action: 'aligned' as const, reason: 'already_active' };
  if (!autoDeactivated) return { action: 'exclude' as const, reason: 'inactive_not_owned_by_financial_guard' };
  return { action: 'activate' as const, reason: 'financial_hold_cleared' };
}

export const AUTHORITATIVE_FINANCIAL_LINK_METHOD = 'lamha-zoho-id';

export function authoritativeFinancialMerchant(customer) {
  return customer?.merchantMatch?.method === AUTHORITATIVE_FINANCIAL_LINK_METHOD
    ? customer?.merchant || null
    : null;
}

export function applyVerifiedFinancialPosition(row, core) {
  if (!row) return row;
  if (!core?.financial) return { ...row, debt: 0, daysOutstanding: 0, risk: row.risk === 'negative_wallet' ? row.risk : null, financialLinkResolved: false, financialVerified: true };
  return {
    ...row,
    debt: Number(core.financial.accountingOutstanding ?? core.financial.operationalCollectible ?? core.financial.outstanding ?? 0),
    daysOutstanding: Number(core.financial.oldestDays || 0),
    financialLinkResolved: true,
    financialVerified: true,
  };
}

export function buildCustomerDirectoryRows(data) {
  const riskByStore = new Map();
  Object.entries(data?.anomalies || {}).forEach(([kind, entries]) => {
    (entries || []).forEach(entry => {
      const id = entry?.merchant?.storeId;
      if (id && !riskByStore.has(String(id))) riskByStore.set(String(id), kind);
    });
  });

  const rows = [];
  const seen = new Set();
  for (const customer of data?.customers || []) {
    const merchant = authoritativeFinancialMerchant(customer) || {};
    const hasAuthoritativeLink = Boolean(merchant.storeId);
    if (hasAuthoritativeLink) seen.add(String(merchant.storeId));
    rows.push({
      id: String(merchant.storeId || `financial-${customer.zohoId || customer.name || rows.length}`),
      entry: { kind: 'customer', name: customer.name, customer, merchant: hasAuthoritativeLink ? merchant : null },
      name: customer.name || merchant.storeName || 'عميل بلا اسم',
      storeName: merchant.storeName || 'حساب Zoho غير مرتبط',
      storeId: merchant.storeId || '—',
      phone: merchant.phone || '',
      billingType: merchant.billingType || 'غير محدد',
      platformStatus: merchant.platformStatus,
      lastShipmentAt: merchant.lastShipmentAt,
      shipments: Number(merchant.shipmentCount || 0),
      debt: Number(customer.total || 0),
      wallet: Number(merchant.walletBalance || 0),
      daysOutstanding: Number(customer.daysOutstanding || 0),
      financialLinkResolved: hasAuthoritativeLink,
      risk: riskByStore.get(String(merchant.storeId || '')) || customer.anomaly || null,
    });
  }
  for (const merchant of data?.merchants || []) {
    if (seen.has(String(merchant.store_id))) continue;
    const normalizedMerchant = {
      storeId: merchant.store_id,
      storeName: merchant.store_name,
      phone: merchant.phone,
      billingType: merchant.billing_type,
      platformStatus: merchant.status,
      shipmentCount: merchant.shipment_count,
      lastShipmentAt: merchant.last_shipment_at,
      walletBalance: Number(merchant.wallet_balance || 0),
    };
    rows.push({
      id: String(merchant.store_id || `merchant-${rows.length}`),
      entry: { kind: 'merchant', name: merchant.store_name, customer: null, merchant: normalizedMerchant },
      name: merchant.store_name || 'متجر بلا اسم',
      storeName: merchant.store_name || '—',
      storeId: merchant.store_id || '—',
      phone: merchant.phone || '',
      billingType: merchant.billing_type || 'غير محدد',
      platformStatus: merchant.status,
      lastShipmentAt: merchant.last_shipment_at,
      shipments: Number(merchant.shipment_count || 0),
      debt: 0,
      wallet: Number(merchant.wallet_balance || 0),
      daysOutstanding: 0,
      financialLinkResolved: false,
      risk: riskByStore.get(String(merchant.store_id || '')) === 'negative_wallet' ? 'negative_wallet' : null,
    });
  }
  return rows;
}

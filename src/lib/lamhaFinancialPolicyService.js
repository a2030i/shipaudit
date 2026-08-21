import { loadCustomerCollectibleLines, loadCustomerMoneyDashboard } from './pnlService.js';
import { loadCustomerMerchantLinks, loadLatestMerchants } from './merchantsService.js';
import { buildLamhaFinancialPolicyRows } from './lamhaFinancialPolicy.js';

export async function loadLamhaFinancialPolicyData() {
  const [merchantData, links, lines, money] = await Promise.all([
    loadLatestMerchants(),
    loadCustomerMerchantLinks(),
    loadCustomerCollectibleLines(),
    loadCustomerMoneyDashboard(),
  ]);
  const balanceIssueStoreIds = new Set((money?.customers || [])
    .filter(customer => customer.balanceSyncIssue && customer.storeId)
    .map(customer => Number(customer.storeId)));
  const policy = buildLamhaFinancialPolicyRows({
    merchants: merchantData.merchants,
    links,
    lines,
    balanceIssueStoreIds,
  });
  return {
    ...policy,
    merchantSnapshot: merchantData.snapshot,
    fetchedAt: new Date().toISOString(),
  };
}

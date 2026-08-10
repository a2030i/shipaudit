import { supabase } from './supabase.js';

/**
 * Read-only access to Tahseel through the authenticated server gateway.
 * The browser never receives the Tahseel key or secret, and cannot choose an
 * arbitrary method or path.
 */
async function invokeTahseelRead(body) {
  const { data, error } = await supabase.functions.invoke('tahseel-read', { body });
  if (error) {
    let message = error.message || 'تعذر الاتصال بتحصيل';
    try {
      const details = await error.context?.json?.();
      if (details?.error) message = details.error;
    } catch {
      // Keep the safe generic message when the response body is unavailable.
    }
    throw new Error(message);
  }
  if (!data?.ok) throw new Error(data?.error || 'تعذر الاتصال بتحصيل');
  return data;
}

export function probeTahseelConnection() {
  return invokeTahseelRead({ action: 'probe' });
}

export function listTahseelCustomers({ page = 1, limit = 50, search = '' } = {}) {
  return invokeTahseelRead({ action: 'list_customers', page, limit, search });
}

export function listTahseelInvoices({ page = 1, limit = 50 } = {}) {
  return invokeTahseelRead({ action: 'list_invoices', page, limit });
}

export function listTahseelTransactions({ page = 1, limit = 50, customerId, sourceReference } = {}) {
  return invokeTahseelRead({
    action: 'list_transactions',
    page,
    limit,
    customer_id: customerId,
    source_reference: sourceReference,
  });
}

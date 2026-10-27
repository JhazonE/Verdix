/**
 * External Accounting API Service
 * Handles communication with external accounting server
 */

import { ExternalApiConfig } from '../external-api-config';
import { logApiSync } from './api-sync-logger';

// Payload Types
export type AccountsPayablePayload = {
  supplierId: string;
  supplierName: string;
  totalPurchases: number;
  totalPayments: number;
  balance: number;
  currency: string;
  lastUpdated: string;
  transactions: Array<{
    type: 'PURCHASE' | 'PAYMENT';
    id: string;
    date: string;
    amount: number;
    reference?: string;
    status?: string;
  }>;
};

export type PurchaseTransactionPayload = {
  transactionType: 'PURCHASE_ORDER';
  orderId: string;
  referenceNumber: string;
  supplierId: string;
  supplierName: string;
  date: string;
  dueDate?: string;
  total: number;
  vatAmount: number;
  shippingFee: number;
  paymentMethod: string;
  status: string;
  orderedBy: string;
  lineItems: Array<{
    productId: string;
    productName: string;
    quantity: number;
    unitCost: number;
    discount: number;
    discountType: 'amount' | 'percentage';
    vatSubject: boolean;
    subtotal: number;
  }>;
};

export type PaymentTransactionPayload = {
  transactionType: 'SUPPLIER_PAYMENT';
  paymentId: string;
  supplierId: string;
  supplierName: string;
  amount: number;
  date: string;
  paymentMethod: string;
  reference?: string;
  notes?: string;
};

export type SalesTransactionPayload = {
  transactionType: 'SALES_INVOICE';
  invoiceId: string;
  customerId: string;
  customerName: string;
  date: string;
  total: number;
  paymentMethod: string;
  paymentReference?: string;
  status: string;
  items: Array<{
    productId: string;
    productName: string;
    quantity: number;
    price: number;
    subtotal: number;
  }>;
};

/**
 * HTTP statuses where retrying the same request can never succeed: the route
 * does not exist, the payload is rejected, or we are not allowed to post it.
 * Retrying those is not resilience, it is a loop — this dev DB accumulated
 * 21,490 retries of a single purchase order against a decommissioned endpoint
 * ("HTTP 404: Application not found") because every failure was treated as
 * temporary. 408/429 and the 5xx range are deliberately NOT here: those are
 * exactly the cases the retry queue exists for.
 *
 * 401/403 are included as permanent because they need a human to fix
 * credentials; the Sync Logs tab still shows the row and its Retry button
 * re-queues it once that is done.
 */
const PERMANENT_HTTP_STATUSES = new Set([400, 401, 403, 404, 405, 410, 422]);

/** Reads the status back off the `HTTP <status>: …` message we throw below. */
export function isPermanentSyncError(message: string | undefined): boolean {
  const match = /^HTTP (\d{3})\b/.exec(message || '');
  return match ? PERMANENT_HTTP_STATUSES.has(Number(match[1])) : false;
}

/**
 * Send HTTP request to external API with retry logic
 */
async function sendToExternalApi(
  endpoint: string,
  payload: any,
  config: ExternalApiConfig,
  transactionType: string,
  transactionId: string
): Promise<{ success: boolean; error?: string; permanent?: boolean; response?: any }> {
  let lastError: Error | null = null;
  
  // Calculate next retry time (e.g., 5 minutes from now if it fails)
  const getNextRetryAt = () => {
    const now = new Date();
    now.setMinutes(now.getMinutes() + 5);
    return now.toISOString().slice(0, 19).replace('T', ' ');
  };

  try {
    for (let attempt = 0; attempt <= config.retryAttempts; attempt++) {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };

        // Add authentication headers
        if (config.authType === 'api_key' && config.apiKey) {
          headers['X-API-Key'] = config.apiKey;
        } else if (config.authType === 'bearer_token' && config.bearerToken) {
          headers['Authorization'] = `Bearer ${config.bearerToken}`;
        }

        const response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(config.timeout),
        });

        const responseData = await response.json().catch(() => ({}));

        if (response.ok) {
          // Success - log it
          await logApiSync({
            transactionType,
            transactionId,
            endpoint,
            payload: JSON.stringify(payload),
            response: JSON.stringify(responseData),
            status: 'success',
            retryCount: attempt,
          });

          return { success: true, response: responseData };
        } else {
          throw new Error(`HTTP ${response.status}: ${responseData.message || response.statusText}`);
        }
      } catch (error) {
        lastError = error as Error;

        // A permanent rejection will not become a success on attempt 2 or 3,
        // so stop burning the remaining attempts (and their retryDelay waits)
        // on it and let the caller park the row.
        if (isPermanentSyncError(lastError.message)) break;

        // If this isn't the last attempt, wait before retrying
        if (attempt < config.retryAttempts) {
          await new Promise(resolve => setTimeout(resolve, config.retryDelay));
        }
      }
    }
  } catch (outerError) {
    lastError = outerError as Error;
  }

  // All retries failed or network error occurred - log as 'pending' for background worker
  const errorMessage = lastError?.message || 'Unknown error';
  const permanent = isPermanentSyncError(errorMessage);

  await logApiSync({
    transactionType,
    transactionId,
    endpoint,
    payload: JSON.stringify(payload),
    response: null,
    // A permanent rejection goes straight to 'abandoned', which the background
    // sweep's WHERE clause does not select, so it never enters the retry loop
    // at all. Anything else stays 'pending' for automatic background retry.
    status: permanent ? 'abandoned' : 'pending',
    errorMessage,
    retryCount: config.retryAttempts,
    nextRetryAt: permanent ? undefined : getNextRetryAt(),
    lastRetryAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
  });

  return { success: false, error: errorMessage, permanent };
}

/**
 * Sync accounts payable data for a supplier
 */
export async function syncAccountsPayable(
  supplierId: string,
  config: ExternalApiConfig
): Promise<{ success: boolean; error?: string; permanent?: boolean }> {
  if (!config.enabled) {
    return { success: true }; // Skip if disabled
  }

  try {
    // Fetch supplier data with balance
    const response = await fetch(`/api/suppliers/${supplierId}/balance`);
    if (!response.ok) {
      throw new Error('Failed to fetch supplier balance');
    }

    const supplierData = await response.json();

    const payload: AccountsPayablePayload = {
      supplierId: supplierData.id,
      supplierName: supplierData.name,
      totalPurchases: supplierData.totalPurchases,
      totalPayments: supplierData.totalPayments,
      balance: supplierData.balance,
      currency: 'PHP',
      lastUpdated: new Date().toISOString(),
      transactions: supplierData.transactions || [],
    };

    const endpoint = `${config.apiEndpoint}/sync/push`;
    return await sendToExternalApi(endpoint, payload, config, 'ACCOUNTS_PAYABLE', supplierId);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error syncing accounts payable:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * Sync purchase transaction data
 */
export async function syncPurchaseTransaction(
  purchaseOrderId: string,
  purchaseOrderData: any,
  config: ExternalApiConfig
): Promise<{ success: boolean; error?: string; permanent?: boolean }> {
  if (!config.enabled) {
    return { success: true }; // Skip if disabled
  }

  try {
    let payload: PurchaseTransactionPayload;

    // Check if this is already a processed payload (e.g. from a retry)
    if (purchaseOrderData.transactionType === 'PURCHASE_ORDER' && purchaseOrderData.lineItems) {
      payload = purchaseOrderData;
    } else {
      if (!purchaseOrderData.items) {
        throw new Error('Purchase order items are missing in payload');
      }

      payload = {
        transactionType: 'PURCHASE_ORDER',
        orderId: purchaseOrderData.id || purchaseOrderId,
        referenceNumber: purchaseOrderData.referenceNumber || '',
        supplierId: purchaseOrderData.supplierId,
        supplierName: purchaseOrderData.supplierName,
        date: purchaseOrderData.date,
        dueDate: purchaseOrderData.deliveryDate,
        total: purchaseOrderData.total,
        vatAmount: purchaseOrderData.vatAmount || 0,
        shippingFee: purchaseOrderData.shippingFee || 0,
        paymentMethod: purchaseOrderData.paymentMethod,
        status: purchaseOrderData.status,
        orderedBy: purchaseOrderData.orderedBy || '',
        lineItems: purchaseOrderData.items.map((item: any) => ({
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          unitCost: item.cost,
          discount: item.discount || 0,
          discountType: item.discountType || 'amount',
          vatSubject: item.vatSubject || false,
          subtotal: item.quantity * item.cost - (item.discount || 0),
        })),
      };
    }

    const endpoint = `${config.apiEndpoint}/sync/push`;
    return await sendToExternalApi(endpoint, payload, config, 'PURCHASE_ORDER', purchaseOrderId);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error syncing purchase transaction:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * Sync payment transaction data
 */
export async function syncPaymentTransaction(
  paymentId: string,
  paymentData: any,
  config: ExternalApiConfig
): Promise<{ success: boolean; error?: string; permanent?: boolean }> {
  if (!config.enabled) {
    return { success: true }; // Skip if disabled
  }

  try {
    let payload: PaymentTransactionPayload;

    // Check if this is already a processed payload
    if (paymentData.transactionType === 'SUPPLIER_PAYMENT' && paymentData.paymentId) {
      payload = paymentData;
    } else {
      payload = {
        transactionType: 'SUPPLIER_PAYMENT',
        paymentId: paymentData.id || paymentId,
        supplierId: paymentData.supplierId,
        supplierName: paymentData.supplierName || '',
        amount: paymentData.amount,
        date: paymentData.date,
        paymentMethod: paymentData.paymentMethod,
        reference: paymentData.reference,
        notes: paymentData.notes,
      };
    }

    const endpoint = `${config.apiEndpoint}/sync/push`;
    return await sendToExternalApi(endpoint, payload, config, 'SUPPLIER_PAYMENT', paymentId);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error syncing payment transaction:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * Sync sales transaction data
 */
export async function syncSalesTransaction(
  invoiceId: string,
  salesData: any,
  config: ExternalApiConfig
): Promise<{ success: boolean; error?: string; permanent?: boolean }> {
  if (!config.enabled) {
    return { success: true }; // Skip if disabled
  }

  try {
    let payload: SalesTransactionPayload;

    // Check if this is already a processed payload
    if (salesData.transactionType === 'SALES_INVOICE' && salesData.invoiceId) {
      payload = salesData;
    } else {
      if (!salesData.items) {
        throw new Error('Sales invoice items are missing in payload');
      }

      payload = {
        transactionType: 'SALES_INVOICE',
        invoiceId: salesData.id || invoiceId,
        customerId: salesData.customer?.id || '',
        customerName: salesData.customer?.name || 'Walk-in Customer',
        date: salesData.invoiceDate,
        total: salesData.total,
        paymentMethod: salesData.paymentMethod,
        paymentReference: salesData.paymentReference,
        status: salesData.status,
        items: salesData.items.map((item: any) => ({
          productId: item.product.id,
          productName: item.product.name,
          quantity: item.quantity,
          price: item.price,
          subtotal: item.quantity * item.price,
        })),
      };
    }

    const endpoint = `${config.apiEndpoint}/sync/push`;
    return await sendToExternalApi(endpoint, payload, config, 'SALES_INVOICE', invoiceId);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error syncing sales transaction:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

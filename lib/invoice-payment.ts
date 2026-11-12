/**
 * Client-safe: no database imports here, so the invoice form can share the same
 * rule the server applies. The one DDL helper lives in invoice-payment-db.ts.
 */

/**
 * Payment methods that settle a back-office sales invoice AT THE MOMENT it is
 * issued. Anything else (Charge, or a method a store defines itself) is credit:
 * the invoice stays `Pending` until a payment is recorded against it.
 *
 * Compared case-insensitively and trimmed, because method names are free text
 * in the payment_methods table ('GCash' vs 'Gcash').
 */
export const IMMEDIATE_PAYMENT_METHODS = ['cash', 'gcash', 'paypal'] as const;

export const isImmediatePaymentMethod = (method: string | null | undefined): boolean =>
  IMMEDIATE_PAYMENT_METHODS.includes(String(method ?? '').trim().toLowerCase() as any);

/**
 * What an invoice's status and settled amount should be when it is created.
 *
 * Cash / GCash / PayPal are paid on the spot, so the invoice is born `Paid`
 * with `amountPaid = total`. Before this, only the DUE DATE was set from the
 * method; the status stayed `Pending` with nothing paid, so a cash invoice
 * showed as owed (and, once its due day passed, overdue) though the money was
 * already in hand.
 *
 * Charge is credit and stays unpaid. An explicit status chosen by the caller
 * other than 'Pending' is respected — only the default is replaced.
 */
export function resolveInitialSettlement(
  paymentMethod: string | null | undefined,
  total: number,
  requestedStatus?: string | null,
): { status: string; amountPaid: number; paidNow: boolean } {
  const wantsDefault = !requestedStatus || requestedStatus === 'Pending';
  if (wantsDefault && isImmediatePaymentMethod(paymentMethod)) {
    return { status: 'Paid', amountPaid: total, paidNow: true };
  }
  return { status: requestedStatus || 'Pending', amountPaid: 0, paidNow: false };
}

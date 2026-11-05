/**
 * Works out what a customer is owed back when an invoice they had paid is
 * voided.
 *
 * Voiding reversed stock and flipped the status, but left any money the
 * customer had handed over stranded: paid for a sale that no longer exists,
 * with no way to return it. The SOA fix made the statement honest about that
 * (the voided invoice and its payments both stop counting) — this returns the
 * money.
 *
 * It returns ACCOUNT CREDIT, matching app/api/sales/exchanges, which already
 * credits the account when an exchange leaves the customer owed.
 *
 * Cash refunds are deliberately out of scope. Nothing in this codebase writes
 * `transaction_type = 'refund'`: lib/x-reading-generator says so explicitly
 * and prints no REFUND line because the figure could only ever be 0.00. A
 * cash refund must move the drawer, change the cashier's expected cash, and
 * appear on the X- and Z-readings filed for BIR. That is its own piece of
 * work, not a line in a void handler.
 *
 * ── The trap this module exists to avoid ──────────────────────────────────
 *
 * The refundable figure is NOT `amount_paid`.
 *
 * At checkout, available account credit is auto-applied to a charge invoice
 * (app/api/pos/checkout) and RAISES `amount_paid` — but writes no
 * `payment_allocations` row for it. Refunding `amount_paid` would therefore
 * hand back credit the customer had already SPENT, inventing money out of
 * nothing.
 *
 * So the two components are separated:
 *
 *   refundAmount      money genuinely received, = the sum of real payment
 *                     allocations (capped at amount_paid)
 *   creditAutoApplied the remainder of amount_paid, which was the customer's
 *                     own credit consumed by this sale
 *
 * BOTH return to `credit_balance` — the cash because the sale is cancelled,
 * the credit because it was never really spent — so a void is value-neutral
 * for the customer. They are reported separately because they mean different
 * things on an audit trail, and because only one of them is a refund.
 */

/** Money is only ever whole centavos. */
function centavos(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/**
 * `customer_payments` rows whose `payment_type` is NOT money the customer
 * handed over, and which therefore must not be credited against their
 * balance.
 *
 * - CHARGE is the long-standing one: the row records a charge sale, not a
 *   payment for it.
 * - REFUND is the void refund written by
 *   app/api/sales/invoices/[id]/void. It exists so the credit on the account
 *   can be explained, but the money has already been accounted for by the
 *   voided invoice contributing 0. Counting it again — in either direction —
 *   is a double count.
 *
 * This exclusion is load-bearing, not cosmetic. Measured: recording the
 * refund as a negative ordinary payment made the SOA close at +1000 on a
 * fully-refunded 1000 invoice, because the voided invoice already counts 0,
 * so subtracting the refund showed the customer owing money they did not owe.
 */
export const NON_PAYMENT_TYPES = ['CHARGE', 'REFUND'] as const;

/**
 * SQL excluding the non-payment rows above. `alias` is the table alias the
 * caller used for customer_payments, e.g. 'cp'.
 */
export function realPaymentSql(alias = ''): string {
  const col = alias ? `${alias}.payment_type` : 'payment_type';
  const list = NON_PAYMENT_TYPES.map((t) => `'${t}'`).join(', ');
  return `UPPER(${col}) NOT IN (${list})`;
}

export interface VoidRefundAllocation {
  paymentId: string;
  amount: number | string;
}

export interface VoidRefundInput {
  invoiceTotal: number | string;
  /** sales_invoices.amount_paid — includes auto-applied account credit. */
  amountPaid: number | string | null | undefined;
  /** Rows from payment_allocations for this invoice: real money received. */
  allocations: VoidRefundAllocation[];
}

export interface VoidRefundResult {
  /** Money genuinely received against the invoice, to be refunded. */
  refundAmount: number;
  /** The part of amount_paid funded by the customer's own account credit. */
  creditAutoApplied: number;
  /** What credit_balance should increase by in total. */
  totalCreditRestored: number;
  /** False when there is nothing to do, so the caller writes nothing. */
  shouldRefund: boolean;
}

export function calculateVoidRefund(input: VoidRefundInput): VoidRefundResult {
  const paidRaw = Number(input.amountPaid ?? 0);
  const amountPaid = Number.isFinite(paidRaw) ? centavos(Math.max(0, paidRaw)) : 0;

  if (amountPaid <= 0) {
    return {
      refundAmount: 0,
      creditAutoApplied: 0,
      totalCreditRestored: 0,
      shouldRefund: false,
    };
  }

  // Sum the real allocations, ignoring junk rows. Capped at amount_paid so a
  // stale or duplicated allocation cannot refund more than the invoice ever
  // received.
  const allocated = (input.allocations || []).reduce((sum, alloc) => {
    const amount = Number(alloc?.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) return sum;
    return centavos(sum + amount);
  }, 0);

  const refundAmount = centavos(Math.min(allocated, amountPaid));
  const creditAutoApplied = centavos(Math.max(0, amountPaid - refundAmount));
  const totalCreditRestored = centavos(refundAmount + creditAutoApplied);

  return {
    refundAmount,
    creditAutoApplied,
    totalCreditRestored,
    shouldRefund: totalCreditRestored > 0,
  };
}

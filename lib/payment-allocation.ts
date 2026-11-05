/**
 * Decides how one customer payment is split across the invoices it is applied
 * to, and what is left over.
 *
 * Extracted from app/api/customer-payments so the arithmetic can be tested
 * without a database. The route previously tracked the undistributed
 * remainder in a local `remainingPayment` variable and then never used it
 * after the loop: the money was recorded in customer_payments.amount but
 * never credited to customers.credit_balance, so Customer Balances — which
 * nets outstanding invoices against credit_balance — could not see it. The
 * payment showed as "Unallocated" in Payment History while doing nothing to
 * reduce what the customer owed.
 *
 * The sibling route app/api/customers/payments (used by the POS
 * customer-account dialog) already credited its remainder. This brings the
 * back-office multi-invoice path in line with it.
 */

/** Money is only ever whole centavos; float drift must not create or destroy any. */
function centavos(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export interface AllocationRequest {
  invoiceId: string;
  amountAllocated: number;
}

/** The invoice state the caller has locked and read. */
export interface InvoiceState {
  invoiceId: string;
  total: number;
  amountPaid: number;
}

export interface AppliedAllocation {
  invoiceId: string;
  /** What is actually applied, after capping to the invoice and the payment. */
  appliedAmount: number;
  newAmountPaid: number;
  newStatus: 'Paid' | 'Partially Paid' | 'Pending';
}

export interface AllocationPlan {
  applied: AppliedAllocation[];
  /**
   * The part of the payment no invoice took. This becomes account credit.
   * Never negative; never more than the payment.
   */
  unallocated: number;
}

/**
 * The status an invoice carries once `amountPaid` has been recorded against
 * `total`. A part-paid invoice is 'Partially Paid', not 'Pending' — 'Pending'
 * cannot distinguish "nothing paid yet" from "partly settled". 'Partially
 * Paid' is the exact enum member the column declares; writing 'Partial' is
 * truncated, and under STRICT_TRANS_TABLES that error aborts the whole
 * payment transaction.
 */
export function invoiceStatusFor(
  amountPaid: number,
  total: number,
): 'Paid' | 'Partially Paid' | 'Pending' {
  if (amountPaid >= total) return 'Paid';
  return amountPaid > 0 ? 'Partially Paid' : 'Pending';
}

/**
 * Splits `paymentAmount` across `requests`, in the order given.
 *
 * Each allocation is capped twice: by what the invoice still owes (so an
 * invoice can never end up overpaid) and by what remains of the payment (so
 * the allocations can never sum to more than the customer actually handed
 * over). Whatever is left after every request is the unallocated remainder.
 *
 * `invoices` supplies the locked state per invoice id. A request naming an
 * invoice absent from that map is skipped — its money stays in the remainder
 * rather than disappearing, which is the behaviour that was missing.
 */
export function planAllocations(
  paymentAmount: number,
  requests: AllocationRequest[],
  invoices: Map<string, InvoiceState>,
): AllocationPlan {
  const payment = centavos(Number(paymentAmount) || 0);
  if (payment <= 0) return { applied: [], unallocated: 0 };

  let remaining = payment;
  const applied: AppliedAllocation[] = [];

  for (const req of requests || []) {
    const asked = centavos(Number(req?.amountAllocated) || 0);
    if (asked <= 0) continue;
    if (remaining <= 0) break;

    const state = invoices.get(req.invoiceId);
    // An unknown invoice must not silently consume the money: skipping here
    // leaves it in `remaining`, so it lands in account credit instead.
    if (!state) continue;

    const owed = centavos(Number(state.total) - Number(state.amountPaid || 0));
    if (owed <= 0) continue;

    const appliedAmount = centavos(Math.min(asked, owed, remaining));
    if (appliedAmount <= 0) continue;

    remaining = centavos(remaining - appliedAmount);
    const newAmountPaid = centavos(Number(state.amountPaid || 0) + appliedAmount);

    applied.push({
      invoiceId: req.invoiceId,
      appliedAmount,
      newAmountPaid,
      newStatus: invoiceStatusFor(newAmountPaid, Number(state.total)),
    });

    // Keep the map current so two requests naming the SAME invoice cannot
    // each be measured against the original balance and jointly overpay it.
    invoices.set(req.invoiceId, {
      ...state,
      amountPaid: newAmountPaid,
    });
  }

  return { applied, unallocated: Math.max(0, centavos(remaining)) };
}

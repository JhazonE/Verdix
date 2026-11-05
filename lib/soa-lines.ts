/**
 * Builds the line items and running balance of a Statement of Account.
 *
 * Extracted from app/api/reports/soa so the arithmetic is testable without a
 * database, and so one place decides how a VOIDED invoice behaves.
 *
 * The rule, which the two halves must apply together:
 *
 *   A voided (or returned) invoice is SHOWN on the statement, marked as void,
 *   and counts NOTHING. The payments allocated to it count nothing either.
 *
 * Showing it matters because a customer who was handed an invoice and later
 * had it cancelled should see that cancellation; dropping the row leaves them
 * holding a document number with no counterpart on the statement.
 *
 * Counting zero matters because the sale did not happen. And the payment must
 * fall with the invoice: crediting a payment while dropping the invoice it
 * paid for would reduce the customer's balance for a sale that never
 * occurred, understating what they owe by the whole payment. A voided invoice
 * and its allocated payments cancel out together, or not at all.
 *
 * An UNALLOCATED payment is different: it is money on account, not payment
 * for any particular sale, so a void elsewhere must not swallow it.
 */

import { isVoidInvoiceStatus } from './customer-balance';

/** Money is only ever whole centavos. */
function centavos(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export interface SoaInvoiceRow {
  id: string;
  reference: string | null;
  date: string | Date;
  dueDate?: string | Date | null;
  total: number | string;
  amountPaid?: number | string | null;
  status?: string | null;
  description?: string | null;
}

export interface SoaAllocation {
  invoiceId: string;
  amount: number | string;
  invoiceRef?: string | null;
}

export interface SoaPaymentRow {
  id: string;
  reference: string | null;
  date: string | Date;
  type: string | null;
  amount: number | string;
  note?: string | null;
  allocations: SoaAllocation[];
}

export interface SoaLine {
  id: string;
  reference: string | null;
  date: string | Date;
  dueDate?: string | Date | null;
  type: 'Invoice' | 'Payment';
  description: string;
  status?: string | null;
  /** The row's own face value, kept for display even when it counts zero. */
  amount: number;
  debit: number;
  credit: number;
  runningBalance: number;
  /** True when this row is cancelled, or is a payment against a cancelled invoice. */
  voided: boolean;
  amountPaid?: number;
  allocatedInvoiceId?: string | null;
  invoiceRef?: string | null;
  note?: string | null;
}

export interface SoaInput {
  openingBalance: number;
  invoices: SoaInvoiceRow[];
  payments: SoaPaymentRow[];
}

export interface SoaResult {
  lines: SoaLine[];
  openingBalance: number;
  closingBalance: number;
  totalDebit: number;
  totalCredit: number;
}

export function buildSoaLines(input: SoaInput): SoaResult {
  const voidedInvoiceIds = new Set(
    input.invoices.filter((inv) => isVoidInvoiceStatus(inv.status)).map((inv) => inv.id),
  );

  const invoiceLines: SoaLine[] = input.invoices.map((inv) => {
    const voided = isVoidInvoiceStatus(inv.status);
    const amount = centavos(Number(inv.total) || 0);
    return {
      id: inv.id,
      reference: inv.reference,
      date: inv.date,
      dueDate: inv.dueDate ?? null,
      type: 'Invoice',
      description: inv.description || (voided ? 'Invoice (VOID)' : 'Invoice'),
      status: inv.status ?? null,
      amount,
      // A cancelled invoice is charged nothing.
      debit: voided ? 0 : amount,
      credit: 0,
      runningBalance: 0, // assigned after sorting
      voided,
      amountPaid: centavos(Number(inv.amountPaid ?? 0) || 0),
    };
  });

  const paymentLines: SoaLine[] = [];

  for (const pay of input.payments) {
    const paid = centavos(Number(pay.amount) || 0);
    const allocations = pay.allocations || [];

    if (allocations.length === 0) {
      // Money on account: not tied to any sale, so a void elsewhere does not
      // touch it.
      paymentLines.push({
        id: pay.id,
        reference: pay.reference,
        date: pay.date,
        type: 'Payment',
        description: `Payment${pay.reference ? ` (Ref: ${pay.reference})` : ''}`,
        amount: paid,
        debit: 0,
        credit: paid,
        runningBalance: 0,
        voided: false,
        allocatedInvoiceId: null,
        invoiceRef: null,
        note: pay.note ?? null,
      });
      continue;
    }

    let allocatedTotal = 0;

    for (const alloc of allocations) {
      const allocAmount = centavos(Number(alloc.amount) || 0);
      allocatedTotal = centavos(allocatedTotal + allocAmount);
      const againstVoided = voidedInvoiceIds.has(alloc.invoiceId);

      paymentLines.push({
        id: `${pay.id}__${alloc.invoiceId}`,
        reference: pay.reference,
        date: pay.date,
        type: 'Payment',
        description:
          `Payment - Invoice #${alloc.invoiceRef || alloc.invoiceId}` +
          `${pay.reference ? ` (Ref: ${pay.reference})` : ''}` +
          (againstVoided ? ' (VOID)' : ''),
        amount: allocAmount,
        debit: 0,
        // Falls with the invoice it paid for.
        credit: againstVoided ? 0 : allocAmount,
        runningBalance: 0,
        voided: againstVoided,
        allocatedInvoiceId: alloc.invoiceId,
        invoiceRef: alloc.invoiceRef ?? null,
        note: pay.note ?? null,
      });
    }

    // Anything the allocations did not cover is money on account.
    const remainder = centavos(paid - allocatedTotal);
    if (remainder > 0.005) {
      paymentLines.push({
        id: `${pay.id}__unallocated`,
        reference: pay.reference,
        date: pay.date,
        type: 'Payment',
        description: `Payment${pay.reference ? ` (Ref: ${pay.reference})` : ''}`,
        amount: remainder,
        debit: 0,
        credit: remainder,
        runningBalance: 0,
        voided: false,
        allocatedInvoiceId: null,
        invoiceRef: null,
        note: pay.note ?? null,
      });
    }
  }

  const lines = [...invoiceLines, ...paymentLines].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  let running = centavos(Number(input.openingBalance) || 0);
  let totalDebit = 0;
  let totalCredit = 0;

  for (const line of lines) {
    running = centavos(running + line.debit - line.credit);
    line.runningBalance = running;
    totalDebit = centavos(totalDebit + line.debit);
    totalCredit = centavos(totalCredit + line.credit);
  }

  return {
    lines,
    openingBalance: centavos(Number(input.openingBalance) || 0),
    closingBalance: running,
    totalDebit,
    totalCredit,
  };
}

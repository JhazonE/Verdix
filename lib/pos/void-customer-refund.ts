import { calculateVoidRefund, type VoidRefundResult } from '@/lib/void-refund';

/**
 * Return what a customer had paid on an invoice that is being voided, as
 * ACCOUNT CREDIT. Shared by the back-office void (/api/sales/invoices/[id]/void)
 * and the POS terminal void (/api/pos/void-transaction), which before this
 * returned nothing at all.
 *
 * Cash refunds are not built (see lib/void-refund.ts); everything returned here
 * lands in customers.credit_balance. The caller must have run
 * ensureCustomerCreditColumn() before opening its transaction.
 *
 * ── Which POS sales are refunded ─────────────────────────────────────────
 *
 * A POS sale that was NOT a charge was paid in full at the counter: checkout
 * records amount_paid = total with no payment_allocations row. Voiding that
 * sale already returns the money across the counter — the void drops it from
 * the drawer's expected cash on the X/Z-reading, which is the cashier handing
 * it back. Crediting the account as well would refund the customer twice, and
 * lib/void-refund would let it happen: with no allocations it treats the whole
 * amount_paid as "credit auto-applied" and restores all of it.
 *
 * So for POS-sourced invoices only a CHARGE sale is refunded to the account —
 * whatever was settled on it after checkout (account credit auto-applied at
 * checkout, later payments recorded through payment_allocations) is money the
 * drawer never held for this sale. Back-office invoices keep the full rule.
 */

export interface VoidRefundInvoice {
    id: string;
    customer_id: string | null;
    reference: string | null;
    total: number | string;
    amount_paid: number | string | null;
    payment_method: string | null;
    transaction_source: string | null;
}

const NO_REFUND: VoidRefundResult = {
    refundAmount: 0, creditAutoApplied: 0, totalCreditRestored: 0, shouldRefund: false,
};

export function isRefundableToAccount(invoice: VoidRefundInvoice): boolean {
    if (!invoice.customer_id || invoice.customer_id === 'walk-in') return false;
    if (invoice.transaction_source === 'POS') {
        return String(invoice.payment_method || '').toUpperCase() === 'CHARGE';
    }
    return true;
}

export async function refundVoidedInvoiceToAccount(
    connection: any,
    invoice: VoidRefundInvoice
): Promise<VoidRefundResult> {
    if (!isRefundableToAccount(invoice)) return NO_REFUND;
    const customerId = invoice.customer_id as string;

    // The refundable figure is NOT amount_paid — see lib/void-refund.ts.
    let allocations: any[] = [];
    try {
        const [allocRows]: any = await connection.query(
            'SELECT payment_id, amount_allocated FROM payment_allocations WHERE invoice_id = ?',
            [invoice.id]
        );
        allocations = (allocRows || []).map((row: any) => ({
            paymentId: row.payment_id,
            amount: row.amount_allocated,
        }));
    } catch {
        // payment_allocations may not exist on a fresh DB. With no allocation
        // table there is no evidence of money received, so nothing is treated
        // as a refund — the safe direction.
        allocations = [];
    }

    const refund = calculateVoidRefund({
        invoiceTotal: invoice.total,
        amountPaid: invoice.amount_paid,
        allocations,
    });
    if (!refund.shouldRefund) return refund;

    // Lock the customer row before changing its balance, as the checkout and
    // loyalty paths do.
    await connection.query('SELECT id FROM customers WHERE id = ? FOR UPDATE', [customerId]);
    await connection.query(
        'UPDATE customers SET credit_balance = COALESCE(credit_balance, 0) + ?, updated_at = NOW() WHERE id = ?',
        [refund.totalCreditRestored, customerId]
    );

    // Record it rather than only applying it: a balance that changed with
    // nothing to point at cannot be explained to the customer at the counter.
    //
    // payment_type 'REFUND' with a POSITIVE amount; every balance reader
    // excludes it like 'CHARGE' (NON_PAYMENT_TYPES in lib/void-refund). That
    // exclusion is load-bearing: written as a negative ordinary payment, the
    // SOA closed at +1000 on a fully-refunded 1000 invoice. The refund moves
    // credit_balance; it is not a second transaction on the statement.
    const refundId = `REF-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const invoiceLabel = invoice.reference || invoice.id;
    await connection.query(
        `INSERT INTO customer_payments (
            id, customer_id, payment_type, payment_date, amount, reference, note, created_at, updated_at
        ) VALUES (?, ?, ?, NOW(), ?, ?, ?, NOW(), NOW())`,
        [
            refundId,
            customerId,
            'REFUND',
            refund.totalCreditRestored,
            refundId,
            `Refund to account credit for voided Invoice #${invoiceLabel}` +
            (refund.creditAutoApplied > 0
                ? ` (${refund.refundAmount.toFixed(2)} paid, ${refund.creditAutoApplied.toFixed(2)} account credit restored)`
                : ''),
        ]
    );

    return refund;
}

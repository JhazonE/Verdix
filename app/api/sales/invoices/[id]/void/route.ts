import { NextRequest, NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/mysql';
import { baseQuantity } from '@/lib/selling-units';
import { updateStockAndRecordMovement } from '@/lib/stock-movements';
import { calculateVoidRefund } from '@/lib/void-refund';
import { ensureCustomerCreditColumn } from '@/lib/ensure-customer-credit';

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id: invoiceId } = await params;
    const { uid } = await request.json().catch(() => ({ uid: undefined }));

    if (!uid) {
        return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const permissions: any = await query(
        `SELECT utp.permission
         FROM users u
         JOIN user_types ut ON u.user_type = ut.name
         JOIN user_type_permissions utp ON utp.user_type_id = ut.id
         WHERE u.uid = ?`,
        [uid]
    );
    const canVoid = permissions.some((p: any) => p.permission === 'void_invoices');
    if (!canVoid) {
        return NextResponse.json({ success: false, error: 'You do not have permission to void invoices' }, { status: 403 });
    }

    try {
        // The refund lands in customers.credit_balance, so the column must
        // exist before the transaction opens (it is created by
        // lib/ensure-customer-credit, not by a migration).
        await ensureCustomerCreditColumn();

        return await withTransaction(async (connection: any) => {
            // 1. Fetch invoice to check status
            const [invoice]: any = await connection.query(
                'SELECT status, customer_id, reference, total, amount_paid FROM sales_invoices WHERE id = ?',
                [invoiceId]
            );

            if (!invoice || invoice.length === 0) {
                return NextResponse.json({ success: false, error: 'Invoice not found' }, { status: 404 });
            }

            if (invoice[0].status === 'Voided') {
                return NextResponse.json({ success: false, error: 'Invoice is already voided' }, { status: 400 });
            }

            // 2. Fetch items to reverse stock
            const [items]: any = await connection.query(
                'SELECT product_id, quantity, selling_unit_factor FROM sales_invoice_items WHERE sales_invoice_id = ?',
                [invoiceId]
            );

            if (items && items.length > 0) {
                for (const item of items) {
                    // Give back exactly the base units the invoice took. The factor
                    // is the one RECORDED on the line — a unit edited since the sale
                    // must not change how much a void restores. NULL means factor 1
                    // (rows written before selling units existed).
                    const factor = Number(item.selling_unit_factor ?? 1);
                    const qty = Number(item.quantity);
                    if (!Number.isFinite(qty)) {
                        throw new Error(
                            `Invalid quantity on invoice item for product ${item.product_id}: ${item.quantity}`
                        );
                    }

                    await updateStockAndRecordMovement(
                        item.product_id,
                        baseQuantity(qty, factor),
                        'adjustment',
                        invoiceId,
                        'adjustment',
                        `Voiding of Sales Invoice: ${invoiceId}`,
                        connection as any
                    );
                }
            }

            // 3. Update invoice status
            await connection.query('UPDATE sales_invoices SET status = "Voided", updated_at = NOW() WHERE id = ?', [invoiceId]);

            // 4. Return money the customer had already handed over.
            //
            // Voiding used to reverse stock and stop here, leaving any payment
            // stranded: paid for a sale that no longer exists, with no way to
            // get it back. It returns as ACCOUNT CREDIT, the same account
            // app/api/sales/exchanges credits when an exchange leaves the
            // customer owed. Cash refunds are not built — nothing in this
            // codebase writes transaction_type = 'refund', and a cash refund
            // has to move the drawer and appear on the X/Z-readings filed for
            // BIR, which is separate work.
            //
            // The refundable figure is NOT amount_paid. At checkout, account
            // credit is auto-applied to a charge and RAISES amount_paid while
            // writing no payment_allocations row, so refunding amount_paid
            // would hand back credit the customer had already spent.
            // lib/void-refund separates the two; both return to the balance
            // (the cash because the sale is cancelled, the credit because it
            // was never really spent), which makes a void value-neutral.
            const invoiceRow = invoice[0];
            const customerId = invoiceRow.customer_id;
            let refund = { refundAmount: 0, creditAutoApplied: 0, totalCreditRestored: 0, shouldRefund: false };

            if (customerId && customerId !== 'walk-in') {
                let allocations: any[] = [];
                try {
                    const [allocRows]: any = await connection.query(
                        'SELECT payment_id, amount_allocated FROM payment_allocations WHERE invoice_id = ?',
                        [invoiceId]
                    );
                    allocations = (allocRows || []).map((row: any) => ({
                        paymentId: row.payment_id,
                        amount: row.amount_allocated,
                    }));
                } catch {
                    // payment_allocations may not exist on a fresh DB. With no
                    // allocation table there is no evidence of money received,
                    // so nothing is treated as a refund — the safe direction.
                    allocations = [];
                }

                refund = calculateVoidRefund({
                    invoiceTotal: invoiceRow.total,
                    amountPaid: invoiceRow.amount_paid,
                    allocations,
                });

                if (refund.shouldRefund) {
                    // Lock the customer row before changing its balance, as the
                    // checkout and loyalty paths do.
                    await connection.query(
                        'SELECT id FROM customers WHERE id = ? FOR UPDATE',
                        [customerId]
                    );
                    await connection.query(
                        'UPDATE customers SET credit_balance = COALESCE(credit_balance, 0) + ?, updated_at = NOW() WHERE id = ?',
                        [refund.totalCreditRestored, customerId]
                    );

                    // Record it rather than only applying it: a balance that
                    // changed with nothing to point at cannot be explained to
                    // the customer at the counter.
                    //
                    // Recorded as payment_type 'REFUND' with a POSITIVE
                    // amount, and every balance reader already excludes
                    // non-payment types the same way it excludes 'CHARGE'
                    // (`UPPER(payment_type) != 'CHARGE'`). That exclusion is
                    // what keeps the books right, and it is load-bearing:
                    // measured, writing this as a NEGATIVE ordinary payment
                    // made the SOA close at +1000 on a fully-refunded 1000
                    // invoice, because the voided invoice already contributes
                    // 0, so subtracting the refund double-counted it and
                    // showed the customer owing money they did not owe. The
                    // refund moves credit_balance; it is not a second
                    // transaction on the statement.
                    const refundId = `REF-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                    const invoiceLabel = invoiceRow.reference || invoiceId;
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
                }
            }

            return NextResponse.json({
                success: true,
                message: refund.shouldRefund
                    ? `Sales invoice voided, stock reversed, and ${refund.totalCreditRestored.toFixed(2)} returned to the customer's account credit`
                    : 'Sales invoice voided and stock reversed successfully',
                refund: {
                    refunded: refund.refundAmount,
                    creditRestored: refund.creditAutoApplied,
                    totalCreditRestored: refund.totalCreditRestored,
                },
            });
        });
    } catch (error) {
        console.error('Error voiding sales invoice:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to void sales invoice' },
            { status: 500 }
        );
    }
}

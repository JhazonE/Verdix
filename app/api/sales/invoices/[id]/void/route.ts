import { NextRequest, NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/mysql';
import { baseQuantity } from '@/lib/selling-units';
import { updateStockAndRecordMovement } from '@/lib/stock-movements';
import { refundVoidedInvoiceToAccount } from '@/lib/pos/void-customer-refund';
import { ensureCustomerCreditColumn } from '@/lib/ensure-customer-credit';
import { saveEJournalFiles } from '@/lib/ejournal/ejournal-writer';
import {
    isSaleLockedByZReading, ensureSaleVoidColumns, markLinkedInvoiceVoided, VOID_SOURCE_BACK_OFFICE,
} from '@/lib/pos/void-lock';

const BACK_OFFICE_VOID_REASON = 'Voided from Back Office';

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
        await ensureSaleVoidColumns();

        // Set when this void also voided a POS sale, so its e-journal can be
        // regenerated once the transaction has committed.
        let ejournalMeta: { d: string; t: string } | null = null;

        const response = await withTransaction(async (connection: any) => {
            // 1. Fetch invoice to check status
            const [invoice]: any = await connection.query(
                'SELECT status, customer_id, reference, total, amount_paid, payment_method, transaction_source FROM sales_invoices WHERE id = ?',
                [invoiceId]
            );

            if (!invoice || invoice.length === 0) {
                return NextResponse.json({ success: false, error: 'Invoice not found' }, { status: 404 });
            }

            if (invoice[0].status === 'Voided') {
                return NextResponse.json({ success: false, error: 'Invoice is already voided' }, { status: 400 });
            }

            // 1b. A POS-sourced invoice is one half of a POS sale: checkout writes
            // sales_transactions and sales_invoices with the same reference.
            // Voiding only this half left the sale live — still on the Sales
            // Transactions page and in the X/Z-readings — so both are voided
            // together, under the same Z-reading lock the POS void obeys.
            let linkedSale: { id: string; status: string; created_at: any } | null = null;
            if (invoice[0].transaction_source === 'POS' && invoice[0].reference) {
                const [saleRows]: any = await connection.query(
                    'SELECT id, status, created_at FROM sales_transactions WHERE reference = ? LIMIT 1',
                    [invoice[0].reference]
                );
                linkedSale = saleRows?.[0] || null;
            }
            const saleAlreadyVoided = String(linkedSale?.status || '').toLowerCase() === 'voided';
            if (linkedSale && !saleAlreadyVoided
                && await isSaleLockedByZReading(connection, linkedSale.id, linkedSale.created_at)) {
                return NextResponse.json(
                    { success: false, error: 'This sale was already included in a Z-Reading and can no longer be voided' },
                    { status: 409 }
                );
            }

            // 2. Fetch items to reverse stock
            const [items]: any = await connection.query(
                'SELECT product_id, quantity, selling_unit_factor FROM sales_invoice_items WHERE sales_invoice_id = ?',
                [invoiceId]
            );

            // If the POS sale was voided at the terminal before the two voids
            // were linked, that void already gave the stock back.
            if (!saleAlreadyVoided && items && items.length > 0) {
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

            // 3. Update invoice status, recording who voided it and when so the
            // Voided Sales report can list it as a Back Office void. The audit
            // columns come from migration 152; if it has not been run yet the
            // void must still go through, so fall back to the status alone.
            const [userRows]: any = await connection.query(
                'SELECT display_name FROM users WHERE uid = ? LIMIT 1',
                [uid]
            );
            const voidedByName = userRows?.[0]?.display_name || null;
            await markLinkedInvoiceVoided(connection, invoiceId, uid, voidedByName);

            // 3b. Void the POS sale with it, marked as a Back Office void so the
            // Voided Sales report can tell the two apart.
            if (linkedSale && !saleAlreadyVoided) {
                await connection.query(
                    'UPDATE sales_transactions SET status = "Voided", void_reason = ?, voided_by_user_id = ?, voided_by_name = ?, void_source = ?, updated_at = NOW() WHERE id = ?',
                    [BACK_OFFICE_VOID_REASON, uid, voidedByName, VOID_SOURCE_BACK_OFFICE, linkedSale.id]
                );
                await connection.query(
                    'UPDATE pos_transactions SET void_reason = ?, updated_at = NOW() WHERE sale_id = ?',
                    [BACK_OFFICE_VOID_REASON, linkedSale.id]
                );
                const [meta]: any = await connection.query(
                    `SELECT DATE(st.created_at) AS d, pt.terminal_id AS t
                     FROM sales_transactions st JOIN pos_transactions pt ON pt.sale_id = st.id
                     WHERE st.id = ? LIMIT 1`, [linkedSale.id]
                );
                if (meta?.[0]?.d) ejournalMeta = { d: String(meta[0].d), t: meta[0].t ?? 'all' };
            }

            // 4. Return what the customer had paid, as account credit — see
            // lib/pos/void-customer-refund.ts for which invoices qualify.
            const refund = await refundVoidedInvoiceToAccount(connection, { id: invoiceId, ...invoice[0] });

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

        if (ejournalMeta) {
            const { d, t } = ejournalMeta;
            saveEJournalFiles(d, t).catch((e) => console.error('e-journal auto-save failed:', e));
        }
        return response;
    } catch (error) {
        console.error('Error voiding sales invoice:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to void sales invoice' },
            { status: 500 }
        );
    }
}

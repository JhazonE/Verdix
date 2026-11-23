import { NextRequest, NextResponse } from 'next/server';
import { withTransaction } from '@/lib/mysql';
import { baseQuantity } from '@/lib/selling-units';
import { updateStockAndRecordMovement } from '@/lib/stock-movements';
import { saveEJournalFiles } from '@/lib/ejournal/ejournal-writer';
import {
    isSaleLockedByZReading, ensureSaleVoidColumns, markLinkedInvoiceVoided, VOID_SOURCE_POS,
} from '@/lib/pos/void-lock';
import { refundVoidedInvoiceToAccount } from '@/lib/pos/void-customer-refund';
import { ensureCustomerCreditColumn } from '@/lib/ensure-customer-credit';

export async function POST(request: NextRequest) {
    try {
        const { saleId, voidReason, voidedByUserId, voidedByName } = await request.json();
        console.log('void-transaction: Received saleId:', saleId);

        if (!saleId) {
            return NextResponse.json({ success: false, error: 'Sale ID is required' }, { status: 400 });
        }
        if (!voidReason || !String(voidReason).trim()) {
            return NextResponse.json({ success: false, error: 'A void reason is required' }, { status: 400 });
        }

        await ensureSaleVoidColumns();
        // A refund lands in customers.credit_balance; the column must exist
        // before the transaction opens.
        await ensureCustomerCreditColumn();

        let notFound = false;
        let alreadyVoided = false;
        let periodLocked = false;

        const result = await withTransaction(async (connection: any) => {
            // 1. Fetch sales transaction to check status
            const [sale]: any = await connection.query('SELECT id, status, reference, created_at FROM sales_transactions WHERE id = ?', [saleId]);
            console.log('void-transaction: Found sale:', sale);

            if (!sale || sale.length === 0) {
                notFound = true;
                return null;
            }

            if (String(sale[0].status || '').toLowerCase() === 'voided') {
                alreadyVoided = true;
                return null;
            }

            // 1b. BIR immutability: see lib/pos/void-lock.ts.
            if (await isSaleLockedByZReading(connection, saleId, sale[0].created_at)) {
                periodLocked = true;
                return null;
            }

            // 1c. The sale's twin in sales_invoices (checkout writes both with
            // the same reference). Before the two voids were linked, the back
            // office could void that invoice alone — it restored the stock
            // then, so it must not be restored a second time here.
            const reference = sale[0].reference;
            const [invRow]: any = reference
                ? await connection.query(
                    "SELECT id, status, customer_id, reference, total, amount_paid, payment_method, transaction_source FROM sales_invoices WHERE reference = ? AND transaction_source = 'POS' LIMIT 1",
                    [reference]
                )
                : [[]];
            const linkedInvoice = invRow?.[0] || null;
            const stockAlreadyRestored = linkedInvoice?.status === 'Voided';

            // 2. Fetch items to reverse stock
            const [items]: any = await connection.query(
                'SELECT product_id, product_name, quantity, selling_unit_factor FROM sale_items WHERE sale_id = ?',
                [saleId]
            );
            console.log('void-transaction: Found items:', items?.length || 0);

            if (!stockAlreadyRestored && items && items.length > 0) {
                for (const item of items) {
                    // Restore exactly what the sale took: one product, one stock
                    // figure, in base units — nothing cascades to a family any more.
                    //
                    // The factor is the one RECORDED on the line, not the unit's
                    // current one. A unit edited since the sale must not change how
                    // much stock voiding it gives back. Rows written before selling
                    // units existed carry NULL, which means factor 1.
                    const factor = Number(item.selling_unit_factor ?? 1);
                    const qty = Number(item.quantity);
                    if (!Number.isFinite(qty)) {
                        throw new Error(
                            `Invalid quantity on sale item for product ${item.product_id}: ${item.quantity}`
                        );
                    }

                    await updateStockAndRecordMovement(
                        item.product_id,
                        baseQuantity(qty, factor),
                        'adjustment',
                        saleId,
                        'adjustment',
                        `Voiding POS Sale: ${saleId}`,
                        connection as any
                    );
                }
            }

            // 3. Update sales_transactions status to 'voided'
            await connection.query(
                'UPDATE sales_transactions SET status = "Voided", void_reason = ?, voided_by_user_id = ?, voided_by_name = ?, void_source = ?, updated_at = NOW() WHERE id = ?',
                [voidReason.trim(), voidedByUserId || null, voidedByName || null, VOID_SOURCE_POS, saleId]
            );

            // Void the twin invoice too, or Sales → Invoices keeps showing the
            // sale as Paid and counting it in Amount Paid.
            //
            // A charge sale also gets back, as account credit, whatever had been
            // settled on it; a sale paid at the counter is returned there. See
            // lib/pos/void-customer-refund.ts. An invoice already voided from
            // the back office was refunded then, so it is skipped.
            let refund = { totalCreditRestored: 0, shouldRefund: false };
            if (linkedInvoice && linkedInvoice.status !== 'Voided') {
                await markLinkedInvoiceVoided(connection, linkedInvoice.id, voidedByUserId || null, voidedByName || null);
                refund = await refundVoidedInvoiceToAccount(connection, linkedInvoice);
            }
            console.log('void-transaction: Transaction marked as voided');

            // Mirror the reason onto the POS transaction row. pos_transactions
            // has its own void_reason column that the transaction-list endpoints
            // (/api/pos-transactions, /api/sales/transactions) select and expose;
            // without this write it is always NULL for a voided sale.
            await connection.query(
                'UPDATE pos_transactions SET void_reason = ?, updated_at = NOW() WHERE sale_id = ?',
                [voidReason.trim(), saleId]
            );

            const [meta]: any = await connection.query(
              `SELECT DATE(st.created_at) AS d, pt.terminal_id AS t
               FROM sales_transactions st JOIN pos_transactions pt ON pt.sale_id = st.id
               WHERE st.id = ? LIMIT 1`, [saleId]
            );
            const d = meta?.[0]?.d ? String(meta[0].d) : null;
            const t = meta?.[0]?.t ?? 'all';

            return { d, t, refund };
        });

        if (notFound) {
            return NextResponse.json({ success: false, error: 'Transaction not found' }, { status: 404 });
        }
        if (alreadyVoided) {
            return NextResponse.json({ success: false, error: 'Transaction is already voided' }, { status: 400 });
        }
        if (periodLocked) {
            return NextResponse.json({ success: false, error: 'This transaction was already included in a Z-Reading and can no longer be voided' }, { status: 409 });
        }

        if (result?.d) {
            saveEJournalFiles(result.d, result.t).catch((e) => console.error('e-journal auto-save failed:', e));
        }

        return NextResponse.json({
            success: true,
            message: result?.refund?.shouldRefund
                ? `POS sale voided, stock restored, and ${result.refund.totalCreditRestored.toFixed(2)} returned to the customer's account credit`
                : 'POS sale voided and stock restored successfully',
            refund: { totalCreditRestored: result?.refund?.totalCreditRestored ?? 0 },
        });
    } catch (error: any) {
        console.error('Error voiding POS sale:', error);
        return NextResponse.json(
            { success: false, error: `Failed to void POS sale: ${error.message}` },
            { status: 500 }
        );
    }
}


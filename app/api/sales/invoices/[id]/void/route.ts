import { NextRequest, NextResponse } from 'next/server';
import { withTransaction } from '@/lib/mysql';
import { baseQuantity } from '@/lib/selling-units';
import { updateStockAndRecordMovement } from '@/lib/stock-movements';

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id: invoiceId } = await params;

    try {
        return await withTransaction(async (connection: any) => {
            // 1. Fetch invoice to check status
            const [invoice]: any = await connection.query('SELECT status FROM sales_invoices WHERE id = ?', [invoiceId]);

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

            return NextResponse.json({
                success: true,
                message: 'Sales invoice voided and stock reversed successfully'
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

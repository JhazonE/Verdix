import { NextRequest, NextResponse } from 'next/server';
import { withTransaction, query } from '@/lib/mysql';
import { addFamilyStock, findUltimateRoot } from '@/lib/family-sync';
import { saveEJournalFiles } from '@/lib/ejournal/ejournal-writer';

// The void_reason column can't disappear once ensured — only pay the
// INFORMATION_SCHEMA round trip until the first success this process.
let voidReasonColumnEnsured = false;

async function ensureVoidReasonColumn() {
    if (voidReasonColumnEnsured) return;
    const cols = await query(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'sales_transactions' AND TABLE_SCHEMA = DATABASE()"
    ) as any[];
    if (!cols.some((c: any) => c.COLUMN_NAME === 'void_reason')) {
        await query("ALTER TABLE sales_transactions ADD COLUMN void_reason VARCHAR(255) DEFAULT NULL");
        console.log('✅ Added void_reason column to sales_transactions');
    }
    if (!cols.some((c: any) => c.COLUMN_NAME === 'voided_by_user_id')) {
        await query("ALTER TABLE sales_transactions ADD COLUMN voided_by_user_id VARCHAR(100) DEFAULT NULL");
        console.log('✅ Added voided_by_user_id column to sales_transactions');
    }
    if (!cols.some((c: any) => c.COLUMN_NAME === 'voided_by_name')) {
        await query("ALTER TABLE sales_transactions ADD COLUMN voided_by_name VARCHAR(255) DEFAULT NULL");
        console.log('✅ Added voided_by_name column to sales_transactions');
    }
    voidReasonColumnEnsured = true;
}

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

        await ensureVoidReasonColumn();

        let notFound = false;
        let alreadyVoided = false;
        let periodLocked = false;

        const result = await withTransaction(async (connection: any) => {
            // 1. Fetch sales transaction to check status
            const [sale]: any = await connection.query('SELECT id, status, created_at FROM sales_transactions WHERE id = ?', [saleId]);
            console.log('void-transaction: Found sale:', sale);

            if (!sale || sale.length === 0) {
                notFound = true;
                return null;
            }

            if (String(sale[0].status || '').toLowerCase() === 'voided') {
                alreadyVoided = true;
                return null;
            }

            // 1b. BIR immutability: a transaction already swept into a Z-reading for its
            // terminal can no longer be voided — the Z-reading's totals are a locked
            // report, so silently voiding after the fact would make it disagree with
            // what was actually filed.
            const [termRow]: any = await connection.query(
                'SELECT terminal_id FROM pos_transactions WHERE sale_id = ? LIMIT 1', [saleId]
            );
            const terminalId = termRow?.[0]?.terminal_id;
            if (terminalId) {
                const [zRow]: any = await connection.query(
                    'SELECT report_date FROM z_readings WHERE terminal_id = ? AND report_date >= ? ORDER BY report_date DESC LIMIT 1',
                    [terminalId, sale[0].created_at]
                );
                if (zRow && zRow.length > 0) {
                    periodLocked = true;
                    return null;
                }
            }

            // 2. Fetch items to reverse stock
            const [items]: any = await connection.query('SELECT product_id, product_name, quantity FROM sale_items WHERE sale_id = ?', [saleId]);
            console.log('void-transaction: Found items:', items?.length || 0);

            if (items && items.length > 0) {
                for (const item of items) {
                    // --- Inventory Addition (Reversal) using recursive family sync ---
                    const { rootId, factorToRoot } = await findUltimateRoot(item.product_id, connection as any);
                    const quantityToAddInRootUnits = item.quantity / factorToRoot;
                    
                    await addFamilyStock(
                        rootId, 
                        quantityToAddInRootUnits, 
                        saleId, 
                        'adjustment', 
                        `Voiding POS Sale: ${saleId}`, 
                        connection as any
                    );
                }
            }

            // 3. Update sales_transactions status to 'voided'
            await connection.query(
                'UPDATE sales_transactions SET status = "Voided", void_reason = ?, voided_by_user_id = ?, voided_by_name = ?, updated_at = NOW() WHERE id = ?',
                [voidReason.trim(), voidedByUserId || null, voidedByName || null, saleId]
            );
            console.log('void-transaction: Transaction marked as voided');

            const [meta]: any = await connection.query(
              `SELECT DATE(st.created_at) AS d, pt.terminal_id AS t
               FROM sales_transactions st JOIN pos_transactions pt ON pt.sale_id = st.id
               WHERE st.id = ? LIMIT 1`, [saleId]
            );
            const d = meta?.[0]?.d ? String(meta[0].d) : null;
            const t = meta?.[0]?.t ?? 'all';

            return { d, t };
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
            message: 'POS sale voided and stock restored successfully'
        });
    } catch (error: any) {
        console.error('Error voiding POS sale:', error);
        return NextResponse.json(
            { success: false, error: `Failed to void POS sale: ${error.message}` },
            { status: 500 }
        );
    }
}


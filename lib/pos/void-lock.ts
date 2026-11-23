import { query } from '@/lib/mysql';

/**
 * BIR immutability for voids. A POS sale already swept into a Z-reading for its
 * terminal can no longer be voided — the Z-reading's totals are a locked
 * report, so voiding after the fact would make it disagree with what was filed.
 *
 * Shared by the POS void (/api/pos/void-transaction) and the back-office void
 * of a POS-sourced invoice (/api/sales/invoices/[id]/void), which must refuse
 * the same sales.
 */
export async function isSaleLockedByZReading(
    connection: any,
    saleId: string,
    saleCreatedAt: Date | string
): Promise<boolean> {
    const [termRow]: any = await connection.query(
        'SELECT terminal_id FROM pos_transactions WHERE sale_id = ? LIMIT 1', [saleId]
    );
    const terminalId = termRow?.[0]?.terminal_id;
    if (!terminalId) return false;
    const [zRow]: any = await connection.query(
        'SELECT report_date FROM z_readings WHERE terminal_id = ? AND report_date >= ? ORDER BY report_date DESC LIMIT 1',
        [terminalId, saleCreatedAt]
    );
    return Boolean(zRow && zRow.length > 0);
}

export const VOID_SOURCE_POS = 'POS';
export const VOID_SOURCE_BACK_OFFICE = 'Back Office';

// The void audit columns on sales_transactions can't disappear once ensured —
// only pay the INFORMATION_SCHEMA round trip until the first success this
// process. void_source also has a migration (153); this keeps a DB that has
// not run it working.
let saleVoidColumnsEnsured = false;

export async function ensureSaleVoidColumns(): Promise<void> {
    if (saleVoidColumnsEnsured) return;
    const cols = await query(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'sales_transactions' AND TABLE_SCHEMA = DATABASE()"
    ) as any[];
    const have = new Set(cols.map((c: any) => c.COLUMN_NAME));
    const wanted: Array<[string, string]> = [
        ['void_reason', 'VARCHAR(255) DEFAULT NULL'],
        ['voided_by_user_id', 'VARCHAR(100) DEFAULT NULL'],
        ['voided_by_name', 'VARCHAR(255) DEFAULT NULL'],
        ['void_source', 'VARCHAR(20) DEFAULT NULL'],
    ];
    for (const [name, def] of wanted) {
        if (!have.has(name)) {
            await query(`ALTER TABLE sales_transactions ADD COLUMN ${name} ${def}`);
            console.log(`✅ Added ${name} column to sales_transactions`);
        }
    }
    saleVoidColumnsEnsured = true;
}

/**
 * Mark a POS sale's linked sales_invoices row Voided, recording who and when.
 * The invoice's audit columns come from migration 152; without them only the
 * status is written. Never restores stock — the caller already did, once.
 */
export async function markLinkedInvoiceVoided(
    connection: any,
    invoiceId: string,
    voidedByUserId: string | null,
    voidedByName: string | null
): Promise<void> {
    try {
        await connection.query(
            'UPDATE sales_invoices SET status = "Voided", voided_at = NOW(), voided_by_user_id = ?, voided_by_name = ?, updated_at = NOW() WHERE id = ?',
            [voidedByUserId, voidedByName, invoiceId]
        );
    } catch (e: any) {
        if (e?.code !== 'ER_BAD_FIELD_ERROR') throw e;
        await connection.query('UPDATE sales_invoices SET status = "Voided", updated_at = NOW() WHERE id = ?', [invoiceId]);
    }
}

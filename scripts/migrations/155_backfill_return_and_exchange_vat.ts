import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Backfills pos_transactions.tax_amount on rows that were written with a
 * literal 0 before commit a029f732 (2026-11-24):
 *  - every RETURN row (Merchandise Credit, and an exchange's return leg), and
 *  - every exchange SALE leg (exchange_group_id set) — a real sale with an SI
 *    number whose VAT the X-reading and e-journal read from this column.
 *
 * Left at 0, reports summing pt.total_amount and pt.tax_amount (Sales by Date,
 * Sales Transactions, the e-journal) netted a return out of revenue but not
 * out of VAT, and an exchange's sale reported no VAT. Line-based readings (the
 * Z-reading, BIR Sales Summary, Sta. Lucia) were already right and are
 * unaffected; this brings the column into line with them.
 *
 * VAT is computed from each row's own pos_transaction_items, by the rule the
 * writers now use (lib/tax-utils.ts vatOfLines): 12/112 of each VAT line,
 * nothing for VAT_EXEMPT / ZERO_RATED / NON_VAT, signed like the line (so a
 * return's VAT is negative). A line with no tax_type predates tax tracking and
 * is resolved the way processReturnLeg resolves one: VAT, unless the store is
 * not VAT-registered — a NON_VAT store never books VAT.
 *
 * Only rows still at exactly 0 whose lines give a non-zero VAT are touched,
 * so it is idempotent and never overwrites a value something else wrote.
 * An ordinary (non-exchange) sale at 0 is NOT touched: that can be a genuinely
 * VAT-exempt sale, and checkout always wrote its own tax_amount.
 *
 * Every changed row's previous value is kept in pos_transactions_vat_backfill
 * so down() restores it exactly.
 */

const BACKUP = 'pos_transactions_vat_backfill';

const migration: Migration = {
  name: '155_backfill_return_and_exchange_vat',
  timestamp: '2026-11-24_14-00-00',

  async up(): Promise<void> {
    const [settings]: any = await query('SELECT vat_registration FROM pos_settings LIMIT 1');
    const nullLineType = settings?.vat_registration === 'NON_VAT' ? 'NON_VAT' : 'VAT';

    await query(`
      CREATE TABLE IF NOT EXISTS ${BACKUP} (
        pos_transaction_id VARCHAR(50) NOT NULL PRIMARY KEY,
        previous_tax_amount DECIMAL(12,2) NOT NULL,
        new_tax_amount DECIMAL(12,2) NOT NULL,
        backfilled_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // The VAT each candidate row's lines carry.
    const computed = `
      SELECT pt.id AS pos_transaction_id,
             COALESCE(pt.tax_amount, 0) AS previous_tax_amount,
             ROUND(SUM(CASE WHEN COALESCE(pti.tax_type, ?) = 'VAT'
                            THEN pti.line_total - pti.line_total / 1.12 ELSE 0 END), 2) AS new_tax_amount
        FROM pos_transactions pt
        JOIN pos_transaction_items pti ON pti.pos_transaction_id = pt.id
       WHERE COALESCE(pt.tax_amount, 0) = 0
         AND (pt.transaction_type = 'return'
              OR (pt.transaction_type = 'sale' AND pt.exchange_group_id IS NOT NULL))
       GROUP BY pt.id
      HAVING new_tax_amount <> 0
    `;

    await query(
      `INSERT IGNORE INTO ${BACKUP} (pos_transaction_id, previous_tax_amount, new_tax_amount)
       SELECT pos_transaction_id, previous_tax_amount, new_tax_amount FROM (${computed}) c`,
      [nullLineType]
    );

    const result: any = await query(
      `UPDATE pos_transactions pt
         JOIN ${BACKUP} b ON b.pos_transaction_id = pt.id
          SET pt.tax_amount = b.new_tax_amount
        WHERE COALESCE(pt.tax_amount, 0) = b.previous_tax_amount`
    );
    const [summary]: any = await query(
      `SELECT COUNT(*) AS n, COALESCE(SUM(new_tax_amount), 0) AS vat FROM ${BACKUP}`
    );
    console.log(
      `✅ pos_transactions: backfilled VAT on ${result?.affectedRows ?? 0} row(s) ` +
      `(${summary?.n ?? 0} recorded in ${BACKUP}, net VAT ${Number(summary?.vat || 0).toFixed(2)})`
    );
  },

  async down(): Promise<void> {
    const [exists]: any = await query(
      `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [BACKUP]
    );
    if (!Number(exists?.n)) {
      console.log(`⏭️  ${BACKUP} not found, nothing to restore`);
      return;
    }
    // Only rows still holding the backfilled value: anything changed since is
    // left alone rather than clobbered.
    const result: any = await query(
      `UPDATE pos_transactions pt
         JOIN ${BACKUP} b ON b.pos_transaction_id = pt.id
          SET pt.tax_amount = b.previous_tax_amount
        WHERE pt.tax_amount = b.new_tax_amount`
    );
    await query(`DROP TABLE ${BACKUP}`);
    console.log(`✅ pos_transactions: restored tax_amount on ${result?.affectedRows ?? 0} row(s)`);
  },
};

registerMigration(migration);

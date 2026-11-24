import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';
import {
  applyRegistrationToTaxType,
  mapVatStatusToTaxType,
  parseTaxType,
  resolveEffectiveTaxType,
  vatOfLines,
} from '../../lib/tax-utils';

/**
 * Backfills pos_transactions.tax_amount on rows that were written with a
 * literal 0 before commit a029f732 (2026-11-24):
 *  - every RETURN row (Merchandise Credit, and an exchange's return leg), and
 *  - every exchange SALE leg (exchange_group_id set) — a real sale with an SI
 *    number whose VAT the X-reading and e-journal read from this column.
 *
 * Left at 0, reports summing pt.total_amount and pt.tax_amount (Sales by Date,
 * Sales Transactions) netted a return out of revenue but not out of VAT, and an
 * exchange's sale reported no VAT. Line-based readings (the Z-reading, BIR
 * Sales Summary, Sta. Lucia) were already right and are unaffected.
 *
 * WHERE EACH LINE'S TAX TYPE COMES FROM. Not from the line itself: until
 * cd264d87 (2026-11-13) the return and exchange writers did not set
 * pos_transaction_items.tax_type, so those lines hold the column DEFAULT 'VAT'
 * whatever the item really was (migration 148). Trusting it would book VAT on
 * a non-VAT store's returns, and on returns of senior/PWD (VAT-exempt) lines.
 *  - A RETURN line takes the tax type of the original sale line it reverses —
 *    the oldest line of that product on that sale, the rule processReturnLeg
 *    applies — because checkout always recorded that one correctly. An
 *    original that is itself an exchange sale leg is not trusted either.
 *  - An EXCHANGE SALE leg, and a return line with no trustworthy original,
 *    are resolved from the product's vat_status and the store's registration,
 *    the way the exchange route and checkout resolve a line.
 * VAT is then 12/112 of each VAT line (vatOfLines), signed like the line.
 *
 * Only rows still at 0 (or NULL) whose lines give a non-zero VAT are touched,
 * so it is idempotent and never overwrites a value something else wrote. An
 * ordinary (non-exchange) sale at 0 is NOT touched: that can be a genuinely
 * VAT-exempt sale, and checkout always wrote its own tax_amount.
 *
 * Every changed row's previous value is kept in pos_transactions_vat_backfill,
 * and down() restores only rows still holding the backfilled value.
 */

const BACKUP = 'pos_transactions_vat_backfill';

const migration: Migration = {
  name: '155_backfill_return_and_exchange_vat',
  timestamp: '2026-11-24_14-00-00',

  async up(): Promise<void> {
    const [settings]: any = await query('SELECT vat_registration FROM pos_settings LIMIT 1');
    const registration: string = settings?.vat_registration || 'VAT';
    const fromProduct = (vatStatus: string | null) =>
      resolveEffectiveTaxType(mapVatStatusToTaxType(vatStatus ?? undefined), undefined, 0, registration);

    await query(`
      CREATE TABLE IF NOT EXISTS ${BACKUP} (
        pos_transaction_id VARCHAR(50) NOT NULL PRIMARY KEY,
        previous_tax_amount DECIMAL(12,2) NOT NULL,
        new_tax_amount DECIMAL(12,2) NOT NULL,
        backfilled_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Lines of every candidate row, with the original sale line's tax type for
    // a return (NULL when there is none, or it is itself an exchange sale leg).
    const lines: any[] = await query(`
      SELECT pt.id AS pos_transaction_id,
             pt.transaction_type,
             pti.line_total,
             p.vat_status,
             CASE WHEN pt.transaction_type = 'return' THEN (
               SELECT opti.tax_type
                 FROM sale_items osi
                 JOIN pos_transaction_items opti ON opti.sale_item_id = osi.id
                 JOIN pos_transactions opt ON opt.id = opti.pos_transaction_id
                WHERE osi.sale_id = pt.sale_id
                  AND osi.product_id = pti.product_id
                  AND osi.quantity > 0
                  AND opt.transaction_type = 'sale'
                  AND opt.exchange_group_id IS NULL
                ORDER BY osi.created_at ASC
                LIMIT 1
             ) END AS original_tax_type
        FROM pos_transactions pt
        JOIN pos_transaction_items pti ON pti.pos_transaction_id = pt.id
        LEFT JOIN products p ON p.id = pti.product_id
       WHERE COALESCE(pt.tax_amount, 0) = 0
         AND (pt.transaction_type = 'return'
              OR (pt.transaction_type = 'sale' AND pt.exchange_group_id IS NOT NULL))
    `);

    const byRow = new Map<string, { lineTotal: number; taxType: string }[]>();
    for (const l of lines) {
      const original = parseTaxType(l.original_tax_type);
      const taxType = original ?? fromProduct(l.vat_status);
      const list = byRow.get(l.pos_transaction_id) || [];
      list.push({ lineTotal: Number(l.line_total) || 0, taxType });
      byRow.set(l.pos_transaction_id, list);
    }

    let changed = 0;
    let netVat = 0;
    for (const [id, rowLines] of byRow) {
      const vat = vatOfLines(rowLines);
      if (vat === 0) continue;
      await query(
        `INSERT IGNORE INTO ${BACKUP} (pos_transaction_id, previous_tax_amount, new_tax_amount) VALUES (?, 0, ?)`,
        [id, vat]
      );
      const result: any = await query(
        'UPDATE pos_transactions SET tax_amount = ? WHERE id = ? AND COALESCE(tax_amount, 0) = 0',
        [vat, id]
      );
      if (result?.affectedRows) {
        changed += 1;
        netVat += vat;
      }
    }
    console.log(
      `✅ pos_transactions: backfilled VAT on ${changed} row(s), net VAT ${netVat.toFixed(2)} ` +
      `(registration ${applyRegistrationToTaxType('VAT', registration) === 'VAT' ? 'VAT' : 'NON_VAT'})`
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

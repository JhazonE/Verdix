import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Add the BIR Official Receipt (OR) number series.
 *
 * BIR rules require goods sales to be documented as a Sales Invoice (the
 * existing si_number series) and services sales as an Official Receipt —
 * a legally distinct document type with its own numbering series, not a
 * cosmetic label choice.
 *
 * Named bir_or_number (not or_number) to avoid confusion with the existing,
 * unrelated pos_terminals.or_next_reference / transaction_references.receipt_number
 * counter, which is a generic per-terminal receipt reference issued for every
 * sale regardless of goods/services classification — not a BIR series.
 *
 * This migration:
 *   1. Adds transaction_references.bir_or_number — the counter, mirroring
 *      si_number and mc_number. Starts at '000000' because getNextBirOrNumber()
 *      increments-then-reads, so the FIRST Official Receipt issued is OR-000001.
 *   2. Adds sales_transactions.bir_or_number and pos_transactions.bir_or_number —
 *      where the issued number is stored per sale. NULL for goods sales (which
 *      use si_number instead) and for historical pre-split rows.
 *
 * Existing sales are deliberately NOT backfilled or reclassified — every
 * historical si_number row predates this split and stays implicitly part of
 * the goods/SI series.
 */
const migration: Migration = {
  name: '109_add_bir_or_number',
  timestamp: '2026-08-11_10-00-00',

  async up(): Promise<void> {
    // 1. The counter.
    const [refCol]: any = await query(`
      SELECT COUNT(*) AS cnt
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'transaction_references'
        AND COLUMN_NAME = 'bir_or_number'
    `);
    if (refCol?.cnt > 0) {
      console.log('• transaction_references.bir_or_number already exists — skipping');
    } else {
      await query(`
        ALTER TABLE transaction_references
        ADD COLUMN bir_or_number VARCHAR(20) NOT NULL DEFAULT '000000'
      `);
      console.log('✅ Added transaction_references.bir_or_number (counter, starts 000000)');
    }

    await query(`
      UPDATE transaction_references
      SET bir_or_number = '000000'
      WHERE id = 1 AND (bir_or_number IS NULL OR bir_or_number = '')
    `);

    // 2. sales_transactions.bir_or_number
    const [saleCol]: any = await query(`
      SELECT COUNT(*) AS cnt
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'sales_transactions'
        AND COLUMN_NAME = 'bir_or_number'
    `);
    if (saleCol?.cnt > 0) {
      console.log('• sales_transactions.bir_or_number already exists — skipping');
    } else {
      await query(`
        ALTER TABLE sales_transactions
        ADD COLUMN bir_or_number VARCHAR(20) NULL
      `);
      console.log('✅ Added sales_transactions.bir_or_number');

      await query(`
        CREATE UNIQUE INDEX idx_sales_transactions_bir_or_number
        ON sales_transactions (bir_or_number)
      `);
      console.log('✅ Added unique index on sales_transactions.bir_or_number');
    }

    // 3. pos_transactions.bir_or_number
    const [posCol]: any = await query(`
      SELECT COUNT(*) AS cnt
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'pos_transactions'
        AND COLUMN_NAME = 'bir_or_number'
    `);
    if (posCol?.cnt > 0) {
      console.log('• pos_transactions.bir_or_number already exists — skipping');
      return;
    }

    await query(`
      ALTER TABLE pos_transactions
      ADD COLUMN bir_or_number VARCHAR(20) NULL
    `);
    console.log('✅ Added pos_transactions.bir_or_number');

    await query(`
      CREATE UNIQUE INDEX idx_pos_transactions_bir_or_number
      ON pos_transactions (bir_or_number)
    `);
    console.log('✅ Added unique index on pos_transactions.bir_or_number');
  },

  async down(): Promise<void> {
    await query(`DROP INDEX idx_pos_transactions_bir_or_number ON pos_transactions`);
    await query(`ALTER TABLE pos_transactions DROP COLUMN bir_or_number`);
    console.log('✅ Dropped pos_transactions.bir_or_number');

    await query(`DROP INDEX idx_sales_transactions_bir_or_number ON sales_transactions`);
    await query(`ALTER TABLE sales_transactions DROP COLUMN bir_or_number`);
    console.log('✅ Dropped sales_transactions.bir_or_number');

    await query(`ALTER TABLE transaction_references DROP COLUMN bir_or_number`);
    console.log('✅ Dropped transaction_references.bir_or_number');
  }
};

registerMigration(migration);

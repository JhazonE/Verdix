import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Adds the BIR tax-breakdown columns to `pos_transaction_items` as a real
 * migration: `tax_type`, plus the three discount-attribution columns that were
 * introduced alongside it.
 *
 * WHY: these four columns were never migrated. They are created lazily by
 * `ensurePosTransactionItemsSchema()` in `app/api/pos/checkout/route.ts`, which
 * runs on the FIRST CHECKOUT of a process and then short-circuits on a module
 * flag. The consequence is that a database which has never taken a sale does
 * not have these columns at all — a fresh install, a newly provisioned cloud
 * tenant, or `verdix_test` after a schema clone. Any report that reads
 * `pti.tax_type` therefore fails with ER_BAD_FIELD_ERROR rather than returning
 * an empty result, and it fails at query time, not at build or typecheck.
 *
 * `app/api/sales/bir-summary/route.ts` already reads `tax_type` and has always
 * had this exposure; the Sales by Tax Type report and the Sales by Product
 * tax filter added in the same change read it too. This migration is what makes
 * those reports safe to run against a database that has not yet seen a sale.
 *
 * The lazy ALTER in the checkout route is deliberately LEFT IN PLACE. It is
 * idempotent, it costs one INFORMATION_SCHEMA query per process, and removing
 * it would strand any deployment that upgrades its code without running
 * migrations — which is the normal path for the terminal updater (see
 * `docs`/memory on multi-terminal upgrades). The two mechanisms agree on
 * definitions, so whichever runs first wins and the other becomes a no-op.
 *
 * DEFAULT 'VAT' matches both the lazy ALTER and every reader's
 * `COALESCE(pti.tax_type, 'VAT')`: a line written before this column existed
 * was VAT-able, because that is the only thing the system could charge at the
 * time. Readers must keep that COALESCE — this migration backfills nothing, so
 * pre-existing rows keep whatever the column default gave them (NULL for rows
 * that predate the lazy ALTER on an upgraded DB).
 */

const COLUMNS: { name: string; ddl: string }[] = [
  { name: 'discount_type', ddl: "VARCHAR(50) DEFAULT 'percent'" },
  { name: 'tax_type', ddl: "VARCHAR(50) DEFAULT 'VAT'" },
  { name: 'discount_id_number', ddl: 'VARCHAR(100) DEFAULT NULL' },
  { name: 'discount_holder_name', ddl: 'VARCHAR(255) DEFAULT NULL' },
];

async function tableExists(table: string): Promise<boolean> {
  const rows: any = await query(
    `SELECT COUNT(*) AS n FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return Number(rows?.[0]?.n || 0) > 0;
}

async function existingColumns(table: string): Promise<Set<string>> {
  const rows: any = await query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return new Set((rows || []).map((r: any) => r.COLUMN_NAME));
}

const migration: Migration = {
  name: '148_add_tax_type_to_pos_transaction_items',
  timestamp: '2026-11-06_10-00-00',

  async up() {
    if (!(await tableExists('pos_transaction_items'))) {
      console.log('⏭️  pos_transaction_items does not exist, skipping');
      return;
    }

    const present = await existingColumns('pos_transaction_items');
    const missing = COLUMNS.filter((c) => !present.has(c.name));

    if (missing.length === 0) {
      console.log('✅ pos_transaction_items already has the tax/discount columns');
      return;
    }

    // One ALTER for all missing columns: this table grows large on a busy store
    // and MySQL 8 rewrites far less doing a single pass.
    await query(
      `ALTER TABLE pos_transaction_items ${missing
        .map((c) => `ADD COLUMN ${c.name} ${c.ddl}`)
        .join(', ')}`
    );
    console.log(
      `✅ pos_transaction_items: added ${missing.map((c) => c.name).join(', ')}`
    );
  },

  async down() {
    if (!(await tableExists('pos_transaction_items'))) return;

    const present = await existingColumns('pos_transaction_items');
    const toDrop = COLUMNS.filter((c) => present.has(c.name));

    if (toDrop.length === 0) {
      console.log('✅ pos_transaction_items: tax/discount columns already absent');
      return;
    }

    // NOTE: dropping these discards the per-line BIR tax classification and the
    // statutory-discount holder details, which are legally significant records.
    // `down()` exists for migration symmetry; do not run it on a store that has
    // filed sales under these columns.
    await query(
      `ALTER TABLE pos_transaction_items ${toDrop
        .map((c) => `DROP COLUMN ${c.name}`)
        .join(', ')}`
    );
    console.log(
      `✅ pos_transaction_items: dropped ${toDrop.map((c) => c.name).join(', ')}`
    );
  },
};

registerMigration(migration);

export default migration;

import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Restores quantity-tier (bulk break) pricing on price levels, reversing the
 * column drop in 128_drop_price_level_min_quantity.
 *
 * A row in product_selling_unit_price_levels may now carry a threshold: the
 * override applies from that quantity UP (>=), and below it the row is not a
 * price candidate at all, so the selling unit's own `price` stands. 0 means
 * no threshold — the override applies from quantity 1, which is exactly how
 * every row behaved while the column was gone.
 *
 * That default is what makes this migration safe on live data: every existing
 * row backfills to 0 and keeps the price it resolves to today. Nothing
 * becomes cheaper or dearer until someone sets a threshold deliberately.
 *
 * NOT restored: price_levels.min_quantity. 128 recorded that it was already
 * dead before that migration — no UI exposed it and no pricing logic read it,
 * only addPriceLevel/updatePriceLevel round-tripped the value. Tiers are a
 * per-selling-unit property (a Case's "3+" tier is not the Piece's "36+"), so
 * a store-wide column on the level itself has nothing to say. Re-adding it
 * would recreate a column with no reader.
 */
const migration: Migration = {
  name: '134_restore_price_level_min_quantity',
  timestamp: '2026-10-03_10-00-00',

  async up(): Promise<void> {
    const sulpColumn: any = await query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'product_selling_unit_price_levels' AND TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'min_quantity'"
    );
    if (!sulpColumn || sulpColumn.length === 0) {
      await query(
        'ALTER TABLE product_selling_unit_price_levels ADD COLUMN min_quantity INT NOT NULL DEFAULT 0'
      );
      console.log('✅ added product_selling_unit_price_levels.min_quantity (NOT NULL DEFAULT 0 — every existing override keeps applying from quantity 1)');
    } else {
      // The column can already be here on a database that never ran 128, or
      // one restored from a pre-128 dump. Normalise NULLs so the resolver
      // never has to guess: NULL and 0 both mean "no threshold", and making
      // that explicit keeps the column's meaning single-valued.
      const nulls: any = await query(
        'UPDATE product_selling_unit_price_levels SET min_quantity = 0 WHERE min_quantity IS NULL'
      );
      if (nulls?.affectedRows) {
        console.log(`✅ normalised ${nulls.affectedRows} NULL min_quantity row(s) to 0`);
      }
      console.log('⏭️  product_selling_unit_price_levels.min_quantity already present, skipping add');
    }
  },

  async down(): Promise<void> {
    const sulpColumn: any = await query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'product_selling_unit_price_levels' AND TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'min_quantity'"
    );
    if (sulpColumn && sulpColumn.length > 0) {
      // Same warning 128 carried, for the same reason: dropping the column
      // turns a genuine tier into an UNCONDITIONAL override for its level,
      // applying from quantity 1 instead of only at the threshold. That is a
      // real pricing change, not a schema no-op, so list the affected rows
      // rather than silently reinterpreting them.
      const tieredRows: any = await query(
        'SELECT selling_unit_id, price_level_id, price, min_quantity FROM product_selling_unit_price_levels WHERE min_quantity > 0'
      );
      if (tieredRows && tieredRows.length > 0) {
        console.log(`⚠️  ${tieredRows.length} row(s) carry a real quantity tier — dropping the column makes each an UNCONDITIONAL price for its level, applying from quantity 1:`);
        for (const row of tieredRows) {
          console.log(`   selling_unit_id=${row.selling_unit_id} price_level_id=${row.price_level_id} price=${row.price} (tiered at min_quantity=${row.min_quantity})`);
        }
      }
      await query('ALTER TABLE product_selling_unit_price_levels DROP COLUMN min_quantity');
      console.log('✅ dropped product_selling_unit_price_levels.min_quantity');
    } else {
      console.log('⏭️  product_selling_unit_price_levels.min_quantity already gone, skipping');
    }
  }
};

registerMigration(migration);

import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';
import { backfillBaseSellingUnits } from './base-selling-unit-backfill';

/**
 * Gives every existing product a base selling unit (factor 1), carrying its
 * current unit_of_measure, barcode, cost and price.
 *
 * The PRICE is what the till charged before selling units: the product's
 * default price-level row when it has one, else products.price. Copying the
 * raw products.price instead made upgraded stores sell at cost wherever that
 * column was stale — see base-selling-unit-backfill.ts for the full story.
 *
 * Without this, checkout has no unit to resolve and every sale for that product
 * fails — so it runs over the whole table, not a subset.
 *
 * It does NOT rewrite names, does NOT merge products, and does NOT touch
 * products.stock. Barcodes move across as-is; the live data has no duplicates,
 * and any that appear later surface as a UNIQUE violation for a human to
 * resolve rather than being silently dropped.
 */
const migration: Migration = {
  name: '119_backfill_base_selling_units',
  timestamp: '2026-09-10_12-30-00',

  async up(): Promise<void> {
    const dupes: any = await query(`
      SELECT barcode, COUNT(*) AS n FROM products
      WHERE barcode IS NOT NULL AND barcode <> ''
      GROUP BY barcode HAVING n > 1
    `);
    if (dupes.length > 0) {
      console.error('❌ duplicate barcodes block the base-unit backfill:');
      for (const d of dupes) console.error(`   ${d.barcode} (${d.n} products)`);
      throw new Error(
        `${dupes.length} duplicate barcode(s). Resolve these in the products list, then re-run.`
      );
    }

    const created = await backfillBaseSellingUnits(query);
    console.log(`✅ created ${created} base selling unit(s)`);
  },

  async down(): Promise<void> {
    const result: any = await query(
      "DELETE FROM product_selling_units WHERE is_base = 1 AND id LIKE 'psu_base_%'"
    );
    console.log(`✅ removed ${result.affectedRows} backfilled base unit(s)`);
  }
};

registerMigration(migration);

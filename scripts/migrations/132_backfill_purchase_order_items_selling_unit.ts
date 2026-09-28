import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Backfills existing purchase_order_items to their product's base selling
 * unit. Every pre-existing row's quantity/cost was always implicitly a
 * base-unit (factor 1) value, so this only fills metadata — no quantity or
 * cost value changes.
 *
 * A product with no base selling unit row (would predate migration 119,
 * or the product was hard-deleted after the PO was placed) is left NULL;
 * every downstream reader treats NULL factor as 1, so this is safe.
 */
const migration: Migration = {
  name: '132_backfill_purchase_order_items_selling_unit',
  timestamp: '2026-09-28_09-05-00',

  async up(): Promise<void> {
    const result: any = await query(`
      UPDATE purchase_order_items poi
      JOIN product_selling_units psu
        ON psu.product_id = poi.product_id AND psu.is_base = 1
      SET
        poi.selling_unit_id = psu.id,
        poi.selling_unit_name = psu.name,
        poi.selling_unit_factor = psu.factor
      WHERE poi.selling_unit_id IS NULL
    `);
    console.log(`✅ backfilled ${result.affectedRows ?? 0} purchase_order_items rows to base selling unit`);
  },

  async down(): Promise<void> {
    await query(`
      UPDATE purchase_order_items
      SET selling_unit_id = NULL, selling_unit_name = NULL, selling_unit_factor = NULL
    `);
    console.log('✅ cleared purchase_order_items selling unit backfill');
  }
};

registerMigration(migration);

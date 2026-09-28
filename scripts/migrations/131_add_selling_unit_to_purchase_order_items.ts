import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Records which selling unit a PO line was ordered/received in (e.g. Case
 * vs Piece), mirroring migration 120's sale_items columns. Unlike 120,
 * existing rows here are backfilled to the base unit in migration 132
 * rather than left NULL — a PO's landed-cost/receiving math needs a
 * concrete factor to convert by, so "NULL means base" would require every
 * consumer to re-derive that fallback instead of reading it once.
 */
async function hasColumn(column: string): Promise<boolean> {
  const rows: any = await query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchase_order_items' AND COLUMN_NAME = ?`,
    [column],
  );
  return Boolean(rows[0]);
}

const migration: Migration = {
  name: '131_add_selling_unit_to_purchase_order_items',
  timestamp: '2026-09-28_09-00-00',

  async up(): Promise<void> {
    if (await hasColumn('selling_unit_id')) {
      console.log('⏭️  purchase_order_items already has selling unit columns, skipping');
      return;
    }
    await query(`
      ALTER TABLE purchase_order_items
        ADD COLUMN selling_unit_id     VARCHAR(100)  NULL,
        ADD COLUMN selling_unit_name   VARCHAR(100)  NULL,
        ADD COLUMN selling_unit_factor DECIMAL(12,4) NULL
    `);
    console.log('✅ purchase_order_items: added selling unit columns');
  },

  async down(): Promise<void> {
    if (!(await hasColumn('selling_unit_id'))) return;
    await query(`
      ALTER TABLE purchase_order_items
        DROP COLUMN selling_unit_id,
        DROP COLUMN selling_unit_name,
        DROP COLUMN selling_unit_factor
    `);
    console.log('✅ purchase_order_items: dropped selling unit columns');
  }
};

registerMigration(migration);

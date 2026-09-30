import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Repackaging now happens inside one product, converting between its selling
 * units (Case -> Piece). Each log snapshots the units used, the same way
 * sale_items and purchase_order_items do, so a later edit to a unit cannot
 * change what a filed record meant. shortfall_base_qty is the base units that
 * did not come out (torn box, spoilage) and were written off as an adjustment.
 * Rows from the old two-product flow leave every new column NULL.
 */
async function hasColumn(column: string): Promise<boolean> {
  const rows: any = await query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repackaging_logs' AND COLUMN_NAME = ?`,
    [column],
  );
  return Boolean(rows[0]);
}

const migration: Migration = {
  name: '133_add_selling_units_to_repackaging_logs',
  timestamp: '2026-09-30_09-00-00',

  async up(): Promise<void> {
    if (await hasColumn('source_selling_unit_id')) {
      console.log('⏭️  repackaging_logs already has selling unit columns, skipping');
      return;
    }
    await query(`
      ALTER TABLE repackaging_logs
        ADD COLUMN source_selling_unit_id     VARCHAR(100)  NULL,
        ADD COLUMN source_selling_unit_name   VARCHAR(100)  NULL,
        ADD COLUMN source_selling_unit_factor DECIMAL(12,4) NULL,
        ADD COLUMN target_selling_unit_id     VARCHAR(100)  NULL,
        ADD COLUMN target_selling_unit_name   VARCHAR(100)  NULL,
        ADD COLUMN target_selling_unit_factor DECIMAL(12,4) NULL,
        ADD COLUMN shortfall_base_qty         DECIMAL(15,4) NULL
    `);
    console.log('✅ repackaging_logs: added selling unit columns');
  },

  async down(): Promise<void> {
    if (!(await hasColumn('source_selling_unit_id'))) return;
    await query(`
      ALTER TABLE repackaging_logs
        DROP COLUMN source_selling_unit_id,
        DROP COLUMN source_selling_unit_name,
        DROP COLUMN source_selling_unit_factor,
        DROP COLUMN target_selling_unit_id,
        DROP COLUMN target_selling_unit_name,
        DROP COLUMN target_selling_unit_factor,
        DROP COLUMN shortfall_base_qty
    `);
    console.log('✅ repackaging_logs: dropped selling unit columns');
  }
};

registerMigration(migration);

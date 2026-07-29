import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Movement-aware stock count variance.
 *
 * A count froze snapshot_quantity at creation and compared the physical count
 * against it at completion. Every POS sale in between was therefore treated as
 * variance and deducted a second time. Fixing that needs to know WHEN a line was
 * counted, so the movements inside that window can be cancelled out.
 *
 * counted_at is deliberately NOT updated_at: updated_at moves on any UPDATE,
 * including ones unrelated to counting, so it cannot anchor the baseline window.
 *
 * The INT -> DECIMAL widening rides along because family-sync divides by
 * factorToRoot and works in fractional root units, so INT columns silently
 * truncate counts of repacked goods.
 */
async function hasColumn(table: string, column: string): Promise<boolean> {
  const rows: any = await query(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return (rows?.[0]?.cnt ?? 0) > 0;
}

const migration: Migration = {
  name: '103_stock_count_movement_aware_variance',
  timestamp: '2026-07-29_09-00-00',

  async up(): Promise<void> {
    if (await hasColumn('stock_count_items', 'counted_at')) {
      console.log('• stock_count_items.counted_at already exists — skipping');
    } else {
      await query(`ALTER TABLE stock_count_items ADD COLUMN counted_at TIMESTAMP NULL AFTER counted_quantity`);
      console.log('✅ Added stock_count_items.counted_at');

      // Existing in-progress counts would otherwise have a null baseline anchor.
      // updated_at is the best available approximation for rows already counted.
      await query(`UPDATE stock_count_items SET counted_at = updated_at WHERE counted_quantity IS NOT NULL`);
      console.log('✅ Backfilled counted_at from updated_at');
    }

    if (await hasColumn('stock_counts', 'snapshot_at')) {
      console.log('• stock_counts.snapshot_at already exists — skipping');
    } else {
      await query(`ALTER TABLE stock_counts ADD COLUMN snapshot_at TIMESTAMP NULL AFTER created_at`);
      await query(`UPDATE stock_counts SET snapshot_at = created_at WHERE snapshot_at IS NULL`);
      console.log('✅ Added and backfilled stock_counts.snapshot_at');
    }

    // Widen quantities. MODIFY is idempotent — re-running lands on the same type.
    await query(`ALTER TABLE stock_count_items MODIFY COLUMN snapshot_quantity DECIMAL(15,4) NOT NULL`);
    await query(`ALTER TABLE stock_count_items MODIFY COLUMN counted_quantity DECIMAL(15,4) NULL`);
    await query(`ALTER TABLE stock_count_items MODIFY COLUMN variance DECIMAL(15,4) NULL`);
    console.log('✅ Widened stock count quantities to DECIMAL(15,4)');
  },

  async down(): Promise<void> {
    await query(`ALTER TABLE stock_count_items MODIFY COLUMN variance INT NULL`);
    await query(`ALTER TABLE stock_count_items MODIFY COLUMN counted_quantity INT NULL`);
    await query(`ALTER TABLE stock_count_items MODIFY COLUMN snapshot_quantity INT NOT NULL`);
    await query(`ALTER TABLE stock_counts DROP COLUMN snapshot_at`);
    await query(`ALTER TABLE stock_count_items DROP COLUMN counted_at`);
    console.log('✅ Reverted movement-aware stock count columns');
  }
};

registerMigration(migration);

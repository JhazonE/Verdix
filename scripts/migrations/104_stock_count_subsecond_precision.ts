import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Microsecond precision for the stock-count movement window.
 *
 * The window is [snapshot_at, counted_at] and is matched against
 * stock_movements.created_at. All three were 1-second TIMESTAMPs, so a sale
 * committed in the same second as the snapshot fell outside `created_at >
 * from` while still being reflected in products.stock. That tripped the
 * baseline's reconciliation check and made a stock count reverse a real sale.
 *
 * TIMESTAMP(6), not (3): six rapid inserts at millisecond precision were
 * measured colliding on this server; at microsecond they were all distinct.
 */
const migration: Migration = {
  name: '104_stock_count_subsecond_precision',
  timestamp: '2026-07-29_12-00-00',

  async up(): Promise<void> {
    await query(`ALTER TABLE stock_counts MODIFY COLUMN snapshot_at TIMESTAMP(6) NULL`);
    console.log('✅ stock_counts.snapshot_at -> TIMESTAMP(6)');

    await query(`ALTER TABLE stock_count_items MODIFY COLUMN counted_at TIMESTAMP(6) NULL`);
    console.log('✅ stock_count_items.counted_at -> TIMESTAMP(6)');

    // The window is only as precise as the column it is compared against.
    await query(`ALTER TABLE stock_movements MODIFY COLUMN created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)`);
    console.log('✅ stock_movements.created_at -> TIMESTAMP(6)');
  },

  async down(): Promise<void> {
    console.warn('⚠️  Reverting to 1-second precision reintroduces the same-second window bug.');
    await query(`ALTER TABLE stock_movements MODIFY COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
    await query(`ALTER TABLE stock_count_items MODIFY COLUMN counted_at TIMESTAMP NULL`);
    await query(`ALTER TABLE stock_counts MODIFY COLUMN snapshot_at TIMESTAMP NULL`);
    console.log('✅ Reverted stock count window columns to second precision');
  }
};

registerMigration(migration);

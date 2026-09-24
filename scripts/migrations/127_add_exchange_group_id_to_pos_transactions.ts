import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

const migration: Migration = {
  name: '127_add_exchange_group_id_to_pos_transactions',
  timestamp: new Date().toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/g, '-'),

  async up(): Promise<void> {
    const existingColumns: any = await query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'pos_transactions' AND TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'exchange_group_id'"
    );
    if (!existingColumns || existingColumns.length === 0) {
      await query('ALTER TABLE pos_transactions ADD COLUMN exchange_group_id VARCHAR(50) NULL');
      await query('ALTER TABLE pos_transactions ADD INDEX idx_exchange_group_id (exchange_group_id)');
      console.log('✅ Added exchange_group_id column + index to pos_transactions');
    } else {
      console.log('ℹ️  exchange_group_id already exists on pos_transactions, skipping');
    }
  },

  async down(): Promise<void> {
    const existingColumns: any = await query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'pos_transactions' AND TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'exchange_group_id'"
    );
    if (existingColumns && existingColumns.length > 0) {
      await query('ALTER TABLE pos_transactions DROP INDEX idx_exchange_group_id');
      await query('ALTER TABLE pos_transactions DROP COLUMN exchange_group_id');
      console.log('✅ Dropped exchange_group_id column + index from pos_transactions');
    }
  }
};

registerMigration(migration);

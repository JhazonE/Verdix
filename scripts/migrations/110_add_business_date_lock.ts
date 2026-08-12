import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Add per-terminal business-date locking.
 *
 * BIR Annex F checklist item #29: once a Z-Reading/EOD report is generated,
 * subsequent sales must reflect the next business day, not the same date.
 * business_date_locked_at is set the moment a Z-reading is generated for a
 * terminal, and cleared the moment a new shift starts on that terminal —
 * checkout rejects any sale while it is non-null.
 *
 * Locking is per-terminal, not store-wide: this column lives on
 * pos_terminals, matching the existing per-terminal scope of z_counter,
 * reset_counter, and the Z-reading generation flow itself.
 */
export const migration: Migration = {
  name: '110_add_business_date_lock',
  timestamp: '2026-08-11_16-00-00',

  async up() {
    console.log('Running migration: 110_add_business_date_lock');
    try {
      await query(`ALTER TABLE pos_terminals ADD COLUMN business_date_locked_at TIMESTAMP NULL DEFAULT NULL`);
      console.log('✅ Added business_date_locked_at to pos_terminals');
    } catch (e: any) {
      if (e.code === 'ER_DUP_COLUMN_NAME' || e.errno === 1060) {
        console.log('⚠️ Column business_date_locked_at already exists in pos_terminals');
      } else {
        throw e;
      }
    }
  },

  async down() {
    console.log('Rolling back migration: 110_add_business_date_lock');
    await query(`ALTER TABLE pos_terminals DROP COLUMN business_date_locked_at`);
  }
};

registerMigration(migration);

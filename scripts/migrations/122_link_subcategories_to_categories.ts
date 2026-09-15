import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Links subcategories to a parent category. Before this, subcategories was a
 * flat, globally-unique-by-name list with no relationship to categories —
 * the product form's Category and Subcategory pickers were two independent
 * lists with no cascading between them.
 *
 * Existing subcategories are left with category_id = NULL ("Unassigned").
 * Nothing here guesses which category an existing subcategory belongs to —
 * a person assigns it later via the Manage Subcategories page.
 */

async function hasColumn(table: string, column: string): Promise<boolean> {
  const rows: any = await query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column],
  );
  return Boolean(rows[0]);
}

async function hasIndex(table: string, indexName: string): Promise<boolean> {
  const rows: any = await query(
    `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, indexName],
  );
  return Boolean(rows[0]);
}

const migration: Migration = {
  name: '122_link_subcategories_to_categories',
  timestamp: '2026-09-15_09-00-00',

  async up(): Promise<void> {
    if (await hasColumn('subcategories', 'category_id')) {
      console.log('⏭️  subcategories.category_id already exists, skipping column add');
    } else {
      await query(`
        ALTER TABLE subcategories
          ADD COLUMN category_id VARCHAR(50) NULL,
          ADD CONSTRAINT fk_subcategories_category
            FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
      `);
      console.log('✅ subcategories: added category_id column + FK');
    }

    // The old global UNIQUE(name) constraint (MySQL names a single-column
    // unique index after the column by default: "name") must go before the
    // composite one can be added, or two rows in different categories with
    // the same name would still collide on the old index.
    if (await hasIndex('subcategories', 'name')) {
      await query('ALTER TABLE subcategories DROP INDEX `name`');
      console.log('✅ subcategories: dropped old global UNIQUE(name) index');
    } else {
      console.log('⏭️  subcategories: old UNIQUE(name) index already gone, skipping drop');
    }

    if (await hasIndex('subcategories', 'subcat_category_name')) {
      console.log('⏭️  subcategories: subcat_category_name index already exists, skipping');
    } else {
      await query(`
        ALTER TABLE subcategories
          ADD CONSTRAINT subcat_category_name UNIQUE (category_id, name)
      `);
      console.log('✅ subcategories: added UNIQUE(category_id, name)');
    }
  },

  async down(): Promise<void> {
    if (await hasIndex('subcategories', 'subcat_category_name')) {
      await query('ALTER TABLE subcategories DROP INDEX subcat_category_name');
      console.log('✅ subcategories: dropped UNIQUE(category_id, name)');
    }
    if (await hasColumn('subcategories', 'category_id')) {
      await query('ALTER TABLE subcategories DROP FOREIGN KEY fk_subcategories_category');
      await query('ALTER TABLE subcategories DROP COLUMN category_id');
      console.log('✅ subcategories: dropped category_id column + FK');
    }
    if (!(await hasIndex('subcategories', 'name'))) {
      await query('ALTER TABLE subcategories ADD CONSTRAINT `name` UNIQUE (name)');
      console.log('✅ subcategories: restored global UNIQUE(name) index');
    }
  }
};

registerMigration(migration);

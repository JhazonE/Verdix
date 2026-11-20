import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Removes price-level rows left behind by levels deleted before
 * `deletePriceLevel` started cleaning up after itself (commit b65d4a8b).
 *
 * WHY: product_selling_unit_price_levels.price_level_id has no foreign key, so
 * deleting a level used to remove only the price_levels row. Products on
 * installs that deleted a level on an older version still list it as a raw
 * "pl_1794882878847" id. The code fix only prevents NEW orphans; this clears
 * the existing ones on every install.
 *
 * `customers.price_level_id` DOES carry a foreign key on current schemas
 * (fk_customer_price_level, ON DELETE SET NULL), which already clears it. That
 * branch stays as a safety net for installs predating the constraint, where
 * the same orphan is possible; on a schema that has it, it finds nothing.
 *
 * Valid ids are read first and compared in JS, so a collation mismatch between
 * the tables cannot fail a join. If price_levels is empty the migration does
 * nothing: on an empty table every row would count as an orphan, and that is
 * more likely a damaged database than a real state worth wiping prices for.
 *
 * Filed sales are unaffected — sale_items keep their denormalised
 * price_level_name.
 *
 * `down()` is a no-op: the deleted rows pointed at levels that no longer exist.
 */
async function tableExists(table: string): Promise<boolean> {
  const rows: any = await query(
    `SELECT COUNT(*) AS n FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return Number(rows?.[0]?.n || 0) > 0;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows: any = await query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(rows?.[0]?.n || 0) > 0;
}

const migration: Migration = {
  name: '151_remove_orphan_price_level_rows',
  timestamp: '2026-11-19_14-00-00',

  async up() {
    if (!(await tableExists('price_levels'))) {
      console.log('⏭️  price_levels missing, skipping');
      return;
    }
    const levels: any = await query('SELECT id FROM price_levels');
    const valid = new Set<string>((levels || []).map((r: any) => String(r.id)));
    if (valid.size === 0) {
      console.log('⏭️  price_levels is empty, skipping orphan cleanup');
      return;
    }

    if (await tableExists('product_selling_unit_price_levels')) {
      const used: any = await query(
        'SELECT DISTINCT price_level_id AS id FROM product_selling_unit_price_levels WHERE price_level_id IS NOT NULL'
      );
      const orphans = (used || []).map((r: any) => String(r.id)).filter((id: string) => !valid.has(id));
      for (const id of orphans) {
        const res: any = await query('DELETE FROM product_selling_unit_price_levels WHERE price_level_id = ?', [id]);
        console.log(`🧹 removed ${res?.affectedRows ?? 0} selling-unit price rows for deleted level ${id}`);
      }
    }

    if (await columnExists('customers', 'price_level_id')) {
      const used: any = await query(
        'SELECT DISTINCT price_level_id AS id FROM customers WHERE price_level_id IS NOT NULL'
      );
      const orphans = (used || []).map((r: any) => String(r.id)).filter((id: string) => id !== '' && !valid.has(id));
      for (const id of orphans) {
        const res: any = await query('UPDATE customers SET price_level_id = NULL WHERE price_level_id = ?', [id]);
        console.log(`🧹 cleared deleted level ${id} from ${res?.affectedRows ?? 0} customers`);
      }
    }
  },

  async down() {
    // No-op: the removed rows referenced levels that no longer exist.
  },
};

registerMigration(migration);

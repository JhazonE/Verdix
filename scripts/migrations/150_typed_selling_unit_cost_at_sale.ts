import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Gives already-filed lines sold in a non-base selling unit (a Case, a Pack)
 * the cost TYPED against that unit, where the line has no cost of its own.
 *
 * WHY: the store owner's rule is that a unit's typed cost on the Selling Units
 * tab is its cost of sale (`lib/selling-unit-cost.ts`, applied to new sales).
 * Lines sold before that rule, which recorded NO cost — NULL, or the frozen 0
 * that uncosted stock used to produce (see migrations 147 and 149) — would
 * otherwise fall back to `products.cost × factor` in the reports and never pick
 * up the case cost.
 *
 * MUST run after 149, which turns the uncosted-batch zeros into NULL first.
 *
 * SCOPE — only lines with cost_at_sale NULL or 0, sold in a unit that is still
 * non-base and has a POSITIVE typed cost. A line that recorded a real cost is
 * NOT rewritten: a filed sale with a real cost keeps the cost it was filed at.
 * Lines predating selling units (selling_unit_id NULL) are untouched.
 *
 * The cost written is the unit's typed cost TODAY and is frozen from then on,
 * like any other snapshot.
 *
 * `down()` is a no-op: it cannot tell a value this wrote from one a later sale
 * recorded legitimately with the same number.
 */
async function columnExists(table: string, column: string): Promise<boolean> {
  const rows: any = await query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(rows?.[0]?.n || 0) > 0;
}

/** product_selling_units.id's own collation, so the join cannot hit a mix error. */
async function unitIdCollation(): Promise<string> {
  const rows: any = await query(
    `SELECT COLLATION_NAME AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_selling_units' AND COLUMN_NAME = 'id'`
  );
  const c = String(rows?.[0]?.c || 'utf8mb4_0900_ai_ci');
  // Interpolated into SQL: accept only a plain collation name.
  return /^[a-z0-9_]+$/i.test(c) ? c : 'utf8mb4_0900_ai_ci';
}

const migration: Migration = {
  name: '150_typed_selling_unit_cost_at_sale',
  timestamp: '2026-11-18_11-00-00',

  async up() {
    if (!(await columnExists('product_selling_units', 'cost'))) {
      console.log('⏭️  product_selling_units has no cost, skipping');
      return;
    }
    const collation = await unitIdCollation();

    for (const table of ['sale_items', 'sales_invoice_items']) {
      if (!(await columnExists(table, 'cost_at_sale')) || !(await columnExists(table, 'selling_unit_id'))) {
        console.log(`⏭️  ${table} has no cost_at_sale/selling_unit_id, skipping`);
        continue;
      }
      const from = `
        FROM ${table} x
        JOIN product_selling_units psu
          ON psu.id = CONVERT(x.selling_unit_id USING utf8mb4) COLLATE ${collation}
        WHERE (x.cost_at_sale IS NULL OR x.cost_at_sale = 0)
          AND psu.is_base = 0
          AND psu.cost > 0`;
      const before: any = await query(`SELECT COUNT(*) AS n ${from}`);
      const count = Number(before?.[0]?.n || 0);
      if (count > 0) {
        await query(`
          UPDATE ${table} x
          JOIN product_selling_units psu
            ON psu.id = CONVERT(x.selling_unit_id USING utf8mb4) COLLATE ${collation}
          SET x.cost_at_sale = psu.cost
          WHERE (x.cost_at_sale IS NULL OR x.cost_at_sale = 0)
            AND psu.is_base = 0
            AND psu.cost > 0`);
      }
      console.log(`✅ ${table}: gave ${count} line(s) their selling unit's typed cost`);
    }
  },

  async down() {
    console.log('ℹ️  150 down is a no-op (cannot tell backfilled costs from recorded ones)');
  },
};

registerMigration(migration);

export default migration;

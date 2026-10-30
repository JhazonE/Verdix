import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Converts `cost_at_sale = 0` snapshots that meant "no cost was on record" into
 * NULL, so a cost entered later can still reach those lines.
 *
 * WHY: `lib/batch-deduction.ts` used to compute its fallback as
 * `parseFloat(prodRows?.[0]?.cost || 0)`, collapsing a NULL `products.cost`
 * into a literal 0. `lib/pos/process-sale-leg.ts` then stored that 0 as the
 * line's permanent snapshot. Because the profit reports resolve cost as
 * `COALESCE(si.cost_at_sale, p.cost * factor, 0)` and COALESCE only skips NULL,
 * a 0 passed straight through: the line showed zero cost and a 100% margin
 * forever, and editing the product's cost afterwards changed nothing. Both
 * write paths now store NULL for an unknown cost; this repairs the rows already
 * written.
 *
 * SCOPE — deliberately narrow. Only rows that are ALL of:
 *   - `cost_at_sale = 0`, and
 *   - `batch_source` IS NULL or '[]' or contains no real batch split, and
 *   - whose product has no costed batch history
 * are touched. A 0 that came from a real batch, or from a product deliberately
 * costed at 0, is a KNOWN cost and must stay frozen at 0 — nulling it would
 * silently re-price a filed sale off today's `products.cost`, which is exactly
 * the historical drift this whole change exists to prevent.
 *
 * A row this migration nulls starts following the CURRENT `products.cost` until
 * a cost is recorded for it. That is the intended repair: those lines never had
 * a cost to freeze. Lines with a real snapshot are untouched and stay frozen.
 *
 * `down()` restores 0 for the rows it nulled, identified the same way. It cannot
 * distinguish them from lines that were already NULL before this ran (rows
 * predating batch costing), so it is scoped by `batch_source` the same way and
 * may leave a genuinely-pre-existing NULL as NULL. That asymmetry is safe: NULL
 * is the correct state for an unknown cost either way.
 */
async function columnExists(table: string, column: string): Promise<boolean> {
  const rows: any = await query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(rows?.[0]?.n || 0) > 0;
}

/**
 * Rows whose 0 snapshot carries no evidence of a real cost behind it.
 *
 * `batch_source` is the receipt: a line priced by FIFO records its splits there.
 * A line with no splits, or only a `fallback` split, was priced off
 * `products.cost` — and if that product has never had a costed batch, a 0 there
 * means the cost was simply missing.
 */
const UNKNOWN_COST_PREDICATE = `
  si.cost_at_sale = 0
  AND (
    si.batch_source IS NULL
    OR si.batch_source = '[]'
    OR si.batch_source NOT LIKE '%"type":"batch"%'
  )
  AND NOT EXISTS (
    SELECT 1 FROM inventory_batches ib
    WHERE ib.product_id = si.product_id AND ib.unit_cost > 0
  )
`;

const migration: Migration = {
  name: '147_null_unknown_cost_at_sale',
  timestamp: '2026-10-30_10-00-00',

  async up() {
    if (!(await columnExists('sale_items', 'cost_at_sale'))) {
      console.log('⏭️  sale_items has no cost_at_sale, skipping');
      return;
    }

    const before: any = await query(
      `SELECT COUNT(*) AS n FROM sale_items si WHERE ${UNKNOWN_COST_PREDICATE}`
    );
    const count = Number(before?.[0]?.n || 0);
    if (count === 0) {
      console.log('✅ sale_items: no unknown-cost zero snapshots to repair');
    } else {
      await query(
        `UPDATE sale_items si SET si.cost_at_sale = NULL WHERE ${UNKNOWN_COST_PREDICATE}`
      );
      console.log(`✅ sale_items: nulled ${count} unknown-cost zero snapshot(s)`);
    }

    if (await columnExists('sales_invoice_items', 'cost_at_sale')) {
      const invPredicate = UNKNOWN_COST_PREDICATE.replace(/\bsi\./g, 'sii.');
      const invBefore: any = await query(
        `SELECT COUNT(*) AS n FROM sales_invoice_items sii WHERE ${invPredicate}`
      );
      const invCount = Number(invBefore?.[0]?.n || 0);
      if (invCount > 0) {
        await query(
          `UPDATE sales_invoice_items sii SET sii.cost_at_sale = NULL WHERE ${invPredicate}`
        );
      }
      console.log(`✅ sales_invoice_items: nulled ${invCount} unknown-cost zero snapshot(s)`);
    }
  },

  async down() {
    if (!(await columnExists('sale_items', 'cost_at_sale'))) return;

    const revert = UNKNOWN_COST_PREDICATE.replace(
      'si.cost_at_sale = 0',
      'si.cost_at_sale IS NULL'
    );
    await query(`UPDATE sale_items si SET si.cost_at_sale = 0 WHERE ${revert}`);
    console.log('✅ sale_items: restored 0 for unknown-cost snapshots');

    if (await columnExists('sales_invoice_items', 'cost_at_sale')) {
      const invRevert = revert.replace(/\bsi\./g, 'sii.');
      await query(
        `UPDATE sales_invoice_items sii SET sii.cost_at_sale = 0 WHERE ${invRevert}`
      );
      console.log('✅ sales_invoice_items: restored 0 for unknown-cost snapshots');
    }
  },
};

registerMigration(migration);

export default migration;

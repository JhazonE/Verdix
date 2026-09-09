import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * `products.unit_of_measure` is free text with no FK, so it accumulated
 * variants of the same unit: 'pc' and 'Piece' alongside the canonical 'Pieces'
 * / 'pcs'. Those variants match no `units_of_measure` row by either name or
 * abbreviation, so the products list could not look up an abbreviation for them
 * and fell back to printing the raw string.
 *
 * This re-labels the variants onto the canonical unit name. Only rows whose
 * value resolves to no unit at all are touched, so a value that legitimately
 * names another unit is never rewritten.
 */

// Variant -> the unit name it should become. Extend deliberately: each entry
// must be a value that resolves to no unit row today.
const LABEL_FIXES: Array<{ from: string; to: string }> = [
  { from: 'pc', to: 'Pieces' },
  { from: 'Piece', to: 'Pieces' },
];

const migration: Migration = {
  name: '116_normalize_product_unit_labels',
  timestamp: '2026-09-09_09-00-00',

  async up(): Promise<void> {
    for (const { from, to } of LABEL_FIXES) {
      // Only rewrite onto a unit that actually exists, otherwise this would
      // trade one unresolvable label for another.
      const target: any = await query(
        'SELECT id FROM units_of_measure WHERE name = ? LIMIT 1',
        [to]
      );
      if (!target[0]) {
        console.log(`⏭️  no unit named '${to}', skipping '${from}'`);
        continue;
      }

      const result: any = await query(
        'UPDATE products SET unit_of_measure = ? WHERE unit_of_measure = ?',
        [to, from]
      );
      console.log(`✅ '${from}' -> '${to}': ${result.affectedRows ?? 0} products`);
    }
  },

  async down(): Promise<void> {
    // Not reversible: once 'pc' and 'Piece' are folded into 'Pieces' they are
    // indistinguishable from rows that already held 'Pieces', so restoring the
    // original split would require rewriting rows this migration never touched.
    console.log('⏭️  116_normalize_product_unit_labels is not reversible, nothing to undo');
  }
};

registerMigration(migration);

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The product warehouse filter must accept a warehouse NAME as well as an id.
 *
 * The bug this guards: `pos_terminals.location` holds a NAME on terminals
 * created without a warehouse picked — app/api/pos-terminals defaults it to
 * the literal string 'Store'. The POS passes that column straight through as
 * `warehouseId`, and the repository compared it against
 * `products.warehouse_id`, which holds ids ('wh_main').
 *
 * A name therefore matched ZERO product rows, and the POS cart silently loaded
 * an empty catalogue. Nothing errored: the cart simply had no selling units,
 * so no price-level rows, so every line fell back to the shelf price. A
 * customer declared on a dearer level (PEDDLER 20 against a 16 shelf price)
 * rang up at retail.
 *
 * It worked in development and failed on installed terminals for one reason:
 * the dev terminal happened to have a real id stored while a freshly created
 * one has the default name. Same code, different data, different branch — the
 * kind of split that reads as "the fix didn't ship".
 *
 * findAll and countAll must BOTH accept a name, or the reported total
 * disagrees with the rows actually returned.
 */

const repo = fs.readFileSync(
  path.join(
    process.cwd(),
    'src', 'infrastructure', 'repositories', 'MySqlProductRepository.ts',
  ),
  'utf8',
);

/**
 * Each `if (filters.warehouseId) {` guard, with the SQL it appends.
 *
 * Anchoring on the `if (` specifically matters: `filters.warehouseId` also
 * appears in each block's params.push, so a plain search for the identifier
 * finds four hits and walks onto the wrong one.
 */
// The window is generous on purpose: these blocks carry a long explanatory
// comment before the SQL, and a tight slice would cut the assertion's target
// off and fail against CORRECT code.
const guards = [...repo.matchAll(/if \(filters\.warehouseId\) \{/g)]
  .map(m => repo.slice(m.index!, m.index! + 2000));

assert.equal(
  guards.length, 2,
  'there should be exactly two warehouse filters — findAll and countAll',
);

for (const [i, block] of guards.entries()) {
  const which = i === 0 ? 'findAll' : 'countAll';
  assert.ok(
    block.includes('FROM warehouses WHERE name'),
    `${which} must resolve a warehouse NAME to its id, or a terminal storing ` +
      "'Store' loads an empty catalogue and every line falls back to retail. " +
      'Both paths need it, or the reported total disagrees with the rows.',
  );
}

// Both lookups must stay parameterised — this value comes from a DB column
// that an admin types into, and it is interpolated nowhere.
{
  assert.ok(
    !/warehouse_id\s*=\s*['"`]\s*\$\{/.test(repo),
    'the warehouse filter must stay parameterised, never interpolated',
  );
}

console.log('✅ warehouse filter accepts name tests passed');

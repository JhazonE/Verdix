import assert from 'node:assert/strict';
import {
  resolveDefaultWarehouseId,
  shouldSeedWarehouseFilter,
} from '../../lib/default-warehouse';

/**
 * The Products and Stock Levels tables open on one warehouse instead of all of
 * them, because one `products` row per warehouse means an unfiltered list
 * repeats every item once per location. These tests pin the precedence down,
 * since it has to agree with the server's own default-warehouse query or a new
 * product lands somewhere the lists do not show.
 */

const MAIN = { id: 'wh_store', name: 'Store', isActive: true, isMain: true };
const SEEDED = { id: 'wh_main', name: 'Main Warehouse', isActive: true, isMain: false };
const BODEGA = { id: 'wh_bodega', name: 'Bodega', isActive: true, isMain: false };

// --- nothing to pick ------------------------------------------------------

// `null` means "show everything": filtering to an id that does not exist would
// hide every product rather than show a sensible default.
assert.equal(resolveDefaultWarehouseId([]), null, 'no warehouses means no default');
assert.equal(resolveDefaultWarehouseId(undefined), null, 'undefined (still loading) means no default');
assert.equal(resolveDefaultWarehouseId(null), null, 'null means no default');

// --- precedence -----------------------------------------------------------

assert.equal(
  resolveDefaultWarehouseId([BODEGA, SEEDED, MAIN]),
  MAIN.id,
  'the is_main flag wins wherever it sits in the list',
);

assert.equal(
  resolveDefaultWarehouseId([BODEGA, SEEDED]),
  SEEDED.id,
  "with no flag set, the seeded 'wh_main' is next",
);

assert.equal(
  resolveDefaultWarehouseId([BODEGA]),
  BODEGA.id,
  'with neither, the first warehouse stands in',
);

// --- inactive warehouses --------------------------------------------------

// A retired location is excluded from the server's query too, and opening a
// list on one would show an empty table.
assert.equal(
  resolveDefaultWarehouseId([{ ...MAIN, isActive: false }, BODEGA]),
  BODEGA.id,
  'an inactive main warehouse is skipped',
);

assert.equal(
  resolveDefaultWarehouseId([{ ...BODEGA, isActive: false }]),
  null,
  'all-inactive means no default, not a hidden table',
);

// `isActive` is optional on the Warehouse type and some rows omit it, so only
// an explicit false retires a warehouse.
assert.equal(
  resolveDefaultWarehouseId([{ id: 'wh_x' }]),
  'wh_x',
  'a missing isActive flag stays eligible',
);

// A blank id would filter the table to nothing, so it never qualifies.
assert.equal(
  resolveDefaultWarehouseId([{ id: '', name: 'Broken', isActive: true, isMain: true }, BODEGA]),
  BODEGA.id,
  'a row with no id is skipped even when flagged main',
);

// --- shouldSeedWarehouseFilter -------------------------------------------

// The filter is seeded from an effect because the warehouse list arrives after
// first render — so the predicate has to say "not yet" while it is empty.
assert.equal(
  shouldSeedWarehouseFilter(false, undefined),
  false,
  'nothing to seed from while the warehouse list is still loading',
);
assert.equal(
  shouldSeedWarehouseFilter(false, []),
  false,
  'an empty warehouse list does not trigger a seed',
);
assert.equal(
  shouldSeedWarehouseFilter(false, [MAIN]),
  true,
  'the first load with warehouses present seeds the default',
);

// The once-only rule: both lists refetch their warehouse options on an
// interval, and 'All Warehouses' is a deliberate choice. Re-seeding on a later
// refetch would snap the filter back while the user was browsing.
assert.equal(
  shouldSeedWarehouseFilter(true, [MAIN]),
  false,
  'a later refetch does not re-seed over the user choice',
);

console.log('✅ default-warehouse tests passed');

import assert from 'node:assert/strict';
import {
  normalizeOpeningStock,
  resolveAdditionalWarehouses,
} from '../../lib/warehouse-stocking';

/**
 * Add Product can stock one item in several warehouses at once. Because Verdix
 * keeps one `products` row per warehouse, each entry becomes a sibling row —
 * so the rules deciding WHICH rows get created are what these tests pin down.
 */

// --- normalizeOpeningStock -------------------------------------------------

assert.equal(normalizeOpeningStock(50), 50, 'a plain quantity passes through');
assert.equal(normalizeOpeningStock('50'), 50, 'a numeric string from an input is accepted');

// A warehouse listed with no quantity is "this item belongs here, none yet",
// which is a legitimate setup ahead of a delivery — not an error.
assert.equal(normalizeOpeningStock(undefined), 0, 'blank means zero, not invalid');
assert.equal(normalizeOpeningStock(''), 0, 'an empty input means zero');
assert.equal(normalizeOpeningStock(null), 0, 'null means zero');

// Stock can never go negative at creation, and garbage must not become NaN in
// a column that feeds FIFO batches and stock movements.
assert.equal(normalizeOpeningStock(-5), 0, 'a negative opening quantity collapses to zero');
assert.equal(normalizeOpeningStock('abc'), 0, 'a non-numeric value collapses to zero');
assert.equal(normalizeOpeningStock(NaN), 0, 'NaN collapses to zero');
assert.equal(normalizeOpeningStock(Infinity), 0, 'a non-finite value collapses to zero');

// Base units are counted whole here, matching the Initial Stock field's rule.
assert.equal(normalizeOpeningStock(12.9), 12, 'a fractional quantity truncates');

// --- resolveAdditionalWarehouses ------------------------------------------

const STORE = 'wh_main';
const BODEGA = 'wh_bodega';
const ANNEX = 'wh_annex';

assert.deepEqual(resolveAdditionalWarehouses([], STORE), [], 'no entries means no siblings');
assert.deepEqual(resolveAdditionalWarehouses(undefined, STORE), [], 'undefined is tolerated');
assert.deepEqual(resolveAdditionalWarehouses(null, STORE), [], 'null is tolerated');

assert.deepEqual(
  resolveAdditionalWarehouses(
    [{ warehouseId: BODEGA, stock: 200 }, { warehouseId: ANNEX, stock: 0 }],
    STORE,
  ),
  [{ warehouseId: BODEGA, stock: 200 }, { warehouseId: ANNEX, stock: 0 }],
  'each warehouse keeps its OWN opening stock',
);

// The primary warehouse's stock lives on the product row itself. A second row
// in the same warehouse would compete for one stock figure — the one shape the
// per-warehouse-row model cannot represent.
assert.deepEqual(
  resolveAdditionalWarehouses(
    [{ warehouseId: STORE, stock: 999 }, { warehouseId: BODEGA, stock: 200 }],
    STORE,
  ),
  [{ warehouseId: BODEGA, stock: 200 }],
  'the primary warehouse is never duplicated as a sibling',
);

// Keeping the FIRST occurrence means the quantity typed highest in the list
// survives, which is what the user sees at the top of the form.
assert.deepEqual(
  resolveAdditionalWarehouses(
    [{ warehouseId: BODEGA, stock: 200 }, { warehouseId: BODEGA, stock: 7 }],
    STORE,
  ),
  [{ warehouseId: BODEGA, stock: 200 }],
  'a repeated warehouse keeps its first quantity',
);

// An untouched "Add Warehouse" row submits a blank id; it must not create a
// row with no warehouse (which would show as Unassigned in Stock Levels).
assert.deepEqual(
  resolveAdditionalWarehouses(
    [{ warehouseId: '', stock: 5 }, { warehouseId: '   ', stock: 5 }, { warehouseId: BODEGA }],
    STORE,
  ),
  [{ warehouseId: BODEGA, stock: 0 }],
  'blank warehouse ids are dropped',
);

// A product created with no warehouse at all still gets its extra rows.
assert.deepEqual(
  resolveAdditionalWarehouses([{ warehouseId: BODEGA, stock: 3 }], null),
  [{ warehouseId: BODEGA, stock: 3 }],
  'a null primary warehouse blocks nothing',
);

assert.deepEqual(
  resolveAdditionalWarehouses([{ warehouseId: BODEGA, stock: 3 }], ''),
  [{ warehouseId: BODEGA, stock: 3 }],
  'an empty primary warehouse blocks nothing',
);

// Order is preserved so the created rows match the order on screen.
assert.deepEqual(
  resolveAdditionalWarehouses(
    [{ warehouseId: ANNEX, stock: 1 }, { warehouseId: BODEGA, stock: 2 }],
    STORE,
  ).map((r) => r.warehouseId),
  [ANNEX, BODEGA],
  'entry order is preserved',
);

console.log('✅ warehouse-stocking tests passed');

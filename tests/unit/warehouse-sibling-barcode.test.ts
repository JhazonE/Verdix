import assert from 'node:assert/strict';
import { isWarehouseSibling } from '../../lib/product-identity';

/**
 * Verdix models warehouse stock as SEPARATE `products` rows: transferring an
 * item from STORE to BODEGA creates a second row for the same physical item
 * (TransferStockService.ts), copying its name, SKU and `products.barcode`.
 * But `product_selling_units.barcode` is UNIQUE globally, so the sibling's
 * base unit has to be inserted with a NULL barcode.
 *
 * That left every transferred product un-editable: `updateProduct` saw
 * `products.barcode` set but the base unit's barcode NULL, took its "genuine
 * barcode change" branch, and the clash check found the STORE row's base unit
 * holding that barcode — reporting the item as a conflict with itself under
 * another warehouse. A barcode identifies a physical item, not a shelf, so a
 * warehouse sibling is never a real conflict.
 */

const STORE = { productId: 'p_store', sku: 'BRD-111-8SB3FK', name: '111 Baking Paper 5mx30cm 1s', warehouseId: 'wh_main' };
const BODEGA = { productId: 'p_bodega', sku: 'BRD-111-8SB3FK', name: '111 Baking Paper 5mx30cm 1s', warehouseId: 'wh_bodega' };

// The bug: same SKU, same name, different warehouse = the same physical item.
assert.equal(isWarehouseSibling(BODEGA, STORE), true, 'same SKU in another warehouse is a sibling, not a clash');

// SKU is the primary identifier TransferStockService matches on, so it wins
// even when a sibling was later renamed in one warehouse only.
assert.equal(
  isWarehouseSibling(BODEGA, { ...STORE, name: 'Baking Paper (old label)' }),
  true,
  'matching SKU alone makes a sibling, regardless of name',
);

// Name is the transfer service's SECONDARY identifier — a product carrying no
// SKU still pairs across warehouses by name.
assert.equal(
  isWarehouseSibling({ ...BODEGA, sku: null }, { ...STORE, sku: null }),
  true,
  'with no SKU, a matching name in another warehouse is still a sibling',
);
assert.equal(
  isWarehouseSibling({ ...BODEGA, sku: '' }, { ...STORE, sku: '   ' }),
  true,
  'blank SKUs are treated as absent, not as a matching value',
);

// Names compare case/whitespace-insensitively, the way the rest of the
// catalogue's lookups do.
assert.equal(
  isWarehouseSibling({ ...BODEGA, sku: null, name: '  111 BAKING PAPER 5MX30CM 1S ' }, { ...STORE, sku: null }),
  true,
  'name match ignores case and surrounding whitespace',
);

// --- Genuine clashes must still be reported ---

// Two unrelated products in the SAME warehouse: a real duplicate barcode.
assert.equal(
  isWarehouseSibling({ ...BODEGA, warehouseId: 'wh_main' }, STORE),
  false,
  'same warehouse is never a sibling — that is a true duplicate',
);

// A different item that merely shares a barcode (mis-keyed, or a supplier
// reusing a code) is the exact case this check exists to keep rejecting.
assert.equal(
  isWarehouseSibling({ productId: 'p_other', sku: 'SOAP-99', name: 'Dishwashing Soap 1L', warehouseId: 'wh_bodega' }, STORE),
  false,
  'different SKU and name in another warehouse is a real conflict',
);

// Neither SKU nor name may be inferred from a NULL warehouse: a row with no
// warehouse cannot be proven to live somewhere else, so it stays a clash.
assert.equal(
  isWarehouseSibling({ ...BODEGA, warehouseId: null }, STORE),
  false,
  'a NULL warehouse cannot establish a sibling relationship',
);
assert.equal(
  isWarehouseSibling(BODEGA, { ...STORE, warehouseId: null }),
  false,
  'a NULL warehouse on the holder cannot establish one either',
);

// A row is not its own sibling — the caller already excludes the unit being
// written, and treating a row as a sibling of itself would disable the check.
assert.equal(isWarehouseSibling(STORE, STORE), false, 'identical rows are not siblings');

console.log('✅ warehouse-sibling-barcode tests passed');

/**
 * Which extra warehouses a newly-created product should be stocked in.
 *
 * Verdix keeps ONE `products` row per warehouse, so "stock this item in STORE
 * and BODEGA" means two rows. This module holds the pure rules for turning the
 * Add Product form's list into the set of sibling rows to create, so they can
 * be tested without a database (the writes themselves live in
 * createWarehouseSiblings in app/(app)/products/actions.ts).
 */

export type WarehouseStockEntry = {
  warehouseId: string;
  stock?: number;
};

export type ResolvedWarehouseStock = {
  warehouseId: string;
  stock: number;
};

/**
 * Normalize an opening quantity.
 *
 * Blank, negative and non-numeric all collapse to 0 rather than being rejected:
 * a warehouse listed with no quantity means "this item belongs here, none in
 * stock yet", which is a legitimate thing to set up ahead of a delivery.
 * Fractions are truncated because `products.stock` counts whole base units
 * here, matching the Initial Stock field's own integer rule.
 */
export function normalizeOpeningStock(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.trunc(n);
}

/**
 * Resolve the sibling rows to create, in the order given.
 *
 * Drops:
 *  - blank ids (an untouched "Add Warehouse" row the user never filled in),
 *  - the primary warehouse — its stock lives on the product row itself, and a
 *    second row in the same warehouse is the one shape this model cannot
 *    represent (two rows would compete for the same stock figure),
 *  - repeats, keeping the FIRST occurrence so the quantity the user typed
 *    highest in the list is the one that survives.
 */
export function resolveAdditionalWarehouses(
  entries: WarehouseStockEntry[] | undefined | null,
  primaryWarehouseId: string | null | undefined,
): ResolvedWarehouseStock[] {
  if (!entries || entries.length === 0) return [];

  const primary = String(primaryWarehouseId ?? '').trim();
  const seen = new Set<string>(primary ? [primary] : []);
  const resolved: ResolvedWarehouseStock[] = [];

  for (const entry of entries) {
    const warehouseId = String(entry?.warehouseId ?? '').trim();
    if (!warehouseId || seen.has(warehouseId)) continue;
    seen.add(warehouseId);
    resolved.push({ warehouseId, stock: normalizeOpeningStock(entry?.stock) });
  }

  return resolved;
}

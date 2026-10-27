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
 * Which warehouses a brand-new product starts out selected in, and which of
 * them leads.
 *
 * Add Product preselects EVERY active warehouse: a new product almost always
 * belongs in all of them, so starting from "all" makes the rare exception
 * unticking one rather than ticking every one by hand.
 *
 * Which one LEADS is the part that matters and is not cosmetic. The head of
 * the selection is the primary `products` row — the one that owns the
 * scannable barcode, since `product_selling_units.barcode` is UNIQUE globally
 * and every sibling row's base unit is therefore written with a NULL barcode.
 * So the lead follows a fixed precedence rather than whatever the warehouse
 * list happens to return first:
 *
 *   1. a host-supplied default (Add Purchase Order passes its "Receive To"
 *      warehouse — it knows where the product is being created FOR), but only
 *      when it names a warehouse that is actually active and selectable,
 *   2. `is_main`,
 *   3. the seeded `wh_main`,
 *   4. the first active warehouse.
 *
 * Steps 2–4 are the same order the product importer and the server's own
 * default-warehouse resolution use, so a new product leads with the warehouse
 * the back-office lists open on.
 *
 * Inactive warehouses are excluded entirely: a retired location must never be
 * silently stocked. Returns `null` when nothing qualifies, which callers treat
 * as "leave the field empty" rather than inventing an id.
 */
export function resolveInitialWarehouseSelection(
  warehouses: { id: string; isActive?: boolean; isMain?: boolean }[] | undefined | null,
  preferredId?: string | null,
): { primaryId: string; additionalIds: string[] } | null {
  if (!warehouses || warehouses.length === 0) return null;

  // `isActive` is optional and some callers' rows omit it; only an explicit
  // `false` means retired, so an absent flag stays eligible.
  const active = warehouses.filter((w) => w?.id && w.isActive !== false);
  if (active.length === 0) return null;

  const preferred = String(preferredId ?? '').trim();
  const lead =
    (preferred ? active.find((w) => String(w.id) === preferred) : undefined) ||
    active.find((w) => w.isMain) ||
    active.find((w) => String(w.id) === 'wh_main') ||
    active[0];

  if (!lead) return null;

  return {
    primaryId: String(lead.id),
    additionalIds: active
      .filter((w) => String(w.id) !== String(lead.id))
      .map((w) => String(w.id)),
  };
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

import type { Warehouse } from '@/lib/types';

/**
 * Which warehouse a list should show when the user has not picked one.
 *
 * A `products` row is warehouse-specific — the same item in STORE and BODEGA is
 * two rows (see per-warehouse-product-rows) — so an unfiltered list shows the
 * same product several times with different stock, which reads as duplicate
 * data rather than as two locations. Defaulting to the store's main warehouse
 * makes the tables show one row per item, which is what a cashier or a stock
 * clerk is actually looking at.
 *
 * The precedence deliberately matches the server's own default-warehouse
 * resolution (`ORDER BY is_main DESC, (id = 'wh_main') DESC, created_at ASC` —
 * see getDefaultWarehouseId in the product import routes and addProduct in
 * app/(app)/products/actions.ts), so the warehouse a new product lands in is
 * the same one these lists open on. Inactive warehouses are skipped: they are
 * excluded from that server query too, and opening a list on a retired
 * location would show an empty table.
 *
 * Returns `null` when nothing qualifies (no warehouses configured, or all of
 * them inactive). Callers treat that as "show everything" rather than
 * inventing an id, since filtering to a warehouse that does not exist would
 * hide every product.
 */
export function resolveDefaultWarehouseId(
  warehouses: Pick<Warehouse, 'id' | 'isActive' | 'isMain'>[] | undefined | null,
): string | null {
  if (!warehouses || warehouses.length === 0) return null;

  // `isActive` is optional on the type and some callers' rows omit it; only an
  // explicit `false` means retired, so an absent flag stays eligible.
  const active = warehouses.filter((w) => w?.id && w.isActive !== false);
  if (active.length === 0) return null;

  return (
    active.find((w) => w.isMain)?.id ??
    active.find((w) => w.id === 'wh_main')?.id ??
    active[0].id
  );
}

/**
 * Whether a list should seed its warehouse filter with the default now.
 *
 * The filter cannot be seeded in `useState` because the warehouse list loads
 * after first render, and it must be seeded only ONCE: both lists refetch
 * their warehouse options on an interval, and "All Warehouses" is a deliberate
 * choice the user makes — re-applying the default on every refetch would snap
 * the filter back while they were browsing.
 *
 * Kept here rather than inline in the effect so the condition is testable
 * without rendering a hook.
 */
export function shouldSeedWarehouseFilter(
  alreadySeeded: boolean,
  warehouses: { id: string }[] | undefined | null,
): boolean {
  return !alreadySeeded && !!warehouses && warehouses.length > 0;
}

type StockStatus = 'out-of-stock' | 'low-stock' | 'in-stock' | 'service';
type BadgeVariant = 'destructive' | 'secondary' | 'default' | 'outline';

interface StockStatusResult {
  stockStatus: StockStatus;
  badgeVariant: BadgeVariant;
  /** Short label used in compact views: Out / Low / In / Service */
  badgeTextShort: string;
  /** Full label used in card/table views: Out of Stock / Low Stock / In Stock / Available */
  badgeTextFull: string;
}

/**
 * Stock status for a product row.
 *
 * Services carry no stock, so the stock ladder does not apply to them:
 * labelling one "Out of Stock" reads as a problem to fix when it is simply how
 * services work. They report as always available.
 *
 * `type` is optional — omitting it falls back to the stock ladder, which is the
 * safe direction for a row that was fetched without the column.
 *
 * `globalLowStockThreshold` is the store-wide "Low Stock Threshold" setting
 * (Settings > Notifications). The low-stock filter, report, and notification
 * bell all flag a product as low stock once it drops under either its own
 * reorder point OR this global floor — the badge must use the same effective
 * threshold or it disagrees with those other views for products whose
 * reorder point is set lower than the global floor.
 */
export function getStockStatus(
  stock: number,
  reorderPoint: number,
  type?: string | null,
  globalLowStockThreshold?: number,
): StockStatusResult {
  if (type === 'service') {
    return {
      stockStatus: 'service',
      badgeVariant: 'outline',
      badgeTextShort: 'Service',
      badgeTextFull: 'Available',
    };
  }

  const effectiveThreshold = Math.max(reorderPoint, globalLowStockThreshold || 0);
  const stockStatus: StockStatus =
    stock === 0 ? 'out-of-stock' : stock < effectiveThreshold ? 'low-stock' : 'in-stock';

  const badgeVariant: BadgeVariant =
    stockStatus === 'out-of-stock' ? 'destructive' :
    stockStatus === 'low-stock'    ? 'secondary'   : 'default';

  const badgeTextShort =
    stockStatus === 'out-of-stock' ? 'Out' :
    stockStatus === 'low-stock'    ? 'Low' : 'In';

  const badgeTextFull =
    stockStatus === 'out-of-stock' ? 'Out of Stock' :
    stockStatus === 'low-stock'    ? 'Low Stock'    : 'In Stock';

  return { stockStatus, badgeVariant, badgeTextShort, badgeTextFull };
}

/**
 * Hook-named alias, kept so existing call sites read naturally in components.
 *
 * There is no React state here — `getStockStatus` is a pure function, which is
 * what lets child rows inside a `.map()` call it without breaking the rules of
 * hooks.
 */
export const useStockStatus = getStockStatus;

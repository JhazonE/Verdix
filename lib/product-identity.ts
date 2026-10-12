/**
 * Pure product-identity helpers. Deliberately free of any `lib/mysql` import,
 * so this is usable from a client component and from a unit test without
 * opening a connection pool — which `lib/selling-units.ts` is not.
 */

/**
 * The identity a barcode-clash check compares: which physical item a product
 * row stands for, and which warehouse's stock of it this row holds.
 */
export type ProductIdentity = {
  productId: string;
  sku: string | null;
  name: string;
  warehouseId: string | null;
};

const norm = (v: string | null | undefined) => String(v ?? '').trim().toLowerCase();

/**
 * Whether two product rows are the SAME physical item held in two different
 * warehouses, rather than two items that happen to share a barcode.
 *
 * Verdix keeps one `products` row per warehouse: transferring stock from STORE
 * to BODEGA creates a second row for the same item (`TransferStockService`),
 * copying its name, SKU and `products.barcode`. Because
 * `product_selling_units.barcode` is UNIQUE across the whole table, the
 * sibling's base unit can only be inserted with a NULL barcode — which then
 * made `updateProduct` reject every later edit of that row, reporting the item
 * as conflicting with itself under another warehouse. A barcode identifies a
 * physical item, not a shelf, so a sibling is never a real conflict.
 *
 * The pairing rules mirror the ones `TransferStockService` uses to decide a
 * target row already exists: SKU first, then name. A row with no warehouse
 * cannot be shown to live somewhere else, so it is never a sibling — the check
 * must stay strict enough that a genuine duplicate is still caught.
 */
export function isWarehouseSibling(candidate: ProductIdentity, holder: ProductIdentity): boolean {
  if (candidate.productId === holder.productId) return false;
  if (!candidate.warehouseId || !holder.warehouseId) return false;
  if (candidate.warehouseId === holder.warehouseId) return false;

  const candidateSku = norm(candidate.sku);
  const holderSku = norm(holder.sku);
  if (candidateSku && holderSku) return candidateSku === holderSku;

  const candidateName = norm(candidate.name);
  return candidateName !== '' && candidateName === norm(holder.name);
}

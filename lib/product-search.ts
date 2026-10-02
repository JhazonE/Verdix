/**
 * Shared product search matcher.
 *
 * Transfer Board, Shelf Board and Bulk Adjustment each carried their own
 * inline `name || sku` filter, so scanning a barcode matched nothing even
 * though every product carries one and the field already reaches all three
 * pages. They now share this one matcher, so the rule cannot drift apart
 * between them again.
 *
 * Callers that filter in a loop should hoist `normalizeSearchTerm(term)` out
 * of the loop and use `matchesNormalizedSearch`, rather than re-lowercasing
 * the term once per row.
 */

type SearchableProduct = {
    name?: string | null;
    barcode?: string | null;
    /**
     * The base selling unit's own barcode is the real identifier now (see
     * docs/superpowers/specs/2026-09-22-retire-sku-search-pos-inventory-design.md)
     * — `sku` is retired from this matcher's own vocabulary. `barcode` above
     * stays as the legacy `products.barcode` column fallback only; it is
     * never the primary source once a caller supplies `sellingUnits`.
     */
    sellingUnits?: { isBase?: boolean; barcode?: string | null }[] | null;
};

/**
 * How long to wait after the last keystroke before querying the server.
 * A barcode scanner types a whole code in milliseconds, so this collapses a
 * scan into one request instead of one per character.
 */
export const PRODUCT_SEARCH_DEBOUNCE_MS = 300;

/**
 * How many rows the stock boards ask for. The catalogue is far larger than
 * this (15,633 products when written), which is exactly why matching happens
 * in SQL: this caps the response, it does not define what is searchable.
 */
export const BOARD_PRODUCT_LIMIT = 200;

/**
 * Build the products query for the transfer/shelf boards.
 *
 * The search term goes to the server, which matches name, SKU and barcode in
 * SQL across the whole catalogue — so a scanned barcode finds its product no
 * matter where it sits in 15,000+ rows, which a client-side filter over a
 * preloaded slice cannot do.
 *
 * Passes inStock=true. Both boards only render `quantity > 0`, and the
 * catalogue is almost entirely stock 0 (7 of 15,990 rows in stock when
 * written). Without the SQL filter the LIMIT is spent on the newest 200
 * products, nearly all out of stock, and in-stock items older than that
 * window never reach the browser — the board shows 2 of 7 and looks broken.
 * The filter must be in SQL: applying it after the LIMIT cannot recover them.
 */
export function buildProductQuery(search: string, limit = BOARD_PRODUCT_LIMIT): string {
    const term = normalizeSearchTerm(search);
    const params = new URLSearchParams({ limit: String(limit), inStock: 'true' });
    if (term) params.set('search', term);
    return `/products?${params.toString()}`;
}

/**
 * Lowercase and trim a raw search term. Trimming matters for real use: a
 * hardware barcode scanner typically appends a newline, and a trailing space
 * survives copy/paste — either would make a correct barcode match nothing.
 */
export function normalizeSearchTerm(term: string | null | undefined): string {
    return (term ?? '').toLowerCase().trim();
}

/**
 * Match against an already-normalized term. An empty term matches everything,
 * so an empty search box shows the full list rather than no results.
 */
export function matchesNormalizedSearch(
    product: SearchableProduct | null | undefined,
    normalizedTerm: string
): boolean {
    if (!normalizedTerm) return true;
    if (!product) return false;

    const baseUnitBarcode = product.sellingUnits?.find(su => su.isBase)?.barcode ?? '';

    return (
        (product.name?.toLowerCase() ?? '').includes(normalizedTerm) ||
        (product.barcode?.toLowerCase() ?? '').includes(normalizedTerm) ||
        baseUnitBarcode.toLowerCase().includes(normalizedTerm)
    );
}

/**
 * Match a product against a raw (unnormalized) search term, by name, the
 * base selling unit's barcode, or the legacy barcode column. Case-insensitive;
 * surrounding whitespace is ignored.
 */
export function matchesProductSearch(
    product: SearchableProduct | null | undefined,
    term: string | null | undefined
): boolean {
    return matchesNormalizedSearch(product, normalizeSearchTerm(term));
}

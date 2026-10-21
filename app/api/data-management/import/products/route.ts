import { NextRequest, NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/mysql';
import { v4 as uuidv4 } from 'uuid';
import { recordStockMovement } from '@/lib/stock-movements';
import { legacyProductCsvImport } from './legacy';
import { ensureCategoryExists, ensureBrandExists, ensureSubcategoryExists, ensureUnitOfMeasureExists } from '@/lib/ensure-lookup-values';

export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('multipart/form-data')) {
    return legacyProductCsvImport(request);
  }

  try {
    const body = await request.json();
    const rows: Record<string, any>[] = Array.isArray(body?.rows) ? body.rows : [];
    let added = 0, updated = 0, skipped = 0;
    const errors: Array<{ row: number; reason: string }> = [];

    // New products are assigned to the default STORE warehouse automatically.
    const defaultWarehouseId = await getDefaultWarehouseId();

    // Resolve every distinct category/brand/subcategory/unit in the batch ONCE,
    // before the row loop. Doing it per row re-ran the same SELECT (+ sometimes
    // an INSERT) for every row sharing a category — on a remote DB that was the
    // single largest cost in the import, and a 500-row file of mostly one
    // category paid for ~2000 round trips that resolve to the same few ids.
    // Order matters exactly as it did per-row: all categories first, so the
    // subcategory pass can never race an insert of its own parent category.
    await ensureLookupsForBatch(rows);

    // Resolved once for the batch, for the same reason as the lookups above:
    // per-row it would be one more round trip against a remote DB for an
    // answer that cannot change mid-import.
    const validLevelIds = await loadValidPriceLevelIds();

    for (let i = 0; i < rows.length; i++) {
      const p = rows[i];
      if (!p.name || String(p.name).trim() === '') {
        skipped++; errors.push({ row: i, reason: 'Missing product name' }); continue;
      }
      try {
        const barcode = p.barcode ? String(p.barcode).trim() : null;

        // Lookup rows (categories/brands/subcategories/units_of_measure) were
        // already created for the whole batch by ensureLookupsForBatch above.

        // Match on barcode first, else name.
        let existing: any = null;
        if (barcode) {
          [existing] = await query('SELECT id FROM products WHERE barcode = ? LIMIT 1', [barcode]) as any[];
        }
        if (!existing) {
          [existing] = await query('SELECT id FROM products WHERE name = ? LIMIT 1', [p.name]) as any[];
        }

        if (existing) {
          // An ABSENT price/cost column means "leave it alone", not "set to 0".
          // A stock-only or category-only sheet must not wipe the shelf price
          // of every product it touches. A column that IS present but blank
          // still reads as 0, which is the user explicitly saying so.
          const hasCost = p.cost_price !== undefined && p.cost_price !== null;
          const hasPrice = p.selling_price !== undefined && p.selling_price !== null;
          const upCost = hasCost ? num(p.cost_price) : null;
          const upPrice = hasPrice ? num(p.selling_price) : null;

          // Catalogue fields and the base unit's price move together, so a
          // failure on either leaves neither half applied.
          await withTransaction(async (conn) => {
            // Update catalog fields only — never touch stock on an existing product.
            // cost/price are spliced in only when the sheet actually carried
            // them, so an omitted column leaves the stored value untouched
            // rather than zeroing it.
            await conn.query(
              `UPDATE products SET name=?, barcode=?, description=?, category=?, brand=?, subcategory=?,
                 unit_of_measure=?,${hasCost ? ' cost=?,' : ''}${hasPrice ? ' price=?,' : ''} reorder_point=?, image_url=?, conversion_factor=?, updated_at=NOW()
               WHERE id=?`,
              [
                p.name, barcode, p.description ?? '', p.category ?? 'General', p.brand ?? null, p.subcategory ?? null,
                p.unit ?? 'pcs',
                ...(hasCost ? [upCost] : []),
                ...(hasPrice ? [upPrice] : []),
                num(p.reorder_point),
                p.image_url ?? null, p.conversion_factor != null ? num(p.conversion_factor) : 1, existing.id,
              ],
            );

            // Carry the new cost/price onto the BASE selling unit too. POS prices
            // a line from product_selling_units, not products.price (see
            // lib/pricing.ts and MySqlProductRepository), so updating only
            // `products` left the two diverged and a re-import that changed a
            // price never reached the register. Also back-fill a base unit for a
            // product that predates selling units, which would otherwise be
            // unsellable and unmatchable by barcode on the next import.
            const [baseRows] = await conn.query(
              'SELECT id FROM product_selling_units WHERE product_id = ? AND is_base = 1 LIMIT 1',
              [existing.id],
            ) as any[];
            const base = (baseRows as any[])[0];
            if (base) {
              // barcode is deliberately NOT written here: it is UNIQUE across all
              // selling units, so reassigning it belongs to the explicit Selling
              // Units editor rather than a bulk price refresh that would fail the
              // whole row on a collision with another product's unit.
              // Same omitted-column rule as `products` above: a sheet that
              // never mentioned price must not zero the unit POS prices from.
              const sets: string[] = [];
              const vals: any[] = [];
              if (hasCost) { sets.push('cost = ?'); vals.push(upCost || null); }
              if (hasPrice) { sets.push('price = ?'); vals.push(upPrice); }
              if (sets.length > 0) {
                await conn.query(
                  `UPDATE product_selling_units SET ${sets.join(', ')}, updated_at = NOW() WHERE id = ?`,
                  [...vals, base.id],
                );
              }
              await writePriceLevels(conn, base.id, p, validLevelIds);
            } else {
              // Back-filling a missing base unit: with no price in the sheet,
              // fall back to the product's own stored price rather than 0, so
              // the new unit matches the shelf price it is standing in for.
              const newBaseId = `psu_base_${existing.id}`;
              const fallback: any = hasPrice
                ? upPrice
                : (await conn.query('SELECT price FROM products WHERE id = ?', [existing.id]) as any[])[0]?.[0]?.price ?? 0;
              await conn.query(
                `INSERT INTO product_selling_units (id, product_id, name, factor, cost, price, is_base)
                 VALUES (?, ?, 'Piece', 1, ?, ?, 1)`,
                [newBaseId, existing.id, upCost || null, fallback],
              );
              await writePriceLevels(conn, newBaseId, p, validLevelIds);
            }
          });
          updated++;
        } else {
          const id = uuidv4();
          // Mirrored from barcode (Sub-project A convention) rather than
          // generated, so a not-yet-migrated reader elsewhere still sees a
          // matching value.
          const sku = barcode;
          const stock = num(p.stock_quantity);
          const cost = num(p.cost_price);
          const price = num(p.selling_price);
          const rowType = String(p.type || '').toLowerCase() === 'service' ? 'service' : 'standard';

          // The product row and its base selling unit go in together or not at
          // all. Unwrapped, a selling-unit failure (its barcode is UNIQUE
          // across ALL products, so a collision with an unrelated product's
          // unit is easy to hit) left a committed product with no base unit —
          // counted as "skipped" in the response while actually sitting in the
          // table, invisible and unsellable in POS. The user is then told the
          // row did not import, and has no way to find the one that did.
          await withTransaction(async (conn) => {
            await conn.query(
              `INSERT INTO products (id, name, sku, barcode, description, category, brand, subcategory,
                 unit_of_measure, cost, price, stock, reorder_point, image_url, conversion_factor, warehouse_id, type, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
              [
                id, p.name, sku, barcode, p.description ?? '', p.category ?? 'General', p.brand ?? null, p.subcategory ?? null,
                p.unit ?? 'pcs', cost, price, stock, num(p.reorder_point), p.image_url ?? null,
                p.conversion_factor != null ? num(p.conversion_factor) : 1, defaultWarehouseId, rowType,
              ],
            );

            // Every product needs a base selling unit (factor 1, is_base = 1) or
            // it is unsellable and unmatchable by barcode on a later import —
            // matches the convention actions.ts's writeSellingUnits() established.
            await conn.query(
              `INSERT INTO product_selling_units (id, product_id, name, barcode, factor, cost, price, is_base)
               VALUES (?, ?, 'Piece', ?, 1, ?, ?, 1)`,
              [`psu_base_${id}`, id, barcode, cost || null, price],
            );

            await writePriceLevels(conn, `psu_base_${id}`, p, validLevelIds);
          });

          // Opening stock -> FIFO batch + audit movement (keeps costing correct).
          // Services have no stock tracking: no batches, no FIFO, no movements.
          if (rowType === 'standard' && stock > 0) {
            try {
              await query(
                `INSERT INTO inventory_batches
                   (id, product_id, received_date, quantity_in, quantity_remaining, unit_cost, selling_price, source_type, notes)
                 VALUES (?, ?, CURDATE(), ?, ?, ?, ?, 'adjustment', 'Imported Stock')`,
                [uuidv4(), id, stock, stock, cost, price],
              );
            } catch (batchErr) {
              console.warn('[Import] Could not create opening batch:', batchErr);
            }
            try {
              await recordStockMovement({
                productId: id, productName: p.name, movementType: 'adjustment',
                quantityChange: stock, previousStock: 0, newStock: stock,
                referenceType: 'adjustment', notes: 'Imported Stock',
              });
            } catch (moveErr) {
              console.warn('[Import] Could not record stock movement:', moveErr);
            }
          }
          added++;
        }
      } catch (err: any) {
        console.error(`Failed to import product row ${i}:`, err);
        // Report the actual cause, not a flat 'Database error'. A duplicate
        // barcode, an over-length value and a missing column are three very
        // different fixes for whoever is holding the spreadsheet, and the
        // wizard's skipped-rows CSV is the only place they ever see this.
        skipped++;
        errors.push({ row: i, reason: describeDbError(err) });
      }
    }

    return NextResponse.json({ added, updated, skipped, errors });
  } catch (error: any) {
    console.error('Error importing products:', error);
    // Pass the cause through. This is the response the wizard renders when a
    // whole chunk fails, and a bare 'Import failed' left no way to tell a
    // connection drop from a schema mismatch without server log access —
    // which a hosted deployment's operator may not have to hand.
    return NextResponse.json({ error: `Import failed: ${describeDbError(error)}` }, { status: 500 });
  }
}

/**
 * Turn a mysql2 error into something actionable for whoever is fixing the
 * spreadsheet. Falls back to the raw message so an unrecognised code is still
 * visible rather than swallowed.
 */
function describeDbError(err: any): string {
  const code = err?.code;
  const msg = String(err?.sqlMessage || err?.message || err || 'Unknown error');
  switch (code) {
    case 'ER_DUP_ENTRY':
      // Selling-unit barcodes are UNIQUE globally, so the usual cause is the
      // same barcode already belonging to a different product.
      return `Duplicate value — a barcode in this row is already used by another product (${msg})`;
    case 'ER_DATA_TOO_LONG':
      return `A value is too long for its column (${msg})`;
    case 'ER_BAD_FIELD_ERROR':
    case 'ER_NO_SUCH_TABLE':
      return `Database schema is out of date — run pending migrations (${msg})`;
    case 'ER_NO_REFERENCED_ROW':
    case 'ER_NO_REFERENCED_ROW_2':
      return `Referenced record missing (${msg})`;
    case 'ER_TRUNCATED_WRONG_VALUE':
    case 'WARN_DATA_TRUNCATED':
      return `A value has the wrong type for its column (${msg})`;
    case 'PROTOCOL_CONNECTION_LOST':
    case 'ECONNRESET':
    case 'ETIMEDOUT':
    case 'ER_LOCK_WAIT_TIMEOUT':
      return `Lost the database connection mid-import — retry with a smaller file (${msg})`;
    default:
      return code ? `${code}: ${msg}` : msg;
  }
}

/**
 * Create every lookup row the batch references, once per distinct value.
 *
 * The free-text category/brand/subcategory/unit a row carries lands straight on
 * `products`, so it must also exist in the lookup tables the Manage dialogs and
 * category-markup precedence read from — same reasoning as the Add Product
 * form's "type a new value into the dropdown" behaviour. Doing it per distinct
 * value rather than per row is what keeps a large import inside the request
 * timeout on a remote DB.
 *
 * Categories are resolved to completion FIRST (not concurrently with the rest),
 * because ensureSubcategoryExists looks its own parent category up by name and
 * must not race a concurrent insert of that same category.
 *
 * Best-effort throughout: a lookup row that cannot be created must never fail
 * the import, exactly as the per-row helpers guaranteed before.
 */
async function ensureLookupsForBatch(rows: Record<string, any>[]): Promise<void> {
  // 'General' matches the fallback the INSERT/UPDATE below store, so a row with
  // no category still gets that category created rather than referencing a name
  // that exists nowhere in `categories`.
  const categoryOf = (p: Record<string, any>) => p.category ?? 'General';

  const categories = new Map<string, string>();
  const brands = new Map<string, string>();
  const units = new Map<string, string>();
  // Subcategories are unique per (category_id, name), so they key on both.
  const subcategories = new Map<string, { sub: string; category: string }>();

  const norm = (v: any) => String(v ?? '').trim().toLowerCase();

  // First spelling of a name wins. `set` would let the LAST row's spelling
  // through, so a file containing both "Beverages" and " beverages " could
  // create the lookup row under the stray-whitespace variant while the rows
  // themselves store the clean one — the two must agree, since the lookup
  // tables are matched by name.
  const keep = <V,>(m: Map<string, V>, k: string, v: V) => { if (!m.has(k)) m.set(k, v); };

  for (const p of rows) {
    const cat = categoryOf(p);
    if (norm(cat)) keep(categories, norm(cat), String(cat));
    if (norm(p.brand)) keep(brands, norm(p.brand), String(p.brand));
    if (norm(p.unit)) keep(units, norm(p.unit), String(p.unit));
    if (norm(p.subcategory)) {
      keep(subcategories, `${norm(p.subcategory)}\u0000${norm(cat)}`, {
        sub: String(p.subcategory),
        category: String(cat),
      });
    }
  }

  for (const name of categories.values()) {
    await ensureCategoryExists(name);
  }
  for (const name of brands.values()) {
    await ensureBrandExists(name);
  }
  for (const name of units.values()) {
    await ensureUnitOfMeasureExists(name);
  }
  for (const { sub, category } of subcategories.values()) {
    await ensureSubcategoryExists(sub, category);
  }
}

/** Prefix the wizard uses for a generated price-level column. */
const PRICE_LEVEL_PREFIX = 'price_level__';

/**
 * The price level ids a row is allowed to write to.
 *
 * A row names its level by id inside the column key, which comes from the
 * client. Writing it unchecked would let a stale or hand-edited payload create
 * rows against a level that no longer exists — invisible in every UI (they all
 * list levels by joining `price_levels`) yet still occupying the primary key.
 *
 * Resolved once per request and passed down, not cached in a module: the server
 * is long-lived, and a level added or deleted in Settings must take effect on
 * the next import rather than after a restart.
 */
async function loadValidPriceLevelIds(): Promise<Set<string>> {
  try {
    const rows = (await query('SELECT id, is_default FROM price_levels')) as any[];
    // The default level is excluded for the same reason the wizard omits its
    // column: its base-unit row mirrors products.price, which `selling_price`
    // already wrote a few statements earlier. Honouring a column for it would
    // let one row carry two conflicting shelf prices.
    return new Set(rows.filter((r) => !r.is_default).map((r) => String(r.id)));
  } catch (err) {
    console.warn('[Import] Could not load price levels:', err);
    return new Set();
  }
}

/**
 * Apply a row's price-level columns to one selling unit.
 *
 * Runs inside the caller's transaction, so a bad level price fails the whole
 * row rather than leaving a product priced half-old and half-new.
 *
 * A blank or unmapped column is skipped, NOT written as 0: the wizard gives
 * these fields no default precisely so "absent" survives to here and means
 * "leave this level alone". Only a value actually typed into the sheet moves a
 * price.
 *
 * `min_quantity` is deliberately never written — a new row takes the column's
 * DEFAULT 0 (no tier) and an existing row keeps whatever tier the Selling Units
 * tab set. An import carries prices, not thresholds, matching
 * lib/price-list-import.ts.
 */
async function writePriceLevels(
  conn: { query: (sql: string, values?: any[]) => Promise<any> },
  sellingUnitId: string,
  row: Record<string, any>,
  allowed: Set<string>,
): Promise<void> {
  const keys = Object.keys(row).filter((k) => k.startsWith(PRICE_LEVEL_PREFIX));
  if (keys.length === 0) return;

  for (const key of keys) {
    const raw = row[key];
    if (raw === undefined || raw === null || String(raw).trim() === '') continue;

    const levelId = key.slice(PRICE_LEVEL_PREFIX.length);
    if (!allowed.has(levelId)) continue;

    const price = num(raw);
    // A negative price is a typo, not an intent. Skipping keeps the rest of a
    // good row importable instead of failing it outright.
    if (price < 0) continue;

    await conn.query(
      `INSERT INTO product_selling_unit_price_levels (selling_unit_id, price_level_id, price)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE price = VALUES(price)`,
      [sellingUnitId, levelId, price],
    );
  }
}

function num(v: any): number {
  const n = parseFloat(String(v ?? '').replace(/[₱$,\s]/g, ''));
  return Number.isNaN(n) ? 0 : n;
}

// Resolve the default STORE warehouse: the one flagged is_main, else the seeded
// 'wh_main', else the oldest active warehouse. Returns null if none exist so the
// import still succeeds (products just stay unassigned).
async function getDefaultWarehouseId(): Promise<string | null> {
  try {
    const [wh] = await query(
      `SELECT id FROM warehouses
       WHERE is_active = 1
       ORDER BY is_main DESC, (id = 'wh_main') DESC, created_at ASC
       LIMIT 1`,
    ) as any[];
    return wh?.id ?? null;
  } catch (err) {
    console.warn('[Import] Could not resolve default warehouse:', err);
    return null;
  }
}

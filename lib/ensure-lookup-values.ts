/**
 * Bulk import paths (Excel/CSV product import, bulk price-update's "create new
 * products from Excel") write category/brand/subcategory/unit-of-measure as
 * free text straight onto `products`, bypassing the `categories`/`brands`/
 * `subcategories`/`units_of_measure` lookup tables that the Manage
 * Categories/Brands/Subcategories/Units dialogs read from (and that
 * category-based markup precedence in purchase-utils.ts matches against by
 * name). The manual Add Product form avoids this by calling
 * addCategory()/addBrand()/addSubcategory()/addUnitOfMeasure() explicitly
 * when the user types a new value into the dropdown. These helpers do the
 * same thing on the bulk paths: look up by name (case-insensitive), insert
 * only if missing, otherwise leave the existing row untouched.
 */
import { query } from '@/lib/mysql';

async function ensureLookupRow(
  table: 'categories' | 'brands' | 'units_of_measure',
  idPrefix: string,
  name: string,
  extraColumns: string[] = [],
  extraValues: any[] = [],
): Promise<string> {
  const trimmed = name.trim();

  const [existing] = await query(
    `SELECT id FROM ${table} WHERE LOWER(name) = LOWER(?) LIMIT 1`,
    [trimmed],
  ) as any[];
  if (existing) return existing.id;

  const id = `${idPrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const columns = ['id', 'name', ...extraColumns];
  const values = [id, trimmed, ...extraValues];
  try {
    await query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      values,
    );
    return id;
  } catch (error) {
    // A concurrent import row (or a race with another request) may have
    // inserted the same name between the SELECT and here. Re-check rather
    // than swallowing blind, since a caller (ensureSubcategoryExists) needs
    // the real id to scope the subcategory correctly.
    const [raceWinner] = await query(
      `SELECT id FROM ${table} WHERE LOWER(name) = LOWER(?) LIMIT 1`,
      [trimmed],
    ) as any[];
    if (raceWinner) return raceWinner.id;
    console.warn(`[ensureLookupRow] Could not insert into ${table}:`, error);
    throw error;
  }
}

/** Returns the resolved category id, or null if name is empty/insert failed. */
export async function ensureCategoryExists(name: string | null | undefined): Promise<string | null> {
  if (!name || !name.trim()) return null;
  try {
    return await ensureLookupRow('categories', 'cat', name, ['markup_percentage'], [null]);
  } catch {
    return null;
  }
}

export async function ensureBrandExists(name: string | null | undefined): Promise<void> {
  if (!name) return;
  try {
    await ensureLookupRow('brands', 'brand', name, ['markup_percentage'], [null]);
  } catch {
    // Best-effort — a failed brand lookup row must never block the product import itself.
  }
}

export async function ensureUnitOfMeasureExists(name: string | null | undefined): Promise<void> {
  if (!name) return;
  try {
    // units_of_measure.abbreviation is VARCHAR(10). The manual Add Product
    // form's own "add on the fly" passes the full typed name as the
    // abbreviation too (see inventory-tab.tsx's onAdd), which already breaks
    // there for any name over 10 chars — a bulk row's free-text unit name is
    // far more likely to hit that than something a person types into a
    // dropdown, so truncate here rather than reproduce the same landmine and
    // have the whole insert silently fail.
    await ensureLookupRow('units_of_measure', 'uom', name, ['abbreviation'], [name.trim().slice(0, 10)]);
  } catch {
    // Best-effort — a failed unit lookup row must never block the product import itself.
  }
}

/**
 * Subcategories are unique per (category_id, name), not globally (see
 * migration 122). A bulk row only ever carries the category as a name, so
 * this resolves/creates the category first, then checks/creates the
 * subcategory scoped to that category's id — matching
 * subcategoryNameConflicts()'s NULL-safe category_id comparison in
 * app/(app)/products/actions.ts.
 */
export async function ensureSubcategoryExists(
  subcategoryName: string | null | undefined,
  categoryName: string | null | undefined,
): Promise<void> {
  const trimmedSub = subcategoryName?.trim();
  if (!trimmedSub) return;

  const categoryId = await ensureCategoryExists(categoryName);

  try {
    const params: any[] = [trimmedSub];
    let sql = 'SELECT id FROM subcategories WHERE LOWER(name) = LOWER(?)';
    if (categoryId === null) {
      sql += ' AND category_id IS NULL';
    } else {
      sql += ' AND category_id = ?';
      params.push(categoryId);
    }
    const [existing] = await query(sql, params) as any[];
    if (existing) return;

    const id = `subcat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await query(
      'INSERT INTO subcategories (id, name, category_id, markup_percentage) VALUES (?, ?, ?, ?)',
      [id, trimmedSub, categoryId, null],
    );
  } catch (error) {
    console.warn('[ensureSubcategoryExists] Could not insert into subcategories:', error);
  }
}

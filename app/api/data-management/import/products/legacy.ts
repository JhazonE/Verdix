import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';
import Papa from 'papaparse';
import { v4 as uuidv4 } from 'uuid';
import { ensureCategoryExists, ensureBrandExists, ensureSubcategoryExists, ensureUnitOfMeasureExists } from '@/lib/ensure-lookup-values';

// Legacy multipart CSV import, kept for backward compatibility. The wizard uses the JSON path.
export async function legacyProductCsvImport(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    if (!file) return NextResponse.json({ success: false, error: 'No file uploaded' }, { status: 400 });

    const text = await file.text();
    const { data, errors } = Papa.parse(text, { header: true, skipEmptyLines: true });
    if (errors.length > 0) return NextResponse.json({ success: false, error: 'Invalid CSV format', details: errors }, { status: 400 });

    const productsData: any[] = data as any[];
    let successCount = 0, updateCount = 0, errorCount = 0;

    // New products are assigned to the default STORE warehouse automatically.
    const defaultWarehouseId = await getDefaultWarehouseId();

    for (const p of productsData) {
      if (!p.name) { errorCount++; continue; }
      const barcode = p.barcode ? String(p.barcode).trim() : null;
      try {
        // Same reasoning as the JSON import path (route.ts): a free-text
        // category/brand/subcategory/unit typed into the CSV template must
        // also land in the categories/brands/subcategories/units_of_measure
        // lookup tables, or it never shows up in the Manage dialogs.
        // Category runs before the others so ensureSubcategoryExists's own
        // category lookup can't race a concurrent insert of the same name.
        // Same 'General' fallback the INSERT/UPDATE below store.
        await ensureCategoryExists(p.category || 'General');
        await Promise.all([
          ensureBrandExists(p.brand),
          ensureSubcategoryExists(p.subcategory, p.category || 'General'),
          ensureUnitOfMeasureExists(p.unit),
        ]);

        // Match on barcode first, else name — same match keys as
        // lib/import/entity-schemas.ts and the JSON import path (route.ts);
        // this multipart path previously required and matched on sku, which
        // this file's own CSV export never even names as a required column.
        let existing: any = null;
        if (barcode) {
          [existing] = await query('SELECT id FROM products WHERE barcode = ? LIMIT 1', [barcode]);
        }
        if (!existing) {
          [existing] = await query('SELECT id FROM products WHERE name = ? LIMIT 1', [p.name]);
        }
        if (existing) {
          await query(
            `UPDATE products SET name=?, barcode=?, description=?, category=?, brand=?, subcategory=?, unit_of_measure=?,
               cost=?, price=?, stock=?, reorder_point=?, parent_id=?, image_url=?, conversion_factor=?, updated_at=NOW() WHERE id=?`,
            [p.name, barcode, p.description || '', p.category || 'General', p.brand || null, p.subcategory || null,
              p.unit || 'pcs', parseFloat(p.cost_price) || 0, parseFloat(p.selling_price) || 0, parseFloat(p.stock_quantity) || 0,
              parseFloat(p.reorder_point) || 0, p.parent_id || null, p.image_url || null, parseFloat(p.conversion_factor) || 1, existing.id],
          );
          updateCount++;
        } else {
          const id = uuidv4();
          const cost = parseFloat(p.cost_price) || 0;
          const price = parseFloat(p.selling_price) || 0;
          // products.sku is mirrored from barcode (Sub-project A convention)
          // rather than left blank, so a not-yet-migrated reader elsewhere
          // still sees a matching value.
          await query(
            `INSERT INTO products (id, name, sku, barcode, description, category, brand, subcategory, unit_of_measure,
               cost, price, stock, reorder_point, parent_id, image_url, conversion_factor, warehouse_id, type, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [id, p.name, barcode, barcode, p.description || '', p.category || 'General', p.brand || null,
              p.subcategory || null, p.unit || 'pcs', cost, price,
              parseFloat(p.stock_quantity) || 0, parseFloat(p.reorder_point) || 0, p.parent_id || null, p.image_url || null,
              parseFloat(p.conversion_factor) || 1, defaultWarehouseId,
              // Explicit ternary rather than passing the raw cell through: an
              // unrecognised value would be rejected by MySQL in strict mode.
              // Matches addProduct() and the JSON import path.
              String(p.type || '').toLowerCase() === 'service' ? 'service' : 'standard'],
          );

          // Every product needs a base selling unit (factor 1, is_base = 1) or
          // it is unsellable and unmatchable by barcode on a later import —
          // matches the convention actions.ts's writeSellingUnits() established.
          await query(
            `INSERT INTO product_selling_units (id, product_id, name, barcode, factor, cost, price, is_base)
             VALUES (?, ?, 'Piece', ?, 1, ?, ?, 1)`,
            [`psu_base_${id}`, id, barcode, cost || null, price],
          );
          successCount++;
        }
      } catch (err) { console.error(`Failed to import product ${p.name}:`, err); errorCount++; }
    }
    return NextResponse.json({ success: true, message: `Import processed. Added: ${successCount}, Updated: ${updateCount}, Errors: ${errorCount}` });
  } catch (error: any) {
    console.error('Error importing products (legacy):', error);
    return NextResponse.json({ success: false, error: 'Import failed' }, { status: 500 });
  }
}

// Resolve the default STORE warehouse: is_main first, then the seeded 'wh_main',
// then the oldest active warehouse. Returns null if none exist.
async function getDefaultWarehouseId(): Promise<string | null> {
  try {
    const [wh]: any = await query(
      `SELECT id FROM warehouses
       WHERE is_active = 1
       ORDER BY is_main DESC, (id = 'wh_main') DESC, created_at ASC
       LIMIT 1`,
    );
    return wh?.id ?? null;
  } catch (err) {
    console.warn('[Import] Could not resolve default warehouse:', err);
    return null;
  }
}

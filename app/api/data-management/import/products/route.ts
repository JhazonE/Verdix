import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';
import { v4 as uuidv4 } from 'uuid';
import { generateSku } from '@/lib/sku';
import { recordStockMovement } from '@/lib/stock-movements';
import { legacyProductCsvImport } from './legacy';

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

    for (let i = 0; i < rows.length; i++) {
      const p = rows[i];
      if (!p.name || String(p.name).trim() === '') {
        skipped++; errors.push({ row: i, reason: 'Missing product name' }); continue;
      }
      try {
        const barcode = p.barcode ? String(p.barcode).trim() : null;
        // Match on barcode first, else name.
        let existing: any = null;
        if (barcode) {
          [existing] = await query('SELECT id FROM products WHERE barcode = ? LIMIT 1', [barcode]) as any[];
        }
        if (!existing) {
          [existing] = await query('SELECT id FROM products WHERE name = ? LIMIT 1', [p.name]) as any[];
        }

        if (existing) {
          // Update catalog fields only — never touch stock on an existing product.
          await query(
            `UPDATE products SET name=?, barcode=?, description=?, category=?, brand=?, subcategory=?,
               unit_of_measure=?, cost=?, price=?, reorder_point=?, image_url=?, conversion_factor=?, updated_at=NOW()
             WHERE id=?`,
            [
              p.name, barcode, p.description ?? '', p.category ?? 'General', p.brand ?? null, p.subcategory ?? null,
              p.unit ?? 'pcs', num(p.cost_price), num(p.selling_price), num(p.reorder_point),
              p.image_url ?? null, p.conversion_factor != null ? num(p.conversion_factor) : 1, existing.id,
            ],
          );
          updated++;
        } else {
          const id = uuidv4();
          const sku = generateSku(p.brand, p.name);
          const stock = num(p.stock_quantity);
          const cost = num(p.cost_price);
          const price = num(p.selling_price);
          const rowType = String(p.type || '').toLowerCase() === 'service' ? 'service' : 'standard';
          await query(
            `INSERT INTO products (id, name, sku, barcode, description, category, brand, subcategory,
               unit_of_measure, cost, price, stock, reorder_point, image_url, conversion_factor, warehouse_id, type, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [
              id, p.name, sku, barcode, p.description ?? '', p.category ?? 'General', p.brand ?? null, p.subcategory ?? null,
              p.unit ?? 'pcs', cost, price, stock, num(p.reorder_point), p.image_url ?? null,
              p.conversion_factor != null ? num(p.conversion_factor) : 1, defaultWarehouseId, rowType,
            ],
          );

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
      } catch (err) {
        console.error(`Failed to import product row ${i}:`, err);
        skipped++; errors.push({ row: i, reason: 'Database error' });
      }
    }

    return NextResponse.json({ added, updated, skipped, errors });
  } catch (error: any) {
    console.error('Error importing products:', error);
    return NextResponse.json({ error: 'Import failed' }, { status: 500 });
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

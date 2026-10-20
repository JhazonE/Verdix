import { NextResponse } from 'next/server';
import { query } from '@/lib/mysql';
import {
  priceLevelFieldKey,
  productsSchemaWithPriceLevels,
  type ImportPriceLevel,
} from '@/lib/import/entity-schemas';
import { buildEntityExportCsv } from '@/lib/import/csv-out';

// Columns are aliased to the import field keys so the export matches the import
// template exactly. See lib/import/entity-schemas.ts.
export async function GET() {
  try {
    const products = await query(`
      SELECT
        p.id,
        p.name,
        p.type,
        p.barcode,
        p.description,
        p.category,
        p.brand,
        p.subcategory,
        p.unit_of_measure AS unit,
        p.cost AS cost_price,
        p.price AS selling_price,
        p.stock AS stock_quantity,
        p.reorder_point,
        p.image_url,
        p.conversion_factor
      FROM products p
    `) as any[];

    // Price levels become one column each, matching the import template, so an
    // export can be edited and fed straight back in. Non-default levels only:
    // the default level's base-unit price IS selling_price above.
    const levelRows = (await query(
      'SELECT id, name, is_default FROM price_levels ORDER BY name ASC',
    ).catch(() => [])) as any[];
    const levels: ImportPriceLevel[] = levelRows.map((r) => ({
      id: String(r.id),
      name: String(r.name ?? ''),
      isDefault: !!r.is_default,
    }));
    const schema = productsSchemaWithPriceLevels(levels);

    if (levels.some((l) => !l.isDefault)) {
      // One query for every product's base-unit level prices, rather than one
      // per product: the catalogue runs to tens of thousands of rows and this
      // export already streams the lot in a single pass.
      const priced = (await query(`
        SELECT su.product_id, sulp.price_level_id, sulp.price
        FROM product_selling_unit_price_levels sulp
        JOIN product_selling_units su ON su.id = sulp.selling_unit_id
        WHERE su.is_base = 1
      `).catch(() => [])) as any[];

      const byProduct = new Map<string, Map<string, unknown>>();
      for (const r of priced) {
        const pid = String(r.product_id);
        if (!byProduct.has(pid)) byProduct.set(pid, new Map());
        byProduct.get(pid)!.set(String(r.price_level_id), r.price);
      }

      for (const product of products) {
        const prices = byProduct.get(String(product.id));
        for (const level of levels) {
          if (level.isDefault) continue;
          // A level the product has no row for exports blank, which on
          // re-import means "leave it alone" — not "set it to zero".
          const value = prices?.get(level.id);
          product[priceLevelFieldKey(level)] = value ?? '';
        }
      }
    }

    const plain = JSON.parse(JSON.stringify(products));
    const csv = buildEntityExportCsv(schema, plain);
    const csvWithBOM = '﻿' + csv;

    return new NextResponse(csvWithBOM, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="products.csv"',
      },
    });
  } catch (error: any) {
    console.error('Error exporting products:', error);
    return NextResponse.json({ success: false, error: 'Failed to export products' }, { status: 500 });
  }
}

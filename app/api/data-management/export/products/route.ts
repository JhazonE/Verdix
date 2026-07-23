import { NextResponse } from 'next/server';
import { query } from '@/lib/mysql';
import { ENTITY_SCHEMAS } from '@/lib/import/entity-schemas';
import { buildEntityExportCsv } from '@/lib/import/csv-out';

// Columns are aliased to the import field keys so the export matches the import
// template exactly (plus a trailing `sku` for reference). See lib/import/entity-schemas.ts.
export async function GET() {
  try {
    const products = await query(`
      SELECT
        name,
        type,
        barcode,
        description,
        category,
        brand,
        subcategory,
        unit_of_measure AS unit,
        cost AS cost_price,
        price AS selling_price,
        stock AS stock_quantity,
        reorder_point,
        image_url,
        conversion_factor,
        sku
      FROM products
    `);

    const plain = JSON.parse(JSON.stringify(products));
    const csv = buildEntityExportCsv(ENTITY_SCHEMAS.products, plain, ['sku']);
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

/**
 * Generates a 15,000-row mixed price list: 12,000 rows targeting existing
 * products (by SKU) and 3,000 rows that will be created. Run against a dev DB.
 *
 *   npx tsx scripts/dev/generate-price-list-fixture.ts <warehouseId> [out.xlsx]
 */
import * as XLSX from 'xlsx';
import { query } from '../../lib/mysql';

async function main() {
  const warehouseId = process.argv[2];
  const out = process.argv[3] || 'price-list-15k.xlsx';
  if (!warehouseId) throw new Error('usage: generate-price-list-fixture.ts <warehouseId> [out.xlsx]');

  const existing: any = await query(
    'SELECT sku, price FROM products WHERE warehouse_id = ? AND sku IS NOT NULL LIMIT 12000',
    [warehouseId],
  );
  console.log(`found ${existing.length} existing products to update`);

  const header = ['sku', 'barcode', 'name', 'new_price', 'new_cost', 'new_markup_pct', 'brand', 'category', 'unit_of_measure'];
  const rows: any[][] = [];

  for (const p of existing) {
    const newPrice = Math.round((parseFloat(p.price || 10) * 1.05) * 100) / 100;
    rows.push([p.sku, '', '', newPrice, '', '', '', '', '']);
  }

  const stamp = Date.now();
  for (let i = 0; i < 3000; i++) {
    rows.push([`FIXT-${stamp}-${i}`, '', `Fixture Product ${i}`, 25 + (i % 50), 20, '', 'FixtureBrand', 'Grocery', 'pc']);
  }

  const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Price List');
  XLSX.writeFile(wb, out);
  console.log(`wrote ${rows.length} rows to ${out}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

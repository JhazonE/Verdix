import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync('app/api/reports/out-of-stock/route.ts', 'utf8');

assert.ok(src.includes("p.type = 'standard'"), 'services carry no stock and are excluded');
assert.ok(src.includes("'p.stock <= 0'"), 'out of stock means stock <= 0 (negative = oversold)');
// Never-stocked catalogue rows are hidden unless asked for.
assert.ok(/if \(!includeNeverStocked\)[\s\S]{0,120}EXISTS \(SELECT 1 FROM stock_movements/.test(src),
  'never-stocked products are hidden by default');
// Last sold uses the shared sale definitions, both sources, positive lines only.
assert.ok(src.includes("posSaleSql('st')") && src.includes("backofficeInvoiceSql('sinv')"),
  'last sold reads POS and back-office sales by the shared definitions');
assert.ok(/si\.quantity > 0/.test(src) && /sii\.quantity > 0/.test(src), 'a return is not a sale');

const index = readFileSync('app/(app)/reports/page.tsx', 'utf8');
assert.ok(index.includes('href="/reports/out-of-stock"'), 'the report is listed on the Reports page');

console.log('✓ out-of-stock-report');

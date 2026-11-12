import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { parseCsvText, parseXlsxBuffer } from '../../lib/import/parse-file';

// CSV
const csv = 'name,price\nMilo,120\nBear Brand,95\n';
const p = parseCsvText(csv);
assert.deepEqual(p.headers, ['name', 'price']);
assert.equal(p.rows.length, 2);
assert.deepEqual(p.rows[0], { name: 'Milo', price: '120' });

// CSV with BOM (Excel export) — header must not keep the BOM
const withBom = '﻿name,price\nMilo,120\n';
assert.deepEqual(parseCsvText(withBom).headers, ['name', 'price'], 'strips BOM from first header');

// XLSX round-trip
const ws = XLSX.utils.aoa_to_sheet([['name', 'price'], ['Milo', 120], ['Bear Brand', 95]]);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
const px = parseXlsxBuffer(buf);
assert.deepEqual(px.headers, ['name', 'price']);
assert.equal(px.rows.length, 2);
assert.deepEqual(px.rows[1], { name: 'Bear Brand', price: '95' });

// Numeric cells must come back as the stored value, not the displayed text.
// raw:false rendered a 13-digit barcode as "4.80002E+12", a price of 12.345 in a
// "0"-formatted cell as "12", and 1200.5 in a "#,##0.00" cell as "1,200.50".
{
  const sheet = XLSX.utils.aoa_to_sheet([
    ['barcode', 'new_price', 'when'],
    [4800016644801, 12.345, 46000],
    [8901234567890, 1200.5, 46001],
  ]);
  sheet['B2'].z = '0';
  sheet['B3'].z = '#,##0.00';
  sheet['C2'].z = 'yyyy-mm-dd';
  sheet['C3'].z = 'yyyy-mm-dd';
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'S');
  const parsed = parseXlsxBuffer(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
  assert.equal(parsed.rows[0].barcode, '4800016644801', 'a numeric barcode must not become scientific notation');
  assert.equal(parsed.rows[1].barcode, '8901234567890');
  assert.equal(parsed.rows[0].new_price, '12.345', 'a display format must not round the stored price');
  assert.equal(parsed.rows[1].new_price, '1200.5', 'a thousands-separator format must not leak into the value');
  assert.match(parsed.rows[0].when, /^\d{4}-\d{2}-\d{2}$/, 'date cells keep their formatted text');
}

console.log('import-parse: all assertions passed');

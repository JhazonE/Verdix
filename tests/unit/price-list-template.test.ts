import assert from 'node:assert/strict';
import { mapParsedRowsToPriceListRows } from '../../app/(app)/products/bulk-price-update/price-list-template';
import type { ParsedFile } from '../../lib/import/parse-file';

// mapParsedRowsToPriceListRows is the boundary between "raw Excel/CSV cell
// text" and the typed PriceListRow consumed by previewPriceListUpload. It
// deliberately signals a present-but-non-numeric cell as NaN (distinct from
// undefined = "cell was blank/absent") so downstream validation can tell
// "user typed garbage" apart from "user left this column empty". This is the
// exact signal previewPriceListUpload's new_price/new_cost/new_markup_pct
// branches must — and now do — check for before writing to the DB (see
// Finding 1 of the bulk-price-update whole-branch review).

const parsed: ParsedFile = {
  headers: ['barcode', 'new_price', 'new_cost', 'new_markup_pct'],
  rows: [
    // Fully blank numeric cells -> undefined (not present), not NaN.
    { barcode: 'BC-BLANK', new_price: '', new_cost: '', new_markup_pct: '' },
    // Valid numbers parse through untouched.
    { barcode: 'BC-VALID', new_price: '19.99', new_cost: '10', new_markup_pct: '25' },
    // Non-numeric text in a present cell -> NaN, not undefined and not 0.
    { barcode: 'BC-GARBAGE', new_price: 'abc', new_cost: 'N/A', new_markup_pct: 'ten percent' },
    // A negative markup is a legitimate markdown -> parses as a normal number.
    { barcode: 'BC-MARKDOWN', new_price: '', new_cost: '', new_markup_pct: '-10' },
  ],
};

const rows = mapParsedRowsToPriceListRows(parsed);

const blank = rows.find(r => r.barcode === 'BC-BLANK')!;
assert.equal(blank.newPrice, undefined, 'blank new_price cell maps to undefined');
assert.equal(blank.newCost, undefined, 'blank new_cost cell maps to undefined');
assert.equal(blank.newMarkupPct, undefined, 'blank new_markup_pct cell maps to undefined');

const valid = rows.find(r => r.barcode === 'BC-VALID')!;
assert.equal(valid.newPrice, 19.99, 'numeric new_price cell parses correctly');
assert.equal(valid.newCost, 10, 'numeric new_cost cell parses correctly');
assert.equal(valid.newMarkupPct, 25, 'numeric new_markup_pct cell parses correctly');

const garbage = rows.find(r => r.barcode === 'BC-GARBAGE')!;
assert.equal(Number.isNaN(garbage.newPrice), true, 'non-numeric new_price cell maps to NaN, not undefined');
assert.equal(Number.isNaN(garbage.newCost), true, 'non-numeric new_cost cell maps to NaN, not undefined');
assert.equal(Number.isNaN(garbage.newMarkupPct), true, 'non-numeric new_markup_pct cell maps to NaN, not undefined');

const markdown = rows.find(r => r.barcode === 'BC-MARKDOWN')!;
assert.equal(markdown.newMarkupPct, -10, 'a negative markup pct (markdown) parses as a normal finite number, not NaN');

console.log('price-list-template: all assertions passed');

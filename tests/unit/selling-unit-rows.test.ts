import assert from 'node:assert/strict';
import { explodeToUnitRows } from '../../lib/selling-unit-rows';

// A product with more than one selling unit explodes into one row per unit,
// so a Case and its base Piece can be picked separately in search results.
const multiUnit: any = {
  id: 'p1',
  type: 'product',
  sellingUnits: [
    { id: 'u-piece', name: 'Piece', factor: 1, price: 10, isBase: true },
    { id: 'u-case', name: 'Case', factor: 24, price: 220, isBase: false },
  ],
};
const rows = explodeToUnitRows([multiUnit]);
assert.equal(rows.length, 2, 'a two-unit product yields two rows');
assert.deepEqual(rows.map(r => r.key), ['p1:u-piece', 'p1:u-case'], 'row keys are product:unit');
assert.equal(rows[0].unit?.name, 'Piece');
assert.equal(rows[1].unit?.name, 'Case');

// A single-unit product collapses to one row, carrying its lone unit.
const singleUnit: any = {
  id: 'p2',
  type: 'product',
  sellingUnits: [{ id: 'u-base', name: 'Piece', factor: 1, price: 5, isBase: true }],
};
const singleRows = explodeToUnitRows([singleUnit]);
assert.equal(singleRows.length, 1, 'a single-unit product yields one row');
assert.equal(singleRows[0].key, 'p2', 'a single-unit row keys by product id alone');
assert.equal(singleRows[0].unit?.id, 'u-base');

// A service carries no selling units at all — it must still render as a
// single row (no unit), never disappear or throw.
const service: any = { id: 'p3', type: 'service', sellingUnits: [{ id: 'x', name: 'Session', factor: 1, price: 100 }] };
const serviceRows = explodeToUnitRows([service]);
assert.equal(serviceRows.length, 1, 'a service yields exactly one row');
assert.equal(serviceRows[0].unit, undefined, 'a service row carries no unit');

// A product with no sellingUnits array at all (pre-migration data) still
// renders as a single row with an undefined unit, never throws.
const legacy: any = { id: 'p4', type: 'product' };
const legacyRows = explodeToUnitRows([legacy]);
assert.equal(legacyRows.length, 1, 'a product with no sellingUnits yields one row');
assert.equal(legacyRows[0].unit, undefined);

console.log('✅ selling-unit-rows tests passed');

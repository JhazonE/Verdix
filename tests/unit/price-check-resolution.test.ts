import assert from 'node:assert/strict';
import type { Product } from '../../lib/types';
import { resolveKioskPrice } from '../../lib/kiosk-price';

/**
 * Ang price-checker kiosk walay cashier nga mobantay, mao nga walay makapili ug
 * price level — ang default level (Retail) ra gyud, quantity 1, base unit.
 *
 * Ang importante dinhi: kung ang gi-quote sa kiosk lahi sa gi-charge sa
 * register, ang kiosk mas grabe pa kay sa wala. Mao nga ang presyo moagi sa
 * parehas nga `calculateEffectivePrice` nga gigamit sa POS.
 */

const BASE: Product = {
  id: 'p1',
  name: 'Coca-Cola 1.5L',
  description: '',
  category: 'Beverages',
  brand: 'Coke',
  stock: 24,
  reorderPoint: 0,
  avgDailySales: 0,
  price: 89,
  sku: 'SKU-1',
  barcode: '4800016641116',
  imageUrl: '',
  imageHint: '',
  unitOfMeasure: 'Bottle',
};

// --- Review Focus #1: a base unit with no level override ---------------------
// Falls back to the unit's own price. NEVER another unit's price, and never a
// computed multiple of one — `NULL` means inherit, it does not mean derive.
const noOverride: Product = {
  ...BASE,
  sellingUnits: [
    { id: 'su1', name: 'Bottle', factor: 1, barcode: '4800016641116', price: 89, isBase: true },
  ],
};
assert.equal(resolveKioskPrice(noOverride, 'retail-level').price, 89, 'falls back to the unit own price');
assert.equal(resolveKioskPrice(noOverride, 'retail-level').unitName, 'Bottle', 'names the base unit');
assert.equal(
  resolveKioskPrice(noOverride, 'retail-level').barcode,
  '4800016641116',
  'reports the base unit barcode',
);

// --- Review Focus #5: a product with several selling units -------------------
// Base = Piece @ 17, non-base = Case @ 1020. The kiosk quotes what an ordinary
// customer buys, which is the base unit — not the first unit in the array and
// not the cheapest.
const multiUnit: Product = {
  ...BASE,
  name: 'Lucky Me Pancit Canton',
  price: 17,
  unitOfMeasure: 'Piece',
  sellingUnits: [
    { id: 'su-case', name: 'Case', factor: 60, barcode: '1000000000060', price: 1020, isBase: false },
    { id: 'su-piece', name: 'Piece', factor: 1, barcode: '1000000000001', price: 17, isBase: true },
  ],
};
const multi = resolveKioskPrice(multiUnit, 'retail-level');
assert.equal(multi.price, 17, 'returns the BASE unit price');
assert.equal(multi.unitName, 'Piece', 'names the base unit, not the first in the array');
assert.equal(multi.barcode, '1000000000001', 'reports the base unit barcode, not the case barcode');

// --- An untiered default-level override wins over the unit's own price -------
const withOverride: Product = {
  ...BASE,
  priceLevels: [
    { levelId: 'retail-level', price: 85, minQuantity: 0 } as any,
  ],
  sellingUnits: [
    { id: 'su1', name: 'Bottle', factor: 1, barcode: '4800016641116', price: 89, isBase: true },
  ],
};
assert.equal(
  resolveKioskPrice(withOverride, 'retail-level').price,
  85,
  'default-level override applies',
);

// --- A "12+" bulk tier must NOT be advertised as the price of one -----------
// The kiosk always asks at quantity 1, so a tiered row cannot qualify. A
// customer reading 85 off the screen and being charged 89 at the till is the
// exact failure this guards.
const withBulkTier: Product = {
  ...BASE,
  priceLevels: [
    { levelId: 'retail-level', price: 85, minQuantity: 12 } as any,
  ],
  sellingUnits: [
    { id: 'su1', name: 'Bottle', factor: 1, barcode: '4800016641116', price: 89, isBase: true },
  ],
};
assert.equal(
  resolveKioskPrice(withBulkTier, 'retail-level').price,
  89,
  'a 12+ bulk tier is not quoted as the single-unit price',
);

// --- A product with no sellingUnits array at all -----------------------------
// Rows predating the selling-unit migration still exist; the kiosk must render
// them rather than crash on an undefined base unit.
assert.equal(resolveKioskPrice(BASE, 'retail-level').price, 89, 'legacy product still resolves');
assert.equal(
  resolveKioskPrice(BASE, 'retail-level').unitName,
  'Bottle',
  'legacy product falls back to unitOfMeasure',
);

console.log('✓ price-check-resolution tests passed');

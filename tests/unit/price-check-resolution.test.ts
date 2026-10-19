import assert from 'node:assert/strict';
import type { Product } from '../../lib/types';
import { resolveKioskPrice } from '../../lib/kiosk-price';
import { calculateEffectivePriceForUnit } from '../../lib/pricing';

/**
 * Ang price-checker kiosk walay cashier nga mobantay, mao nga walay makapili ug
 * price level — ang default level (Retail) ra gyud, ug quantity 1.
 *
 * Ang importante dinhi: kung ang gi-quote sa kiosk lahi sa gi-charge sa
 * register, ang kiosk mas grabe pa kay sa wala. Mao nga ang presyo moagi sa
 * PAREHAS nga `calculateEffectivePriceForUnit` nga gigamit sa POS, sa unit nga
 * gi-scan — dili sa base unit kung lain ang gi-scan.
 *
 * FIXTURE SHAPE MATTERS. Ang `GET /api/products` WALAY gi-populate nga
 * `product.priceLevels` — ang `mapApiProduct` mo-set niini ngadto sa `[]`, ug
 * ang mga override naa sa `sellingUnits[].priceLevels`. Ang mga fixture dinhi
 * nagsunod sa tinuod nga shape, kay kung dili, mag-test ta sa patay nga code
 * path (mao ni ang rason nga nakalusot ang duha ka bug sa unang review).
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
  priceLevels: [], // what the API actually returns
};

// --- Review Focus #1: a base unit with no level override ---------------------
const noOverride: Product = {
  ...BASE,
  sellingUnits: [
    { id: 'su1', name: 'Bottle', factor: 1, barcode: '4800016641116', price: 89, isBase: true, priceLevels: [] },
  ],
};
{
  const r = resolveKioskPrice(noOverride, 'retail-level');
  assert.equal(r.price, 89, 'falls back to the unit own price');
  assert.equal(r.unitName, 'Bottle', 'names the base unit');
  assert.equal(r.barcode, '4800016641116', 'reports the base unit barcode');
}

// --- Review Focus #5: several selling units, no code scanned ----------------
// Base = Piece @ 17, non-base = Case @ 1020. With nothing scanned the kiosk
// quotes the base unit: what an ordinary customer carries to the register.
const multiUnit: Product = {
  ...BASE,
  name: 'Lucky Me Pancit Canton',
  price: 17,
  unitOfMeasure: 'Piece',
  sellingUnits: [
    { id: 'su-case', name: 'Case', factor: 60, barcode: '1000000000060', price: 1020, isBase: false, priceLevels: [] },
    { id: 'su-piece', name: 'Piece', factor: 1, barcode: '1000000000001', price: 17, isBase: true, priceLevels: [] },
  ],
};
{
  const r = resolveKioskPrice(multiUnit, 'retail-level');
  assert.equal(r.price, 17, 'returns the BASE unit price');
  assert.equal(r.unitName, 'Piece', 'names the base unit, not the first in the array');
  assert.equal(r.barcode, '1000000000001', 'reports the base unit barcode');
}

// --- A SCANNED non-base barcode must price THAT unit ------------------------
// Regression for the review's C1: the kiosk used to quote the Piece price for
// a scanned Case barcode and display the Piece barcode, so a customer read
// ₱17 and was charged ₱1020. POS resolves a non-base barcode to that unit
// (lib/pos-cart-units.ts resolveSellingUnitForAdd), and so must the kiosk.
{
  const r = resolveKioskPrice(multiUnit, 'retail-level', '1000000000060');
  assert.equal(r.price, 1020, 'a scanned Case barcode quotes the Case price');
  assert.equal(r.unitName, 'Case', 'names the scanned unit');
  assert.equal(r.barcode, '1000000000060', 'echoes the barcode the customer scanned');
}

// Scanning the BASE barcode still gives the base unit.
{
  const r = resolveKioskPrice(multiUnit, 'retail-level', '1000000000001');
  assert.equal(r.price, 17, 'a scanned base barcode quotes the base price');
  assert.equal(r.unitName, 'Piece', 'names the base unit');
}

// --- Agreement with POS is STRUCTURAL, not a coincidence --------------------
// Same function POS calls, on the same unit. A tier of min_quantity = 1 is the
// case that used to diverge: `qualifies` lets a TIERED row compete on ANY
// level, so POS honoured a Wholesale tier@1 at quantity 1 while the kiosk —
// reading only products.price — did not.
const tieredAtOne: Product = {
  ...BASE,
  sellingUnits: [
    {
      id: 'su1', name: 'Bottle', factor: 1, barcode: '4800016641116', price: 100, isBase: true,
      priceLevels: [{ levelId: 'wholesale-level', price: 80, minQuantity: 1 } as any],
    },
  ],
};
{
  const unit = tieredAtOne.sellingUnits![0];
  const pos = calculateEffectivePriceForUnit(unit as any, 1, 'retail-level', 'retail-level');
  const kiosk = resolveKioskPrice(tieredAtOne, 'retail-level');
  assert.equal(kiosk.price, pos, 'kiosk agrees with POS on a tier@1 row');
  assert.equal(kiosk.price, 80, 'the qualifying tier@1 lowers the price, as POS does');
}

// A "12+" bulk tier must NOT be quoted as the price of one.
const withBulkTier: Product = {
  ...BASE,
  sellingUnits: [
    {
      id: 'su1', name: 'Bottle', factor: 1, barcode: '4800016641116', price: 89, isBase: true,
      priceLevels: [{ levelId: 'retail-level', price: 85, minQuantity: 12 } as any],
    },
  ],
};
{
  const unit = withBulkTier.sellingUnits![0];
  const pos = calculateEffectivePriceForUnit(unit as any, 1, 'retail-level', 'retail-level');
  const kiosk = resolveKioskPrice(withBulkTier, 'retail-level');
  assert.equal(kiosk.price, 89, 'a 12+ bulk tier is not quoted as the single-unit price');
  assert.equal(kiosk.price, pos, 'kiosk agrees with POS on a bulk-tier row');
}

// An untiered default-level override on the base unit applies, as in POS.
const withOverride: Product = {
  ...BASE,
  sellingUnits: [
    {
      id: 'su1', name: 'Bottle', factor: 1, barcode: '4800016641116', price: 89, isBase: true,
      priceLevels: [{ levelId: 'retail-level', price: 85, minQuantity: 0 } as any],
    },
  ],
};
{
  const unit = withOverride.sellingUnits![0];
  const pos = calculateEffectivePriceForUnit(unit as any, 1, 'retail-level', 'retail-level');
  const kiosk = resolveKioskPrice(withOverride, 'retail-level');
  assert.equal(kiosk.price, 85, 'default-level override applies');
  assert.equal(kiosk.price, pos, 'kiosk agrees with POS on an untiered override');
}

// --- A product with no sellingUnits array at all -----------------------------
// Rows predating the selling-unit migration still exist; the kiosk must render
// them rather than crash on an undefined base unit.
{
  const r = resolveKioskPrice(BASE, 'retail-level');
  assert.equal(r.price, 89, 'legacy product still resolves');
  assert.equal(r.unitName, 'Bottle', 'legacy product falls back to unitOfMeasure');
}

// An unknown scanned code on a legacy product must not throw either.
{
  const r = resolveKioskPrice(BASE, 'retail-level', '9999999999999');
  assert.equal(r.price, 89, 'unknown code on a legacy product falls back to the product price');
}

console.log('✓ price-check-resolution tests passed');

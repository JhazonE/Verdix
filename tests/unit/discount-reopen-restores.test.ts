import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { discountSeedValue } from '../../app/(app)/pos/discount/use-discount';

// Reopening the discount sheet on an already-discounted line showed a raw
// float instead of what the cashier had declared:
//
//   VALUE TO SUBTRACT:  % 0.07117944337675279
//
// Two faults, both in the effect that seeds the sheet.
//
// 1. It dumped `item.discount.toString()` — the stored percentage at full
//    float precision. A discount is STORED as a percentage (see
//    lib/discount-format.ts), and the division that produces one rarely lands
//    on a round number, so reopening showed noise nobody typed.
//
// 2. It forced the TYPE back to 'percent' regardless of how the discount was
//    entered. A line discounted by ₱5.00 reopened as a percentage box holding
//    8.084074373484237, so the cashier could not see, confirm or adjust the
//    figure they had actually declared.
//
// The sheet now reopens showing the discount in the terms it was entered in:
// a fixed amount comes back as pesos, a percentage comes back trimmed.

// ─── the seeder, exercised directly ──────────────────────────────────────
const line = (over: Partial<any> = {}) =>
  ({ price: 61.85, quantity: 1, discount: 0, ...over }) as any;

// an undiscounted line opens empty, not "0"
assert.equal(discountSeedValue(line()), '', 'an undiscounted line opens with an empty box');
assert.equal(discountSeedValue(null as any), '', 'no selected line opens with an empty box');

// ─── a fixed amount comes back as the pesos that were entered ────────────
const FIVE_PESOS_PCT = (5 / 61.85) * 100; // 8.084074373484237
assert.equal(
  discountSeedValue(line({ discount: FIVE_PESOS_PCT, discountType: 'amount' })),
  '5',
  'a line discounted by ₱5.00 reopens showing 5, not the stored percentage',
);

// the amount is reconstructed from the LINE's own value, so quantity counts
assert.equal(
  discountSeedValue(line({ price: 50, quantity: 3, discount: (15 / 150) * 100, discountType: 'amount' })),
  '15',
  'a ₱15 discount on a 3-unit line reopens as 15, not 5',
);

// ─── a percentage comes back trimmed, not at float precision ─────────────
assert.equal(
  discountSeedValue(line({ discount: 10, discountType: 'percent' })),
  '10',
  'a clean 10% reopens as 10',
);
assert.equal(
  discountSeedValue(line({ discount: FIVE_PESOS_PCT, discountType: 'percent' })),
  '8.08',
  'an awkward percentage reopens trimmed to two decimals, not as ' +
    '8.084074373484237',
);

// the reported case: a tiny percentage must not come back as a float dump
const reported = discountSeedValue(line({ discount: 0.07117944337675279, discountType: 'percent' }));
assert.ok(
  !reported.includes('0.07117944337675279'),
  `the raw stored float never reaches the input (got ${reported})`,
);
assert.ok(
  reported.length <= 6,
  `the reopened figure is short enough to read and retype (got ${reported})`,
);

// ─── statutory rates reopen at their legal rate ──────────────────────────
assert.equal(
  discountSeedValue(line({ discount: 20, discountType: 'senior' })),
  '20',
  'a senior-citizen line reopens at 20',
);

// ─── and the sheet restores the TYPE, not just the number ────────────────
const hook = fs
  .readFileSync(path.join(__dirname, '../..', 'app/(app)/pos/discount/use-discount.ts'), 'utf-8')
  .replace(/\r\n/g, '\n');

assert.ok(
  !/setValue\(\s*item[?.]*\.discount\s*\?\s*item\.discount\.toString\(\)/.test(hook),
  'the sheet no longer seeds the input with the raw stored percentage',
);
assert.ok(
  /setDiscountType\(\s*[^)]*discountType/.test(hook),
  'reopening restores the discount TYPE the line was given, so a fixed ' +
    'amount does not come back as a percentage box',
);

console.log('✓ discount-reopen-restores');

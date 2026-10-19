import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Regression: ang `Price Inquiry` nga account nakasulod sa POS CHECKOUT.
 *
 * Tulo diay ka entry point ang naa, dili duha:
 *   1. `app/login/page.tsx`            — ang main login form
 *   2. `app/(app)/use-app-layout.ts`   — ang pin batok sa gi-type nga URL
 *   3. `app/(app)/pos/.../use-pos.ts`  — ang POS adunay KAUGALINGON nga login
 *
 * Ang ikatulo wala na-cover sa una, mao nga ang kiosk account makalogin sa
 * POS ug makahimo ug tinuod nga sale — gi-screenshot sa user nga adunay cart
 * ug Tender button. Ang POS login mo-check sa `pos_frontliner` pero wala
 * mo-check sa user type.
 *
 * Gi-scope ang regex sa `handlePosLoginSuccess` nga function lang (hangtod sa
 * sunod nga top-level `const`) para dili mo-truncate sa nested braces.
 */
const posPath = path.join(__dirname, '../..', 'app/(app)/pos/pos-content/use-pos.ts');
const src = fs.readFileSync(posPath, 'utf-8');

const fnMatch = src.match(/const handlePosLoginSuccess = async \(user: any\) => \{[\s\S]*?\n  \};/);
assert.ok(fnMatch, 'found handlePosLoginSuccess');
const fn = fnMatch![0];

// Kinahanglan mo-reject sa Price Inquiry una pa mo-set sa logged-in state.
assert.ok(
  /Price Inquiry/.test(fn),
  'handlePosLoginSuccess must recognise the Price Inquiry user type',
);

// Ang reject kinahanglan mouna sa `setIsPosLoggedIn(true)` — kung mag-set una
// ug logged-in, makita gihapon sa kustomer ang checkout screen.
const idxCheck = fn.indexOf('Price Inquiry');
const idxLoggedIn = fn.indexOf('setIsPosLoggedIn(true)');
assert.ok(idxLoggedIn > -1, 'handlePosLoginSuccess sets the logged-in flag');
assert.ok(
  idxCheck < idxLoggedIn,
  'the Price Inquiry rejection must come BEFORE setIsPosLoggedIn(true)',
);

console.log('✓ pos-login-blocks-price-inquiry tests passed');

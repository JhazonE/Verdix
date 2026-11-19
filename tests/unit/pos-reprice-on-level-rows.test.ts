import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The POS cart must re-price when a customer's price level — and the level
 * ROWS that carry its prices — arrive after the line was added.
 *
 * The bug this guards: a customer declared on a level dearer than retail
 * (PEDDLER ₱20 against a ₱16 shelf price) kept the retail price at the till.
 * `lib/pricing.ts` resolved it correctly the whole time; the cart simply never
 * re-ran the resolver with the right inputs, and nothing on screen said so.
 *
 * Three independent wiring facts have to hold, and each one alone is enough to
 * reintroduce the wrong price:
 *
 * 1. Selecting a customer on an unknown level refreshes the PRODUCTS too. The
 *    levels list only says the level exists; the prices live in each selling
 *    unit's priceLevels rows, which come down with the products.
 * 2. The re-price effect depends on `defaultLevelId`. It is derived from the
 *    freshly loaded levels, so until they land it falls back to 'retail-level'
 *    and the dearer level cannot win.
 * 3. The re-price effect depends on a CONTENT signature of the price-level
 *    rows. The effect reads `productsRef.current`, and a ref is not a React
 *    dependency, so refreshed rows would otherwise land with nothing to
 *    re-price against them.
 *
 * These are asserted against the source because they are wiring, not output:
 * the resolver's own behaviour is covered by pricing.test.ts, and every one of
 * these failures produced a CORRECT resolver called with stale arguments.
 */

const usePos = fs.readFileSync(
  path.join(process.cwd(), 'app', '(app)', 'pos', 'pos-content', 'use-pos.ts'),
  'utf8',
);
const posTypes = fs.readFileSync(
  path.join(process.cwd(), 'app', '(app)', 'pos', 'pos-content', 'pos-types.ts'),
  'utf8',
);

// 1. Selecting a customer on an unknown level refreshes products as well.
{
  const handler = usePos.slice(usePos.indexOf('const handleSelectCustomer'));
  const body = handler.slice(0, handler.indexOf('setIsCustomerSelectOpen'));
  assert.ok(
    body.includes('refreshPriceLevels()'),
    'handleSelectCustomer must refresh the price levels',
  );
  assert.ok(
    body.includes('refreshProducts()'),
    'handleSelectCustomer must ALSO refresh the products: the level prices live ' +
      'in each selling unit\'s priceLevels rows, not in the levels list',
  );
}

// 2 + 3. The re-price effect's dependency array.
{
  const marker = 'Re-price items when price level changes';
  const at = usePos.indexOf(marker);
  assert.ok(at > -1, 'the re-price effect should still be identifiable by its comment');

  // The effect ends at its dependency array: the first `}, [` after the marker.
  const depsAt = usePos.indexOf('}, [', at);
  assert.ok(depsAt > -1, 'the re-price effect should close with a dependency array');
  const deps = usePos.slice(depsAt + 3, usePos.indexOf(']', depsAt) + 1);

  assert.ok(
    deps.includes('activeLevelId'),
    're-price must depend on activeLevelId',
  );
  assert.ok(
    deps.includes('defaultLevelId'),
    're-price must depend on defaultLevelId: it is derived from the freshly ' +
      'loaded levels, and until they land it falls back to retail-level',
  );
  assert.ok(
    deps.includes('priceLevelSignature'),
    're-price must depend on priceLevelSignature: the effect reads ' +
      'productsRef.current, and a ref is not a React dependency',
  );
}

// The signature must be derived from the price-level ROWS, not from identity.
{
  const at = usePos.indexOf('const priceLevelSignature');
  assert.ok(at > -1, 'priceLevelSignature should exist');
  const body = usePos.slice(at, usePos.indexOf('[products]', at));
  assert.ok(
    body.includes('priceLevels') && body.includes('minQuantity'),
    'the signature must cover each unit\'s price-level rows AND their tiers, ' +
      'so a changed tier re-prices too',
  );
}

// A hand-typed price must survive the now more frequent re-pricing.
{
  assert.ok(
    posTypes.includes('priceManuallySet'),
    'SaleItem must record a hand-typed price so re-pricing can skip it',
  );
  const at = usePos.indexOf('const updated = currentItems.map');
  assert.ok(at > -1, 'the re-price map should still be identifiable');
  const body = usePos.slice(at, at + 400);
  assert.ok(
    body.includes('priceManuallySet'),
    'the re-price effect must skip lines whose price the cashier typed by hand, ' +
      'or a correction they already made would silently snap back',
  );
}

console.log('✅ pos reprice-on-level-rows tests passed');

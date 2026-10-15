import assert from 'node:assert/strict';
import { createAutoPriceCellTracker } from '../../lib/selling-unit-autoprice-cells';

// Clearing a price level and SAVING it worked, but reopening the product put
// the price back. The clear was remembered only for as long as the dialog
// stayed open: on reopen the tracker started empty, so a level the user had
// deleted looked exactly like a level that had never been filled in, and
// `shouldSeedMissingRow` seeded it from cost all over again.
//
// `adoptSaved` is the missing piece. A product loaded from the database has
// already been decided: the rows it carries are the user's prices, and the
// levels it carries no row for are absent because the user removed them.

// ─── a saved product's absent level is NOT re-seeded ─────────────────────
{
  const t = createAutoPriceCellTracker();
  // Wholesale was deleted and saved, so the loaded product has no row for it.
  t.adoptSaved(
    ['unit:u1:retail', 'unit:u1:wholesale'],
    (key) => key === 'unit:u1:retail',
  );
  assert.equal(
    t.shouldSeedMissingRow('unit:u1:wholesale'),
    false,
    'a level with no saved row stays absent on reopen',
  );
  assert.equal(
    t.writable('unit:u1:wholesale', undefined),
    false,
    'and no price is suggested into it either',
  );
}

// ─── a saved price is not recomputed ─────────────────────────────────────
{
  const t = createAutoPriceCellTracker();
  t.adoptSaved(['unit:u1:retail'], () => true);
  assert.equal(
    t.writable('unit:u1:retail', 58.4),
    false,
    'a price already on the product belongs to whoever saved it',
  );
}

// ─── the base unit's rows are adopted the same way ───────────────────────
{
  const t = createAutoPriceCellTracker();
  t.adoptSaved(['base:retail', 'base:wholesale'], (key) => key === 'base:retail');
  assert.equal(t.shouldSeedMissingRow('base:wholesale'), false, 'base-unit clear survives reopen');
  assert.equal(t.writable('base:retail', 75), false, 'base-unit saved price is left alone');
}

// ─── a level NOT passed to adoptSaved is still the autopricer's ──────────
// A price level created in Settings after this product was last saved has no
// row and was never decided against, so it should still be suggested into.
{
  const t = createAutoPriceCellTracker();
  t.adoptSaved(['unit:u1:retail'], () => true);
  assert.equal(
    t.shouldSeedMissingRow('unit:u1:members'),
    true,
    'a level the product was never asked about is still seedable',
  );
}

// ─── adopting a saved product does not freeze a brand-new unit ───────────
// An extra unit added during this editing session is not in the adopted set,
// so its levels still fill from cost as they always have.
{
  const t = createAutoPriceCellTracker();
  t.adoptSaved(['unit:u1:retail', 'unit:u1:wholesale'], (key) => key === 'unit:u1:retail');
  assert.equal(t.shouldSeedMissingRow('unit:u2:retail'), true, 'a newly added unit seeds normally');
  assert.equal(t.writable('unit:u2:retail', undefined), true, 'and is filled from cost');
}

// ─── a row present but with NO price counts as absent ────────────────────
// A tier typed with no price is not an override (actions.ts skips it), so it
// must not make the level look decided-with-a-price.
{
  const t = createAutoPriceCellTracker();
  t.adoptSaved(['unit:u1:wholesale'], () => false);
  assert.equal(
    t.shouldSeedMissingRow('unit:u1:wholesale'),
    false,
    'a priceless row is treated as no override, and is not seeded over',
  );
}

// ─── the deliberate tradeoff: "never set" is indistinguishable from "deleted" ─
// A saved product carries no record of WHY a level has no row, so adopting it
// also stops the autopricer suggesting into a level the user simply never
// filled in. That is the right way round: silently refilling it is the bug
// being fixed, and the user can still type a price whenever they want one.
// The Add dialog does not adopt, so a product being created still fills
// freely from cost.
{
  const t = createAutoPriceCellTracker();
  t.adoptSaved(['base:retail', 'base:wholesale'], (key) => key === 'base:retail');
  assert.equal(
    t.shouldSeedMissingRow('base:wholesale'),
    false,
    'an unset level on a saved product is left for the user to fill, not auto-filled',
  );
}

// ─── reset still wipes adoption (a different product is now loaded) ──────
{
  const t = createAutoPriceCellTracker();
  t.adoptSaved(['unit:u1:wholesale'], () => false);
  t.reset();
  assert.equal(
    t.shouldSeedMissingRow('unit:u1:wholesale'),
    true,
    'another product starts with no adopted memory',
  );
}

console.log('✓ a saved product\'s deleted price levels survive reopening the Edit form');

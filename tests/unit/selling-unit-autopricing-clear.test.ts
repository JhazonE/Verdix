import assert from 'node:assert/strict';
import { createAutoPriceCellTracker } from '../../lib/selling-unit-autoprice-cells';

// A price-level cell on the Add/Edit Product "Selling Units" tab could not be
// cleared. Deleting the number put it straight back, so a price level could
// never be removed once it had a value.
//
// Two collaborating faults in useSellingUnitAutoPricing:
//
// 1. A level with NO ROW at all was re-added unconditionally, bypassing the
//    `writable` check entirely. Clearing a price REMOVES the row (blank means
//    "no override"), so the autopricer read the clear as "this level was never
//    filled in" and filled it.
//
// 2. `writable` treated `Number(current) === 0` as "empty, mine to write", so
//    even where the row survived, a cleared cell read as unowned and was
//    refilled.
//
// The tracker below is the shared decision: a cell the user emptied is
// REMEMBERED as cleared and is never auto-filled again while the product stays
// open, exactly as a hand-typed price is never overwritten.

const tracker = () => createAutoPriceCellTracker();

// ─── a cell the autopricer filled stays its own to update ────────────────
{
  const t = tracker();
  assert.equal(t.writable('base:retail', undefined), true, 'an untouched empty cell is fillable');
  t.recordAuto('base:retail', 60.11);
  assert.equal(t.writable('base:retail', 60.11), true, 'the autopricer may update its own value');
}

// ─── a hand-typed price is never overwritten (pre-existing behaviour) ────
{
  const t = tracker();
  t.recordAuto('base:retail', 60.11);
  assert.equal(t.writable('base:retail', 75), false, 'a user-typed price locks the cell');
  assert.equal(t.writable('base:retail', 60.11), false, 'and stays locked even back at our value');
}

// ─── THE BUG: clearing a cell that held a price must stick ───────────────
{
  const t = tracker();
  t.recordAuto('unit:u1:wholesale', 58.4);
  // user deletes the contents of the input
  t.recordCleared('unit:u1:wholesale');
  assert.equal(
    t.writable('unit:u1:wholesale', undefined),
    false,
    'a cleared cell is NOT refilled by the autopricer',
  );
  assert.equal(
    t.shouldSeedMissingRow('unit:u1:wholesale'),
    false,
    'and a cleared cell whose ROW was removed is not re-seeded either',
  );
}

// ─── a level genuinely never filled still gets its row seeded ───────────
{
  const t = tracker();
  assert.equal(
    t.shouldSeedMissingRow('unit:u1:wholesale'),
    true,
    'a level with no row and no history is still seeded for the first time',
  );
}

// ─── clearing is remembered per cell, not globally ───────────────────────
{
  const t = tracker();
  t.recordCleared('unit:u1:wholesale');
  assert.equal(t.writable('unit:u1:retail', undefined), true, 'a sibling cell is unaffected');
  assert.equal(t.shouldSeedMissingRow('unit:u1:retail'), true, 'and its missing row still seeds');
}

// ─── retyping into a cleared cell hands it back to the user, not the hook ─
{
  const t = tracker();
  t.recordAuto('base:wholesale', 58.4);
  t.recordCleared('base:wholesale');
  assert.equal(t.writable('base:wholesale', 42), false, 'a value typed after a clear is the user\'s');
}

// ─── reset (a different product opened) forgets every cell ──────────────
{
  const t = tracker();
  t.recordAuto('base:retail', 60.11);
  t.recordCleared('base:retail');
  t.reset();
  assert.equal(t.writable('base:retail', undefined), true, 'a fresh product starts with no memory');
  assert.equal(t.shouldSeedMissingRow('base:retail'), true, 'including no cleared memory');
}

// ─── 0 is a real price (sell at cost), not an empty cell ─────────────────
{
  const t = tracker();
  t.recordAuto('base:retail', 60.11);
  assert.equal(
    t.writable('base:retail', 0),
    false,
    'a deliberate 0 is a price (sell at cost) and must not be overwritten',
  );
}

console.log('✓ selling-unit autopricing respects cleared price-level cells');
